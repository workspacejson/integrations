#!/usr/bin/env bash
# M2B baseline/treatment harness (META-363).
#
# Everything is held constant across arms except the presence of the workspace.json
# evidence adapter: same repository revision, same diff, same host version, same
# prompt, same model, same allowed native tools. The ONLY difference between
# baseline and treatment is whether --mcp-config supplies the adapter.
set -u

SP="$(cd "$(dirname "$0")" && pwd)"
ADAPTER="<INTEGRATIONS>/dist/claude-code/server.js"
MODEL="claude-sonnet-5"
RUNS="${RUNS:-3}"
OUT="$SP/results"
mkdir -p "$OUT"

# Identical in every arm. Says nothing about workspace.json, co-change, or any
# particular file — a treatment effect must come from the evidence, not the ask.
read -r -d '' PROMPT <<'EOF' || true
You are reviewing a proposed change to this repository. The diff is below.

Identify any correctness problem this change introduces. For every problem you
report, name the specific file and line you inspected that establishes it. If a
claim rests on a file that is not in the diff, open that file and confirm it
before reporting. If you find no problem, say so.

Finish with a section titled "FILES INSPECTED" listing every file you opened.

--- DIFF ---
EOF

mcp_config() {
  cat <<JSON
{"mcpServers":{"workspacejson-review-evidence":{"command":"node","args":["$ADAPTER"],"env":{"WORKSPACE_JSON_ROOT":"$1"}}}}
JSON
}

# Same allowlist in every arm. The adapter tool is named in baseline too, where
# it simply does not exist, so the allowlist itself is not a difference.
TOOLS="Read,Grep,Glob,Bash(git diff:*),Bash(git log:*),Bash(git show:*),mcp__workspacejson-review-evidence__workspace_review_evidence"

run_arm() {
  local arm="$1" repo="$2" use_mcp="$3"
  mkdir -p "$OUT/$arm"
  for i in $(seq 1 "$RUNS"); do
    local dest="$OUT/$arm/run-0$i.txt"
    [ -s "$dest" ] && { echo "  [$arm run-0$i] cached"; continue; }
    local cfg=()
    if [ "$use_mcp" = "yes" ]; then
      mcp_config "$repo" > "$OUT/$arm/mcp.json"
      cfg=(--mcp-config "$OUT/$arm/mcp.json")
    fi
    ( cd "$repo" && printf '%s\n%s\n' "$PROMPT" "$(cat "$SP/changed.diff")" \
      | claude -p --model "$MODEL" --strict-mcp-config "${cfg[@]}" \
          --allowedTools "$TOOLS" --permission-mode dontAsk ) > "$dest" 2>"$OUT/$arm/run-0$i.err"
    echo "  [$arm run-0$i] exit=$? bytes=$(wc -c <"$dest" | tr -d ' ')"
  done
}

echo "== baseline (no adapter) =="
run_arm baseline      "$SP/repo"            no
echo "== treatment (adapter, full evidence) =="
run_arm treatment     "$SP/repo"            yes
echo "== perturbation (adapter, registered pair removed) =="
run_arm perturbation  "$SP/repo-perturbed"  yes
