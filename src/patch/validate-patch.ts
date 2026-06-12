export class PatchValidationError extends Error {}

export interface PatchLimits {
  maxFiles: number;
  maxLines: number;
  maxBytes: number;
}

export interface PatchSummary {
  files: string[];
  additions: number;
  deletions: number;
}

export function defaultLimits(): PatchLimits {
  return {
    maxFiles: intEnv("CODEX_BRIDGE_MAX_PATCH_FILES", 10),
    maxLines: intEnv("CODEX_BRIDGE_MAX_PATCH_LINES", 500),
    maxBytes: intEnv("CODEX_BRIDGE_MAX_PATCH_BYTES", 200_000),
  };
}

function intEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/**
 * Validate a Git-format unified diff against Phase 2 safety rules.
 *
 * Accepted input is Git format only: every file section starts with
 * `diff --git a/<path> b/<path>`. Non-git unified diffs are rejected.
 * Binary patches are rejected. Paths must be repository-relative, must not
 * traverse with `..`, and must not touch `.git/`. `/dev/null` is allowed for
 * file creation/deletion, with consistency checks across the
 * `diff --git` / `---` / `+++` headers. Size limits guard against oversized
 * changes (docs/security.md failure-mode table).
 */
export function validateGitPatch(diff: string, limits: PatchLimits): PatchSummary {
  const bytes = Buffer.byteLength(diff, "utf8");
  if (bytes > limits.maxBytes) {
    throw new PatchValidationError(
      `patch too large: ${bytes} bytes (limit ${limits.maxBytes})`,
    );
  }

  const lines = diff.split(/\r?\n/);

  const firstContent = lines.find((l) => l.trim() !== "");
  if (firstContent === undefined || !firstContent.startsWith("diff --git a/")) {
    throw new PatchValidationError(
      "only Git unified diffs are accepted: the patch must start with `diff --git a/<path> b/<path>`",
    );
  }

  const files: string[] = [];
  let additions = 0;
  let deletions = 0;
  let currentA: string | undefined;
  let currentB: string | undefined;

  for (const line of lines) {
    if (line.startsWith("GIT binary patch") || line.startsWith("Binary files ")) {
      throw new PatchValidationError("binary patches are not accepted in Phase 2");
    }

    if (line.startsWith("diff --git ")) {
      const m = /^diff --git a\/(.+?) b\/(.+)$/.exec(line);
      if (!m) {
        throw new PatchValidationError(`unparsable diff --git header: ${line}`);
      }
      currentA = m[1];
      currentB = m[2];
      assertSafeRepoPath(currentA);
      assertSafeRepoPath(currentB);
      if (!files.includes(currentB)) files.push(currentB);
      continue;
    }

    if (line.startsWith("--- ")) {
      const value = line.slice(4).trim();
      if (value !== "/dev/null") {
        if (currentA === undefined || value !== `a/${currentA}`) {
          throw new PatchValidationError(
            `--- header does not match the diff --git header: ${line}`,
          );
        }
      }
      continue;
    }

    if (line.startsWith("+++ ")) {
      const value = line.slice(4).trim();
      if (value !== "/dev/null") {
        if (currentB === undefined || value !== `b/${currentB}`) {
          throw new PatchValidationError(
            `+++ header does not match the diff --git header: ${line}`,
          );
        }
      }
      continue;
    }

    if (
      line.startsWith("rename from ") ||
      line.startsWith("rename to ") ||
      line.startsWith("copy from ") ||
      line.startsWith("copy to ")
    ) {
      const value = line.replace(/^(rename|copy) (from|to) /, "").trim();
      assertSafeRepoPath(value);
      continue;
    }

    if (line.startsWith("+")) additions += 1;
    else if (line.startsWith("-")) deletions += 1;
  }

  if (files.length === 0) {
    throw new PatchValidationError("no file sections found in the patch");
  }
  if (files.length > limits.maxFiles) {
    throw new PatchValidationError(
      `patch touches ${files.length} files (limit ${limits.maxFiles})`,
    );
  }
  const changed = additions + deletions;
  if (changed > limits.maxLines) {
    throw new PatchValidationError(
      `patch changes ${changed} lines (limit ${limits.maxLines})`,
    );
  }

  return { files, additions, deletions };
}

function assertSafeRepoPath(p: string): void {
  if (p === "/dev/null") return;
  if (p.startsWith("/") || /^[A-Za-z]:[\\/]/.test(p)) {
    throw new PatchValidationError(`absolute path in patch: ${p}`);
  }
  if (p.includes("\\")) {
    throw new PatchValidationError(`backslash in patch path (git paths use /): ${p}`);
  }
  if (p.split("/").some((seg) => seg === "..")) {
    throw new PatchValidationError(`path traversal in patch: ${p}`);
  }
  if (p === ".git" || p.startsWith(".git/")) {
    throw new PatchValidationError(`patch touches .git: ${p}`);
  }
}
