// Manual JSON-RPC smoke test for the MCP server (stdio, newline-delimited JSON).
//
//   node tests/manual/jsonrpc-smoke.mjs                            -> initialize + tools/list only
//   node tests/manual/jsonrpc-smoke.mjs <handoff_path>             -> calls codex_plan (runs Codex)
//   node tests/manual/jsonrpc-smoke.mjs <handoff_path> propose     -> calls codex_propose_patch
//
// Run `npm run build` first. Server stderr is passed through for visibility.
import { spawn } from "node:child_process";
import path from "node:path";
import process from "node:process";

const handoffPath = process.argv[2];
const toolName =
  process.argv[3] === "propose" || process.argv[3] === "codex_propose_patch"
    ? "codex_propose_patch"
    : "codex_plan";
const server = spawn(process.execPath, [path.resolve("dist/src/server.js")], {
  stdio: ["pipe", "pipe", "inherit"],
});

const send = (obj) => server.stdin.write(`${JSON.stringify(obj)}\n`);

let buffer = "";
const pending = new Map();
let nextId = 1;

function request(method, params) {
  const id = nextId++;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    send({ jsonrpc: "2.0", id, method, params });
  });
}

server.stdout.on("data", (chunk) => {
  buffer += chunk;
  let idx;
  while ((idx = buffer.indexOf("\n")) >= 0) {
    const line = buffer.slice(0, idx).trim();
    buffer = buffer.slice(idx + 1);
    if (!line) continue;
    const msg = JSON.parse(line);
    if (msg.id !== undefined && pending.has(msg.id)) {
      const p = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) p.reject(new Error(JSON.stringify(msg.error)));
      else p.resolve(msg.result);
    }
  }
});

const init = await request("initialize", {
  protocolVersion: "2024-11-05",
  capabilities: {},
  clientInfo: { name: "jsonrpc-smoke", version: "0.0.0" },
});
console.log("initialize ok:", JSON.stringify(init.serverInfo));
send({ jsonrpc: "2.0", method: "notifications/initialized" });

const tools = await request("tools/list", {});
console.log("tools:", tools.tools.map((t) => t.name).join(", "));

// Round-trip modes: propose, then apply / review the proposed diff.
//   node tests/manual/jsonrpc-smoke.mjs <handoff_path> apply    -> propose then codex_apply
//   node tests/manual/jsonrpc-smoke.mjs <handoff_path> review   -> propose then codex_review_patch
const roundTrip = process.argv[3] === "apply";
const reviewTrip = process.argv[3] === "review";

if (handoffPath) {
  const callTool =
    process.argv[3] === "propose" || roundTrip || reviewTrip ? "codex_propose_patch" : toolName;
  console.log(`calling ${callTool}(${handoffPath}) ...`);
  const t0 = Date.now();
  const res = await request("tools/call", {
    name: callTool,
    arguments: { handoff_path: handoffPath },
  });
  const elapsed = Date.now() - t0;
  console.log(`elapsed_ms: ${elapsed}`);
  console.log("isError:", res.isError ?? false);
  console.log("--- result ---");
  const text = res.content?.[0]?.text ?? "(no text)";
  console.log(text);
  console.log(`--- end (elapsed_ms: ${elapsed}, isError: ${res.isError ?? false}) ---`);

  if ((roundTrip || reviewTrip) && !res.isError) {
    const sha = /diff_sha256: ([0-9a-f]{64})/.exec(text)?.[1];
    const head = /base_head: ([0-9a-f]+)/.exec(text)?.[1];
    const diffMatch = /```diff\n([\s\S]*?)```/.exec(text);
    const diff = diffMatch ? `${diffMatch[1].replace(/\n$/, "")}\n` : undefined;
    if (sha && head && diff) {
      const next = reviewTrip ? "codex_review_patch" : "codex_apply";
      const nextArgs = reviewTrip
        ? { diff, expected_sha256: sha, base_head: head }
        : { diff, approval: true, expected_sha256: sha, base_head: head };
      console.log(`\ncalling ${next}(...) with the proposed diff ...`);
      const nr = await request("tools/call", { name: next, arguments: nextArgs });
      console.log(`${next} isError:`, nr.isError ?? false);
      console.log(`--- ${next} result ---`);
      console.log(nr.content?.[0]?.text ?? "(no text)");
    } else {
      console.log("could not parse propose result (sha/head/diff missing)");
    }
  }
}

server.kill();
process.exit(0);
