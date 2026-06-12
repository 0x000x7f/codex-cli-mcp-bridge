import fs from "node:fs";
import path from "node:path";
import { resolveInsideWorkspace } from "../safety/workspace-guard.js";
import {
  runCodexExecReadOnly,
  runCodexExecInWorktree,
  type CodexRunResult,
} from "../codex/spawn.js";
import { extractFinalAgentMessage, extractErrorMessages } from "../codex/parse-output.js";
import { extractSingleDiffFence } from "../patch/extract-diff.js";
import { validateGitPatch, defaultLimits, type PatchSummary } from "../patch/validate-patch.js";
import { gitApplyCheck } from "../patch/apply-check.js";
import {
  assertCleanWorkspace,
  createTempWorktree,
  assertWorktreeIntact,
  removeTempWorktree,
} from "../worktree/temp-worktree.js";
import { cleanupHandoffCopy, collectWorktreeDiff } from "../worktree/collect-diff.js";
import { runGit } from "../worktree/run-git.js";

const STDERR_LIMIT = 2000;

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
  const strategy =
    process.env.CODEX_BRIDGE_PATCH_STRATEGY === "readonly" ? "readonly" : "worktree";
  return strategy === "readonly"
    ? proposeViaReadonly(workspaceRoot, handoffPath)
    : proposeViaWorktree(workspaceRoot, handoffPath);
}

/* ------------------------------------------------------------------ */
/* Strategy B (default): real edits in a disposable worktree           */
/* ------------------------------------------------------------------ */

/**
 * Strategy B prompt: Codex edits files for real inside the disposable
 * worktree; it must NOT print a diff (review constraint #5) — the bridge
 * collects the diff mechanically afterwards, so context lines are correct by
 * construction.
 */
export function buildWorktreeEditPrompt(gitRelHandoffPath: string): string {
  return [
    "You are working inside a DISPOSABLE git worktree. Your edits here are collected as a diff by the bridge afterwards; the real repository is not affected.",
    `Read the handoff document at: ${gitRelHandoffPath}`,
    "Implement the smallest reasonable change that satisfies the handoff by EDITING FILES DIRECTLY in this worktree.",
    "Do not print a patch or unified diff. Modify the files directly in this temporary worktree.",
    "Do not commit, branch, push, install packages, or touch .git.",
    "Do not edit the handoff document itself.",
    "Do not write outside this worktree.",
    "Keep the change minimal: do not reformat unrelated lines.",
    "When you are done, reply with a one-paragraph summary of what you changed. The bridge will collect the diff after you finish.",
  ].join("\n");
}

async function proposeViaWorktree(
  workspaceRoot: string,
  handoffPath: string,
): Promise<ProposedPatch> {
  const file = resolveInsideWorkspace(workspaceRoot, handoffPath);
  const gitRel = file.relPath.split(path.sep).join("/");
  // Log path and size only — never the document body (docs/security.md §6).
  console.error(`[codex_propose_patch] strategy=worktree handoff=${gitRel} size=${file.size}B`);

  await assertCleanWorkspace(workspaceRoot);
  const wt = await createTempWorktree(workspaceRoot);
  // Absolute temp paths go to stderr only (review constraint #1).
  console.error(`[codex_propose_patch] temp worktree created at ${wt.path}`);

  let diff: string | undefined;
  let pipelineError: unknown;
  try {
    // The worktree is created from HEAD, so an untracked/gitignored handoff
    // (e.g. docs/handoff/HANDOFF-*.md) does not exist there — copy it in.
    const dest = path.join(wt.path, file.relPath);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(file.absPath, dest);

    const result = await runCodexExecInWorktree({
      worktreePath: wt.path,
      prompt: buildWorktreeEditPrompt(gitRel),
    });
    throwOnCodexFailure(result);

    await assertWorktreeIntact(wt);
    await cleanupHandoffCopy(workspaceRoot, wt.path, gitRel);
    diff = await collectWorktreeDiff(wt.path);
  } catch (e) {
    pipelineError = e;
  }

  // Cleanup ALWAYS runs; warnings go to stderr (full paths allowed there).
  const warnings = await removeTempWorktree(workspaceRoot, wt);
  for (const w of warnings) console.error(`[codex_propose_patch] cleanup warning: ${w}`);

  // Review constraint #2: regardless of cleanup outcome, verify the real
  // workspace. A modified real workspace outranks every other error.
  const porcelain = await runGit(["-C", workspaceRoot, "status", "--porcelain"]);
  if (porcelain.exitCode === 0 && porcelain.stdout.trim() !== "") {
    throw new Error(
      "CRITICAL: the real workspace changed during codex_propose_patch " +
        "(git status --porcelain is not empty). Inspect the workspace immediately." +
        (pipelineError ? ` An earlier error was also raised: ${describe(pipelineError)}` : ""),
    );
  }

  if (pipelineError) throw maskTempPaths(pipelineError, [wt.path, wt.baseDir]);
  if (diff === undefined) throw new Error("internal error: no diff collected");

  const summary = validateGitPatch(diff, defaultLimits());
  // Review constraint #4: the handoff document must never leak into the diff.
  if (summary.files.includes(gitRel)) {
    throw new Error("the handoff document leaked into the proposed diff — rejected");
  }
  await gitApplyCheck(workspaceRoot, diff);
  return { diff, ...summary };
}

/* ------------------------------------------------------------------ */
/* Strategy A (env: CODEX_BRIDGE_PATCH_STRATEGY=readonly)              */
/* ------------------------------------------------------------------ */

/**
 * Strategy A prompt (read-only, hand-written diff). Field-tested at ~29%
 * apply --check pass rate for existing-file modifications — kept for
 * comparison runs and lightweight new-file/deletion proposals.
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

async function proposeViaReadonly(
  workspaceRoot: string,
  handoffPath: string,
): Promise<ProposedPatch> {
  const file = resolveInsideWorkspace(workspaceRoot, handoffPath);
  console.error(
    `[codex_propose_patch] strategy=readonly handoff=${file.relPath} size=${file.size}B`,
  );

  const result = await runCodexExecReadOnly({
    workspaceRoot,
    prompt: buildProposePatchPrompt(file.relPath),
  });
  throwOnCodexFailure(result);

  const message = extractFinalAgentMessage(result.stdout);
  const diff = extractSingleDiffFence(message);
  const summary: PatchSummary = validateGitPatch(diff, defaultLimits());
  await gitApplyCheck(workspaceRoot, diff);
  return { diff, ...summary };
}

/* ------------------------------------------------------------------ */
/* shared helpers                                                      */
/* ------------------------------------------------------------------ */

function throwOnCodexFailure(result: CodexRunResult): void {
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
}

/** Replace absolute temp paths in outgoing errors (review constraint #1). */
function maskTempPaths(err: unknown, tempPaths: string[]): Error {
  let message = describe(err);
  for (const p of tempPaths) {
    message = message.split(p).join("<temp worktree>");
  }
  const masked = new Error(message);
  return masked;
}

function describe(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function truncate(s: string): string {
  return s.length > STDERR_LIMIT ? `${s.slice(0, STDERR_LIMIT)}…(truncated)` : s;
}
