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

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function compareReceipts(reference, candidate) {
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

  const reference = readJson(refPath);
  const candidate = readJson(candPath);

  const violations = compareReceipts(reference, candidate);

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

main();
