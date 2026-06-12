import { resolveInsideWorkspace } from "../safety/workspace-guard.js";
import { runCodexExecReadOnly } from "../codex/spawn.js";
import { extractFinalAgentMessage } from "../codex/parse-output.js";

const STDERR_LIMIT = 2000;

/**
 * Planning-only prompt. Forbids Codex from producing anything that could be
 * applied directly (patches, diffs, paste-ready code) — Phase 1 boundary.
 */
export function buildPlanPrompt(relHandoffPath: string): string {
  return [
    "You are running in read-only planning mode.",
    `Read the handoff document at: ${relHandoffPath}`,
    "You may read other files in this repository for context.",
    "Do not modify any files.",
    "Do not generate patches, unified diffs, replacement files, shell commands to apply changes, or implementation code intended to be pasted directly.",
    "Return only:",
    "1. Summary of the handoff",
    "2. Implementation plan (step by step)",
    "3. Risks / open questions",
    "4. Files that would likely be read or changed in a later phase",
  ].join("\n");
}

export async function codexPlan(workspaceRoot: string, handoffPath: string): Promise<string> {
  const file = resolveInsideWorkspace(workspaceRoot, handoffPath);
  // Log path and size only — never the document body (docs/security.md §6).
  console.error(`[codex_plan] handoff=${file.relPath} size=${file.size}B`);

  const result = await runCodexExecReadOnly({
    workspaceRoot,
    prompt: buildPlanPrompt(file.relPath),
  });

  if (result.timedOut) {
    throw new Error(
      `Codex run timed out and the process tree was terminated. stderr: ${truncate(result.stderr)}`,
    );
  }
  if (result.exitCode !== 0) {
    throw new Error(`Codex exited with code ${result.exitCode}. stderr: ${truncate(result.stderr)}`);
  }
  return extractFinalAgentMessage(result.stdout);
}

function truncate(s: string): string {
  return s.length > STDERR_LIMIT ? `${s.slice(0, STDERR_LIMIT)}…(truncated)` : s;
}
