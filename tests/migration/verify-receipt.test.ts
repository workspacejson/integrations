import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
// The comparator under test is imported, never reimplemented. An earlier
// version of this file rebuilt `compareReceipts` inline, so the tests verified
// a copy: the real comparator could regress without a single test failing, and
// the copy's violation messages had already drifted from the source
// (META-140 one-concept-two-implementations class, recorded on META-285).
import { compareReceipts, readReceipt } from "../../scripts/migration/verify-receipt.mjs";

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
  it("watched-green: passes identical receipts ignoring non-deterministic fields", () => {
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

  it("watched-red: catches a summary count change", () => {
    const candidate: Receipt = structuredClone(BASE_RECEIPT);
    candidate.summary.unsupported = 2;
    const violations = compareReceipts(BASE_RECEIPT, candidate);
    expect(violations.some((v) => /summary\.unsupported diverged/.test(v))).toBe(true);
  });

  it("watched-red: catches a check status flip", () => {
    const candidate: Receipt = structuredClone(BASE_RECEIPT);
    candidate.checks[4].status = "fail";
    candidate.checks[4].violations = ["smoke failed"];
    const violations = compareReceipts(BASE_RECEIPT, candidate);
    expect(violations.some((v) => /check 'mcp\.smoke' status diverged/.test(v))).toBe(true);
  });

  it("watched-red: catches a missing check", () => {
    const candidate: Receipt = structuredClone(BASE_RECEIPT);
    candidate.checks = candidate.checks.slice(0, 9);
    const violations = compareReceipts(BASE_RECEIPT, candidate);
    expect(violations.some((v) => /'generator\.resolution' present in reference but missing/.test(v))).toBe(true);
  });

  it("watched-red: catches an extra check", () => {
    const candidate: Receipt = structuredClone(BASE_RECEIPT);
    candidate.checks.push({ id: "evil.check", status: "pass", violations: [], evidence: {} });
    const violations = compareReceipts(BASE_RECEIPT, candidate);
    expect(violations.some((v) => /'evil\.check' present in candidate but missing/.test(v))).toBe(true);
  });

  it("watched-red: catches new violations in a previously clean check", () => {
    const candidate: Receipt = structuredClone(BASE_RECEIPT);
    candidate.checks[2].violations = ["package.version diverged"];
    const violations = compareReceipts(BASE_RECEIPT, candidate);
    expect(violations.some((v) => /check 'pkg\.identity' violations diverged/.test(v))).toBe(true);
  });

  it("watched-red: catches changed intentionalDifferences", () => {
    const candidate: Receipt = structuredClone(BASE_RECEIPT);
    candidate.intentionalDifferences = [{ path: "README.md", justification: "changed" }];
    expect(compareReceipts(BASE_RECEIPT, candidate).some((v) => /intentionalDifferences diverged/.test(v))).toBe(true);
  });

  // Asserted against the real comparator's exact text. While the test owned a
  // copy, these strings could drift from the shipped ones unnoticed — and had.
  it("reports the actual reference and candidate values in the violation text", () => {
    const candidate: Receipt = structuredClone(BASE_RECEIPT);
    candidate.verdict = "DIVERGENT";
    const [violation] = compareReceipts(BASE_RECEIPT, candidate);
    expect(violation).toBe("verdict diverged: reference=PARITY candidate=DIVERGENT");
  });

  // A comparator that accepts a structurally empty receipt compares two empty
  // check sets as identical — a pass that proves nothing about parity.
  it("refuses a receipt with an empty check set rather than comparing it clean", () => {
    const empty: Receipt = structuredClone(BASE_RECEIPT);
    empty.checks = [];
    expect(() => compareReceipts(empty, structuredClone(empty))).toThrow(/'checks' is empty/);
  });

  it("refuses a receipt missing the fields it reads", () => {
    const noSummary = { verdict: "PARITY", checks: BASE_RECEIPT.checks } as unknown as Receipt;
    expect(() => compareReceipts(noSummary, structuredClone(BASE_RECEIPT))).toThrow(/missing 'summary' object/);

    const noChecks = { verdict: "PARITY", summary: BASE_RECEIPT.summary } as unknown as Receipt;
    expect(() => compareReceipts(structuredClone(BASE_RECEIPT), noChecks)).toThrow(/missing 'checks' array/);
  });

  it("names which side was malformed", () => {
    const bad = { verdict: "PARITY", summary: {}, checks: [{ status: "pass" }] } as unknown as Receipt;
    expect(() => compareReceipts(structuredClone(BASE_RECEIPT), bad)).toThrow(/candidate receipt is not a usable/);
    expect(() => compareReceipts(bad, structuredClone(BASE_RECEIPT))).toThrow(/reference receipt is not a usable/);
  });

  // The comparator keys `checks` by id into a Map, which keeps only the last
  // entry for a repeated id. Without this guard a receipt carrying the same
  // check twice with divergent statuses loses the earlier one and compares
  // clean against the survivor — inconsistency reported as parity.
  it("refuses a receipt carrying the same check id twice", () => {
    const duplicated: Receipt = structuredClone(BASE_RECEIPT);
    duplicated.checks.push({ ...duplicated.checks[0], status: "fail", violations: ["tree differs"] });

    expect(() => compareReceipts(duplicated, structuredClone(BASE_RECEIPT))).toThrow(
      /'checks' contains duplicate ids: git\.tree-equality/,
    );
    expect(() => compareReceipts(structuredClone(BASE_RECEIPT), duplicated)).toThrow(
      /candidate receipt is not a usable/,
    );
  });

  // Guards the collapse directly: absent the duplicate check, the losing entry
  // is discarded and this pair compares clean despite disagreeing.
  it("does not let a duplicate id mask a status divergence", () => {
    const reference: Receipt = structuredClone(BASE_RECEIPT);
    const candidate: Receipt = structuredClone(BASE_RECEIPT);
    candidate.checks[0].status = "fail";
    candidate.checks.push({ ...BASE_RECEIPT.checks[0] });

    expect(() => compareReceipts(reference, candidate)).toThrow(/duplicate ids/);
  });

  it("names every duplicated id, not just the first", () => {
    const duplicated: Receipt = structuredClone(BASE_RECEIPT);
    duplicated.checks.push({ ...BASE_RECEIPT.checks[1] }, { ...BASE_RECEIPT.checks[0] });

    expect(() => compareReceipts(duplicated, structuredClone(BASE_RECEIPT))).toThrow(
      /duplicate ids: git\.tree-equality, pkg\.pack-inventory/,
    );
  });
});

describe("readReceipt", () => {
  const dir = mkdtempSync(join(tmpdir(), "verify-receipt-test-"));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it("reads a well-formed receipt", () => {
    const path = join(dir, "good.json");
    writeFileSync(path, JSON.stringify(BASE_RECEIPT));
    expect(readReceipt(path, "reference receipt").verdict).toBe("PARITY");
  });

  // A CI gate that dies on a raw ENOENT stack tells the reader nothing about
  // which receipt was missing or what was expected there.
  it("fails with a legible message on a missing file, naming the role and path", () => {
    const path = join(dir, "absent.json");
    expect(() => readReceipt(path, "candidate receipt")).toThrow(/candidate receipt not found/);
    expect(() => readReceipt(path, "candidate receipt")).toThrow(/Expected a parity receipt JSON file/);
    expect(() => readReceipt(path, "candidate receipt")).not.toThrow(/ENOENT/);
  });

  it("fails with a legible message on malformed JSON", () => {
    const path = join(dir, "malformed.json");
    writeFileSync(path, "{ not json at all ");
    expect(() => readReceipt(path, "reference receipt")).toThrow(/reference receipt is not valid JSON/);
  });

  it("fails when the file parses but is not a receipt object", () => {
    const arrayPath = join(dir, "array.json");
    writeFileSync(arrayPath, "[]");
    expect(() => readReceipt(arrayPath, "reference receipt")).toThrow(/is not a receipt object[\s\S]*array/);

    const scalarPath = join(dir, "scalar.json");
    writeFileSync(scalarPath, "42");
    expect(() => readReceipt(scalarPath, "candidate receipt")).toThrow(/is not a receipt object[\s\S]*number/);
  });
});
