import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { codexPlan } from "./tools/codex-plan.js";
import { CodexOutputParseError } from "./codex/parse-output.js";

const RAW_OUTPUT_LIMIT = 4000;

const workspaceRoot = process.env.CODEX_BRIDGE_WORKSPACE ?? process.cwd();

const server = new McpServer({ name: "codex-cli-mcp-bridge", version: "0.1.0" });

// Phase 1 exposes exactly one tool. codex_propose_patch / codex_apply are
// intentionally absent — see docs/design.md (phase boundaries).
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

await server.connect(new StdioServerTransport());
// stdout is the MCP transport — all logging goes to stderr.
console.error(`[codex-cli-mcp-bridge] ready (workspace=${workspaceRoot}, tools=[codex_plan])`);
