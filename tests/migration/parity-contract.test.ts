import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  compareAssetInventories,
  comparePackageIdentity,
  compareRunResults,
  compareVsixIdentity,
  findUndeclaredDifferences,
  inventoryDir,
  sha256,
} from "../../scripts/migration/verify-clone-parity.mjs";

// Watched-red contract: every comparator must FAIL against deliberately
// perturbed input, not only pass against identical input. A comparator that
// cannot go red is not evidence.

const BASE_PKG = {
  name: "@workspacejson/codex-mcp",
  version: "0.1.9",
  exports: { ".": { types: "./dist/index.d.ts", import: "./dist/index.js" } },
  bin: { "codex-mcp": "scripts/install.mjs", "workspacejson-codex-mcp": "scripts/install.mjs" },
  files: ["dist", "hooks"],
  engines: { node: ">=20" },
};

const BASE_VSIX = {
  publisher: "workspace-json",
  extensionId: "workspacejson-codex-decorations",
  version: "0.1.5",
  commands: [{ command: "a.open" }, { command: "b.refresh" }],
  activationEvents: ["onStartupFinished"],
};

describe("comparePackageIdentity", () => {
  it("passes identical manifests", () => {
    expect(comparePackageIdentity(BASE_PKG, structuredClone(BASE_PKG))).toEqual([]);
  });

  it("watched-red: catches a changed bin mapping", () => {
    const perturbed = structuredClone(BASE_PKG);
    perturbed.bin["codex-mcp"] = "scripts/evil.mjs";
    const violations = comparePackageIdentity(BASE_PKG, perturbed);
    expect(violations).toHaveLength(1);
    expect(violations[0]).toMatch(/package\.bin diverged/);
    expect(violations[0]).toMatch(/evil\.mjs/);
  });

  it("watched-red: catches a dropped second bin", () => {
    const perturbed = structuredClone(BASE_PKG);
    Reflect.deleteProperty(perturbed.bin, "workspacejson-codex-mcp");
    expect(comparePackageIdentity(BASE_PKG, perturbed)[0]).toMatch(/package\.bin diverged/);
  });

  it("watched-red: catches a version-line change", () => {
    const perturbed = structuredClone(BASE_PKG);
    perturbed.version = "0.2.0";
    expect(comparePackageIdentity(BASE_PKG, perturbed)[0]).toMatch(/package\.version diverged/);
  });
});

describe("compareVsixIdentity", () => {
  it("passes identical metadata, order-insensitive for commands", () => {
    const reordered = structuredClone(BASE_VSIX);
    reordered.commands = [...reordered.commands].reverse();
    expect(compareVsixIdentity(BASE_VSIX, reordered)).toEqual([]);
  });

  it("watched-red: catches a changed extension publisher", () => {
    const perturbed = { ...BASE_VSIX, publisher: "someone-else" };
    expect(compareVsixIdentity(BASE_VSIX, perturbed)[0]).toMatch(/extension publisher diverged/);
  });

  it("watched-red: catches a changed extension ID", () => {
    const perturbed = { ...BASE_VSIX, extensionId: "workspacejson-decorations" };
    expect(compareVsixIdentity(BASE_VSIX, perturbed)[0]).toMatch(/extension extensionId diverged/);
  });

  it("watched-red: catches a changed extension version", () => {
    const perturbed = { ...BASE_VSIX, version: "0.1.6" };
    expect(compareVsixIdentity(BASE_VSIX, perturbed)[0]).toMatch(/extension version diverged/);
  });

  it("watched-red: catches changed commands and activation events", () => {
    const commands = { ...BASE_VSIX, commands: [{ command: "a.open" }] };
    expect(compareVsixIdentity(BASE_VSIX, commands)[0]).toMatch(/contributes\.commands diverged/);
    const events = { ...BASE_VSIX, activationEvents: ["onStartupFinished", "onCommand:x"] };
    expect(compareVsixIdentity(BASE_VSIX, events)[0]).toMatch(/activationEvents diverged/);
  });
});

describe("compareAssetInventories", () => {
  const base = [
    { path: "dist/index.js", sha256: "aaa" },
    { path: "hooks/pre-edit-check.mjs", sha256: "bbb" },
  ];

  it("passes identical inventories regardless of entry order", () => {
    expect(compareAssetInventories(base, [...base].reverse())).toEqual([]);
  });

  it("watched-red: catches a missing packaged asset", () => {
    const violations = compareAssetInventories(base, [base[0]]);
    expect(violations).toHaveLength(1);
    expect(violations[0]).toMatch(/missing packaged asset in target: hooks\/pre-edit-check\.mjs/);
  });

  it("watched-red: catches changed asset content", () => {
    const perturbed = [base[0], { path: "hooks/pre-edit-check.mjs", sha256: "ccc" }];
    expect(compareAssetInventories(base, perturbed)[0]).toMatch(/content diverged: hooks\/pre-edit-check\.mjs/);
  });

  it("watched-red: catches an unexpected extra asset", () => {
    const perturbed = [...base, { path: "dist/backdoor.js", sha256: "ddd" }];
    expect(compareAssetInventories(base, perturbed)[0]).toMatch(/unexpected extra packaged asset/);
  });
});

describe("compareRunResults", () => {
  it("passes identical runs", () => {
    expect(compareRunResults({ exitCode: 0, stdout: "ok" }, { exitCode: 0, stdout: "ok" })).toEqual([]);
  });

  it("watched-red: catches diverged exit codes and stdout", () => {
    expect(compareRunResults({ exitCode: 0, stdout: "ok" }, { exitCode: 2, stdout: "ok" })[0]).toMatch(
      /exit code diverged/,
    );
    expect(compareRunResults({ exitCode: 0, stdout: "allow" }, { exitCode: 0, stdout: "deny" })[0]).toMatch(
      /stdout diverged/,
    );
  });
});

describe("findUndeclaredDifferences", () => {
  it("passes when there is no diff and nothing declared", () => {
    expect(findUndeclaredDifferences([], [])).toEqual([]);
  });

  it("passes when every diff is narrowly declared with justification", () => {
    const declared = [{ path: "README.md", justification: "Repository-only metadata updated for the new repo URL." }];
    expect(findUndeclaredDifferences(["README.md"], declared)).toEqual([]);
  });

  it("watched-red: fails on an undeclared diff", () => {
    expect(findUndeclaredDifferences(["src/index.ts"], [])[0]).toMatch(
      /undeclared source\/target difference: src\/index\.ts/,
    );
  });

  it("watched-red: rejects wildcard exclusions and stale declarations", () => {
    const declared = [{ path: "docs/**", justification: "blanket exclusion must be rejected outright" }];
    expect(findUndeclaredDifferences([], declared).some((v) => /no wildcards/.test(v))).toBe(true);
    const stale = [{ path: "README.md", justification: "declared but the trees no longer differ here" }];
    expect(findUndeclaredDifferences([], stale)[0]).toMatch(/stale declaration/);
  });
});

describe("inventoryDir", () => {
  it("hashes content only: rewritten identical content yields an identical inventory", () => {
    const dir = mkdtempSync(join(tmpdir(), "inventory-test-"));
    try {
      mkdirSync(join(dir, "sub"), { recursive: true });
      writeFileSync(join(dir, "sub", "a.txt"), "hello");
      const first = inventoryDir(dir);
      writeFileSync(join(dir, "sub", "a.txt"), "hello"); // new mtime, same content
      expect(inventoryDir(dir)).toEqual(first);
      expect(first[0].sha256).toBe(sha256("hello"));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("watched-red: content flip changes the inventory", () => {
    const dir = mkdtempSync(join(tmpdir(), "inventory-test-"));
    try {
      writeFileSync(join(dir, "a.txt"), "hello");
      const before = inventoryDir(dir);
      writeFileSync(join(dir, "a.txt"), "goodbye");
      expect(inventoryDir(dir)).not.toEqual(before);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
