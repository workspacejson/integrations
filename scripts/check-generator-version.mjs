#!/usr/bin/env node
// The producer command is copy-pasted across README, the extension manifest, its
// source, its walkthrough media, and the installer receipt — a Second Copy by
// construction (see HAC-204). This gate does not hand-sync those strings; it
// asserts they stay in sync with EACH OTHER, so a stale command in one surface
// fails loudly instead of shipping.
//
// META-291 moved the handoff from the historical `agents-audit` command to the
// neutral producer `@workspacejson/cli`. This gate enforces that move mechanically:
// every surface that hands a user a producer command must name the neutral one,
// every surface must agree on the version qualifier, and no surface may hand back
// a runnable `agents-audit@x.y.z generate` command. `agents-audit` may still be
// *described* as the frozen compatibility bridge — describing it is not handing
// it to a cold user as the way to produce an artifact.
//
// It deliberately does NOT judge any pin against the npm registry's latest: the
// declared command is the contract, the registry is the world, and a downstream
// repo's CI must not turn red merely because an upstream release moved ahead.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");

const PRODUCER_PACKAGE = "@workspacejson/cli";
// Matches `npx @workspacejson/cli generate` and `npx @workspacejson/cli@1.2.3 generate`.
const PRODUCER_PATTERN = /npx @workspacejson\/cli(?:@(\d+\.\d+\.\d+))? generate/g;
// A runnable legacy handoff. Prose that merely names `agents-audit` does not match.
const LEGACY_HANDOFF_PATTERN = /npx agents-audit(?:@\d+\.\d+\.\d+)? generate/g;

const UNPINNED = "unpinned";

const SURFACES = [
  "README.md",
  "extension/package.json",
  "extension/src/commands.ts",
  "scripts/install.mjs",
  "extension/assets/walkthrough/generate.md",
];

/**
 * @param {string} rootDir
 * @param {string[]} files
 * @returns {{ refs: { file: string, version: string }[], legacy: { file: string, command: string }[] }}
 */
export function collectProducerRefs(rootDir, files) {
  const refs = [];
  const legacy = [];
  for (const file of files) {
    const text = readFileSync(join(rootDir, file), "utf8");
    for (const match of text.matchAll(PRODUCER_PATTERN)) {
      refs.push({ file, version: match[1] ?? UNPINNED });
    }
    for (const match of text.matchAll(LEGACY_HANDOFF_PATTERN)) {
      legacy.push({ file, command: match[0] });
    }
  }
  return { refs, legacy };
}

/**
 * Pure comparison logic — no filesystem or network. Asserts every surface hands a
 * user the same neutral producer command, and that no surface hands back a runnable
 * legacy `agents-audit generate` command. It does NOT judge a pin against the
 * registry (see file header / HAC-204).
 * @param {{ file: string, version: string }[]} refs
 * @param {string[]} requiredSurfaces
 * @param {{ file: string, command: string }[]} legacy
 * @returns {string[]} violation messages; empty when clean
 */
export function findVersionMismatches(refs, requiredSurfaces = SURFACES, legacy = []) {
  const violations = [];

  const representedSurfaces = new Set(refs.map((ref) => ref.file));
  const missingSurfaces = requiredSurfaces.filter((file) => !representedSurfaces.has(file));
  if (missingSurfaces.length > 0) {
    violations.push(
      `${PRODUCER_PACKAGE} handoff is missing from required surface(s): ${missingSurfaces.join(", ")}. ` +
        `Each declared surface must hand the user \`npx ${PRODUCER_PACKAGE} generate\`.`,
    );
  } else {
    const distinctVersions = [...new Set(refs.map((r) => r.version))];
    if (distinctVersions.length > 1) {
      const detail = refs.map((r) => `${r.file} -> ${r.version}`).join(", ");
      violations.push(
        `${PRODUCER_PACKAGE} version qualifier disagrees across surfaces (${detail}). Use the same form — all pinned to one version, or all unpinned — in every reference.`,
      );
    }
  }

  if (legacy.length > 0) {
    const detail = legacy.map((l) => `${l.file} -> ${l.command}`).join(", ");
    violations.push(
      `a runnable legacy generate command is still handed to users (${detail}). \`agents-audit\` is a frozen compatibility bridge and may be described as one, but the producer handoff must be \`npx ${PRODUCER_PACKAGE} generate\` (META-291).`,
    );
  }

  return violations;
}

function main() {
  const { refs, legacy } = collectProducerRefs(root, SURFACES);
  const violations = findVersionMismatches(refs, SURFACES, legacy);
  if (violations.length > 0) {
    console.error("producer handoff check failed:");
    for (const violation of violations) console.error(`  - ${violation}`);
    process.exitCode = 1;
    return;
  }

  const qualifier = refs.length > 0 ? refs[0].version : UNPINNED;
  console.log(
    refs.length > 0
      ? `producer handoff check passed (${refs.length} reference(s) to ${PRODUCER_PACKAGE}, ${qualifier}).`
      : "producer handoff check passed (no references found).",
  );
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
