import test from "node:test";
import assert from "node:assert/strict";
import { diffSha256, nonAsciiReviewHints } from "../src/patch/diff-summary.js";

test("diffSha256 is stable and length-64 hex", () => {
  const h = diffSha256("hello\n");
  assert.match(h, /^[0-9a-f]{64}$/);
  assert.equal(h, diffSha256("hello\n"));
  assert.notEqual(h, diffSha256("hello!\n"));
});

test("counts non-ASCII changed lines inside hunks only", () => {
  const diff = [
    "diff --git a/a.md b/a.md",
    "--- a/a.md",
    "+++ b/a.md",
    "@@ -1,2 +1,2 @@",
    "-古い行", // non-ASCII deletion
    "+new ascii line", // ascii addition
    " 文脈行", // context (not counted)
    "",
  ].join("\n");
  const h = nonAsciiReviewHints(diff, ["a.md"]);
  assert.equal(h.nonAsciiChangedLines, 1);
});

test("does not count the ---/+++ header paths as changed lines", () => {
  const diff = [
    "diff --git a/日本語.md b/日本語.md",
    "--- a/日本語.md",
    "+++ b/日本語.md",
    "@@ -1 +1 @@",
    "-a",
    "+b",
    "",
  ].join("\n");
  const h = nonAsciiReviewHints(diff, ["日本語.md"]);
  assert.equal(h.nonAsciiChangedLines, 0); // header paths have non-ASCII but are not hunk content
});

test("flags near-full rewrites among summary files", () => {
  const body = ["diff --git a/big.txt b/big.txt", "--- a/big.txt", "+++ b/big.txt", "@@ -1,50 +1,50 @@"];
  for (let i = 0; i < 50; i++) body.push(`-old${i}`, `+new${i}`);
  const diff = `${body.join("\n")}\n`;
  const h = nonAsciiReviewHints(diff, ["big.txt"]);
  assert.deepEqual(h.largeRewriteFiles, ["big.txt"]);
});
