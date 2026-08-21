# M2B Native Evidence Integration Receipt

**Date:** 2026-08-21 (UTC). **Experiment:** META-363 / M2B.
**Prior result:** M2A — [`workspacejson/standard@a034339`](https://github.com/workspacejson/standard/tree/a034339ddb3a0482ede258cb57cef828c15e26eb/docs/evidence/meta-362), disposition [META-372](https://linear.app/marcelle-labs/issue/META-372) NARROW.
**Disposition:** **FAIL-PIVOT** — native packaging did not preserve useful causal value.

> This directory is an experiment receipt. It is not normative workspace.json
> specification semantics, a conformance requirement, an adoption claim, or a
> claim that these results generalize beyond the one host, one scenario, and one
> delivery mode tested here.

## What was tested

Whether the bounded capability observed in M2A — descriptive repository evidence
causally changing what an existing review workflow investigates — survives
packaging as one optional, host-native integration.

## Host

| | |
| -- | -- |
| Host | Claude Code |
| Version | 2.1.238 |
| Model | `claude-sonnet-5` |
| Native surface used | MCP stdio server (`claude mcp add` / `claude mcp remove`) |
| Native repository inspection | Yes — Read, Grep, Glob, Bash |

Graphify was evaluated first and rejected on fit; see "Graphify" below.

## Adapter

| | |
| -- | -- |
| Repository | `workspacejson/integrations` |
| Surface | MCP stdio server, one read-only tool `workspace_review_evidence` |
| Entrypoint | `dist/claude-code/server.js` |
| Version | 0.1.0 |
| Source | `src/claude-code/artifact.ts`, `src/claude-code/server.ts` |

The adapter performs no mining. `support` and `occurrences` are read verbatim
from `generated.coChange`; provenance from `generated.basisRevision`,
`generated.generatedAt`, `generated.by`. Path resolution and key matching are
imported from the existing `services/workspace.ts` and `path-match.ts`.

## Evidence input

| | |
| -- | -- |
| Repository | `workspacejson/standard` |
| Revision | `a034339ddb3a0482ede258cb57cef828c15e26eb` |
| Artifact | `.agents/workspace.json`, sha256 `9fff32e0c015a7ffc3411342afa4374e5fc63db3cd1c53c8618233b8cf92c81b` |
| Producer | `@workspacejson/cli@0.5.2` |
| Spec version | `0.4` |
| Artifact basis revision | `8e08c8c5cd110e7f95bbd52246ea295c22b072e3` |
| Freshness during the runs | **STALE** — basis revision is behind the reviewed revision, and the adapter said so on every call |

## Registered scenario

Preregistered in META-363 before any treatment output was inspected.

| | |
| -- | -- |
| Changed file | `packages/spec/src/schema.ts` (single-file diff adding a top-level `provenance` property) |
| Registered partner | `packages/spec/schema/v1.json` — `support: 10`, `occurrences: 11` |
| Coupling | Hand-maintained parallel schema mirrors. Not an import edge; invisible to static analysis and invisible from the diff. |
| Consequence | `packages/spec/src/index.test.ts:324` asserts the two mirrors' top-level property keys are equal. The diff breaks it. |

The consequence is real and was independently confirmed: `v1.json` declares
top-level properties `['agents','generated','health','manual','version']` with
`additionalProperties: false`, and the diff adds `provenance` to the TypeScript
mirror only.

## Results — 30 runs, 10 arms

Held constant across every arm: repository and revision, diff, host version,
model, allowed native tools, permission mode. The only variables are whether the
adapter was configured, whether it was pointed at, and the prompt variant.

| Arm | n | Partner surfaced | Partner inspected by host | **Adapter calls** |
| -- | -- | -- | -- | -- |
| baseline (directive prompt, no adapter) | 3 | 3/3 | not instrumented | 0 |
| treatment (adapter present) | 3 | 3/3 | not instrumented | 0 |
| perturbation (registered pair removed) | 3 | 3/3 | not instrumented | 0 |
| treatment-instrumented | 3 | 3/3 | 3/3 | **0** |
| treatment-invoked (adapter pointed at) | 3 | 3/3 | 3/3 | **0** |
| perturbation-invoked | 3 | 3/3 | 3/3 | **0** |
| n-baseline (neutral prompt, no adapter) | 3 | 3/3 | 3/3 | 0 |
| n-treatment | 3 | 3/3 | 3/3 | **0** |
| n-treatment-invoked | 3 | 3/3 | 3/3 | **0** |
| n-perturbation-invoked | 3 | 3/3 | 3/3 | **0** |

**Evidence-attributable behavioral delta: none.**

### Finding 1 — the host never called the adapter (0/30)

The adapter was configured in 24 of the 30 runs. In the 18 of those carrying
structured traces, the session `init` event recorded
`mcp_servers: [{"name":"workspacejson-review-evidence","status":"connected"}]`
and exposed `mcp__workspacejson-review-evidence__workspace_review_evidence` in
the tool list; the other 6 were the text-only first pass, where connection was
not separately recorded. The host called the tool zero times in all 24.

This includes 9 runs (`treatment-invoked`, `n-treatment-invoked`,
`n-perturbation-invoked`) whose prompt stated: *"Repository-history context for
the changed files is available from the connected MCP tools; consult it if you
find it useful."* The host still did not call it, using Read/Grep/Bash instead.

The adapter was connected and reachable in every case where connection was
recorded. This is a finding about what the host chose, not a harness failure.

Reasoning traces were captured for 18 of the 24 adapter-configured runs. Across
all 18, neither `workspace_review_evidence` nor `mcp` appears anywhere in the
recorded thinking.

State that as what it is: **no observed evidence, in the captured traces, that
the tool entered deliberation.** Traces are observations, not a guaranteed
exhaustive readout of the model's reasoning, so trace silence does not establish
that the tool was never internally considered. What is established behaviorally
is that it was exposed, connected, available, called zero times, and never
mentioned in anything recorded.

The distinction that survives is between *no observed weighing* and *observed
rejection*: nothing in these runs shows the tool being considered and turned
down. Why is not established here. An available capability redundant with a
cheaper familiar route might never surface for exactly that reason, and this
data cannot separate that from the surface, or the tool's own description,
failing to recruit it.

### Finding 2 — there was no baseline gap to close

Baseline surfaced the registered partner in 3/3 runs under both prompt variants,
opened `packages/spec/schema/v1.json` itself, and cited
`packages/spec/src/index.test.ts:324` as the broken invariant — the exact
consequence the evidence was supposed to lead it to.

A first pass used a prompt containing *"if a claim rests on a file that is not in
the diff, open that file and confirm it before reporting"*, which is itself an
instruction to explore beyond the diff and could have handed baseline the
partner. The `n-` arms re-ran with that sentence removed. Baseline still found
the partner 3/3. The instruction was not the cause.

### Finding 3 — the perturbation could not be load-bearing at the review level

Removing the registered pair from the artifact removes exactly that partner from
the adapter's response and leaves the other 7 intact (verified below). The
adapter is load-bearing at the tool level. But because the host never called the
tool, the perturbation had no path to the review, and the perturbation arms are
indistinguishable from baseline. This is a null result caused by Finding 1, not
independent evidence about the evidence.

### Proposed mechanism — a hypothesis, not an established boundary condition

M2A's Scenario A effect was measured against a reviewer with **no filesystem
access** (META-366), receiving evidence **injected directly into the diff text**.
Both conditions are absent here: Claude Code reads the repository natively, and
the adapter's delivery is opt-in.

It is plausible that native repository inspection both removes the need for the
evidence and makes an optional tool unattractive next to Grep — that the very
capability which closes M2A's verification limitation also erases M2A's
demonstrated advantage. **This is a hypothesis arising from the observed
results. It was not experimentally isolated and must not be promoted to an
established boundary condition.**

## Degraded-evidence controls: 4/4 sound

Exercised through the real MCP protocol (`protocol/degraded.mjs`), not the unit
test seam. Full output in `degraded-controls.txt`.

| Condition | Result | Affirmative safety language |
| -- | -- | -- |
| Artifact present | evidence returned, `freshness: stale`, partner present | absent |
| Registered pair removed | partner absent, other 7 partners intact | absent |
| Artifact absent | `isError: true`, `status: no-artifact`, paths searched named | absent |
| Artifact malformed | `isError: true`, `status: unreadable`, "not an absence of risk" | absent |

Stale evidence was flagged as stale on every successful call, naming both
revisions and stating that commits after the basis revision are not reflected —
so a missing partner is never mistaken for a partner that does not exist. No
degraded condition produced an affirmative statement about the change.

15 unit tests additionally pin absent counts as `null` rather than a
placeholder number, refuse absolute paths not provably inside the repository
root, and assert the rendered text carries no dependency, causal, or
prescriptive vocabulary.

## Install / removal lifecycle: verified

Full output in `lifecycle-verification.txt`.

| Step | Result |
| -- | -- |
| `claude mcp add --scope local` | added; `claude mcp list` → `✔ Connected` |
| `claude mcp add --scope project` | writes `.mcp.json`; host prompts for approval (native trust gate) |
| `claude mcp remove` | removed from config; `claude mcp list` → absent |
| Host after removal | returns to baseline behavior and remains usable |
| Repository after removal | untouched — the adapter holds no state and writes nothing |

## Graphify — evaluated first, rejected on fit

Inspected `graphifyy` 0.9.25 (https://github.com/Graphify-Labs/graphify).
Graphify owns real impact/review workflows (`graphify affected`, `graphify prs`,
MCP tools `get_pr_impact`, `query_graph`). What it lacks is a surface for
optional third-party review-time context:

- every review surface is a closed read over graphify-owned `graphify-out/graph.json`;
- `entry_points.txt` declares only console scripts — no plugin group;
- deterministic ingest sources are hardcoded in-tree (`extract.py:4182`, `:4187`);
- `resolver_registry.py` is populated by `extract.py` itself.

**Exact failed fit criterion: #5, "the integration can be installed and removed
cleanly."** The only routes in are patching `extract.py` (an invasive host
change) or writing co-change edges into `graph.json` (which would relabel
symmetric history as a graph relation beside `calls`/`imports`, require
reimplementing Graphify's `make_id`, and need a full rebuild to undo). Graphify
was not forced.

## What this does and does not establish

**Established:**

1. The proven M2A evidence seam can be packaged as a genuinely optional, cleanly
   removable, host-native integration with sound degraded-evidence semantics and
   no standard change, no daemon, and no CLI intelligence duplicated.
2. In this host, on this scenario, availability alone did not put the evidence
   into the review workflow: 0 calls in 30 runs, including 9 where the tool was
   explicitly pointed at.
3. In this host, on this scenario, there was no baseline gap for the evidence to
   close: baseline surfaced and independently verified the registered partner
   3/3 under two prompt variants.

**Not established:**

1. That co-change evidence is useless to review workflows. One scenario in one
   host with one delivery mode was tested. This is not a survey.
2. That native repository access is the cause. That is a hypothesis (above).
3. Anything about delivery modes not tested here — in particular a Claude Code
   hook that prepends evidence to the review input, which would be forced rather
   than opt-in delivery. It was not tested, and on this scenario it could not
   have produced a delta anyway, because baseline already reached the ceiling.
4. Any safety, adoption, conformance, or review-quality claim.

## Reproducing

```bash
git -C <standard> worktree add --detach <work>/repo a034339ddb3a0482ede258cb57cef828c15e26eb
cd <integrations> && npm install && npm run build
bash protocol/run.sh && bash protocol/run2.sh && bash protocol/run3.sh
node protocol/degraded.mjs
python3 protocol/analyze.py
```

Per-run transcripts are under `runs/<arm>/`; `summary.json` is the distilled
table; `MANIFEST.json` carries a SHA-256 for every file. Session-local absolute
paths were replaced with `<REPO>`, `<WORKDIR>`, `<INTEGRATIONS>`, and `<HOME>`;
the redaction patterns are recorded in `MANIFEST.json`. No credentials appear in
these artifacts — the host was invoked through the local `claude` CLI and the
adapter reads only a local file.

---

# Post-hoc addendum (2026-08-21)

Added after META-363 closed. This does not revise any result above. It records
one unresolved confound in the instrument and sets terms for a successor
experiment, so that neither gets rediscovered later as a surprise.

## Unresolved instrument confound: the tool's own description

The adapter describes itself to the host as returning *"observations, never
findings, verdicts, severities, or recommendations."*

That wording is semantically correct for workspace.json and the descriptive
boundary it protects is not negotiable. But as host-facing integration copy,
read by an agent that is at that moment trying to produce findings, it may
communicate something narrower and less useful than intended: *this will not
help you produce the thing you are working on*. If so, the description is
plausibly under-recruiting the tool.

This is **an unresolved confound in the instrument, not an explanation of the
null.** It was not manipulated, so nothing here shows it mattered. It is
recorded because it is a flaw in what was built, not a finding about the host,
and because it is confounded with the surface itself in every run above.

Three candidate explanations for zero invocation are mutually confounded in
this data, all predicting the same observations:

1. **No headroom** — the capability was outcome-redundant on this scenario
   (measured: baseline 3/3).
2. **Surface** — an optional MCP tool under-recruited against general native
   primitives.
3. **Description** — the self-limiting copy above.

Separating them requires manipulation, not reinterpretation of these runs.

A description can be made comparatively legible without becoming prescriptive.
Something in the shape of: *historical repository observations for
relationships that may not be visible from current source, imports, or
references; use them as investigation candidates and verify consequential
claims with repository tools.* Same descriptive semantics, clearer reason to
select it. That is a candidate independent variable, **not a presumed fix** —
nothing tested here says a description change would work.

## Successor design: screening gate, not a factorial

An earlier sketch proposed a headroom x surface 2x2. That was wrong. Headroom
cannot be manipulated while holding the repository task constant — the two
levels would come from different scenarios, confounding scenario identity with
the factor.

Headroom is a **fixture admission gate**, not a factor:

```
candidate fixtures
      |
      v
baseline-headroom screening  --- baseline finds the consequence --> REJECT
      |
      | baseline misses the consequence
      v
   ACCEPT, then manipulate delivery WITHIN the accepted fixture
```

Screening is empirical. A fixture is admitted only when baseline is measured to
miss the consequence, never when it is assumed to.

That empirical requirement is load-bearing, not a formality. A mechanical
pre-screen was run over the 50 co-change pairs in this repository's artifact,
scoring each on whether either file references the other by path or basename,
and whether they share a directory or package. M2B's own fixture scores 2 of 4,
which is consistent with its failure. Thirteen pairs score 0.

But the screen is too weak to admit anything on its own. It models discovery by
filename reference, and the actual discovery channel in M2B was **lexical**: the
reviewer grepped identifiers out of the diff and followed them. Two of the
strongest zero-scoring pairs turn out to be well bridged that way —
`packages/rules/package.json` reaches `packages/spec/package.json` through the
`@workspacejson/spec` dependency name, and `.github/workflows/ci.yml` reaches
the root `package.json` through eight npm script names. Neither bridge involves
a filename.

Modelling that channel properly would mean predicting what a reviewer will grep
for, which depends on the diff that does not exist yet. So **headroom is not
mechanically screenable.** A pre-screen can only narrow candidates; admission
has to come from measuring baseline. Assuming headroom from structure is the
mistake M2B already made.

Within an accepted fixture, the arms:

| Arm | Question |
| -- | -- |
| Baseline | Is there genuine headroom? (also the admission measurement) |
| Current MCP | Does ordinary availability recruit the tool? |
| Applicability-scaffolded MCP | Does clearer comparative applicability change selection? |
| Forced native delivery | Does the evidence help once routing is removed? |
| Perturbed evidence | Is any observed effect actually evidence-attributable? |

Invocation rate and review outcome are separate dependent variables. M2B
conflated them, and that is why its null is uninterpretable.

## Preserved hypothesis: specialized-tool recruitment

M2B's zero invocation is adjacent to routing-commitment analysis but is not an
instance of its named failure classes. Mode confusion is structurally
impossible here (single-function tool). Schema-induced abstention does not
apply on either clause of its definition: the agent invoked other tools
heavily, and no alternate *invocation* surface was tested — M2A's injected
evidence is forced delivery that bypasses routing, not a competing surface.

Nor is it wrong-tool selection. The adapter and the native primitives did not
hold the same capability: the adapter offered historical relationship
evidence, the primitives offered source inspection. They were merely
**outcome-substitutable in this fixture** — both routes reached the partner
file and the invariant.

What that suggests is a question sitting *before* the invoke/tool/mode
decisions rather than inside them:

> What causes a specialized informational tool to enter an agent's
> consideration set at all, when familiar general-purpose primitives can
> reconstruct the same outcome?

Call it **specialized-tool recruitment**, or consideration-set formation. A
controlled router chooses among exposed capabilities; a coding agent can reach
one outcome through a specialized tool, or Read, or Grep, or Bash, or
combinations of them. That difference is a plausible generalization boundary
for routing-commitment framing.

This is a **hypothesis for future work**. It is not a result of this
experiment, and it is not a finding of any external study. Nothing above tests
it.
