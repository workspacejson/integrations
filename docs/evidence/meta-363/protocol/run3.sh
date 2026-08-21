#!/usr/bin/env bash
# M2B neutral-prompt arms (META-363).
#
# The first prompt told the reviewer "if a claim rests on a file that is not in
# the diff, open that file and confirm it before reporting." That instruction
# actively pushes exploration beyond the diff, so it may have handed baseline the
# partner file by itself. These arms drop that sentence, leaving a plain review
# ask, so any advantage the evidence has is not competing against an instruction
# that already does the evidence's job.
set -u

SP="$(cd "$(dirname "$0")" && pwd)"
OUT="$SP/results"
RUNS="${RUNS:-3}"
MODEL="claude-sonnet-5"
ADAPTER="<INTEGRATIONS>/dist/claude-code/server.js"
TOOLS="Read,Grep,Glob,Bash(git diff:*),Bash(git log:*),Bash(git show:*),mcp__workspacejson-review-evidence__workspace_review_evidence"

read -r -d '' NEUTRAL <<'EOF' || true
Review the following diff for correctness problems. Report any problem you find,
citing the file and line that establishes it. If you find no problem, say so.

Finish with a section titled "FILES INSPECTED" listing every file you opened.
EOF

NUDGE="Repository-history context for the changed files is available from the connected MCP tools; consult it if you find it useful."

run_arm() {
  local arm="$1" repo="$2" use_mcp="$3" extra="$4"
  mkdir -p "$OUT/$arm"
  local cfg=()
  if [ "$use_mcp" = "yes" ]; then
    cat > "$OUT/$arm/mcp.json" <<JSON
{"mcpServers":{"workspacejson-review-evidence":{"command":"node","args":["$ADAPTER"],"env":{"WORKSPACE_JSON_ROOT":"$repo"}}}}
JSON
    cfg=(--mcp-config "$OUT/$arm/mcp.json")
  fi
  for i in $(seq 1 "$RUNS"); do
    local dest="$OUT/$arm/run-0$i.jsonl"
    [ -s "$dest" ] && { echo "  [$arm run-0$i] cached"; continue; }
    ( cd "$repo" && printf '%s\n%s\n\n--- DIFF ---\n%s\n' "$NEUTRAL" "$extra" "$(cat "$SP/changed.diff")" \
      | claude -p --model "$MODEL" --strict-mcp-config "${cfg[@]}" \
          --allowedTools "$TOOLS" --permission-mode dontAsk \
          --output-format stream-json --verbose ) > "$dest" 2>/dev/null
    echo "  [$arm run-0$i] exit=$? lines=$(wc -l <"$dest" | tr -d ' ')"
  done
}

echo "== n-baseline (neutral prompt, no adapter) =="
run_arm n-baseline          "$SP/repo"           no  ""
echo "== n-treatment (neutral prompt, adapter present, not mentioned) =="
run_arm n-treatment         "$SP/repo"           yes ""
echo "== n-treatment-invoked (neutral prompt, adapter pointed at) =="
run_arm n-treatment-invoked "$SP/repo"           yes "$NUDGE"
echo "== n-perturbation-invoked (neutral prompt, registered pair removed) =="
run_arm n-perturbation-invoked "$SP/repo-perturbed" yes "$NUDGE"
