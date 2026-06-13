import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { codexApply, ApplyRejected } from "../src/tools/codex-apply.js";
import { diffSha256 } from "../src/patch/diff-summary.js";

function sh(args: string[]): void {
  const r = spawnSync("git", args, { shell: false });
  assert.equal(r.status, 0, `git ${args.join(" ")} failed: ${r.stderr?.toString()}`);
}

function setupRepo(): { repo: string; head: string } {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), "apply-test-"));
  sh(["-C", repo, "init", "-q"]);
  // Isolate from the machine's global core.autocrlf so line endings are
  // deterministic across dev machines.
  sh(["-C", repo, "config", "core.autocrlf", "false"]);
  fs.writeFileSync(path.join(repo, "a.txt"), "hello\nworld\n");
  sh(["-C", repo, "add", "-A"]);
  sh(["-C", repo, "-c", "user.name=t", "-c", "user.email=t@example.com", "commit", "-qm", "init"]);
  const head = spawnSync("git", ["-C", repo, "rev-parse", "HEAD"], { shell: false })
    .stdout.toString()
    .trim();
  return { repo, head };
}

const DIFF = [
  "diff --git a/a.txt b/a.txt",
  "--- a/a.txt",
  "+++ b/a.txt",
  "@@ -1,2 +1,2 @@",
  "-hello",
  "+goodbye",
  " world",
  "",
].join("\n");

function validArgs(head: string) {
  return { diff: DIFF, approval: true as const, expected_sha256: diffSha256(DIFF), base_head: head };
}

function porcelain(repo: string): string {
  return spawnSync("git", ["-C", repo, "status", "--porcelain"], { shell: false })
    .stdout.toString()
    .trim();
}

test("applies a reviewed diff to the working tree without staging", async () => {
  const { repo, head } = setupRepo();
  const r = await codexApply(repo, validArgs(head));
  assert.deepEqual(r.files, ["a.txt"]);
  assert.equal(fs.readFileSync(path.join(repo, "a.txt"), "utf8"), "goodbye\nworld\n");
  // working tree changed but nothing staged
  const staged = spawnSync("git", ["-C", repo, "diff", "--cached", "--name-only"], { shell: false })
    .stdout.toString()
    .trim();
  assert.equal(staged, "", "must not stage changes");
});

test("rejects approval !== true (false, string, number) and leaves tree clean", async () => {
  for (const bad of [false, "true", 1, undefined]) {
    const { repo, head } = setupRepo();
    await assert.rejects(
      () => codexApply(repo, { ...validArgs(head), approval: bad as never }),
      ApplyRejected,
    );
    assert.equal(porcelain(repo), "", "tree must stay clean");
  }
});

test("rejects a hash mismatch", async () => {
  const { repo, head } = setupRepo();
  await assert.rejects(
    () => codexApply(repo, { ...validArgs(head), expected_sha256: "deadbeef" }),
    ApplyRejected,
  );
  assert.equal(porcelain(repo), "");
});

test("rejects a moved HEAD", async () => {
  const { repo } = setupRepo();
  await assert.rejects(
    () => codexApply(repo, { ...validArgs("0".repeat(40)) }),
    ApplyRejected,
  );
  assert.equal(porcelain(repo), "");
});

test("rejects a dirty tree", async () => {
  const { repo, head } = setupRepo();
  fs.writeFileSync(path.join(repo, "a.txt"), "dirty\n");
  await assert.rejects(() => codexApply(repo, validArgs(head)), ApplyRejected);
});

test("rejects missing expected_sha256 / base_head", async () => {
  const { repo, head } = setupRepo();
  await assert.rejects(
    () => codexApply(repo, { ...validArgs(head), expected_sha256: "" }),
    ApplyRejected,
  );
  await assert.rejects(() => codexApply(repo, { ...validArgs(head), base_head: "" }), ApplyRejected);
});

test("rejects a diff that does not apply (and keeps the tree clean)", async () => {
  const { repo, head } = setupRepo();
  const bad = [
    "diff --git a/a.txt b/a.txt",
    "--- a/a.txt",
    "+++ b/a.txt",
    "@@ -1,2 +1,2 @@",
    "-nonexistent line",
    "+x",
    " world",
    "",
  ].join("\n");
  await assert.rejects(
    () => codexApply(repo, { diff: bad, approval: true, expected_sha256: diffSha256(bad), base_head: head }),
  );
  assert.equal(porcelain(repo), "");
});
