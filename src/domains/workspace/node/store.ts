// src/domains/workspace/node/store.ts
// 工作空间：关联目录路径 + 组织会话
// conversation 通过 workspace_id 关联到 workspace

import { getDb } from "../../../infra/db.ts";
import { statSync, mkdirSync, readFileSync } from "node:fs";

import { getSetting } from "../../settings/node/store.ts";
import { platformPaths } from "../../../platform/paths.ts";
import { normalizeWorkspaceDirPath } from "./path.ts";

export interface Workspace {
  id: string;
  name: string;
  dirPath: string;
  icon: string;
  lastOpenedAt: number;
  createdAt: number;
}

function uuid(): string { return crypto.randomUUID(); }

/** 创建工作空间 */
export function createWorkspace(name: string, opts?: { dirPath?: string; icon?: string }): Workspace {
  const db = getDb();
  const id = uuid();
  const now = Date.now();

  let dirPath = opts?.dirPath || "";
  if (!dirPath) {
    const defaultWorkspaceDir = getSetting("default_workspace_dir", "~/Documents");
    dirPath = `${defaultWorkspaceDir}/${name}`;
  }
  dirPath = normalizeWorkspaceDirPath(dirPath);

  // 物理创建工作空间目录
  try {
    const resolvedPath = platformPaths.expandHome(dirPath);
    mkdirSync(resolvedPath, { recursive: true });
    console.log(`[workspace] 已物理创建工作空间目录: ${resolvedPath}`);
  } catch (e) {
    console.warn(`[workspace] 物理创建目录 ${dirPath} 失败:`, (e as Error).message);
  }

  const ws: Workspace = {
    id, name,
    dirPath,
    icon: opts?.icon || "📁",
    lastOpenedAt: now,
    createdAt: now,
  };
  db.prepare("INSERT INTO workspaces (id, name, dir_path, icon, last_opened_at, created_at) VALUES (?, ?, ?, ?, ?, ?)")
    .run(ws.id, ws.name, ws.dirPath, ws.icon, ws.lastOpenedAt, ws.createdAt);
  return ws;
}

/** 列出所有工作空间（按最近打开排序） */
export function listWorkspaces(): Workspace[] {
  const db = getDb();
  return db.prepare("SELECT id, name, dir_path as dirPath, icon, last_opened_at as lastOpenedAt, created_at as createdAt FROM workspaces ORDER BY last_opened_at DESC")
    .all() as unknown as Workspace[];
}

/** 获取工作空间 */
export function getWorkspace(id: string): Workspace | undefined {
  const db = getDb();
  return db.prepare("SELECT id, name, dir_path as dirPath, icon, last_opened_at as lastOpenedAt, created_at as createdAt FROM workspaces WHERE id = ?")
    .get(id) as unknown as Workspace | undefined;
}

/** 更新工作空间 */
export function updateWorkspace(id: string, opts: Partial<Pick<Workspace, "name" | "dirPath" | "icon">>): void {
  const db = getDb();
  const sets: string[] = [];
  const params: unknown[] = [];
  if (opts.name !== undefined) { sets.push("name = ?"); params.push(opts.name); }
  if (opts.dirPath !== undefined) {
    sets.push("dir_path = ?");
    params.push(normalizeWorkspaceDirPath(opts.dirPath));
  }
  if (opts.icon !== undefined) { sets.push("icon = ?"); params.push(opts.icon); }
  if (sets.length === 0) return;
  sets.push("last_opened_at = ?"); params.push(Date.now()); params.push(id);
  db.prepare(`UPDATE workspaces SET ${sets.join(", ")} WHERE id = ?`).run(...(params as any[]));
}

/** 触摸最后打开时间 */
export function touchWorkspace(id: string): void {
  const db = getDb();
  db.prepare("UPDATE workspaces SET last_opened_at = ? WHERE id = ?").run(Date.now(), id);
}

/** 删除工作空间（关联会话归还到无空间的「任务」池，不丢失） */
export function deleteWorkspace(id: string): void {
  const db = getDb();
  db.prepare("UPDATE conversations SET workspace_id = NULL WHERE workspace_id = ?").run(id);
  db.prepare("DELETE FROM workspaces WHERE id = ?").run(id);
}

/** 列出工作空间下的会话 */
export function listWorkspaceConversations(workspaceId: string): Array<{ id: string; title: string; updatedAt: number }> {
  const db = getDb();
  return db.prepare("SELECT id, title, updated_at as updatedAt FROM conversations WHERE workspace_id = ? ORDER BY updated_at DESC")
    .all(workspaceId) as unknown as Array<{ id: string; title: string; updatedAt: number }>;
}

/** 把会话归入工作空间（workspaceId 为 null 时即移回「任务」） */
export function assignConversationToWorkspace(conversationId: string, workspaceId: string | null): void {
  const db = getDb();
  db.prepare("UPDATE conversations SET workspace_id = ? WHERE id = ?").run(workspaceId, conversationId);
}
