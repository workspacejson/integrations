# Transaction-unit rule — FROZEN before any post-basis history was inspected

Frozen 2026-08-21, prior to fetching. Applies identically to every repository.

## Definition of a transaction

Preferred: **a merged pull request.**
- Identity: the PR number and its merge commit SHA.
- Observed changed-file set: paths in `git diff --name-status -M50%
  <merge-base> <pr-head>` (equivalently the merge commit's second-parent range).
- Task text: the PR title and body, which exist before the change is merged.

Fallback, only when no merged PR qualifies: **an atomic non-merge commit**
with a coherent intent-describing message.
- Identity: the commit SHA.
- Observed changed-file set: `git diff-tree -r --name-status -M50%
  --no-commit-id <parent> <commit>`.
- Task text: the commit subject and body.

## Exclusions, frozen

1. Bulk transactions: changed-file count > 50, matching META-310's event-size
   exclusion rule. Excluded transactions are named, not merely counted.
2. Release/version-bump transactions (e.g. `chore(release):`) — mechanical, and
   META-310 already recorded release pairs as high-support/low-information.
3. Reverts.
4. Merge commits that are pure integration with no associated PR.

## Rename handling

`-M50%` similarity, `diff.renamelimit=5000` — identical to META-310's frozen
mining contract, so a renamed path is not counted as an unrelated file.

## Naming discipline

The paths observed in the held-out transaction are **the observed subsequent
changed-file set**. They are never "required files", "impacted files",
"blast radius", or "files that had to change". The set is an observation of
what a later transaction happened to touch.

## Selection order

Scan post-basis transactions oldest-first and stop at the first candidate that
satisfies every feasibility requirement. No ranking, no cherry-picking among
qualifying candidates.
