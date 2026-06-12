import test from "node:test";
import assert from "node:assert/strict";
import { extractSingleDiffFence, DiffExtractionError } from "../src/patch/extract-diff.js";

const DIFF_BODY = [
  "diff --git a/a.txt b/a.txt",
  "--- a/a.txt",
  "+++ b/a.txt",
  "@@ -1 +1 @@",
  "-hello",
  "+world",
].join("\n");

test("extracts the diff body from a single fence, ignoring surrounding prose", () => {
  const message = `Here is the patch:\n\n\`\`\`diff\n${DIFF_BODY}\n\`\`\`\n\nLet me know.`;
  const diff = extractSingleDiffFence(message);
  assert.ok(diff.startsWith("diff --git a/a.txt"));
  assert.ok(diff.endsWith("\n"));
  assert.ok(!diff.includes("Here is the patch"));
});

test("errors when no diff fence exists", () => {
  assert.throws(
    () => extractSingleDiffFence("no fence here"),
    (e: unknown) => e instanceof DiffExtractionError && e.rawOutput.includes("no fence here"),
  );
});

test("errors when two diff fences exist", () => {
  const message = `\`\`\`diff\n${DIFF_BODY}\n\`\`\`\n\`\`\`diff\n${DIFF_BODY}\n\`\`\``;
  assert.throws(() => extractSingleDiffFence(message), DiffExtractionError);
});

test("errors when the fence is empty", () => {
  assert.throws(() => extractSingleDiffFence("```diff\n\n```"), DiffExtractionError);
});
