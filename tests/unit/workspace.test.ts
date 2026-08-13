import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { WORKSPACE_JSON_CANDIDATES } from "../../src/constants.js";
import {
  findCoChangePartners,
  findFragile,
  isIndexed,
  normalizeWorkspace,
  repositoryRootFor,
  resolveWorkspacePath,
} from "../../src/services/workspace.js";

const here = dirname(fileURLToPath(import.meta.url));
const fixturePath = resolve(here, "../../fixture/.agents/workspace.json");
const fixture = JSON.parse(readFileSync(fixturePath, "utf8"));

const sourcePath = resolve(here, "../../fixture/.agents/workspace.json");
const created: string[] = [];

afterEach(() => {
  // `process.env.X = undefined` assigns the STRING "undefined", which is truthy and
  // non-empty — resolveWorkspacePath would then take the explicit-path branch and
  // throw for the wrong reason, making every discovery test below vacuously green.
  // Removing the key is the only way to actually unset an environment variable in
  // Node. Reflect.deleteProperty rather than `delete` because the lint rule that
  // bans `delete` suggests exactly the `= undefined` form that causes the bug.
  Reflect.deleteProperty(process.env, "WORKSPACE_JSON_ROOT");
  Reflect.deleteProperty(process.env, "WORKSPACE_JSON_PATH");
  for (const path of created.splice(0)) rmSync(path, { recursive: true, force: true });
});

describe("resolveWorkspacePath", () => {
  it("does not consume an ancestor artifact across the nearest Git boundary", () => {
    const outer = mkdtempSync(resolve(tmpdir(), "wjson-boundary-"));
    created.push(outer);
    mkdirSync(resolve(outer, ".agents"));
    writeFileSync(resolve(outer, ".agents/workspace.json"), "{}\n");
    const nestedRepo = resolve(outer, "nested");
    mkdirSync(resolve(nestedRepo, ".git"), { recursive: true });
    mkdirSync(resolve(nestedRepo, "packages/deep"), { recursive: true });
    process.env.WORKSPACE_JSON_ROOT = resolve(nestedRepo, "packages/deep");
    expect(() => resolveWorkspacePath()).toThrow("No workspace.json found");
  });

  // META-291: a product-private sidecar must not be reachable by default discovery.
  // Tolerating a vendor shape that is handed to us is compatibility behavior;
  // *searching* for one makes it an implied path of the neutral standard.
  it("does not discover a product-private vendor sidecar by default", () => {
    const repo = mkdtempSync(resolve(tmpdir(), "wjson-sidecar-"));
    created.push(repo);
    mkdirSync(resolve(repo, ".git"), { recursive: true });
    mkdirSync(resolve(repo, ".vreko"), { recursive: true });
    writeFileSync(resolve(repo, ".vreko/workspace.json"), "{}\n");
    process.env.WORKSPACE_JSON_ROOT = repo;
    expect(() => resolveWorkspacePath()).toThrow("No workspace.json found");
  });

  it("still resolves a vendor sidecar when named explicitly via WORKSPACE_JSON_PATH", () => {
    const repo = mkdtempSync(resolve(tmpdir(), "wjson-sidecar-explicit-"));
    created.push(repo);
    mkdirSync(resolve(repo, ".vreko"), { recursive: true });
    const sidecar = resolve(repo, ".vreko/workspace.json");
    writeFileSync(sidecar, "{}\n");
    process.env.WORKSPACE_JSON_PATH = sidecar;
    // Removing the default candidate must not remove the ability to point at such a
    // file deliberately — the boundary is discovery, not readability.
    expect(resolveWorkspacePath()).toBe(sidecar);
  });

  it("prefers the canonical path over a ratified legacy path in the same directory", () => {
    const repo = mkdtempSync(resolve(tmpdir(), "wjson-priority-"));
    created.push(repo);
    mkdirSync(resolve(repo, ".agents"), { recursive: true });
    writeFileSync(resolve(repo, ".agents/workspace.json"), "{}\n");
    writeFileSync(resolve(repo, "workspace.json"), "{}\n");
    process.env.WORKSPACE_JSON_ROOT = repo;
    expect(resolveWorkspacePath()).toBe(resolve(repo, ".agents/workspace.json"));
  });
});

describe("WORKSPACE_JSON_CANDIDATES", () => {
  // Reintroduction guard. This fails if any vendor- or product-specific path is added
  // back to default discovery — the defect META-291 recorded, not a style preference.
  it("contains only ADR-001 canonical and ratified legacy paths", () => {
    expect([...WORKSPACE_JSON_CANDIDATES]).toEqual([".agents/workspace.json", ".workspace.json", "workspace.json"]);
  });

  it("names no vendor or product-private directory", () => {
    const vendorish = /(^|\/)\.(vreko|marcelle|codex|cursor)(\/|$)/i;
    for (const candidate of WORKSPACE_JSON_CANDIDATES) {
      expect(candidate, `${candidate} leaks a product-specific path into neutral discovery`).not.toMatch(vendorish);
    }
  });
});

describe("normalizeWorkspace", () => {
  it.each([null, [], "invalid"])("rejects a structurally invalid root: %j", (raw) => {
    expect(() => normalizeWorkspace(sourcePath, raw)).toThrow("root must be an object");
  });

  it.each([{ manual: [] }, { generated: "invalid" }])("rejects malformed consumed sections: %j", (raw) => {
    expect(() => normalizeWorkspace(sourcePath, raw)).toThrow("must be an object");
  });

  it("normalizes the fixture workspace with the generated section produced by the real agents-audit generate", () => {
    const ws = normalizeWorkspace(sourcePath, fixture);
    expect(ws.sourcePath).toBe(sourcePath);
    expect(ws.version).toBe("0.3");
    // The real producer emits frameworkManifest as an array of detected frameworks
    // (schema v1), not the legacy {runtime,testRunner} record; a fresh scan of this
    // small fixture detects none, so it degrades to undefined rather than a record.
    expect(ws.frameworkManifest).toBeUndefined();
  });

  it("normalizes the checkout fragility record and preserves score/reason", () => {
    const ws = normalizeWorkspace(sourcePath, fixture);
    const checkout = ws.fragileFiles.find((f) => f.path === "src/routes/checkout.ts");
    expect(checkout).toBeDefined();
    expect(checkout?.reason).toBe("payment edge cases");
    expect(checkout?.score).toBe(7);
    expect(checkout?.evidence).toEqual([
      {
        claim: "revert d4e5f6 (payment rounding)",
        command: "git log --oneline --grep 'revert' -- src/routes/checkout.ts",
        output: "d4e5f6",
      },
      { claim: "incident 2026-03-02: double-charge on retry" },
    ]);
  });

  it("normalizes co-change groups and preserves strength", () => {
    const ws = normalizeWorkspace(sourcePath, fixture);
    const checkoutGroup = ws.coChangeGroups.find((g) => g.files.includes("src/routes/checkout.ts"));
    expect(checkoutGroup).toBeDefined();
    expect(checkoutGroup?.strength).toBe(0.86);
  });

  it("normalizes the file index as empty for a fresh scan with no observation history", () => {
    // The real generated.fileIndex (schema v1) is per-file behavioral intelligence
    // (fragility, modification counts), not a static list of paths in the repo — a
    // fresh generate on this fixture has no history to report, so it is genuinely
    // empty. "Indexed" here is independent of, and not required by, manual fragility.
    const ws = normalizeWorkspace(sourcePath, fixture);
    expect(ws.fileIndex).toEqual([]);
  });

  it("tolerates legacy and alternative shapes", () => {
    const raw = {
      version: "0.3",
      manual: {
        fragileFiles: [
          "src/legacy.ts",
          { file: "src/alt.ts", description: "alt reason", fragility: 5, evidence: ["legacy"] },
        ],
        coChangePatterns: [["src/legacy.ts", "src/alt.ts"], { files: ["src/one.ts", "src/two.ts"], confidence: 0.7 }],
      },
      generated: {
        fileIndex: {
          "src/legacy.ts": 1,
          "src/alt.ts": 1,
        },
        frameworkManifest: { runtime: "node" },
      },
    };
    const ws = normalizeWorkspace("/tmp/workspace.json", raw);
    expect(ws.version).toBe("0.3");

    const legacy = ws.fragileFiles.find((f) => f.path === "src/legacy.ts");
    expect(legacy).toBeDefined();
    const alt = ws.fragileFiles.find((f) => f.path === "src/alt.ts");
    expect(alt?.reason).toBe("alt reason");
    expect(alt?.score).toBe(5);

    const arrGroup = ws.coChangeGroups.find((g) => g.files.includes("src/legacy.ts"));
    expect(arrGroup?.files).toEqual(["src/legacy.ts", "src/alt.ts"]);

    expect(ws.fileIndex).toContain("src/legacy.ts");
    expect(ws.frameworkManifest).toEqual({ runtime: "node" });
  });

  it("normalizes a legacy array-shaped fileIndex (a flat list of paths, not the real spec's keyed-object shape)", () => {
    const raw = { generated: { fileIndex: ["src/one.ts", "src/two.ts"] } };
    const ws = normalizeWorkspace("/tmp/workspace.json", raw);
    expect(ws.fileIndex).toEqual(["src/one.ts", "src/two.ts"]);
  });

  it("normalizes an array-shaped frameworkManifest emitted by the current producer", () => {
    const raw = {
      generated: {
        frameworkManifest: [{ name: "node", version: "22.0.0", confidence: 0.9 }],
      },
    };
    const ws = normalizeWorkspace("/tmp/workspace.json", raw);
    expect(ws.frameworkManifest).toEqual({ node: "22.0.0" });
  });

  it("tolerates an adjacency map for co-change patterns", () => {
    const raw = {
      manual: {
        coChangePatterns: {
          "src/key.ts": ["src/val.ts"],
        },
      },
      generated: {},
    };
    const ws = normalizeWorkspace("/tmp/workspace.json", raw);
    const mapGroup = ws.coChangeGroups.find((g) => g.files.includes("src/key.ts"));
    expect(mapGroup?.files).toEqual(["src/key.ts", "src/val.ts"]);
  });
});

describe("repositoryRootFor", () => {
  // The defect this exists to prevent: dirname() of the CANONICAL artifact
  // location yields `<root>/.agents`, one level short. Stored keys are
  // repo-root-relative, so a short root makes every legitimate absolute host
  // query fail containment.
  it("resolves the canonical .agents layout to the repository root, not .agents", () => {
    expect(repositoryRootFor("/repo/.agents/workspace.json")).toBe("/repo");
    expect(repositoryRootFor("/repo/.agents/workspace.json")).not.toBe("/repo/.agents");
  });

  it("resolves the legacy flat layouts to the containing directory", () => {
    expect(repositoryRootFor("/repo/workspace.json")).toBe("/repo");
    expect(repositoryRootFor("/repo/.workspace.json")).toBe("/repo");
  });

  it("falls back to the containing directory for an unrecognized location", () => {
    expect(repositoryRootFor("/somewhere/custom-name.json")).toBe("/somewhere");
  });

  it("does not mistake a directory merely named .agents for the artifact layout", () => {
    expect(repositoryRootFor("/repo/.agents/nested/workspace.json")).toBe("/repo/.agents/nested");
  });

  it("is what the normalized workspace carries", () => {
    const ws = normalizeWorkspace("/repo/.agents/workspace.json", { root: {} });
    expect(ws.repositoryRoot).toBe("/repo");
  });
});

describe("findFragile", () => {
  const ws = normalizeWorkspace(sourcePath, fixture);

  it("finds fragile files by exact repo-relative path", () => {
    expect(findFragile(ws, "src/routes/checkout.ts")).toBeDefined();
  });

  it("normalizes ./ and resolves absolute paths inside the repository root", () => {
    expect(findFragile(ws, "./src/routes/checkout.ts")).toBeDefined();
    expect(findFragile(ws, resolve(ws.repositoryRoot, "src/routes/checkout.ts"))).toBeDefined();
  });

  // ADR-006 §8 / META-291: the absolute path is resolved against the PROVEN root
  // and compared exactly. A path in a different checkout that merely ends with
  // the stored key used to match via the suffix fallback.
  it("does not match an absolute path outside the repository root", () => {
    expect(findFragile(ws, "/abs/repo/src/routes/checkout.ts")).toBeUndefined();
    expect(findFragile(ws, "/tmp/someone-elses-checkout/src/routes/checkout.ts")).toBeUndefined();
  });

  it("does not do partial matching", () => {
    expect(findFragile(ws, "db/client.ts")).toBeUndefined();
    expect(findFragile(ws, "client.ts")).toBeUndefined();
  });
});

describe("findCoChangePartners", () => {
  const ws = normalizeWorkspace(sourcePath, fixture);

  it("returns partners for a file in a co-change group", () => {
    expect(findCoChangePartners(ws, "src/routes/checkout.ts")).toContain("src/auth/session.ts");
    expect(findCoChangePartners(ws, "src/routes/checkout.ts")).toContain("src/lib/format.ts");
  });

  it("does not include the queried file itself", () => {
    expect(findCoChangePartners(ws, "src/routes/checkout.ts")).not.toContain("src/routes/checkout.ts");
  });

  it("returns an empty array for files with no recorded partners", () => {
    expect(findCoChangePartners(ws, "src/lib/does-not-exist.ts")).toEqual([]);
  });
});

describe("isIndexed", () => {
  it("returns true only for paths present in generated.fileIndex", () => {
    const ws = normalizeWorkspace("/tmp/workspace.json", {
      generated: { fileIndex: { "src/bootstrap.ts": {} } },
    });
    expect(isIndexed(ws, "src/bootstrap.ts")).toBe(true);
    expect(isIndexed(ws, "src/lib/does-not-exist.ts")).toBe(false);
  });

  it("returns false for every file on the fixture's fresh-scan (empty) file index", () => {
    const ws = normalizeWorkspace(sourcePath, fixture);
    expect(isIndexed(ws, "src/bootstrap.ts")).toBe(false);
    expect(isIndexed(ws, "src/routes/checkout.ts")).toBe(false);
  });
});
