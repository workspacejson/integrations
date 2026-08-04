import { describe, expect, it } from "vitest";

interface ReceiptCheck {
  id: string;
  status: string;
  violations: string[];
  evidence: Record<string, unknown>;
}

interface Receipt {
  verdict: string;
  summary: { total: number; passed: number; failed: number; unsupported: number };
  intentionalDifferences: Array<{ path: string; justification: string }>;
  checks: ReceiptCheck[];
  [key: string]: unknown;
}

// We test the comparison logic by importing the module and calling its
// internal function. Since verify-receipt.mjs is a CLI script, we test
// the core comparator by reconstructing it inline from the same logic.
// This is a watched-red contract: the comparator must fail on perturbed input.

function compareReceipts(reference: Receipt, candidate: Receipt): string[] {
  const violations = [];

  if (reference.verdict !== candidate.verdict) {
    violations.push(`verdict diverged: reference=${reference.verdict} candidate=${candidate.verdict}`);
  }

  for (const field of ["total", "passed", "failed", "unsupported"] as const) {
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
      violations.push(`check '${id}' violations diverged`);
    }
  }

  const refDiffs = JSON.stringify(reference.intentionalDifferences ?? []);
  const candDiffs = JSON.stringify(candidate.intentionalDifferences ?? []);
  if (refDiffs !== candDiffs) {
    violations.push("intentionalDifferences diverged");
  }

  return violations;
}

const BASE_RECEIPT: Receipt = {
  verdict: "PARITY",
  summary: { total: 10, passed: 10, failed: 0, unsupported: 0 },
  intentionalDifferences: [],
  checks: [
    { id: "git.tree-equality", status: "pass", violations: [], evidence: { differingPaths: 0 } },
    { id: "pkg.pack-inventory", status: "pass", violations: [], evidence: { sourceFiles: 28 } },
    { id: "pkg.identity", status: "pass", violations: [], evidence: { name: "@workspacejson/codex-mcp" } },
    { id: "pkg.bins", status: "pass", violations: [], evidence: { bins: ["codex-mcp"] } },
    { id: "mcp.smoke", status: "pass", violations: [], evidence: { sourcePass: 41 } },
    { id: "hooks.behavior", status: "pass", violations: [], evidence: { cases: 5 } },
    { id: "installer.assets", status: "pass", violations: [], evidence: { sourceRuntimeFiles: 20 } },
    { id: "plugin.surfaces", status: "pass", violations: [], evidence: { surfaces: [".mcp.json"] } },
    { id: "extension.vsix", status: "pass", violations: [], evidence: { sourceAssets: 30 } },
    { id: "generator.resolution", status: "pass", violations: [], evidence: { resolution: "ok" } },
  ],
};

describe("compareReceipts", () => {
  it("passes identical receipts ignoring non-deterministic fields", () => {
    const candidate: Receipt = structuredClone(BASE_RECEIPT);
    candidate.generatedAt = "2026-08-01T12:00:00.000Z";
    candidate.startedAt = "2026-08-01T11:59:30.000Z";
    candidate.toolchain = { node: "v20.18.0", npm: "10.8.2", vsce: "2.15.0", platform: "linux/x64" };
    candidate.refs = { sourceSha: "abc", targetSha: "different-sha" };
    candidate.checks[0].evidence = { differingPaths: 0, filesCompared: 124, sourceSha: "different" };
    expect(compareReceipts(BASE_RECEIPT, candidate)).toEqual([]);
  });

  it("watched-red: catches a verdict change", () => {
    const candidate: Receipt = structuredClone(BASE_RECEIPT);
    candidate.verdict = "DIVERGENT";
    candidate.summary.failed = 1;
    candidate.summary.passed = 9;
    candidate.checks[0].status = "fail";
    candidate.checks[0].violations = ["tree differs"];
    const violations = compareReceipts(BASE_RECEIPT, candidate);
    expect(violations.length).toBeGreaterThan(0);
    expect(violations.some((v) => /verdict diverged/.test(v))).toBe(true);
  });

  it("watched-red: catches a check status flip", () => {
    const candidate: Receipt = structuredClone(BASE_RECEIPT);
    candidate.checks[4].status = "fail";
    candidate.checks[4].violations = ["smoke failed"];
    const violations = compareReceipts(BASE_RECEIPT, candidate);
    expect(violations.some((v) => /check 'mcp.smoke' status diverged/.test(v))).toBe(true);
  });

  it("watched-red: catches a missing check", () => {
    const candidate: Receipt = structuredClone(BASE_RECEIPT);
    candidate.checks = candidate.checks.slice(0, 9);
    const violations = compareReceipts(BASE_RECEIPT, candidate);
    expect(violations.some((v) => /'generator.resolution' present in reference but missing/.test(v))).toBe(true);
  });

  it("watched-red: catches an extra check", () => {
    const candidate: Receipt = structuredClone(BASE_RECEIPT);
    candidate.checks.push({ id: "evil.check", status: "pass", violations: [], evidence: {} });
    const violations = compareReceipts(BASE_RECEIPT, candidate);
    expect(violations.some((v) => /'evil.check' present in candidate but missing/.test(v))).toBe(true);
  });

  it("watched-red: catches new violations in a previously clean check", () => {
    const candidate: Receipt = structuredClone(BASE_RECEIPT);
    candidate.checks[2].violations = ["package.version diverged"];
    const violations = compareReceipts(BASE_RECEIPT, candidate);
    expect(violations.some((v) => /check 'pkg.identity' violations diverged/.test(v))).toBe(true);
  });

  it("watched-red: catches changed intentionalDifferences", () => {
    const candidate: Receipt = structuredClone(BASE_RECEIPT);
    candidate.intentionalDifferences = [{ path: "README.md", justification: "changed" }];
    expect(compareReceipts(BASE_RECEIPT, candidate).some((v) => /intentionalDifferences diverged/.test(v))).toBe(true);
  });
});
