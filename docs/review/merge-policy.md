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

| Setting | Measured value |
| --- | --- |
| Required status checks | `build-and-smoke (20)`, `build-and-smoke (22)` |
| `strict` (branch must be up to date) | `true` |
| `required_conversation_resolution` | `true` |
| `required_approving_review_count` | `0` |
| `dismiss_stale_reviews` | `true` |
| `enforce_admins` | `false` |
| `allow_force_pushes` / `allow_deletions` | `false` / `false` |
| Repository rulesets | none (`[]`) |

So today, a merge into `main` requires: the two `build-and-smoke` contexts green on
an up-to-date head, and **every conversation resolved**. No review approval is
required, and no reviewer app is required.

### Observed gap — recorded, not acted on here

CI produces four check runs, but only two are required:

| Check run | Required? |
| --- | --- |
| `build-and-smoke (20)` | yes |
| `build-and-smoke (22)` | yes |
| `parity-receipt-reproduction` | **no** |
| `standard-candidate-consumption` | **no** |

A failure in either unrequired job does not block a merge today. That is a separate
governance decision from the reviewer question this document's owner issue covers,
and it is recorded here so it is not mistaken for a setting someone already chose
deliberately. Changing it is out of scope for META-322.

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

**Current state: not required. Not eligible to be required on installation
evidence alone.**

The bar for adding `Greptile Review` to the required-contexts list is behavioral,
not configurational. Each of the following must be observed on this repository —
not inherited from `workspacejson/standard`, where the mechanism was proven:

1. Branch-local `.greptile/` configuration is demonstrably read on a PR head.
2. The review is associated with the **exact current head SHA**, not with the PR in
   the abstract.
3. A deliberate, Integrations-specific positive-control defect is **caught** by a
   custom rule from `.greptile/config.json`.
4. The reverted, non-violating head does **not** repeat that finding.
5. A further push **retriggers** review against the new head.
6. Actionable findings are reconcilable individually, with thread receipts intact.
7. Merge eligibility then behaves as claimed.

If the positive control is **missed**, that is a reportable result and a reason not
to make the check required — a reviewer that does not catch the defect it was
configured to catch would, as a required gate, block merges without adding
detection. Installing an app and seeing a green check is not calibration.

Calibration results for this repository are recorded in
[`calibration-2026-08.md`](calibration-2026-08.md).

## 5. What a check state does and does not mean

* A check that has **not run** is not a pass. Absence of a review is absence of
  evidence, in exactly the sense `.greptile/rules.md` requires of the product code.
* A **completed** review is not an approval. Completion means a reviewer finished;
  it says nothing about whether it examined the defect class you care about.
* A check green on an **older head** says nothing about the current head. Review
  state is a property of a SHA.
* A reviewer being **installed** is not a reviewer being **calibrated**.
