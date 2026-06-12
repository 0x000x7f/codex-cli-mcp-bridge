import { resolveInsideWorkspace } from "../safety/workspace-guard.js";
import { runCodexExecReadOnly } from "../codex/spawn.js";
import { extractFinalAgentMessage, extractErrorMessages } from "../codex/parse-output.js";
import { extractSingleDiffFence } from "../patch/extract-diff.js";
import { validateGitPatch, defaultLimits } from "../patch/validate-patch.js";
import { gitApplyCheck } from "../patch/apply-check.js";

const STDERR_LIMIT = 2000;

/**
 * Patch-proposal prompt. Codex stays in read-only sandbox and returns the
 * change as TEXT — a single Git-format unified diff inside one ```diff fence.
 * Nothing is ever applied by this tool (mutation is Phase 3, not implemented).
 */
export function buildProposePatchPrompt(relHandoffPath: string): string {
  return [
    "You are running in read-only patch-proposal mode.",
    `Read the handoff document at: ${relHandoffPath}`,
    "You may read other files in this repository for context.",
    "Do not modify any files. Do not run commands that change anything.",
    "Design the smallest reasonable change that satisfies the handoff, and return it as ONE unified diff in Git format.",
    "Strict output requirements:",
    "- Exactly one fenced code block labeled diff (```diff ... ```), containing the entire patch and nothing else.",
    "- Git format only: each file section starts with `diff --git a/<path> b/<path>` followed by `---` / `+++` headers and `@@` hunks.",
    "- Repository-relative paths only. Never touch files outside this repository or under .git/.",
    "- No binary patches.",
    "- New files use `--- /dev/null`; deletions use `+++ /dev/null`.",
    "- Keep the change minimal: do not reformat unrelated lines.",
    "- You may add a short explanation OUTSIDE the fence, but the fence must contain only the diff.",
    "Do not apply the patch and do not include instructions for applying it.",
  ].join("\n");
}

export interface ProposedPatch {
  diff: string;
  files: string[];
  additions: number;
  deletions: number;
}

export async function codexProposePatch(
  workspaceRoot: string,
  handoffPath: string,
): Promise<ProposedPatch> {
  const file = resolveInsideWorkspace(workspaceRoot, handoffPath);
  // Log path and size only — never the document body (docs/security.md §6).
  console.error(`[codex_propose_patch] handoff=${file.relPath} size=${file.size}B`);

  const result = await runCodexExecReadOnly({
    workspaceRoot,
    prompt: buildProposePatchPrompt(file.relPath),
  });

  if (result.timedOut) {
    throw new Error(
      `Codex run timed out and the process tree was terminated. stderr: ${truncate(result.stderr)}`,
    );
  }
  if (result.exitCode !== 0) {
    const errorEvents = extractErrorMessages(result.stdout);
    const detail =
      errorEvents.length > 0
        ? `error events: ${errorEvents.join(" | ")}`
        : `stderr: ${truncate(result.stderr)}`;
    throw new Error(`Codex exited with code ${result.exitCode}. ${detail}`);
  }

  const message = extractFinalAgentMessage(result.stdout);
  const diff = extractSingleDiffFence(message);
  const summary = validateGitPatch(diff, defaultLimits());
  await gitApplyCheck(workspaceRoot, diff);
  return { diff, ...summary };
}

function truncate(s: string): string {
  return s.length > STDERR_LIMIT ? `${s.slice(0, STDERR_LIMIT)}…(truncated)` : s;
}
