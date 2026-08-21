#!/usr/bin/env bash
# META-373 candidate C4 — A0 baseline admission screening.
# Config is M2B's n-baseline arm verbatim (protocol/run3.sh), no adapter,
# no MCP server, neutral prompt.
set -u
SP="$(cd "$(dirname "$0")" && pwd)"
OUT="$SP/a0"; mkdir -p "$OUT"
RUNS="${RUNS:-5}"
MODEL="claude-sonnet-5"
TOOLS="Read,Grep,Glob,Bash(git diff:*),Bash(git log:*),Bash(git show:*)"

read -r -d '' NEUTRAL <<'EOF' || true
Review the following diff for correctness problems. Report any problem you find,
citing the file and line that establishes it. If you find no problem, say so.

Finish with a section titled "FILES INSPECTED" listing every file you opened.
EOF

for i in $(seq 1 "$RUNS"); do
  dest="$OUT/run-0$i.jsonl"
  [ -s "$dest" ] && { echo "  [run-0$i] cached"; continue; }
  ( cd "$SP/repo" && printf '%s\n\n--- DIFF ---\n%s\n' "$NEUTRAL" "$(cat "$SP/changed.diff")" \
    | claude -p --model "$MODEL" --strict-mcp-config \
        --allowedTools "$TOOLS" --permission-mode dontAsk \
        --output-format stream-json --verbose ) > "$dest" 2>/dev/null
  echo "  [run-0$i] exit=$? lines=$(wc -l <"$dest" | tr -d ' ')"
done
echo DONE
