# META-373 — bounded search for a historical-evidence fixture with measured baseline headroom

**Date:** 2026-08-21 (UTC). **Issue:** META-373 (research gate for M2B's successor).
**Disposition:** **BOUNDED_SEARCH_EXHAUSTED** — no admissible fixture.

> This directory is a research receipt. It is not normative workspace.json
> specification semantics, a conformance requirement, an adoption claim, or a
> claim that these results generalize beyond the repositories, revisions and
> single host tested here.

## Objective

Find one natural repository change scenario where revision-bound workspace.json
historical evidence surfaces a consequential relationship that the pinned,
filesystem-capable Claude baseline does not reliably discover unaided.

Admission required **measured** baseline failure: n >= 5 runs, all missing the
registered consequence. Structural screening could narrow candidates but never
admit one. A single baseline discovery rejects a candidate permanently.

The successor delivery experiment (`../meta-363/SUCCESSOR-FREEZE.md`, arms
A0–A5) was **not** executed. A0 appears here only as the admission measurement.

## Candidate budget — declared before screening

| | |
| -- | -- |
| External repositories inspected | <= 3 |
| Candidate relationships deep-screened | <= 5 total |
| Stop rule | immediately on first admission |

Existing corpus was used rather than a new mining program: the three artifacts
pinned in `workspacejson/standard@a034339` `docs/evidence/meta-310/`, with the
matching clones already at those revisions. No repository was mined, modified,
or contributed to. No artifact was regenerated.

| Repository | Pinned revision | Artifact | Artifact `sha256` |
| -- | -- | -- | -- |
| `polyfy/polylith` | `68dab9868274c8044817983c2424fbdbd616a456` | `polylith.workspace.json` | `848540525a7b20842105eea5b62024604580fb63ad615b5d962c49d6e5e82c8a` |
| `JamieMason/syncpack` | `958d30689ac24b60623258630242330bd6d0264b` | `syncpack.workspace.json` | `3d3d435ad0e3e00eff7abdb2f90fa4ed88d764e7cd38930fc966104a7e911222` |
| `formatjs/formatjs` | `27c29bf9a40a50dac232a159b8790dbd14732c57` | `formatjs.workspace.json` | `3ed91cffb26498e4cf930e8388e8e25da369ba5e623718f68d709309f6d6643a` |

FormatJS was not screened for candidates. META-310 already recorded that all 50
of its emitted pairs are release and dependency plumbing with **no source file
at either endpoint**, so it offers no review-relevant relationship. That is a
reuse of a pinned prior result, not a new judgement.

## Candidates screened — 5 of 5, one measured

| # | Repository | Changed file | Registered partner | support / occ | Outcome |
| -- | -- | -- | -- | -- | -- |
| C1 | polylith | `doc/commands.adoc` | `scripts/output/help/help.txt` | 28 / 35 | REJECT (screen) |
| C2 | syncpack | `src/main.rs` | `src/test/builder.rs` | 10 / 44 | REJECT (screen) |
| C3 | syncpack | `src/commands/lint.rs` | `src/commands/list.rs` | 10 / 10 | REJECT (screen) |
| C4 | polylith | `components/command/src/polylith/clj/core/command/core.clj` | `components/user-input/src/polylith/clj/core/user_input/core.clj` | 14 / 35 | **REJECT (measured, 3/5)** |
| C5 | polylith | `examples/doc-example/ws.edn` | `scripts/output/local-dep/ws.edn` | 29 / 37 | REJECT (screen) |

Every co-change relationship above is **a symmetric historical observation**. It
is not a dependency, not causality, not a required change, not blast radius, not
a recommendation, not a risk score, and not correctness evidence.

### C1 — generated documentation mirror

`doc/commands.adoc` is generated from `scripts/output/help/*.txt` by
`scripts/help.clj:update-command-doc`, which `spit`s the concatenation. A hand
edit to the `.adoc` is overwritten on regeneration — a real consequence.

**Rejected on a current-source comment.** `doc/commands.adoc:4` reads
`// This code is generated (do not update manually).` Any reviewer opening the
changed file sees the disqualifying fact on line 4 without leaving it.

### C2 — production entrypoint and test harness

`src/test/builder.rs` re-implements the `inspect` stage of `src/syncpack.rs`
(`build_and_visit_packages` -> `visit_packages`, `build_and_visit_formatting` ->
`visit_formatting`), so the test harness mirrors the production pipeline with no
import edge to it. That is a genuine mirror relationship.

**Rejected on absent consequence.** The registered pair is `main.rs` <->
`builder.rs`, not `syncpack.rs` <-> `builder.rs`, and `syncpack.rs` appears in no
pair in the artifact. `main.rs` holds only `mod` declarations and runtime wiring;
no natural single-file change to it produces a verifiable consequence in
`builder.rs`. Support 10 against 44 occurrences is consistent with co-change
driven by repository-wide refactors rather than a design coupling.

### C3 — sibling command modules

The strongest structural shape in the corpus: support 10 of 10 occurrences, no
import edge in either direction, no filename reference either way, each module
registered independently through `mod commands;`. META-310 verified the
no-import-edge property directly.

**Rejected on a one-hop lexical bridge.** `lint.rs`, `list.rs` and `json.rs`
carry the byte-identical exit-code predicate
`matches!(action, InstanceAction::Render(Severity::Error) | InstanceAction::Fix(_))`
and the same `SyncpackError::IssuesFound`. Any diff whose consequence is the
divergence of that contract must touch those tokens, and `grep IssuesFound`
returns both partners immediately.

### C5 — paired generated workspace snapshots

Both files are regenerated together by `scripts/create_example.clj`, which is why
they co-change.

**Rejected because inspecting the partner does not expose an objectively
verifiable consequence relevant to the review task.** The two snapshots describe
different example workspaces (`user`/`user-remote` versus
`database`/`datomic-ions`), so opening one establishes no checkable fact about a
change to the other. Shared basename `ws.edn` is an additional bridge.

*Wording corrected 2026-08-21: the original rejection was phrased causally
("symptom, not the cause"). The criterion is not causal and the phrasing is
replaced above. The rejection itself is unchanged.*

## C4 — the measured candidate

Frozen in full at `CANDIDATE-C4.md` **before any baseline run**. Summary:

| | |
| -- | -- |
| Repository | `polyfy/polylith` @ `68dab9868274c8044817983c2424fbdbd616a456` |
| Artifact | `polylith.workspace.json` (META-310), `sha256 848540525a7b…` |
| `generated.basisRevision` | `68dab986…` — **equal to the reviewed revision, so evidence was fresh, not stale** |
| Producer | `@workspacejson/cli@0.5.2` |
| Changed file | `components/command/src/polylith/clj/core/command/core.clj` |
| Registered partner | `components/user-input/src/polylith/clj/core/user_input/core.clj` |
| `support` / `occurrences` | 14 / 35 |
| Partners registered for the changed file | exactly 1 |

**Diff.** Single-file change adding a `:quiet` flag that suppresses the `::`
deprecation message: `is-quiet` joins `execute`'s `:keys` destructuring and
guards `print-deprecation-message`.

**Preregistered consequence.** `is-quiet` is never produced.
`user_input/core.clj:extract-arguments` builds the user-input map from a closed
`{:keys [...]}` enumeration of `named-args` containing no `quiet!`, and a closed
`util/ordered-map` containing no `:is-quiet`. The flag is therefore always `nil`
and silently does nothing.

Verified independently of the co-change observation: a repository-wide search for
`is-quiet` / `:quiet` / `quiet!` over `*.clj`, `*.edn`, `*.adoc` and `*.md` at the
reviewed revision returns zero hits, and `args.clj:key-name` maps CLI `:quiet` to
the named-arg key `:quiet!`, which the destructuring does not bind. The co-change
relationship was not used as proof of the consequence.

**Bridges recorded before running.** A one-hop lexical bridge was found and
written down in advance: the token `is-search-for-ws-dir` appears on *both*
changed lines and occurs at the registered partner,
`user_input/core.clj:154`. Every other key on the changed destructuring line
bridges the same way. Absent bridges: no `:require` edge either direction, no
path/filename/basename reference, different components, no directory adjacency,
no comment naming the other, and an indirect caller chain
(`command/core.clj` <- `command/interface.clj` <- `bases/poly-cli/core.clj` ->
`user-input.interface` -> `user_input/core.clj`).

### Baseline configuration

M2B's `n-baseline` arm verbatim (`../meta-363/protocol/run3.sh`): same revision,
diff, prompt, model, permission mode and native tools on every run.

| | |
| -- | -- |
| Host | Claude Code 2.1.238 |
| Model | `claude-sonnet-5` |
| Tools | `Read,Grep,Glob,Bash(git diff:*),Bash(git log:*),Bash(git show:*)` |
| MCP | none — `--strict-mcp-config`, no adapter, no hook, no evidence injection |
| Permission mode | `dontAsk` |
| Transcripts | `--output-format stream-json --verbose` |
| Prompt | neutral variant, unchanged; contains no instruction toward history, co-change, or the partner |
| Repository | clean detached worktree at the pinned revision; diff supplied as text, not applied |

**Deviation from the frozen design, recorded.** `SUCCESSOR-FREEZE.md` requires
`CLAUDE_CONFIG_DIR` profile isolation. A fresh config directory returned
`Not logged in`, exactly as the freeze predicted, and credentials were not
provisioned. These runs therefore used the default profile — the same conditions
under which M2B's own baseline was measured.

The direction of that confound is conservative for admission: the default profile
loads global instructions favouring broad exploration, which biases the baseline
toward *finding* the partner. It cannot manufacture a miss. It could in principle
manufacture a find, so it is worth noting that it did not do so here by any
elaborate route: baseline reached the consequence in 4–8 tool calls having read
1–3 files, through the identifier bridge screened in advance. Isolation would not
plausibly change that.

### Result — 5 runs

Sub-criteria kept separately observable, never collapsed.

| Run | tool calls | files read | partner named | partner opened (`Read`) | partner path cited | consequence stated | consequence grounded | strict discovery |
| -- | -- | -- | -- | -- | -- | -- | -- | -- |
| 01 | 5 | 2 | yes | yes | yes | yes | yes | **yes** |
| 02 | 7 | 2 | yes | yes | yes | yes | yes | **yes** |
| 03 | 4 | 1 | yes | no (via `Grep`) | yes | yes | no | no |
| 04 | 5 | 2 | yes | no (via `Grep`) | yes | yes | no | no |
| 05 | 8 | 3 | yes | yes | yes | yes | yes | **yes** |

**Strict discovery (named AND opened AND consequence stated): 3/5.**
**Registered consequence stated: 5/5. Registered partner path cited by name: 5/5.**

Admission required 0/5. **C4 is rejected**, and not marginally: under the strict
preregistered criterion 3 of 5, and under any reading of §10 that credits reaching
the consequence by a different path, 5 of 5.

Run 03 is the clearest illustration and names the screened bridge itself:

> `is-quiet` is destructured from `user-input` but nothing in the codebase ever
> sets `:is-quiet` on that map (confirmed via search — no CLI flag parsing, no
> other producer of `:is-quiet` anywhere in the repo, unlike
> `:is-search-for-ws-dir` which is set in
> `components/user-input/src/polylith/clj/core/user_input/core.clj:154`).

The screen predicted the exact mechanism of the rejection before the runs
executed. That is a point in favour of the screen as a *narrowing* instrument and
changes nothing about its inability to admit.

C4 was not rerun, its prompt was not edited, its consequence was not weakened, and
no partner was substituted.

## Efficiency observations — exploratory only, not used for admission

Recorded because META-373 permits it, and explicitly **not** an admission input.
Baseline used 4–8 tool calls and opened 1–3 files per run. META-373 is about
discovery headroom, not efficiency headroom; a fixture may not be admitted because
evidence might make an already-successful baseline faster.

## What this does and does not establish

**Established:**

1. Within this bounded search — 3 pinned external repositories, 150 registered
   pairs, 5 deep-screened candidates, 1 carried to measurement — **no fixture with
   measured baseline headroom was found.**
2. On the one candidate measured, a filesystem-capable baseline reached the
   registered consequence in every run, from a fresh (not stale) artifact's
   best-shaped available relationship, using 4–8 tool calls.
3. A recurring structural reason is visible across C1, C3 and C4: in this corpus,
   registered pairs that carry a crisp verifiable consequence are coupled through
   a **shared named symbol** — a config key, an exit-code predicate, generated
   prose — and a symbol-sharing coupling is precisely what `grep` resolves in one
   hop. The pairs that share no symbol (C2, C5) are refactor- or
   regeneration-driven and carry no locatable consequence.

**Not established:**

1. That workspace.json historical evidence has no value. One bounded search over
   three repositories does not show that.
2. That historical evidence never helps review. Four of five candidates were
   rejected on structure, not on measurement; structural rejection shows a
   candidate was obviously bridged, not that headroom is absent.
3. That no headroom-positive fixture exists in these repositories. The artifacts
   are cap-bound top-50 of 713 / 729 / 1,658 qualifying pairs, so most of the
   qualifying population was never examined.
4. Any claim about hosts, models, delivery modes or repositories not tested here.
5. Anything about the M2B successor's remaining questions. Deferral (A1 vs A2) and
   description (A2 vs A3) are untouched by this result and remain unmeasured.

## Bearing on the review wedge

The gate stands: no successor delivery arm may execute before a headroom-positive
fixture is admitted, and none was. The honest reading is narrower than "the
evidence is useless" and wider than "we picked badly": the *code-review wedge*
requires a fixture where a filesystem-capable agent reliably fails, and this
search did not produce one from the most promising material available.

Recommendation is `RECONSIDER_CODE_REVIEW_WEDGE`, not `RUN_FROZEN_SUCCESSOR_EXPERIMENT`.
That decision is not executed here.

## Reproducing

```bash
git -C <polylith-clone> worktree add --detach <workdir>/repo 68dab9868274c8044817983c2424fbdbd616a456
bash protocol/run-a0.sh
python3 protocol/analyze.py <workdir>/a0
```

`MANIFEST.json` carries a SHA-256 for every file. Session-local absolute paths in
the transcripts were replaced with `<REPO>`, `<WORKDIR>`, `<CLONES>` and `<HOME>`.
No credentials appear in these artifacts.

---

# Corrective verification — C4 under profile isolation (2026-08-21)

Added after the result above. **Nothing above is rewritten.** The original arm and
its recorded deviation stand as historical evidence; this section appends the
corrected measurement.

## Why

The original C4 measurement carried one recorded deviation from
`../meta-363/SUCCESSOR-FREEZE.md`: it ran on the default profile, because a fresh
`CLAUDE_CONFIG_DIR` returned `Not logged in` and credentials were not provisioned.
This corrects exactly that, and only that.

## What changed, and what did not

Changed: `CLAUDE_CONFIG_DIR` points at a provisioned fresh directory, and the
credential is injected from the authorized Doppler-scoped store as
`ANTHROPIC_API_KEY`, never printed and never written to any artifact.

Unchanged and verified byte-identical or field-identical: repository and revision
(`68dab986…`, clean detached worktree), the diff (`protocol/changed.diff`,
`sha256 36bd996827d6106e…`), the prompt bytes (`protocol/prompt.txt`,
`sha256 99a80b8c47a2ff84…`), model, allowed tools, permission mode, host version,
`--strict-mcp-config`, absence of any adapter/hook/injection, the frozen
consequence, the registered partner, and the preregistered discovery criteria and
admission rule.

Isolation is confirmed per run from the session `init` event rather than assumed:

| | default profile | isolated profile |
| -- | -- | -- |
| slash commands | 329 | **44** |
| agents | 29 | **5** |
| `mcp_servers` | — | `[]` |
| model | `claude-sonnet-5` | `claude-sonnet-5` |

All five corrected runs report `slash_commands: 44`, `agents: 5`,
`mcp_servers: []`, `model: claude-sonnet-5`.

One harness note, recorded because it caused a first attempt to fail closed with
five empty transcripts: `doppler run` resolves project and config from the working
directory, so it must be invoked from the Doppler-scoped directory with the
inner shell changing into the pinned worktree. The five empty runs produced no
output, were discarded before analysis, and are not counted.

The repository's own tracked `CLAUDE.md` at the pinned revision still loads in
both arms. It is repository-owned, identical across every run, and contains no
instruction toward repository history, co-change, or the registered partner.

## Result — 5 fresh runs, isolated profile

Same preregistered criteria, same analyzer (`protocol/analyze.py`).

| Run | tool calls | files read | partner named | partner opened (`Read`) | partner path cited | consequence stated | consequence grounded | strict discovery |
| -- | -- | -- | -- | -- | -- | -- | -- | -- |
| 01 | 5 | 2 | yes | yes | yes | yes | no | **yes** |
| 02 | 5 | 2 | yes | yes | yes | yes | yes | **yes** |
| 03 | 9 | 3 | yes | yes | yes | yes | yes | **yes** |
| 04 | 5 | 2 | yes | yes | yes | yes | no | **yes** |
| 05 | 3 | 1 | yes | no (repo-wide search) | no | yes | no | no |

**Strict discovery 4/5. Registered consequence stated 5/5. Partner opened 4/5.**

Admission required 0/5. **C4 remains REJECTED**, and the corrected arm rejects it
slightly harder than the original (4/5 strict versus 3/5).

Run 05, the single strict miss, still reached the registered consequence — by a
repo-wide search for `quiet` rather than through the partner:

> `:is-quiet` is never set by any argument parser, config reader, or CLI flag
> definition — it's a dead key that will always be `nil` … the intended "quiet"
> suppression feature does nothing.

That is the §10 "different path" case: recorded separately, and it does not
convert a miss into an admission because admission requires *all* runs to miss the
consequence, which none did.

## What the correction settles

The profile deviation is eliminated as an explanation for the original rejection.
The direction predicted when the deviation was recorded — that the default
profile's exploration-favouring global instructions could only make discovery
*more* likely, never less — is consistent with the outcome: removing them did not
reduce discovery.

**META-373's disposition is unchanged: `BOUNDED_SEARCH_EXHAUSTED`.** No fixture is
admitted, the successor delivery experiment stays gated, and A0–A5 were not run
beyond this baseline verification.

Corrected-arm artifacts: `a0-isolated/run-0{1..5}.jsonl`,
`a0-isolated-analysis.json`, `protocol/run-a0-iso.sh`, `protocol/prompt.txt`.
