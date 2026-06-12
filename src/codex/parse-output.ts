export class CodexOutputParseError extends Error {
  readonly rawOutput: string;

  constructor(message: string, rawOutput: string) {
    super(message);
    this.rawOutput = rawOutput;
  }
}

/**
 * Extract the final agent message from `codex exec --json` JSONL output.
 *
 * Known shapes (codex-cli 0.118 and nearby versions):
 *   {"type":"item.completed","item":{"type":"agent_message","text":"..."}}
 *   {"id":"0","msg":{"type":"agent_message","message":"..."}}
 *   {"type":"agent_message","message":"..."}
 *
 * If no agent message is found we throw with the raw output attached instead
 * of guessing (docs/security.md, failure-mode table).
 */
export function extractFinalAgentMessage(jsonlStdout: string): string {
  let last: string | undefined;
  for (const line of jsonlStdout.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed === "") continue;
    let event: unknown;
    try {
      event = JSON.parse(trimmed);
    } catch {
      continue; // non-JSON noise (banners, progress lines)
    }
    const text = agentMessageText(event);
    if (text !== undefined) last = text;
  }
  if (last === undefined) {
    throw new CodexOutputParseError("no agent message found in Codex JSONL output", jsonlStdout);
  }
  return last;
}

function agentMessageText(event: unknown): string | undefined {
  if (typeof event !== "object" || event === null) return undefined;
  const e = event as Record<string, unknown>;

  const item = e.item as Record<string, unknown> | undefined;
  if (
    item &&
    typeof item === "object" &&
    (item.type === "agent_message" || item.item_type === "agent_message") &&
    typeof item.text === "string"
  ) {
    return item.text;
  }

  const msg = e.msg as Record<string, unknown> | undefined;
  if (msg && typeof msg === "object" && msg.type === "agent_message") {
    if (typeof msg.message === "string") return msg.message;
    if (typeof msg.text === "string") return msg.text;
  }

  if (e.type === "agent_message") {
    if (typeof e.message === "string") return e.message;
    if (typeof e.text === "string") return e.text;
  }

  return undefined;
}
