import { spawn } from "node:child_process";

export class ApplyCheckError extends Error {
  readonly detail: string;

  constructor(message: string, detail: string) {
    super(message);
    this.detail = detail;
  }
}

const APPLY_CHECK_TIMEOUT_MS = 30_000;

/**
 * Verify the patch would apply cleanly to the workspace — without applying it.
 *
 * Runs `git -C <root> apply --check -` with the diff on stdin, spawned as an
 * argv array with shell:false (Phase 2 review constraint #5). `--check` is a
 * read-only verification; the working tree is never modified.
 */
export async function gitApplyCheck(workspaceRoot: string, diff: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn("git", ["-C", workspaceRoot, "apply", "--check", "-"], {
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
      reject(new ApplyCheckError("git apply --check timed out", stderr || stdout));
    }, APPLY_CHECK_TIMEOUT_MS);

    child.stdout.on("data", (d: Buffer) => (stdout += d.toString()));
    child.stderr.on("data", (d: Buffer) => (stderr += d.toString()));
    child.stdin.on("error", () => {
      /* EPIPE when git exits early — surfaced via 'close' below */
    });

    child.on("error", (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(new ApplyCheckError(`failed to start git: ${err.message}`, ""));
    });

    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (code === 0) resolve();
      else {
        reject(
          new ApplyCheckError(`git apply --check failed (exit ${code})`, stderr || stdout),
        );
      }
    });

    child.stdin.write(diff);
    child.stdin.end();
  });
}
