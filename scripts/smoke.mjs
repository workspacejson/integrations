import { spawnSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
const fixtureRoot = resolve(root, "fixture");

let failures = 0;
function check(name, cond, detail) {
  const ok = Boolean(cond);
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${!ok && detail ? `  ->  ${detail}` : ""}`);
}

const transport = new StdioClientTransport({
  command: "node",
  args: [resolve(root, "dist/index.js")],
  env: { ...process.env, WORKSPACE_JSON_ROOT: fixtureRoot },
});
const client = new Client({ name: "smoke", version: "0.0.0" });
await client.connect(transport);

// ── Protocol surface ──
const instr = client.getInstructions();
check("initialize exposes server instructions", instr?.includes("FRAGILE"));

const { tools } = await client.listTools();
const names = tools.map((t) => t.name).sort();
check(
  "tools/list returns the 4 expected tools",
  JSON.stringify(names) ===
    JSON.stringify([
      "workspace_assess_change",
      "workspace_get_cochange_partners",
      "workspace_get_file_context",
      "workspace_list_fragile_files",
    ]),
  names.join(","),
);
const assessTool = tools.find((tool) => tool.name === "workspace_assess_change");
check(
  "assessment tool describes the bounded human-review path",
  assessTool?.description?.includes(
    "Include the recorded co-change partners, or stop and review the exception with a human.",
  ),
  assessTool?.description,
);

// ── Tier derivation through file context ──
const r1 = await client.callTool({ name: "workspace_get_file_context", arguments: { path: "src/routes/checkout.ts" } });
const s1 = r1.structuredContent;
check("evidenced fragile -> tier OBSERVED", s1?.fragility?.tier === "OBSERVED", JSON.stringify(s1?.fragility));
check(
  "evidence normalized to {claim} records",
  s1?.fragility?.evidence?.[0]?.claim?.includes("revert"),
  JSON.stringify(s1?.fragility?.evidence),
);
check("fragile file -> co-change partner session.ts", s1?.coChangePartners?.includes("src/auth/session.ts"));

// ── META-102 matching contract ──
const r3 = await client.callTool({
  name: "workspace_get_file_context",
  arguments: { path: "./src/routes/checkout.ts" },
});
check("leading ./ normalizes to exact key match", r3.structuredContent?.fragile === true);
// ADR-006 §8 / META-291. An absolute path is resolved against the PROVEN
// repository root and compared exactly — there is no suffix fallback. This also
// exercises repositoryRootFor end-to-end: the artifact lives at
// fixture/.agents/workspace.json, so a root derived with a plain dirname() would
// be `fixture/.agents`, one level short, and this in-root path would NOT match.
const r4 = await client.callTool({
  name: "workspace_get_file_context",
  arguments: { path: resolve(fixtureRoot, "src/routes/checkout.ts") },
});
check("absolute path inside the proven root resolves to the stored key", r4.structuredContent?.fragile === true);
const r4b = await client.callTool({
  name: "workspace_get_file_context",
  arguments: { path: "/abs/repo/src/routes/checkout.ts" },
});
check(
  "absolute path in an unrelated repository does NOT suffix-match",
  r4b.structuredContent?.fragile === false,
  JSON.stringify(r4b.structuredContent?.fragile),
);
const r5 = await client.callTool({ name: "workspace_get_file_context", arguments: { path: "routes/checkout.ts" } });
check(
  "bare partial relative path does NOT match (exact-first, no fuzzy)",
  r5.structuredContent?.fragile === false,
  JSON.stringify(r5.structuredContent?.path),
);

// ── Empty beats wrong ──
const r6 = await client.callTool({
  name: "workspace_get_file_context",
  arguments: { path: "src/lib/does-not-exist.ts" },
});
check(
  "unknown file -> fragile:false, empty partners",
  r6.structuredContent?.fragile === false && r6.structuredContent?.coChangePartners?.length === 0,
);
check(
  "unknown file guidance never says safe",
  /not evidence of safety/i.test(r6.structuredContent?.guidance ?? ""),
  r6.structuredContent?.guidance,
);

// ── Changeset assessment: the deny/warn/none matrix ──
const d1 = await client.callTool({ name: "workspace_assess_change", arguments: { paths: ["src/routes/checkout.ts"] } });
check(
  "evidenced fragile + missing partners -> DENY",
  d1.structuredContent?.action === "deny",
  JSON.stringify(d1.structuredContent?.action),
);
check(
  "deny message cites evidence",
  /revert d4e5f6/.test(d1.structuredContent?.assessments?.[0]?.message ?? ""),
  d1.structuredContent?.assessments?.[0]?.message,
);
check(
  "deny message names missing partners",
  /src\/auth\/session\.ts/.test(d1.structuredContent?.assessments?.[0]?.message ?? ""),
);
check(
  "deny message uses bounded human-review wording, not an approval bypass",
  /Include the recorded co-change partners, or stop and review the exception with a human\./.test(
    d1.structuredContent?.assessments?.[0]?.message ?? "",
  ) && !/get explicit human approval/i.test(d1.structuredContent?.assessments?.[0]?.message ?? ""),
  d1.structuredContent?.assessments?.[0]?.message,
);

const d2 = await client.callTool({
  name: "workspace_assess_change",
  arguments: { paths: ["src/routes/checkout.ts", "src/auth/session.ts", "src/lib/format.ts"] },
});
check(
  "partners covered -> downgrades to WARN",
  d2.structuredContent?.action === "warn",
  JSON.stringify(d2.structuredContent?.action),
);

const d3 = await client.callTool({ name: "workspace_assess_change", arguments: { paths: ["src/lib/new-file.ts"] } });
check("clean changeset -> action none, no approval language", d3.structuredContent?.action === "none");

// ── Audit Critical #1 regression: partial-path partners must NOT be credited ──
const dPartial = await client.callTool({
  name: "workspace_assess_change",
  arguments: { paths: ["src/routes/checkout.ts", "auth/session.ts", "lib/format.ts"] },
});
check(
  "partial-path partners NOT credited -> deny holds (was downgraded pre-fix)",
  dPartial.structuredContent?.action === "deny",
  JSON.stringify(dPartial.structuredContent?.action),
);
const dAbs = await client.callTool({
  name: "workspace_assess_change",
  arguments: {
    paths: [
      resolve(fixtureRoot, "src/routes/checkout.ts"),
      resolve(fixtureRoot, "src/auth/session.ts"),
      resolve(fixtureRoot, "src/lib/format.ts"),
    ],
  },
});
check(
  "absolute-path partners inside the proven root ARE credited -> warn",
  dAbs.structuredContent?.action === "warn",
  JSON.stringify(dAbs.structuredContent?.action),
);
// The other half of audit Critical #1: under the suffix fallback these paths
// from an UNRELATED checkout credited the partners and silently downgraded the
// deny to a warn. Coverage now requires containment in the proven root.
const dAbsOutside = await client.callTool({
  name: "workspace_assess_change",
  arguments: { paths: ["/x/repo/src/routes/checkout.ts", "/x/repo/src/auth/session.ts", "/x/repo/src/lib/format.ts"] },
});
check(
  "absolute-path partners OUTSIDE the root are NOT credited -> no false warn",
  dAbsOutside.structuredContent?.action === "none",
  JSON.stringify(dAbsOutside.structuredContent?.action),
);

// ── Audit #5: directly exercise the two tools smoke previously only registered ──
const cc = await client.callTool({
  name: "workspace_get_cochange_partners",
  arguments: { path: "src/routes/checkout.ts" },
});
check(
  "get_cochange_partners returns both partners directly",
  (cc.structuredContent?.partners ?? []).includes("src/auth/session.ts") &&
    (cc.structuredContent?.partners ?? []).includes("src/lib/format.ts"),
  JSON.stringify(cc.structuredContent?.partners),
);
const lf = await client.callTool({ name: "workspace_list_fragile_files", arguments: {} });
check(
  "list_fragile_files returns the checkout scenario",
  lf.structuredContent?.total === 1 && lf.structuredContent?.files?.[0]?.path === "src/routes/checkout.ts",
  JSON.stringify(lf.structuredContent?.files?.map((f) => f.path)),
);
check(
  // The fixture's generated section is the real agents-audit generate output: a fresh
  // scan with no observation history detects no frameworks (array frameworkManifest is
  // empty), which normalizes to no legacy manifest rather than a fabricated runtime/testRunner.
  "list_fragile_files reports no framework context when the producer detected none",
  lf.structuredContent?.framework === null,
  JSON.stringify(lf.structuredContent?.framework),
);

await client.close();

// ── HAC-131: both MCP channels stay bounded, including nested structures ──
const boundRoot = resolve(root, ".smoke-bound");
mkdirSync(resolve(boundRoot, ".agents"), { recursive: true });
writeFileSync(
  resolve(boundRoot, ".agents/workspace.json"),
  JSON.stringify({
    manual: {
      fragileFiles: [
        {
          path: "src/huge.ts",
          reason: "large evidence boundary",
          evidence: Array.from({ length: 400 }, (_, index) => ({
            claim: `claim-${index}-${"x".repeat(300)}`,
          })),
        },
        ...Array.from({ length: 299 }, (_, index) => ({
          path: `src/list-${index}.ts`,
          reason: "large list boundary ".repeat(8),
        })),
      ],
      coChangePatterns: [["src/huge.ts", ...Array.from({ length: 800 }, (_, index) => `src/partner-${index}.ts`)]],
    },
  }),
);
const boundTransport = new StdioClientTransport({
  command: "node",
  args: [resolve(root, "dist/index.js")],
  env: { ...process.env, WORKSPACE_JSON_ROOT: boundRoot },
});
const boundClient = new Client({ name: "smoke-bound", version: "0.0.0" });
await boundClient.connect(boundTransport);
const boundList = await boundClient.callTool({ name: "workspace_list_fragile_files", arguments: { limit: 500 } });
check(
  "structured list response is bounded and count remains honest",
  JSON.stringify(boundList.structuredContent).length <= 12_000 &&
    boundList.structuredContent?.truncated === true &&
    boundList.structuredContent?.total === 300 &&
    boundList.structuredContent?.count === boundList.structuredContent?.files?.length,
  `size=${JSON.stringify(boundList.structuredContent).length} count=${boundList.structuredContent?.count}`,
);
const boundContext = await boundClient.callTool({
  name: "workspace_get_file_context",
  arguments: { path: "src/huge.ts" },
});
check(
  "structured file context bounds nested evidence",
  JSON.stringify(boundContext.structuredContent).length <= 12_000 &&
    boundContext.structuredContent?.path === "src/huge.ts" &&
    boundContext.structuredContent?.fragile === true,
  `size=${JSON.stringify(boundContext.structuredContent).length}`,
);
const boundAssess = await boundClient.callTool({
  name: "workspace_assess_change",
  arguments: { paths: ["src/huge.ts"] },
});
check(
  "structured assessment preserves deny while bounding missing partners",
  JSON.stringify(boundAssess.structuredContent).length <= 12_000 &&
    boundAssess.structuredContent?.action === "deny" &&
    boundAssess.structuredContent?.assessments?.[0]?.action === "deny",
  `size=${JSON.stringify(boundAssess.structuredContent).length} action=${boundAssess.structuredContent?.action}`,
);
await boundClient.close();
rmSync(boundRoot, { recursive: true, force: true });

// ── Hook script, driven exactly as Codex would drive it ──
function runHook(stdinObj, extraEnv = {}) {
  return spawnSync("node", [resolve(root, "hooks/pre-edit-check.mjs")], {
    input: JSON.stringify(stdinObj),
    encoding: "utf8",
    env: { ...process.env, WORKSPACE_JSON_ROOT: fixtureRoot, ...extraEnv },
  });
}

const patchDeny = {
  tool_name: "apply_patch",
  tool_input: {
    command: "*** Begin Patch\n*** Update File: src/routes/checkout.ts\n@@\n-const a=1\n+const a=2\n*** End Patch",
  },
};
const h1 = runHook(patchDeny);
check("hook: fragile-without-partner patch exits 2", h1.status === 2, `status=${h1.status}`);
const h1out = (() => {
  try {
    return JSON.parse(h1.stdout);
  } catch {
    return null;
  }
})();
check("hook: emits permissionDecision deny JSON", h1out?.hookSpecificOutput?.permissionDecision === "deny", h1.stdout);
check(
  "hook: deny reason cites evidence",
  /revert d4e5f6/.test(h1out?.hookSpecificOutput?.permissionDecisionReason ?? ""),
);

const patchWarn = {
  tool_name: "apply_patch",
  tool_input: {
    command:
      "*** Begin Patch\n*** Update File: src/routes/checkout.ts\n*** Update File: src/auth/session.ts\n*** Update File: src/lib/format.ts\n*** End Patch",
  },
};
const h2 = runHook(patchWarn);
check(
  "hook: partners-covered patch exits 0 with additionalContext",
  h2.status === 0 && /additionalContext/.test(h2.stdout),
  `status=${h2.status} out=${h2.stdout.slice(0, 80)}`,
);

const patchClean = {
  tool_name: "apply_patch",
  tool_input: { command: "*** Begin Patch\n*** Add File: src/lib/brand-new.ts\n*** End Patch" },
};
const h3 = runHook(patchClean);
check(
  "hook: clean patch exits 0 silently (no approval emitted)",
  h3.status === 0 && h3.stdout.trim() === "",
  `out='${h3.stdout}'`,
);

const h4 = runHook({ garbage: true });
check(
  "hook: unparseable/pathless event warns but fails open",
  h4.status === 0 && /additionalContext/.test(h4.stdout) && /unavailable/i.test(h4.stdout),
  `status=${h4.status} out=${h4.stdout.slice(0, 120)}`,
);

const h5 = runHook(patchClean, { WJSON_DENY_ALL: "1" });
check("hook: WJSON_DENY_ALL wiring probe denies", h5.status === 2 && /deny/.test(h5.stdout));

// ── HAC-130: unavailable intelligence is explicit, never a silent allow ──
const unavailableRoot = resolve(root, ".smoke-unavailable");
mkdirSync(resolve(unavailableRoot, ".agents"), { recursive: true });
writeFileSync(resolve(unavailableRoot, ".agents/workspace.json"), "{not-json");
const corrupt = runHook(patchClean, { WORKSPACE_JSON_ROOT: unavailableRoot });
check(
  "hook: corrupt workspace.json warns and fails open",
  corrupt.status === 0 &&
    /additionalContext/.test(corrupt.stdout) &&
    /Failed to parse workspace\.json/.test(corrupt.stdout),
  `status=${corrupt.status} out=${corrupt.stdout.slice(0, 160)}`,
);
writeFileSync(resolve(unavailableRoot, ".agents/workspace.json"), "[]");
const invalidRoot = runHook(patchClean, { WORKSPACE_JSON_ROOT: unavailableRoot });
check(
  "hook: structurally invalid workspace.json warns and fails open",
  invalidRoot.status === 0 &&
    /additionalContext/.test(invalidRoot.stdout) &&
    /root must be an object/.test(invalidRoot.stdout),
  `status=${invalidRoot.status} out=${invalidRoot.stdout.slice(0, 160)}`,
);
rmSync(resolve(unavailableRoot, ".agents/workspace.json"), { force: true });
const missing = runHook(patchClean, { WORKSPACE_JSON_ROOT: unavailableRoot });
check(
  "hook: missing workspace.json warns and fails open",
  missing.status === 0 && /additionalContext/.test(missing.stdout) && /No workspace\.json found/.test(missing.stdout),
  `status=${missing.status} out=${missing.stdout.slice(0, 160)}`,
);
rmSync(unavailableRoot, { recursive: true, force: true });

// ── Root-marker walk: run hook from a NESTED directory, no env root ──
const nested = resolve(fixtureRoot, "packages/deep/nested");
mkdirSync(nested, { recursive: true });
const h6 = spawnSync("node", [resolve(root, "hooks/pre-edit-check.mjs"), "--paths", "src/routes/checkout.ts"], {
  cwd: nested,
  encoding: "utf8",
  env: { ...process.env, WORKSPACE_JSON_ROOT: "" },
});
check(
  "root-marker walk finds workspace.json from nested cwd",
  h6.status === 2,
  `status=${h6.status} stderr=${h6.stderr.slice(0, 80)}`,
);
rmSync(resolve(fixtureRoot, "packages"), { recursive: true, force: true });

// ── HAC-111: VERIFIED tier is opt-in (--verify / WJSON_VERIFY), off by default ──
// Probe fixture lives inside the repo so the read-only git whitelist reproduces.
const vProbe = resolve(root, ".smoke-verify");
mkdirSync(resolve(vProbe, ".agents"), { recursive: true });
writeFileSync(
  resolve(vProbe, ".agents/workspace.json"),
  JSON.stringify({
    manual: {
      fragileFiles: [
        {
          path: "src/probe.ts",
          reason: "verify probe (reproducible)",
          evidence: [{ claim: "in a work tree", command: "git rev-parse --is-inside-work-tree", output: "true" }],
        },
        {
          path: "src/nonrepro.ts",
          reason: "verify probe (non-reproducing)",
          evidence: [
            {
              claim: "absent",
              command: "git log --oneline --grep '__wjson_no_such_marker__'",
              output: "__wjson_no_such_marker__",
            },
          ],
        },
      ],
      coChangePatterns: [
        ["src/probe.ts", "src/partner.ts"],
        ["src/nonrepro.ts", "src/np-partner.ts"],
      ],
    },
  }),
);
function runHookIn(target, args, extraEnv = {}) {
  return spawnSync("node", [resolve(root, "hooks/pre-edit-check.mjs"), ...args], {
    cwd: target,
    encoding: "utf8",
    env: { ...process.env, WORKSPACE_JSON_ROOT: "", ...extraEnv },
  });
}
const vOff = runHookIn(vProbe, ["--paths", "src/probe.ts"]);
check(
  "verify OFF by default -> reproducible-command evidence stays OBSERVED",
  /tier OBSERVED/.test(vOff.stdout) && vOff.status === 2,
  vOff.stdout.slice(0, 120),
);
const vOn = runHookIn(vProbe, ["--paths", "src/probe.ts", "--verify"]);
check(
  "hook --verify -> reproducible git command upgrades to VERIFIED",
  /tier VERIFIED/.test(vOn.stdout) && vOn.status === 2,
  vOn.stdout.slice(0, 120),
);
const vNon = runHookIn(vProbe, ["--paths", "src/nonrepro.ts", "--verify"]);
check(
  "hook --verify -> non-reproducing command downgrades to OBSERVED (never throws)",
  /tier OBSERVED/.test(vNon.stdout) && vNon.status === 2,
  vNon.stdout.slice(0, 120),
);

// R-V3 guard: the Codex hot path (a PreToolUse event on stdin) must NEVER verify,
// even with WJSON_VERIFY=1 set — the reproducible triple must still read OBSERVED.
const vHot = runHook(
  {
    tool_name: "apply_patch",
    tool_input: { command: "*** Begin Patch\n*** Update File: src/probe.ts\n*** End Patch" },
  },
  { WORKSPACE_JSON_ROOT: vProbe, WJSON_VERIFY: "1" },
);
check(
  "hot path (stdin event) never verifies even with WJSON_VERIFY=1 -> OBSERVED",
  /tier OBSERVED/.test(vHot.stdout) && vHot.status === 2,
  vHot.stdout.slice(0, 120),
);

const vTransport = new StdioClientTransport({
  command: "node",
  args: [resolve(root, "dist/index.js")],
  env: { ...process.env, WORKSPACE_JSON_ROOT: vProbe, WJSON_VERIFY: "1" },
});
const vClient = new Client({ name: "smoke-verify", version: "0.0.0" });
await vClient.connect(vTransport);
const vTool = await vClient.callTool({ name: "workspace_get_file_context", arguments: { path: "src/probe.ts" } });
check(
  "tool with WJSON_VERIFY=1 -> file-context tier VERIFIED through the MCP surface",
  vTool.structuredContent?.fragility?.tier === "VERIFIED",
  JSON.stringify(vTool.structuredContent?.fragility?.tier),
);
await vClient.close();
rmSync(vProbe, { recursive: true, force: true });

console.log(`\n${failures === 0 ? "ALL GREEN" : `${failures} FAILURE(S)`}`);
process.exit(failures === 0 ? 0 : 1);
