import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import {
  createTempWorktree,
  removeTempWorktree,
} from "../src/worktree/temp-worktree.js";
import {
  cleanupHandoffCopy,
  collectWorktreeDiff,
  DiffCollectionError,
} from "../src/worktree/collect-diff.js";
import { validateGitPatch } from "../src/patch/validate-patch.js";

const LIMITS = { maxFiles: 10, maxLines: 500, maxBytes: 200_000 };

function sh(args: string[]): void {
  const r = spawnSync("git", args, { shell: false });
  assert.equal(r.status, 0, `git ${args.join(" ")} failed: ${r.stderr?.toString()}`);
}

function setupRepo(opts: { trackedHandoff: boolean }): { repo: string; handoffRel: string } {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), "cd-test-"));
  sh(["-C", repo, "init", "-q"]);
  fs.writeFileSync(path.join(repo, "a.txt"), "hello\nworld\n");
  fs.mkdirSync(path.join(repo, "docs"), { recursive: true });
  const handoffRel = "docs/HANDOFF-x.md";
  if (opts.trackedHandoff) {
    fs.writeFileSync(path.join(repo, "docs", "HANDOFF-x.md"), "# tracked handoff\n");
  }
  sh(["-C", repo, "add", "-A"]);
  sh(["-C", repo, "-c", "user.name=t", "-c", "user.email=t@example.com", "commit", "-qm", "init"]);
  if (!opts.trackedHandoff) {
    fs.writeFileSync(path.join(repo, "docs", "HANDOFF-x.md"), "# untracked handoff\n");
  }
  return { repo, handoffRel };
}

test("collects modify, new-file, and deletion changes as a valid Git diff", async () => {
  const { repo } = setupRepo({ trackedHandoff: false });
  const wt = await createTempWorktree(repo);
  try {
    fs.writeFileSync(path.join(wt.path, "a.txt"), "hello\nedited\n"); // modify
    fs.writeFileSync(path.join(wt.path, "new.md"), "# new\n"); // create
    const diff = await collectWorktreeDiff(wt.path);
    const summary = validateGitPatch(diff, LIMITS);
    assert.deepEqual(summary.files.sort(), ["a.txt", "new.md"]);
    assert.ok(summary.additions >= 2);
  } finally {
    await removeTempWorktree(repo, wt);
  }
});

test("restores a tracked handoff copy so it never enters the diff", async () => {
  const { repo, handoffRel } = setupRepo({ trackedHandoff: true });
  const wt = await createTempWorktree(repo);
  try {
    // Simulate the bridge copy + Codex tampering with the handoff.
    fs.writeFileSync(path.join(wt.path, "docs", "HANDOFF-x.md"), "# tampered\n");
    fs.writeFileSync(path.join(wt.path, "a.txt"), "hello\nedited\n");
    await cleanupHandoffCopy(repo, wt.path, handoffRel);
    const diff = await collectWorktreeDiff(wt.path);
    const summary = validateGitPatch(diff, LIMITS);
    assert.deepEqual(summary.files, ["a.txt"]);
  } finally {
    await removeTempWorktree(repo, wt);
  }
});

test("deletes an untracked handoff copy so it never enters the diff", async () => {
  const { repo, handoffRel } = setupRepo({ trackedHandoff: false });
  const wt = await createTempWorktree(repo);
  try {
    // Bridge copies the untracked handoff into the worktree (creating dirs,
    // exactly like proposeViaWorktree does).
    fs.mkdirSync(path.join(wt.path, "docs"), { recursive: true });
    fs.writeFileSync(path.join(wt.path, "docs", "HANDOFF-x.md"), "# untracked handoff\n");
    fs.writeFileSync(path.join(wt.path, "a.txt"), "hello\nedited\n");
    await cleanupHandoffCopy(repo, wt.path, handoffRel);
    const diff = await collectWorktreeDiff(wt.path);
    const summary = validateGitPatch(diff, LIMITS);
    assert.deepEqual(summary.files, ["a.txt"]);
  } finally {
    await removeTempWorktree(repo, wt);
  }
});

test("throws when Codex made no changes", async () => {
  const { repo } = setupRepo({ trackedHandoff: false });
  const wt = await createTempWorktree(repo);
  try {
    await assert.rejects(() => collectWorktreeDiff(wt.path), DiffCollectionError);
  } finally {
    await removeTempWorktree(repo, wt);
  }
});
