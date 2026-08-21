#!/usr/bin/env bash
# M2B follow-up arms (META-363).
#
# The first pass showed the host never invoked the adapter. These two arms
# separate the two things that failure could mean:
#
#   treatment-instrumented — identical to the treatment arm, but with tool calls
#     recorded, to measure how often the host reaches for an available-but-
#     unrequested optional tool.
#
#   treatment-invoked — the same review, plus one neutral sentence saying that
#     repository-history context is available from the connected MCP tools. It
#     names no file and no relationship, so it puts the evidence INTO the
#     workflow without supplying the answer. This measures whether the evidence
#     changes anything once it genuinely arrives.
set -u

SP="$(cd "$(dirname "$0")" && pwd)"
OUT="$SP/results"
RUNS="${RUNS:-3}"
MODEL="claude-sonnet-5"
TOOLS="Read,Grep,Glob,Bash(git diff:*),Bash(git log:*),Bash(git show:*),mcp__workspacejson-review-evidence__workspace_review_evidence"

read -r -d '' BASE <<'EOF' || true
You are reviewing a proposed change to this repository. The diff is below.

Identify any correctness problem this change introduces. For every problem you
report, name the specific file and line you inspected that establishes it. If a
claim rests on a file that is not in the diff, open that file and confirm it
before reporting. If you find no problem, say so.

Finish with a section titled "FILES INSPECTED" listing every file you opened.
EOF

NUDGE="Repository-history context for the changed files is available from the connected MCP tools; consult it if you find it useful."

run_arm() {
  local arm="$1" repo="$2" extra="$3"
  mkdir -p "$OUT/$arm"
  cat > "$OUT/$arm/mcp.json" <<JSON
{"mcpServers":{"workspacejson-review-evidence":{"command":"node","args":["<INTEGRATIONS>/dist/claude-code/server.js"],"env":{"WORKSPACE_JSON_ROOT":"$repo"}}}}
JSON
  for i in $(seq 1 "$RUNS"); do
    local dest="$OUT/$arm/run-0$i.jsonl"
    [ -s "$dest" ] && { echo "  [$arm run-0$i] cached"; continue; }
    ( cd "$repo" && printf '%s\n%s\n\n--- DIFF ---\n%s\n' "$BASE" "$extra" "$(cat "$SP/changed.diff")" \
      | claude -p --model "$MODEL" --strict-mcp-config --mcp-config "$OUT/$arm/mcp.json" \
          --allowedTools "$TOOLS" --permission-mode dontAsk \
          --output-format stream-json --verbose ) > "$dest" 2>/dev/null
    echo "  [$arm run-0$i] exit=$? lines=$(wc -l <"$dest" | tr -d ' ')"
  done
}

echo "== treatment-instrumented (tool available, not mentioned) =="
run_arm treatment-instrumented "$SP/repo" ""
echo "== treatment-invoked (tool available and pointed at, neutrally) =="
run_arm treatment-invoked      "$SP/repo" "$NUDGE"
echo "== perturbation-invoked (registered pair removed, tool pointed at) =="
run_arm perturbation-invoked   "$SP/repo-perturbed" "$NUDGE"
