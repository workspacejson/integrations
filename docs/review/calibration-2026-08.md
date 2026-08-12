# Greptile calibration — `workspacejson/integrations`, August 2026

Owner: META-322. Policy under test: [`.greptile/`](../../.greptile/). Merge
contract: [`merge-policy.md`](merge-policy.md).

This is the evidence record for whether `Greptile Review` may become a required
merge gate on this repository. It exists because installing a reviewer and seeing a
green check is not calibration — a reviewer that does not catch the defect it was
configured to catch would, as a required gate, block merges without adding
detection.

Results are filled in from observation. Anything not observed is recorded as
**not measured**, never as a pass.

## Baseline (measured before any policy landed)

Repository at `a31242b`, read from the GitHub API on 2026-08-12.

| Fact | Observed |
| --- | --- |
| `.greptile/` on `main` | absent |
| `Greptile` check ever observed on this repository | never — PR #8 (merged 2026-08-10) and PR #6 (open) both show no Greptile check run |
| Reviewer apps actually observed | `sourcery-ai[bot]`, `copilot-pull-request-reviewer[bot]` |
| `main` head check runs | 4, all `github-actions`: `build-and-smoke (20)`, `build-and-smoke (22)`, `parity-receipt-reproduction`, `standard-candidate-consumption` |
| Required contexts | `build-and-smoke (20)`, `build-and-smoke (22)` |
| `required_conversation_resolution` | `true` |

Greptile's absence on PR #8 and PR #6 is **not** evidence that the app is
uninstalled: both heads predate the 2026-08-11 rollout in `workspacejson/standard`.
Installation state was unmeasured going in, and the first controlled PR head is the
measurement.

Local gates on the policy branch before any canary, for comparison against the
canary head:

| Gate | Result |
| --- | --- |
| `npm run check:structure` | pass (after the allowlist amendment; watched failing with 2 violations before it) |
| `npm run typecheck` / `lint` / `build` | pass |
| `npm run test` | 147/147 passed, 14/14 files |
| `npm run smoke` | 43 PASS, 0 FAIL |

## Why this canary defect

The positive control reintroduces a **symmetric suffix fallback** into
`extension/src/pathMatch.ts`.

It was chosen because it is the one defect class this repository has already
suffered and fixed, so it is a real failure mode rather than a synthetic one:

* META-291 / PR #8 removed exactly this fallback from the server matcher, where a
  stored `src/a.ts` matched `/elsewhere/unrelated-repo/src/a.ts` — a fragility
  assertion landing on a file in a different repository.
* `src/path-match.ts` records that a *second* matcher is how a deny silently became
  a warn: the enforcement layer drifted to a symmetric fuzzy suffix match while the
  read layer was tightened.

It violates two branch-local custom rules at once — `proven-root-path-identity`
and `ported-copies-must-not-diverge` — so a finding that names either one is
evidence that branch-local configuration was read, not that a generic reviewer
noticed loose code.

### It is deliberately invisible to every deterministic gate

This is the property that makes it a clean control. On the canary head, CI should
stay green while the defect is present:

* `tsconfig.json` has `"include": ["src/**/*"]`, so `npm run build` and
  `npm run typecheck` never see `extension/src/`.
* `npm run test` is `vitest`, which collects `tests/**` only; `.check.ts` files do
  not match its default patterns.
* CI never runs `npm --prefix extension run test`. The only job that touches the
  extension is `standard-candidate-consumption` via `npm run build:extension`,
  which compiles and packages it — a suffix fallback is type-valid and compiles.
* Coverage for `extension/src/pathMatch.ts` **does** exist —
  `extension/test/intelligence.check.ts` imports `pathsMatch` directly — but that
  suite is excluded from every deterministic gate. Absent coverage and existing
  coverage that no gate runs are different failures, and this record distinguishes
  them. See [Incidental finding](#incidental-finding-the-extension-suite-is-red-on-main-and-no-gate-reports-it).

So if the deterministic gates stay green and the reviewer catches it, semantic
review is demonstrably adding detection that CI cannot provide. If the
deterministic gates stay green and the reviewer misses it, that is the reportable
outcome, and it argues against making the check required.

The change is confined to a disposable canary branch, is reverted in place, and is
never merged.

## Protocol

1. Open the policy PR. Measure whether a Greptile check appears at all, and against
   which head SHA.
2. Branch the canary from the policy head so the branch carries `.greptile/`.
3. Push the defect. Record caught / not-caught, and which rule id was cited.
4. Revert the defect in a new commit. Record whether the finding repeats on the
   clean head.
5. Record whether the new push retriggered review against the new SHA.
6. Reconcile each actionable finding individually, in its own thread.
7. Decide branch protection only from what steps 1–6 actually showed.
8. Close the canary without merging.

## Results

Measured 2026-08-12 on PR #10 (policy) and PR #11 (canary, closed unmerged).

| # | Criterion | Result | Evidence |
| --- | --- | --- | --- |
| 1 | Branch-local `.greptile/` is read | **pass** | The canary finding cites `Rule Used: Path identity follows ratified ADR-006 §4/§8…` with `source: .greptile`. That rule exists only on these branches, never on `main` |
| 2 | Review is associated with the exact current head | **pass** | Separate `Greptile Review` check runs per SHA: `aa456b4`, `e22d6f5`, `447a318`; the review comment carries `commit_id=e22d6f5` |
| 3 | Positive control caught | **pass — 1 of 1** | P1 *"Suffix matching breaks path identity"* on `extension/src/pathMatch.ts`, head `e22d6f5`. Summary: `8 files reviewed, 1 comments added` |
| 4 | Reverted clean head does not repeat | **pass — 0 of 0** | Head `447a318`, summary: `7 files reviewed, 0 comments added` |
| 5 | A further push retriggers review | **pass** | A new `Greptile Review` check run appeared on `447a318` after the revert push and ran to completion |
| 6 | Findings reconcilable individually | **pass, with a caveat** | Each finding answered in its own thread. Caveat in *Conversation resolution is weaker than it looks* below |
| 7 | Merge eligibility behaves as claimed | **pass** | PR #10 `mergeStateStatus=BLOCKED` on one unresolved thread; PR #11 `CLEAN` once its thread resolved. `required_conversation_resolution` is load-bearing |

Reviewer output on the two canary heads:

| Head | Defect present | Greptile | Sourcery check | CI (4 Actions contexts) |
| --- | --- | --- | --- | --- |
| `e22d6f5` | yes | **1 comment, P1** | `success` | 4/4 success |
| `447a318` | no (reverted) | 0 comments | `success` | 4/4 success |

### The check state does not encode findings

`Greptile Review` concluded **`success` on `e22d6f5`** — the head carrying the P1
finding. The check reports that review completed, not that review found nothing.

This decides what requiring the context would actually buy: it enforces *a review
ran against this head*, and nothing more. The semantic gate is
`required_conversation_resolution`, which was already enabled, and which was
observed holding PR #10 at `BLOCKED` on a single unresolved thread.

### Conversation resolution is weaker than it looks

When the revert removed the offending lines, GitHub marked the canary thread
`isOutdated=true, isResolved=true` **automatically**, with no one replying to it.
So a required-conversation-resolution gate can be satisfied by deleting the code a
finding pointed at.

It remains load-bearing — an unresolved thread genuinely blocks — but *resolved* is
not by itself evidence that a human engaged with a finding. Bulk resolution and
auto-resolution look identical in the API. Receipts have to be written into the
thread, which is why each finding in this calibration was answered individually
before resolution.

### Sourcery

Sourcery's **review body independently named the same defect** on `e22d6f5`,
including the cross-repo false-match consequence and the divergence from
`src/path-match.ts` — while its **check concluded `success`**.

That is the cleanest possible illustration of why the two are separated: the text
carried real semantic signal, the check state carried none. Sourcery therefore
stays defense in depth. The prior conclusion is **not falsified**; if anything its
value as a second layer is better supported than before, and its check state is
confirmed as non-authoritative.

### Incidental finding — the extension suite is red on `main` and no gate reports it

Greptile's one comment on the **policy** PR corrected a factual error in an earlier
draft of this document, which claimed no test covered `extension/src/pathMatch.ts`.
Coverage exists — `extension/test/intelligence.check.ts` imports `pathsMatch`
directly — and chasing that down surfaced a real defect:

```
$ npm --prefix extension ci && npm --prefix extension test    # clean head aa456b4
not ok 21 - pathsMatch: exact match and absolute-suffix fallback only
# tests 82  # pass 81  # fail 1
```

| Assertion | `aa456b4` (clean) | `e22d6f5` (defect) |
| --- | --- | --- |
| `pathsMatch("src/a.ts","src/a.ts") === true` | ok | ok |
| `pathsMatch("/repo/src/a.ts","src/a.ts") === true` | **FAIL** (`false`) | ok |
| `pathsMatch("/other/a.ts","a.ts") === false` | ok | **FAIL** (`true`) |

The test still asserts the pre-META-291 absolute-suffix fallback, so it is red on
both heads for opposite reasons, and no gate runs it. Tracked as **META-329**, not
repaired here.

## Decision — ratified and applied 2026-08-12

`Greptile Review` **is required** on `main`, in the narrow role it demonstrably
performs: it fires, binds to the exact head, caught its positive control, stayed
quiet on the clean head, and retriggers on push.

The ratified contract is two-part:

1. `Greptile Review` required status — **the current head was actually reviewed**;
2. the already-enabled `required_conversation_resolution` — **actionable findings
   are not left open**.

Greptile status is **not** semantic approval. Its concluding `success` on the canary
head carrying a P1 is not a defect in the gate, because the status was assigned only
the completion role. The semantic half is conversation resolution plus the written
per-finding protocol in [`merge-policy.md`](merge-policy.md) §3.

### Branch protection, before and after

| Setting | Before (`a31242b`) | After (`f61e0cb`) |
| --- | --- | --- |
| Required contexts | `build-and-smoke (20)`, `build-and-smoke (22)` | `build-and-smoke (20)`, `build-and-smoke (22)`, **`Greptile Review`** (app id `867647`) |
| `strict` | `true` | `true` — preserved |
| `required_conversation_resolution` | `true` | `true` — preserved |
| `required_approving_review_count` | `0` | `0` — preserved |
| `dismiss_stale_reviews` | `true` | `true` — preserved |
| `enforce_admins` | `false` | `false` — preserved |
| `allow_force_pushes` / `allow_deletions` | `false` / `false` | unchanged |
| `Sourcery review` required | no | **no — deliberately not promoted** |
| Rulesets | `[]` | `[]` |

Verified by an independent read-back of the protection API, not from the write
response.

### Deliberately accepted cost

PR #6 predates the policy and its head carries no Greptile run at all, so it cannot
satisfy the context until it updates. Requiring it to update and receive a
current-policy review is the intended effect of a stricter merge contract, not
collateral damage to be designed around. The gate was not weakened to preserve it.

The two unrequired CI contexts (`parity-receipt-reproduction`,
`standard-candidate-consumption`) remain a separate question, recorded in
[`merge-policy.md`](merge-policy.md) §2 and deliberately untouched.
