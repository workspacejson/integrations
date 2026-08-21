# Claude Code review-evidence adapter

An optional MCP server that offers Claude Code's existing review workflow one
extra piece of context: which files in this repository have historically changed
in the same commits as the files under review.

It is not a reviewer. It reports no findings, no verdicts, no severities, and no
recommendations. Claude Code keeps the whole review workflow; this adapter only
answers a question when asked.

## What it reports

Given the paths a diff touches, the adapter reads the workspace.json artifact
produced by [`@workspacejson/cli`](https://www.npmjs.com/package/@workspacejson/cli)
and returns, for each path:

- the files recorded as co-changing with it, with the `support` and
  `occurrences` counts **verbatim** from the artifact;
- the artifact's provenance — producer, spec version, generation time, and the
  `basisRevision` the evidence is bound to;
- whether that basis revision still matches the repository's current revision.

Co-change is a **symmetric historical observation**: these two files appeared in
the same commit N of M times, as of a named revision. It is not a dependency, a
cause, a required change, a blast radius, a recommendation, or a risk score, and
the adapter will not describe it as one. A named partner file is a candidate to
look at, nothing more — if it matters, Claude Code opens it and verifies that
for itself.

The adapter performs no repository mining. Every number it reports was computed
by the CLI and written into the artifact; the adapter reads fields and formats
them for the host.

## Requirements

- Node.js >= 20
- A workspace.json artifact in the repository, at `.agents/workspace.json`
  (canonical), `.workspace.json`, or `workspace.json`. Generate one with
  `npx @workspacejson/cli generate`.

The adapter is a stdio MCP server spawned by the host for the duration of a
session. There is no daemon and no service to run.

## Install

```bash
npm install && npm run build
claude mcp add workspacejson-review-evidence -- node "$PWD/dist/claude-code/server.js"
```

Confirm it is connected:

```bash
claude mcp list
```

To scope it to one project instead of your user config, add `--scope project`,
which writes the server into that repository's `.mcp.json`.

## Remove

```bash
claude mcp remove workspacejson-review-evidence
```

Removal is complete: the adapter holds no state, writes nothing, and leaves no
configuration behind. Claude Code returns to exactly its prior review behavior,
and the repository is untouched — the workspace.json artifact belongs to the
repository and to the CLI, not to this adapter.

## Configuration

| Variable | Meaning |
| -- | -- |
| `WORKSPACE_JSON_PATH` | Explicit path to a workspace.json file. |
| `WORKSPACE_JSON_ROOT` | Directory to search upward from (default: the process working directory). The walk stops at the nearest Git boundary, so evidence is never read from an ancestor repository. |

## Degraded evidence

Absent, unindexed, stale, or unreadable evidence is reported as exactly that. It
is never converted into a statement that a change is safe — the adapter has no
vocabulary for approval.

| Condition | Behavior |
| -- | -- |
| No artifact found | Error result naming the paths searched: "an absence of evidence, not an absence of risk". |
| Artifact unparseable or not a JSON object | Error result naming the parse failure. Never an empty success. |
| `basisRevision` behind the repository's HEAD | `Freshness: STALE`, naming both revisions and stating that later commits are not reflected, so a missing partner is not evidence that no partner exists. |
| `basisRevision` absent, or HEAD unreadable | `Freshness: UNKNOWN`. Never reported as current. |
| Path absent from the artifact's file index | `file-not-indexed` — the path may be new, moved, or outside the indexed root. |
| Path indexed but with no recorded partners | `no-recorded-co-change` — an absence of recorded history, not a statement about the change. |
| Absolute path not provably inside the repository root | Refused as unmatched rather than resolved by a nearest guess. |

## Ownership boundary

| Concern | Owner |
| -- | -- |
| Mining co-change history, computing `support`/`occurrences`, writing the artifact | `@workspacejson/cli` |
| Artifact shape and schema | `@workspacejson/spec` (the workspace.json standard) |
| Reading the artifact and shaping it for one host | this adapter (`workspacejson/integrations`) |
| Deciding what to review, what to open, and what to conclude | Claude Code |

The adapter adds no semantics to the standard and duplicates no CLI
intelligence. It is deliberately separate from this repository's Codex surface,
which emits an enforcement decision (`deny`/`warn`/`annotate`); this adapter has
no such vocabulary, because telling the host what to decide is exactly what it
must not do.
