# Candidate C4 — frozen BEFORE any baseline run

## Identity
- Repository: polyfy/polylith
- Reviewed revision: 68dab9868274c8044817983c2424fbdbd616a456
- Artifact: workspacejson/standard@a034339 docs/evidence/meta-310/polylith.workspace.json
- Artifact sha256: 848540525a7b20842105eea5b62024604580fb63ad615b5d962c49d6e5e82c8a
- generated.basisRevision: 68dab9868274c8044817983c2424fbdbd616a456  (== reviewed revision -> FRESH)
- Producer: @workspacejson/cli@0.5.2
- Changed file: components/command/src/polylith/clj/core/command/core.clj

## Historical evidence (workspace.json terminology, verbatim)
generated.coChange entry:
  files: [components/command/src/polylith/clj/core/command/core.clj,
          components/user-input/src/polylith/clj/core/user_input/core.clj]
  support: 14
  occurrences: 35
This is a symmetric historical observation. It is not a dependency, not
causality, not a required change, not blast radius, not a recommendation,
not a risk score, and not correctness evidence.
The changed file has exactly one registered partner in this artifact.

## Diff / task
Single-file change adding a `:quiet` flag that suppresses the `::`
deprecation message: `is-quiet` is added to `execute`'s `:keys`
destructuring and guards `print-deprecation-message`.

## Proposed consequence (preregistered)
`is-quiet` is never produced. `user_input/core.clj:extract-arguments`
builds the user-input map from (a) a closed `{:keys [...]}` enumeration of
`named-args` which contains no `quiet!`, and (b) a closed `util/ordered-map`
call which contains no `:is-quiet`. Therefore `is-quiet` is always nil and
`poly <cmd> :: :quiet` still prints the deprecation message: the new flag
silently does nothing.

Objectively verified independently of the co-change observation:
- `grep -rn "is-quiet|:quiet|quiet!"` over *.clj/*.edn/*.adoc/*.md at the
  reviewed revision returns zero hits.
- `user_input/core.clj` contains no `quiet` token.
- `args.clj:key-name` maps CLI `:quiet` to named-arg key `:quiet!`, which the
  `extract-arguments` destructuring does not bind.
The co-change relationship is NOT used as proof of this consequence.

## Discovery bridges (screened, recorded — this screen may reject, never admit)
RECORDED BRIDGE (one hop, strong): the token `is-search-for-ws-dir` appears on
BOTH changed lines and occurs at the registered partner
`components/user-input/src/polylith/clj/core/user_input/core.clj:154`.
A reviewer grepping that identifier reaches the partner file in one hop.
Other keys on the changed destructuring line (is-verbose, is-tap, is-github,
is-fake-poly, ...) bridge the same way.

Bridges NOT present:
- no `:require` edge in either direction between the two files
- command/core.clj does not require polylith.clj.core.user-input.*
- no path, filename, or basename reference in either direction
- different components, different directories, no directory adjacency
- no comment in either file naming the other
- caller chain is indirect: command/core.clj <- command/interface.clj <-
  bases/poly-cli/core.clj -> user-input.interface -> user_input/core.clj

Mitigating note: the bridge reaches the partner FILE. Reaching the
CONSEQUENCE additionally requires recognising that the destructuring and
`ordered-map` are closed enumerations, so the absent key is always nil.

## Predeclared discovery criteria (recorded separately, never collapsed)
1. partner named: run names user_input/core.clj, the user-input component, or
   `extract-arguments` as where the user-input map is built
2. partner opened: FILES INSPECTED lists user_input/core.clj (or a trace shows
   it read)
3. consequence stated: run states the flag is never set / always nil / has no
   effect / needs parser wiring
4. consequence correctly grounded: run cites the closed enumeration in
   user_input/core.clj (or args.clj) as the reason

DISCOVERY = (1) AND (2) AND (3).
A generic "make sure this is wired up" caveat that neither names nor opens the
partner is NOT discovery; it is recorded separately as partial.
If a run reaches the consequence correctly grounded in the real arg-parsing
code without using the registered path name, that COUNTS as discovery.

## Admission rule
n = 5 baseline runs. ADMIT only on 0/5 discovery. Any single discovery REJECTS.
No reruns, no prompt edits, no consequence weakening, no partner substitution
after output is seen.
