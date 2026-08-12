import { describe, expect, it } from "vitest";
import {
  CHECK_PLAN,
  EXPECTED_TOOLS,
  checkAssessDecision,
  checkCochangePartners,
  checkFragilityEvidence,
  checkFragilityTier,
  checkHelpWroteNothing,
  checkHookDenies,
  checkHookOutputMentionsDeny,
  checkInstallerHelp,
  checkInstructionsMention,
  checkPackContainsPath,
  checkPackContainsPrefix,
  checkPathExists,
  checkProcessSucceeded,
  checkTarballExists,
  checkToolCallResponded,
  checkToolsList,
  checkTreeUnchanged,
  createRecorder,
} from "../../scripts/migration/consumption-checks.mjs";

// Watched-red contract (META-165 scope amendment, recorded on META-285):
//
//   No verification check enters service until it has been demonstrated to
//   FAIL when the property is broken and to PASS when it is not.
//
// Every standing check in CHECK_PLAN therefore appears below at least twice:
// once green against a valid input and once red against a controlled broken
// one. `covers()` records which plan entry each block proves, and a final test
// asserts the plan is fully covered — so adding a check to the harness without
// watching it go red fails the suite rather than shipping unproven.

const proven = new Set<string>();
function covers(id: string): string {
  proven.add(id);
  return id;
}

const okProc = (over: Record<string, unknown> = {}) => ({
  status: 0,
  signal: null,
  stdout: "",
  stderr: "",
  error: undefined,
  ...over,
});

/** What spawnSync actually returns when the binary does not exist. */
const failedToLaunch = () => ({
  status: null,
  signal: null,
  stdout: null,
  stderr: null,
  error: Object.assign(new Error("spawnSync node ENOENT"), { code: "ENOENT" }),
});

/** What spawnSync returns when the child is killed (e.g. timeout). */
const killedBySignal = () => okProc({ status: null, signal: "SIGTERM" });

describe(covers("pack.tarball"), () => {
  it("green: tarball present at destination", () => {
    expect(checkTarballExists(true, "codex-mcp-0.1.9.tgz").passed).toBe(true);
  });
  it("red: tarball absent", () => {
    const r = checkTarballExists(false, "codex-mcp-0.1.9.tgz");
    expect(r.passed).toBe(false);
    expect(r.detail).toMatch(/not found/);
  });
});

describe("pack inventory", () => {
  const packMeta = {
    filename: "codex-mcp-0.1.9.tgz",
    files: [
      { path: "dist/index.js" },
      { path: "dist/index.d.ts" },
      { path: ".mcp.json" },
      { path: "hooks/pre-edit-check.mjs" },
      { path: "hooks/hooks.json" },
      { path: "scripts/install.mjs" },
    ],
  };

  it(`green: ${covers("pack.dist-index")} / ${covers("pack.mcp-json")} present`, () => {
    expect(checkPackContainsPath(packMeta, "dist/index.js").passed).toBe(true);
    expect(checkPackContainsPath(packMeta, ".mcp.json").passed).toBe(true);
  });

  it("red: a required file is missing from the tarball", () => {
    const without = { ...packMeta, files: packMeta.files.filter((f) => f.path !== ".mcp.json") };
    const r = checkPackContainsPath(without, ".mcp.json");
    expect(r.passed).toBe(false);
    expect(r.detail).toMatch(/absent from 5 packed files/);
  });

  it(`green: ${covers("pack.hooks")} matches files under the directory`, () => {
    const r = checkPackContainsPrefix(packMeta, "hooks/");
    expect(r.passed).toBe(true);
    expect(r.detail).toMatch(/2 file\(s\) under 'hooks\/'/);
  });

  it("red: no files under the directory", () => {
    const without = { ...packMeta, files: packMeta.files.filter((f) => !f.path.startsWith("hooks/")) };
    expect(checkPackContainsPrefix(without, "hooks/").passed).toBe(false);
  });

  // META-285 defect 2 regression. `npm pack --json` emits file paths and never
  // a directory entry, so an exact `path === "hooks/"` test could never pass.
  // A prefix match must still succeed on that real-world inventory shape.
  it("regression: passes on an inventory that contains no directory entries", () => {
    expect(packMeta.files.some((f) => f.path === "hooks/")).toBe(false);
    expect(checkPackContainsPrefix(packMeta, "hooks/").passed).toBe(true);
  });

  // Shape is verified before value: an inventory we could not read is a
  // failure, not an absence of violations.
  it("red: pack metadata without a files[] array fails rather than reporting absence", () => {
    expect(checkPackContainsPath({ filename: "x.tgz" }, "dist/index.js").passed).toBe(false);
    expect(checkPackContainsPrefix(undefined, "hooks/").passed).toBe(false);
    expect(checkPackContainsPath({ files: [{ notAPath: 1 }] }, "dist/index.js").detail).toMatch(
      /without a string path/,
    );
  });
});

describe(covers("install.from-tarball"), () => {
  it("green: install exits 0", () => {
    expect(checkProcessSucceeded(okProc(), "npm install").passed).toBe(true);
  });
  it("red: install exits non-zero", () => {
    const r = checkProcessSucceeded(okProc({ status: 1, stderr: "E404 not found" }), "npm install");
    expect(r.passed).toBe(false);
    expect(r.detail).toMatch(/exit 1/);
  });
  // Guards the direction the original harness got wrong elsewhere: a process
  // that never launched must not be read as a result.
  it("red: install never launched", () => {
    const r = checkProcessSucceeded(failedToLaunch(), "npm install");
    expect(r.passed).toBe(false);
    expect(r.detail).toMatch(/failed to launch/);
  });
});

describe(`${covers("install.has-install-script")} / ${covers("install.has-dist-index")} / ${covers("hook.exists")} / ${covers("installer.exists")}`, () => {
  it("green: path exists", () => {
    expect(checkPathExists(true, "/pkg/dist/index.js").passed).toBe(true);
  });
  it("red: path missing", () => {
    const r = checkPathExists(false, "/pkg/dist/index.js");
    expect(r.passed).toBe(false);
    expect(r.detail).toMatch(/not found: \/pkg\/dist\/index\.js/);
  });
});

describe(covers("mcp.instructions-fragile"), () => {
  it("green: instructions mention the token", () => {
    expect(checkInstructionsMention("Treat FRAGILE files with care", "FRAGILE").passed).toBe(true);
  });
  it("red: instructions present but do not mention the token", () => {
    const r = checkInstructionsMention("Nothing relevant here", "FRAGILE");
    expect(r.passed).toBe(false);
    expect(r.detail).toMatch(/do not mention 'FRAGILE'/);
  });
  it("red: server returned no instructions at all", () => {
    const r = checkInstructionsMention(undefined, "FRAGILE");
    expect(r.passed).toBe(false);
    expect(r.detail).toMatch(/no instructions string/);
  });
});

describe(covers("mcp.tool-call-responds"), () => {
  it("green: a real tool result with content", () => {
    expect(checkToolCallResponded({ content: [{ type: "text", text: "ok" }] }).passed).toBe(true);
  });
  it("red: server reported isError", () => {
    expect(checkToolCallResponded({ content: [], isError: true }).passed).toBe(false);
  });
  // The vacuous-pass direction. `!result.isError` alone passes for every one of
  // these, because `isError` is optional on CallToolResult and absent here.
  it("red: results that are not tool results do not pass merely by lacking isError", () => {
    expect(checkToolCallResponded(undefined).passed).toBe(false);
    expect(checkToolCallResponded({}).passed).toBe(false);
    expect(checkToolCallResponded({ structuredContent: {} }).passed).toBe(false);
    expect(checkToolCallResponded("ok").passed).toBe(false);
    expect(checkToolCallResponded({}).detail).toMatch(/result shape unverified/);
  });
});

describe(covers("mcp.tools-list"), () => {
  const listResult = { tools: EXPECTED_TOOLS.map((name) => ({ name })) };

  it("green: exactly the expected tools, order-independent", () => {
    expect(checkToolsList(listResult).passed).toBe(true);
    expect(checkToolsList({ tools: [...listResult.tools].reverse() }).passed).toBe(true);
  });
  it("red: a tool is missing", () => {
    const r = checkToolsList({ tools: listResult.tools.slice(1) });
    expect(r.passed).toBe(false);
    expect(r.detail).toMatch(/expected \[/);
  });
  it("red: an unexpected tool appeared", () => {
    expect(checkToolsList({ tools: [...listResult.tools, { name: "workspace_rm_rf" }] }).passed).toBe(false);
  });
  // META-285 defect 1 regression. The original read `tools` off a callTool
  // result, which has no such property, so this check could never pass. It must
  // pass against a genuine ListToolsResult and fail when the property is absent.
  it("red: a result with no tools[] array — the shape the original destructured", () => {
    const callToolResult = { content: [], structuredContent: {}, isError: false };
    const r = checkToolsList(callToolResult);
    expect(r.passed).toBe(false);
    expect(r.detail).toMatch(/no tools\[\] array/);
  });
});

describe(`${covers("mcp.file-context-tier")} / ${covers("mcp.file-context-evidence")}`, () => {
  const good = {
    content: [],
    structuredContent: { fragility: { tier: "evidenced-fragile", evidence: [{ kind: "co-change" }] } },
  };

  it("green: tier and evidence present", () => {
    expect(checkFragilityTier(good).passed).toBe(true);
    expect(checkFragilityEvidence(good).passed).toBe(true);
  });
  it("green: tier reported even when evidence is an empty array", () => {
    const empty = { content: [], structuredContent: { fragility: { tier: "stable", evidence: [] } } };
    expect(checkFragilityEvidence(empty).passed).toBe(true);
  });
  it("red: tier absent", () => {
    expect(checkFragilityTier({ content: [], structuredContent: { fragility: {} } }).passed).toBe(false);
  });
  it("red: evidence is not an array", () => {
    const bad = { content: [], structuredContent: { fragility: { tier: "x", evidence: "some" } } };
    expect(checkFragilityEvidence(bad).passed).toBe(false);
  });
  it("red: no structuredContent at all", () => {
    expect(checkFragilityTier({ content: [] }).detail).toMatch(/no structuredContent/);
    expect(checkFragilityEvidence({ content: [], isError: true }).passed).toBe(false);
  });
});

describe(covers("mcp.cochange-partners"), () => {
  it("green: partners array present, including empty", () => {
    expect(checkCochangePartners({ structuredContent: { partners: [{ path: "a" }] } }).passed).toBe(true);
    expect(checkCochangePartners({ structuredContent: { partners: [] } }).passed).toBe(true);
  });
  it("red: partners missing or wrong type", () => {
    expect(checkCochangePartners({ structuredContent: {} }).passed).toBe(false);
    expect(checkCochangePartners({ structuredContent: { partners: "none" } }).passed).toBe(false);
  });
});

describe(covers("mcp.assess-change"), () => {
  it("green: either action or assessments present", () => {
    expect(checkAssessDecision({ structuredContent: { action: "review" } }).passed).toBe(true);
    expect(checkAssessDecision({ structuredContent: { assessments: [] } }).passed).toBe(true);
  });
  it("red: neither field present", () => {
    const r = checkAssessDecision({ structuredContent: { unrelated: 1 } });
    expect(r.passed).toBe(false);
    expect(r.detail).toMatch(/neither 'action' nor 'assessments'/);
  });
});

describe(covers("hook.denies"), () => {
  it("green: hook ran and denied with a non-zero exit", () => {
    const r = checkHookDenies(okProc({ status: 2 }));
    expect(r.passed).toBe(true);
    expect(r.detail).toBe("exit 2");
  });
  it("red: hook allowed the edit (exit 0)", () => {
    expect(checkHookDenies(okProc({ status: 0 })).passed).toBe(false);
  });

  // THE vacuous-pass defect this issue asked us to look for.
  //
  // The original predicate was `hookResult.status !== 0`. When spawnSync fails
  // to launch, status is null, and `null !== 0` is true — so a hook that does
  // not exist at all scored a PASS, and the receipt claimed the packed artifact
  // enforced denial. Absence must never be read as a deny.
  it("red: hook binary missing — must NOT pass on status === null", () => {
    const result = failedToLaunch();
    expect(result.status !== 0).toBe(true); // what the old predicate saw
    const r = checkHookDenies(result);
    expect(r.passed).toBe(false); // what it must actually report
    expect(r.detail).toMatch(/hook did not run/);
  });
  it("red: hook killed by a signal rather than exiting", () => {
    const r = checkHookDenies(killedBySignal());
    expect(r.passed).toBe(false);
    expect(r.detail).toMatch(/did not exit normally/);
  });

  // The same vacuous pass one level further in, found by running the harness
  // against a candidate built with `hooks/` removed from package.json files[].
  // `node <missing script>` launches fine and exits 1, so every "did it launch
  // and exit non-zero" predicate reads a candidate that ships NO hook as a
  // passing deny. Unit cases alone did not catch this; the end-to-end broken
  // candidate did.
  it("red: node exited 1 because the hook script was missing, not because it denied", () => {
    const moduleNotFound = okProc({
      status: 1,
      stderr:
        "node:internal/modules/esm/resolve:275\n    throw new ERR_MODULE_NOT_FOUND(\n          ^\n" +
        "Error [ERR_MODULE_NOT_FOUND]: Cannot find module '/pkg/hooks/pre-edit-check.mjs'\n" +
        "    at finalizeResolution (node:internal/modules/esm/resolve:275:11)\n",
    });
    expect(moduleNotFound.status !== 0).toBe(true); // still non-zero
    const r = checkHookDenies(moduleNotFound);
    expect(r.passed).toBe(false);
    expect(r.detail).toMatch(/module not found.*is a crash, not a deny/);
  });

  it("red: hook threw before reaching a decision", () => {
    const threw = okProc({
      status: 1,
      stderr: "Uncaught TypeError: cannot read properties of undefined\n    at run (node:internal/main/run_main:1:1)\n",
    });
    expect(checkHookDenies(threw).passed).toBe(false);
  });

  // The deny path must not be collateral damage: a real deny that happens to
  // print a stack-shaped evidence line still passes.
  it("green: a genuine deny whose message mentions a path is not mistaken for a crash", () => {
    const deny = okProc({
      status: 2,
      stdout: "DENY: src/routes/checkout.ts is FRAGILE at src/routes/checkout.ts:14 — include co-change partners",
    });
    expect(checkHookDenies(deny).passed).toBe(true);
  });
});

describe(covers("hook.output-mentions-deny"), () => {
  it("green: denial language on stdout or stderr", () => {
    expect(checkHookOutputMentionsDeny(okProc({ status: 2, stdout: "FRAGILE: blocked" })).passed).toBe(true);
    expect(checkHookOutputMentionsDeny(okProc({ status: 2, stderr: "deny" })).passed).toBe(true);
  });
  it("red: ran but said nothing about a denial", () => {
    expect(checkHookOutputMentionsDeny(okProc({ status: 2, stdout: "all good" })).passed).toBe(false);
  });
  it("red: produced no output at all", () => {
    const r = checkHookOutputMentionsDeny(okProc({ status: 2 }));
    expect(r.passed).toBe(false);
    expect(r.detail).toMatch(/no output/);
  });
  it("red: never launched", () => {
    expect(checkHookOutputMentionsDeny(failedToLaunch()).passed).toBe(false);
  });
});

describe(covers("installer.help-usage"), () => {
  it("green: usage on stdout, exit 0", () => {
    expect(checkInstallerHelp(okProc({ stdout: "Usage:\n  install [--with-hook]" })).passed).toBe(true);
  });

  // META-285 defect 3, second half. The original asserted over `stdout` alone
  // while the installer wrote USAGE to console.error, so the check could not
  // pass even when help worked correctly. Which stream carries usage is a
  // presentation choice; that help is shown is the property.
  it("green: usage on stderr still counts as help being shown", () => {
    expect(checkInstallerHelp(okProc({ stderr: "Usage:\n  install" })).passed).toBe(true);
  });

  it("red: exited 0 but printed no usage", () => {
    const r = checkInstallerHelp(okProc({ stdout: "installed!" }));
    expect(r.passed).toBe(false);
    expect(r.detail).toMatch(/printed no usage/);
  });
  it("red: non-zero exit", () => {
    expect(checkInstallerHelp(okProc({ status: 1, stderr: "Usage:" })).passed).toBe(false);
  });
  it("red: installer never launched", () => {
    expect(checkInstallerHelp(failedToLaunch()).passed).toBe(false);
  });
});

describe(covers("installer.help-nondestructive"), () => {
  it("green: sandbox empty after --help", () => {
    expect(checkHelpWroteNothing([]).passed).toBe(true);
  });

  // The stop-now item, asserted positively. If `--help` regresses into a real
  // install, the installer writes .codex/config.toml into its cwd. Running help
  // in a disposable sandbox turns that into a visible red instead of a silent
  // rewrite of the source checkout.
  it("red: --help wrote a config into its working directory", () => {
    const r = checkHelpWroteNothing([".codex"]);
    expect(r.passed).toBe(false);
    expect(r.detail).toMatch(/--help wrote into its cwd: \.codex/);
  });
  it("red: sandbox could not be listed — absence of a listing is not proof of safety", () => {
    const r = checkHelpWroteNothing(undefined);
    expect(r.passed).toBe(false);
    expect(r.detail).toMatch(/cannot prove --help was non-destructive/);
  });
});

describe(covers("repo.tree-unchanged"), () => {
  it("green: clean before, clean after", () => {
    const r = checkTreeUnchanged("", "");
    expect(r.passed).toBe(true);
    expect(r.detail).toMatch(/tree clean and unmodified/);
  });

  // Comparing before/after rather than requiring "clean" means the check still
  // proves the harness changed nothing when it starts from a dirty checkout.
  it("green: dirty before, identically dirty after", () => {
    const dirty = " M src/index.ts\n?? scratch.txt\n";
    const r = checkTreeUnchanged(dirty, dirty);
    expect(r.passed).toBe(true);
    expect(r.detail).toMatch(/pre-existing changes preserved/);
  });

  // The exact signature of the destructive --help path recorded in the Aug 4
  // field observation: .codex/config.toml modified by the harness itself.
  it("red: harness modified a tracked file", () => {
    const r = checkTreeUnchanged("", " M .codex/config.toml\n");
    expect(r.passed).toBe(false);
    expect(r.detail).toMatch(/modified the source tree.*\.codex\/config\.toml/);
  });
  it("red: harness left a new untracked artifact behind", () => {
    const r = checkTreeUnchanged("", "?? codex-mcp-0.1.9.tgz\n");
    expect(r.passed).toBe(false);
    expect(r.detail).toMatch(/codex-mcp-0\.1\.9\.tgz/);
  });
  it("red: git status unavailable — safety not established, not assumed", () => {
    expect(checkTreeUnchanged(null, "").passed).toBe(false);
    expect(checkTreeUnchanged("", null).detail).toMatch(/tree safety not established/);
  });
});

describe("receipt: failed vs not-run", () => {
  const plan = [
    { id: "a", step: 1, name: "check a" },
    { id: "b", step: 1, name: "check b" },
    { id: "c", step: 2, name: "check c" },
  ];

  it("green: all planned checks ran and passed → CONSUMABLE", () => {
    const rec = createRecorder(plan);
    for (const { id } of plan) rec.record(id, { passed: true, detail: "ok" });
    const receipt = rec.buildReceipt({ generatedAt: "2026-08-12T00:00:00.000Z" });
    expect(receipt.verdict).toBe("CONSUMABLE");
    expect(receipt.summary).toEqual({ total: 3, passed: 3, failed: 0, notRun: 0 });
    expect(receipt.aborted).toBeNull();
  });

  it("red: a failure yields NOT_CONSUMABLE", () => {
    const rec = createRecorder(plan);
    rec.record("a", { passed: true });
    rec.record("b", { passed: false, detail: "broken" });
    rec.record("c", { passed: true });
    const receipt = rec.buildReceipt({});
    expect(receipt.verdict).toBe("NOT_CONSUMABLE");
    expect(receipt.summary.failed).toBe(1);
    expect(receipt.checks.find((c) => c.id === "b")?.status).toBe("fail");
  });

  // The receipt-level defect. The original computed the verdict from only the
  // checks that happened to execute, so a harness that threw after two passing
  // checks emitted "2/2 passed — CONSUMABLE". Unreached checks must be visible
  // as not_run, and must make the run INCOMPLETE rather than clean.
  it("red: an aborted run reports not_run and INCOMPLETE, never CONSUMABLE", () => {
    const rec = createRecorder(plan);
    rec.record("a", { passed: true });
    rec.record("b", { passed: true });
    const receipt = rec.buildReceipt({ aborted: { message: "MCP connect failed" } });

    expect(receipt.verdict).toBe("INCOMPLETE");
    expect(receipt.verdict).not.toBe("CONSUMABLE");
    expect(receipt.summary).toEqual({ total: 3, passed: 2, failed: 0, notRun: 1 });
    expect(receipt.checks.find((c) => c.id === "c")).toMatchObject({ status: "not_run", detail: null });
    expect(receipt.aborted).toEqual({ message: "MCP connect failed" });
  });

  it("not_run is a distinct status from fail", () => {
    const rec = createRecorder(plan);
    rec.record("a", { passed: false, detail: "broken" });
    const receipt = rec.buildReceipt({});
    const statuses = Object.fromEntries(receipt.checks.map((c) => [c.id, c.status]));
    expect(statuses).toEqual({ a: "fail", b: "not_run", c: "not_run" });
    expect(receipt.summary.failed).toBe(1);
    expect(receipt.summary.notRun).toBe(2);
  });

  it("a real failure outranks incompleteness in the verdict", () => {
    const rec = createRecorder(plan);
    rec.record("a", { passed: false });
    expect(rec.buildReceipt({}).verdict).toBe("NOT_CONSUMABLE");
  });

  it("every check keeps its plan identity in the receipt", () => {
    const receipt = createRecorder(plan).buildReceipt({});
    expect(receipt.checks.map((c) => c.id)).toEqual(["a", "b", "c"]);
    expect(receipt.checks[0]).toMatchObject({ id: "a", name: "check a", step: 1 });
  });

  // Guards against silent plan drift: a check that is renamed or recorded twice
  // must fail loudly rather than quietly shrink the evidence set.
  it("rejects unknown ids, duplicate records, and malformed outcomes", () => {
    const rec = createRecorder(plan);
    expect(() => rec.record("nonexistent", { passed: true })).toThrow(/unknown check id/);
    rec.record("a", { passed: true });
    expect(() => rec.record("a", { passed: true })).toThrow(/recorded twice/);
    expect(() => rec.record("b", { detail: "no verdict" } as never)).toThrow(/malformed outcome/);
  });
});

describe("watched-red coverage of the harness check plan", () => {
  it("every check in CHECK_PLAN has been demonstrated red and green above", () => {
    const planned = CHECK_PLAN.map((c) => c.id);
    const unproven = planned.filter((id) => !proven.has(id));
    expect(unproven).toEqual([]);
  });

  it("no test claims coverage of a check the harness does not run", () => {
    const planned = new Set(CHECK_PLAN.map((c) => c.id));
    expect([...proven].filter((id) => !planned.has(id))).toEqual([]);
  });

  it("check ids are unique", () => {
    const ids = CHECK_PLAN.map((c) => c.id);
    expect(ids.length).toBe(new Set(ids).size);
  });
});
