import { platformPaths, type PlatformPaths } from "../../../platform/paths.ts";

export type WorkspacePathResolver = Pick<PlatformPaths, "expandHome" | "isAbsolute">;

/** Return the stable absolute path persisted for a workspace. */
export function normalizeWorkspaceDirPath(
  input: string,
  paths: WorkspacePathResolver = platformPaths,
): string {
  const value = input.trim();
  if (!value) return "";
  const expanded = paths.expandHome(value);
  if (!paths.isAbsolute(expanded)) {
    throw new Error("Workspace path must be absolute");
  }
  return expanded;
}
