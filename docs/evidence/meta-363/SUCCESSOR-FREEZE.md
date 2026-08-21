# Successor experiment — frozen design

Frozen 2026-08-21, after the M2B result (META-363, FAIL-PIVOT) and the
recruitment-path inspection recorded in `RECEIPT.md`. **Nothing here has been
run.** No arm may execute until the admission gate below passes.

This document exists so the design is fixed before any treatment output is seen.

## What M2B leaves unanswered

M2B's null has three mutually confounded contributors: no headroom (measured),
schema deferral (measured), and the tool's own description (unmeasured). It
therefore says nothing about whether descriptive repository-history evidence is
useful to a review workflow. The successor's job is to separate those and then
ask the original question properly.

## Admission gate — runs before any arm

Headroom is not a factor. It cannot be varied while holding the repository task
constant, so its levels would come from different scenarios and confound
scenario identity with the manipulation. It is a fixture gate.

```
candidate fixtures
      |
      v
baseline screening (A0)  --- baseline reaches the consequence --> REJECT
      |
      | baseline misses the consequence
      v
   ADMIT, then vary delivery WITHIN the admitted fixture
```

A fixture is admitted only on **measured** baseline failure. Structural
screening may narrow candidates but may never admit one: M2B's discoverability
screen modelled filename references while the actual channel was lexical grep,
and no mechanical screen can predict what a reviewer will grep for.

**No admissible fixture exists yet.** The screen over `workspacejson/standard`
found none that survives the lexical-bridge objection; that repository is small,
densely cross-referenced, and heavily gated. The search must widen to a larger or
messier external repository before anything else happens.

## Arms

All arms hold constant: repository and revision, changed-file input, host
version, model, permission mode, allowed native tools, and profile. Only
delivery varies.

| Arm | Delivery | Isolates |
| -- | -- | -- |
| **A0** Baseline | no adapter | headroom (also the admission measurement) |
| **A1** MCP, deferred | adapter, default config | replicates M2B exactly; two-step recruitment |
| **A2** MCP, `alwaysLoad: true` | adapter, schema preloaded | the deferral step (A1 vs A2) |
| **A3** MCP, preloaded + applicability copy | A2 plus revised description | the description (A2 vs A3) |
| **A4** Hook, forced delivery | evidence prepended, no routing | routing vs value (A2/A3 vs A4) |
| **A5** Perturbed evidence | best-performing delivery, registered pair removed | evidence-attributability |

A5 runs against whichever of A2–A4 shows an effect. If none does, A5 is
uninformative and is not run; that is recorded rather than substituted for.

### A3 — the revised description, frozen now

Same descriptive semantics; adds comparative applicability, which
`SERVER_INSTRUCTIONS` currently omits:

> Historical repository observations for relationships that may not be visible
> from current source, imports, or references. Use them as investigation
> candidates and independently verify consequential claims with repository
> tools.

This is a candidate independent variable, **not a presumed fix**. Nothing tested
so far indicates a description change will work, and no external study cited
here tested applicability guidance.

The tool must not become prescriptive to achieve this. Verdicts, severities,
scores, and recommendations stay out.

### A4 — hook delivery must reuse the MCP implementation

A4 is a separate *surface*, not a separate implementation. The hook must invoke
the same retrieval path the MCP server exposes — one evidence implementation,
two delivery surfaces. Two implementations would diverge, and any A2-vs-A4
difference would then be uninterpretable.

Concretely: a `UserPromptSubmit` hook that runs the adapter's retrieval module
and prepends its rendered output. MCP remains the reference implementation.

## Dependent variables — measured separately, never collapsed

M2B collapsed recruitment and outcome into one number, which is why its null is
uninterpretable. Five variables, recorded per run:

1. `ToolSearch` invocation (A1 only — the deferral step)
2. adapter invocation
3. partner surfaced in the review
4. partner independently inspected by the host
5. consequence correctly stated

A delivery that raises (2) without raising (3)–(5) has produced recruitment
without value. That is a real and reportable outcome, not a failure of the
experiment.

## Order effect — separate measurement, separate arms

Question: does a verified hook intervention increase later *spontaneous* MCP
recruitment in the same session?

This needs a multi-turn session, which the single-shot harness does not provide.
Design:

| | Turn 1 | Turn 2 | Measures |
| -- | -- | -- | -- |
| **B1** | hook delivers evidence; agent verifies the consequence | second changed file, no hook delivery | spontaneous recruitment after a verified payoff |
| **B0** control | ordinary review, no hook delivery | same second changed file | baseline spontaneous recruitment |

Both run under A2/A3 config so that invocation is one step. B1 minus B0 on
adapter invocation in turn 2 is the effect. Anything else — improved turn-2
review quality, for instance — is not this measurement and must not be reported
as it.

This is exploratory. It is listed to keep it from being smuggled into the main
result.

## Harness requirements settled by the recruitment inspection

- **`alwaysLoad: true`** on the server entry removes schema deferral (3/3
  directed probes invoked directly; 4/4 without it required `ToolSearch` first).
  A2–A5 set it. A1 deliberately does not.
- **Profile isolation** uses `CLAUDE_CONFIG_DIR` pointed at a provisioned fresh
  directory (tools 30→25, slash commands 329→42, agents 29→5). `--settings` with
  emptied `enabledPlugins` does **not** isolate. The isolated profile needs
  credentials provisioned or it returns `Not logged in`.
  Isolation is for reproducibility, not to fix deferral — deferral reproduced
  identically under both profiles.
- **`--strict-mcp-config`** stays, so no unrelated MCP server loads.
- **Transcripts** must be `--output-format stream-json --verbose`. Note that
  system-reminders are **not** captured in that stream, so tool-availability
  claims must come from directed probes, never from transcript silence.
- **Reasoning traces** are captured and may be searched, but trace silence is an
  absence of observation, not evidence that something never entered
  deliberation.

## Power

M2B used n=3 per arm. That was adequate for a 0/24 result but cannot detect a
partial rate. The recruitment arms (A1–A3) measure a rate and need n≥10 per arm.
A0 admission screening needs enough runs to establish baseline failure is
reliable, not incidental — n≥5, all of which must miss.

## Preregistration

This file is the preregistration. Any change after the first treatment output is
inspected must be recorded as an amendment with its reason, not edited in place.
