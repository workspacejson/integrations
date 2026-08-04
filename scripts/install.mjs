#!/usr/bin/env node
/**
 * HAC-91 / HAC-170 installer path.
 *
 * Usage:
 *   npx @workspacejson/codex-mcp install                        # MCP context only
 *   npx @workspacejson/codex-mcp install --with-hook            # + deterministic pre-edit hook
 *   npx @workspacejson/codex-mcp install --with-extension       # + VS Code extension (explicit consent)
 *   npx @workspacejson/codex-mcp install --full                 # = --with-hook --with-extension
 *   npx @workspacejson/codex-mcp uninstall                      # remove repo-owned MCP/hook/runtime
 *   npx @workspacejson/codex-mcp uninstall --with-extension     # also remove the global VS Code extension
 *
 * Writes [mcp_servers.workspacejson] to .codex/config.toml at the current repo
 * root, idempotently. With --with-hook, also appends a single PreToolUse hook
 * stanza for apply_patch. Never overwrites unrelated config.
 *
 * --with-extension is explicit consent to modify editor-global state. It is the
 * ONLY path that installs the VS Code extension: no npm postinstall, package
 * import, MCP startup, or ordinary install ever touches the editor. Missing the
 * `code` CLI is UNAVAILABLE (with remediation), not a package failure, and any
 * extension failure leaves the core MCP/hook install intact.
 *
 * When run without the "install" subcommand (or as the package binary), it
 * proxies to the built MCP server so the same package is both the server and
 * the installer.
 */

import { spawnSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { chmod, cp, mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const packageRoot = resolve(here, "..");
const hookPath = resolve(packageRoot, "hooks", "pre-edit-check.mjs");
const distSource = resolve(packageRoot, "dist");

const MCP_HEADER = "[mcp_servers.workspacejson]";
const MCP_MARKER = "# workspacejson-codex-mcp managed MCP block";
// The "server" arg is required because this same binary is the install script
// when called with "install" and the MCP server when called with "server".
const MCP_BLOCK = [
  MCP_HEADER,
  MCP_MARKER,
  'command = "npx"',
  'args = ["-y", "@workspacejson/codex-mcp", "server"]',
].join("\n");

const HOOK_MARKER = "# workspacejson-codex-mcp PreToolUse hook";
const RUNTIME_MARKER = ".workspacejson-codex-mcp-owned";

// ── VS Code extension distribution (HAC-170 Distribution & Installer Contract) ──
// The extension is a separate editor artifact whose identity is stable product
// identity, not something discovered at runtime. The VSIX filename encodes the
// version and doubles as the ownership check.
const EXTENSION_PUBLISHER = "workspace-json";
const EXTENSION_NAME = "workspacejson-codex-decorations";
const DEFAULT_EXTENSION_ID = `${EXTENSION_PUBLISHER}.${EXTENSION_NAME}`;
const VSIX_PREFIX = `${EXTENSION_NAME}-`;
const VSIX_SUFFIX = ".vsix";

function extensionId() {
  return process.env.WORKSPACEJSON_EXTENSION_ID?.trim() || DEFAULT_EXTENSION_ID;
}

// VS Code Stable is the supported target. We never silently pick between Stable,
// Insiders, Cursor, remote, or a container CLI — the caller opts a different CLI
// in explicitly through WORKSPACEJSON_CODE_CLI.
function resolveCodeCli() {
  const cli = process.env.WORKSPACEJSON_CODE_CLI?.trim() || "code";
  const probe = spawnSync(cli, ["--version"], { encoding: "utf8", timeout: 15000 });
  if (probe.error || probe.status !== 0) return { cli, available: false };
  return { cli, available: true, version: (probe.stdout || "").split("\n")[0].trim() };
}

// Resolve the VSIX to install. Search order: dirs that exist both in a repo
// checkout (extension/ after `npm run build:extension`) and in a published npm
// tarball (vsix/). Ownership is enforced by the required filename shape.
function findBundledVsix() {
  const dirs = [resolve(packageRoot, "vsix"), packageRoot, resolve(packageRoot, "extension")];
  const found = [];
  for (const dir of dirs) {
    let names = [];
    try {
      names = readdirSync(dir);
    } catch {
      continue;
    }
    for (const name of names) {
      if (name.startsWith(VSIX_PREFIX) && name.endsWith(VSIX_SUFFIX)) found.push(resolve(dir, name));
    }
  }
  if (found.length === 0) return null;
  // HAZARD: lexicographic, not semver, sort. Picks the wrong "latest" VSIX
  // (e.g. ...-0.9.0.vsix over ...-0.10.0.vsix) the day two bundled versions
  // ever coexist. Currently unreachable — exactly one VSIX ships per install
  // — so this is a tracked deferral, not a fix: swap for a real semver
  // comparison before a second bundled version is ever possible.
  found.sort();
  const path = found[found.length - 1];
  return { path, version: vsixVersion(path) };
}

function vsixVersion(path) {
  const base = basename(path);
  if (!(base.startsWith(VSIX_PREFIX) && base.endsWith(VSIX_SUFFIX))) return null;
  return base.slice(VSIX_PREFIX.length, base.length - VSIX_SUFFIX.length) || null;
}

// Parse `code --list-extensions --show-versions` into id(lowercased) -> version.
// Returns null when the listing itself failed (distinct from "not installed").
function listInstalledExtensions(cli) {
  const res = spawnSync(cli, ["--list-extensions", "--show-versions"], { encoding: "utf8", timeout: 20000 });
  if (res.error || res.status !== 0) return null;
  const map = new Map();
  for (const line of (res.stdout || "").split("\n")) {
    const entry = line.trim();
    if (!entry) continue;
    const at = entry.lastIndexOf("@");
    if (at > 0) map.set(entry.slice(0, at).toLowerCase(), entry.slice(at + 1));
    else map.set(entry.toLowerCase(), null);
  }
  return map;
}

/**
 * Idempotently install the VS Code extension with explicit consent.
 * Returns a structured { status, lines, reloadRequired } where status is one of
 * PASS | ALREADY_INSTALLED | UNAVAILABLE | FAILED. Never throws: the caller runs
 * it after the core install so a failure here cannot roll back MCP/hook setup.
 */
function installExtensionArtifact({ vsix } = {}) {
  const id = extensionId();
  const { cli, available } = resolveCodeCli();
  if (!available) {
    return {
      status: "UNAVAILABLE",
      lines: [
        `VS Code 'code' CLI not found (tried '${cli}').`,
        "The extension was not installed; the MCP/hook install is unaffected.",
        "Remediation:",
        "  - Install VS Code Stable, then run 'Shell Command: Install code command in PATH'",
        "    from the Command Palette so 'code' is available.",
        "  - Or point WORKSPACEJSON_CODE_CLI at your editor's CLI, then rerun:",
        "      npx -y @workspacejson/codex-mcp install --with-extension",
      ],
    };
  }

  const explicitVsix = vsix?.trim() || process.env.WORKSPACEJSON_EXTENSION_VSIX?.trim();
  let source;
  let sourceKind;
  let expectedVersion = null;
  if (explicitVsix) {
    if (!existsSync(explicitVsix)) {
      return {
        status: "FAILED",
        lines: [`Specified VSIX not found: ${explicitVsix}`, "The MCP/hook install is unaffected."],
      };
    }
    if (!(basename(explicitVsix).startsWith(VSIX_PREFIX) && explicitVsix.endsWith(VSIX_SUFFIX))) {
      return {
        status: "FAILED",
        lines: [
          `Refusing to install unrecognized artifact '${basename(explicitVsix)}'.`,
          `Expected ${VSIX_PREFIX}<version>${VSIX_SUFFIX}. The MCP/hook install is unaffected.`,
        ],
      };
    }
    source = explicitVsix;
    sourceKind = "vsix";
    expectedVersion = vsixVersion(explicitVsix);
  } else {
    const bundled = findBundledVsix();
    if (bundled) {
      source = bundled.path;
      sourceKind = "vsix";
      expectedVersion = bundled.version;
    } else if (process.env.WORKSPACEJSON_EXTENSION_MARKETPLACE === "1") {
      // Opt-in path for once the Marketplace listing is live and verified.
      source = id;
      sourceKind = "marketplace";
    } else {
      return {
        status: "FAILED",
        lines: [
          "No extension VSIX was found to install.",
          "Build it from a checkout of this repo:",
          "    npm run build:extension",
          "then rerun with --with-extension, or pass an explicit artifact:",
          `    --vsix path/to/${VSIX_PREFIX}<version>${VSIX_SUFFIX}`,
          "The MCP/hook install is unaffected.",
        ],
      };
    }
  }

  const before = listInstalledExtensions(cli);
  const current = before?.get(id.toLowerCase());
  if (current != null && expectedVersion && current === expectedVersion) {
    return {
      status: "ALREADY_INSTALLED",
      lines: [`${id}@${current} is already installed in '${cli}'. No action taken.`],
    };
  }

  const install = spawnSync(cli, ["--install-extension", source, "--force"], { encoding: "utf8", timeout: 120000 });
  if (install.error || install.status !== 0) {
    return {
      status: "FAILED",
      lines: [
        `Failed to install the extension via '${cli}'.`,
        (install.stderr || install.stdout || install.error?.message || "").trim(),
        "The MCP/hook install is unaffected.",
      ].filter(Boolean),
    };
  }

  const after = listInstalledExtensions(cli);
  const now = after?.get(id.toLowerCase());
  if (after && now === undefined) {
    return {
      status: "FAILED",
      lines: [`'${cli} --install-extension' reported success but ${id} is not listed as installed.`],
    };
  }
  const verb = current != null ? "Updated" : "Installed";
  const provenance = sourceKind === "vsix" ? "bundled VSIX" : "Marketplace";
  return {
    status: "PASS",
    reloadRequired: true,
    lines: [
      `${verb} ${id}${now ? `@${now}` : ""} in '${cli}' (${provenance}).`,
      "Reload VS Code ('Developer: Reload Window') to activate it.",
    ],
  };
}

// Remove ONLY the owned extension by exact id. Unrelated extensions and editor
// settings are never touched.
function uninstallExtensionArtifact() {
  const id = extensionId();
  const { cli, available } = resolveCodeCli();
  if (!available) {
    return {
      status: "UNAVAILABLE",
      lines: [`VS Code 'code' CLI not found; the global extension ${id} was left untouched.`],
    };
  }
  const res = spawnSync(cli, ["--uninstall-extension", id], { encoding: "utf8", timeout: 60000 });
  if (res.error || res.status !== 0) {
    return {
      status: "FAILED",
      lines: [`${id} was not removed (it may not be installed in '${cli}'). Unrelated extensions were preserved.`],
    };
  }
  return {
    status: "PASS",
    lines: [`Removed the global extension ${id} from '${cli}'. Unrelated extensions were preserved.`],
  };
}

function printExtensionResult(heading, result) {
  console.log("");
  console.log(heading);
  for (const line of result.lines) console.log(`  ${line}`);
  console.log(`  -> ${result.status}`);
}

function blockHasMarker(content, header, marker) {
  const lines = content.split("\n");
  const start = lines.findIndex((line) => line.trim() === header);
  if (start === -1) return false;
  let end = start + 1;
  while (end < lines.length && !lines[end].trimStart().startsWith("[")) end++;
  return lines.slice(start, end).some((line) => line.trim() === marker);
}

function assertAvailable(content, header, marker) {
  if (content.split("\n").some((line) => line.trim() === header) && !blockHasMarker(content, header, marker)) {
    throw new Error(`Refusing to overwrite unmanaged Codex configuration section ${header}`);
  }
}

async function writeAtomic(path, content) {
  const temporary = `${path}.workspacejson-${process.pid}.tmp`;
  let existingMode;
  try {
    existingMode = (await stat(path)).mode & 0o777;
  } catch (err) {
    if (err.code !== "ENOENT") throw err;
  }
  await writeFile(temporary, content, { encoding: "utf8", mode: existingMode });
  if (existingMode !== undefined) await chmod(temporary, existingMode);
  await rename(temporary, path);
}

function buildHookBlock(commandPath) {
  return [
    "",
    "[[hooks.PreToolUse]]",
    HOOK_MARKER,
    'matcher = "^apply_patch$"',
    "[[hooks.PreToolUse.hooks]]",
    'type = "command"',
    `command = 'node "${commandPath}"'`,
    "timeout = 10",
    'statusMessage = "Checking workspace fragility and co-change history"',
  ].join("\n");
}

async function findRepoRoot(cwd) {
  try {
    const { execSync } = await import("node:child_process");
    const out = execSync("git rev-parse --show-toplevel", {
      cwd,
      encoding: "utf8",
      timeout: 5000,
      stdio: ["ignore", "pipe", "ignore"],
    });
    return out.trim();
  } catch {
    // No git: walk up to a plausible project root.
    let dir = resolve(cwd);
    const searched = new Set();
    while (!searched.has(dir)) {
      searched.add(dir);
      if (
        existsSync(resolve(dir, ".git")) ||
        existsSync(resolve(dir, "package.json")) ||
        existsSync(resolve(dir, ".agents")) ||
        existsSync(resolve(dir, "workspace.json"))
      ) {
        return dir;
      }
      const parent = dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
    return cwd;
  }
}

function setTomlBlock(content, header, blockText) {
  const trimmed = content.trim();
  if (trimmed.length === 0) {
    return `${blockText}\n`;
  }

  const lines = content.split("\n");
  const start = lines.findIndex((line) => line.trim() === header);
  if (start === -1) {
    return `${trimmed}\n\n${blockText}\n`;
  }

  let end = start + 1;
  while (end < lines.length && !lines[end].trimStart().startsWith("[")) {
    end++;
  }

  const before = lines.slice(0, start).join("\n");
  const after = lines.slice(end).join("\n");
  const parts = [before, blockText, after].filter((s) => s.length > 0);
  return `${parts.join("\n")}\n`;
}

function normalizeTomlEdges(content) {
  const withoutLeadingBlankLines = content.replace(/^(?:[ \t]*\r?\n)+/, "");
  const withoutBlankTail = withoutLeadingBlankLines.replace(/(?:\r?\n[ \t]*)+$/, "");
  return withoutBlankTail.length > 0 ? `${withoutBlankTail}\n` : "";
}

function removeTomlBlock(content, header) {
  const lines = content.split("\n");
  const start = lines.findIndex((line) => line.trim() === header);
  if (start === -1) return content;
  let end = start + 1;
  while (end < lines.length && !lines[end].trimStart().startsWith("[")) end++;
  return normalizeTomlEdges([...lines.slice(0, start), ...lines.slice(end)].join("\n"));
}

function removeManagedHook(content) {
  const lines = content.split("\n");
  const marker = lines.findIndex((line) => line.trim() === HOOK_MARKER);
  if (marker === -1) return content;

  let start = marker;
  while (start > 0 && lines[start].trim() !== "[[hooks.PreToolUse]]") start--;

  let end = marker + 1;
  let consumedInnerHeader = false;
  while (end < lines.length) {
    const line = lines[end].trim();
    if (line.startsWith("[")) {
      if (!consumedInnerHeader && line === "[[hooks.PreToolUse.hooks]]") {
        consumedInnerHeader = true;
      } else {
        break;
      }
    }
    end++;
  }
  return normalizeTomlEdges([...lines.slice(0, start), ...lines.slice(end)].join("\n"));
}

function addHookBlock(content, commandPath) {
  if (content.includes(HOOK_MARKER)) {
    return content;
  }
  return `${content.trimEnd() + buildHookBlock(commandPath)}\n`;
}

async function runInstall(opts = {}) {
  const withHook = Boolean(opts.withHook);
  const withExtension = Boolean(opts.withExtension);
  const repoRoot = await findRepoRoot(process.cwd());
  const codexDir = resolve(repoRoot, ".codex");
  const configPath = resolve(codexDir, "config.toml");
  const managedRoot = resolve(codexDir, "workspacejson-codex-mcp");
  const managedHookPath = resolve(managedRoot, "hooks", "pre-edit-check.mjs");
  const managedMarkerPath = resolve(managedRoot, RUNTIME_MARKER);

  let content = "";
  try {
    content = await readFile(configPath, "utf8");
  } catch (err) {
    if (err.code !== "ENOENT") throw err;
  }

  assertAvailable(content, MCP_HEADER, MCP_MARKER);
  if (existsSync(managedRoot) && !existsSync(managedMarkerPath)) {
    throw new Error(`Refusing to overwrite unmanaged runtime directory ${managedRoot}`);
  }

  content = setTomlBlock(content, MCP_HEADER, MCP_BLOCK);

  if (withHook) {
    content = addHookBlock(removeManagedHook(content), managedHookPath);
    await mkdir(resolve(managedRoot, "hooks"), { recursive: true });
    await cp(hookPath, managedHookPath);
    await cp(distSource, resolve(managedRoot, "dist"), { recursive: true, force: true });
    await writeAtomic(managedMarkerPath, "owned by @workspacejson/codex-mcp\n");
  }

  // Ensure the target directory exists for every install surface, not only
  // --with-hook: a fresh repo has no .codex/ yet, and writeAtomic would ENOENT.
  await mkdir(codexDir, { recursive: true });
  await writeAtomic(configPath, content);
  console.log(`Wrote ${configPath}`);
  if (withHook) {
    // HAC-203: print, never write. .codex/config.toml is commonly a tracked,
    // team-shared file (this repo does exactly that) — only the vendored
    // runtime this installer owns is worth ignoring, and only the user's own
    // .gitignore should say so.
    console.log("");
    console.log("Add this to .gitignore:");
    console.log("  .codex/workspacejson-codex-mcp/");
  }
  console.log("");
  console.log("Next steps:");
  console.log("  1. Restart Codex.");
  console.log("  2. Run /mcp in the TUI to confirm workspacejson is connected.");
  console.log(
    "  3. Run `git diff | npx @workspacejson/codex-mcp review --diff-stdin` with OPENAI_API_KEY set for an optional advisory GPT-5.6 review.",
  );
  if (withHook) {
    console.log("  4. PreToolUse hook is active for apply_patch.");
  }
  console.log("");
  console.log("Add this line to AGENTS.md to reinforce the behavior:");
  console.log(
    "  Before editing or creating a file, call workspace_get_file_context on the target path to check fragility and co-change partners.",
  );

  let extension;
  if (withExtension) {
    extension = installExtensionArtifact({ vsix: opts.vsix });
    printExtensionResult("VS Code extension (--with-extension):", extension);
  }

  // Compact install receipt: what integrated, and where to go next.
  const pad = (label) => label.padEnd(28);
  const artifactPath = resolve(repoRoot, ".agents", "workspace.json");
  const artifactExists = existsSync(artifactPath);
  console.log("");
  console.log("workspace.json MCP/hook installed");
  console.log(`  ${pad("Repository integration")}PASS`);
  console.log(`  ${pad("Deterministic hook")}${withHook ? "PASS" : "not requested (--with-hook)"}`);
  console.log(`  ${pad("Intelligence artifact")}${artifactExists ? "PASS" : "NOT FOUND"}`);
  if (!artifactExists) {
    console.log("");
    console.log("  .agents/workspace.json does not exist yet. Generate it:");
    console.log("    npx agents-audit@0.4.3 generate .");
    console.log("  Today, generate writes repository topology and hygiene with an empty");
    console.log("  fileIndex; manual fragility and co-change evidence is human-authored.");
  }
  if (withExtension) console.log(`  ${pad("VS Code extension")}${extension.status}`);
  if (withExtension && extension.status === "PASS") {
    console.log("");
    console.log("Next:");
    console.log("  1. Reload VS Code if prompted.");
    console.log("  2. Select the workspace.json icon in the Activity Bar (the { • } glyph).");
    console.log('  3. Follow the "workspace.json: Getting Started" walkthrough (opens on first install).');
    console.log("");
    console.log('  Reopen later: Command Palette → "workspace.json: Open Getting Started Walkthrough".');
  }
}

async function runUninstall(opts = {}) {
  const withExtension = Boolean(opts.withExtension);
  const repoRoot = await findRepoRoot(process.cwd());
  const codexDir = resolve(repoRoot, ".codex");
  const configPath = resolve(codexDir, "config.toml");
  const managedRoot = resolve(codexDir, "workspacejson-codex-mcp");
  const ownsRuntime = existsSync(resolve(managedRoot, RUNTIME_MARKER));

  let content = "";
  let configExisted = true;
  try {
    content = await readFile(configPath, "utf8");
  } catch (err) {
    if (err.code !== "ENOENT") throw err;
    configExisted = false;
  }

  const ownsMcp = blockHasMarker(content, MCP_HEADER, MCP_MARKER);
  if (ownsMcp) content = removeTomlBlock(content, MCP_HEADER);
  content = removeManagedHook(content);
  // Only touch config.toml when it exists; a never-installed repo has no .codex/
  // and writing an empty file into it would both ENOENT and leave clutter.
  if (configExisted) {
    await writeAtomic(configPath, normalizeTomlEdges(content));
    console.log(`Removed workspacejson configuration from ${configPath}`);
    console.log("Unrelated Codex configuration was preserved.");
  } else {
    console.log(`No ${configPath} found; nothing to remove.`);
  }
  if (ownsRuntime) await rm(managedRoot, { recursive: true, force: true });

  if (withExtension) {
    printExtensionResult("VS Code extension (--with-extension):", uninstallExtensionArtifact());
  } else {
    console.log("");
    console.log(
      "The global VS Code extension (if installed) was preserved. Remove it with: npx -y @workspacejson/codex-mcp uninstall --with-extension",
    );
  }
}

async function runServer() {
  await import(resolve(packageRoot, "dist", "index.js"));
}

async function runReview(args) {
  const { runReviewerCli } = await import(resolve(packageRoot, "dist", "reviewer.js"));
  process.exitCode = await runReviewerCli(args);
}

function parseArgs(argv) {
  const opts = { command: null, withHook: false, withExtension: false, vsix: null };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--with-hook") opts.withHook = true;
    else if (arg === "--with-extension") opts.withExtension = true;
    else if (arg === "--full") {
      opts.withHook = true;
      opts.withExtension = true;
    } else if (arg === "--vsix") opts.vsix = argv[++i] ?? null;
    else if (arg.startsWith("--vsix=")) opts.vsix = arg.slice("--vsix=".length);
    else if (!arg.startsWith("-") && opts.command === null) opts.command = arg;
  }
  if (opts.command === null) opts.command = "install";
  return opts;
}

const USAGE = [
  "Usage:",
  "  install [--with-hook] [--with-extension] [--full] [--vsix <path>]",
  "  uninstall [--with-extension]",
  "  server",
  "  review [--diff-stdin]",
].join("\n");

async function main() {
  const argv = process.argv.slice(2);
  // server/review are commands, matched only in first position — never by
  // scanning argv, which would let a flag VALUE (e.g. `--vsix server`)
  // hijack dispatch into a different program than the one requested.
  const [command, ...rest] = argv;
  if (command === "--help" || command === "-h") {
    console.log(USAGE);
    return;
  }
  if (command === "server") {
    await runServer();
    return;
  }
  if (command === "review") {
    await runReview(rest);
    return;
  }

  const opts = parseArgs(argv);
  if (opts.command === "install") {
    await runInstall(opts);
  } else if (opts.command === "uninstall") {
    await runUninstall(opts);
  } else {
    console.error("Unknown command:", opts.command);
    console.error(USAGE);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("Install failed:", err.message);
  process.exit(1);
});
