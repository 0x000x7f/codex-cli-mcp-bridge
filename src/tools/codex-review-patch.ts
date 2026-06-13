import { runCodexExecReadOnly, type CodexRunResult } from "../codex/spawn.js";
import { extractFinalAgentMessage, extractErrorMessages } from "../codex/parse-output.js";
import { validateGitPatch, defaultLimits } from "../patch/validate-patch.js";
import { diffSha256 } from "../patch/diff-summary.js";
import { git } from "../worktree/run-git.js";

export class ReviewRejected extends Error {}

const STDERR_LIMIT = 2000;

/**
 * Read-only third-party review prompt. The reviewer is ANOTHER Codex pass over
 * a diff that the first Codex produced; it inspects the diff and may read files
 * for context, but writes nothing. Its verdict is ADVISORY — it never gates
 * codex_apply (docs/security.md). The mojibake caveat is stated to the model
 * because, on native Windows, the reviewer shares the same PowerShell CP932
 * read-path and cannot reliably detect read-path-induced corruption.
 */
export function buildReviewPrompt(diff: string, reviewFocus?: string): string {
  const focus = reviewFocus && reviewFocus.trim() !== ""
    ? `\nThe requester asked you to focus on: ${reviewFocus.trim()}\n`
    : "";
  return [
    "You are an independent, READ-ONLY code reviewer. Review the unified diff below.",
    "Do not modify any files. Do not run commands that change anything. You only produce a written review.",
    "You may read files in the repository for context, but your job is to judge this diff.",
    focus,
    "Return your review in EXACTLY these Markdown sections (keep headings verbatim, omit nothing):",
    "## Blocking issues",
    "## Non-blocking issues",
    "## Scope creep / unrelated changes",
    "## Oversized rewrite / excessive changes",
    "## Test suggestions",
    "## Security risks",
    "## Non-ASCII / mojibake risk",
    "(For the mojibake section: note that you may be reading text through the same encoding path that can corrupt non-ASCII characters, so treat your judgement here as LOW CONFIDENCE and never a substitute for human review.)",
    "## Verdict",
    "(Exactly one of: approve / request changes / needs human attention. This verdict is ADVISORY only; a human makes the final approval.)",
    "",
    "--- DIFF UNDER REVIEW ---",
    diff,
  ].join("\n");
}

export interface ReviewResult {
  review: string;
  files: string[];
}

/**
 * Phase 4 — advisory third-party review. Binds the reviewed diff to the one
 * codex_propose_patch produced (validate + sha256 + HEAD), runs a read-only
 * Codex review, and returns the review text. This tool NEVER writes files,
 * never calls codex_apply, and its result does not authorize any apply.
 */
export async function codexReviewPatch(
  workspaceRoot: string,
  args: { diff: string; expected_sha256: string; base_head: string; review_focus?: string },
): Promise<ReviewResult> {
  // Bind the reviewed diff to the proposed exact diff (review↔propose↔apply).
  if (typeof args.expected_sha256 !== "string" || args.expected_sha256.trim() === "") {
    throw new ReviewRejected("expected_sha256 is required");
  }
  if (typeof args.base_head !== "string" || args.base_head.trim() === "") {
    throw new ReviewRejected("base_head is required");
  }
  const summary = validateGitPatch(args.diff, defaultLimits());
  const actual = diffSha256(args.diff);
  if (actual !== args.expected_sha256.trim()) {
    throw new ReviewRejected(
      `diff hash mismatch: expected ${args.expected_sha256.trim()}, got ${actual}`,
    );
  }
  const head = (await git(["-C", workspaceRoot, "rev-parse", "HEAD"])).trim();
  if (head !== args.base_head.trim()) {
    throw new ReviewRejected(
      `workspace HEAD moved since the diff was proposed (now ${head}, expected ${args.base_head.trim()})`,
    );
  }

  // Log path/size only — never the diff body (docs/security.md §6).
  console.error(
    `[codex_review_patch] files=${summary.files.length} bytes=${Buffer.byteLength(args.diff, "utf8")}`,
  );

  const result = await runCodexExecReadOnly({
    workspaceRoot,
    prompt: buildReviewPrompt(args.diff, args.review_focus),
  });
  throwOnCodexFailure(result);
  return { review: extractFinalAgentMessage(result.stdout), files: summary.files };
}

function throwOnCodexFailure(result: CodexRunResult): void {
  if (result.timedOut) {
    throw new Error(
      `Codex run timed out and the process tree was terminated. stderr: ${truncate(result.stderr)}`,
    );
  }
  if (result.exitCode !== 0) {
    const errorEvents = extractErrorMessages(result.stdout);
    const detail =
      errorEvents.length > 0
        ? `error events: ${errorEvents.join(" | ")}`
        : `stderr: ${truncate(result.stderr)}`;
    throw new Error(`Codex exited with code ${result.exitCode}. ${detail}`);
  }
}

function truncate(s: string): string {
  return s.length > STDERR_LIMIT ? `${s.slice(0, STDERR_LIMIT)}…(truncated)` : s;
}
