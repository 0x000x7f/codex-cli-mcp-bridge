export class DiffExtractionError extends Error {
  readonly rawOutput: string;

  constructor(message: string, rawOutput: string) {
    super(message);
    this.rawOutput = rawOutput;
  }
}

/**
 * Extract the patch from a Codex agent message.
 *
 * Contract (Phase 2 review constraint): exactly one ```diff fence must exist.
 * Prose outside the fence is ignored; only the fence body is returned for
 * validation. Zero fences or two-plus fences is an error carrying the raw
 * message for diagnostics.
 */
export function extractSingleDiffFence(agentMessage: string): string {
  const fences: string[] = [];
  const re = /```diff[^\S\r\n]*\r?\n([\s\S]*?)```/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(agentMessage)) !== null) fences.push(m[1]);

  if (fences.length === 0) {
    throw new DiffExtractionError("no ```diff fence found in Codex output", agentMessage);
  }
  if (fences.length > 1) {
    throw new DiffExtractionError(
      `expected exactly one \`\`\`diff fence, found ${fences.length}`,
      agentMessage,
    );
  }
  const diff = fences[0];
  if (diff.trim() === "") {
    throw new DiffExtractionError("the ```diff fence is empty", agentMessage);
  }
  return diff.endsWith("\n") ? diff : `${diff}\n`;
}
