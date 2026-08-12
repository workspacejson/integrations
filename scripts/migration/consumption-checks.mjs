/**
 * Check predicates and receipt construction for the standard-candidate
 * consumption harness (META-285 / META-235 Step 5 / META-258 I-7).
 *
 * This module exists so that every check the harness runs has exactly ONE
 * implementation, which the harness calls and the tests exercise. The
 * alternative — the harness asserting inline while a test reimplements the
 * same logic — is the one-concept-two-implementations class tracked in
 * META-140, and it already bit `verify-receipt.test.ts`.
 *
 * Contract for every predicate here (the META-165 scope amendment):
 *
 *   No verification check enters service until it has been demonstrated to
 *   FAIL when the property is broken and to PASS when it is not.
 *
 * Two consequences shape the code below:
 *
 * 1. Predicates take plain data, never live handles, so a test can hand them
 *    a deliberately broken input without standing up an MCP server.
 * 2. Predicates never infer success from absence. A `spawnSync` result that
 *    never launched, a result object of the wrong shape, and a missing
 *    optional field are all explicit failures with a stated reason — not a
 *    falsy value that happens to land on the passing side of a comparison.
 *
 * Defect 2 in META-238 and defect 1 in META-285 are the same root cause read
 * off a property nobody verified. There the silent `undefined` produced a
 * vacuous pass; here it produced a guaranteed fail. The direction was luck.
 * These predicates remove the luck by checking shape before value.
 */

/**
 * Every check the harness is expected to run, in execution order.
 *
 * The plan is declared up front rather than accumulated as checks execute.
 * That is what lets the receipt distinguish "this check failed" from "this
 * check never ran": a harness that throws midway leaves the unreached entries
 * as `not_run` instead of silently shortening the list and reporting a clean
 * sweep of whatever happened to complete first.
 */
export const CHECK_PLAN = [
  { id: "pack.tarball", step: 1, name: "npm pack produces a tarball" },
  { id: "pack.dist-index", step: 1, name: "tarball contains dist/index.js" },
  { id: "pack.mcp-json", step: 1, name: "tarball contains .mcp.json" },
  { id: "pack.hooks", step: 1, name: "tarball contains hooks/" },
  { id: "install.from-tarball", step: 2, name: "npm install from tarball succeeds" },
  { id: "install.has-install-script", step: 2, name: "installed package has scripts/install.mjs" },
  { id: "install.has-dist-index", step: 2, name: "installed package has dist/index.js" },
  { id: "mcp.instructions-fragile", step: 4, name: "server instructions contain FRAGILE" },
  { id: "mcp.tool-call-responds", step: 4, name: "server responds to tool calls" },
  { id: "mcp.tools-list", step: 4, name: "tools/list returns the 4 expected tools" },
  { id: "mcp.file-context-tier", step: 4, name: "file context returns fragility tier" },
  { id: "mcp.file-context-evidence", step: 4, name: "file context returns evidence" },
  { id: "mcp.cochange-partners", step: 4, name: "co-change partners returns array" },
  { id: "mcp.assess-change", step: 4, name: "assess change returns decision" },
  { id: "hook.exists", step: 5, name: "hook script exists in packed artifact" },
  { id: "hook.denies", step: 5, name: "hook exits non-zero on evidenced-fragile without partners" },
  { id: "hook.output-mentions-deny", step: 5, name: "hook output mentions FRAGILE or deny" },
  { id: "installer.exists", step: 6, name: "installer script exists in packed artifact" },
  { id: "installer.help-usage", step: 6, name: "installer --help works from packed artifact" },
  { id: "installer.help-nondestructive", step: 6, name: "installer --help writes no config into its cwd" },
  { id: "repo.tree-unchanged", step: 7, name: "harness leaves the source working tree unmodified" },
];

export const EXPECTED_TOOLS = [
  "workspace_assess_change",
  "workspace_get_cochange_partners",
  "workspace_get_file_context",
  "workspace_list_fragile_files",
];

const pass = (detail) => ({ passed: true, detail: detail ?? null });
const fail = (detail) => ({ passed: false, detail: detail ?? null });

// ── Step 1: pack inventory ────────────────────────────────────────────────

/**
 * `npm pack --json` reports the files it placed in the tarball. Shape is
 * verified before use: a missing or non-array `files` means we learned
 * nothing about the tarball, which is a failure, not an absent violation.
 */
function packFilePaths(packMeta) {
  if (!packMeta || typeof packMeta !== "object") {
    return { error: "pack metadata is not an object" };
  }
  if (!Array.isArray(packMeta.files)) {
    return { error: `pack metadata has no files[] array (got ${typeof packMeta.files})` };
  }
  const paths = [];
  for (const entry of packMeta.files) {
    if (!entry || typeof entry.path !== "string") {
      return { error: `pack metadata contains an entry without a string path: ${JSON.stringify(entry)}` };
    }
    paths.push(entry.path);
  }
  return { paths };
}

export function checkTarballExists(tarballExists, filename) {
  return tarballExists
    ? pass(filename ?? null)
    : fail(`tarball not found at destination (${filename ?? "no filename"})`);
}

/** Exact-path membership, for files that ship at a known path. */
export function checkPackContainsPath(packMeta, wanted) {
  const { paths, error } = packFilePaths(packMeta);
  if (error) return fail(error);
  if (paths.includes(wanted)) return pass(wanted);
  return fail(`'${wanted}' absent from ${paths.length} packed files`);
}

/**
 * Prefix membership, for directories. `npm pack --json` emits individual file
 * paths and never a directory entry, so `path === "hooks/"` can never match —
 * META-285 defect 2. A directory is present iff some packed file lives under it.
 */
export function checkPackContainsPrefix(packMeta, prefix) {
  const { paths, error } = packFilePaths(packMeta);
  if (error) return fail(error);
  const matches = paths.filter((p) => p.startsWith(prefix));
  if (matches.length > 0) return pass(`${matches.length} file(s) under '${prefix}': ${matches.slice(0, 5).join(", ")}`);
  return fail(`no packed file starts with '${prefix}' (${paths.length} packed files)`);
}

// ── Process results ───────────────────────────────────────────────────────

/**
 * Classify a `spawnSync` result before reading its status.
 *
 * `spawnSync` returns `status: null` when the process never exited normally —
 * it failed to launch (ENOENT) or died on a signal. Any predicate that reads
 * `status` without this guard is unsound in one direction or the other:
 * `status === 0` turns a launch failure into a fail (survivable), while
 * `status !== 0` turns a launch failure into a PASS (vacuous — META-285
 * defect, `hook.denies` at the original `:206`).
 */
function launched(result) {
  if (!result || typeof result !== "object") return "no spawn result";
  if (result.error) return `process failed to launch: ${result.error.message}`;
  if (result.status === null || result.status === undefined) {
    return `process did not exit normally (signal ${result.signal ?? "unknown"})`;
  }
  return null;
}

export function checkProcessSucceeded(result, what) {
  const problem = launched(result);
  if (problem) return fail(`${what}: ${problem}`);
  if (result.status !== 0) return fail(`${what}: exit ${result.status} ${(result.stderr ?? "").slice(-300)}`.trim());
  return pass(`${what}: exit 0`);
}

export function checkPathExists(exists, path) {
  return exists ? pass(path) : fail(`not found: ${path}`);
}

// ── Step 4: MCP server responses ──────────────────────────────────────────

export function checkInstructionsMention(instructions, token) {
  if (typeof instructions !== "string") {
    return fail(
      `server returned no instructions string (got ${instructions === undefined ? "undefined" : typeof instructions})`,
    );
  }
  if (!instructions.includes(token)) {
    return fail(`instructions present (${instructions.length} chars) but do not mention '${token}'`);
  }
  return pass(`instructions mention '${token}'`);
}

/**
 * A tool call responded usefully.
 *
 * `isError` is optional on `CallToolResult`, so `!result.isError` alone passes
 * for a malformed or empty result — it cannot distinguish "the server answered"
 * from "we got something that isn't a tool result". `content` is required by
 * the MCP spec, so its presence is what proves we are holding a real result.
 */
export function checkToolCallResponded(result) {
  if (!result || typeof result !== "object") {
    return fail(`tool result is not an object (got ${result === undefined ? "undefined" : typeof result})`);
  }
  if (result.isError === true) {
    return fail(`server reported isError: ${JSON.stringify(result.content ?? null).slice(0, 300)}`);
  }
  if (!Array.isArray(result.content)) {
    return fail(`tool result has no content[] array (got ${typeof result.content}) — result shape unverified`);
  }
  return pass(`content entries: ${result.content.length}`);
}

export function checkToolsList(listResult, expected = EXPECTED_TOOLS) {
  if (!listResult || typeof listResult !== "object") {
    return fail(
      `tools/list result is not an object (got ${listResult === undefined ? "undefined" : typeof listResult})`,
    );
  }
  if (!Array.isArray(listResult.tools)) {
    return fail(`tools/list result has no tools[] array (got ${typeof listResult.tools})`);
  }
  for (const tool of listResult.tools) {
    if (!tool || typeof tool.name !== "string") {
      return fail(`tools/list contains an entry without a string name: ${JSON.stringify(tool)}`);
    }
  }
  const actual = listResult.tools.map((t) => t.name).sort();
  const want = [...expected].sort();
  if (JSON.stringify(actual) !== JSON.stringify(want)) {
    return fail(`expected [${want.join(", ")}], got [${actual.join(", ")}]`);
  }
  return pass(actual.join(","));
}

function structuredContent(result) {
  if (!result || typeof result !== "object") {
    return { error: `tool result is not an object (got ${result === undefined ? "undefined" : typeof result})` };
  }
  if (result.isError === true) return { error: "server reported isError" };
  if (!result.structuredContent || typeof result.structuredContent !== "object") {
    return { error: `tool result has no structuredContent object (got ${typeof result.structuredContent})` };
  }
  return { value: result.structuredContent };
}

export function checkFragilityTier(result) {
  const { value, error } = structuredContent(result);
  if (error) return fail(error);
  const tier = value.fragility?.tier;
  if (tier === undefined || tier === null)
    return fail(`structuredContent.fragility.tier absent: ${JSON.stringify(value).slice(0, 300)}`);
  return pass(`tier=${JSON.stringify(tier)}`);
}

export function checkFragilityEvidence(result) {
  const { value, error } = structuredContent(result);
  if (error) return fail(error);
  if (!Array.isArray(value.fragility?.evidence)) {
    return fail(`structuredContent.fragility.evidence is not an array (got ${typeof value.fragility?.evidence})`);
  }
  return pass(`${value.fragility.evidence.length} evidence entries`);
}

export function checkCochangePartners(result) {
  const { value, error } = structuredContent(result);
  if (error) return fail(error);
  if (!Array.isArray(value.partners)) {
    return fail(`structuredContent.partners is not an array (got ${typeof value.partners})`);
  }
  return pass(`${value.partners.length} partners`);
}

export function checkAssessDecision(result) {
  const { value, error } = structuredContent(result);
  if (error) return fail(error);
  if (value.action === undefined && value.assessments === undefined) {
    return fail(`structuredContent has neither 'action' nor 'assessments': ${JSON.stringify(value).slice(0, 300)}`);
  }
  return pass(JSON.stringify({ action: value.action, assessments: value.assessments }).slice(0, 300));
}

// ── Step 5: hook behaviour ────────────────────────────────────────────────

/**
 * Node exited non-zero because it could not run the script at all, rather than
 * because the script decided something.
 *
 * `node <missing-or-broken-script>` launches successfully — the node binary
 * exists — and exits 1 after failing to load. A predicate that only asks
 * "non-zero?" reads that crash as a deny, so a candidate shipping NO hook at
 * all scores a passing deny check. This is the same vacuous-pass shape as the
 * original `status !== 0`, one level further in, and it was caught by running
 * the harness against a candidate with `hooks/` removed from `files` rather
 * than by any unit case.
 */
function crashedInsteadOfRunning(result) {
  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
  if (/ERR_MODULE_NOT_FOUND|ERR_UNKNOWN_FILE_EXTENSION|Cannot find module/.test(output)) {
    return "node could not load the hook script (module not found)";
  }
  if (/^\s*at .*node:internal/m.test(output) && /Error\b/.test(output)) {
    return "node exited on an unhandled error before the hook reached a decision";
  }
  return null;
}

/**
 * The hook must actively deny — launch, run to a decision, and exit non-zero.
 * A hook that cannot launch, or that crashes before deciding, is a failure of
 * the packed artifact, not a denial.
 */
export function checkHookDenies(result) {
  const problem = launched(result);
  if (problem) return fail(`hook did not run: ${problem}`);
  if (result.status === 0) return fail("hook exited 0; expected a non-zero deny on an evidenced-fragile path");
  const crash = crashedInsteadOfRunning(result);
  if (crash) return fail(`${crash} — exit ${result.status} is a crash, not a deny`);
  return pass(`exit ${result.status}`);
}

export function checkHookOutputMentionsDeny(result) {
  const problem = launched(result);
  if (problem) return fail(`hook did not run: ${problem}`);
  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
  if (output.trim() === "") return fail("hook produced no output");
  if (!/FRAGILE|deny|block/i.test(output)) return fail(`output mentions no denial: ${output.slice(-300)}`);
  return pass(output.slice(-200).trim());
}

// ── Step 6: installer help ────────────────────────────────────────────────

/**
 * `--help` must print usage and exit 0.
 *
 * Checked against combined stdout+stderr deliberately. The original harness
 * read `stdout` only while the installer wrote `USAGE` to `console.error`, so
 * the check could not pass even when help worked. Which stream carries usage
 * is a presentation choice; that help is shown at all is the property.
 */
export function checkInstallerHelp(result) {
  const problem = launched(result);
  if (problem) return fail(`installer did not run: ${problem}`);
  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
  if (result.status !== 0) return fail(`--help exited ${result.status}: ${output.slice(-300)}`);
  if (!/Usage:/i.test(output)) return fail(`--help exited 0 but printed no usage: ${output.slice(-300)}`);
  return pass(`exit 0, usage printed (${output.length} chars)`);
}

/**
 * `--help` must not install anything into the directory it runs in.
 *
 * This is the positive form of the META-285 stop-now item. Asserting only that
 * the SOURCE tree is clean is weaker: it passes for the wrong reason whenever
 * the source tree is already dirty, and it cannot see a destructive install
 * aimed anywhere else. Running help inside a disposable sandbox and proving
 * the sandbox stayed empty detects the destructive behaviour directly.
 *
 * `artifactsAfter` is the list of paths present in the sandbox after the run.
 */
export function checkHelpWroteNothing(artifactsAfter) {
  if (!Array.isArray(artifactsAfter)) {
    return fail(`sandbox listing unavailable (got ${typeof artifactsAfter}) — cannot prove --help was non-destructive`);
  }
  if (artifactsAfter.length > 0) {
    return fail(`--help wrote into its cwd: ${artifactsAfter.join(", ")}`);
  }
  return pass("sandbox empty after --help");
}

// ── Step 7: source-tree safety ────────────────────────────────────────────

/**
 * The harness must not modify the repository it verifies.
 *
 * Compares `git status --porcelain` before and after. Comparing before/after
 * rather than requiring "clean" means the check still proves the harness made
 * no change when started from an already-dirty checkout, and it cannot be
 * satisfied by an unrelated pre-existing dirty state.
 */
export function checkTreeUnchanged(before, after) {
  if (typeof before !== "string" || typeof after !== "string") {
    return fail("git status unavailable before or after the run — tree safety not established");
  }
  if (before !== after) {
    const beforeSet = new Set(before.split("\n").filter(Boolean));
    const changed = after.split("\n").filter((line) => line && !beforeSet.has(line));
    return fail(`harness modified the source tree: ${changed.join(" | ") || "(entries removed)"}`);
  }
  return pass(before.trim() === "" ? "tree clean and unmodified" : "tree unmodified (pre-existing changes preserved)");
}

// ── Recorder / receipt ────────────────────────────────────────────────────

/**
 * Records outcomes against the declared plan and builds the receipt.
 *
 * Rejects unknown and duplicate check ids. A harness that stops running a
 * planned check then surfaces it as `not_run`; one that renames a check fails
 * loudly here rather than quietly shrinking the evidence set.
 */
export function createRecorder(plan = CHECK_PLAN) {
  const known = new Map(plan.map((c) => [c.id, c]));
  const results = new Map();

  return {
    record(id, outcome) {
      const spec = known.get(id);
      if (!spec) throw new Error(`consumption-checks: unknown check id '${id}' — not in CHECK_PLAN`);
      if (results.has(id)) throw new Error(`consumption-checks: check '${id}' recorded twice`);
      if (!outcome || typeof outcome.passed !== "boolean") {
        throw new Error(`consumption-checks: check '${id}' recorded a malformed outcome: ${JSON.stringify(outcome)}`);
      }
      results.set(id, outcome);
      return { ...spec, ...outcome };
    },

    buildReceipt({ generatedAt, aborted = null } = {}) {
      const checks = plan.map(({ id, name, step }) => {
        const outcome = results.get(id);
        if (!outcome) return { id, name, step, status: "not_run", detail: null };
        return { id, name, step, status: outcome.passed ? "pass" : "fail", detail: outcome.detail ?? null };
      });

      const count = (status) => checks.filter((c) => c.status === status).length;
      const failed = count("fail");
      const notRun = count("not_run");

      // Precedence is deliberate. A real failure outranks incompleteness, and
      // CONSUMABLE requires that every planned check actually ran. The old
      // harness computed `failures === 0 ? "CONSUMABLE" : ...` over only the
      // checks that happened to execute, so a crash after seven passing checks
      // produced "7/7 passed — CONSUMABLE" for a harness that never finished.
      const verdict = failed > 0 ? "NOT_CONSUMABLE" : notRun > 0 ? "INCOMPLETE" : "CONSUMABLE";

      return {
        $comment:
          "Standard-candidate consumption harness receipt. Generated by scripts/migration/consume-standard-candidate.mjs — do not hand-edit.",
        generatedAt: generatedAt ?? new Date().toISOString(),
        verdict,
        aborted,
        summary: { total: checks.length, passed: count("pass"), failed, notRun },
        checks,
      };
    },
  };
}

/** A receipt is admissible evidence of consumability only when nothing failed AND nothing was skipped. */
export function receiptIsClean(receipt) {
  return receipt.verdict === "CONSUMABLE";
}
