import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { applyBlocksToWorktree, BlockApplyError } from "../src/worktree/apply-blocks.js";

function setupDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "blocks-test-"));
  fs.writeFileSync(path.join(dir, "a.txt"), "old\n");
  return dir;
}

test("writes new files (creating parents), overwrites existing, deletes files", () => {
  const dir = setupDir();
  applyBlocksToWorktree(dir, [
    { kind: "write", path: "docs/sub/new.md", content: "# new\n" },
    { kind: "write", path: "a.txt", content: "replaced\n" },
  ]);
  assert.equal(fs.readFileSync(path.join(dir, "docs", "sub", "new.md"), "utf8"), "# new\n");
  assert.equal(fs.readFileSync(path.join(dir, "a.txt"), "utf8"), "replaced\n");

  applyBlocksToWorktree(dir, [{ kind: "delete", path: "a.txt" }]);
  assert.equal(fs.existsSync(path.join(dir, "a.txt")), false);
});

test("rejects deleting a missing file", () => {
  const dir = setupDir();
  assert.throws(
    () => applyBlocksToWorktree(dir, [{ kind: "delete", path: "nope.txt" }]),
    BlockApplyError,
  );
});

test("rejects deleting a directory", () => {
  const dir = setupDir();
  fs.mkdirSync(path.join(dir, "docs"));
  assert.throws(
    () => applyBlocksToWorktree(dir, [{ kind: "delete", path: "docs" }]),
    BlockApplyError,
  );
});
