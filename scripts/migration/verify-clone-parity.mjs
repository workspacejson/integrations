#!/usr/bin/env node
/**
 * META-241 clone-parity verifier (Phase 1).
 *
 * Proves the workspacejson/integrations clone preserves the frozen
 * workspace-json/codex-mcp source at the packed-artifact and behavior level —
 * not just at the source-tree level. Builds clean checkouts of the frozen
 * source SHA and the target ref, then compares:
 *
 *   git tree, npm pack inventory + packed manifest identity, bin entrypoints,
 *   MCP smoke behavior, hook allow/deny/failure behavior, installer output and
 *   installed assets in disposable dirs, plugin/hook/skill surfaces, extension
 *   VSIX identity + asset inventory, and generator-command resolution.
 *
 * Receipts (docs/migration/parity-receipt.json + .md) are emitted even when
 * verification fails. The only normalization ever applied is demonstrably
 * nondeterministic or environment-specific data: ZIP/tar archive metadata
 * (never compared — extracted CONTENT is hashed instead) and the installer's
 * own absolute package-root path embedded in generated config.toml hook stanzas.
 * Filenames, manifest values, commands, code, assets and behavior are never
 * normalized to force a pass.
 *
 * Usage:
 *   node scripts/migration/verify-clone-parity.mjs                 # full run from git refs
 *   node scripts/migration/verify-clone-parity.mjs --target-ref <ref>
 *   node scripts/migration/verify-clone-parity.mjs --source-dir D --target-dir D [--skip-prepare]
 *   node scripts/migration/verify-clone-parity.mjs --out <dir>     # receipt destination
 */

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..", "..");
const defaultManifestPath = join(repoRoot, "docs", "migration", "source-manifest.json");
const defaultOutDir = join(repoRoot, "docs", "migration");

// ---------------------------------------------------------------------------
// Pure comparators (unit-tested with deliberate perturbations; watched-red).
// ---------------------------------------------------------------------------

export function sha256(content) {
  return createHash("sha256").update(content).digest("hex");
}

const IDENTITY_FIELDS = ["name", "version", "exports", "bin", "files", "engines"];

/**
 * @param {Record<string, unknown>} sourcePkg packed manifest from the source
 * @param {Record<string, unknown>} targetPkg packed manifest from the target
 * @returns {string[]} violation messages; empty when identical
 */
export function comparePackageIdentity(sourcePkg, targetPkg) {
  const violations = [];
  for (const field of IDENTITY_FIELDS) {
    const a = JSON.stringify(sourcePkg[field] ?? null);
    const b = JSON.stringify(targetPkg[field] ?? null);
    if (a !== b) violations.push(`package.${field} diverged: source=${a} target=${b}`);
  }
  return violations;
}

/**
 * Inventories are [{path, sha256}] with POSIX-style relative paths. Content
 * hashes only — archive timestamps are never part of the comparison.
 * @param {{path: string, sha256: string}[]} sourceInv
 * @param {{path: string, sha256: string}[]} targetInv
 * @returns {string[]} violation messages; empty when identical
 */
export function compareAssetInventories(sourceInv, targetInv) {
  const violations = [];
  const sourceMap = new Map(sourceInv.map((e) => [e.path, e.sha256]));
  const targetMap = new Map(targetInv.map((e) => [e.path, e.sha256]));
  for (const [path, hash] of sourceMap) {
    if (!targetMap.has(path)) violations.push(`missing packaged asset in target: ${path}`);
    else if (targetMap.get(path) !== hash) violations.push(`packaged asset content diverged: ${path}`);
  }
  for (const path of targetMap.keys()) {
    if (!sourceMap.has(path)) violations.push(`unexpected extra packaged asset in target: ${path}`);
  }
  return violations.sort();
}

/**
 * @param {{publisher: string, extensionId: string, version: string, commands: unknown, activationEvents: unknown}} sourceMeta
 * @param {{publisher: string, extensionId: string, version: string, commands: unknown, activationEvents: unknown}} targetMeta
 * @returns {string[]} violation messages; empty when identical
 */
export function compareVsixIdentity(sourceMeta, targetMeta) {
  const violations = [];
  for (const field of ["publisher", "extensionId", "version"]) {
    if (sourceMeta[field] !== targetMeta[field]) {
      violations.push(`extension ${field} diverged: source=${sourceMeta[field]} target=${targetMeta[field]}`);
    }
  }
  const sortDeep = (value) =>
    JSON.stringify(value, (key, v) =>
      Array.isArray(v) ? [...v].sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))) : v,
    );
  if (sortDeep(sourceMeta.commands) !== sortDeep(targetMeta.commands)) {
    violations.push("extension contributes.commands diverged");
  }
  const srcEvents = JSON.stringify([...(sourceMeta.activationEvents ?? [])].sort());
  const tgtEvents = JSON.stringify([...(targetMeta.activationEvents ?? [])].sort());
  if (srcEvents !== tgtEvents) {
    violations.push(`extension activationEvents diverged: source=${srcEvents} target=${tgtEvents}`);
  }
  return violations;
}

/**
 * Behavioral parity: exit code and (caller-normalized) stdout must match.
 * @param {{exitCode: number|null, stdout: string}} sourceRun
 * @param {{exitCode: number|null, stdout: string}} targetRun
 * @returns {string[]} violation messages; empty when identical
 */
export function compareRunResults(sourceRun, targetRun) {
  const violations = [];
  if (sourceRun.exitCode !== targetRun.exitCode) {
    violations.push(`exit code diverged: source=${sourceRun.exitCode} target=${targetRun.exitCode}`);
  }
  if (sourceRun.stdout !== targetRun.stdout) {
    violations.push(`stdout diverged:\n--- source ---\n${sourceRun.stdout}\n--- target ---\n${targetRun.stdout}`);
  }
  return violations;
}

/**
 * Every real tree diff must be covered by a narrow, justified declaration.
 * Wildcards and blanket directory exclusions are rejected: differences are
 * excluded narrowly, never ignored broadly.
 * @param {string[]} diffPaths real differing paths
 * @param {{path: string, justification: string}[]} declared manifest intentionalDifferences
 * @returns {string[]} violation messages; empty when every diff is narrowly declared
 */
export function findUndeclaredDifferences(diffPaths, declared) {
  const violations = [];
  for (const entry of declared) {
    if (!entry.path || entry.path.includes("*")) {
      violations.push(`intentional difference must name an explicit path (no wildcards): ${JSON.stringify(entry)}`);
    }
    if (!entry.justification || entry.justification.trim().length < 20) {
      violations.push(
        `intentional difference lacks a substantive justification: ${entry.path ?? JSON.stringify(entry)}`,
      );
    }
  }
  const declaredPaths = new Set(declared.map((d) => d.path));
  for (const path of diffPaths) {
    if (!declaredPaths.has(path)) violations.push(`undeclared source/target difference: ${path}`);
  }
  for (const path of declaredPaths) {
    if (!diffPaths.includes(path))
      violations.push(`declared intentional difference has no actual diff (stale declaration): ${path}`);
  }
  return violations;
}

// ---------------------------------------------------------------------------
// Process / filesystem helpers.
// ---------------------------------------------------------------------------

function run(cmd, args, { cwd, env, timeout = 120000, input } = {}) {
  const res = spawnSync(cmd, args, {
    cwd,
    env: env ?? process.env,
    encoding: "utf8",
    timeout,
    input,
    maxBuffer: 64 * 1024 * 1024,
  });
  return {
    command: `${cmd} ${args.join(" ")}`,
    exitCode: res.status,
    stdout: res.stdout ?? "",
    stderr: res.stderr ?? "",
    error: res.error ? String(res.error.message ?? res.error) : null,
  };
}

/** Walk a directory into a content-hashed inventory with POSIX relative paths. */
export function inventoryDir(root, base = root) {
  const entries = [];
  for (const name of readdirSync(root)) {
    const full = join(root, name);
    const stat = statSync(full);
    if (stat.isDirectory()) entries.push(...inventoryDir(full, base));
    else entries.push({ path: relative(base, full).split(sep).join("/"), sha256: sha256(readFileSync(full)) });
  }
  return entries.sort((a, b) => a.path.localeCompare(b.path));
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function extractTgz(tgzPath, destDir) {
  mkdirSync(destDir, { recursive: true });
  const res = run("tar", ["-xzf", tgzPath, "-C", destDir]);
  if (res.exitCode !== 0) throw new Error(`tar extract failed for ${tgzPath}: ${res.stderr}`);
}

function extractZip(zipPath, destDir) {
  mkdirSync(destDir, { recursive: true });
  const res = run("unzip", ["-q", zipPath, "-d", destDir]);
  if (res.exitCode !== 0) throw new Error(`unzip failed for ${zipPath}: ${res.stderr}`);
}

// ---------------------------------------------------------------------------
// Check runner.
// ---------------------------------------------------------------------------

function makeLedger() {
  const checks = [];
  return {
    checks,
    record(id, description, status, evidence = {}, violations = [], commands = []) {
      checks.push({ id, description, status, evidence, violations, commands });
    },
  };
}

// Extension is built before `npm pack` so the tarball matches the released
// shape (prepublishOnly builds the VSIX first; `files` includes "vsix").
function prepareCheckout(dir) {
  return [
    run("npm", ["ci", "--no-audit", "--no-fund"], { cwd: dir, timeout: 600000 }),
    run("npm", ["run", "build"], { cwd: dir, timeout: 300000 }),
    run("npm", ["run", "build:extension"], { cwd: dir, timeout: 900000 }),
  ];
}

/**
 * The npm tarball bundles the VSIX as an opaque asset. The VSIX is itself a
 * ZIP whose container bytes are nondeterministic (timestamps) even when its
 * extracted content is byte-identical — so nested archives are hashed by
 * their extracted content inventory, never by container bytes. File names,
 * manifest values and asset contents are never normalized.
 */
function nestedArchiveContentHash(archivePath, workDir) {
  mkdirSync(workDir, { recursive: true });
  extractZip(archivePath, workDir);
  const contentHash = sha256(JSON.stringify(inventoryDir(workDir)));
  rmSync(workDir, { recursive: true, force: true });
  return contentHash;
}

function packInventory(packageDir, workDir) {
  return inventoryDir(packageDir).map((entry) => {
    if (/^vsix\/.+\.vsix$/.test(entry.path)) {
      return {
        path: entry.path,
        sha256: nestedArchiveContentHash(join(packageDir, entry.path), join(workDir, `nested-${sha256(entry.path)}`)),
        nestedArchive: true,
      };
    }
    return entry;
  });
}

function packCheckout(dir, packDest) {
  mkdirSync(packDest, { recursive: true });
  const pack = run("npm", ["pack", "--json", "--pack-destination", packDest], { cwd: dir, timeout: 300000 });
  if (pack.exitCode !== 0) throw new Error(`npm pack failed in ${dir}: ${pack.stderr}`);
  const meta = JSON.parse(pack.stdout)[0];
  const tgzPath = join(packDest, meta.filename);
  const extractDir = join(packDest, "extracted");
  extractTgz(tgzPath, extractDir);
  const packageDir = join(extractDir, "package");
  return {
    meta,
    integrity: meta.integrity ?? null,
    packageDir,
    packedManifest: readJson(join(packageDir, "package.json")),
    inventory: packInventory(packageDir, join(packDest, "nested")),
  };
}

function findVsix(dir) {
  const vsixDir = join(dir, "vsix");
  if (!existsSync(vsixDir)) return null;
  const names = readdirSync(vsixDir).filter((n) => n.endsWith(".vsix"));
  return names.length > 0 ? join(vsixDir, names.sort()[names.length - 1]) : null;
}

function vsixMeta(vsixExtractDir) {
  const pkg = readJson(join(vsixExtractDir, "extension", "package.json"));
  return {
    publisher: pkg.publisher,
    extensionId: pkg.name,
    version: pkg.version,
    commands: pkg.contributes?.commands ?? [],
    activationEvents: pkg.activationEvents ?? [],
  };
}

// ---------------------------------------------------------------------------
// Main pipeline.
// ---------------------------------------------------------------------------

async function main() {
  const args = process.argv.slice(2);
  const opt = { targetRef: "HEAD", sourceDir: null, targetDir: null, skipPrepare: false, outDir: defaultOutDir };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--source-dir") opt.sourceDir = resolve(args[++i]);
    else if (args[i] === "--target-dir") opt.targetDir = resolve(args[++i]);
    else if (args[i] === "--target-ref") opt.targetRef = args[++i];
    else if (args[i] === "--skip-prepare") opt.skipPrepare = true;
    else if (args[i] === "--out") opt.outDir = resolve(args[++i]);
    else {
      console.error(`Unknown argument: ${args[i]}`);
      process.exit(2);
    }
  }

  const manifest = readJson(defaultManifestPath);
  const sourceSha = manifest.source.verifiedSourceSha;
  const ledger = makeLedger();
  const work = mkdtempSync(join(tmpdir(), "clone-parity-"));
  const worktrees = [];
  const startedAt = new Date().toISOString();

  const toolchain = {
    node: process.version,
    npm: run("npm", ["--version"]).stdout.trim(),
    vsce: run("npx", ["--no-install", "vsce", "--version"]).stdout.trim() || null,
    platform: `${process.platform}/${process.arch}`,
  };

  try {
    // --- Resolve checkouts -------------------------------------------------
    let sourceDir = opt.sourceDir;
    let targetDir = opt.targetDir;
    if (!sourceDir) {
      sourceDir = join(work, "source");
      const srcAdd = run("git", ["worktree", "add", "--detach", sourceDir, sourceSha], { cwd: repoRoot });
      worktrees.push(sourceDir);
      if (srcAdd.exitCode !== 0) {
        ledger.record(
          "prepare.checkout",
          `git worktree add for source sha ${sourceSha}`,
          "fail",
          {},
          [`worktree add failed: ${srcAdd.stderr.trim()}`],
          [srcAdd.command],
        );
        return finish(ledger, manifest, toolchain, startedAt, sourceSha, null, opt.outDir, 1);
      }
    }
    if (!targetDir) {
      targetDir = join(work, "target");
      const add = run("git", ["worktree", "add", "--detach", targetDir, opt.targetRef], { cwd: repoRoot });
      worktrees.push(targetDir);
      if (add.exitCode !== 0) {
        ledger.record(
          "prepare.checkout",
          `git worktree add for target ref ${opt.targetRef}`,
          "fail",
          {},
          [`worktree add failed: ${add.stderr.trim()}`],
          [add.command],
        );
        return finish(ledger, manifest, toolchain, startedAt, sourceSha, null, opt.outDir, 1);
      }
    }
    const resolvedTargetSha = run("git", ["-C", targetDir, "rev-parse", "HEAD"]).stdout.trim() || null;

    // --- Check 1: git tree equality ----------------------------------------
    const srcTree = run("git", ["ls-tree", "-r", sourceSha], { cwd: repoRoot });
    const tgtTree = run("git", ["-C", targetDir, "ls-tree", "-r", "HEAD"]);
    const pathOf = (line) => line.split("\t")[1];
    const srcPaths = new Map(
      srcTree.stdout
        .split("\n")
        .filter(Boolean)
        .map((l) => [pathOf(l), l]),
    );
    const tgtPaths = new Map(
      tgtTree.stdout
        .split("\n")
        .filter(Boolean)
        .map((l) => [pathOf(l), l]),
    );
    const diffPaths = [
      ...[...srcPaths.keys()].filter((p) => !tgtPaths.has(p) || tgtPaths.get(p) !== srcPaths.get(p)),
      ...[...tgtPaths.keys()].filter((p) => !srcPaths.has(p)),
    ].sort();
    const treeViolations = findUndeclaredDifferences(diffPaths, manifest.paths.intentionalDifferences ?? []);
    ledger.record(
      "git.tree-equality",
      "Frozen source tree vs target tree; every diff must be narrowly declared in the manifest",
      treeViolations.length === 0 ? "pass" : "fail",
      { sourceSha, targetSha: resolvedTargetSha, differingPaths: diffPaths.length, filesCompared: srcPaths.size },
      treeViolations,
      ["git ls-tree -r <sourceSha>", "git ls-tree -r HEAD"],
    );

    // --- Prepare (npm ci + build) -------------------------------------------
    if (!opt.skipPrepare) {
      for (const [label, dir] of [
        ["source", sourceDir],
        ["target", targetDir],
      ]) {
        for (const step of prepareCheckout(dir)) {
          if (step.exitCode !== 0) {
            ledger.record(
              "prepare.checkout",
              `npm ci + build + build:extension (${label})`,
              "fail",
              {},
              [`prepare failed: ${step.command}\n${step.stderr.slice(-2000)}`],
              [step.command],
            );
            return finish(ledger, manifest, toolchain, startedAt, sourceSha, resolvedTargetSha, opt.outDir, 1);
          }
        }
      }
    }

    // --- Check 2+3: npm pack inventory + identity ---------------------------
    let sourcePack;
    let targetPack;
    try {
      sourcePack = packCheckout(sourceDir, join(work, "pack-source"));
      targetPack = packCheckout(targetDir, join(work, "pack-target"));
    } catch (err) {
      ledger.record("pkg.pack", "npm pack on both checkouts", "fail", {}, [String(err.message ?? err)]);
      return finish(ledger, manifest, toolchain, startedAt, sourceSha, resolvedTargetSha, opt.outDir, 1);
    }
    const inventoryViolations = compareAssetInventories(sourcePack.inventory, targetPack.inventory);
    ledger.record(
      "pkg.pack-inventory",
      "npm pack --json inventory; per-file content hashes of the extracted tarballs",
      inventoryViolations.length === 0 ? "pass" : "fail",
      {
        sourceFiles: sourcePack.inventory.length,
        targetFiles: targetPack.inventory.length,
        sourceIntegrity: sourcePack.integrity,
        targetIntegrity: targetPack.integrity,
        sourceSha256: sha256(readFileSync(join(work, "pack-source", sourcePack.meta.filename))),
        targetSha256: sha256(readFileSync(join(work, "pack-target", targetPack.meta.filename))),
      },
      inventoryViolations,
      ["npm pack --json (both checkouts)"],
    );
    const identityViolations = comparePackageIdentity(sourcePack.packedManifest, targetPack.packedManifest);
    ledger.record(
      "pkg.identity",
      "Packed manifest name/version/exports/bin/files/engines",
      identityViolations.length === 0 ? "pass" : "fail",
      { name: sourcePack.packedManifest.name, version: sourcePack.packedManifest.version },
      identityViolations,
    );

    // --- Check 4: bin entrypoints -------------------------------------------
    const binViolations = [];
    const bins = sourcePack.packedManifest.bin ?? {};
    for (const [binName, binPath] of Object.entries(bins)) {
      const modes = {};
      for (const [label, pack] of [
        ["source", sourcePack],
        ["target", targetPack],
      ]) {
        const full = join(pack.packageDir, binPath);
        if (!existsSync(full)) binViolations.push(`bin '${binName}' (${binPath}) absent from ${label} tarball`);
        else modes[label] = statSync(full).mode & 0o777;
      }
      // Mode parity, not an absolute exec-bit requirement: the published
      // 0.1.9 tarball ships scripts/install.mjs as 0644 and npx works.
      if (modes.source !== undefined && modes.source !== modes.target) {
        binViolations.push(
          `bin '${binName}' file mode diverged: source=${modes.source?.toString(8)} target=${modes.target?.toString(8)}`,
        );
      }
    }
    // Same dispatch surface on both sides: unknown command -> exit 1 + usage.
    const srcUsage = run("node", [join(sourceDir, "scripts", "install.mjs"), "__no_such_command__"], { cwd: work });
    const tgtUsage = run("node", [join(targetDir, "scripts", "install.mjs"), "__no_such_command__"], { cwd: work });
    binViolations.push(
      ...compareRunResults(
        { exitCode: srcUsage.exitCode, stdout: srcUsage.stderr },
        { exitCode: tgtUsage.exitCode, stdout: tgtUsage.stderr },
      ).map((v) => `bin dispatch: ${v}`),
    );
    if (srcUsage.exitCode !== 1 || !srcUsage.stderr.includes("Usage:")) {
      binViolations.push(`bin dispatch contract changed: expected exit 1 + usage, got exit ${srcUsage.exitCode}`);
    }
    ledger.record(
      "pkg.bins",
      "Both bin entrypoints present, executable, and with identical dispatch behavior",
      binViolations.length === 0 ? "pass" : "fail",
      { bins: Object.keys(bins) },
      binViolations,
      ["node scripts/install.mjs __no_such_command__ (both checkouts)"],
    );

    // --- Check 5: MCP smoke --------------------------------------------------
    const srcSmoke = run("node", ["scripts/smoke.mjs"], { cwd: sourceDir, timeout: 180000 });
    const tgtSmoke = run("node", ["scripts/smoke.mjs"], { cwd: targetDir, timeout: 180000 });
    const smokeLines = (out) =>
      out
        .split("\n")
        .filter((l) => /^(PASS|FAIL)/.test(l))
        .sort();
    const smokeViolations = [];
    if (srcSmoke.exitCode !== 0)
      smokeViolations.push(
        `source smoke itself failed (exit ${srcSmoke.exitCode}): parity against broken baseline is meaningless`,
      );
    if (tgtSmoke.exitCode !== 0) smokeViolations.push(`target smoke failed (exit ${tgtSmoke.exitCode})`);
    if (JSON.stringify(smokeLines(srcSmoke.stdout)) !== JSON.stringify(smokeLines(tgtSmoke.stdout))) {
      smokeViolations.push("smoke PASS/FAIL line sets diverged");
    }
    ledger.record(
      "mcp.smoke",
      "MCP smoke suite against identical fixtures on both sides",
      smokeViolations.length === 0 ? "pass" : "fail",
      {
        sourcePass: srcSmoke.stdout.split("\n").filter((l) => l.startsWith("PASS")).length,
        sourceFail: srcSmoke.stdout.split("\n").filter((l) => l.startsWith("FAIL")).length,
        targetPass: tgtSmoke.stdout.split("\n").filter((l) => l.startsWith("PASS")).length,
        targetFail: tgtSmoke.stdout.split("\n").filter((l) => l.startsWith("FAIL")).length,
      },
      smokeViolations,
      ["node scripts/smoke.mjs (both checkouts)"],
    );

    // --- Check 6: hook allow/deny + failure modes ---------------------------
    const hookViolations = [];
    const hookCases = [
      { name: "deny: evidenced-fragile without partners", args: ["--paths", "src/routes/checkout.ts"], cwd: "fixture" },
      {
        name: "warn/none: fragile with partners",
        args: ["--paths", "src/routes/checkout.ts", "src/auth/session.ts"],
        cwd: "fixture",
      },
      { name: "unknown file: never claims safe", args: ["--paths", "src/lib/does-not-exist.ts"], cwd: "fixture" },
    ];
    for (const c of hookCases) {
      const src = run("node", [join(sourceDir, "hooks", "pre-edit-check.mjs"), ...c.args], {
        cwd: join(sourceDir, c.cwd),
      });
      const tgt = run("node", [join(targetDir, "hooks", "pre-edit-check.mjs"), ...c.args], {
        cwd: join(targetDir, c.cwd),
      });
      hookViolations.push(
        ...compareRunResults(
          { exitCode: src.exitCode, stdout: src.stdout + src.stderr },
          { exitCode: tgt.exitCode, stdout: tgt.stdout + tgt.stderr },
        ).map((v) => `hook[${c.name}]: ${v}`),
      );
    }
    // Failure modes: missing and malformed artifacts must never collapse into safe/success.
    const missingDir = mkdtempSync(join(tmpdir(), "hook-missing-"));
    const malformedDir = mkdtempSync(join(tmpdir(), "hook-malformed-"));
    mkdirSync(join(malformedDir, ".agents"), { recursive: true });
    writeFileSync(join(malformedDir, ".agents", "workspace.json"), "{ not json");
    for (const [label, caseCwd] of [
      ["missing artifact", missingDir],
      ["malformed artifact", malformedDir],
    ]) {
      const src = run("node", [join(sourceDir, "hooks", "pre-edit-check.mjs"), "--paths", "src/routes/checkout.ts"], {
        cwd: caseCwd,
      });
      const tgt = run("node", [join(targetDir, "hooks", "pre-edit-check.mjs"), "--paths", "src/routes/checkout.ts"], {
        cwd: caseCwd,
      });
      hookViolations.push(
        ...compareRunResults(
          { exitCode: src.exitCode, stdout: src.stdout + src.stderr },
          { exitCode: tgt.exitCode, stdout: tgt.stdout + tgt.stderr },
        ).map((v) => `hook[${label}]: ${v}`),
      );
      if (/approve|safe/i.test(src.stdout))
        hookViolations.push(`hook[${label}]: baseline output claims approve/safe — failure mode collapsed`);
    }
    rmSync(missingDir, { recursive: true, force: true });
    rmSync(malformedDir, { recursive: true, force: true });
    ledger.record(
      "hooks.behavior",
      "Hook allow/deny decisions and missing/malformed failure modes on identical inputs",
      hookViolations.length === 0 ? "pass" : "fail",
      { cases: hookCases.length + 2 },
      hookViolations,
      ["node hooks/pre-edit-check.mjs --paths ... (both checkouts, 5 cases)"],
    );

    // --- Check 7: installer output + installed assets -----------------------
    const installerViolations = [];
    const installResults = {};
    for (const [label, dir] of [
      ["source", sourceDir],
      ["target", targetDir],
    ]) {
      const disposable = mkdtempSync(join(tmpdir(), `install-${label}-`));
      run("git", ["init", "-q"], { cwd: disposable });
      const install = run("node", [join(dir, "scripts", "install.mjs"), "install", "--with-hook"], {
        cwd: disposable,
        timeout: 180000,
      });
      const configPath = join(disposable, ".codex", "config.toml");
      const runtimeDir = join(disposable, ".codex", "workspacejson-codex-mcp");
      const config = existsSync(configPath) ? readFileSync(configPath, "utf8") : null;
      // The generated hook stanza embeds absolute, run-specific paths (the
      // disposable install root and the package root) — environment-specific
      // by construction. Tokenize just those paths; nothing else.
      const normalizedConfig = config?.replaceAll(disposable, "<INSTALLROOT>").replaceAll(dir, "<PKGROOT>") ?? null;
      const runtimeInventory = existsSync(runtimeDir) ? inventoryDir(runtimeDir) : [];
      const uninstall = run("node", [join(dir, "scripts", "install.mjs"), "uninstall"], {
        cwd: disposable,
        timeout: 180000,
      });
      const configAfter = existsSync(configPath) ? readFileSync(configPath, "utf8") : null;
      installResults[label] = { install, normalizedConfig, runtimeInventory, uninstall, configAfter, disposable };
    }
    const srcI = installResults.source;
    const tgtI = installResults.target;
    if (srcI.install.exitCode !== 0 || tgtI.install.exitCode !== 0) {
      installerViolations.push(
        `install exit diverged/failed: source=${srcI.install.exitCode} target=${tgtI.install.exitCode}`,
      );
    }
    if (srcI.normalizedConfig !== tgtI.normalizedConfig) {
      installerViolations.push("installed .codex/config.toml diverged (after package-root tokenization)");
    }
    installerViolations.push(
      ...compareAssetInventories(srcI.runtimeInventory, tgtI.runtimeInventory).map(
        (v) => `installed runtime asset: ${v}`,
      ),
    );
    if (srcI.uninstall.exitCode !== tgtI.uninstall.exitCode) {
      installerViolations.push(
        `uninstall exit diverged: source=${srcI.uninstall.exitCode} target=${tgtI.uninstall.exitCode}`,
      );
    }
    if (
      (srcI.configAfter === null) !== (tgtI.configAfter === null) ||
      (srcI.configAfter ?? "") !== (tgtI.configAfter ?? "")
    ) {
      installerViolations.push("post-uninstall config.toml state diverged");
    }
    for (const label of ["source", "target"])
      rmSync(installResults[label].disposable, { recursive: true, force: true });
    ledger.record(
      "installer.assets",
      "Installer output and installed assets (.codex/config.toml + vendored runtime) in disposable dirs, install then uninstall",
      installerViolations.length === 0 ? "pass" : "fail",
      {
        sourceRuntimeFiles: srcI.runtimeInventory.length,
        targetRuntimeFiles: tgtI.runtimeInventory.length,
        installExit: { source: srcI.install.exitCode, target: tgtI.install.exitCode },
      },
      installerViolations,
      ["node scripts/install.mjs install --with-hook && uninstall (disposable dirs, both sides)"],
    );

    // --- Check 8: plugin/hook/skill surfaces --------------------------------
    const surfacePaths = [".mcp.json", ".codex-plugin", "hooks", ".agents"];
    const surfaceViolations = [];
    for (const rel of surfacePaths) {
      const s = join(sourceDir, rel);
      const t = join(targetDir, rel);
      if (!existsSync(s) || !existsSync(t)) {
        surfaceViolations.push(`surface ${rel} missing on ${!existsSync(s) ? "source" : "target"} side`);
        continue;
      }
      const stat = statSync(s);
      if (stat.isDirectory()) {
        surfaceViolations.push(...compareAssetInventories(inventoryDir(s), inventoryDir(t)).map((v) => `${rel}: ${v}`));
      } else if (sha256(readFileSync(s)) !== sha256(readFileSync(t))) {
        surfaceViolations.push(`${rel} content diverged`);
      }
    }
    ledger.record(
      "plugin.surfaces",
      ".mcp.json, .codex-plugin/**, hooks/**, .agents/** presence and content",
      surfaceViolations.length === 0 ? "pass" : "fail",
      { surfaces: surfacePaths },
      surfaceViolations,
    );

    // --- Check 9: extension VSIX ---------------------------------------------
    let vsixEvidence = {};
    const vsixViolations = [];
    try {
      const srcVsix = findVsix(sourceDir);
      const tgtVsix = findVsix(targetDir);
      if (!srcVsix || !tgtVsix) throw new Error(`VSIX missing: source=${srcVsix} target=${tgtVsix}`);
      const srcExtract = join(work, "vsix-source");
      const tgtExtract = join(work, "vsix-target");
      extractZip(srcVsix, srcExtract);
      extractZip(tgtVsix, tgtExtract);
      vsixEvidence = {
        sourceVsix: relative(repoRoot, srcVsix),
        targetVsix: relative(repoRoot, tgtVsix),
        sourceVsixSha256: sha256(readFileSync(srcVsix)),
        targetVsixSha256: sha256(readFileSync(tgtVsix)),
        sourceAssets: inventoryDir(srcExtract).length,
        targetAssets: inventoryDir(tgtExtract).length,
      };
      vsixViolations.push(...compareVsixIdentity(vsixMeta(srcExtract), vsixMeta(tgtExtract)));
      vsixViolations.push(...compareAssetInventories(inventoryDir(srcExtract), inventoryDir(tgtExtract)));
      ledger.record(
        "extension.vsix",
        "Extension build + VSIX publisher/ID/version/commands/activationEvents/asset inventory (extracted content only; ZIP metadata never compared)",
        vsixViolations.length === 0 ? "pass" : "fail",
        vsixEvidence,
        vsixViolations,
        ["npm run build:extension (both checkouts)", "unzip + content-hash inventory (both VSIXes)"],
      );
    } catch (err) {
      ledger.record(
        "extension.vsix",
        "Extension build + VSIX comparison",
        "fail",
        vsixEvidence,
        [String(err.message ?? err)],
        ["npm run build:extension"],
      );
    }

    // --- Check 10: generator invocation resolution ---------------------------
    const srcGen = run("node", ["scripts/check-generator-version.mjs"], { cwd: sourceDir });
    const tgtGen = run("node", ["scripts/check-generator-version.mjs"], { cwd: targetDir });
    const genViolations = [];
    if (srcGen.exitCode !== 0 || tgtGen.exitCode !== 0) {
      genViolations.push(`generator-version gate failing: source=${srcGen.exitCode} target=${tgtGen.exitCode}`);
    }
    if (srcGen.stdout !== tgtGen.stdout)
      genViolations.push(
        `generator resolution diverged: source='${srcGen.stdout.trim()}' target='${tgtGen.stdout.trim()}'`,
      );
    ledger.record(
      "generator.resolution",
      "Version-pinned generator invocation resolves identically to the frozen baseline on both sides",
      genViolations.length === 0 ? "pass" : "fail",
      { resolution: srcGen.stdout.trim() },
      genViolations,
      ["node scripts/check-generator-version.mjs (both checkouts)"],
    );

    const failed = ledger.checks.filter((c) => c.status === "fail").length;
    return finish(ledger, manifest, toolchain, startedAt, sourceSha, resolvedTargetSha, opt.outDir, failed > 0 ? 1 : 0);
  } finally {
    for (const wt of worktrees) run("git", ["worktree", "remove", "--force", wt], { cwd: repoRoot });
    rmSync(work, { recursive: true, force: true });
  }
}

function finish(ledger, manifest, toolchain, startedAt, sourceSha, targetSha, outDir, exitCode) {
  const summary = {
    total: ledger.checks.length,
    passed: ledger.checks.filter((c) => c.status === "pass").length,
    failed: ledger.checks.filter((c) => c.status === "fail").length,
    unsupported: ledger.checks.filter((c) => c.status === "unsupported").length,
  };
  const receipt = {
    $comment:
      "META-241 Phase 1 machine parity receipt. Generated by scripts/migration/verify-clone-parity.mjs — do not hand-edit.",
    generatedAt: new Date().toISOString(),
    startedAt,
    refs: { sourceSha, targetSha },
    manifest: "docs/migration/source-manifest.json",
    toolchain,
    summary,
    verdict: summary.failed > 0 ? "DIVERGENT" : summary.unsupported > 0 ? "INCOMPLETE" : "PARITY",
    intentionalDifferences: manifest.paths.intentionalDifferences ?? [],
    checks: ledger.checks,
  };
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, "parity-receipt.json"), `${JSON.stringify(receipt, null, 2)}\n`);
  writeFileSync(join(outDir, "parity-receipt.md"), renderMarkdown(receipt));
  console.log(
    `\nParity verdict: ${receipt.verdict} — ${summary.passed}/${summary.total} checks passed, ${summary.failed} failed, ${summary.unsupported} unsupported.`,
  );
  console.log(`Receipts: ${join(outDir, "parity-receipt.json")}, ${join(outDir, "parity-receipt.md")}`);
  for (const check of ledger.checks) {
    console.log(
      `  ${check.status.toUpperCase().padEnd(11)} ${check.id}${check.violations.length > 0 ? `  (${check.violations.length} violation(s))` : ""}`,
    );
  }
  process.exitCode = exitCode;
}

function renderMarkdown(receipt) {
  const lines = [
    "# Clone parity receipt (META-241 Phase 1)",
    "",
    `- Verdict: **${receipt.verdict}** (${receipt.summary.passed}/${receipt.summary.total} passed, ${receipt.summary.failed} failed, ${receipt.summary.unsupported} unsupported)`,
    `- Source SHA: \`${receipt.refs.sourceSha}\``,
    `- Target SHA: \`${receipt.refs.targetSha}\``,
    `- Generated: ${receipt.generatedAt} (started ${receipt.startedAt})`,
    `- Toolchain: node ${receipt.toolchain.node}, npm ${receipt.toolchain.npm}, vsce ${receipt.toolchain.vsce ?? "n/a"}, ${receipt.toolchain.platform}`,
    "",
    "| Check | Status | Evidence |",
    "| --- | --- | --- |",
  ];
  for (const check of receipt.checks) {
    const evidence = Object.entries(check.evidence)
      .map(([k, v]) => `${k}=${typeof v === "object" ? JSON.stringify(v) : v}`)
      .join("; ");
    lines.push(`| \`${check.id}\` | ${check.status.toUpperCase()} | ${evidence || "—"} |`);
  }
  lines.push("", "## Intentional differences", "");
  if (receipt.intentionalDifferences.length === 0) lines.push("None declared; none found.");
  for (const diff of receipt.intentionalDifferences) lines.push(`- \`${diff.path}\` — ${diff.justification}`);
  lines.push("", "## Violations", "");
  const violations = receipt.checks.flatMap((c) => c.violations.map((v) => `**${c.id}**: ${v}`));
  if (violations.length === 0) lines.push("None.");
  for (const v of violations) lines.push(`- ${v}`);
  lines.push("");
  return lines.join("\n");
}

const isDirectRun = process.argv[1] === fileURLToPath(import.meta.url);
if (isDirectRun) {
  main().catch((err) => {
    console.error("verify-clone-parity crashed:", err);
    process.exitCode = 2;
  });
}
