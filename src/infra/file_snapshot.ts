// src/infra/file_snapshot.ts
// 任意文件改前快照（对照 08 计划功能17）。
// bash 写文件前自动复制原文件到 ~/.pi-a/snapshots/，记录表，支持回滚。

import { getDb } from "./db.ts";
import { mkdir, stat, copyFile } from "node:fs/promises";

import { platformPaths } from "../platform/paths.ts";

const SNAP_DIR = platformPaths.join(platformPaths.appDataDir, "snapshots");

export interface FileSnapshot {
  id: string;
  originalPath: string;
  snapshotPath: string;
  sessionId: string | null;
  createdAt: number;
}

function uuid(): string { return crypto.randomUUID(); }

/** 对一个文件做快照（改前调用）。文件不存在则跳过返回 null。 */
export async function snapshotFile(path: string, sessionId?: string): Promise<FileSnapshot | null> {
  try {
    const statInfo = await stat(path);
    if (!statInfo.isFile()) return null;
  } catch {
    return null; // 文件不存在，无需快照
  }
  await mkdir(SNAP_DIR, { recursive: true });
  const id = uuid();
  const now = Date.now();
  const snapshotPath = platformPaths.join(SNAP_DIR, id);
  try {
    await copyFile(path, snapshotPath);
  } catch {
    return null;
  }
  const db = getDb();
  db.prepare(
    "INSERT INTO file_snapshots (id, original_path, snapshot_path, session_id, created_at) VALUES (?, ?, ?, ?, ?)",
  ).run(id, path, snapshotPath, sessionId ?? null, now);
  return { id, originalPath: path, snapshotPath, sessionId: sessionId ?? null, createdAt: now };
}

/** 列出某文件的所有快照（按时间倒序） */
export function listFileSnapshots(path: string): FileSnapshot[] {
  const db = getDb();
  return db.prepare(
    "SELECT id, original_path as originalPath, snapshot_path as snapshotPath, session_id as sessionId, created_at as createdAt FROM file_snapshots WHERE original_path = ? ORDER BY created_at DESC",
  ).all(path) as unknown as FileSnapshot[];
}

/** 列出所有有快照的文件路径（去重，含快照数与最近时间） */
export function listSnapshottedFiles(): { originalPath: string; count: number; latestAt: number }[] {
  const db = getDb();
  return db.prepare(
    "SELECT original_path as originalPath, COUNT(*) as count, MAX(created_at) as latestAt FROM file_snapshots GROUP BY original_path ORDER BY latestAt DESC",
  ).all() as unknown as { originalPath: string; count: number; latestAt: number }[];
}

/** 回滚：用快照覆盖原文件 */
export async function revertFileSnapshot(id: string): Promise<void> {
  const db = getDb();
  const row = db.prepare("SELECT original_path, snapshot_path FROM file_snapshots WHERE id = ?").get(id) as
    { original_path: string; snapshot_path: string } | undefined;
  if (!row) throw new Error("快照不存在");
  await copyFile(row.snapshot_path, row.original_path);
}

/** 启发式检测 bash 命令中的文件写入目标（>、>>、tee、sed -i） */
export function detectFileWrites(command: string): string[] {
  const files = new Set<string>();
  for (const m of command.matchAll(/>{1,2}\s*(\S+)/g)) {
    if (m[1] !== "&" && !m[1].startsWith("/dev/")) files.add(m[1]);
  }
  for (const m of command.matchAll(/\btee\s+(?:-a\s+)?(\S+)/g)) {
    files.add(m[1]);
  }
  if (/\bsed\b[^|]*\s-i\b/.test(command)) {
    const parts = command.split(/\s+/);
    const last = parts[parts.length - 1];
    if (last && !last.startsWith("-")) files.add(last);
  }
  return [...files];
}
