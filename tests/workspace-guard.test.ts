import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { resolveInsideWorkspace, WorkspaceGuardError } from "../src/safety/workspace-guard.js";

function setup(): { base: string; root: string; evil: string } {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "guard-test-"));
  const root = path.join(base, "repo");
  const evil = `${root}-evil`; // sibling sharing the root as a string prefix
  fs.mkdirSync(path.join(root, "docs"), { recursive: true });
  fs.mkdirSync(evil, { recursive: true });
  fs.writeFileSync(path.join(root, "docs", "handoff.md"), "# h\n");
  fs.writeFileSync(path.join(evil, "secret.md"), "# s\n");
  fs.writeFileSync(path.join(base, "outside.md"), "# o\n");
  return { base, root, evil };
}

test("accepts a relative path inside the workspace", () => {
  const { root } = setup();
  const r = resolveInsideWorkspace(root, path.join("docs", "handoff.md"));
  assert.equal(r.size, 4);
  assert.ok(r.absPath.endsWith("handoff.md"));
  assert.equal(r.relPath, path.join("docs", "handoff.md"));
});

test("rejects .. traversal", () => {
  const { root } = setup();
  assert.throws(() => resolveInsideWorkspace(root, path.join("..", "outside.md")), WorkspaceGuardError);
});

test("rejects an absolute path outside the workspace", () => {
  const { root, base } = setup();
  assert.throws(
    () => resolveInsideWorkspace(root, path.join(base, "outside.md")),
    WorkspaceGuardError,
  );
});

test("rejects sibling directory sharing the root prefix (repo vs repo-evil)", () => {
  const { root, evil } = setup();
  assert.throws(
    () => resolveInsideWorkspace(root, path.join(evil, "secret.md")),
    WorkspaceGuardError,
  );
});

test("rejects a directory", () => {
  const { root } = setup();
  assert.throws(() => resolveInsideWorkspace(root, "docs"), WorkspaceGuardError);
});

test("rejects a missing file", () => {
  const { root } = setup();
  assert.throws(() => resolveInsideWorkspace(root, path.join("docs", "nope.md")), WorkspaceGuardError);
});
