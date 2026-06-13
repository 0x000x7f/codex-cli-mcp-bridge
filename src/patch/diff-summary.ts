import { createHash } from "node:crypto";

export interface NonAsciiReviewHints {
  /** Number of changed (+/-) lines that contain non-ASCII characters. */
  nonAsciiChangedLines: number;
  /** Files that appear to be near-full rewrites (most lines changed). */
  largeRewriteFiles: string[];
}

/** SHA-256 of the exact diff text — the value the approval is bound to. */
export function diffSha256(diff: string): string {
  return createHash("sha256").update(diff, "utf8").digest("hex");
}

/**
 * Surface (do NOT auto-judge) review hot spots. Non-ASCII characters on changed
 * lines are where Codex's full-file regeneration can inject mojibake (Phase 2B′
 * finding); we point a human's attention there rather than claiming "safe".
 */
export function nonAsciiReviewHints(diff: string, summaryFiles: string[]): NonAsciiReviewHints {
  let nonAsciiChangedLines = 0;
  const perFileChanged = new Map<string, number>();
  let currentFile: string | undefined;
  let inHunk = false;

  for (const line of diff.split(/\r?\n/)) {
    if (line.startsWith("diff --git ")) {
      const m = /^diff --git a\/(.+?) b\/(.+)$/.exec(line);
      currentFile = m ? m[2] : undefined;
      inHunk = false;
      continue;
    }
    if (line.startsWith("@@")) {
      inHunk = true;
      continue;
    }
    if (!inHunk) continue;
    if (line.startsWith("+") || line.startsWith("-")) {
      if (/[^\x00-\x7F]/.test(line)) nonAsciiChangedLines += 1;
      if (currentFile) perFileChanged.set(currentFile, (perFileChanged.get(currentFile) ?? 0) + 1);
    }
  }

  // Heuristic: a file with many changed lines is likely a near-full rewrite,
  // which raises the mojibake/unintended-change risk — flag for review.
  const largeRewriteFiles = [...perFileChanged.entries()]
    .filter(([, n]) => n >= 40)
    .map(([f]) => f)
    .filter((f) => summaryFiles.includes(f));

  return { nonAsciiChangedLines, largeRewriteFiles };
}
