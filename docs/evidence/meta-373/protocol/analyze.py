#!/usr/bin/env python3
"""META-373 C4 baseline discovery analysis. Criteria frozen in CANDIDATE-C4.md."""
import json, re, sys, pathlib

PARTNER_PATH = "user_input/core.clj"
PARTNER_NAMES = ["user_input/core.clj", "user-input", "user_input", "extract-arguments"]
CONSEQ = [r"never (set|produced|populated|bound|assigned)", r"always (be )?nil",
          r"\bnil\b", r"no effect", r"silently", r"never .*(true|set)",
          r"not (be )?(parsed|produced|recognis|recogniz|wired)", r"wire", r"has no effect"]
GROUND = [r"extract-arguments", r"ordered-map", r"named-args", r"args\.clj", r"key-name"]

def runs(p):
    for line in open(p, encoding="utf8", errors="replace"):
        line=line.strip()
        if not line: continue
        try: yield json.loads(line)
        except Exception: pass

def analyse(p):
    files_read=set(); grep_terms=[]; final=""; tools=[]
    for ev in runs(p):
        t=ev.get("type")
        if t=="assistant":
            for c in ev.get("message",{}).get("content",[]):
                if c.get("type")=="tool_use":
                    n=c.get("name"); i=c.get("input",{}) or {}
                    tools.append(n)
                    if n in ("Read","NotebookRead"):
                        fp=i.get("file_path") or ""
                        files_read.add(fp)
                    elif n=="Grep":
                        grep_terms.append(i.get("pattern",""))
                        if i.get("path"): files_read.add(str(i.get("path")))
                    elif n=="Bash":
                        grep_terms.append(i.get("command",""))
        elif t=="result":
            final=ev.get("result","") or ""
    opened = any(PARTNER_PATH in f for f in files_read)
    named  = any(re.search(re.escape(n), final) for n in PARTNER_NAMES)
    conseq = any(re.search(r, final, re.I) for r in CONSEQ)
    ground = any(re.search(r, final, re.I) for r in GROUND)
    return dict(file=p.name, tool_calls=len(tools), files_read=len(files_read),
                partner_opened=opened, partner_named=named,
                consequence_stated=conseq, consequence_grounded=ground,
                discovery=(named and opened and conseq),
                read_list=sorted(files_read), final=final)

if __name__=="__main__":
    d=pathlib.Path(sys.argv[1])
    res=[analyse(p) for p in sorted(d.glob("run-*.jsonl"))]
    for r in res:
        print(f"{r['file']}: tools={r['tool_calls']:3d} files={r['files_read']:2d} "
              f"named={int(r['partner_named'])} opened={int(r['partner_opened'])} "
              f"conseq={int(r['consequence_stated'])} grounded={int(r['consequence_grounded'])} "
              f"=> DISCOVERY={int(r['discovery'])}")
    print(f"\nDISCOVERY {sum(r['discovery'] for r in res)}/{len(res)}")
    json.dump(res, open(d.parent/"a0-analysis.json","w"), indent=2)
