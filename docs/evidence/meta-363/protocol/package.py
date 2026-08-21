#!/usr/bin/env python3
"""Copy the M2B run artifacts into the integrations repo as a durable receipt.

Two things happen on the way in: session-local absolute paths are replaced with
stable placeholders so the packet is reproducible from public inputs, and every
file is enumerated with its SHA-256 so the packet can be checked against the
commit that carries it.
"""
import json, hashlib, os, re, shutil

SRC = "<WORKDIR>"
DEST = "<INTEGRATIONS>/docs/evidence/meta-363"

# Session-local paths carry a per-session UUID and a tmp prefix. Neither is
# reproducible, and neither is part of the experiment.
REDACTIONS = [
    (re.compile(re.escape(SRC + "/repo-perturbed")), "<REPO_PERTURBED>"),
    (re.compile(re.escape(SRC + "/repo-malformed")), "<REPO_MALFORMED>"),
    (re.compile(re.escape(SRC + "/repo-absent")), "<REPO_ABSENT>"),
    (re.compile(re.escape(SRC + "/repo")), "<REPO>"),
    (re.compile(re.escape(SRC)), "<WORKDIR>"),
    (re.compile(r"<INTEGRATIONS>"), "<INTEGRATIONS>"),
    (re.compile(r"<HOME>"), "<HOME>"),
]


def scrub(text):
    for pattern, replacement in REDACTIONS:
        text = pattern.sub(replacement, text)
    return text


def copy_scrubbed(src, dst):
    os.makedirs(os.path.dirname(dst), exist_ok=True)
    with open(src, encoding="utf-8", errors="replace") as fh:
        body = fh.read()
    with open(dst, "w", encoding="utf-8") as fh:
        fh.write(scrub(body))


if os.path.isdir(DEST):
    shutil.rmtree(DEST)

for name in ["run.sh", "run2.sh", "run3.sh", "degraded.mjs", "analyze.py", "package.py", "changed.diff"]:
    copy_scrubbed(f"{SRC}/{name}", f"{DEST}/protocol/{name}")

copied = 0
for arm in sorted(os.listdir(f"{SRC}/results")):
    armdir = f"{SRC}/results/{arm}"
    if not os.path.isdir(armdir):
        continue
    for name in sorted(os.listdir(armdir)):
        path = f"{armdir}/{name}"
        if not os.path.isfile(path) or os.path.getsize(path) == 0 or name.endswith(".err"):
            continue
        copy_scrubbed(path, f"{DEST}/runs/{arm}/{name}")
        copied += 1

if os.path.exists(f"{SRC}/results/summary.json"):
    copy_scrubbed(f"{SRC}/results/summary.json", f"{DEST}/summary.json")
if os.path.exists(f"{SRC}/degraded-output.txt"):
    copy_scrubbed(f"{SRC}/degraded-output.txt", f"{DEST}/degraded-controls.txt")
if os.path.exists(f"{SRC}/lifecycle-output.txt"):
    copy_scrubbed(f"{SRC}/lifecycle-output.txt", f"{DEST}/lifecycle-verification.txt")

print(f"copied {copied} run files")

files = []
for root, _, names in os.walk(DEST):
    for name in sorted(names):
        if name == "MANIFEST.json":
            continue
        full = os.path.join(root, name)
        with open(full, "rb") as fh:
            digest = hashlib.sha256(fh.read()).hexdigest()
        files.append({"path": os.path.relpath(full, DEST), "sha256": digest, "bytes": os.path.getsize(full)})
files.sort(key=lambda f: f["path"])

json.dump(
    {
        "experiment": "META-363 / M2B native evidence integration",
        "host": {"name": "Claude Code", "version": "2.1.238", "model": "claude-sonnet-5"},
        "adapter": {
            "repository": "workspacejson/integrations",
            "surface": "MCP stdio server, tool workspace_review_evidence",
            "entrypoint": "dist/claude-code/server.js",
            "version": "0.1.0",
        },
        "evidenceRepository": {
            "repository": "workspacejson/standard",
            "revision": "a034339ddb3a0482ede258cb57cef828c15e26eb",
            "artifact": ".agents/workspace.json",
            "artifactSha256": "9fff32e0c015a7ffc3411342afa4374e5fc63db3cd1c53c8618233b8cf92c81b",
            "artifactBasisRevision": "8e08c8c5cd110e7f95bbd52246ea295c22b072e3",
            "producer": "@workspacejson/cli@0.5.2",
            "specVersion": "0.4",
        },
        "registeredScenario": {
            "changedFile": "packages/spec/src/schema.ts",
            "partner": "packages/spec/schema/v1.json",
            "support": 10,
            "occurrences": 11,
            "consequence": "packages/spec/src/index.test.ts:324 asserts top-level property keys match between the two schema mirrors",
        },
        "redactedPatterns": [r.pattern for r, _ in REDACTIONS],
        "fileCount": len(files),
        "files": files,
    },
    open(f"{DEST}/MANIFEST.json", "w"),
    indent=2,
)
print(f"MANIFEST.json: {len(files)} files")
