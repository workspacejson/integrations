# Conformance taxonomy

Ratified vocabulary for distinguishing standard conformance from first-party adapter parity from external consumer conformance. This is the taxonomy half of META-257; boundary ratification waits for second-adapter evidence (META-260).

## Why this vocabulary exists

A contract harvested from one implementation is not a contract; it is a description. Without a vocabulary that separates "the standard says this" from "our adapter does this," the first adapter's shape leaks into the contract by citation. "Provisional" is not a load-bearing safeguard — provisional ratifications become canonical through repeated reference.

This taxonomy prevents that leak by making the three conformance classes structurally distinct.

## The three conformance classes

### 1. Standard conformance

**Definition:** A workspace.json artifact (file, schema, reference-reader output, rules evaluation) conforms to the published standard when it satisfies the normative contracts in `workspacejson/standard` — not when it matches any particular adapter's behavior.

**Owner:** `workspacejson/standard`

**Test:** An artifact is standard-conformant if a reference reader built from the published spec (not from any adapter's source) reads it without error and produces the expected evidence.

**What it is not:** Standard conformance does not require any first-party runtime. An external consumer who writes a workspace.json reader from the published spec and produces valid evidence is standard-conformant.

### 2. First-party adapter parity

**Definition:** Two or more first-party adapters (Codex, Claude Code, VS Code, CI) exhibit parity when they produce identical behavior on identical inputs against identical workspace.json artifacts. This is internal QA, not a standard contract.

**Owner:** `workspacejson/integrations`

**Test:** Run both adapters against the same fixture workspace.json and compare outputs (exit codes, evidence, hook decisions, MCP responses). The parity receipt mechanism (META-241) is an example of this test.

**What it is not:** Adapter parity does not define the standard. If all first-party adapters share a behavior that the standard does not specify, that behavior is adapter convention, not standard conformance. A second adapter that differs from the first in an unspecified area is not non-conformant — it is revealing an underspecification.

### 3. External consumer conformance

**Definition:** A consumer who has no access to first-party internals (Linear issues, private packages, adapter source, internal discussions) conforms to the standard when they can read, evaluate, and act on workspace.json artifacts using only published materials.

**Owner:** The external consumer

**Test:** Cold read — give an agent or human only the published spec, npm package, and README. Can they produce a conformant reader? Can they interpret a workspace.json artifact correctly? What do they find ambiguous?

**What it is not:** External consumer conformance does not require matching first-party adapter behavior in unspecified areas. The external consumer's interpretation of an underspecified area is valid evidence of underspecification, not a conformance failure.

## Relationship between the three classes

```text
Standard conformance (spec-owned)
  ├── First-party adapter parity (internal QA, proves the standard is implementable)
  └── External consumer conformance (proves the standard is adoptable without insider knowledge)
```

- Standard conformance is the only class that defines normative contracts.
- First-party adapter parity is evidence that the standard is implementable, not a definition of the standard.
- External consumer conformance is evidence that the standard is adoptable, not a weaker form of parity.
- A gap between adapter parity and external conformance reveals an underspecification in the standard, not a failure of the external consumer.

## Capability support classification

When recording adapter capabilities against the standard:

| Classification | Meaning |
| -- | -- |
| **native** | The provider's public API directly supports this capability. |
| **adapted** | The provider's API does not directly support this, but an adapter can synthesize it with documented limitations. |
| **unavailable** | The provider's API does not support this and no adapter synthesis is possible. |

Absence of a capability is **unavailable**, never inferred as safe. "Adapted" must document its limitations; it is not a synonym for "works well enough."

## What this vocabulary prevents

1. **Contract harvesting:** "Codex does X, so the standard requires X" — prevented because adapter behavior is parity, not conformance.
2. **Provisional drift:** "We provisionally ratified X" becoming "X is canonical" — prevented because the taxonomy makes clear which class a claim belongs to.
3. **Underspecification hiding:** "All our adapters do X the same way" implying "X is specified" — prevented because parity is explicitly not conformance.
4. **External exclusion:** "You're not conformant because you don't match our adapter" — prevented because external conformance is measured against the spec, not against adapters.

## Contract classes (provisional)

These are the contract classes from META-257. They are provisional until second-adapter evidence (META-260) forces changes. The vocabulary above governs their interpretation.

1. **Stable standard-owned inputs/results** — artifact discovery/read/validation status; standard/rules evidence and conformance fixtures.
2. **Provisional integration delivery contracts** — changed path/changeset request; deterministic gate result with evidence references; availability/provenance receipt.
3. **Narrow optional capability ports** — authorization exception; batch changeset acquisition; workspace watch/invalidation; native advisory review (only if equivalent semantics are later proven).

## Exit criteria for provisional interfaces

Every provisional interface must declare:

- What evidence would stabilize it (second adapter? external consumer? cold read?)
- What evidence would retire it (no adapter supports it? standard drops it?)
- What evidence would change it (second adapter differs in a way that forces a contract change?)

An interface with no exit criteria is not provisional; it is permanent in disguise.
