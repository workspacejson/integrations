# Review and merge policy

This document is the repository-owned statement of what has to be true before a
change merges into `main`, and — just as importantly — what is currently
**measured** versus **assumed**.

Every claim here is either a value read back from the GitHub API or an observation
from a named pull request head. Where something has not been measured, this
document says so rather than inferring it.

Owner: META-322. Companion policy: [`.greptile/rules.md`](../../.greptile/rules.md).

## 1. Reviewer roles

The two automated reviewers on this repository are not interchangeable and do not
carry the same authority.

| Layer | Role | Authority |
| --- | --- | --- |
| **CI** (`.github/workflows/ci.yml`) | Deterministic build, test, smoke, parity, and candidate-consumption gates | Blocking, for the contexts listed in §2 |
| **Greptile Review** | Semantic review against the repo-owned rules in `.greptile/` | See §4 — governed by measured calibration, not by installation |
| **Sourcery** | Defense in depth. A second, independent review-completion layer | **Not semantic authority.** A `success` Sourcery check is not evidence that a change is semantically correct, and must never be cited as review approval |
| **Human review** | Reconciliation of actionable findings; final judgement | Authoritative |

### Why Sourcery is not authority here

`Sourcery review` has been observed reporting `pass` on this repository (PR #8) in
the same run where a human reviewer subsequently commented on the change. A check
that completes tells you a reviewer *ran*; it does not tell you a defect class was
*examined*. That distinction is the whole point of separating the layers, and it is
the same conclusion `workspacejson/standard` reached. This repository keeps it
unless an Integrations-specific calibration independently falsifies it.

Nothing in this document elevates Sourcery on the basis of its check state.

### Repo-owned reviewer configuration

* `.greptile/config.json` — rules, scopes, severities, trigger behavior
* `.greptile/rules.md` — the prose reasoning and the verified failure class behind
  each rule, plus the rules deliberately **not** carried over from other repositories
* `.greptile/files.json` — orientation files the reviewer should read first
* `.sourcery.yaml` — path scoping only. It deliberately grants Sourcery no rule
  authority; it exists so the second layer does not spend attention on build
  output and vendored trees

## 2. Measured merge eligibility

Values below were read from the GitHub branch-protection API for `main`.

> **Division of responsibility.** This document is the *current contract*: what is
> required now and how to read it. [`calibration-2026-08.md`](calibration-2026-08.md)
> is the *evidence and change record*: the before/after protection state, the
> calibration that justified the change, and the SHAs it was measured on. When a
> setting changes, the new state is recorded here and the transition is recorded
> there — so the two are not two copies of the same claim.

| Setting | Measured value |
| --- | --- |
| Required status checks | `build-and-smoke (20)`, `build-and-smoke (22)`, `standard-candidate-consumption`, `SonarCloud Code Analysis` |
| `strict` (branch must be up to date) | `true` |
| `required_conversation_resolution` | `true` |
| `required_approving_review_count` | `0` |
| `dismiss_stale_reviews` | `true` |
| `enforce_admins` | `false` |
| `allow_force_pushes` / `allow_deletions` | `false` / `false` |
| Repository rulesets | none (`[]`) |

So a merge into `main` requires: the two `build-and-smoke` contexts,
`standard-candidate-consumption`, and `SonarCloud Code Analysis` green on an
up-to-date head, and **every conversation resolved**. No review approval is
required.

`Greptile Review` was added to the required contexts on 2026-08-12 after the
calibration in [`calibration-2026-08.md`](calibration-2026-08.md), and **removed on
2026-08-13** because it stopped emitting the check run the requirement depends on —
see §4. `Sourcery review` is deliberately **not** required.

**Read what remains precisely.** With no reviewer context required, the semantic
half of the gate is carried entirely by `required_conversation_resolution` plus the
written per-finding protocol in §3. Greptile still posts reviews and its findings
still create threads that must be reconciled to merge; what it no longer does is
assert mechanically that the current head was reviewed. That assertion is now a
human responsibility, and §5 applies with more force, not less.

This was observed working end to end on PR #12 at head `76d495d`, **under the
three-context protection in force on 2026-08-12**: all three required contexts
`success`, `SonarCloud Code Analysis` failing but not required and therefore not
blocking, and `mergeStateStatus=BLOCKED` on a single unresolved Greptile P1 thread.

That observation is kept as the record of the mechanism, not as a description of
current state: `SonarCloud Code Analysis` has since been promoted, and the same
failure on the same PR blocks today. What the observation still shows — that status
and conversation resolution are separate halves of the gate — is unaffected.

### Observed gap — narrowed since first recorded

CI produces four check runs. Three are required:

| Check run | Required? |
| --- | --- |
| `build-and-smoke (20)` | yes |
| `build-and-smoke (22)` | yes |
| `standard-candidate-consumption` | yes — promoted since first recorded |
| `parity-receipt-reproduction` | **no** — promotion is META-337 |

`parity-receipt-reproduction` is the one CI job whose failure still does not block a
merge. Promoting it is META-337's subject, and this PR is its prerequisite: the job
could conclude `success` without reproducing anything, so requiring it first would
have made a false green merge-authorizing. Absence is now a failure, which is what
makes the promotion safe to make.

### Refreshing this section

Everything in the two tables above is a live GitHub setting that can be changed
outside this repository, which makes the section the most perishable part of this
document. Re-read it rather than trusting it whenever it matters:

```bash
gh api repos/workspacejson/integrations/branches/main/protection
gh api repos/workspacejson/integrations/rulesets
```

If the output disagrees with what is written here, the API is right and this file
is stale — treat that as a documentation defect, and correct it in the PR that
noticed. A merge-eligibility claim that has drifted from the setting it describes
is worse than no claim, because it will be believed.

Measured on 2026-08-13 against `main` at `70cfd57`. The two preceding readings are
kept as the *before* halves of the record, not as descriptions of current state:
`main` at `f61e0cb` on 2026-08-12 (three required contexts, immediately after
`Greptile Review` was promoted), and `main` at `a31242b` in
[`calibration-2026-08.md`](calibration-2026-08.md) (two required contexts,
pre-policy baseline).

The 2026-08-13 reading was taken because this section had already drifted: it
claimed three required contexts while the API returned five —
`standard-candidate-consumption` and `SonarCloud Code Analysis` had been promoted
without the change reaching this file. Corrected here under the rule directly above,
which is the first time that rule has been exercised. The drift is itself the
argument for the rule: the stale table said `SonarCloud Code Analysis` was
non-blocking, and a reader trusting it would have concluded PR #12 was mergeable
while it was in fact blocked on exactly that context.

## 3. Conversation resolution

`required_conversation_resolution` is already enabled, which makes unresolved
actionable threads part of merge eligibility on this repository today.

The protocol:

* **Reconcile findings individually.** Each actionable thread gets its own reply
  stating what was changed, or why the finding does not hold. Bulk-resolving a set
  of threads destroys the receipt and is not evidence of reconciliation.
* **Resolution is a claim.** Resolving a thread asserts that the finding was
  addressed on the current head — not that it was read.
* **Disagreement is a legitimate resolution**, provided the reasoning is written in
  the thread. "Not applicable because X" is a receipt; silent resolution is not.

## 4. `Greptile Review` as a required check

**Current state: NOT required, as of 2026-08-13.** It was required from 2026-08-12
until 2026-08-13, promoted only after all seven criteria below were observed on this
repository, and only into the narrow role it demonstrably performs — see
[`calibration-2026-08.md`](calibration-2026-08.md). It was demoted because criterion
5 stopped holding; the demotion is recorded under
[Why the requirement was withdrawn](#why-the-requirement-was-withdrawn) below.

Greptile remains installed and continues to post reviews. What was withdrawn is its
authority over merge eligibility, not its presence.

The bar was behavioral, not configurational. Each of the following was observed on
this repository — not inherited from `workspacejson/standard`, where the mechanism
was proven:

1. Branch-local `.greptile/` configuration is demonstrably read on a PR head.
2. The review is associated with the **exact current head SHA**, not with the PR in
   the abstract.
3. A deliberate, Integrations-specific positive-control defect is **caught** by a
   custom rule from `.greptile/config.json`.
4. The reverted, non-violating head does **not** repeat that finding.
5. A further push **retriggers** review against the new head. — **This no longer
   holds. See [Why the requirement was withdrawn](#why-the-requirement-was-withdrawn).**
6. Actionable findings are reconcilable individually, with thread receipts intact.
7. Merge eligibility then behaves as claimed.

If the positive control is **missed**, that is a reportable result and a reason not
to make the check required — a reviewer that does not catch the defect it was
configured to catch would, as a required gate, block merges without adding
detection. Installing an app and seeing a green check is not calibration.

All seven were observed on 2026-08-12; results, exact SHAs, and check states are in
[`calibration-2026-08.md`](calibration-2026-08.md).

**One result changes how the requirement should be read.** The `Greptile Review`
check concluded `success` on the head that carried a P1 finding. The check encodes
*review completed*, not *review found nothing*. Requiring the context therefore buys
current-head review completion; the semantic gate is `required_conversation_resolution`,
and the two are only meaningful together.

And that gate is itself softer than it appears: GitHub auto-resolves a thread whose
lines a later commit removed, so resolution can be satisfied without anyone
answering the finding. Hence §3 — the receipt has to be written into the thread.
GitHub cannot encode that distinction mechanically, which is why the written
per-finding disposition, not the `isResolved` bit, is the evidence.

### Observed working

First post-policy proof, PR #12 (META-285) at head `76d495d`, base `f61e0cb`:

| Signal | Observed |
| --- | --- |
| `build-and-smoke (20)` / `(22)` | success / success |
| `Greptile Review` | success — `5 files reviewed, 0 comments added` on this head |
| `SonarCloud Code Analysis` | **failure — not a required context *at that time*, did not block. It is required as of the 2026-08-13 reading in §2, and the same failure blocks today** |
| `Sourcery review` | success (not required) |
| Unresolved threads | 1 — a Greptile P1 on `scripts/migration/verify-receipt.mjs` |
| `mergeStateStatus` | **`BLOCKED`** |

Every required status context was satisfied and the PR was still blocked, on the
conversation-resolution half alone. That is the two-part contract working: status
proved the current head was reviewed, resolution kept an open actionable finding
from being merged past.

The same update also demonstrated the intended cost of a stricter contract: PR #12
and PR #6 both went `BEHIND` when `main` moved, and each must take a current-policy
review before merging. PR #6's pre-policy head has **no** Greptile run at all, so it
cannot satisfy the context until it updates — intended behavior, not collateral
damage.

### Why the requirement was withdrawn

Criterion 5 — *a further push retriggers review against the new head* — held during
calibration on 2026-08-12 and stopped holding immediately afterwards. Greptile kept
posting reviews; it stopped emitting the `Greptile Review` check run that branch
protection matches on. A required context that the installed app does not produce
cannot be satisfied by anything, so `main` became unmergeable.

Observed on PR #14 across four heads:

| Head | Greptile review posted | `Greptile Review` check run | Other checks |
| --- | --- | --- | --- |
| `0ee76bc` | yes (COMMENTED) | **0** | 8/8 pass |
| `c3c17a2` (rebase onto main) | yes (COMMENTED) | **0** | 8/8 pass |
| `3aa4531` (fresh push) | yes (COMMENTED) | **0** | 8/8 pass |
| `be2e965` (merged head) | — | **0** | 8/8 pass |

Zero unresolved threads on every one of them. The documented recovery path — push
again and get a fresh check — was the thing that failed, which is why criterion 5 is
annotated above rather than quietly deleted: it is the criterion whose failure the
requirement could not survive.

The same `statusCheck: true` in `.greptile/config.json` continued to produce the
check on `workspacejson/standard` throughout, so this was not a missing config
value.

**The cause is the Greptile trial credit limit, not this repository.** Established
2026-08-13: the account has reached its 50-credit trial limit, after which Greptile
posts a credit-limit notice in place of a review and emits no check run.
`workspacejson/standard` kept working only until its own next pull request — #37
reviewed head `4f9e8f6f` and emitted zero check runs, against exactly one each on
#34, #35 and #36 — and its requirement was withdrawn the same way. Details in
[`calibration-2026-08.md`](calibration-2026-08.md).

Restoring the signal is therefore a billing action, not a debugging one.

**Change applied 2026-08-13**, measured before and after against the API:

```
before: ["build-and-smoke (20)", "build-and-smoke (22)",
         "standard-candidate-consumption", "SonarCloud Code Analysis",
         "Greptile Review"]
after:  ["build-and-smoke (20)", "build-and-smoke (22)",
         "standard-candidate-consumption", "SonarCloud Code Analysis"]
```

Greptile was **not** uninstalled (`greptile-apps`, app id `867647`, still installed
on the org). Quota, credit-limit and error comments are **not** review evidence, and
absence of a check is recorded as absence — never as a pass.

**Re-admission.** `Greptile Review` may become merge-authoritative again only after
**both** are observed: a substantive review on the current PR head, **and** a
mechanically enforceable current-head signal compatible with branch protection.
Meeting one without the other is what produced this deadlock.

## 5. What a check state does and does not mean

* A check that has **not run** is not a pass. Absence of a review is absence of
  evidence, in exactly the sense `.greptile/rules.md` requires of the product code.
* A **completed** review is not an approval. Completion means a reviewer finished;
  it says nothing about whether it examined the defect class you care about.
* A check green on an **older head** says nothing about the current head. Review
  state is a property of a SHA.
* A reviewer being **installed** is not a reviewer being **calibrated**.
