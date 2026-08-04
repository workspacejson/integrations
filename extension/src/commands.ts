import * as vscode from "vscode";
import { COMMAND_IDS, WALKTHROUGH_ID } from "./commandIds.js";
import { CHANGESET_TREE_VIEW_ID } from "./changesetTreeProvider.js";
import type { IntelligenceView } from "./semanticModel.js";
import type { WorkspaceIntelligenceModel } from "./workspaceIntelligence.js";

const ARTIFACT_PATH = ".agents/workspace.json";
const REVIEW_TERMINAL = "workspace.json review";
const VERIFY_TERMINAL = "workspace.json verify";
const GENERATE_TERMINAL = "workspace.json generate";

function firstFolder(): vscode.WorkspaceFolder | undefined {
  return vscode.workspace.workspaceFolders?.[0];
}

function viewOf(model: WorkspaceIntelligenceModel): IntelligenceView | undefined {
  const folder = firstFolder();
  return folder ? model.getView(folder) : undefined;
}

/** Reuse a named terminal if it is still open, otherwise create it. */
function terminal(name: string): vscode.Terminal {
  return vscode.window.terminals.find((t) => t.name === name) ?? vscode.window.createTerminal(name);
}

/**
 * Command-palette actions (§4.6, Tier A #8). Every command is keyboard- and
 * palette-reachable and works with the Tree View collapsed. The extension is a
 * read-only intelligence surface: `Run verification` / `Run advisory review`
 * pre-fill the documented command in a terminal WITHOUT executing it (§6.1 —
 * never block the host on reviewer execution; §7 — no implicit command
 * execution), leaving the developer in control of running it.
 */
export function registerCommands(model: WorkspaceIntelligenceModel, context: vscode.ExtensionContext): void {
  // languageId "yaml" (built into VS Code, no dependency) colors the existing
  // `key: value` evidence lines for free — not LogOutputChannel, which would
  // prepend a timestamp to every line and imply a live log this isn't (§6.3).
  const channel = vscode.window.createOutputChannel("workspace.json", "yaml");
  context.subscriptions.push(channel);

  const register = (id: string, handler: (...args: unknown[]) => void | Promise<void>) =>
    context.subscriptions.push(vscode.commands.registerCommand(id, handler));

  register(COMMAND_IDS.focusCurrentChange, async () => {
    await vscode.commands.executeCommand(`${CHANGESET_TREE_VIEW_ID}.focus`);
  });

  register(COMMAND_IDS.openWalkthrough, async () => {
    await vscode.commands.executeCommand("workbench.action.openWalkthrough", WALKTHROUGH_ID, false);
  });

  register(COMMAND_IDS.openFile, async (arg?: unknown) => {
    const uri = arg instanceof vscode.Uri ? arg : undefined;
    if (uri) await vscode.commands.executeCommand("vscode.open", uri);
  });

  register(COMMAND_IDS.openIntelligenceFile, async () => {
    const folder = firstFolder();
    if (!folder) return;
    const uri = vscode.Uri.joinPath(folder.uri, ARTIFACT_PATH);
    try {
      await vscode.window.showTextDocument(uri);
    } catch {
      // Same next step the welcome states already offer (§4.2) — this command is
      // reachable outside the tree view (Command Palette), so it shouldn't be the
      // one dead end that doesn't point back to Getting Started.
      const choice = await vscode.window.showWarningMessage(
        "workspace.json: .agents/workspace.json was not found in this workspace.",
        "Getting Started",
      );
      if (choice === "Getting Started") await vscode.commands.executeCommand(COMMAND_IDS.openWalkthrough);
    }
  });

  register(COMMAND_IDS.inspectEvidence, () => {
    const view = viewOf(model);
    channel.clear();
    if (!view) {
      channel.appendLine("No workspace folder is open.");
    } else if (view.source.availability !== "AVAILABLE") {
      channel.appendLine(`Evidence unavailable — source is ${view.source.availability}.`);
      if (view.source.error) channel.appendLine(view.source.error);
    } else if (!view.currentChange.changesetKnown) {
      channel.appendLine("Current-change assessment unavailable (Git state unknown).");
    } else {
      channel.appendLine(`Decision: ${view.currentChange.decision}`);
      channel.appendLine(`Changed paths: ${view.currentChange.changedPaths.length}`);
      channel.appendLine("");
      if (view.currentChange.files.length === 0) {
        channel.appendLine("No recorded partner omissions in the current change.");
      }
      for (const file of view.currentChange.files) {
        channel.appendLine(`${file.path} · tier ${file.file.tier}`);
        if (file.file.reason) channel.appendLine(`  reason: ${file.file.reason}`);
        for (const claim of file.file.evidenceClaims) channel.appendLine(`  evidence: ${claim}`);
        for (const partner of file.missingPartners) channel.appendLine(`  omitted partner: ${partner}`);
        channel.appendLine("");
      }
    }
    channel.show(true);
  });

  register(COMMAND_IDS.runVerification, () => {
    const term = terminal(VERIFY_TERMINAL);
    // Pre-fill only — the developer runs it. Not auto-executed.
    term.sendText("npm run verify", false);
    term.show();
    void vscode.window.showInformationMessage(
      "workspace.json: verification command staged in the terminal. Review it, then press Enter to run.",
    );
  });

  register(COMMAND_IDS.runReview, () => {
    const term = terminal(REVIEW_TERMINAL);
    term.sendText("git diff | npx @workspacejson/codex-mcp review --diff-stdin", false);
    term.show();
    void vscode.window.showInformationMessage(
      "workspace.json: advisory review command staged in the terminal (requires OPENAI_API_KEY or OPENROUTER_API_KEY). Review it, then press Enter to run.",
    );
  });

  register(COMMAND_IDS.generateIntelligence, () => {
    const term = terminal(GENERATE_TERMINAL);
    // Pre-fill only — the developer runs it. Not auto-executed.
    // The extension is a pure consumer: it types a command, the user presses
    // enter, and the neutral producer runs. The extension writes nothing to
    // the working tree.
    term.sendText("npx @workspacejson/cli generate .", false);
    term.show();
    void vscode.window.showInformationMessage(
      "workspace.json: generate command staged in the terminal. Review it, then press Enter to run. generate writes a repository file index and framework manifest; manual fragility and co-change evidence stay human-authored.",
    );
  });

  register(COMMAND_IDS.inspectReceipt, async () => {
    const view = viewOf(model);
    const dir = view?.review.artifactDir;
    if (!dir) {
      // HAC-108: what happened + the exact next step, as an action not prose.
      const run = "Run Advisory Review";
      const choice = await vscode.window.showInformationMessage(
        "workspace.json: no reviewer receipt for the current change. Run an advisory review to produce one.",
        run,
      );
      if (choice === run) await vscode.commands.executeCommand(COMMAND_IDS.runReview);
      return;
    }
    const receipt = vscode.Uri.joinPath(vscode.Uri.file(dir), "receipt.json");
    try {
      await vscode.window.showTextDocument(receipt);
    } catch {
      void vscode.window.showWarningMessage(
        `workspace.json: the reviewer receipt could not be opened at ${dir}. It may have been moved or removed.`,
      );
    }
  });
}
