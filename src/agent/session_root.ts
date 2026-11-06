import { posix, win32 } from "node:path";
import { mkdir as mkdirFile, stat as statFile, realpath } from "node:fs/promises";
import type { Stats } from "node:fs";

import {
  createDefaultProtectedPathPolicy,
  isPathWithin,
  type ProtectedPathPolicy,
} from "../platform/path_policy.ts";
import { platformPaths } from "../platform/paths.ts";
import {
  currentPlatform,
  type SupportedPlatform,
} from "../platform/runtime.ts";

export interface SessionRoot {
  cwd: string;
  protectedWorkspace: boolean;
  source: "workspace" | "artifacts";
}

export interface ResolveSessionRootOptions {
  workspacePath?: string | null;
  artifactsDir?: string;
  policy?: ProtectedPathPolicy;
  os?: SupportedPlatform;
  realPath?: (path: string) => string | Promise<string>;
  stat?: (path: string) => Stats | Promise<Stats>;
  mkdir?: (path: string) => void | Promise<void>;
}

/** Resolve the only filesystem cwd exposed to a conversation. */
export async function resolveSessionRoot(
  options: ResolveSessionRootOptions = {},
): Promise<SessionRoot> {
  const os = options.os ?? options.policy?.os ?? currentPlatform;
  const api = os === "windows" ? win32 : posix;
  const realPath = options.realPath ?? ((path: string) => realpath(path));
  const stat = options.stat ?? ((path: string) => statFile(path));
  const workspaceInput = options.workspacePath?.trim();

  if (workspaceInput) {
    const expanded = platformPaths.expandHome(workspaceInput);
    if (!api.isAbsolute(expanded)) {
      throw new Error("Workspace path must be absolute");
    }
    let canonical: string;
    try {
      canonical = await realPath(api.resolve(expanded));
    } catch (error) {
      if ((error as { code?: string }).code === "ENOENT") {
        throw new Error(`Workspace does not exist: ${workspaceInput}`);
      }
      throw error;
    }
    const info = await stat(canonical);
    if (!info.isDirectory()) {
      throw new Error("Workspace path must be a directory");
    }
    const policy = options.policy ?? createDefaultProtectedPathPolicy({
      os,
      cwd: canonical,
    });
    return {
      cwd: canonical,
      protectedWorkspace: policy.protectedRoots.some((root) =>
        isPathWithin(root, canonical, os)
      ),
      source: "workspace",
    };
  }

  const artifacts = options.artifactsDir ?? platformPaths.artifactsDir;
  if (!api.isAbsolute(artifacts)) {
    throw new Error("Artifacts path must be absolute");
  }
  const mkdir = options.mkdir ??
    ((path: string) => mkdirFile(path, { recursive: true }));
  await mkdir(artifacts);
  const canonical = await realPath(api.resolve(artifacts));
  const info = await stat(canonical);
  if (!info.isDirectory()) throw new Error("Artifacts path must be a directory");
  const policy = options.policy ?? createDefaultProtectedPathPolicy({
    os,
    cwd: canonical,
  });
  return {
    cwd: canonical,
    protectedWorkspace: policy.protectedRoots.some((root) =>
      isPathWithin(root, canonical, os)
    ),
    source: "artifacts",
  };
}
