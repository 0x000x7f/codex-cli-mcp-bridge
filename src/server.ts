import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { codexPlan } from "./tools/codex-plan.js";
import { codexProposePatch } from "./tools/codex-propose-patch.js";
import { CodexOutputParseError } from "./codex/parse-output.js";
import { DiffExtractionError } from "./patch/extract-diff.js";
import { ApplyCheckError } from "./patch/apply-check.js";

const RAW_OUTPUT_LIMIT = 4000;

const workspaceRoot = process.env.CODEX_BRIDGE_WORKSPACE ?? process.cwd();

const server = new McpServer({ name: "codex-cli-mcp-bridge", version: "0.3.0" });

// Phase 2 exposes exactly two read-only tools: codex_plan and
// codex_propose_patch. codex_apply (mutation) is Phase 3 and intentionally
// absent — see docs/design.md (phase boundaries).
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
      "PROPOSAL. The patch is verified with `git apply --check` but never applied — " +
      "the working tree is not modified. Applying patches (codex_apply) is Phase 3 and " +
      "not implemented.",
    inputSchema: {
      handoff_path: z
        .string()
        .describe("Path to the handoff Markdown document, relative to the workspace root"),
    },
  },
  async ({ handoff_path }) => {
    try {
      const p = await codexProposePatch(workspaceRoot, handoff_path);
      const text = [
        `files (${p.files.length}): ${p.files.join(", ")}`,
        `additions: +${p.additions}, deletions: -${p.deletions}`,
        "git apply --check: passed (patch NOT applied)",
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

await server.connect(new StdioServerTransport());
// stdout is the MCP transport — all logging goes to stderr.
console.error(
  `[codex-cli-mcp-bridge] ready (workspace=${workspaceRoot}, tools=[codex_plan, codex_propose_patch])`,
);
