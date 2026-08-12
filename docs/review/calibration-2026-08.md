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
* No test covering `extension/src/pathMatch.ts` exists in `extension/test/`.

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

**Status: not yet measured.** This section is completed from observation on the
canary PR; until then nothing here should be read as a pass, and `Greptile Review`
stays out of the required-contexts list.
