<br />

<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="assets/workspace-json-codex-lockup-dark.png">
    <source media="(prefers-color-scheme: light)" srcset="assets/workspace-json-codex-lockup-light.png">
    <img alt="workspace.json / Codex" src="assets/workspace-json-codex-lockup-dark.png" width="620">
  </picture>
</p>

<br />

<p align="center"><strong>The Codex adapter for workspace.json — repository evidence that helps Codex plan around recorded risky changes.</strong></p>

<p align="center"><code>@workspacejson/codex-mcp</code></p>

<p align="center">
  <a href="https://github.com/workspacejson/integrations/actions/workflows/ci.yml"><img alt="CI" src="https://github.com/workspacejson/integrations/actions/workflows/ci.yml/badge.svg"></a>
  <img alt="Node 20+" src="https://img.shields.io/badge/node-20%2B-339933?logo=node.js&logoColor=white">
  <img alt="Apache-2.0" src="https://img.shields.io/badge/license-Apache--2.0-blue">
</p>

---

## Where this fits

`workspace.json` is a host-neutral open standard. The artifact is a committed file at `.agents/workspace.json`, and nothing in the format is specific to any editor, agent or vendor — any consumer can read it.

This repository holds **host adapters** for that standard. Codex is the adapter that exists today: the MCP server, the deterministic pre-edit hook, and an optional VS Code surface, published together as `@workspacejson/codex-mcp`. Further adapters can be added alongside it without the format changing, because the format does not know about any of them.

| Layer | Owned by |
| --- | --- |
| Format, schema, validation semantics | [`workspacejson/standard`](https://github.com/workspacejson/standard) |
| Artifact generation | [`workspacejson/cli`](https://github.com/workspacejson/cli) |
| Host adapters — this repository | [`workspacejson/integrations`](https://github.com/workspacejson/integrations) |

Everything below describes the Codex adapter specifically. Reading it as *the* way to consume `workspace.json` would invert the topology: the committed artifact is the interoperability point, and an integration does not become the standard.

## See it in 30 seconds

| | |
| --- | --- |
| Task | Update the checkout route |
| Recorded evidence | The route and its webhook partner share a repeated co-change history, including a rounding change and its later revert—not an import. |
| An incomplete patch | The hook denies it, citing the specific evidence and the omitted partner |
| Outcome | The incomplete patch does not land; Codex receives the evidence and must account for the recorded partner before retrying. |

## Installation

```bash
npx @workspacejson/codex-mcp install --with-hook
```

That gives you MCP context **plus** the deterministic pre-edit hook — the enforcement shown in the 30-second demo above. It's idempotent, scoped to this repo's `.codex/` directory, and never touches `~/.codex`. Restart Codex, then run `/mcp` to confirm `workspacejson` is connected.

**Add surfaces as you want them.** Each flag is additive and asks for exactly the consent it needs — nothing is installed silently:

| Command | Adds | Touches |
| --- | --- | --- |
| `install` | MCP context (read tools) + optional GPT-5.6 reviewer | this repo's `.codex/` |
| `install --with-hook` | + deterministic pre-edit hook | this repo's `.codex/` |
| `install --with-extension` | + VS Code editor surface | your global VS Code (explicit consent) |
| `install --full` | the hook **and** the extension | both |

**Uninstall** mirrors that consent. `npx @workspacejson/codex-mcp uninstall` removes only what this repo owns — the MCP block, hook, and runtime — and **leaves your global VS Code extension in place**. To remove the editor extension too, ask for it explicitly: `npx @workspacejson/codex-mcp uninstall --with-extension`.

<details>
<summary>MCP-only setup, CI check, the VS Code surface, and manual verification</summary>

### Wire the MCP server yourself

Add this to `.codex/config.toml` (project) or `~/.codex/config.toml` (global):

```toml
[mcp_servers.workspacejson]
command = "npx"
args = ["-y", "@workspacejson/codex-mcp", "server"]
# Optional: point at a specific file or search root.
# env = { WORKSPACE_JSON_PATH = "/abs/path/.agents/workspace.json" }
```

Without the hook you still get the read tools, but not deterministic enforcement.

### CI / repo-native check — no editor required

```bash
# After `install --with-hook` (the installed path, works in any repo):
git diff --name-only | node .codex/workspacejson-codex-mcp/hooks/pre-edit-check.mjs --paths-stdin

# From a checkout of this repo (the source path):
git diff --name-only | node hooks/pre-edit-check.mjs --paths-stdin
```

Exit code 2 means a fragile change is missing a co-change partner; the reason prints with its evidence. Drop it into a GitHub Action to gate pull requests the same way the hook gates edits.

### VS Code editor surface (optional)

Let the installer handle the `code` CLI, idempotency, and the reload prompt for you:

```bash
npx @workspacejson/codex-mcp install --with-extension
```

This installs the `workspace-json.workspacejson-codex-decorations` extension: Explorer decorations on fragile files, a **current-change** view, a synchronized status item, and saved review receipts. The decorations, current-change view, status item, and saved review receipts read local workspace data with no telemetry. Running a new advisory review is a separate explicit action that sends only the supplied diff to the configured provider.

The installer targets **VS Code Stable** only. If the `code` CLI isn't on your PATH it reports `UNAVAILABLE` with a one-line fix and leaves your MCP/hook install untouched — it never silently targets Insiders, Cursor, a remote, or a container. To aim it at a different editor's CLI deliberately, set `WORKSPACEJSON_CODE_CLI` (e.g. `cursor`) and rerun.

Building from a checkout of this repo? Produce the VSIX first, then install:

```bash
npm run build:extension
npx @workspacejson/codex-mcp install --with-extension
```

Prefer to install a pinned VSIX by hand (offline, or a release artifact)?

```bash
code --install-extension workspacejson-codex-decorations-<version>.vsix
```

Demo and fixture repos may recommend the exact extension ID through `.vscode/extensions.json`; that's discovery only and never installs anything on its own.

### Generate workspace.json

The MCP server and hook consume `.agents/workspace.json`. The producer is [`@workspacejson/cli`](https://github.com/workspacejson/cli), the neutral generator owned by the standard's CLI repository:

```bash
npx @workspacejson/cli generate .
```

This writes `.agents/workspace.json` with a repository file index and detected framework manifest. `manual` fragility/co-change evidence is not auto-generated — it remains human-authored (ASSERTED tier at minimum, OBSERVED when backed by evidence records). The generator does not guess risk signals; guessed churn has no evidence records, remains ASSERTED, and cannot block. See [`fixture/`](fixture/) for a worked example with manual evidence.

> **`agents-audit` is the historical command.** It is a frozen compatibility bridge that delegates generation to `@workspacejson/cli`, retained so existing setups keep working. Use it only if you are pinned to it; new installs should use the neutral producer above.

### Local proof path — two recorded partners

`generate` (above) writes machine-derived repository inventory only — no fragility or co-change evidence, so a freshly generated `workspace.json` has nothing to deny yet. To see the deny path itself, use this repo's `fixture/`, whose `manual` evidence is hand-authored for exactly this demo:

1. Open `fixture/` in Codex. In Codex, ask it to edit `src/routes/checkout.ts`.
2. Watch the hook refuse the patch, citing the recorded evidence and the co-change partners the change left out.
3. Ask Codex to include both partners and retry — the edit proceeds.

No configuration beyond step 1 above. On your own repo, the same deny path activates once you've authored `manual.fragileFiles` / `manual.coChangePatterns` yourself — see [`docs/workspace-contract.md`](docs/workspace-contract.md).

### Provider-demo proof path — Billfold's one recorded partner

The judge-facing demo runs against [`workspace-json/billfold`](https://github.com/workspace-json/billfold), a small public payments service. It is still hosted under the superseded `workspace-json` org, which is why its URL differs from the canonical namespace; the link is current and correct. This is a separate proof path from this repository's local `fixture/`: Billfold uses the single recorded pairing shown on camera, `src/routes/checkout.ts` and `src/webhooks/stripe.ts`; the local walkthrough above uses `src/auth/session.ts` and `src/lib/format.ts`.

```bash
git clone https://github.com/workspace-json/billfold.git
cd billfold
git checkout 5e97f1dc9e6a41eb80d2d6eb80d5ef703cbe1cde  # main as of 2026-07-20; no tag covers this pairing yet
npm install
npx @workspacejson/codex-mcp install --with-hook
```

1. Open `billfold` in Codex. Ask it to change the idempotency-key format in `src/routes/checkout.ts`.
2. The hook denies the patch, citing the recorded revert/incident and the omitted partner, `src/webhooks/stripe.ts`.
3. Ask Codex to include `src/webhooks/stripe.ts` and retry — the patch proceeds. That clears the recorded-partner check; it is not a correctness verdict on the change (see [Current limitations](#current-limitations)).

This pins to the commit above because `billfold`'s `main` is mutable and the two existing tags (`fixture-v1`, `fixture-v2`) predate this pairing — clone and stay on `main` instead if you want the current state.

</details>

## How it works

MCP supplies context. A deterministic hook enforces evidenced omissions. An optional, direct read-only GPT-5.6 API review challenges a supplied completed diff and preserves its request/response receipt locally. The reviewer never controls the hook, and a `PASS` verdict is not a safety certification.

```bash
git diff | npx @workspacejson/codex-mcp review --diff-stdin
```

Requires `OPENAI_API_KEY` (or `OPENROUTER_API_KEY`) in the environment. Without one, it reports `UNAVAILABLE` and deterministic enforcement is unaffected.

Full derivation rules for evidence tiers (`ASSERTED`/`OBSERVED`/`VERIFIED`), the hook's fail-open behavior, and the GPT-5.6 reviewer's scope live in [`docs/how-it-works.md`](docs/how-it-works.md).

## Operational guarantees

- Missing evidence never becomes a safety approval.
- Malformed evidence never crashes the edit loop.
- Reviewer output never controls deterministic enforcement.
- Installation never overwrites unmanaged configuration.
- Uninstall removes only owned artifacts.
- The editor extension installs only with explicit `--with-extension` consent.
- Every `VERIFIED` claim maps to a reproducible command.

Each is checkable, not asserted: run `npm run verify` from a clean clone to reproduce the gate this repository's own CI runs, or read the source citations in [`docs/operational-guarantees.md`](docs/operational-guarantees.md). See [`docs/failure-modes.md`](docs/failure-modes.md) for the behavior behind each guarantee under missing, malformed, or unavailable input.

## Trust boundary

**Local, no network:** the MCP server, the deterministic hook, and the VS Code extension run over stdio and the local filesystem only. None of them upload repository contents or make network calls.

**Network, by explicit action only:** `npx` package installation contacts npm. The optional `review` command sends only the diff you explicitly supply to a configured API provider: OpenAI (`OPENAI_API_KEY`) or OpenRouter (`OPENROUTER_API_KEY`). When both keys exist, set `WORKSPACEJSON_REVIEWER_PROVIDER` to `openai` or `openrouter`; an explicit `WORKSPACEJSON_REVIEWER_BASE_URL` also selects OpenRouter. It uses `store: false` with OpenAI and preserves a local request/response receipt that identifies the provider and model. Do not supply diffs containing secrets.

## Current limitations

- Enforcement currently covers Codex `apply_patch`.
- Other edit mechanisms may receive context without deterministic blocking.
- Missing or malformed `workspace.json` fails open with an explicit unavailable warning.
- Stale evidence is not treated as proof of current risk.
- `fragile:false` means the file has no recorded fragility, not that it is verified safe.
- Including a recorded partner's path clears the omission check; it confirms path coverage, not that the partner's content is correct or sufficient.
- This does not replace tests, review, or repository instructions.

## Learn more

- [How it works](docs/how-it-works.md) — evidence tiers, hook enforcement, GPT-5.6 reviewer
- [Operational guarantees](docs/operational-guarantees.md) — the seven promises above, with source citations
- [Failure modes](docs/failure-modes.md) — behavior under missing, malformed, or unavailable input
- [Tools](docs/tools.md) — full MCP tool reference (`workspace_get_file_context`, `workspace_get_cochange_partners`, `workspace_list_fragile_files`, `workspace_assess_change`)
- [The workspace.json contract](docs/workspace-contract.md) — fields consumed and normalization
- [Verification](docs/verification.md) — what's been verified and how
- [Build Week disclosure](docs/submission/build-week.md) — what was authored in-window
- [Development](docs/development.md) — build, test, and smoke-suite commands
- [Clean-install audit](docs/clean-install-audit.md) · [Fixture verification](docs/fixture-verification.md) · [`billfold`](https://github.com/workspace-json/billfold) — the public repo behind the demo video

## Repository and authority

Development, issues, and CI for this package live in [`workspacejson/integrations`](https://github.com/workspacejson/integrations). The package was originally published from `workspace-json/codex-mcp`, which is retained as a historical publication source only.

This repository is a **consumer** of the standard, not an author of it. The normative schema, types, and validation semantics are owned by [`workspacejson/standard`](https://github.com/workspacejson/standard); artifact generation is owned by [`workspacejson/cli`](https://github.com/workspacejson/cli). Behavior here is driven by exactly four demonstrated stable read paths — `manual.fragileFiles`, `manual.coChangePatterns`, `generated.fileIndex`, `generated.frameworkManifest`. Other fields present in an artifact are tolerated for compatibility and deliberately do not affect results; tolerance is not an extension of the normative schema. See [`docs/workspace-contract.md`](docs/workspace-contract.md).

## Project history

This package began as an OpenAI Build Week submission, finalized **July 21, 2026**. The submitted state is preserved at tag `codex-mcp-v0.1.9` (also `build-week-2026-submission`), commit `7d42a61af78a383219c536cc49220f154a93a2bf`:

```bash
git checkout codex-mcp-v0.1.9
```

Commits after the deadline and before the migration were limited to repository maintenance and audit documentation under `docs/audits/` — `6eeb49f`, `7ca4c19`, `7882883`, `e188225` — touching no source, tests, dependencies, or packaging. Full in-window disclosure: [`docs/submission/build-week.md`](docs/submission/build-week.md).

That snapshot is history, not the current shape of the project. Everything above this section describes the durable integration.

## License

Apache-2.0
