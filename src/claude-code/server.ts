#!/usr/bin/env node
/**
 * Claude Code review-evidence adapter — MCP surface (META-363 / M2B).
 *
 * ONE optional read-only tool. The host owns the review workflow entirely: it
 * decides whether to call this tool, what to do with what comes back, whether
 * to open any file named here, and what the review concludes. This server
 * offers descriptive repository evidence and nothing else — no verdict, no
 * action, no severity, no score, no recommendation. Deliberately absent from
 * this file: the `deny`/`warn`/`annotate` enforcement vocabulary the Codex
 * adapter emits, which would be the adapter telling the host what to decide.
 *
 * The host's own file-reading tools are what make a claim consequential. This
 * server never asserts that a partner file is affected; it reports that two
 * files have a recorded history of changing together, and leaves inspection to
 * the host.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { CHARACTER_LIMIT } from "../constants.js";
import { WorkspaceNotFoundError } from "../types.js";
import { type EvidenceResult, WorkspaceUnreadableError, retrieveEvidence } from "./artifact.js";

export const VERSION = "0.1.0";

/** Cap on how many changed files one call may ask about, to bound the response. */
const MAX_CHANGED_FILES = 50;

export const SERVER_INSTRUCTIONS = [
  "This server reports DESCRIPTIVE repository history for files under review, read from a workspace.json artifact produced by @workspacejson/cli.",
  "When reviewing a change, you may call workspace_review_evidence with the changed file paths to learn which other files have historically changed in the same commits.",
  "Co-change is a symmetric historical observation, not a dependency, a cause, a required change, a blast radius, a recommendation, or a risk score. A partner file is at most a candidate worth looking at.",
  "Nothing here is a finding. If a partner file matters to this change, open it with your own tools and verify that for yourself; cite what you read, not this evidence.",
  "Absent, unindexed, stale, or unreadable evidence means the history is unavailable. It never means the change is safe.",
].join(" ");

type ToolResult = {
  content: Array<{ type: "text"; text: string }>;
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
};

function truncate(text: string): string {
  if (text.length <= CHARACTER_LIMIT) return text;
  const suffix = `\n\n[truncated: response exceeded ${CHARACTER_LIMIT} characters. Ask about fewer files.]`;
  return `${text.slice(0, CHARACTER_LIMIT - suffix.length)}${suffix}`;
}

const ABSENCE_TEXT: Record<string, string> = {
  "no-recorded-co-change":
    "no co-change partners recorded for this file at the artifact's basis revision. " +
    "This is an absence of recorded history, not a statement about this change.",
  "file-not-indexed":
    "this path is not present in the artifact's file index (it may be new, moved, or outside the indexed root), " +
    "so no history is available for it. This is an absence of evidence, not a statement about this change.",
};

/**
 * Render evidence for the host.
 *
 * Provenance is stated before the observations, not after: a reader who stops
 * early must still know which revision the evidence is bound to and whether it
 * has drifted.
 */
export function renderEvidence(result: EvidenceResult): string {
  const p = result.provenance;
  const lines: string[] = [
    "workspace.json repository evidence (descriptive history, not review instructions)",
    "",
    `Artifact:        ${p.sourcePath}`,
    `Producer:        ${p.producer ?? "not recorded"}`,
    `Spec version:    ${p.specVersion ?? "not recorded"}`,
    `Generated at:    ${p.generatedAt ?? "not recorded"}`,
    `Basis revision:  ${p.basisRevision ?? "not recorded"}`,
    `Repo revision:   ${p.currentRevision ?? "could not be read"}`,
    `Freshness:       ${p.freshness.toUpperCase()} — ${p.freshnessNote}`,
    "",
  ];

  for (const file of result.files) {
    lines.push(`Changed file: ${file.file}`);
    if (file.partners.length === 0) {
      lines.push(`  ${ABSENCE_TEXT[file.absence ?? "no-recorded-co-change"]}`);
      lines.push("");
      continue;
    }
    lines.push(`  Files that historically changed in the same commits (${file.partners.length}):`);
    for (const partner of file.partners) {
      const counts =
        partner.support === null || partner.occurrences === null
          ? "counts not recorded"
          : `support=${partner.support}, occurrences=${partner.occurrences}`;
      lines.push(`    ${partner.partner} — ${counts}`);
      lines.push(`      ${partner.observation}`);
    }
    lines.push("");
  }

  lines.push(
    "These are historical observations only. They do not establish that any file above must change, " +
      "is affected, or is at risk. To make a claim about any of them, open the file yourself and verify it.",
  );
  return lines.join("\n");
}

export function registerReviewEvidenceTool(server: McpServer): void {
  server.registerTool(
    "workspace_review_evidence",
    {
      title: "workspace.json review evidence",
      description:
        "Given the files changed by a diff, return revision-bound descriptive repository history for them: " +
        "which other files have historically changed in the same commits, with the support/occurrence counts " +
        "recorded by @workspacejson/cli. Read-only, local, and optional. Returns observations, never findings, " +
        "verdicts, severities, or recommendations — a named partner file is a candidate to inspect yourself, " +
        "nothing more. Missing, unindexed, stale, or unreadable evidence is reported as such and never means safe.",
      inputSchema: {
        changedFiles: z
          .array(z.string().min(1))
          .min(1)
          .max(MAX_CHANGED_FILES)
          .describe(
            "Paths of the files changed by the diff under review. Repository-root-relative POSIX paths, " +
              "or absolute paths inside the repository.",
          ),
      },
    },
    async ({ changedFiles }): Promise<ToolResult> => {
      try {
        const result = await retrieveEvidence(changedFiles);
        return {
          content: [{ type: "text", text: truncate(renderEvidence(result)) }],
          structuredContent: {
            provenance: { ...result.provenance },
            files: result.files.map((f) => ({ ...f, partners: f.partners.map((p) => ({ ...p })) })),
            // Stated in the payload, not only in prose, so a host that reads
            // only structuredContent still cannot mistake this for a claim.
            evidenceKind: "historical-co-change",
            evidenceIsNot: [
              "dependency",
              "causality",
              "required-change",
              "blast-radius",
              "recommendation",
              "risk-score",
            ],
          },
        };
      } catch (err) {
        // Every failure path below returns uncertainty. None returns silence,
        // and none returns an assessment of the change.
        if (err instanceof WorkspaceNotFoundError) {
          return {
            content: [
              {
                type: "text",
                text: `No workspace.json artifact was found, so no repository history is available for this review.\n\n${err.message}\n\nThis is an absence of evidence, not an absence of risk. Review the change on its own terms.`,
              },
            ],
            structuredContent: { status: "no-artifact", detail: err.message },
            isError: true,
          };
        }
        if (err instanceof WorkspaceUnreadableError) {
          return {
            content: [{ type: "text", text: err.message }],
            structuredContent: { status: "unreadable", detail: err.message },
            isError: true,
          };
        }
        const detail = err instanceof Error ? err.message : String(err);
        return {
          content: [
            {
              type: "text",
              text: `Repository history could not be retrieved: ${detail}. No evidence is available for this review. This is an absence of evidence, not an absence of risk.`,
            },
          ],
          structuredContent: { status: "error", detail },
          isError: true,
        };
      }
    },
  );
}

export function buildServer(): McpServer {
  const server = new McpServer(
    { name: "workspacejson-review-evidence", version: VERSION },
    { instructions: SERVER_INSTRUCTIONS },
  );
  registerReviewEvidenceTool(server);
  return server;
}

function printHelp(): void {
  process.stdout.write(
    [
      `workspacejson-review-evidence v${VERSION}`,
      "",
      "MCP server exposing descriptive workspace.json repository history to Claude Code's review workflow.",
      "",
      "Transport: stdio (spawned by the host).",
      "",
      "Environment:",
      "  WORKSPACE_JSON_PATH   Explicit path to a workspace.json file.",
      "  WORKSPACE_JSON_ROOT   Root dir to search (default: cwd).",
      "",
      "Install:",
      "  claude mcp add workspacejson-review-evidence -- node <path>/dist/claude-code/server.js",
      "",
      "Remove:",
      "  claude mcp remove workspacejson-review-evidence",
      "",
    ].join("\n"),
  );
}

async function main(): Promise<void> {
  if (process.argv.includes("--help") || process.argv.includes("-h")) {
    printHelp();
    return;
  }
  const server = buildServer();
  await server.connect(new StdioServerTransport());
  console.error(`workspacejson-review-evidence v${VERSION} ready on stdio`);
}

// Only self-start when executed directly; importing this module for tests must
// not open a transport.
if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error("Fatal:", error instanceof Error ? error.stack : error);
    process.exit(1);
  });
}
