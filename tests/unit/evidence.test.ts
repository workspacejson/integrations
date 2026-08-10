import { describe, expect, it } from "vitest";
import {
  type FileRiskAssessment,
  aggregateAction,
  decideEnforcement,
  deriveTier,
  isVerifiableCommand,
  normalizeEvidence,
  verifyRecord,
} from "../../src/evidence.js";

// The enforcement layer resolves changeset paths against the same proven root as
// the read layer. These fixtures are repo-relative, so the value only has to be a
// plausible root; the point is that both layers now demand one.
const REPO_ROOT = "/abs/repo";

describe("normalizeEvidence", () => {
  it("returns an empty array for non-array inputs", () => {
    expect(normalizeEvidence(undefined)).toEqual([]);
    expect(normalizeEvidence(null)).toEqual([]);
    expect(normalizeEvidence({})).toEqual([]);
  });

  it("converts string observations to claim records", () => {
    expect(normalizeEvidence(["revert a1b2c3", "incident 2026-02-14"])).toEqual([
      { claim: "revert a1b2c3" },
      { claim: "incident 2026-02-14" },
    ]);
  });

  it("preserves command and output but drops producer tier/confidence", () => {
    expect(
      normalizeEvidence([
        {
          claim: "revert d4e5f6",
          command: "git log --oneline --grep 'revert'",
          output: "d4e5f6",
          tier: "VERIFIED",
          confidence: 0.99,
          score: 100,
        },
      ]),
    ).toEqual([
      {
        claim: "revert d4e5f6",
        command: "git log --oneline --grep 'revert'",
        output: "d4e5f6",
      },
    ]);
  });

  it("ignores empty or invalid entries", () => {
    expect(normalizeEvidence(["", { claim: "" }, 42, null, { command: "noop" }])).toEqual([]);
  });
});

describe("isVerifiableCommand", () => {
  it("accepts read-only git subcommands", () => {
    expect(isVerifiableCommand("git log --oneline")).toBe(true);
    expect(isVerifiableCommand("git show d4e5f6")).toBe(true);
    expect(isVerifiableCommand("git diff --stat")).toBe(true);
    expect(isVerifiableCommand("git rev-parse --git-dir")).toBe(true);
    expect(isVerifiableCommand("git grep foo")).toBe(true);
    expect(isVerifiableCommand("git status --short")).toBe(true);
  });

  it("rejects non-git and mutating commands", () => {
    expect(isVerifiableCommand("git push origin main")).toBe(false);
    expect(isVerifiableCommand("node -e 'console.log(1)'")).toBe(false);
    expect(isVerifiableCommand("rm -rf /")).toBe(false);
  });
});

describe("verifyRecord", () => {
  it("returns false when command or output is missing", () => {
    expect(verifyRecord({ claim: "x" }, process.cwd())).toBe(false);
    expect(verifyRecord({ claim: "x", command: "git log" }, process.cwd())).toBe(false);
  });

  it("returns false for non-whitelisted commands", () => {
    expect(verifyRecord({ claim: "x", command: "git push", output: "pushed" }, process.cwd())).toBe(false);
  });

  it("returns false when live output does not contain the recorded output", () => {
    expect(
      verifyRecord(
        { claim: "x", command: "git log --oneline --grep 'nonexistent'", output: "nonexistent" },
        process.cwd(),
      ),
    ).toBe(false);
  });

  it("returns true when a whitelisted command reproduces the recorded output", () => {
    expect(verifyRecord({ claim: "x", command: "git rev-parse --git-dir", output: ".git" }, process.cwd())).toBe(true);
  });
});

describe("deriveTier", () => {
  it("classifies no evidence as ASSERTED", () => {
    expect(deriveTier([])).toBe("ASSERTED");
  });

  it("classifies evidence as OBSERVED by default", () => {
    expect(deriveTier([{ claim: "saw it" }])).toBe("OBSERVED");
  });

  it("upgrades to VERIFIED when a command reproduces", () => {
    const evidence = [{ claim: "repo exists", command: "git rev-parse --git-dir", output: ".git" }];
    expect(deriveTier(evidence, { verify: true, cwd: process.cwd() })).toBe("VERIFIED");
  });

  it("stays OBSERVED when verification is requested but no record reproduces", () => {
    const evidence = [{ claim: "missing", command: "git log --oneline --grep 'missing'", output: "missing" }];
    expect(deriveTier(evidence, { verify: true, cwd: process.cwd() })).toBe("OBSERVED");
  });
});

describe("decideEnforcement", () => {
  it("denies evidenced fragility with missing co-change partners", () => {
    const result = decideEnforcement({
      path: "src/routes/checkout.ts",
      fragile: true,
      tier: "OBSERVED",
      reason: "payment edge cases",
      evidence: [{ claim: "revert d4e5f6" }],
      coChangePartners: ["src/auth/session.ts", "src/lib/format.ts"],
      changesetPaths: ["src/routes/checkout.ts"],
      repositoryRoot: REPO_ROOT,
    });
    expect(result.action).toBe("deny");
    expect(result.message).toContain("BLOCK");
    expect(result.message).toContain("src/auth/session.ts");
    expect(result.message).toContain("revert d4e5f6");
    expect(result.message).toContain(
      "Include the recorded co-change partners, or stop and review the exception with a human.",
    );
    expect(result.message).not.toContain("get explicit human approval");
    expect(result.message).not.toContain("safe");
  });

  it("uses path membership and has no override for an evidenced missing partner", () => {
    const input = {
      path: "src/routes/checkout.ts",
      fragile: true,
      tier: "OBSERVED" as const,
      evidence: [{ claim: "revert d4e5f6" }],
      coChangePartners: ["src/auth/session.ts"],
      changesetPaths: ["src/routes/checkout.ts", "src/auth/session-helper.ts"],
      repositoryRoot: REPO_ROOT,
      override: true,
    };

    const result = decideEnforcement(input);

    expect(result.action).toBe("deny");
    expect(result.missingPartners).toEqual(["src/auth/session.ts"]);
  });

  // ADR-006 §8 / META-291, guarding audit Critical #1 from the other direction:
  // under the suffix fallback an absolute changeset path from an UNRELATED
  // checkout counted as covering a partner, silently downgrading deny -> warn.
  // Coverage now requires the path to resolve inside the proven root.
  it("does not let a path outside the root cover a partner and downgrade a deny", () => {
    const result = decideEnforcement({
      path: "src/routes/checkout.ts",
      fragile: true,
      tier: "OBSERVED",
      evidence: [{ claim: "revert d4e5f6" }],
      coChangePartners: ["src/auth/session.ts"],
      changesetPaths: ["src/routes/checkout.ts", "/elsewhere/unrelated-repo/src/auth/session.ts"],
      repositoryRoot: REPO_ROOT,
    });
    expect(result.action).toBe("deny");
    expect(result.missingPartners).toEqual(["src/auth/session.ts"]);
  });

  it("lets an absolute path inside the root cover a partner", () => {
    const result = decideEnforcement({
      path: "src/routes/checkout.ts",
      fragile: true,
      tier: "OBSERVED",
      evidence: [{ claim: "revert d4e5f6" }],
      coChangePartners: ["src/auth/session.ts"],
      changesetPaths: ["src/routes/checkout.ts", `${REPO_ROOT}/src/auth/session.ts`],
      repositoryRoot: REPO_ROOT,
    });
    expect(result.action).toBe("warn");
    expect(result.missingPartners).toEqual([]);
  });

  it("warns when evidenced fragility is touched but partners are covered", () => {
    const result = decideEnforcement({
      path: "src/routes/checkout.ts",
      fragile: true,
      tier: "OBSERVED",
      reason: "payment edge cases",
      evidence: [{ claim: "revert d4e5f6" }],
      coChangePartners: ["src/auth/session.ts"],
      changesetPaths: ["src/routes/checkout.ts", "src/auth/session.ts"],
      repositoryRoot: REPO_ROOT,
    });
    expect(result.action).toBe("warn");
    expect(result.message).toContain("CAUTION");
  });

  it("warns when a non-fragile file has missing co-change partners", () => {
    const result = decideEnforcement({
      path: "src/lib/new.ts",
      fragile: false,
      tier: null,
      evidence: [],
      coChangePartners: ["src/db/client.ts"],
      changesetPaths: ["src/lib/new.ts"],
      repositoryRoot: REPO_ROOT,
    });
    expect(result.action).toBe("warn");
    expect(result.message).toContain("ADVISORY");
  });

  it("annotates asserted fragility without partners", () => {
    const result = decideEnforcement({
      path: "src/auth/session.ts",
      fragile: true,
      tier: "ASSERTED",
      evidence: [],
      coChangePartners: [],
      changesetPaths: ["src/auth/session.ts"],
      repositoryRoot: REPO_ROOT,
    });
    expect(result.action).toBe("annotate");
    expect(result.message).toContain("NOTE");
  });

  it("warns when asserted fragility has missing co-change partners", () => {
    const result = decideEnforcement({
      path: "src/auth/session.ts",
      fragile: true,
      tier: "ASSERTED",
      evidence: [],
      coChangePartners: ["src/lib/format.ts"],
      changesetPaths: ["src/auth/session.ts"],
      repositoryRoot: REPO_ROOT,
    });
    expect(result.action).toBe("warn");
  });

  it("reports none for files with no recorded history", () => {
    const result = decideEnforcement({
      path: "src/lib/does-not-exist.ts",
      fragile: false,
      tier: null,
      evidence: [],
      coChangePartners: [],
      changesetPaths: ["src/lib/does-not-exist.ts"],
      repositoryRoot: REPO_ROOT,
    });
    expect(result.action).toBe("none");
    expect(result.message).toContain("not evidence of safety");
  });
});

describe("aggregateAction", () => {
  it("returns the most severe action across assessments", () => {
    expect(aggregateAction([])).toBe("none");
    expect(
      aggregateAction([
        { action: "warn" } as unknown as FileRiskAssessment,
        { action: "none" } as unknown as FileRiskAssessment,
      ]),
    ).toBe("warn");
    expect(
      aggregateAction([
        { action: "warn" } as unknown as FileRiskAssessment,
        { action: "deny" } as unknown as FileRiskAssessment,
      ]),
    ).toBe("deny");
    expect(
      aggregateAction([
        { action: "annotate" } as unknown as FileRiskAssessment,
        { action: "none" } as unknown as FileRiskAssessment,
      ]),
    ).toBe("annotate");
  });
});
