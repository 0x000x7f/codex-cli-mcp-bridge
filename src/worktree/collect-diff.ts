import fs from "node:fs";
import path from "node:path";
import { git, runGit } from "./run-git.js";

export class DiffCollectionError extends Error {}

/**
 * Remove the handoff copy before collecting the diff (review constraint #4).
 * Tracked handoffs are restored to their HEAD content; untracked (e.g.
 * gitignored docs/handoff/HANDOFF-*.md) copies are deleted. Throws if the
 * cleanup cannot be performed — a diff must never be returned with the handoff
 * still present.
 */
export async function cleanupHandoffCopy(
  workspaceRoot: string,
  wtPath: string,
  gitRelHandoffPath: string,
): Promise<void> {
  const tracked = await runGit([
    "-C",
    workspaceRoot,
    "ls-files",
    "--error-unmatch",
    gitRelHandoffPath,
  ]);
  if (tracked.exitCode === 0) {
    await git(["-C", wtPath, "checkout", "--", gitRelHandoffPath]);
  } else {
    fs.rmSync(path.join(wtPath, ...gitRelHandoffPath.split("/")), { force: true });
  }
}

/**
 * Collect everything Codex changed in the worktree as a Git unified diff.
 * `add -A` uses the worktree's own index (the main workspace index is
 * untouched); `diff --cached` then yields proper Git-format sections for
 * modifications, new files, and deletions. `--binary` is intentionally NOT
 * passed — binary changes surface as "Binary files ..." lines, which the
 * existing patch validation rejects.
 */
export async function collectWorktreeDiff(wtPath: string): Promise<string> {
  await git(["-C", wtPath, "add", "-A"]);
  const diff = await git(["-C", wtPath, "diff", "--cached", "--no-color", "--no-ext-diff"]);
  if (diff.trim() === "") {
    throw new DiffCollectionError("Codex made no changes in the temp worktree — nothing to propose");
  }
  return diff.endsWith("\n") ? diff : `${diff}\n`;
}
