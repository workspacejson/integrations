import { normalize, relative } from "node:path";

/**
 * Mirrors src/path-match.ts (META-102 contract) in the main repo. Ported, not
 * imported — this extension is a standalone npm package with no build-time
 * dependency on the server. This is the ONLY path matcher used anywhere in
 * this extension; keep it in sync by hand if the upstream contract changes.
 *
 * Same contract as the server, expressed in two steps rather than one: here
 * `relativeWorkspacePath` IS the proven-containment step, and every caller runs
 * it against the VS Code workspace folder before anything reaches `pathsMatch`.
 * So `pathsMatch` only ever sees repo-relative keys and is exact equality —
 * the server's `pathsMatch(query, storedKey, root)` folds the same two steps
 * into one signature because its callers receive raw host paths. Neither has a
 * suffix fallback (ADR-006 §8, META-291).
 */

export function normalizeKey(p: string): string {
  let s = normalize(p).replace(/\\/g, "/");
  s = s.replace(/^\.\//, "");
  if (s.length > 1) s = s.replace(/\/+$/, "");
  return s;
}

/**
 * True if `query` and `storedKey` denote the same file. Exact equality: both
 * sides must already be repo-relative keys. Pass host paths through
 * `relativeWorkspacePath` first — that is where containment is proven.
 */
export function pathsMatch(query: string, storedKey: string): boolean {
  return normalizeKey(query) === normalizeKey(storedKey);
}

/** True if `key` is a safe repo-relative path: no traversal, no absolute paths. */
export function isValidRelativeKey(key: string): boolean {
  return Boolean(key) && key !== "." && key !== ".." && !key.startsWith("../") && !key.startsWith("/");
}

/** Repo-relative key for `fsPath` under `root`, or undefined if it escapes root. */
export function relativeWorkspacePath(root: string, fsPath: string): string | undefined {
  const key = normalizeKey(relative(root, fsPath));
  return isValidRelativeKey(key) ? key : undefined;
}
