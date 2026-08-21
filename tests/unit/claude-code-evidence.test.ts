import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { WorkspaceUnreadableError, retrieveEvidence } from "../../src/claude-code/artifact.js";
import { SERVER_INSTRUCTIONS, renderEvidence } from "../../src/claude-code/server.js";
import { WorkspaceNotFoundError } from "../../src/types.js";

const created: string[] = [];
const savedEnv = { path: process.env.WORKSPACE_JSON_PATH, root: process.env.WORKSPACE_JSON_ROOT };

afterEach(() => {
  for (const path of created.splice(0)) rmSync(path, { recursive: true, force: true });
  process.env.WORKSPACE_JSON_PATH = savedEnv.path;
  process.env.WORKSPACE_JSON_ROOT = savedEnv.root;
  if (savedEnv.path === undefined) Reflect.deleteProperty(process.env, "WORKSPACE_JSON_PATH");
  if (savedEnv.root === undefined) Reflect.deleteProperty(process.env, "WORKSPACE_JSON_ROOT");
});

/** A throwaway git repo with an artifact at the canonical `.agents/` location. */
function withRepo(artifact: unknown | string, opts: { commit?: boolean } = {}): string {
  const dir = mkdtempSync(resolve(tmpdir(), "wjson-m2b-"));
  created.push(dir);
  mkdirSync(resolve(dir, ".agents"), { recursive: true });
  if (artifact !== undefined) {
    writeFileSync(
      resolve(dir, ".agents/workspace.json"),
      typeof artifact === "string" ? artifact : JSON.stringify(artifact, null, 2),
    );
  }
  if (opts.commit !== false) {
    const git = (...args: string[]) => execFileSync("git", ["-C", dir, ...args], { stdio: "ignore" });
    git("init", "-q");
    git("config", "user.email", "test@example.invalid");
    git("config", "user.name", "test");
    git("add", "-A");
    git("commit", "-qm", "fixture");
  }
  process.env.WORKSPACE_JSON_ROOT = dir;
  Reflect.deleteProperty(process.env, "WORKSPACE_JSON_PATH");
  return dir;
}

function headOf(dir: string): string {
  return execFileSync("git", ["-C", dir, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
}

function artifactWith(coChange: unknown, extra: Record<string, unknown> = {}) {
  return {
    manual: {},
    generated: {
      specVersion: "0.4",
      generatedAt: "2026-08-11T14:09:41.759Z",
      by: { name: "@workspacejson/cli", version: "0.5.2" },
      fileIndex: { "src/schema.ts": {}, "schema/v1.json": {}, "src/lonely.ts": {} },
      coChange,
      ...extra,
    },
    agents: {},
    health: {},
  };
}

describe("retrieveEvidence — recorded history is passed through verbatim", () => {
  it("returns the partner with the artifact's own support and occurrence counts", async () => {
    const dir = withRepo(
      artifactWith([{ files: ["schema/v1.json", "src/schema.ts"], support: 10, occurrences: 11 }], {
        basisRevision: "0".repeat(40),
      }),
    );
    const result = await retrieveEvidence(["src/schema.ts"]);

    expect(result.files).toHaveLength(1);
    expect(result.files[0].partners).toEqual([
      expect.objectContaining({ partner: "schema/v1.json", support: 10, occurrences: 11 }),
    ]);
    expect(result.provenance.producer).toBe("@workspacejson/cli@0.5.2");
    expect(result.provenance.repositoryRoot).toBe(dir);
  });

  it("is symmetric: querying the partner returns the original file", async () => {
    withRepo(artifactWith([{ files: ["schema/v1.json", "src/schema.ts"], support: 10, occurrences: 11 }]));
    const result = await retrieveEvidence(["schema/v1.json"]);
    expect(result.files[0].partners.map((p) => p.partner)).toEqual(["src/schema.ts"]);
  });

  it("reports absent counts as absent rather than inventing a number", async () => {
    withRepo(artifactWith([{ files: ["schema/v1.json", "src/schema.ts"] }]));
    const result = await retrieveEvidence(["src/schema.ts"]);
    expect(result.files[0].partners[0]).toMatchObject({ support: null, occurrences: null });
    expect(renderEvidence(result)).toContain("counts not recorded");
    expect(renderEvidence(result)).not.toMatch(/support=-1|occurrences=-1/);
  });

  it("resolves an absolute query inside the proven root, and refuses one outside it", async () => {
    const dir = withRepo(artifactWith([{ files: ["schema/v1.json", "src/schema.ts"], support: 10, occurrences: 11 }]));
    const inside = await retrieveEvidence([resolve(dir, "src/schema.ts")]);
    expect(inside.files[0].partners.map((p) => p.partner)).toEqual(["schema/v1.json"]);

    const outside = await retrieveEvidence(["/elsewhere/other-repo/src/schema.ts"]);
    expect(outside.files[0].partners).toEqual([]);
    expect(outside.files[0].absence).toBe("file-not-indexed");
  });
});

describe("degraded evidence never becomes safety", () => {
  it("missing artifact raises a not-found error naming the absence", async () => {
    const dir = mkdtempSync(resolve(tmpdir(), "wjson-m2b-empty-"));
    created.push(dir);
    process.env.WORKSPACE_JSON_ROOT = dir;
    Reflect.deleteProperty(process.env, "WORKSPACE_JSON_PATH");
    await expect(retrieveEvidence(["src/schema.ts"])).rejects.toBeInstanceOf(WorkspaceNotFoundError);
  });

  it("malformed artifact raises an unreadable error, not an empty success", async () => {
    withRepo("{ this is not json");
    await expect(retrieveEvidence(["src/schema.ts"])).rejects.toBeInstanceOf(WorkspaceUnreadableError);
    await expect(retrieveEvidence(["src/schema.ts"])).rejects.toThrow(/not an absence of risk/);
  });

  it("a non-object artifact is unreadable rather than silently empty", async () => {
    withRepo("[1, 2, 3]");
    await expect(retrieveEvidence(["src/schema.ts"])).rejects.toBeInstanceOf(WorkspaceUnreadableError);
  });

  it("a basis revision behind HEAD is reported as STALE with the drift named", async () => {
    const dir = withRepo(artifactWith([{ files: ["schema/v1.json", "src/schema.ts"], support: 10, occurrences: 11 }]));
    // Rewrite the artifact with a basis revision that is not this repo's HEAD.
    writeFileSync(
      resolve(dir, ".agents/workspace.json"),
      JSON.stringify(
        artifactWith([{ files: ["schema/v1.json", "src/schema.ts"], support: 10, occurrences: 11 }], {
          basisRevision: "1".repeat(40),
        }),
      ),
    );
    const result = await retrieveEvidence(["src/schema.ts"]);
    expect(result.provenance.freshness).toBe("stale");
    expect(result.provenance.currentRevision).toBe(headOf(dir));
    expect(result.provenance.freshnessNote).toContain("not reflected below");
    expect(renderEvidence(result)).toContain("STALE");
  });

  it("a basis revision equal to HEAD is reported as CURRENT", async () => {
    const dir = withRepo(artifactWith([]));
    writeFileSync(
      resolve(dir, ".agents/workspace.json"),
      JSON.stringify(
        artifactWith([{ files: ["schema/v1.json", "src/schema.ts"], support: 10, occurrences: 11 }], {
          basisRevision: headOf(dir),
        }),
      ),
    );
    const result = await retrieveEvidence(["src/schema.ts"]);
    expect(result.provenance.freshness).toBe("current");
  });

  it("an unrecorded basis revision is UNKNOWN, not current", async () => {
    withRepo(artifactWith([{ files: ["schema/v1.json", "src/schema.ts"], support: 10, occurrences: 11 }]));
    const result = await retrieveEvidence(["src/schema.ts"]);
    expect(result.provenance.freshness).toBe("unknown");
  });

  it("a file with no recorded partners reports absence of history, not absence of risk", async () => {
    withRepo(artifactWith([{ files: ["schema/v1.json", "src/schema.ts"], support: 10, occurrences: 11 }]));
    const result = await retrieveEvidence(["src/lonely.ts"]);
    expect(result.files[0].absence).toBe("no-recorded-co-change");
    const text = renderEvidence(result);
    expect(text).toContain("not a statement about this change");
    expect(text).not.toMatch(/\bsafe\b|\bno risk\b|\bapproved?\b/i);
  });

  it("a path outside the artifact's file index is reported as not indexed", async () => {
    withRepo(artifactWith([{ files: ["schema/v1.json", "src/schema.ts"], support: 10, occurrences: 11 }]));
    const result = await retrieveEvidence(["src/brand-new.ts"]);
    expect(result.files[0].absence).toBe("file-not-indexed");
  });
});

describe("perturbation: the evidence is load-bearing", () => {
  it("removing the recorded pair removes the partner from the response", async () => {
    const withPair = [
      { files: ["schema/v1.json", "src/schema.ts"], support: 10, occurrences: 11 },
      { files: ["src/schema.ts", "src/lonely.ts"], support: 2, occurrences: 9 },
    ];
    const dir = withRepo(artifactWith(withPair));
    const before = await retrieveEvidence(["src/schema.ts"]);
    expect(before.files[0].partners.map((p) => p.partner)).toEqual(["schema/v1.json", "src/lonely.ts"]);

    // Perturbation: drop only the registered pair, leave everything else intact.
    writeFileSync(
      resolve(dir, ".agents/workspace.json"),
      JSON.stringify(artifactWith([{ files: ["src/schema.ts", "src/lonely.ts"], support: 2, occurrences: 9 }])),
    );
    const after = await retrieveEvidence(["src/schema.ts"]);
    expect(after.files[0].partners.map((p) => p.partner)).toEqual(["src/lonely.ts"]);
    expect(renderEvidence(after)).not.toContain("schema/v1.json");
  });
});

describe("descriptive, not prescriptive", () => {
  it("rendered evidence never uses dependency, causal, or prescriptive vocabulary", async () => {
    withRepo(
      artifactWith([{ files: ["schema/v1.json", "src/schema.ts"], support: 10, occurrences: 11 }], {
        basisRevision: "2".repeat(40),
      }),
    );
    const text = renderEvidence(await retrieveEvidence(["src/schema.ts"]));
    for (const banned of [
      /\bdepends? on\b/i,
      /\bdependency\b/i,
      /\bblast radius\b/i,
      /\brisk score\b/i,
      /\byou (should|must)\b/i,
      /\brecommend/i,
      /\brequires? (a )?(change|update)\b/i,
      /\bwill break\b/i,
      /\bis safe\b/i,
    ]) {
      expect(text).not.toMatch(banned);
    }
    expect(text).toContain("changed in the same commit");
    expect(text).toContain("open the file yourself and verify it");
  });

  it("server instructions frame partners as candidates and refuse a safety reading", () => {
    expect(SERVER_INSTRUCTIONS).toContain("symmetric historical observation");
    expect(SERVER_INSTRUCTIONS).toContain("never means the change is safe");
    expect(SERVER_INSTRUCTIONS).not.toMatch(/\bdeny\b|\bblock\b|\bapprove\b/i);
  });
});
