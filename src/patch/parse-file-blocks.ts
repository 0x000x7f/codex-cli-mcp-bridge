export class FileBlockParseError extends Error {
  readonly rawOutput: string;

  constructor(message: string, rawOutput: string) {
    super(message);
    this.rawOutput = rawOutput;
  }
}

export interface FileBlock {
  kind: "write";
  path: string;
  content: string;
}

export interface DeleteBlock {
  kind: "delete";
  path: string;
}

export type ProposalBlock = FileBlock | DeleteBlock;

export interface RewriteLimits {
  maxFiles: number;
  maxFileBytes: number;
  maxTotalBytes: number;
}

export function defaultRewriteLimits(): RewriteLimits {
  return {
    maxFiles: intEnv("CODEX_BRIDGE_MAX_REWRITE_FILES", 10),
    maxFileBytes: intEnv("CODEX_BRIDGE_MAX_REWRITE_FILE_BYTES", 65_536),
    maxTotalBytes: intEnv("CODEX_BRIDGE_MAX_REWRITE_TOTAL_BYTES", 200_000),
  };
}

function intEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/**
 * Parse the strict Strategy B′ output format:
 *
 *   ===FILE: relative/path===
 *   <complete file contents>
 *   ===END===
 *
 *   ===DELETE: relative/path===
 *
 * Safety-first parsing (Phase 2B review constraints): any text outside blocks
 * is an ERROR, duplicate paths are rejected, paths must be repo-relative
 * forward-slash paths (no absolute, no `..`, no `.git/`, no backslash), the
 * handoff document itself may not be touched, NUL bytes (binary) are rejected,
 * and per-file / total / count limits apply.
 */
export function parseFileBlocks(
  agentMessage: string,
  opts: { limits: RewriteLimits; forbiddenPaths: string[] },
): ProposalBlock[] {
  const lines = agentMessage.split(/\r?\n/);
  const blocks: ProposalBlock[] = [];
  const seen = new Set<string>();
  let totalBytes = 0;
  let i = 0;

  while (i < lines.length) {
    const trimmed = lines[i].trim();
    if (trimmed === "") {
      i += 1;
      continue;
    }

    const fileHeader = /^===FILE: (.+?)===$/.exec(trimmed);
    if (fileHeader) {
      const p = fileHeader[1].trim();
      assertSafeBlockPath(p, opts.forbiddenPaths, agentMessage);
      if (seen.has(p)) {
        throw new FileBlockParseError(`duplicate path in blocks: ${p}`, agentMessage);
      }
      seen.add(p);

      i += 1;
      const content: string[] = [];
      let closed = false;
      while (i < lines.length) {
        if (lines[i].trim() === "===END===") {
          closed = true;
          i += 1;
          break;
        }
        content.push(lines[i]);
        i += 1;
      }
      if (!closed) {
        throw new FileBlockParseError(`unterminated FILE block for: ${p}`, agentMessage);
      }

      const body = content.length === 0 ? "" : `${content.join("\n")}\n`;
      if (body.includes("\0")) {
        throw new FileBlockParseError(`binary content is not accepted: ${p}`, agentMessage);
      }
      const bytes = Buffer.byteLength(body, "utf8");
      if (bytes > opts.limits.maxFileBytes) {
        throw new FileBlockParseError(
          `FILE block too large: ${p} is ${bytes} bytes (limit ${opts.limits.maxFileBytes})`,
          agentMessage,
        );
      }
      totalBytes += bytes;
      blocks.push({ kind: "write", path: p, content: body });
      continue;
    }

    const deleteHeader = /^===DELETE: (.+?)===$/.exec(trimmed);
    if (deleteHeader) {
      const p = deleteHeader[1].trim();
      assertSafeBlockPath(p, opts.forbiddenPaths, agentMessage);
      if (seen.has(p)) {
        throw new FileBlockParseError(`duplicate path in blocks: ${p}`, agentMessage);
      }
      seen.add(p);
      blocks.push({ kind: "delete", path: p });
      i += 1;
      continue;
    }

    // Strictness chosen in review: prose outside blocks fails the proposal.
    throw new FileBlockParseError(
      `unexpected text outside FILE/DELETE blocks: "${trimmed.slice(0, 80)}"`,
      agentMessage,
    );
  }

  if (blocks.length === 0) {
    throw new FileBlockParseError("no FILE/DELETE blocks found in Codex output", agentMessage);
  }
  if (blocks.length > opts.limits.maxFiles) {
    throw new FileBlockParseError(
      `too many blocks: ${blocks.length} (limit ${opts.limits.maxFiles})`,
      agentMessage,
    );
  }
  if (totalBytes > opts.limits.maxTotalBytes) {
    throw new FileBlockParseError(
      `total FILE content too large: ${totalBytes} bytes (limit ${opts.limits.maxTotalBytes})`,
      agentMessage,
    );
  }
  return blocks;
}

function assertSafeBlockPath(p: string, forbiddenPaths: string[], raw: string): void {
  if (p === "" ) throw new FileBlockParseError("empty path in block header", raw);
  if (p.startsWith("/") || /^[A-Za-z]:[\\/]/.test(p)) {
    throw new FileBlockParseError(`absolute path in block: ${p}`, raw);
  }
  if (p.includes("\\")) {
    throw new FileBlockParseError(`backslash in block path (use forward slashes): ${p}`, raw);
  }
  if (p.split("/").some((seg) => seg === "..")) {
    throw new FileBlockParseError(`path traversal in block: ${p}`, raw);
  }
  if (p === ".git" || p.startsWith(".git/")) {
    throw new FileBlockParseError(`block touches .git: ${p}`, raw);
  }
  if (forbiddenPaths.includes(p)) {
    throw new FileBlockParseError(
      `the handoff document itself must not be modified or deleted: ${p}`,
      raw,
    );
  }
}
