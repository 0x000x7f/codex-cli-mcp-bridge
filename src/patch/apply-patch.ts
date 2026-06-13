import { spawn } from "node:child_process";

export class PatchApplyError extends Error {
  readonly detail: string;
  constructor(message: string, detail: string) {
    super(message);
    this.detail = detail;
  }
}

const APPLY_TIMEOUT_MS = 30_000;

/**
 * Apply a diff to the working tree only (no --index, no --3way, no commit).
 * stdin + argv + shell:false, mirroring apply-check. `--3way` is intentionally
 * omitted so that a diff that does not match the current tree FAILS rather than
 * being auto-merged.
 */
export async function gitApply(workspaceRoot: string, diff: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn("git", ["-C", workspaceRoot, "apply", "-"], {
      shell: false,
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      try {
        child.kill();
      } catch {
        /* already gone */
      }
      reject(new PatchApplyError("git apply timed out", stderr || stdout));
    }, APPLY_TIMEOUT_MS);
    child.stdout.on("data", (d: Buffer) => (stdout += d.toString()));
    child.stderr.on("data", (d: Buffer) => (stderr += d.toString()));
    child.stdin.on("error", () => {
      /* EPIPE if git exits early — surfaced via close */
    });
    child.on("error", (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(new PatchApplyError(`failed to start git apply: ${err.message}`, ""));
    });
    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new PatchApplyError(`git apply failed (exit ${code})`, stderr || stdout));
    });
    child.stdin.write(diff);
    child.stdin.end();
  });
}
