import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { gitApplyCheck, ApplyCheckError } from "../src/patch/apply-check.js";

function setupRepo(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "applycheck-"));
  const r = spawnSync("git", ["-C", dir, "init", "-q"], { shell: false });
  assert.equal(r.status, 0, "git init failed");
  fs.writeFileSync(path.join(dir, "a.txt"), "hello\n");
  return dir;
}

const VALID = [
  "diff --git a/a.txt b/a.txt",
  "--- a/a.txt",
  "+++ b/a.txt",
  "@@ -1 +1 @@",
  "-hello",
  "+world",
  "",
].join("\n");

const BAD_CONTEXT = [
  "diff --git a/a.txt b/a.txt",
  "--- a/a.txt",
  "+++ b/a.txt",
  "@@ -1 +1 @@",
  "-goodbye",
  "+world",
  "",
].join("\n");

test("passes a clean patch and does not modify the tree", async () => {
  const dir = setupRepo();
  await gitApplyCheck(dir, VALID);
  assert.equal(fs.readFileSync(path.join(dir, "a.txt"), "utf8"), "hello\n");
});

test("rejects a patch whose context does not match", async () => {
  const dir = setupRepo();
  await assert.rejects(
    () => gitApplyCheck(dir, BAD_CONTEXT),
    (e: unknown) => e instanceof ApplyCheckError && e.detail.length > 0,
  );
});
