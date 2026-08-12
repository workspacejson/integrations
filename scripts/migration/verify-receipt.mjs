#!/usr/bin/env node
/**
 * Compares a freshly generated parity receipt against a committed reference.
 * Used in CI to prove the committed receipt is reproducible — not just a
 * local claim. Fails on any divergence in verdict, summary counts, or
 * individual check statuses/violations.
 *
 * Non-deterministic fields are deliberately ignored:
 *   - generatedAt, startedAt (timestamps)
 *   - toolchain (platform/node version differences)
 *   - refs.targetSha (branch may have moved between local and CI)
 *   - checks[].evidence (contains platform-specific paths, VSIX SHA256
 *     hashes that differ between macOS/Linux zip implementations, etc.)
 *
 * What IS compared:
 *   - verdict (PARITY / DIVERGENT / INCOMPLETE)
 *   - summary (total, passed, failed, unsupported)
 *   - checks[].id (same set of checks ran)
 *   - checks[].status (pass/fail/unsupported — the actual verdict)
 *   - checks[].violations (same violation messages)
 *   - intentionalDifferences (same declared differences)
 *
 * Usage:
 *   node scripts/migration/verify-receipt.mjs <reference.json> <candidate.json>
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * Read a receipt, failing with a message a CI reader can act on.
 *
 * A raw `ENOENT` or `SyntaxError` stack from a gate script says nothing about
 * which of the two receipts was bad or what was expected of it. `label` names
 * the role so the failure is legible without opening the script.
 */
export function readReceipt(path, label = "receipt") {
  let raw;
  try {
    raw = readFileSync(path, "utf8");
  } catch (err) {
    if (err.code === "ENOENT") {
      throw new Error(`${label} not found: ${path}\nExpected a parity receipt JSON file at this path.`);
    }
    throw new Error(`${label} could not be read: ${path}\n${err.message}`);
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(`${label} is not valid JSON: ${path}\n${err.message}`);
  }

  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    const kind = Array.isArray(parsed) ? "array" : parsed === null ? "null" : typeof parsed;
    throw new Error(`${label} is not a receipt object: ${path}\nParsed a ${kind}.`);
  }
  return parsed;
}

/**
 * Reject a receipt missing the fields the comparator reads.
 *
 * Without this, a receipt lacking `summary` or `checks` throws a raw
 * `TypeError` from inside the comparison, and a well-formed receipt with an
 * empty check set compares clean against another empty one — a vacuous pass
 * on the gate's own input.
 */
function assertReceiptShape(receipt, label) {
  const problems = [];
  if (typeof receipt.verdict !== "string") problems.push("missing 'verdict' string");
  if (!receipt.summary || typeof receipt.summary !== "object") problems.push("missing 'summary' object");
  if (!Array.isArray(receipt.checks)) problems.push("missing 'checks' array");
  else if (receipt.checks.length === 0) problems.push("'checks' is empty — nothing to compare");
  else if (receipt.checks.some((c) => !c || typeof c.id !== "string")) {
    problems.push("'checks' contains an entry without a string 'id'");
  }

  if (problems.length > 0) {
    throw new Error(`${label} is not a usable parity receipt:\n${problems.map((p) => `  - ${p}`).join("\n")}`);
  }
}

/**
 * The single comparator implementation.
 *
 * Exported so `tests/migration/verify-receipt.test.ts` exercises THIS function
 * rather than a copy. The test previously reimplemented it inline, so the two
 * drifted — the copy's violation messages already differed from these — and
 * the tests could not have caught a regression in the comparator that actually
 * runs in CI (META-140 defect class, recorded on META-285).
 */
export function compareReceipts(reference, candidate) {
  assertReceiptShape(reference, "reference receipt");
  assertReceiptShape(candidate, "candidate receipt");

  const violations = [];

  if (reference.verdict !== candidate.verdict) {
    violations.push(`verdict diverged: reference=${reference.verdict} candidate=${candidate.verdict}`);
  }

  for (const field of ["total", "passed", "failed", "unsupported"]) {
    if (reference.summary[field] !== candidate.summary[field]) {
      violations.push(
        `summary.${field} diverged: reference=${reference.summary[field]} candidate=${candidate.summary[field]}`,
      );
    }
  }

  const refChecks = new Map(reference.checks.map((c) => [c.id, c]));
  const candChecks = new Map(candidate.checks.map((c) => [c.id, c]));

  const missingInCandidate = [...refChecks.keys()].filter((id) => !candChecks.has(id));
  const missingInReference = [...candChecks.keys()].filter((id) => !refChecks.has(id));

  for (const id of missingInCandidate) {
    violations.push(`check '${id}' present in reference but missing from candidate`);
  }
  for (const id of missingInReference) {
    violations.push(`check '${id}' present in candidate but missing from reference`);
  }

  for (const [id, refCheck] of refChecks) {
    const candCheck = candChecks.get(id);
    if (!candCheck) continue;

    if (refCheck.status !== candCheck.status) {
      violations.push(`check '${id}' status diverged: reference=${refCheck.status} candidate=${candCheck.status}`);
    }

    const refViolations = JSON.stringify(refCheck.violations ?? []);
    const candViolations = JSON.stringify(candCheck.violations ?? []);
    if (refViolations !== candViolations) {
      violations.push(
        `check '${id}' violations diverged:\n  reference: ${refViolations}\n  candidate: ${candViolations}`,
      );
    }
  }

  const refDiffs = JSON.stringify(reference.intentionalDifferences ?? []);
  const candDiffs = JSON.stringify(candidate.intentionalDifferences ?? []);
  if (refDiffs !== candDiffs) {
    violations.push(`intentionalDifferences diverged:\n  reference: ${refDiffs}\n  candidate: ${candDiffs}`);
  }

  return violations;
}

function main() {
  const [refPath, candPath] = process.argv.slice(2);

  if (!refPath || !candPath) {
    console.error("Usage: node scripts/migration/verify-receipt.mjs <reference.json> <candidate.json>");
    process.exit(2);
  }

  let reference;
  let candidate;
  let violations;
  try {
    reference = readReceipt(refPath, "reference receipt");
    candidate = readReceipt(candPath, "candidate receipt");
    violations = compareReceipts(reference, candidate);
  } catch (err) {
    // Exit 2 — a gate that could not read its inputs did not run. That is
    // distinct from exit 1, "the receipts diverged", which is a real result.
    console.error(`Receipt reproduction COULD NOT RUN:\n\n${err.message}\n`);
    process.exit(2);
  }

  if (violations.length > 0) {
    console.error("Receipt reproduction FAILED — committed receipt does not match CI-generated receipt:\n");
    for (const v of violations) console.error(`  - ${v}`);
    console.error(
      "\nThis means the committed parity receipt is not reproducible. META-241 cannot close on an unreproduced claim.",
    );
    process.exit(1);
  }

  console.log(
    `Receipt reproduction PASSED — ${reference.checks.length} checks, verdict ${reference.verdict}, all statuses and violations match the committed reference.`,
  );
}

const isDirectRun = process.argv[1] === fileURLToPath(import.meta.url);
if (isDirectRun) {
  main();
}
