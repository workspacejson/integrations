# Frozen identity catalog (META-257 scope)

Catalog of all identities that reference the old source repository (`workspace-json/codex-mcp`) or are bound to the frozen org. These are marketplace, package, and distribution identities that are hard to change after users have installed. Per the META-241 first-land rule, these are cataloged but not changed in this phase.

## Why this catalog exists

Publisher IDs, package names, extension IDs, and repository URLs are among the harder things to change after users have installed or depend on them. This catalog records what exists today so META-257 can make informed decisions about what to update, what to freeze, and what to deprecate.

The extension publisher ID (`workspace-json`) is a marketplace distribution identity bound to the frozen org. It is **not** a congruent item — it belongs in this target-state catalog alongside the URL references.

## Full catalog

### Package identity

| File | Field | Value | Notes |
| -- | -- | -- | -- |
| `package.json` | `name` | `@workspacejson/codex-mcp` | npm package name; frozen |
| `package.json` | `repository.url` | `git+https://github.com/workspace-json/codex-mcp.git` | Old source repo URL; needs update to `workspacejson/integrations` |
| `package.json` | `bugs.url` | `https://github.com/workspace-json/codex-mcp/issues` | Old source repo URL; needs update |
| `package.json` | `homepage` | `https://workspacejson.dev/implementations/codex` | Correct; not old repo |

### Codex plugin identity

| File | Field | Value | Notes |
| -- | -- | -- | -- |
| `.codex-plugin/plugin.json` | `repository` / URL fields | References `workspace-json/codex-mcp` | Old source repo URL; needs update |

### Extension identity

| File | Field | Value | Notes |
| -- | -- | -- | -- |
| `extension/package.json` | `publisher` | `workspace-json` | **Marketplace publisher ID — frozen, hard to change post-install** |
| `extension/package.json` | `name` | `workspacejson-codex-decorations` | Extension ID; frozen |
| `extension/package.json` | `repository.url` | References `workspace-json/codex-mcp` | Old source repo URL; needs update |
| `extension/README.md` | URL references | `workspace-json/codex-mcp` | Old source repo URL; needs update |
| `extension/SUPPORT.md` | URL references | `workspace-json/codex-mcp` | Old source repo URL; needs update |

### Documentation references

| File | References | Notes |
| -- | -- | -- |
| `README.md` | `workspace-json/codex-mcp` | Old source repo URL; needs update |
| `CHANGELOG.md` | `workspace-json/codex-mcp` | Old source repo URL; needs update |
| `docs/operational-guarantees.md` | `workspace-json/codex-mcp` | Old source repo URL; needs update |

### Provenance references (may stay)

| File | References | Notes |
| -- | -- | -- |
| `docs/migration/source-manifest.json` | `workspace-json/codex-mcp` | Provenance record; references the frozen source SHA. May stay as historical record. |
| `scripts/migration/verify-clone-parity.mjs` | `workspace-json/codex-mcp` | Parity verifier; references the source repo for clone comparison. May stay. |

### Audit references

| File | References | Notes |
| -- | -- | -- |
| `docs/audits/worktree-reconciliation/2026-07-22/remediation-results.md` | `workspace-json/codex-mcp` (7 matches) | Historical audit; may stay as record |
| `docs/audits/worktree-reconciliation/2026-07-22/repository-reconciliation-report.md` | `workspace-json/codex-mcp` (2 matches) | Historical audit; may stay as record |
| `docs/audits/worktree-reconciliation/2026-07-22/repository-reconciliation.json` | `workspace-json/codex-mcp` (1 match) | Historical audit; may stay as record |

## Classification

| Category | Action | Count |
| -- | -- | -- |
| **Frozen marketplace identities** | Do not change — users have installed under these | 2 (publisher ID, extension ID) |
| **Old repo URLs — active files** | Update to `workspacejson/integrations` in META-257 | 8 files |
| **Old repo URLs — provenance/audit** | May stay as historical record | 4 files |

## Relationship to conformance taxonomy

This catalog is input to META-257's taxonomy half (conformance vocabulary). The frozen marketplace identities are first-party adapter artifacts, not standard artifacts. The old repo URLs are documentation references that should be updated when META-257 boundaries are ratified, but they do not affect standard conformance — an external consumer reads the published spec, not the repository URL in `package.json`.
