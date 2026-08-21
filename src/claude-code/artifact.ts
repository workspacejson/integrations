/**
 * Claude Code review-evidence adapter — artifact read layer.
 *
 * OWNERSHIP BOUNDARY (META-363). This module performs NO repository mining and
 * NO derivation. Co-change groups, their `support`, and their `occurrences` are
 * produced by `@workspacejson/cli` and recorded in the artifact under
 * `generated.coChange`; this module reads those fields verbatim and hands them
 * to the host. If a number is not in the artifact, this module does not compute
 * one. Mining semantics stay in the CLI; only host-shaped mapping lives here.
 *
 * WHY A SEPARATE READER FROM `services/workspace.ts`. That module deliberately
 * pins itself to the four `manual.*` / `generated.fileIndex` paths consumed by
 * the Codex enforcement surface, and explicitly does not read
 * `generated.coChange`. Changing it would move the Codex server's stable
 * surface, which is out of scope for META-363. Path resolution, root proving,
 * and key matching are IMPORTED rather than re-implemented, so there is still
 * exactly one definition of "these two paths are the same file".
 *
 * EVIDENCE SEMANTICS. Co-change is a symmetric historical observation: these
 * files appeared in the same commit N of M times, at a named revision. It is
 * NOT a dependency, a cause, a required change, a blast radius, a
 * recommendation, a correctness claim, or a risk score, and nothing in this
 * module may relabel it as one. Absent, unindexed, stale, or unreadable
 * evidence is reported as absence or uncertainty — never as safety.
 */

import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { normalizeKey, pathsMatch, toRepoRelativeKey } from "../path-match.js";
import { repositoryRootFor, resolveWorkspacePath } from "../services/workspace.js";
import { WorkspaceNotFoundError } from "../types.js";

/** Freshness of the artifact relative to the repository's current revision. */
export type Freshness = "current" | "stale" | "unknown";

/** Why a changed file carries no partner evidence. Never means "safe". */
export type AbsenceStatus = "no-recorded-co-change" | "file-not-indexed";

export interface CoChangeObservation {
  /** Repo-relative POSIX key of the historically co-changing partner file. */
  partner: string;
  /**
   * Commits in which BOTH files changed. Verbatim from the artifact; `null`
   * when the artifact recorded no count. Never substituted with a placeholder
   * number — a fabricated count would be indistinguishable from a mined one.
   */
  support: number | null;
  /** Qualifying commits considered for the pair. Verbatim, or `null`. */
  occurrences: number | null;
  /** Plain restatement of the two numbers. Adds no interpretation. */
  observation: string;
}

export interface FileEvidence {
  /** The changed-file key the host asked about, normalized. */
  file: string;
  /** Present when evidence exists; absent files carry `absence` instead. */
  partners: CoChangeObservation[];
  /** Set only when `partners` is empty, naming WHY — never "safe". */
  absence?: AbsenceStatus;
}

export interface ArtifactProvenance {
  /** Absolute path of the artifact that was read. */
  sourcePath: string;
  /** Repository root the stored keys are relative to. */
  repositoryRoot: string;
  /** `generated.specVersion`, if recorded. */
  specVersion: string | null;
  /** `generated.by`, rendered as "name@version", if recorded. */
  producer: string | null;
  /** `generated.generatedAt`, if recorded. */
  generatedAt: string | null;
  /** `generated.basisRevision` — the revision the evidence is bound to. */
  basisRevision: string | null;
  /** The repository's current HEAD, when it could be read. */
  currentRevision: string | null;
  freshness: Freshness;
  /** Human-readable statement of what freshness means here. Never "safe". */
  freshnessNote: string;
}

export interface EvidenceResult {
  provenance: ArtifactProvenance;
  files: FileEvidence[];
}

/** Raised when the artifact exists but cannot be parsed or is not an object. */
export class WorkspaceUnreadableError extends Error {
  constructor(sourcePath: string, detail: string) {
    super(
      `workspace.json at ${sourcePath} could not be read as evidence: ${detail}. No co-change evidence is available for this review. This is an absence of evidence, not an absence of risk.`,
    );
    this.name = "WorkspaceUnreadableError";
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function optionalString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

/**
 * Current HEAD of the repository the artifact belongs to.
 *
 * Read-only, fixed argv, no shell. Returns null rather than throwing: a
 * repository we cannot interrogate yields `freshness: "unknown"`, which is an
 * honest uncertainty, not a failure and not a green light.
 */
function readCurrentRevision(repositoryRoot: string): string | null {
  if (!existsSync(repositoryRoot)) return null;
  try {
    const out = execFileSync("git", ["-C", repositoryRoot, "rev-parse", "HEAD"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 5_000,
    });
    const sha = out.trim();
    return /^[0-9a-f]{40}$/.test(sha) ? sha : null;
  } catch {
    return null;
  }
}

/**
 * Co-change groups exactly as `@workspacejson/cli` recorded them.
 *
 * A group is `{files: string[], support?: number, occurrences?: number}`. Groups
 * whose counts are missing are still returned — with the counts reported as
 * absent rather than invented. Malformed entries are skipped rather than
 * guessed at.
 */
interface RawGroup {
  files: string[];
  support: number | null;
  occurrences: number | null;
}

function readGroups(generated: Record<string, unknown>): RawGroup[] {
  const raw = generated.coChange;
  if (!Array.isArray(raw)) return [];
  const groups: RawGroup[] = [];
  for (const entry of raw) {
    const rec = asRecord(entry);
    const files = Array.isArray(rec.files)
      ? rec.files.filter((f): f is string => typeof f === "string").map(normalizeKey)
      : [];
    if (files.length < 2) continue;
    groups.push({
      files,
      support: typeof rec.support === "number" ? rec.support : null,
      occurrences: typeof rec.occurrences === "number" ? rec.occurrences : null,
    });
  }
  return groups;
}

function readFileIndex(generated: Record<string, unknown>): Set<string> {
  const raw = generated.fileIndex;
  const keys = Array.isArray(raw)
    ? raw.map((e) => (typeof e === "string" ? e : (asRecord(e).path as string) || "")).filter((p) => p.length > 0)
    : Object.keys(asRecord(raw));
  return new Set(keys.map(normalizeKey));
}

/**
 * Restate the recorded counts without interpreting them.
 *
 * The wording is deliberately backward-looking ("changed in the same commit")
 * and symmetric. It must not acquire words like "requires", "depends",
 * "impacts", "should", or "likely" — those would convert a historical
 * observation into a prescription the CLI never made.
 */
/**
 * Sort key for a possibly-absent support count. Presentation ordering only: an
 * unrecorded count sorts last rather than being rendered as a number.
 */
function rank(support: number | null): number {
  return support ?? Number.NEGATIVE_INFINITY;
}

function describe(partner: string, support: number | null, occurrences: number | null): string {
  if (support === null || occurrences === null) {
    return `${partner} is recorded as historically co-changing with this file; the artifact records no support/occurrence counts for the pair.`;
  }
  return `${partner} and this file changed in the same commit in ${support} of ${occurrences} qualifying commits, as observed at the artifact's basis revision.`;
}

function freshnessOf(
  basisRevision: string | null,
  currentRevision: string | null,
): { freshness: Freshness; note: string } {
  if (!basisRevision) {
    return {
      freshness: "unknown",
      note:
        "The artifact records no basisRevision, so this evidence cannot be bound to a repository revision. " +
        "Treat every observation below as of unknown age.",
    };
  }
  if (!currentRevision) {
    return {
      freshness: "unknown",
      note: `The artifact is bound to ${basisRevision}, but the repository's current revision could not be read, so drift cannot be measured. Treat the observations below as of unknown age.`,
    };
  }
  if (basisRevision === currentRevision) {
    return {
      freshness: "current",
      note: `The artifact's basisRevision matches the repository's current revision (${currentRevision}).`,
    };
  }
  return {
    freshness: "stale",
    note: `The artifact is bound to ${basisRevision} but the repository is at ${currentRevision}. Commits made since the basis revision are not reflected below. Absence of a partner here does not mean no such partner exists at the current revision.`,
  };
}

/**
 * Retrieve revision-bound descriptive co-change evidence for changed files.
 *
 * Throws `WorkspaceNotFoundError` when no artifact exists and
 * `WorkspaceUnreadableError` when one exists but cannot be parsed. Both are
 * surfaced to the host as explicit uncertainty by the server layer; neither is
 * ever converted into an affirmative statement about the change.
 */
export async function retrieveEvidence(changedFiles: string[]): Promise<EvidenceResult> {
  const sourcePath = resolveWorkspacePath();
  const repositoryRoot = repositoryRootFor(sourcePath);

  let parsed: unknown;
  try {
    await stat(sourcePath);
    parsed = JSON.parse(await readFile(sourcePath, "utf8"));
  } catch (err) {
    throw new WorkspaceUnreadableError(sourcePath, err instanceof Error ? err.message : String(err));
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new WorkspaceUnreadableError(sourcePath, "top level is not a JSON object");
  }

  const generated = asRecord(asRecord(parsed).generated);
  const groups = readGroups(generated);
  const fileIndex = readFileIndex(generated);

  const by = asRecord(generated.by);
  const producerName = optionalString(by.name);
  const producerVersion = optionalString(by.version);
  const basisRevision = optionalString(generated.basisRevision);
  const currentRevision = readCurrentRevision(repositoryRoot);
  const { freshness, note } = freshnessOf(basisRevision, currentRevision);

  const files: FileEvidence[] = [];
  for (const query of changedFiles) {
    // An absolute query is only comparable once containment in the proven root
    // is established; toRepoRelativeKey refuses rather than guessing.
    const key = toRepoRelativeKey(repositoryRoot, query);
    if (key === undefined) {
      files.push({ file: normalizeKey(query), partners: [], absence: "file-not-indexed" });
      continue;
    }

    const partners = new Map<string, CoChangeObservation>();
    for (const group of groups) {
      if (!group.files.some((f) => pathsMatch(key, f, repositoryRoot))) continue;
      for (const other of group.files) {
        if (pathsMatch(key, other, repositoryRoot)) continue;
        // Keep the strongest recorded pairing when a file appears in several
        // groups. Ordering is presentation only; it asserts no ranking claim.
        const existing = partners.get(other);
        if (existing && rank(existing.support) >= rank(group.support)) continue;
        partners.set(other, {
          partner: other,
          support: group.support,
          occurrences: group.occurrences,
          observation: describe(other, group.support, group.occurrences),
        });
      }
    }

    const list = [...partners.values()].sort(
      (a, b) => rank(b.support) - rank(a.support) || a.partner.localeCompare(b.partner),
    );
    if (list.length > 0) {
      files.push({ file: key, partners: list });
    } else {
      files.push({
        file: key,
        partners: [],
        absence: fileIndex.size > 0 && !fileIndex.has(key) ? "file-not-indexed" : "no-recorded-co-change",
      });
    }
  }

  return {
    provenance: {
      sourcePath,
      repositoryRoot,
      specVersion: optionalString(generated.specVersion),
      producer: producerName ? `${producerName}${producerVersion ? `@${producerVersion}` : ""}` : null,
      generatedAt: optionalString(generated.generatedAt),
      basisRevision,
      currentRevision,
      freshness,
      freshnessNote: note,
    },
    files,
  };
}

export { WorkspaceNotFoundError };
