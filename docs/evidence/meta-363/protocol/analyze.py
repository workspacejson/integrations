#!/usr/bin/env python3
"""Distil every M2B run into one comparable row.

The measured quantity is the same one M2A measured: did the review surface the
registered partner file for investigation, and did it inspect that partner
itself. Everything else (verdict wording, prose quality) is deliberately not
scored.
"""
import json, glob, os, re, sys

SP = os.path.dirname(os.path.abspath(__file__))
RES = os.path.join(SP, "results")
PARTNER = "packages/spec/schema/v1.json"
ADAPTER_TOOL = "workspace_review_evidence"

ARMS = [
    ("baseline", "directive prompt, no adapter"),
    ("treatment", "directive prompt, adapter present"),
    ("perturbation", "directive prompt, adapter present, registered pair removed"),
    ("treatment-instrumented", "directive prompt, adapter present (tool calls recorded)"),
    ("treatment-invoked", "directive prompt, adapter pointed at neutrally"),
    ("perturbation-invoked", "directive prompt, adapter pointed at, pair removed"),
    ("n-baseline", "neutral prompt, no adapter"),
    ("n-treatment", "neutral prompt, adapter present"),
    ("n-treatment-invoked", "neutral prompt, adapter pointed at neutrally"),
    ("n-perturbation-invoked", "neutral prompt, adapter pointed at, pair removed"),
]


def parse_jsonl(path):
    tools, final, mcp = [], "", None
    for line in open(path):
        try:
            o = json.loads(line)
        except Exception:
            continue
        if o.get("type") == "system" and o.get("subtype") == "init":
            servers = o.get("mcp_servers") or []
            mcp = servers[0]["status"] if servers else "none"
        if o.get("type") == "assistant":
            for b in o.get("message", {}).get("content", []):
                if b.get("type") == "tool_use":
                    tools.append({"name": b["name"], "input": b.get("input", {})})
        if o.get("type") == "result":
            final = o.get("result", "") or ""
    return tools, final, mcp


def parse_txt(path):
    return [], open(path).read(), "n/a"


def row(arm, path):
    tools, final, mcp = (parse_jsonl if path.endswith(".jsonl") else parse_txt)(path)
    blob = json.dumps(tools)
    return {
        "arm": arm,
        "run": os.path.basename(path).split(".")[0],
        "mcp": mcp,
        "tool_calls": len(tools) if tools else None,
        "adapter_calls": sum(1 for t in tools if ADAPTER_TOOL in t["name"]),
        # Surfaced: the partner appears in the review the host produced.
        "partner_surfaced": PARTNER.split("/")[-1] in final,
        # Inspected: the host opened the partner with its own tools.
        "partner_inspected": PARTNER in blob if tools else None,
        "splitbrain_named": bool(re.search(r"split.?brain", final, re.I)),
        "test_cited": "index.test.ts" in final,
    }


rows = []
for arm, _ in ARMS:
    d = os.path.join(RES, arm)
    if not os.path.isdir(d):
        continue
    for path in sorted(glob.glob(d + "/run-0*.jsonl")) + sorted(glob.glob(d + "/run-0*.txt")):
        if os.path.getsize(path) == 0:
            continue
        rows.append(row(arm, path))

hdr = f"{'arm':<26}{'run':<9}{'mcp':<11}{'tools':>6}{'adapter':>9}{'surfaced':>10}{'inspected':>11}{'splitbrain':>12}{'test':>7}"
print(hdr)
print("-" * len(hdr))
for r in rows:
    print(
        f"{r['arm']:<26}{r['run']:<9}{str(r['mcp']):<11}"
        f"{str(r['tool_calls'] if r['tool_calls'] is not None else '-'):>6}"
        f"{r['adapter_calls']:>9}{str(r['partner_surfaced']):>10}"
        f"{str(r['partner_inspected'] if r['partner_inspected'] is not None else '-'):>11}"
        f"{str(r['splitbrain_named']):>12}{str(r['test_cited']):>7}"
    )

print("\n=== per-arm totals ===")
for arm, desc in ARMS:
    sub = [r for r in rows if r["arm"] == arm]
    if not sub:
        continue
    n = len(sub)
    print(
        f"{arm:<26} n={n}  surfaced={sum(r['partner_surfaced'] for r in sub)}/{n}"
        f"  inspected={sum(1 for r in sub if r['partner_inspected'])}/{n}"
        f"  adapter_calls={sum(r['adapter_calls'] for r in sub)}"
        f"  splitbrain={sum(r['splitbrain_named'] for r in sub)}/{n}   [{desc}]"
    )

json.dump(rows, open(os.path.join(RES, "summary.json"), "w"), indent=2)
print(f"\nwrote {os.path.join(RES,'summary.json')} ({len(rows)} runs)")
