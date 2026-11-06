// src/domains/artifact/node/store.ts
// 工件存储：记录 agent 生成的文档工件（docx/xlsx/pptx 等）

import { getDb } from "../../../infra/db.ts";
import { stat, copyFile } from "node:fs/promises";


export interface Artifact {
  id: string;
  conversationId: string | null;
  fileName: string;
  filePath: string;
  kind: string; // docx | xlsx | pptx | txt | other
  bytes: number;
  createdAt: number;
}

function uuid(): string {
  return crypto.randomUUID();
}

/** 注册一个工件（工具生成文件后调用） */
export function createArtifact(opts: {
  conversationId?: string;
  fileName: string;
  filePath: string;
  kind?: string;
  bytes?: number;
}): Artifact {
  const db = getDb();
  const id = uuid();
  const now = Date.now();
  const kind = opts.kind ?? opts.filePath.split(".").pop()?.toLowerCase() ?? "other";
  db.prepare(
    "INSERT INTO artifacts (id, conversation_id, file_name, file_path, kind, bytes, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
  ).run(id, opts.conversationId ?? null, opts.fileName, opts.filePath, kind, opts.bytes ?? 0, now);
  return { id, conversationId: opts.conversationId ?? null, fileName: opts.fileName, filePath: opts.filePath, kind, bytes: opts.bytes ?? 0, createdAt: now };
}

/** 列出工件（可按会话筛选，按创建时间倒序） */
export function listArtifacts(conversationId?: string): Artifact[] {
  const db = getDb();
  const rows = conversationId
    ? db.prepare(
      "SELECT id, conversation_id as conversationId, file_name as fileName, file_path as filePath, kind, bytes, created_at as createdAt FROM artifacts WHERE conversation_id = ? ORDER BY created_at DESC",
    ).all(conversationId) as unknown as Artifact[]
    : db.prepare(
      "SELECT id, conversation_id as conversationId, file_name as fileName, file_path as filePath, kind, bytes, created_at as createdAt FROM artifacts ORDER BY created_at DESC",
    ).all() as unknown as Artifact[];
  return rows;
}

/** 删除工件记录（不删文件） */
export function deleteArtifact(id: string): void {
  const db = getDb();
  db.prepare("DELETE FROM artifacts WHERE id = ?").run(id);
}

/** 根据路径查询工件记录 */
export function getArtifactByPath(filePath: string): Artifact | undefined {
  const db = getDb();
  const row = db.prepare(
    "SELECT id, conversation_id as conversationId, file_name as fileName, file_path as filePath, kind, bytes, created_at as createdAt FROM artifacts WHERE file_path = ?",
  ).get(filePath) as unknown as Artifact | undefined;
  return row;
}

/** 根据 ID 查询工件记录 */
export function getArtifactById(id: string): Artifact | undefined {
  const db = getDb();
  const row = db.prepare(
    "SELECT id, conversation_id as conversationId, file_name as fileName, file_path as filePath, kind, bytes, created_at as createdAt FROM artifacts WHERE id = ?",
  ).get(id) as unknown as Artifact | undefined;
  return row;
}

/** 获取工件的下一版本号 (当前最高版本 + 1，没有历史版本则为 1) */
export function getNextVersion(artifactId: string): number {
  const db = getDb();
  const row = db.prepare(
    "SELECT MAX(version) as maxVer FROM artifact_versions WHERE artifact_id = ?",
  ).get(artifactId) as { maxVer: number | null } | undefined;
  return (row?.maxVer ?? 0) + 1;
}

/** 写入新工件版本记录 */
export function createArtifactVersion(artifactId: string, version: number, filePath: string): void {
  const db = getDb();
  db.prepare(
    "INSERT INTO artifact_versions (artifact_id, version, file_path, created_at) VALUES (?, ?, ?, ?)",
  ).run(artifactId, version, filePath, Date.now());
}

/** 获取工件的历史版本列表 */
export function listArtifactVersions(artifactId: string): Array<{ version: number; filePath: string; createdAt: number }> {
  const db = getDb();
  return db.prepare(
    "SELECT version, file_path as filePath, created_at as createdAt FROM artifact_versions WHERE artifact_id = ? ORDER BY version DESC",
  ).all(artifactId) as unknown as Array<{ version: number; filePath: string; createdAt: number }>;
}

/** 还原工件到指定历史版本 */
export async function restoreArtifactVersion(artifactId: string, version: number): Promise<void> {
  const db = getDb();
  const verRow = db.prepare(
    "SELECT file_path FROM artifact_versions WHERE artifact_id = ? AND version = ?",
  ).get(artifactId, version) as { file_path: string } | undefined;
  if (!verRow) throw new Error(`未找到工件版本: v${version}`);

  const artRow = db.prepare(
    "SELECT file_path FROM artifacts WHERE id = ?",
  ).get(artifactId) as { file_path: string } | undefined;
  if (!artRow) throw new Error(`未找到工件记录: ${artifactId}`);

  // 将备份文件复制回原路径
  await copyFile(verRow.file_path, artRow.file_path);

  // 更新 artifacts 表文件字节数
  const statInfo = await stat(artRow.file_path).catch(() => ({ size: 0 }));
  db.prepare("UPDATE artifacts SET bytes = ? WHERE id = ?").run(statInfo.size, artifactId);
  console.log(`[artifact] 已还原工件 ${artifactId} 为版本 v${version}`);
}
