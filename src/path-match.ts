import { isAbsolute, normalize, relative } from "node:path";

/**
 * THE path matcher. One implementation, imported by both the workspace service
 * and the evidence/enforcement layer, so there is exactly one definition of
 * "these two paths are the same file." A second matcher is how a deny silently
 * became a warn (audit Critical #1): the enforcement layer had drifted to a
 * symmetric fuzzy suffix match while the read layer was tightened. Never again —
 * both call these.
 *
 * Keys are pinned to META-102: repo-root-relative POSIX, forward slashes, no
 * leading "./", no trailing slash, no drive letters.
 *
 * Resolution is exact (ADR-006 §4, §8). There is NO suffix matching. An absolute
 * host query is only comparable once it has been resolved against a repository
 * root that the caller has proven; if containment cannot be proven the answer is
 * "no match", never a nearest guess. The suffix fallback this file used to carry
 * matched a stored `src/a.ts` against `/elsewhere/unrelated-repo/src/a.ts` — an
 * assertion landing on a file in a different repository (META-291).
 */

export function normalizeKey(p: string): string {
  let s = normalize(p).replace(/\\/g, "/");
  s = s.replace(/^\.\//, ""); // drop leading ./
  if (s.length > 1) s = s.replace(/\/+$/, ""); // drop trailing slash(es)
  return s;
}

/** True if `key` is a safe repo-relative key: no traversal, no absolute paths. */
function isRepoRelative(key: string): boolean {
  return Boolean(key) && key !== "." && key !== ".." && !key.startsWith("../") && !key.startsWith("/");
}

/**
 * Repo-relative key for a host path, ONLY when containment in `root` is PROVEN.
 *
 * Returns undefined when the path is not provably inside the root — that is a
 * refusal, not a failure to try harder. A relative query is already a key and is
 * returned normalized.
 *
 * Purely lexical: it does not resolve symlinks and does not case-fold. Both are
 * deliberate — see ADR-006 §5/§6 and the canonicalization work that owns them.
 */
export function toRepoRelativeKey(root: string, query: string): string | undefined {
  if (!isAbsolute(query)) return normalizeKey(query);
  const key = normalizeKey(relative(root, query));
  return isRepoRelative(key) ? key : undefined;
}

/**
 * True if `query` and `storedKey` denote the same file.
 *
 * `root` is REQUIRED rather than optional on purpose: an absolute query is only
 * comparable once containment has been proven, so every caller is forced by the
 * compiler to name the root it proved containment against. An optional root
 * would let an absolute query silently degrade to "no match" at a call site that
 * simply forgot to pass one.
 */
export function pathsMatch(query: string, storedKey: string, root: string): boolean {
  const rel = toRepoRelativeKey(root, query);
  if (rel === undefined) return false;
  return rel === normalizeKey(storedKey);
}
