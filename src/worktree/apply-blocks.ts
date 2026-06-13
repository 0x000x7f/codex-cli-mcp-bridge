import fs from "node:fs";
import path from "node:path";
import type { ProposalBlock } from "../patch/parse-file-blocks.js";

export class BlockApplyError extends Error {}

/**
 * Bridge-applied writes (Strategy B′): the bridge — not Codex — materializes
 * the proposal inside the disposable worktree. Paths were already validated by
 * parseFileBlocks; this layer enforces delete semantics and logs path + bytes
 * only (never content — docs/security.md §6).
 */
export function applyBlocksToWorktree(wtPath: string, blocks: ProposalBlock[]): void {
  for (const block of blocks) {
    const abs = path.join(wtPath, ...block.path.split("/"));
    if (block.kind === "write") {
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.writeFileSync(abs, block.content);
      console.error(
        `[codex_propose_patch] write path=${block.path} bytes=${Buffer.byteLength(block.content, "utf8")}`,
      );
    } else {
      if (!fs.existsSync(abs)) {
        throw new BlockApplyError(`DELETE target does not exist: ${block.path}`);
      }
      const stat = fs.lstatSync(abs);
      if (!stat.isFile()) {
        throw new BlockApplyError(`DELETE target is not a regular file: ${block.path}`);
      }
      fs.rmSync(abs);
      console.error(`[codex_propose_patch] delete path=${block.path}`);
    }
  }
}
