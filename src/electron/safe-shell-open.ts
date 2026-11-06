import { existsSync } from "node:fs";

type PathOpener = (target: string) => Promise<string>;
type ExternalOpener = (target: string) => Promise<void>;

export interface SafeOpenPathOptions {
  requireExistingPath?: boolean;
  pathExists?: (target: string) => boolean;
}

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) return error.message.trim();
  const message = String(error).trim();
  return message || "未知错误";
}

/**
 * Open a path without allowing an Electron shell rejection to escape into the
 * process-level unhandledRejection handler. An empty string means success,
 * matching Electron's shell.openPath contract.
 */
export async function openPathSafely(
  openPath: PathOpener,
  target: unknown,
  options: SafeOpenPathOptions = {},
): Promise<string> {
  const normalized = typeof target === "string" ? target.trim() : "";
  if (!normalized) return "路径为空";

  if (options.requireExistingPath) {
    const pathExists = options.pathExists ?? existsSync;
    try {
      if (!pathExists(normalized)) return "路径不存在或已被移动";
    } catch (error) {
      return `无法检查路径：${errorMessage(error)}`;
    }
  }

  try {
    const result = await openPath(normalized);
    return typeof result === "string" ? result.trim() : "";
  } catch (error) {
    return errorMessage(error);
  }
}

/** Open an external URL with the same no-throw contract as openPathSafely. */
export async function openExternalSafely(
  openExternal: ExternalOpener,
  target: unknown,
): Promise<string> {
  const normalized = typeof target === "string" ? target.trim() : "";
  if (!normalized) return "链接为空";

  try {
    await openExternal(normalized);
    return "";
  } catch (error) {
    return errorMessage(error);
  }
}
