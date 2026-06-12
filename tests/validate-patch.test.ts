import test from "node:test";
import assert from "node:assert/strict";
import { validateGitPatch, PatchValidationError } from "../src/patch/validate-patch.js";

const LIMITS = { maxFiles: 10, maxLines: 500, maxBytes: 200_000 };

function gitDiff(lines: string[]): string {
  return `${lines.join("\n")}\n`;
}

const MODIFY = gitDiff([
  "diff --git a/src/a.ts b/src/a.ts",
  "--- a/src/a.ts",
  "+++ b/src/a.ts",
  "@@ -1,3 +1,3 @@",
  " const x = 1;",
  "-const y = 2;",
  "+const y = 3;",
  " export {};",
]);

const NEW_FILE = gitDiff([
  "diff --git a/docs/new.md b/docs/new.md",
  "new file mode 100644",
  "--- /dev/null",
  "+++ b/docs/new.md",
  "@@ -0,0 +1,2 @@",
  "+# New",
  "+body",
]);

const DELETE_FILE = gitDiff([
  "diff --git a/old.txt b/old.txt",
  "deleted file mode 100644",
  "--- a/old.txt",
  "+++ /dev/null",
  "@@ -1 +0,0 @@",
  "-bye",
]);

test("accepts a modify diff and counts changes", () => {
  const s = validateGitPatch(MODIFY, LIMITS);
  assert.deepEqual(s.files, ["src/a.ts"]);
  assert.equal(s.additions, 1);
  assert.equal(s.deletions, 1);
});

test("accepts new-file and delete-file diffs (/dev/null)", () => {
  assert.deepEqual(validateGitPatch(NEW_FILE, LIMITS).files, ["docs/new.md"]);
  assert.deepEqual(validateGitPatch(DELETE_FILE, LIMITS).files, ["old.txt"]);
});

test("rejects non-git unified diffs", () => {
  const nonGit = gitDiff(["--- old/a.txt", "+++ new/a.txt", "@@ -1 +1 @@", "-a", "+b"]);
  assert.throws(() => validateGitPatch(nonGit, LIMITS), PatchValidationError);
});

test("rejects absolute paths", () => {
  const d = gitDiff([
    "diff --git a/C:/evil.txt b/C:/evil.txt",
    "--- a/C:/evil.txt",
    "+++ b/C:/evil.txt",
    "@@ -1 +1 @@",
    "-a",
    "+b",
  ]);
  assert.throws(() => validateGitPatch(d, LIMITS), PatchValidationError);
});

test("rejects path traversal", () => {
  const d = gitDiff([
    "diff --git a/../outside.txt b/../outside.txt",
    "--- a/../outside.txt",
    "+++ b/../outside.txt",
    "@@ -1 +1 @@",
    "-a",
    "+b",
  ]);
  assert.throws(() => validateGitPatch(d, LIMITS), PatchValidationError);
});

test("rejects .git paths", () => {
  const d = gitDiff([
    "diff --git a/.git/config b/.git/config",
    "--- a/.git/config",
    "+++ b/.git/config",
    "@@ -1 +1 @@",
    "-a",
    "+b",
  ]);
  assert.throws(() => validateGitPatch(d, LIMITS), PatchValidationError);
});

test("rejects binary patches", () => {
  const d = gitDiff([
    "diff --git a/img.png b/img.png",
    "GIT binary patch",
    "literal 10",
  ]);
  assert.throws(() => validateGitPatch(d, LIMITS), PatchValidationError);
});

test("rejects header mismatch between diff --git and ---/+++", () => {
  const d = gitDiff([
    "diff --git a/src/a.ts b/src/a.ts",
    "--- a/src/other.ts",
    "+++ b/src/a.ts",
    "@@ -1 +1 @@",
    "-a",
    "+b",
  ]);
  assert.throws(() => validateGitPatch(d, LIMITS), PatchValidationError);
});

test("enforces the file-count limit", () => {
  const two = MODIFY + NEW_FILE;
  assert.throws(
    () => validateGitPatch(two, { ...LIMITS, maxFiles: 1 }),
    PatchValidationError,
  );
});

test("enforces the changed-lines limit", () => {
  assert.throws(
    () => validateGitPatch(MODIFY, { ...LIMITS, maxLines: 1 }),
    PatchValidationError,
  );
});

test("enforces the byte-size limit", () => {
  assert.throws(
    () => validateGitPatch(MODIFY, { ...LIMITS, maxBytes: 10 }),
    PatchValidationError,
  );
});

test("validates rename paths", () => {
  const d = gitDiff([
    "diff --git a/src/a.ts b/src/b.ts",
    "rename from src/a.ts",
    "rename to ../escape.ts",
    "--- a/src/a.ts",
    "+++ b/src/b.ts",
  ]);
  assert.throws(() => validateGitPatch(d, LIMITS), PatchValidationError);
});
