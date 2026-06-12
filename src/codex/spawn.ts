import { spawn } from "node:child_process";
import path from "node:path";
import fs from "node:fs";

export class CodexSpawnError extends Error {}

export interface CodexRunResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  timedOut: boolean;
}

const DEFAULT_TIMEOUT_MS = 300_000;

/**
 * Locate how to start Codex CLI without a shell.
 *
 * On Windows the npm global wrapper is codex.cmd, which Node refuses to spawn
 * with shell:false (CVE-2024-27980). We therefore run the package's JS entry
 * point with the current Node binary. Override with CODEX_BRIDGE_CODEX_JS.
 */
function resolveCodexInvocation(): { command: string; baseArgs: string[] } {
  const overrideJs = process.env.CODEX_BRIDGE_CODEX_JS;
  if (overrideJs) {
    return { command: process.execPath, baseArgs: [overrideJs] };
  }
  if (process.platform === "win32") {
    const appData = process.env.APPDATA;
    if (appData) {
      const candidate = path.join(appData, "npm", "node_modules", "@openai", "codex", "bin", "codex.js");
      if (fs.existsSync(candidate)) {
        return { command: process.execPath, baseArgs: [candidate] };
      }
    }
    throw new CodexSpawnError(
      "Codex CLI entry point not found. Set CODEX_BRIDGE_CODEX_JS to the absolute path of @openai/codex/bin/codex.js",
    );
  }
  return { command: "codex", baseArgs: [] };
}

/**
 * Run `codex exec` non-interactively: ephemeral session, JSONL output, prompt
 * via stdin. The command is spawned with shell:false and an argv array — the
 * working directory and prompt are never concatenated into a shell string.
 *
 * Internal: the sandbox mode is chosen by the exported wrappers below.
 */
async function runCodexExec(opts: {
  cwd: string;
  sandbox: "read-only" | "workspace-write";
  prompt: string;
  timeoutMs?: number;
}): Promise<CodexRunResult> {
  const timeoutMs =
    opts.timeoutMs ?? Number(process.env.CODEX_BRIDGE_TIMEOUT_MS ?? DEFAULT_TIMEOUT_MS);
  const { command, baseArgs } = resolveCodexInvocation();
  // Some accounts/plans only support specific models; keep it configurable.
  const model = process.env.CODEX_BRIDGE_MODEL;
  const args = [
    ...baseArgs,
    "exec",
    ...(model ? ["-m", model] : []),
    "--sandbox", opts.sandbox,
    "--ephemeral",
    "--color", "never",
    "--json",
    "--skip-git-repo-check",
    "-C", opts.cwd,
    "-", // read the prompt from stdin
  ];

  return await new Promise<CodexRunResult>((resolve, reject) => {
    const child = spawn(command, args, {
      shell: false,
      cwd: opts.cwd,
      stdio: ["pipe", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let settled = false;

    const timer = setTimeout(() => {
      timedOut = true;
      killTree(child.pid);
    }, timeoutMs);

    child.stdout.on("data", (d: Buffer) => (stdout += d.toString()));
    child.stderr.on("data", (d: Buffer) => (stderr += d.toString()));
    child.stdin.on("error", () => {
      /* EPIPE when the child dies early — surfaced via 'error'/'close' below */
    });

    child.on("error", (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(new CodexSpawnError(`failed to start Codex CLI: ${err.message}`));
    });

    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ stdout, stderr, exitCode: code, timedOut });
    });

    child.stdin.write(opts.prompt);
    child.stdin.end();
  });
}

/** Read-only execution against the real workspace (codex_plan, Strategy A). */
export async function runCodexExecReadOnly(opts: {
  workspaceRoot: string;
  prompt: string;
  timeoutMs?: number;
}): Promise<CodexRunResult> {
  return runCodexExec({
    cwd: opts.workspaceRoot,
    sandbox: "read-only",
    prompt: opts.prompt,
    timeoutMs: opts.timeoutMs,
  });
}

/**
 * Workspace-write execution — ONLY for a disposable temp worktree (Strategy B).
 * The signature ties workspace-write to a worktree path on purpose: there is no
 * way to run codex with write access against the real workspace through this
 * module.
 */
export async function runCodexExecInWorktree(opts: {
  worktreePath: string;
  prompt: string;
  timeoutMs?: number;
}): Promise<CodexRunResult> {
  return runCodexExec({
    cwd: opts.worktreePath,
    sandbox: "workspace-write",
    prompt: opts.prompt,
    timeoutMs: opts.timeoutMs,
  });
}

/** Kill the whole process tree — codex.js spawns a native binary child. */
function killTree(pid: number | undefined): void {
  if (pid === undefined) return;
  if (process.platform === "win32") {
    spawn("taskkill", ["/PID", String(pid), "/T", "/F"], { shell: false, stdio: "ignore" });
  } else {
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      /* already gone */
    }
  }
}
