#!/usr/bin/env node
/**
 * Standard-candidate consumption harness (META-235 Step 5 / META-258 I-7).
 *
 * Packs the current repo as an npm tarball, installs it in a disposable
 * directory, starts the MCP server from the packed artifact (not from
 * source), and runs smoke tests against the fixture workspace.json.
 *
 * This is the mechanical core of Tier-2/Tier-3 conformance: it proves
 * a packed standard candidate can be consumed without internal source,
 * using only the published artifact. An external consumer who installs
 * the npm package and runs the server is doing exactly what this harness
 * does.
 *
 * Every assertion lives in ./consumption-checks.mjs, which the harness calls
 * and tests/migration/consumption-checks.test.ts exercises in both directions.
 * Assertions are not written inline here: a check the tests cannot reach is a
 * check nobody has watched go red (META-285, META-165 scope amendment).
 *
 * A verification script must not mutate the thing it verifies. Two structural
 * rules enforce that here:
 *   - `run()` requires an explicit cwd. There is no repo-root default to
 *     forget, which is how `--help` came to run a real install into the source
 *     checkout (META-285 stop-now item).
 *   - The source tree is fingerprinted before and after, and the comparison is
 *     itself a recorded check.
 *
 * Usage:
 *   node scripts/migration/consume-standard-candidate.mjs
 *   node scripts/migration/consume-standard-candidate.mjs --out <dir>
 *   node scripts/migration/consume-standard-candidate.mjs --help
 */
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
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
} from "./consumption-checks.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..", "..");
const fixtureRoot = join(repoRoot, "fixture");

const USAGE = [
  "Usage:",
  "  node scripts/migration/consume-standard-candidate.mjs [--out <dir>]",
  "",
  "Packs this repository, installs the tarball into a disposable directory, and",
  "verifies the packed artifact is consumable. Writes no files outside --out and",
  "makes no change to this checkout.",
  "",
  "Options:",
  "  --out <dir>   Write consumption-receipt.json into <dir>",
  "  --help, -h    Show this message and exit without running anything",
].join("\n");

/**
 * `cwd` is required, not defaulted.
 *
 * The original helper defaulted to `repoRoot`, so any invocation that forgot
 * to pass a cwd silently targeted the source checkout — which is how the
 * installer `--help` probe came to run a real install against this repo.
 * Making it required means that mistake cannot be made silently again.
 */
function run(cmd, args, opts = {}) {
  if (!opts.cwd) throw new Error(`run(${cmd}) requires an explicit cwd — refusing to default to the source repo`);
  return spawnSync(cmd, args, {
    encoding: "utf8",
    timeout: opts.timeout ?? 120000,
    cwd: opts.cwd,
    stdio: opts.stdio ?? "pipe",
    env: opts.env ?? process.env,
  });
}

function runOrDie(cmd, args, opts = {}) {
  const result = run(cmd, args, opts);
  if (result.error) throw new Error(`${cmd} ${args.join(" ")} failed to launch: ${result.error.message}`);
  if (result.status !== 0) {
    const detail = (result.stderr ?? "").slice(-2000);
    throw new Error(`${cmd} ${args.join(" ")} failed (exit ${result.status})\n${detail}`);
  }
  return result;
}

/** Fingerprint of the source checkout, used to prove the harness changed nothing. */
function treeFingerprint() {
  const result = spawnSync("git", ["status", "--porcelain"], { encoding: "utf8", cwd: repoRoot, timeout: 30000 });
  if (result.error || result.status !== 0) return null;
  return result.stdout;
}

function parseArgs(argv) {
  const opts = { outDir: null, help: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") {
      opts.help = true;
    } else if (arg === "--out") {
      const value = argv[++i];
      if (!value) throw new Error("--out requires a directory argument");
      opts.outDir = resolve(value);
    } else if (arg.startsWith("--out=")) {
      const value = arg.slice("--out=".length);
      if (!value) throw new Error("--out= requires a directory argument");
      opts.outDir = resolve(value);
    } else {
      throw new Error(`unknown argument: ${arg}\n\n${USAGE}`);
    }
  }
  return opts;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) {
    console.log(USAGE);
    return;
  }

  const treeBefore = treeFingerprint();
  const work = mkdtempSync(join(tmpdir(), "consume-std-"));
  const packDir = join(work, "pack");
  const installDir = join(work, "install");
  // A sandbox that starts empty and must stay empty. Anything the installer
  // writes while being asked for help lands here, where it is visible.
  const helpSandbox = join(work, "help-sandbox");
  mkdirSync(packDir, { recursive: true });
  mkdirSync(installDir, { recursive: true });
  mkdirSync(helpSandbox, { recursive: true });

  const recorder = createRecorder();
  let client = null;
  let aborted = null;

  function record(id, outcome) {
    const entry = recorder.record(id, outcome);
    console.log(`${entry.passed ? "PASS" : "FAIL"}  ${entry.name}${entry.detail ? `  ->  ${entry.detail}` : ""}`);
  }

  try {
    // --- Step 1: Build and pack -------------------------------------------
    console.log("\n=== Step 1: Build and pack ===");
    runOrDie("npm", ["ci"], { cwd: repoRoot, timeout: 300000 });
    runOrDie("npm", ["run", "build"], { cwd: repoRoot });
    runOrDie("npm", ["run", "build:extension"], { cwd: repoRoot, timeout: 600000 });

    const packResult = runOrDie("npm", ["pack", "--json"], { cwd: repoRoot });
    const packMeta = JSON.parse(packResult.stdout)[0];
    const tarballPath = join(repoRoot, packMeta.filename);
    const tarballDest = join(packDir, packMeta.filename);
    cpSync(tarballPath, tarballDest);
    // `npm pack` writes the tarball into the repo; removing it is what keeps
    // the source tree unmodified, and repo.tree-unchanged proves it did.
    rmSync(tarballPath, { force: true });

    record("pack.tarball", checkTarballExists(existsSync(tarballDest), packMeta.filename));
    record("pack.dist-index", checkPackContainsPath(packMeta, "dist/index.js"));
    record("pack.mcp-json", checkPackContainsPath(packMeta, ".mcp.json"));
    record("pack.hooks", checkPackContainsPrefix(packMeta, "hooks/"));

    // --- Step 2: Install in disposable dir --------------------------------
    console.log("\n=== Step 2: Install from tarball ===");
    const installResult = run("npm", ["install", tarballDest], { cwd: installDir, timeout: 300000 });
    record("install.from-tarball", checkProcessSucceeded(installResult, "npm install"));

    const installedPkg = join(installDir, "node_modules", "@workspacejson", "codex-mcp");
    const installedBin = join(installedPkg, "scripts", "install.mjs");
    const installedMain = join(installedPkg, "dist", "index.js");
    record("install.has-install-script", checkPathExists(existsSync(installedBin), installedBin));
    record("install.has-dist-index", checkPathExists(existsSync(installedMain), installedMain));

    // --- Step 3: Start MCP server from installed package ------------------
    console.log("\n=== Step 3: MCP server from packed artifact ===");

    const fixtureDest = join(installDir, "fixture");
    cpSync(fixtureRoot, fixtureDest, { recursive: true });

    const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
    const { StdioClientTransport } = await import("@modelcontextprotocol/sdk/client/stdio.js");

    const transport = new StdioClientTransport({
      command: "node",
      args: [installedMain],
      env: { ...process.env, WORKSPACE_JSON_ROOT: fixtureDest },
    });
    client = new Client({ name: "consume-harness", version: "0.0.0" });
    await client.connect(transport);

    // --- Step 4: Smoke test the packed server -----------------------------
    console.log("\n=== Step 4: Smoke test packed server ===");

    record("mcp.instructions-fragile", checkInstructionsMention(client.getInstructions(), "FRAGILE"));

    const listResult = await client.callTool({ name: "workspace_list_fragile_files", arguments: {} });
    record("mcp.tool-call-responds", checkToolCallResponded(listResult));

    record("mcp.tools-list", checkToolsList(await client.listTools()));

    const fileContext = await client.callTool({
      name: "workspace_get_file_context",
      arguments: { path: "src/routes/checkout.ts" },
    });
    record("mcp.file-context-tier", checkFragilityTier(fileContext));
    record("mcp.file-context-evidence", checkFragilityEvidence(fileContext));

    const cochange = await client.callTool({
      name: "workspace_get_cochange_partners",
      arguments: { path: "src/routes/checkout.ts" },
    });
    record("mcp.cochange-partners", checkCochangePartners(cochange));

    const assess = await client.callTool({
      name: "workspace_assess_change",
      arguments: { paths: ["src/routes/checkout.ts"] },
    });
    record("mcp.assess-change", checkAssessDecision(assess));

    // --- Step 5: Hook from packed artifact --------------------------------
    console.log("\n=== Step 5: Hook from packed artifact ===");
    const hookPath = join(installedPkg, "hooks", "pre-edit-check.mjs");
    record("hook.exists", checkPathExists(existsSync(hookPath), hookPath));

    const hookResult = run("node", [hookPath, "--paths", "src/routes/checkout.ts"], { cwd: fixtureDest });
    record("hook.denies", checkHookDenies(hookResult));
    record("hook.output-mentions-deny", checkHookOutputMentionsDeny(hookResult));

    // --- Step 6: Installer from packed artifact ---------------------------
    console.log("\n=== Step 6: Installer from packed artifact ===");
    const installScript = join(installedPkg, "scripts", "install.mjs");
    record("installer.exists", checkPathExists(existsSync(installScript), installScript));

    // Help runs inside the disposable sandbox, never the source repo. If help
    // ever regresses into an install again, it installs into a directory we
    // then inspect — and installer.help-nondestructive goes red — instead of
    // silently rewriting this checkout's .codex/config.toml.
    const installHelp = run("node", [installScript, "--help"], { cwd: helpSandbox });
    record("installer.help-usage", checkInstallerHelp(installHelp));
    record("installer.help-nondestructive", checkHelpWroteNothing(readdirSync(helpSandbox)));
  } catch (err) {
    // The run is incomplete, not passing. Unreached checks stay `not_run` and
    // the verdict cannot be CONSUMABLE.
    aborted = { message: err instanceof Error ? err.message : String(err) };
    console.error(`\nHarness aborted: ${aborted.message}`);
  } finally {
    // Close the client whatever happened. With the original happy-path-only
    // close, any throw between connect and close leaked the spawned MCP server
    // and hung CI instead of failing it.
    if (client) {
      try {
        await client.close();
      } catch (closeErr) {
        console.error(`Warning: MCP client close failed: ${closeErr.message}`);
      }
    }

    // --- Step 7: Source-tree safety ---------------------------------------
    // Recorded last so it covers everything the harness did, and recorded even
    // on abort — an aborted run is exactly when a stray mutation is likeliest.
    try {
      record("repo.tree-unchanged", checkTreeUnchanged(treeBefore, treeFingerprint()));
    } catch (recordErr) {
      console.error(`Warning: could not record tree check: ${recordErr.message}`);
    }

    const receipt = recorder.buildReceipt({ aborted });

    if (opts.outDir) {
      mkdirSync(opts.outDir, { recursive: true });
      const receiptPath = join(opts.outDir, "consumption-receipt.json");
      writeFileSync(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`);
      console.log(`\nReceipt: ${receiptPath}`);
    }

    const { total, passed, failed, notRun } = receipt.summary;
    console.log(
      `\nConsumption verdict: ${receipt.verdict} — ${passed}/${total} passed, ${failed} failed, ${notRun} not run.`,
    );
    if (aborted) console.log(`Aborted before completion: ${aborted.message}`);

    rmSync(work, { recursive: true, force: true });
    process.exitCode = receipt.verdict === "CONSUMABLE" ? 0 : 1;
  }
}

const isDirectRun = process.argv[1] === fileURLToPath(import.meta.url);
if (isDirectRun) {
  main().catch((err) => {
    console.error("consume-standard-candidate crashed:", err);
    process.exitCode = 2;
  });
}
