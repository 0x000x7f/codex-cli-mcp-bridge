import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import {
  assertCleanWorkspace,
  createTempWorktree,
  assertWorktreeIntact,
  removeTempWorktree,
  WorktreeError,
} from "../src/worktree/temp-worktree.js";

function sh(args: string[], cwd?: string): void {
  const r = spawnSync("git", args, { shell: false, cwd });
  assert.equal(r.status, 0, `git ${args.join(" ")} failed: ${r.stderr?.toString()}`);
}

function setupRepo(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "wt-test-"));
  sh(["-C", dir, "init", "-q"]);
  fs.writeFileSync(path.join(dir, "a.txt"), "hello\n");
  sh(["-C", dir, "add", "-A"]);
  sh(["-C", dir, "-c", "user.name=t", "-c", "user.email=t@example.com", "commit", "-qm", "init"]);
  return dir;
}

function worktreeCount(repo: string): number {
  const r = spawnSync("git", ["-C", repo, "worktree", "list", "--porcelain"], { shell: false });
  return r.stdout
    .toString()
    .split(/\r?\n/)
    .filter((l) => l.startsWith("worktree ")).length;
}

test("assertCleanWorkspace passes on clean and rejects dirty trees", async () => {
  const repo = setupRepo();
  await assertCleanWorkspace(repo);
  fs.writeFileSync(path.join(repo, "a.txt"), "dirty\n");
  await assert.rejects(() => assertCleanWorkspace(repo), WorktreeError);
});

test("creates a detached worktree from HEAD and removes it without residue", async () => {
  const repo = setupRepo();
  const before = worktreeCount(repo);
  const wt = await createTempWorktree(repo);
  assert.ok(fs.existsSync(path.join(wt.path, "a.txt")));
  assert.equal(worktreeCount(repo), before + 1);
  await assertWorktreeIntact(wt);

  const warnings = await removeTempWorktree(repo, wt);
  assert.deepEqual(warnings, []);
  assert.equal(fs.existsSync(wt.path), false);
  assert.equal(fs.existsSync(wt.baseDir), false);
  assert.equal(worktreeCount(repo), before);
});

test("detects a commit made inside the worktree", async () => {
  const repo = setupRepo();
  const wt = await createTempWorktree(repo);
  try {
    fs.writeFileSync(path.join(wt.path, "a.txt"), "changed\n");
    sh(["-C", wt.path, "add", "-A"]);
    sh([
      "-C", wt.path,
      "-c", "user.name=t",
      "-c", "user.email=t@example.com",
      "commit", "-qm", "rogue",
    ]);
    await assert.rejects(() => assertWorktreeIntact(wt), WorktreeError);
  } finally {
    await removeTempWorktree(repo, wt);
  }
});

test("detects a branch checkout inside the worktree", async () => {
  const repo = setupRepo();
  const wt = await createTempWorktree(repo);
  try {
    sh(["-C", wt.path, "checkout", "-q", "-b", "rogue-branch"]);
    await assert.rejects(() => assertWorktreeIntact(wt), WorktreeError);
  } finally {
    await removeTempWorktree(repo, wt);
  }
});
