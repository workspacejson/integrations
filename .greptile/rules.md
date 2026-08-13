# Review rules for workspacejson/integrations

This repository owns host adaptation, delivery, packaging, hooks, installers, and
first-party adapter parity for `workspace.json`. It **consumes** the public
contract; `workspacejson/standard` owns the schema, validation semantics, rules,
and ADRs.

The rules below are enforced as structured rules in `config.json` and elaborated
here in prose so the reasoning is reviewable alongside the code.

> **`config.json` is authoritative for scope.** The `Scope:` line under each rule
> here restates that rule's `scope` array so the reasoning is readable in one
> place, which means the two can drift. If they ever disagree, `config.json` is
> what the reviewer actually applies and this file is the thing to correct. As of
> the commit that introduced them, all nine scoped rules match exactly, and the
> five ecosystem-wide rules carry no `scope` key and no `Scope:` line.

Every Integrations-specific rule names the **verified failure class** it was
derived from — an observable surface or a recorded defect in this repository, not
a rule inherited because another repository has one. Rules that could not be
grounded in this repository's own evidence were not written; see
[Deliberately not carried over](#deliberately-not-carried-over).

## Why this repository's rules differ from `standard`'s

`workspacejson/standard` is the normative surface: its risk is that the schema
says the wrong thing. This repository never says what is normative. Its risk is
different in two specific ways.

1. **It reads an artifact it did not produce, on a host machine.** Path identity,
   tolerance, and unavailability semantics are the failure surface — not schema
   correctness.
2. **What ships is not the source tree.** `dist/` is gitignored,
   `hooks/pre-edit-check.mjs` resolves `../dist/*` at runtime, and `package.json`
   `files` decides what a consumer actually receives. Source-only tests can be
   green while the packed package is broken.

## Ecosystem-wide rules

These carry across the `workspacejson` ecosystem. They are kept here because each
also has a live surface in this repository, not merely because `standard` has them.

### Evidence must be load-bearing

A verification check that cannot fail proves nothing. If you add a test, guard,
smoke assertion, or receipt comparison, it must be capable of failing for the
defect it names.

### Absence is not success

Absence, skipped, unsupported, or unavailable is never success, false, safe,
empty, allow, or green. A gate that goes green because it could not find the
thing it measures reports conformance it never measured.

### Measurements must perturb

A parity receipt, hash, count, or score that does not move when its referent
moves is decorative. `npm run verify:receipt` regenerates a receipt and compares
it against the committed reference; a comparison that cannot disagree is not a
comparison.

### Checks cannot be vacuous

Every check must be considered in both directions: cannot-ever-pass and
cannot-ever-fail. A hook that denies everything and a hook that allows everything
both look identical to a working hook from a green build.

### Clean-room public boundary

**Verified failure class.** This repository is public and clean-room by
construction — `src/services/workspace.ts` carries its own root-marker resolver
precisely because the private platform's resolver is not importable across that
boundary. The boundary is nonetheless porous in the direction of *references*:
private tracker identifiers and private platform names have reached source
comments in the published package's source tree.

No private organizational tracker identifier (`VR-nnn`, `HAC-nnn`), private
product or platform name, private sidecar artifact, cross-organization
implementation dependency, or running-daemon assumption may appear in any file,
including source comments, docs, config, and fixtures. Public references
(`META-nnn`, `ADR-nnn`, published package names) are fine. The artifact and this
integration must remain meaningful with nothing running.

> Pre-existing instances of this class exist on `main` and are recorded on
> META-322 for separate triage. They are not repaired by the policy PR — the rule
> governs changed lines going forward.

## Integrations-specific rules

### Consume the standard, do not vendor it

**Verified failure class.** The dependency direction is currently intact and is
worth keeping that way: runtime dependencies are `@modelcontextprotocol/sdk` and
`zod` only, no schema is vendored, and `hooks/pre-edit-check.mjs` points users at
`npx @workspacejson/spec validate` rather than validating locally. `src/types.ts`
is deliberately a *consumer* model, not a schema.

Do not add a copied JSON Schema, a parallel validator, a re-derived rules engine,
or a second definition of conformance here. Reading and normalizing the artifact
into a local consumer model is correct; asserting normative validity, or
repairing the artifact toward a schema, is `standard`'s job. If a contract gap
blocks work, the fix is an upstream issue, not a local reimplementation.

Scope: `src/**`, `extension/src/**`, `hooks/**`, `scripts/**`

### Reader tolerance is not repair

**Verified failure class.** `normalizeWorkspace` in `src/services/workspace.ts`
is the single place that touches the raw artifact, and its contract is explicit:
*degrades to empty, never fabricates*. Producer-emitted tier/confidence fields are
dropped rather than trusted. The property that makes this safe is that no read
path can write: today the only writes anywhere in `src/` are reviewer receipts
under `.local/workspacejson/reviewer/`, and nothing opens `workspace.json` for
writing.

Normalization may degrade to empty and may accept legacy shapes. It must not
fabricate values, invent defaults that are then presented as producer output, or
write back to the artifact. Tolerating an unknown shape is not declaring it valid.

Scope: `src/services/**`, `src/tools/**`, `src/evidence.ts`, `hooks/**`,
`extension/src/**`

### Path identity resolves against a proven root

**Verified failure class.** META-291 / PR #8. The matcher previously carried a
suffix fallback that matched a stored `src/a.ts` against
`/elsewhere/unrelated-repo/src/a.ts` — a fragility assertion landing on a file in
a different repository. The fallback was removed and the behavior is now pinned by
`tests/unit/path-match.test.ts`, `tests/unit/workspace.test.ts`,
`tests/unit/evidence.test.ts`, and `scripts/smoke.mjs`.

Path identity follows ratified ADR-006 §4/§8. An absolute host query is comparable
only after containment in a repository root the caller has **proven**; if
containment cannot be proven the answer is no-match, which is a refusal, never a
nearest guess. Do not introduce suffix matching, basename matching, `endsWith`
comparison, symmetric fuzzy matching, or an optional/defaulted `root` parameter
that lets an absolute query silently degrade at a call site that forgot to pass
one. Stored keys are repo-root-relative POSIX.

The proven root is derived centrally from the matched artifact candidate, not from
a generic `dirname()` — the canonical location is `.agents/workspace.json`, so a
`dirname()` root is one level short and makes every legitimate absolute query fail
containment.

Scope: `src/path-match.ts`, `src/services/**`, `src/tools/**`, `src/evidence.ts`,
`extension/src/pathMatch.ts`, `extension/src/**`, `hooks/**`

### Ported copies must not diverge silently

**Verified failure class.** `src/path-match.ts` records it directly: a second
matcher is how a deny silently became a warn — the enforcement layer had drifted
to a symmetric fuzzy suffix match while the read layer was tightened. The
duplication is still live and deliberate: `extension/src/pathMatch.ts` is ported
rather than imported because the extension is a standalone package with no
build-time dependency on the server.

A change to the semantics of one copy without a corresponding change, or an
explicit written reconciliation, for the other is a divergence defect rather than
a local edit. The same applies to any other capability duplicated between the
server and a host adapter.

Scope: `src/path-match.ts`, `extension/src/pathMatch.ts`, `src/**`,
`extension/src/**`

### Unavailable is not approval

**Verified failure class.** This repository already treats the distinction as
load-bearing, and the smoke suite exercises it against malformed JSON, a
wrong-typed root, and a removed artifact. `hooks/pre-edit-check.mjs` routes every
failure through `emitUnavailable`, which states that no fragility or co-change
determination was made, and its no-history branch exits silently with the comment
*never an approval message*. `src/reviewer.ts` keeps `UNAVAILABLE` a distinct
status from a `PASS` verdict, and instructs that PASS means no blocking issue was
found in scope, never a safety certification, and that missing evidence is a gap,
never approval.

Malformed, absent, unreadable, or unsupported state must stay observable and
distinct, and must never be rendered as approval or as a clean result. Do not
collapse an error branch into the same output as a clean branch.

Scope: `hooks/**`, `src/reviewer.ts`, `src/tools/**`, `src/services/**`,
`src/evidence.ts`, `extension/src/reviewerVerdict.ts`, `extension/src/**`

### Host adaptation stays descriptive

**Verified failure class.** The reviewer's own instructions pin the posture: *you
are read-only and have no enforcement authority*. The pre-edit hook does emit a
`deny`, and that is legitimate — it is this integration's host-side behavior over
described evidence, with tiers derived mechanically from evidence the artifact
already carries. The line to hold is that none of it flows back into the artifact
or gets attributed to the standard.

Do not write policy, approval, gate, or merge-blocking fields into
`workspace.json`, and do not document the standard as mandating an action. Present
host enforcement as this integration's behavior, never as a requirement the
standard imposes.

Scope: `src/**`, `extension/src/**`, `hooks/**`, `docs/**`, `README.md`

### Packed artifact behavior must be measured

**Verified failure class.** The gap between source tree and shipped package is
structural here. `dist/` is gitignored but shipped; `hooks/pre-edit-check.mjs`
resolves `../dist/services/workspace.js`, `../dist/evidence.js`, and
`../dist/config.js` at runtime, so the hook depends on a build output that no
source test exercises through the same resolution path. `package.json` `files`
enumerates `dist`, `hooks`, `scripts/install.mjs`, `.codex-plugin`, `.mcp.json`,
`vsix`, `README.md`, `LICENSE`, and `bin` maps two commands into
`scripts/install.mjs`. Any of those can break the consumer while the source tests
stay green.

Changes to those surfaces need evidence from a pack, install, or equivalent
packaged run — `npm run pack:check` and the installed-hook path, not only
`vitest`. A source-tree test passing is not evidence that a consumer receives
working files.

Scope: `package.json`, `extension/package.json`, `scripts/install.mjs`,
`hooks/**`, `.github/workflows/**`, `tests/**`

### Probes must not be destructive

**Verified failure class.** META-285, recorded against this repository: the
candidate-consumption harness has checks that cannot pass, and `--help` runs a
destructive install into the source repository. The surrounding surface is
genuinely destructive by nature — `scripts/install.mjs` invokes
`--install-extension` and `--uninstall-extension` and removes a managed root;
`scripts/smoke.mjs` writes and `rmSync`s fixture roots — so the distinction
between *a probe* and *an action* has to be explicit rather than assumed.

A command presented as harmless — help, version, status, check, probe, dry run,
smoke — must not install or uninstall anything, must not delete or overwrite files
outside a disposable temporary directory it created, and must not mutate the
user's checkout or the source repository under test. If a check needs a real
install to be meaningful, it must be explicitly opt-in and say so.

> META-285 owns the repair of the existing harness. This rule governs changed
> lines; it is not a request to fix that defect in an unrelated PR.

Scope: `scripts/**`, `hooks/**`, `.github/workflows/**`

### Host contract claims need a watched version

**Verified failure class.** The one host output contract this repository depends
on is recorded with an explicit evidence tier:
`hooks/pre-edit-check.mjs` states that the Codex output contract
(`permissionDecision` / `additionalContext` JSON, exit code 2 = block) was
*watched live on Codex 0.144.1 (2026-07-13)*, with deny-all and fixture-specific
denies observed blocking `apply_patch`, and names `emitDecision()` as the single
adapter point. That is the standard to hold, because a host contract is an
observed fact about a version, not a stable API.

A claim that a host contract works — a Codex hook channel, a VS Code API behavior,
an editor CLI flag — must name the host version and the date it was watched, and
the adapter point must stay single and identifiable. Do not widen, silently
re-target, or add a second emission channel for a host contract without recording
the version it was verified against.

Scope: `hooks/**`, `scripts/install.mjs`, `extension/src/**`, `src/index.ts`,
`docs/**`

## Deliberately not carried over

Recorded so that a later reader can tell a considered omission from an oversight.

| Rule in another repository | Status here | Reason |
| --- | --- | --- |
| `four-read-paths-breaking` (standard) | **Not carried** | The four stable read paths are `standard`'s compatibility surface to define. This repository consumes them; `normalizeWorkspace` already reads only those four and says so. A rule here would assert ownership this repository does not have. |
| `negative-fixtures-single-defect` (standard) | **Not carried** | No normative negative-fixture corpus exists in this repository. Encoding it would be a rule with no surface. |
| `no-derived-probability` (standard) | **Not carried** | Emission-shape governance belongs to the producer/standard side. This repository reads `strength`/`confidence` tolerantly and emits no artifact. |
| `descriptive-not-prescriptive` (standard, scoped to `packages/spec/**`) | **Adapted, not copied** | Kept as *host adaptation stays descriptive*, rewritten for a repository that legitimately performs host-side enforcement while still never making the artifact prescriptive. |
| `daemon-free` (standard) | **Folded in** | Merged into *clean-room public boundary* rather than standing alone: here the daemon risk arrives as a private-platform reference, not as an artifact field. |
| `reader-producer-distinct` (standard) | **Adapted, not copied** | This repository has no producer. The live half of the concern — tolerance quietly becoming repair — is kept as *reader tolerance is not repair*. |
| CLI producer / commit-history rules | **Not carried** | This repository emits no `workspace.json` and reads no commit graph. No equivalent Integrations failure mode was independently verified, so nothing was encoded. |

## Reviewer roles

`Greptile Review` and `Sourcery` are separate layers with different authority.
See [`docs/review/merge-policy.md`](../docs/review/merge-policy.md) for the
current, measured merge-eligibility contract — including which checks are
required today and what evidence would be needed to change that.
