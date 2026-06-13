import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { codexPlan } from "./tools/codex-plan.js";
import { codexProposePatch } from "./tools/codex-propose-patch.js";
import { codexApply } from "./tools/codex-apply.js";
import { codexReviewPatch } from "./tools/codex-review-patch.js";
import { CodexOutputParseError } from "./codex/parse-output.js";
import { DiffExtractionError } from "./patch/extract-diff.js";
import { ApplyCheckError } from "./patch/apply-check.js";

const RAW_OUTPUT_LIMIT = 4000;

const workspaceRoot = process.env.CODEX_BRIDGE_WORKSPACE ?? process.cwd();

const server = new McpServer({ name: "codex-cli-mcp-bridge", version: "0.6.0" });

// Tools: codex_plan (read-only), codex_propose_patch (read-only diff proposal),
// codex_apply (the ONLY mutating tool — applies a reviewed, exact diff with
// explicit approval), and codex_review_patch (read-only, advisory third-party
// review — never gates apply). See docs/design.md for phase boundaries.
server.registerTool(
  "codex_plan",
  {
    title: "Codex plan (read-only)",
    description:
      "Have Codex CLI read a handoff document inside the workspace and return a summary, " +
      "an implementation plan, risks, and candidate files for later phases. Strictly " +
      "read-only: runs `codex exec` with --sandbox read-only and never modifies the working tree.",
    inputSchema: {
      handoff_path: z
        .string()
        .describe("Path to the handoff Markdown document, relative to the workspace root"),
    },
  },
  async ({ handoff_path }) => {
    try {
      const plan = await codexPlan(workspaceRoot, handoff_path);
      return { content: [{ type: "text" as const, text: plan }] };
    } catch (err) {
      const message =
        err instanceof CodexOutputParseError
          ? `${err.message}\n--- raw output (truncated) ---\n${err.rawOutput.slice(0, RAW_OUTPUT_LIMIT)}`
          : err instanceof Error
            ? err.message
            : String(err);
      return {
        content: [{ type: "text" as const, text: `codex_plan failed: ${message}` }],
        isError: true,
      };
    }
  },
);

server.registerTool(
  "codex_propose_patch",
  {
    title: "Codex propose patch (diff proposal only)",
    description:
      "Have Codex CLI read a handoff document and return a validated Git unified diff " +
      "PROPOSAL plus its diff_sha256 and base_head. The patch is verified with " +
      "`git apply --check` but never applied here — the working tree is not modified. " +
      "Applying is handled separately by codex_apply, only after a human reviews the " +
      "returned diff (pass diff, diff_sha256, and base_head to it).",
    inputSchema: {
      handoff_path: z
        .string()
        .describe("Path to the handoff Markdown document, relative to the workspace root"),
    },
  },
  async ({ handoff_path }) => {
    try {
      const p = await codexProposePatch(workspaceRoot, handoff_path);
      const review: string[] = [];
      if (p.hints.nonAsciiChangedLines > 0) {
        review.push(
          `REVIEW: ${p.hints.nonAsciiChangedLines} changed line(s) contain non-ASCII characters — check for mojibake before approving.`,
        );
      }
      if (p.hints.largeRewriteFiles.length > 0) {
        review.push(`REVIEW: near-full rewrite of ${p.hints.largeRewriteFiles.join(", ")}.`);
      }
      const text = [
        `files (${p.files.length}): ${p.files.join(", ")}`,
        `additions: +${p.additions}, deletions: -${p.deletions}`,
        "git apply --check: passed (patch NOT applied)",
        `diff_sha256: ${p.diffSha256}`,
        `base_head: ${p.baseHead}`,
        "To apply after review: codex_apply(diff, approval=true, expected_sha256=diff_sha256, base_head=base_head)",
        ...review,
        "",
        "```diff",
        p.diff.replace(/\n$/, ""),
        "```",
      ].join("\n");
      return { content: [{ type: "text" as const, text }] };
    } catch (err) {
      let message: string;
      if (err instanceof CodexOutputParseError) {
        message = `${err.message}\n--- raw output (truncated) ---\n${err.rawOutput.slice(0, RAW_OUTPUT_LIMIT)}`;
      } else if (err instanceof DiffExtractionError) {
        message = `${err.message}\n--- agent message (truncated) ---\n${err.rawOutput.slice(0, RAW_OUTPUT_LIMIT)}`;
      } else if (err instanceof ApplyCheckError) {
        message = `${err.message}\n--- git output ---\n${err.detail.slice(0, RAW_OUTPUT_LIMIT)}`;
      } else {
        message = err instanceof Error ? err.message : String(err);
      }
      return {
        content: [{ type: "text" as const, text: `codex_propose_patch failed: ${message}` }],
        isError: true,
      };
    }
  },
);

server.registerTool(
  "codex_apply",
  {
    title: "Apply a reviewed patch (mutating)",
    description:
      "Apply a reviewed, exact diff to the working tree. This is the ONLY tool that mutates " +
      "the workspace. It does NOT call Codex — pass the diff returned by codex_propose_patch " +
      "after a human has reviewed it. Requires approval=true plus expected_sha256 and base_head " +
      "(from the propose result). Fail-closed: rejects on hash mismatch, moved HEAD, dirty tree, " +
      "or a diff that does not apply. Applies to the working tree only — does not stage or commit.",
    inputSchema: {
      diff: z.string().describe("The exact unified diff returned by codex_propose_patch"),
      approval: z
        .boolean()
        .describe("Must be exactly true; the human reviewer's explicit approval of this diff"),
      expected_sha256: z
        .string()
        .describe("diff_sha256 from the codex_propose_patch result (binds approval to the diff)"),
      base_head: z
        .string()
        .describe("base_head from the codex_propose_patch result (binds approval to the HEAD)"),
    },
  },
  async ({ diff, approval, expected_sha256, base_head }) => {
    try {
      const r = await codexApply(workspaceRoot, { diff, approval, expected_sha256, base_head });
      const text = [
        "Applied to the working tree (NOT staged, NOT committed).",
        `files (${r.files.length}): ${r.files.join(", ")}`,
        `additions: +${r.additions}, deletions: -${r.deletions}`,
        "Review with `git diff`, then `git add`/`git commit` yourself.",
      ].join("\n");
      return { content: [{ type: "text" as const, text }] };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        content: [{ type: "text" as const, text: `codex_apply rejected: ${message}` }],
        isError: true,
      };
    }
  },
);

server.registerTool(
  "codex_review_patch",
  {
    title: "Third-party review of a proposed patch (read-only, advisory)",
    description:
      "Have an independent Codex pass review a proposed diff read-only and return a written " +
      "review (blocking/non-blocking issues, scope creep, oversized changes, test suggestions, " +
      "security risks, a low-confidence non-ASCII/mojibake note, and an advisory verdict). " +
      "It modifies nothing, never calls codex_apply, and its verdict does NOT authorize any " +
      "apply — a human still approves. Pass the diff, diff_sha256, and base_head from " +
      "codex_propose_patch so the review is bound to that exact diff.",
    inputSchema: {
      diff: z.string().describe("The exact unified diff returned by codex_propose_patch"),
      expected_sha256: z.string().describe("diff_sha256 from the codex_propose_patch result"),
      base_head: z.string().describe("base_head from the codex_propose_patch result"),
      review_focus: z
        .string()
        .optional()
        .describe("Optional extra aspect to emphasize in the review"),
    },
  },
  async ({ diff, expected_sha256, base_head, review_focus }) => {
    try {
      const r = await codexReviewPatch(workspaceRoot, {
        diff,
        expected_sha256,
        base_head,
        review_focus,
      });
      const text = [
        `Third-party review of the proposed diff (files: ${r.files.join(", ")}).`,
        "ADVISORY ONLY — this does not approve or apply anything; a human still decides.",
        "",
        r.review,
      ].join("\n");
      return { content: [{ type: "text" as const, text }] };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        content: [{ type: "text" as const, text: `codex_review_patch failed: ${message}` }],
        isError: true,
      };
    }
  },
);

await server.connect(new StdioServerTransport());
// stdout is the MCP transport — all logging goes to stderr.
console.error(
  `[codex-cli-mcp-bridge] ready (workspace=${workspaceRoot}, ` +
    `tools=[codex_plan, codex_propose_patch, codex_apply, codex_review_patch])`,
);
