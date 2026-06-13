import test from "node:test";
import assert from "node:assert/strict";
import { parseFileBlocks, FileBlockParseError } from "../src/patch/parse-file-blocks.js";

const LIMITS = { maxFiles: 10, maxFileBytes: 65_536, maxTotalBytes: 200_000 };
const OPTS = { limits: LIMITS, forbiddenPaths: ["docs/HANDOFF-x.md"] };

test("parses FILE and DELETE blocks", () => {
  const msg = [
    "===FILE: docs/new.md===",
    "# New",
    "body",
    "===END===",
    "",
    "===DELETE: old.txt===",
  ].join("\n");
  const blocks = parseFileBlocks(msg, OPTS);
  assert.equal(blocks.length, 2);
  assert.deepEqual(blocks[0], { kind: "write", path: "docs/new.md", content: "# New\nbody\n" });
  assert.deepEqual(blocks[1], { kind: "delete", path: "old.txt" });
});

test("rejects prose outside blocks", () => {
  const msg = ["Here is my change:", "===FILE: a.md===", "x", "===END==="].join("\n");
  assert.throws(
    () => parseFileBlocks(msg, OPTS),
    (e: unknown) => e instanceof FileBlockParseError && /outside FILE\/DELETE/.test(e.message),
  );
});

test("rejects an unterminated FILE block", () => {
  const msg = ["===FILE: a.md===", "x"].join("\n");
  assert.throws(() => parseFileBlocks(msg, OPTS), FileBlockParseError);
});

test("rejects duplicate paths", () => {
  const msg = [
    "===FILE: a.md===",
    "x",
    "===END===",
    "===DELETE: a.md===",
  ].join("\n");
  assert.throws(
    () => parseFileBlocks(msg, OPTS),
    (e: unknown) => e instanceof FileBlockParseError && /duplicate/.test(e.message),
  );
});

test("rejects unsafe paths (absolute, traversal, .git, backslash)", () => {
  for (const bad of ["C:/evil.md", "/etc/passwd", "../escape.md", ".git/config", "docs\\win.md"]) {
    const msg = [`===FILE: ${bad}===`, "x", "===END==="].join("\n");
    assert.throws(() => parseFileBlocks(msg, OPTS), FileBlockParseError, bad);
  }
});

test("rejects modification of the handoff document itself", () => {
  const msg = ["===FILE: docs/HANDOFF-x.md===", "tampered", "===END==="].join("\n");
  assert.throws(
    () => parseFileBlocks(msg, OPTS),
    (e: unknown) => e instanceof FileBlockParseError && /handoff/.test(e.message),
  );
  assert.throws(() => parseFileBlocks("===DELETE: docs/HANDOFF-x.md===", OPTS), FileBlockParseError);
});

test("rejects binary content (NUL byte)", () => {
  const msg = ["===FILE: bin.dat===", "ab\0cd", "===END==="].join("\n");
  assert.throws(() => parseFileBlocks(msg, OPTS), FileBlockParseError);
});

test("enforces per-file, total, and count limits", () => {
  const big = "x".repeat(100);
  const msg = [`===FILE: a.md===`, big, "===END==="].join("\n");
  assert.throws(
    () => parseFileBlocks(msg, { ...OPTS, limits: { ...LIMITS, maxFileBytes: 10 } }),
    FileBlockParseError,
  );
  assert.throws(
    () => parseFileBlocks(msg, { ...OPTS, limits: { ...LIMITS, maxTotalBytes: 10 } }),
    FileBlockParseError,
  );
  const many = ["===DELETE: a.md===", "===DELETE: b.md==="].join("\n");
  assert.throws(
    () => parseFileBlocks(many, { ...OPTS, limits: { ...LIMITS, maxFiles: 1 } }),
    FileBlockParseError,
  );
});

test("rejects empty output and carries the raw message", () => {
  assert.throws(
    () => parseFileBlocks("", OPTS),
    (e: unknown) => e instanceof FileBlockParseError,
  );
  assert.throws(
    () => parseFileBlocks("just some prose", OPTS),
    (e: unknown) => e instanceof FileBlockParseError && e.rawOutput.includes("just some prose"),
  );
});

test("allows an empty FILE body (zero-byte file)", () => {
  const msg = ["===FILE: empty.txt===", "===END==="].join("\n");
  const blocks = parseFileBlocks(msg, OPTS);
  assert.deepEqual(blocks, [{ kind: "write", path: "empty.txt", content: "" }]);
});
