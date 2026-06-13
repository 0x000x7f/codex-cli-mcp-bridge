import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { codexReviewPatch, ReviewRejected, buildReviewPrompt } from "../src/tools/codex-review-patch.js";
import { diffSha256 } from "../src/patch/diff-summary.js";

function sh(args: string[]): void {
  const r = spawnSync("git", args, { shell: false });
  assert.equal(r.status, 0, `git ${args.join(" ")} failed: ${r.stderr?.toString()}`);
}

function setupRepo(): { repo: string; head: string } {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), "review-test-"));
  sh(["-C", repo, "init", "-q"]);
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

function porcelain(repo: string): string {
  return spawnSync("git", ["-C", repo, "status", "--porcelain"], { shell: false })
    .stdout.toString()
    .trim();
}

test("rejects a non-Git / invalid diff (validateGitPatch) without touching files", async () => {
  const { repo, head } = setupRepo();
  const bad = "not a diff";
  await assert.rejects(() =>
    codexReviewPatch(repo, { diff: bad, expected_sha256: diffSha256(bad), base_head: head }),
  );
  assert.equal(porcelain(repo), "");
});

test("rejects a hash mismatch", async () => {
  const { repo, head } = setupRepo();
  await assert.rejects(
    () => codexReviewPatch(repo, { diff: DIFF, expected_sha256: "deadbeef", base_head: head }),
    ReviewRejected,
  );
  assert.equal(porcelain(repo), "");
});

test("rejects a moved HEAD", async () => {
  const { repo } = setupRepo();
  await assert.rejects(
    () => codexReviewPatch(repo, { diff: DIFF, expected_sha256: diffSha256(DIFF), base_head: "0".repeat(40) }),
    ReviewRejected,
  );
  assert.equal(porcelain(repo), "");
});

test("rejects missing expected_sha256 / base_head", async () => {
  const { repo, head } = setupRepo();
  await assert.rejects(
    () => codexReviewPatch(repo, { diff: DIFF, expected_sha256: "", base_head: head }),
    ReviewRejected,
  );
  await assert.rejects(
    () => codexReviewPatch(repo, { diff: DIFF, expected_sha256: diffSha256(DIFF), base_head: "" }),
    ReviewRejected,
  );
});

test("the review prompt is read-only and asks for the fixed sections incl. the mojibake caveat", () => {
  const p = buildReviewPrompt(DIFF, "focus on tests");
  assert.match(p, /READ-ONLY/);
  assert.match(p, /Do not modify any files/);
  assert.match(p, /## Verdict/);
  assert.match(p, /LOW CONFIDENCE/);
  assert.match(p, /focus on tests/);
});

// Static guarantee: this tool never imports a mutating capability.
test("codex-review-patch source performs no writes / apply / commit", () => {
  // compiled test lives in dist/tests/ → repo root is two levels up
  const src = fs.readFileSync(
    path.join(import.meta.dirname, "..", "..", "src", "tools", "codex-review-patch.ts"),
    "utf8",
  );
  assert.doesNotMatch(src, /codex-apply|gitApply\b|writeFileSync|rmSync|"commit"|"add"/);
});
