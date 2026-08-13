/**
 * Clean-room evidence envelope + mechanical tier derivation.
 *
 * PROVENANCE: this is an independent reimplementation of the evidence contract
 * used by the workspace.json fragility schema. It shares a SHAPE, not code, with
 * any other implementation (clean-room boundary is load-bearing; no cross-org
 * imports). The contract:
 *
 *   - Producers (humans, tools, agents) record EVIDENCE: {claim, command, output}
 *     triples, or bare observation strings.
 *   - Producers NEVER record a tier or a confidence value. If the artifact
 *     carries one, it is IGNORED here and re-derived. Confidence is a mechanical
 *     function of evidence, never an emitted opinion.
 *   - Tiers are derived by this module, mechanically:
 *       ASSERTED  — a claim with no evidence records at all.
 *       OBSERVED  — at least one recorded evidence item (observation string or
 *                   triple). Something was seen and written down.
 *       VERIFIED  — at least one evidence triple whose command this harness
 *                   RE-RAN locally (read-only whitelist) and whose recorded
 *                   output was reproduced. A green we watched.
 *
 * Enforcement asymmetry (deliberate): this module can justify a BLOCK or a
 * WARNING. It structurally cannot and will not emit a safety APPROVAL — the
 * evidence class that would justify "this change is safe" is exactly the class
 * that cannot be verified by read-only re-run. Absence of recorded risk is
 * reported as absence, never as safety.
 */

import { execFileSync } from "node:child_process";
import { pathsMatch } from "./path-match.js";

export type EvidenceTier = "ASSERTED" | "OBSERVED" | "VERIFIED";

/** A single evidence record. Bare strings normalize to observation-only records. */
export interface EvidenceRecord {
  /** What this evidence is claimed to show, e.g. "reverted in a1b2c3". */
  claim: string;
  /** Reproducible read-only command that demonstrates the claim, if recorded. */
  command?: string;
  /** The output (or output fragment) the command produced when recorded. */
  output?: string;
}

export type EnforcementAction = "deny" | "warn" | "annotate" | "none";

export interface FileRiskAssessment {
  path: string;
  fragile: boolean;
  tier: EvidenceTier | null; // null when not fragile
  reason?: string;
  evidence: EvidenceRecord[];
  coChangePartners: string[];
  /** Partners recorded as co-changing that are NOT in the current changeset. */
  missingPartners: string[];
  action: EnforcementAction;
  /** Human/agent-facing explanation, always citing evidence, never "safe". */
  message: string;
}

// ---------------------------------------------------------------------------
// Normalization: tolerate strings and object records; strip any producer-
// emitted tier/confidence fields (they are not trusted, ever).
// ---------------------------------------------------------------------------

export function normalizeEvidence(raw: unknown): EvidenceRecord[] {
  if (!Array.isArray(raw)) return [];
  const out: EvidenceRecord[] = [];
  for (const item of raw) {
    if (typeof item === "string" && item.trim().length > 0) {
      out.push({ claim: item.trim() });
      continue;
    }
    if (item && typeof item === "object" && !Array.isArray(item)) {
      const rec = item as Record<string, unknown>;
      const claim = typeof rec.claim === "string" ? rec.claim : "";
      if (!claim) continue;
      const e: EvidenceRecord = { claim };
      if (typeof rec.command === "string") e.command = rec.command;
      if (typeof rec.output === "string") e.output = rec.output;
      // Deliberately dropped if present: rec.tier, rec.confidence, rec.score.
      out.push(e);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Verification: optional, read-only, whitelisted. Upgrades OBSERVED→VERIFIED
// only when the recorded command re-runs and reproduces the recorded output.
// Never used on the hook hot path by default (latency); demo/CI use --verify.
// ---------------------------------------------------------------------------

const READ_ONLY_GIT = /^git\s+(log|show|diff|rev-parse|grep|status)\b/;

export function isVerifiableCommand(command: string): boolean {
  return READ_ONLY_GIT.test(command.trim());
}

export function verifyRecord(record: EvidenceRecord, cwd: string): boolean {
  if (!record.command || !record.output) return false;
  if (!isVerifiableCommand(record.command)) return false;
  try {
    const parts = record.command.trim().split(/\s+/);
    const actual = execFileSync(parts[0], parts.slice(1), {
      cwd,
      encoding: "utf8",
      timeout: 5_000,
      stdio: ["ignore", "pipe", "ignore"],
    });
    // Reproduction = recorded output fragment appears in the live output.
    return actual.includes(record.output.trim());
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Mechanical tier derivation. No model input, no producer input. Pure function
// of evidence shape (+ optional live verification results).
// ---------------------------------------------------------------------------

export function deriveTier(evidence: EvidenceRecord[], opts?: { verify?: boolean; cwd?: string }): EvidenceTier {
  if (evidence.length === 0) return "ASSERTED";
  if (opts?.verify && opts.cwd) {
    for (const rec of evidence) {
      if (verifyRecord(rec, opts.cwd)) return "VERIFIED";
    }
  }
  return "OBSERVED";
}

// ---------------------------------------------------------------------------
// Enforcement mapping: tier drives strength, mechanically.
//   OBSERVED/VERIFIED fragility + missing co-change partners  → deny
//   OBSERVED/VERIFIED fragility, partners covered or none     → warn
//   missing partners on a non-fragile / ASSERTED file         → warn (advisory)
//   ASSERTED fragility alone                                  → annotate
//   nothing recorded                                          → none (NOT "safe")
// A deny is a request for human attention, not an unappealable wall — the
// client's own permission flow remains the final authority.
// ---------------------------------------------------------------------------

export function decideEnforcement(input: {
  path: string;
  fragile: boolean;
  tier: EvidenceTier | null;
  reason?: string;
  evidence: EvidenceRecord[];
  coChangePartners: string[];
  changesetPaths: string[];
  /** Repository root the changeset paths are proven against (see NormalizedWorkspace). */
  repositoryRoot: string;
}): FileRiskAssessment {
  // Same matcher as the read layer: exact equality after resolution, no suffix
  // fallback. (audit Critical #1 — this was a divergent fuzzy match that
  // downgraded denies; the two layers must never drift apart again.)
  const inChangeset = (partner: string) =>
    input.changesetPaths.some((c) => pathsMatch(c, partner, input.repositoryRoot));
  const missingPartners = input.coChangePartners.filter((p) => !inChangeset(p));

  const cite = input.evidence.length > 0 ? ` Evidence: ${input.evidence.map((e) => e.claim).join("; ")}.` : "";

  let action: EnforcementAction;
  let message: string;

  const evidencedFragile = input.fragile && (input.tier === "OBSERVED" || input.tier === "VERIFIED");

  if (evidencedFragile && missingPartners.length > 0) {
    action = "deny";
    message = `BLOCK [tier ${input.tier}]: ${input.path} is fragile${input.reason ? ` (${input.reason})` : ""} and historically co-changes with ${missingPartners.join(", ")}, which this change omits.${cite} Include the recorded co-change partners, or stop and review the exception with a human.`;
  } else if (evidencedFragile) {
    action = "warn";
    message = `CAUTION [tier ${input.tier}]: ${input.path} is fragile${input.reason ? ` (${input.reason})` : ""}.${cite} Prefer minimal, well-tested changes.${
      input.coChangePartners.length > 0
        ? ` Co-change partners present in changeset: ${input.coChangePartners.join(", ")}.`
        : ""
    }`;
  } else if (missingPartners.length > 0) {
    action = "warn";
    message = `ADVISORY: ${input.path} historically co-changes with ${missingPartners.join(", ")}, which this change omits. Check whether related updates are needed.`;
  } else if (input.fragile && input.tier === "ASSERTED") {
    action = "annotate";
    message = `NOTE [tier ASSERTED]: ${input.path} is flagged fragile without recorded evidence${input.reason ? ` (${input.reason})` : ""}. Treat as a prior, not a finding.`;
  } else {
    action = "none";
    message = `No recorded risk history for ${input.path}. Absence of history is not evidence of safety.`;
  }

  return {
    path: input.path,
    fragile: input.fragile,
    tier: input.fragile ? input.tier : null,
    ...(input.reason ? { reason: input.reason } : {}),
    evidence: input.evidence,
    coChangePartners: input.coChangePartners,
    missingPartners,
    action,
    message,
  };
}

const ACTION_RANK: Record<EnforcementAction, number> = {
  deny: 3,
  warn: 2,
  annotate: 1,
  none: 0,
};

/** The changeset-level action is the max severity across touched files. */
export function aggregateAction(assessments: FileRiskAssessment[]): EnforcementAction {
  return assessments.reduce<EnforcementAction>(
    (acc, a) => (ACTION_RANK[a.action] > ACTION_RANK[acc] ? a.action : acc),
    "none",
  );
}
