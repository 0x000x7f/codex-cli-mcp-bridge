import test from "node:test";
import assert from "node:assert/strict";
import { extractFinalAgentMessage, CodexOutputParseError } from "../src/codex/parse-output.js";

test("extracts the last item.completed agent_message", () => {
  const out = [
    JSON.stringify({ type: "thread.started", thread_id: "t1" }),
    JSON.stringify({ type: "item.completed", item: { type: "reasoning", text: "thinking" } }),
    JSON.stringify({ type: "item.completed", item: { type: "agent_message", text: "first" } }),
    JSON.stringify({ type: "item.completed", item: { type: "agent_message", text: "final plan" } }),
  ].join("\n");
  assert.equal(extractFinalAgentMessage(out), "final plan");
});

test("extracts protocol-style msg.agent_message", () => {
  const out = JSON.stringify({ id: "0", msg: { type: "agent_message", message: "plan body" } });
  assert.equal(extractFinalAgentMessage(out), "plan body");
});

test("ignores non-JSON noise lines", () => {
  const out = ["warming up...", JSON.stringify({ type: "agent_message", message: "ok" })].join("\n");
  assert.equal(extractFinalAgentMessage(out), "ok");
});

test("throws CodexOutputParseError carrying raw output when nothing matches", () => {
  assert.throws(
    () => extractFinalAgentMessage("plain text only\n"),
    (e: unknown) => e instanceof CodexOutputParseError && e.rawOutput.includes("plain text"),
  );
});
