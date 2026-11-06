// src/domains/doc/node/paths.ts
// 文档落盘路径管理（artifacts 目录）

import { platformPaths } from "../../../platform/paths.ts";
import { mkdir } from "node:fs/promises";
import { getDb } from "../../../infra/db.ts";
import { sessionContext } from "../../../infra/context.ts";
import { sessionFallbackArtifactDir } from "../../../agent/session_output_path.ts";

import { isPathWithin } from "../../../platform/path_policy.ts";
import { currentPlatform } from "../../../platform/runtime.ts";

const ARTIFACTS_DIR = platformPaths.artifactsDir;

/** 确保 artifacts 目录存在 */
export async function ensureArtifactsDir(): Promise<void> {
  try {
    await mkdir(currentArtifactOutputDir(), { recursive: true });
  } catch { /* 已存在 */ }
}

/** Resolve the current session's document output directory. */
export function currentArtifactOutputDir(): string {
  const sessionId = sessionContext.getStore()?.sessionId;
  if (!sessionId) return ARTIFACTS_DIR;
  try {
    const row = getDb().prepare(
      `SELECT w.dir_path AS workspacePath
         FROM conversations c
         LEFT JOIN workspaces w ON w.id = c.workspace_id
        WHERE c.id = ?`,
    ).get(sessionId) as { workspacePath?: string | null } | undefined;
    if (row?.workspacePath?.trim()) {
      return platformPaths.expandHome(row.workspacePath.trim());
    }
  } catch {
    // Fall back to the isolated session directory if the DB is unavailable.
  }
  return sessionFallbackArtifactDir(
    ARTIFACTS_DIR,
    sessionId,
    process.platform === "win32" ? "windows" : "posix",
  );
}

/** 生成 artifact 完整路径（自动加时间戳防覆盖） */
export function artifactPath(fileName: string): string {
  const ts = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const outputDir = currentArtifactOutputDir();
  // 在文件名插入时间戳：report.docx → report-20260705.docx
  const dotIdx = fileName.lastIndexOf(".");
  if (dotIdx > 0) {
    const base = fileName.slice(0, dotIdx);
    const ext = fileName.slice(dotIdx);
    const target = platformPaths.isAbsolute(fileName)
      ? fileName
      : platformPaths.join(outputDir, `${base}-${ts}${ext}`);
    if (!isPathWithin(outputDir, target, currentPlatform)) {
      throw new Error("Document output must stay inside artifacts");
    }
    return target;
  }
  const target = platformPaths.isAbsolute(fileName)
    ? fileName
    : platformPaths.join(outputDir, `${fileName}-${ts}`);
  if (!isPathWithin(outputDir, target, currentPlatform)) {
    throw new Error("Document output must stay inside artifacts");
  }
  return target;
}

export const artifactsDir = ARTIFACTS_DIR;
