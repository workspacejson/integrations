#!/usr/bin/env bash
# META-373 C4 — A0 baseline admission screening, CORRECTED ARM.
# Identical to run-a0.sh in diff, prompt bytes, model, tools, permission mode
# and host. The only change is profile isolation: CLAUDE_CONFIG_DIR points at a
# provisioned fresh directory, per SUCCESSOR-FREEZE.md.
#
# Doppler resolves project/config from the working directory, so it is invoked
# from the Doppler-scoped directory and the inner shell changes into the pinned
# worktree. The credential is injected as an env var and never printed.
set -u
SP="$(cd "$(dirname "$0")" && pwd)"
OUT="$SP/a0-isolated"; mkdir -p "$OUT"
RUNS="${RUNS:-5}"
MODEL="claude-sonnet-5"
TOOLS="Read,Grep,Glob,Bash(git diff:*),Bash(git log:*),Bash(git show:*)"
SCOPE_DIR="${SCOPE_DIR:?set to the Doppler-scoped directory}"

for i in $(seq 1 "$RUNS"); do
  dest="$OUT/run-0$i.jsonl"
  [ -s "$dest" ] && { echo "  [run-0$i] cached"; continue; }
  ( cd "$SCOPE_DIR" && doppler run --only-secrets ANTHROPIC_API_KEY -- \
      bash -c 'cd "$1" && CLAUDE_CONFIG_DIR="$2" claude -p --model "$3" \
        --strict-mcp-config --allowedTools "$4" --permission-mode dontAsk \
        --output-format stream-json --verbose < "$5"' \
      _ "$SP/repo" "$SP/cfg2" "$MODEL" "$TOOLS" "$SP/prompt.txt" ) > "$dest" 2>/dev/null
  echo "  [run-0$i] exit=$? lines=$(wc -l <"$dest" | tr -d ' ')"
done
echo DONE
