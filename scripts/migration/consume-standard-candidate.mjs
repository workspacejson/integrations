#!/usr/bin/env node
/**
 * Standard-candidate consumption harness (META-235 Step 5 / I-7).
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
 * Usage:
 *   node scripts/migration/consume-standard-candidate.mjs
 *   node scripts/migration/consume-standard-candidate.mjs --out <dir>
 */
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..", "..");
const fixtureRoot = join(repoRoot, "fixture");

function run(cmd, args, opts = {}) {
  const result = spawnSync(cmd, args, {
    encoding: "utf8",
    timeout: opts.timeout ?? 120000,
    cwd: opts.cwd ?? repoRoot,
    stdio: opts.stdio ?? "pipe",
  });
  return result;
}

function runOrDie(cmd, args, opts = {}) {
  const result = run(cmd, args, opts);
  if (result.status !== 0) {
    console.error(`${cmd} ${args.join(" ")} failed (exit ${result.status})`);
    if (result.stderr) console.error(result.stderr.slice(-2000));
    process.exit(1);
  }
  return result;
}

async function main() {
  const args = process.argv.slice(2);
  let outDir = null;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--out") outDir = resolve(args[++i]);
  }

  const work = mkdtempSync(join(tmpdir(), "consume-std-"));
  const packDir = join(work, "pack");
  const installDir = join(work, "install");
  mkdirSync(packDir, { recursive: true });
  mkdirSync(installDir, { recursive: true });

  let failures = 0;
  const checks = [];

  function record(name, passed, detail) {
    checks.push({ name, passed, detail });
    if (!passed) failures++;
    console.log(`${passed ? "PASS" : "FAIL"}  ${name}${!passed && detail ? `  ->  ${detail}` : ""}`);
  }

  try {
    // --- Step 1: Build and pack -------------------------------------------
    console.log("\n=== Step 1: Build and pack ===");
    runOrDie("npm", ["ci"], { cwd: repoRoot });
    runOrDie("npm", ["run", "build"], { cwd: repoRoot });
    runOrDie("npm", ["run", "build:extension"], { cwd: repoRoot });

    const packResult = runOrDie("npm", ["pack", "--json"], { cwd: repoRoot });
    const packMeta = JSON.parse(packResult.stdout)[0];
    const tarballPath = join(repoRoot, packMeta.filename);
    const tarballDest = join(packDir, packMeta.filename);
    cpSync(tarballPath, tarballDest);
    rmSync(tarballPath, { force: true });

    record("npm pack produces a tarball", existsSync(tarballDest), packMeta.filename);
    record(
      "tarball contains dist/index.js",
      packMeta.files?.some((f) => f.path === "dist/index.js"),
      JSON.stringify(packMeta.files?.map((f) => f.path)),
    );
    record(
      "tarball contains .mcp.json",
      packMeta.files?.some((f) => f.path === ".mcp.json"),
    );
    record(
      "tarball contains hooks/",
      packMeta.files?.some((f) => f.path === "hooks/"),
    );

    // --- Step 2: Install in disposable dir --------------------------------
    console.log("\n=== Step 2: Install from tarball ===");
    const installResult = run("npm", ["install", tarballDest], { cwd: installDir });
    record("npm install from tarball succeeds", installResult.status === 0, installResult.stderr?.slice(-500));

    // Verify the installed package has the expected bin entry
    const installedBin = join(installDir, "node_modules", "@workspacejson", "codex-mcp", "scripts", "install.mjs");
    record("installed package has scripts/install.mjs", existsSync(installedBin));

    const installedMain = join(installDir, "node_modules", "@workspacejson", "codex-mcp", "dist", "index.js");
    record("installed package has dist/index.js", existsSync(installedMain));

    // --- Step 3: Start MCP server from installed package ------------------
    console.log("\n=== Step 3: MCP server from packed artifact ===");

    // Copy fixture into install dir so the server can find workspace.json
    const fixtureDest = join(installDir, "fixture");
    cpSync(fixtureRoot, fixtureDest, { recursive: true });

    // Start the server using the installed package's main entry
    const serverPath = join(installDir, "node_modules", "@workspacejson", "codex-mcp", "dist", "index.js");

    // Use MCP client to test the server
    const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
    const { StdioClientTransport } = await import("@modelcontextprotocol/sdk/client/stdio.js");

    const transport = new StdioClientTransport({
      command: "node",
      args: [serverPath],
      env: { ...process.env, WORKSPACE_JSON_ROOT: fixtureDest },
    });
    const client = new Client({ name: "consume-harness", version: "0.0.0" });
    await client.connect(transport);

    // --- Step 4: Smoke test the packed server -----------------------------
    console.log("\n=== Step 4: Smoke test packed server ===");

    const instr = client.getInstructions();
    record("server instructions contain FRAGILE", instr?.includes("FRAGILE"), "missing instructions");

    const { tools } = await client.callTool({ name: "workspace_list_fragile_files", arguments: {} });
    const toolListResult = tools;
    record("server responds to tool calls", toolListResult !== undefined);

    const { tools: availableTools } = await client.listTools();
    const toolNames = availableTools.map((t) => t.name).sort();
    record(
      "tools/list returns 4 expected tools",
      JSON.stringify(toolNames) ===
        JSON.stringify([
          "workspace_assess_change",
          "workspace_get_cochange_partners",
          "workspace_get_file_context",
          "workspace_list_fragile_files",
        ]),
      toolNames.join(","),
    );

    // Test file context retrieval through the packed artifact
    const r1 = await client.callTool({
      name: "workspace_get_file_context",
      arguments: { path: "src/routes/checkout.ts" },
    });
    const s1 = r1.structuredContent;
    record(
      "file context returns fragility tier",
      s1?.fragility?.tier !== undefined,
      JSON.stringify(s1?.fragility?.tier),
    );
    record(
      "file context returns evidence",
      Array.isArray(s1?.fragility?.evidence),
      JSON.stringify(s1?.fragility?.evidence),
    );

    // Test co-change partners
    const r2 = await client.callTool({
      name: "workspace_get_cochange_partners",
      arguments: { path: "src/routes/checkout.ts" },
    });
    const s2 = r2.structuredContent;
    record("co-change partners returns array", Array.isArray(s2?.partners), JSON.stringify(s2?.partners));

    // Test assess change
    const r3 = await client.callTool({
      name: "workspace_assess_change",
      arguments: { paths: ["src/routes/checkout.ts"] },
    });
    const s3 = r3.structuredContent;
    record(
      "assess change returns decision",
      s3?.decision !== undefined || s3?.results !== undefined,
      JSON.stringify(s3),
    );

    await client.close();

    // --- Step 5: Hook from packed artifact --------------------------------
    console.log("\n=== Step 5: Hook from packed artifact ===");
    const hookPath = join(installDir, "node_modules", "@workspacejson", "codex-mcp", "hooks", "pre-edit-check.mjs");
    record("hook script exists in packed artifact", existsSync(hookPath));

    const hookResult = run("node", [hookPath, "--paths", "src/routes/checkout.ts"], {
      cwd: fixtureDest,
    });
    record(
      "hook exits non-zero on evidenced-fragile without partners",
      hookResult.status !== 0,
      `exit ${hookResult.status}`,
    );
    record(
      "hook output mentions FRAGILE or deny",
      /FRAGILE|deny|block/i.test(hookResult.stdout + hookResult.stderr),
      (hookResult.stdout + hookResult.stderr).slice(-500),
    );

    // --- Step 6: Installer from packed artifact ---------------------------
    console.log("\n=== Step 6: Installer from packed artifact ===");
    const installScript = join(installDir, "node_modules", "@workspacejson", "codex-mcp", "scripts", "install.mjs");
    record("installer script exists in packed artifact", existsSync(installScript));

    const installHelp = run("node", [installScript, "--help"]);
    record(
      "installer --help works from packed artifact",
      installHelp.status === 0 && /Usage:/i.test(installHelp.stdout),
      installHelp.stdout.slice(-500),
    );
  } finally {
    // --- Write receipt -----------------------------------------------------
    const receipt = {
      $comment:
        "Standard-candidate consumption harness receipt. Generated by scripts/migration/consume-standard-candidate.mjs — do not hand-edit.",
      generatedAt: new Date().toISOString(),
      summary: {
        total: checks.length,
        passed: checks.filter((c) => c.passed).length,
        failed: checks.filter((c) => !c.passed).length,
      },
      verdict: failures === 0 ? "CONSUMABLE" : "NOT_CONSUMABLE",
      checks: checks.map((c) => ({ name: c.name, status: c.passed ? "pass" : "fail", detail: c.detail ?? null })),
    };

    if (outDir) {
      mkdirSync(outDir, { recursive: true });
      writeFileSync(join(outDir, "consumption-receipt.json"), `${JSON.stringify(receipt, null, 2)}\n`);
      console.log(`\nReceipt: ${join(outDir, "consumption-receipt.json")}`);
    }

    console.log(
      `\nConsumption verdict: ${receipt.verdict} — ${receipt.summary.passed}/${receipt.summary.total} passed, ${receipt.summary.failed} failed.`,
    );
    rmSync(work, { recursive: true, force: true });
    process.exitCode = failures > 0 ? 1 : 0;
  }
}

main().catch((err) => {
  console.error("consume-standard-candidate crashed:", err);
  process.exitCode = 2;
});
