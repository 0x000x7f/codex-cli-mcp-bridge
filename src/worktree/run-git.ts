import { spawn } from "node:child_process";

export interface GitResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
}

const GIT_TIMEOUT_MS = 30_000;

/** Run git with an argv array (shell:false — review constraint, same as apply-check). */
export async function runGit(args: string[]): Promise<GitResult> {
  return await new Promise((resolve, reject) => {
    const child = spawn("git", args, { shell: false, stdio: ["ignore", "pipe", "pipe"] });
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
      reject(new Error(`git ${args.join(" ")} timed out`));
    }, GIT_TIMEOUT_MS);
    child.stdout.on("data", (d: Buffer) => (stdout += d.toString()));
    child.stderr.on("data", (d: Buffer) => (stderr += d.toString()));
    child.on("error", (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(err);
    });
    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ stdout, stderr, exitCode: code });
    });
  });
}

/** Like runGit but throws on non-zero exit. */
export async function git(args: string[]): Promise<string> {
  const r = await runGit(args);
  if (r.exitCode !== 0) {
    throw new Error(`git ${args.join(" ")} failed (exit ${r.exitCode}): ${r.stderr || r.stdout}`);
  }
  return r.stdout;
}
