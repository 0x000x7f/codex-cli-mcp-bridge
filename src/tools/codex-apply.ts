import path from "node:path";
import fs from "node:fs";
import { runGit, git } from "../worktree/run-git.js";
import { validateGitPatch, defaultLimits, type PatchSummary } from "../patch/validate-patch.js";
import { gitApplyCheck } from "../patch/apply-check.js";
import { gitApply } from "../patch/apply-patch.js";
import { diffSha256 } from "../patch/diff-summary.js";

export class ApplyRejected extends Error {}

export interface ApplyResult {
  files: string[];
  additions: number;
  deletions: number;
}

/**
 * Phase 3 — the ONLY tool that mutates the working tree, and only a reviewed,
 * exact diff. codex_apply does NOT call Codex; it deterministically applies the
 * diff that codex_propose_patch returned and a human approved. Every check is
 * fail-closed and the tree is left untouched on any rejection.
 */
export async function codexApply(
  workspaceRoot: string,
  args: { diff: string; approval: boolean; expected_sha256: string; base_head: string },
): Promise<ApplyResult> {
  // 1. approval must be a strict boolean true (docs/security.md).
  if (args.approval !== true) {
    throw new ApplyRejected("approval must be exactly boolean true; nothing was applied");
  }
  // 2. hash / HEAD bindings are mandatory in Phase 3 (review-first).
  if (typeof args.expected_sha256 !== "string" || args.expected_sha256.trim() === "") {
    throw new ApplyRejected("expected_sha256 is required");
  }
  if (typeof args.base_head !== "string" || args.base_head.trim() === "") {
    throw new ApplyRejected("base_head is required");
  }
  // 3. The diff must be byte-identical to the one that was reviewed.
  const actual = diffSha256(args.diff);
  if (actual !== args.expected_sha256.trim()) {
    throw new ApplyRejected(
      `diff hash mismatch: expected ${args.expected_sha256.trim()}, got ${actual} — the reviewed diff and the supplied diff differ; nothing was applied`,
    );
  }
  // 4. HEAD must match the one the diff was produced against.
  const head = (await git(["-C", workspaceRoot, "rev-parse", "HEAD"])).trim();
  if (head !== args.base_head.trim()) {
    throw new ApplyRejected(
      `workspace HEAD moved since review (now ${head}, reviewed against ${args.base_head.trim()}); re-propose and re-review`,
    );
  }
  // 5. Clean tree required (review-time state + rollback guarantee).
  const porcelain = await git(["-C", workspaceRoot, "status", "--porcelain"]);
  if (porcelain.trim() !== "") {
    throw new ApplyRejected("workspace has uncommitted changes; commit or stash them first");
  }
  // 6. Structural re-validation + dry-run apply.
  const summary: PatchSummary = validateGitPatch(args.diff, defaultLimits());
  await gitApplyCheck(workspaceRoot, args.diff);

  // 7. Apply to the working tree only.
  try {
    await gitApply(workspaceRoot, args.diff);
  } catch (e) {
    await rollbackIfDirty(workspaceRoot, summary.files);
    throw e;
  }

  // 8. Report what changed.
  return { files: summary.files, additions: summary.additions, deletions: summary.deletions };
}

/**
 * git apply is atomic, so a clean-tree precondition normally means a failure
 * leaves nothing behind. As defense in depth, if the tree is dirty after a
 * failed apply, recover ONLY the files the diff touched (never `git checkout
 * -- .`, which would also wipe unrelated untracked files): restore tracked
 * files to HEAD, delete files the diff would have newly created. If recovery
 * is incomplete, surface a critical error with manual steps.
 */
async function rollbackIfDirty(workspaceRoot: string, touchedFiles: string[]): Promise<void> {
  const dirty = (await git(["-C", workspaceRoot, "status", "--porcelain"])).trim();
  if (dirty === "") return;

  const problems: string[] = [];
  for (const rel of touchedFiles) {
    const tracked = await runGit(["-C", workspaceRoot, "ls-files", "--error-unmatch", rel]);
    if (tracked.exitCode === 0) {
      const r = await runGit(["-C", workspaceRoot, "checkout", "--", rel]);
      if (r.exitCode !== 0) problems.push(`could not restore ${rel}`);
    } else {
      try {
        fs.rmSync(path.join(workspaceRoot, ...rel.split("/")), { force: true });
      } catch {
        problems.push(`could not remove new file ${rel}`);
      }
    }
  }
  const still = (await git(["-C", workspaceRoot, "status", "--porcelain"])).trim();
  if (still !== "" || problems.length > 0) {
    throw new Error(
      "CRITICAL: git apply failed and automatic rollback was incomplete. " +
        `Inspect the workspace and recover manually (e.g. \`git checkout -- <file>\`, remove stray new files). ` +
        `Remaining: ${still || "(none)"}. Problems: ${problems.join("; ") || "(none)"}`,
    );
  }
}
