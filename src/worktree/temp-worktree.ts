import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { git, runGit } from "./run-git.js";

export class WorktreeError extends Error {}

export interface TempWorktree {
  /** Absolute path of the worktree itself. */
  path: string;
  /** mkdtemp parent directory holding the worktree. */
  baseDir: string;
  /** HEAD commit the worktree was created from. */
  head: string;
}

/** Strategy B requires a clean tree: the worktree is created from HEAD, so any
 * uncommitted change would make the collected diff diverge from reality. */
export async function assertCleanWorkspace(workspaceRoot: string): Promise<void> {
  const out = await git(["-C", workspaceRoot, "status", "--porcelain"]);
  if (out.trim() !== "") {
    throw new WorktreeError(
      "workspace has uncommitted changes; commit or stash them first — " +
        "codex_propose_patch (worktree strategy) requires a clean tree",
    );
  }
}

export async function createTempWorktree(workspaceRoot: string): Promise<TempWorktree> {
  const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), "codex-bridge-wt-"));
  const wtPath = path.join(baseDir, "wt");
  await git(["-C", workspaceRoot, "worktree", "add", "--detach", wtPath, "HEAD"]);
  const head = (await git(["-C", wtPath, "rev-parse", "HEAD"])).trim();
  return { path: wtPath, baseDir, head };
}

/** Verify Codex neither committed nor left detached HEAD (review constraint #3). */
export async function assertWorktreeIntact(wt: TempWorktree): Promise<void> {
  const head = (await git(["-C", wt.path, "rev-parse", "HEAD"])).trim();
  if (head !== wt.head) {
    throw new WorktreeError(
      "HEAD changed inside the temp worktree (a commit appears to have been made) — proposal rejected",
    );
  }
  const sym = await runGit(["-C", wt.path, "symbolic-ref", "-q", "--short", "HEAD"]);
  if (sym.exitCode === 0 && sym.stdout.trim() !== "") {
    throw new WorktreeError(
      "temp worktree left detached HEAD state (branch checkout detected) — proposal rejected",
    );
  }
}

/** Always-run cleanup with staged fallbacks. Returns warnings instead of
 * throwing — the caller decides severity (and must verify the real workspace
 * afterwards regardless of cleanup outcome). */
export async function removeTempWorktree(
  workspaceRoot: string,
  wt: TempWorktree,
): Promise<string[]> {
  const warnings: string[] = [];
  const rm = await runGit(["-C", workspaceRoot, "worktree", "remove", "--force", wt.path]);
  if (rm.exitCode !== 0) {
    warnings.push(`git worktree remove failed (exit ${rm.exitCode}): ${rm.stderr.trim()}`);
    try {
      fs.rmSync(wt.path, { recursive: true, force: true });
    } catch (e) {
      warnings.push(`fs removal failed: ${e instanceof Error ? e.message : String(e)}`);
    }
    const prune = await runGit(["-C", workspaceRoot, "worktree", "prune"]);
    if (prune.exitCode !== 0) {
      warnings.push(`git worktree prune failed (exit ${prune.exitCode})`);
    }
  }
  try {
    fs.rmSync(wt.baseDir, { recursive: true, force: true });
  } catch {
    /* base dir removal is best-effort; the worktree itself is what matters */
  }
  return warnings;
}
