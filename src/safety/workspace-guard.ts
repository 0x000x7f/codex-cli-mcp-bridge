import path from "node:path";
import fs from "node:fs";

export class WorkspaceGuardError extends Error {}

export interface GuardedFile {
  absPath: string;
  relPath: string;
  size: number;
}

/**
 * Resolve a requested path strictly inside the workspace root.
 *
 * Containment is decided with path.relative() after realpath normalization —
 * never with startsWith(), which would wrongly accept sibling directories
 * sharing the root as a string prefix (e.g. C:\repo vs C:\repo-evil).
 * Entries whose own name begins with ".." are rejected as well (fail-closed).
 */
export function resolveInsideWorkspace(workspaceRoot: string, requestedPath: string): GuardedFile {
  let rootReal: string;
  try {
    rootReal = fs.realpathSync.native(workspaceRoot);
  } catch {
    throw new WorkspaceGuardError(`workspace root does not exist: ${workspaceRoot}`);
  }

  const joined = path.resolve(rootReal, requestedPath);
  let targetReal: string;
  try {
    targetReal = fs.realpathSync.native(joined);
  } catch {
    throw new WorkspaceGuardError(`handoff_path not found: ${requestedPath}`);
  }

  const relative = path.relative(rootReal, targetReal);
  const inside = relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
  if (!inside) {
    throw new WorkspaceGuardError("handoff_path resolves outside the workspace root");
  }

  const stat = fs.statSync(targetReal);
  if (!stat.isFile()) {
    throw new WorkspaceGuardError("handoff_path is not a regular file");
  }

  return { absPath: targetReal, relPath: relative, size: stat.size };
}
