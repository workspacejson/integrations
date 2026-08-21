# Forward-looking feasibility gate — is there a post-basis held-out transaction to test change-planning headroom against?

**Date:** 2026-08-21 (UTC-4). **Executed under:** META-373, after
`BOUNDED_SEARCH_EXHAUSTED` (see `../RECEIPT.md`).
**Result:** **`NO_POST_BASIS_HELDOUT`**
**Successor research issue:** META-374 — *Determine whether pre-change historical
evidence gives a change-planning agent measurable headroom*. META-374 blocks
META-364 so that outreach cannot mechanically restart from the exhausted review
premise.

> This directory is a research receipt. It is not normative workspace.json
> specification semantics, a conformance requirement, an adoption claim, or a
> claim that these results generalize beyond the repositories, revisions and
> single host recorded here. **No Claude run was executed by this gate.** No
> treatment arm was created, no workspace.json semantics were modified, and no
> MCP server, hook, skill or adapter was built.

## What this gate asked

META-373 exhausted a bounded search for a *code-review* fixture with measured
baseline headroom and found none. The recurring structural reason recorded there
— that registered pairs carrying a crisp verifiable consequence are coupled
through a shared named symbol, which is exactly what `grep` resolves in one hop
— suggests the search for headroom may need to leave code review rather than
continue inside it.

Change planning is the next candidate surface: a filesystem-capable agent
planning a change sees the *pre-change* repository and cannot grep for a symbol
that does not exist yet. Before designing any such measurement, one feasibility
question must be answered from public history alone:

> Does a held-out change transaction exist **after** a pinned artifact's
> `basisRevision` that could serve as an authentic, leakage-free target?

## FEASIBILITY_RESULT

**`NO_POST_BASIS_HELDOUT`**

Read precisely: **no admissible held-out transaction**, not *no upstream
activity*. Two of the three pinned repositories have literally zero post-basis
commits. The third has 44, and at least one of them satisfies every stated
feasibility criterion — it is rejected on a *separate, previously-established*
rule (META-373's trivial-exposure disqualifier), not on the feasibility criteria.
That rejection is a judgement call, it is recorded as one, and the candidate is
documented in full below so it can be overruled.

## TRANSACTION_UNIT_RULE

Frozen **before any post-basis history was fetched or inspected**, and pinned
verbatim alongside this receipt at `TRANSACTION-UNIT-RULE.md`,
`sha256 f4671df6bce1fea21a65dcf26b3135a129cec9017c910ab563454099fc6e2dec`.

Summary of the frozen rule:

- **Preferred unit — a merged pull request.** Identity = PR number + merge
  commit. Observed changed-file set = `git diff --name-status -M50%` across the
  PR range. Task text = PR title and body, which exist before the merge.
- **Fallback — an atomic non-merge commit** with a coherent intent-describing
  message. Task text = subject and body.
- **Exclusions:** changed-file count > 50 (matching META-310's event-size rule);
  release/version-bump transactions; reverts; pure integration merges with no
  associated PR. Excluded transactions are named, not merely counted.
- **Rename handling:** `-M50%`, `diff.renamelimit=5000` — identical to META-310's
  frozen mining contract.
- **Selection order:** scan post-basis transactions oldest-first, stop at the
  first fully qualifying candidate. No ranking among qualifiers.
- **Naming discipline:** the T1 paths are **the observed subsequent changed-file
  set** — never "required files", "impacted files", "files that had to change",
  or "blast radius".

**One rule defect, recorded rather than silently patched.** The implementing
regex matched `chore(release)` but not `chore: release main`, so two release PRs
(#7037, #7047) passed the mechanical filter. They are excluded by the rule's
prose, which names the category. The prose was applied.

## REPOSITORIES_CHECKED

All three META-310 artifacts. `git fetch origin` was run on each; all fetches
clean. Post-basis transitions are counted first-parent from the artifact's
`basisRevision` to the fetched remote head.

| Repository | `basisRevision` (T0) | Post-basis first-parent transitions | Finding |
| -- | -- | -- | -- |
| `JamieMason/syncpack` | `958d30689ac24b60623258630242330bd6d0264b` | **0** | The pin **is** `origin/main`, tip dated 2026-08-09. No upstream activity since. |
| `polyfy/polylith` | `68dab9868274c8044817983c2424fbdbd616a456` | **0** | The pin **is** `origin/master`, tip dated 2026-08-09. No upstream activity since. |
| `formatjs/formatjs` | `27c29bf9a40a50dac232a159b8790dbd14732c57` | **44** | Active; head `7187a7a661c895d19f029c2809a3ef681db3606a`. 21 transactions touch both endpoints of a registered pair; all rejected — see below. |

**The decisive fact:** the two repositories carrying source-level evidence are
exactly the two that have not moved. syncpack holds the only verified
import-free source cluster in the corpus (32 of 50 pairs source-to-source) and
polylith the only cross-component pairs without a `:require` edge. Neither has
produced a single post-basis commit.

## HELDOUT_CANDIDATE

**None admissible.** Of formatjs's 21 mechanically qualifying transactions:

- **19** are dependency bumps (`chore(deps)` / `fix(deps)`) or release PRs. These
  fail the task-text criterion: text such as *"update pnpm to v11.19.0"* or
  *"update rust crate clap to v4.6.5"* names the toolchain whose manifest and
  lockfile constitute the changed-file set. The mapping is definitional, not
  inferred.
- **2** are neither. Both are recorded here in full.

### Borderline candidate — satisfies every feasibility criterion, rejected on trivial exposure

| | |
| -- | -- |
| T0 `basisRevision` | `27c29bf9a40a50dac232a159b8790dbd14732c57` |
| T1 identity | PR **#7066**, merge commit `80d721f6ae408b9c2df27785ad5b13f568a12b2f` |
| Task source / timestamp | PR title *"docs: add top-level skills section"*, merged `2026-08-21T09:22:43-04:00` |
| Target file | `MODULE.bazel` |
| Registered historical partner | `MODULE.bazel.lock` |
| `support` / `occurrences` | **12 / 103** |
| Task text reveals the file set? | **No** — the task names neither file |

**Why it is rejected.** `MODULE.bazel.lock` is the lockfile *generated from*
`MODULE.bazel`. The partner is exposed by basename (`<manifest>.lock`) and by
definitional generation — the most trivially discoverable coupling class in
software. This is the same disqualifier META-373 applied to C1/C3/C5, and the
same reason META-310 demoted FormatJS: all 50 of its emitted pairs are release
and dependency plumbing with **no source file at either endpoint**. A headroom
test on this fixture would measure whether an agent knows that lockfiles
regenerate from manifests. It does.

**The second non-dependency transaction.** PR **#7068**,
`7187a7a661c895d19f029c2809a3ef681db3606a`, *"refactor: replace Vike with static
Vite docs"*, 29 files. It hits `package.json ↔ pnpm-lock.yaml` (87/249),
`MODULE.bazel.lock ↔ package.json` (41/147) and `MODULE.bazel.lock ↔
pnpm-lock.yaml` (37/271) — the same class, plus task text naming the
technologies driving the change.

## TEMPORAL_LEAKAGE_CHECK

Frozen rules applied, and their outcomes:

1. **Mining boundary is clean.** The producer traverses
   `git rev-list --first-parent --reverse <basisRevision>`, so each artifact's
   mining window *ends* at its basis. Every formatjs transaction examined lies
   strictly after `27c29bf9`, so none could have entered the mined evidence.
   **No temporal leakage from T1 into T0 evidence.**
2. **Task-text leakage is where candidates fail**, not temporal leakage: 19 of 21
   qualifying transactions have task text naming the changed subsystem's
   manifest by name.
3. **Static/lexical leakage routes on the borderline candidate** — three
   independent trivial routes: basename derivation (`MODULE.bazel` →
   `MODULE.bazel.lock`); definitional generation (the lock is a build output of
   the module file); same-directory adjacency (both at repository root).
4. **Retrospective designs that reuse a commit inside the mining window remain
   ruled out.** That artifact was mined *including* the commit, so the evidence
   has already seen the answer. Any retrospective design must mine at an earlier
   basis and hold out only what follows it.

## WORKSPACE_EVIDENCE_AT_T0

FormatJS artifact, `sha256
3ed91cffb26498e4cf930e8388e8e25da369ba5e623718f68d709309f6d6643a`, producer
`@workspacejson/cli@0.5.2`, basis `27c29bf9…`, pinned at
`workspacejson/standard@a034339` `docs/evidence/meta-310/formatjs.workspace.json`:

- 50 registered pairs across **26 distinct files**, every one a manifest,
  lockfile, changelog, CI workflow, or example `package.json`.
- **Zero source endpoints.** Not a fresh classification — META-310 recorded it
  and demoted FormatJS on that output.
- Cap-bound: 50 emitted of **713** qualifying pairs.

Source-level relationships may well exist below the cap, but reaching them is
file-centric retrieval (META-323), not the pinned artifact.

## OBSERVED_T1_FILE_SET

For the borderline candidate PR #7066 / `80d721f6a` — **the observed subsequent
changed-file set**, 9 paths. This is an observation of what a later transaction
happened to touch. It is not a required-file set.

```
M  BUILD.bazel
M  MODULE.bazel
M  MODULE.bazel.lock
M  docs/BUILD.bazel
M  docs/public/sitemap.xml
M  docs/src/docs-metadata.generated.json
M  docs/src/utils/navigation.ts
M  knowledge-base/001a-bazel-toolchain.md
A  patches/llvm-0.8.0-musl-mirror.patch
```

Exactly two of these appear anywhere in the T0 artifact: `MODULE.bazel` and
`MODULE.bazel.lock`. The seven paths a change-planning agent would actually have
to reason about carry no registered evidence at all.

## NEXT_HEADROOM_GATE — preserved, not executed

The forward-looking gate is **blocked, not failed**. It cannot run against
syncpack or polylith until those repositories produce post-basis history, and
waiting on future upstream activity is explicitly not the default fallback.

Preserved as: *when either repository next produces a non-release,
non-dependency transaction touching a file with a registered source-level
partner, re-run this same gate unchanged.*

## RETROSPECTIVE_OPTION — proposed, not executed, not approved

The recommended path. **A bounded retrospective time-slice on syncpack**, the
only repository with verified import-free source coupling.

| | |
| -- | -- |
| **T0′** | `233a0b37265ff278bc96ece91f8c2bbfcaeeb280` (2026-03-21, *"refactor(core): reorganise related modules"*) |
| Distance from current pin | 100 first-parent transitions |
| First-parent depth at T0′ | 819 — so META-310's frozen 500-transition window still applies unchanged and comparability with its syncpack run holds |
| Producer | the existing pinned `@workspacejson/cli@0.5.2` via META-310's byte-frozen `meta310-mine.mjs`, no options, no policy tuning |
| Held-out window | T0′ → current pin: 100 transactions, **89** of them non-release and non-dependency, including genuine feature work (`feat(update): only list selected updates in summary`, `fix(pnpm): write pnpmOverrides to pnpm-workspace.yaml`, `feat(groups): add full pnpm/bun catalogs support`) |
| Upstream dependency | none — everything is already local |

**This is one run of the *existing* producer at a different basis. It is not new
mining machinery — but it does produce a new artifact, so it requires explicit
approval before execution.** That flag was raised in the decision pass and is not
treated as spent.

**Leakage discipline for the retrospective.** The T0′ artifact's mining window
ends at T0′, so every held-out transaction is unseen by that evidence. Candidate
selection must happen *after* the T0′ artifact exists and *before* any baseline
run, using the transaction-unit rule frozen above, unchanged. Order of
operations: mine at T0′ → freeze the candidate under the existing rule → screen
leakage routes → only then design the headroom measurement. Selection cannot be
pre-computed now, because the registered pairs at T0′ do not yet exist.

## Architecture boundary — unchanged by this gate

- workspace.json is **neutral, revision-bound, descriptive** repository evidence.
  A registered co-change pair is a symmetric historical observation: not a
  dependency, not causality, not a required change, not blast radius, not a
  recommendation, not a risk score, and not correctness evidence.
- Fragility scoring, behavioral modeling, AI attribution, prescriptive
  prioritization, and learned agent-behavior intelligence are **outside** this
  experiment and may belong to Vreko.
- No Vreko or `@marcelle-labs` dependency is introduced into workspacejson by
  this gate or by any experiment it proposes.

## Verification performed when this receipt was pinned

The gate's numeric claims were re-derived from the already-fetched local clones
at the state the gate observed (`FETCH_HEAD` 2026-08-21 11:36 local; **no new
fetch was issued**, so these are the same observations, not a later state):

- syncpack `rev-list --first-parent --count 958d3068..origin/main` = **0**, and
  `origin/main` = `958d3068…`.
- polylith `rev-list --first-parent --count 68dab986..origin/master` = **0**, and
  `origin/master` = `68dab986…`.
- formatjs `rev-list --first-parent --count 27c29bf9..origin/main` = **44**,
  `origin/main` = `7187a7a66…`.
- `80d721f6a` — subject, `2026-08-21T09:22:43-04:00`, and the 9-path changed-file
  set reproduced exactly as listed above.
- FormatJS artifact `sha256` matches META-310; 50 pairs, 26 distinct files,
  `MODULE.bazel ↔ MODULE.bazel.lock` support 12 / occurrences 103, basis
  `27c29bf9…`.
- syncpack `233a0b372`: 100 first-parent transitions to the pin, first-parent
  depth 819, 89 non-release/non-dependency subjects in the window.

## Reproducing

```bash
# no fetch is required to reproduce the counts against a clone at the same state
git -C <syncpack-clone> rev-list --first-parent --count 958d30689ac24b60623258630242330bd6d0264b..origin/main
git -C <polylith-clone> rev-list --first-parent --count 68dab9868274c8044817983c2424fbdbd616a456..origin/master
git -C <formatjs-clone> rev-list --first-parent --count 27c29bf9a40a50dac232a159b8790dbd14732c57..origin/main
git -C <formatjs-clone> show --name-status -M50% --format= 80d721f6ae408b9c2df27785ad5b13f568a12b2f
```

`MANIFEST.json` carries a SHA-256 for every file in this directory.
