import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { collectProducerRefs, findVersionMismatches } from "../../scripts/check-generator-version.mjs";

const created: string[] = [];
afterEach(() => {
  for (const path of created.splice(0)) rmSync(path, { recursive: true, force: true });
});

function withFiles(files: Record<string, string>): string {
  const dir = mkdtempSync(resolve(tmpdir(), "wjson-producer-gate-"));
  created.push(dir);
  for (const [name, body] of Object.entries(files)) writeFileSync(resolve(dir, name), body);
  return dir;
}

describe("findVersionMismatches", () => {
  it("fails when a required surface has no producer handoff", () => {
    const refs = [{ file: "README.md", version: "unpinned" }];
    const violations = findVersionMismatches(refs, ["README.md", "scripts/install.mjs"]);
    expect(violations).toHaveLength(1);
    expect(violations[0]).toMatch(/handoff is missing from required surface/);
    expect(violations[0]).toContain("scripts/install.mjs");
  });

  it("passes when every surface agrees, unpinned", () => {
    const refs = [
      { file: "README.md", version: "unpinned" },
      { file: "scripts/install.mjs", version: "unpinned" },
    ];
    expect(findVersionMismatches(refs, ["README.md", "scripts/install.mjs"])).toEqual([]);
  });

  it("passes when every surface agrees on the same pin", () => {
    const refs = [
      { file: "README.md", version: "0.5.2" },
      { file: "scripts/install.mjs", version: "0.5.2" },
    ];
    expect(findVersionMismatches(refs, ["README.md", "scripts/install.mjs"])).toEqual([]);
  });

  it("fails when surfaces disagree on the version qualifier", () => {
    const refs = [
      { file: "README.md", version: "0.5.2" },
      { file: "scripts/install.mjs", version: "unpinned" },
    ];
    const violations = findVersionMismatches(refs, ["README.md", "scripts/install.mjs"]);
    expect(violations).toHaveLength(1);
    expect(violations[0]).toMatch(/qualifier disagrees across surfaces/);
    expect(violations[0]).toContain("README.md -> 0.5.2");
    expect(violations[0]).toContain("scripts/install.mjs -> unpinned");
  });

  it("fails when a runnable legacy generate command is still handed to users", () => {
    const refs = [
      { file: "README.md", version: "unpinned" },
      { file: "scripts/install.mjs", version: "unpinned" },
    ];
    const legacy = [{ file: "README.md", command: "npx agents-audit@0.4.3 generate" }];
    const violations = findVersionMismatches(refs, ["README.md", "scripts/install.mjs"], legacy);
    expect(violations).toHaveLength(1);
    expect(violations[0]).toMatch(/runnable legacy generate command/);
    expect(violations[0]).toContain("npx agents-audit@0.4.3 generate");
  });

  it("does not fail merely because a pin is behind the registry's latest", () => {
    // Intentional non-behavior: the declared command is the contract; an upstream
    // release moving ahead must not red downstream CI. Reconciliation against the
    // installed version is the redesign tracked in HAC-204.
    const refs = [
      { file: "README.md", version: "0.5.0" },
      { file: "scripts/install.mjs", version: "0.5.0" },
    ];
    expect(findVersionMismatches(refs, ["README.md", "scripts/install.mjs"])).toEqual([]);
  });
});

describe("collectProducerRefs", () => {
  it("recognizes the neutral handoff pinned and unpinned", () => {
    const dir = withFiles({
      "a.md": "Run `npx @workspacejson/cli generate .` in your repo root.\n",
      "b.md": "Run `npx @workspacejson/cli@0.5.2 generate .`\n",
    });
    const { refs, legacy } = collectProducerRefs(dir, ["a.md", "b.md"]);
    expect(refs).toEqual([
      { file: "a.md", version: "unpinned" },
      { file: "b.md", version: "0.5.2" },
    ]);
    expect(legacy).toEqual([]);
  });

  it("flags a runnable legacy handoff", () => {
    const dir = withFiles({ "a.md": "Run `npx agents-audit@0.4.3 generate .`\n" });
    const { legacy } = collectProducerRefs(dir, ["a.md"]);
    expect(legacy).toEqual([{ file: "a.md", command: "npx agents-audit@0.4.3 generate" }]);
  });

  it("does not flag prose that merely describes agents-audit as the frozen bridge", () => {
    // The distinction the gate exists to draw: describing the compatibility bridge
    // is allowed and required by META-291; handing it to a cold user as the way to
    // produce an artifact is not. A gate that could not tell these apart would force
    // the honest historical note to be deleted.
    const dir = withFiles({
      "a.md":
        "> `agents-audit` is the historical command. It is a frozen compatibility bridge " +
        "that delegates generation to `@workspacejson/cli`.\n\n" +
        "Run `npx @workspacejson/cli generate .`\n",
    });
    const { refs, legacy } = collectProducerRefs(dir, ["a.md"]);
    expect(legacy).toEqual([]);
    expect(refs).toEqual([{ file: "a.md", version: "unpinned" }]);
    expect(findVersionMismatches(refs, ["a.md"], legacy)).toEqual([]);
  });
});
