// Degraded-evidence controls exercised through the real MCP protocol, not the
// unit-test seam: spawn the adapter as the host does, initialize, call the tool,
// and record verbatim what a host would receive.
import { spawn } from "node:child_process";

const SERVER = "<INTEGRATIONS>/dist/claude-code/server.js";
const SP = "<WORKDIR>";

function call(root, changedFiles) {
  return new Promise((resolve) => {
    const p = spawn("node", [SERVER], { env: { ...process.env, WORKSPACE_JSON_ROOT: root }, stdio: ["pipe", "pipe", "pipe"] });
    let buf = "";
    const out = [];
    p.stdout.on("data", (d) => {
      buf += d.toString();
      let i;
      while ((i = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, i).trim();
        buf = buf.slice(i + 1);
        if (line) out.push(JSON.parse(line));
      }
    });
    p.on("close", () => resolve(out));
    const send = (o) => p.stdin.write(`${JSON.stringify(o)}\n`);
    send({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "m2b-probe", version: "1" } } });
    setTimeout(() => {
      send({ jsonrpc: "2.0", method: "notifications/initialized" });
      send({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "workspace_review_evidence", arguments: { changedFiles } } });
      setTimeout(() => p.kill(), 4000);
    }, 700);
  });
}

const conditions = [
  ["present", `${SP}/repo`],
  ["perturbed (registered pair removed)", `${SP}/repo-perturbed`],
  ["absent (no artifact)", `${SP}/repo-absent`],
  ["malformed (truncated JSON)", `${SP}/repo-malformed`],
];

for (const [label, root] of conditions) {
  const msgs = await call(root, ["packages/spec/src/schema.ts"]);
  const res = msgs.find((m) => m.id === 2);
  const r = res?.result ?? {};
  const text = r.content?.[0]?.text ?? JSON.stringify(res?.error ?? "NO RESPONSE");
  const sc = r.structuredContent ?? {};
  const partners = (sc.files?.[0]?.partners ?? []).map((x) => x.partner);
  console.log(`\n===== ${label} =====`);
  console.log(`isError:      ${r.isError === true}`);
  console.log(`status:       ${sc.status ?? "(evidence returned)"}`);
  console.log(`freshness:    ${sc.provenance?.freshness ?? "n/a"}`);
  console.log(`v1.json partner present: ${partners.includes("packages/spec/schema/v1.json")}`);
  console.log(`partners(${partners.length}): ${partners.slice(0, 3).join(", ")}${partners.length > 3 ? " ..." : ""}`);
  // The safety-vocabulary gate: no degraded path may read as approval.
  const bad = /\bis safe\b|\bno risk\b|\bapproved\b|\blooks good\b/i.test(text);
  console.log(`affirmative-safety language: ${bad ? "PRESENT (FAIL)" : "absent (PASS)"}`);
  console.log(`--- first lines ---\n${text.split("\n").slice(0, 4).join("\n")}`);
}
