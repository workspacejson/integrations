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
 * True if `query` and `storedKey` denote the same file.
 *
 * Exact equality first. When that misses, compare path suffixes so a key stored
 * with extra leading segments still resolves to the file the user is looking at
 * — decorations were dropping on nested-folder workspaces where the editor hands
 * us a longer path than the one recorded in the artifact.
 */
export function pathsMatch(query: string, storedKey: string): boolean {
  const q = normalizeKey(query);
  const stored = normalizeKey(storedKey);
  if (q === stored) return true;
  return q.endsWith(`/${stored}`) || stored.endsWith(`/${q}`);
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
