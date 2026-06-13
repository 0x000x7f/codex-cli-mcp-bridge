import fs from "node:fs";
import path from "node:path";
import { resolveInsideWorkspace } from "../safety/workspace-guard.js";
import { runCodexExecReadOnly, type CodexRunResult } from "../codex/spawn.js";
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
import { parseFileBlocks, defaultRewriteLimits } from "../patch/parse-file-blocks.js";
import { applyBlocksToWorktree } from "../worktree/apply-blocks.js";

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
/* Strategy B′ (default): Codex stays read-only and outputs complete   */
/* file contents; the BRIDGE applies them to a disposable worktree.    */
/* (Native Windows blocks codex-exec agent writes in every sandbox     */
/* configuration — see docs/design.md §9.)                             */
/* ------------------------------------------------------------------ */

/**
 * Strategy B′ prompt: no diffs (they break — Phase 2A field test), no agent
 * writes (blocked on native Windows). Codex returns complete file contents in
 * a strict block format; anything outside the blocks fails the proposal.
 */
export function buildFileBlockPrompt(gitRelHandoffPath: string): string {
  return [
    "You are preparing a change proposal. You are running read-only inside a snapshot of the repository; the bridge will apply your output to a disposable worktree and collect a git diff. The real repository is not affected.",
    `Read the handoff document at: ${gitRelHandoffPath}`,
    "You may read other files in this repository for context.",
    "Design the smallest reasonable change that satisfies the handoff.",
    "Return ONLY file blocks in exactly this format — no other prose, no headings, no explanations, no diffs:",
    "===FILE: relative/path===",
    "<complete new file contents>",
    "===END===",
    "===DELETE: relative/path===",
    "Rules:",
    "- A FILE block must contain the COMPLETE new contents of that file; it fully replaces the existing file or creates a new one. Never abbreviate, elide, or write placeholders such as '... unchanged ...'.",
    "- Preserve all existing non-ASCII characters EXACTLY unless the handoff explicitly asks to change them. Do not normalize or substitute punctuation, em/en dashes (—, –), curly quotes, Japanese text, or any Unicode symbol.",
    "- For lines you are not changing, copy them byte-for-byte from the original file. Treat the file as UTF-8.",
    "- Use a DELETE block (no body, no ===END===) only to delete a file.",
    "- Repository-relative paths with forward slashes only. Never touch .git/ or the handoff document itself.",
    "- Do not output a unified diff or patch. Do not run commands that change anything.",
    "- Keep the change minimal: prefer touching few files and do not reformat unrelated lines.",
    "- Any text outside the blocks will cause the proposal to be rejected.",
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

    // Codex runs READ-ONLY against the worktree snapshot (the only codex-exec
    // mode whose behavior is reliable on native Windows) and returns complete
    // file contents in the strict block format.
    const result = await runCodexExecReadOnly({
      workspaceRoot: wt.path,
      prompt: buildFileBlockPrompt(gitRel),
    });
    throwOnCodexFailure(result);

    const message = extractFinalAgentMessage(result.stdout);
    const blocks = parseFileBlocks(message, {
      limits: defaultRewriteLimits(),
      forbiddenPaths: [gitRel],
    });
    // The BRIDGE materializes the proposal in the worktree (no Codex writes).
    applyBlocksToWorktree(wt.path, blocks);

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
