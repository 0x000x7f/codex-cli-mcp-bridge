// Manual JSON-RPC smoke test for the MCP server (stdio, newline-delimited JSON).
//
//   node tests/manual/jsonrpc-smoke.mjs                  -> initialize + tools/list only
//   node tests/manual/jsonrpc-smoke.mjs <handoff_path>   -> also calls codex_plan (runs Codex)
//
// Run `npm run build` first. Server stderr is passed through for visibility.
import { spawn } from "node:child_process";
import path from "node:path";
import process from "node:process";

const handoffPath = process.argv[2];
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

if (handoffPath) {
  console.log(`calling codex_plan(${handoffPath}) ...`);
  const t0 = Date.now();
  const res = await request("tools/call", {
    name: "codex_plan",
    arguments: { handoff_path: handoffPath },
  });
  const elapsed = Date.now() - t0;
  console.log(`elapsed_ms: ${elapsed}`);
  console.log("isError:", res.isError ?? false);
  console.log("--- result ---");
  console.log(res.content?.[0]?.text ?? "(no text)");
  console.log(`--- end (elapsed_ms: ${elapsed}, isError: ${res.isError ?? false}) ---`);
}

server.kill();
process.exit(0);
