// src/domains/project/node/store.ts
// 项目实体：关联会话 + 关联文件目录

import { getDb } from "../../../infra/db.ts";

export interface Project {
  id: string;
  name: string;
  description: string;
  dirPath: string;
  color: string;
  createdAt: number;
  updatedAt: number;
}

function uuid(): string { return crypto.randomUUID(); }

export function createProject(name: string, opts?: { description?: string; dirPath?: string; color?: string }): Project {
  const db = getDb();
  const id = uuid();
  const now = Date.now();
  const p: Project = {
    id, name,
    description: opts?.description || "",
    dirPath: opts?.dirPath || "",
    color: opts?.color || "#3b82f6",
    createdAt: now, updatedAt: now,
  };
  db.prepare("INSERT INTO projects (id, name, description, dir_path, color, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
    .run(p.id, p.name, p.description, p.dirPath, p.color, p.createdAt, p.updatedAt);
  return p;
}

export function listProjects(): Project[] {
  const db = getDb();
  return db.prepare("SELECT id, name, description, dir_path as dirPath, color, created_at as createdAt, updated_at as updatedAt FROM projects ORDER BY updated_at DESC")
    .all() as unknown as Project[];
}

export function getProject(id: string): Project | undefined {
  const db = getDb();
  return db.prepare("SELECT id, name, description, dir_path as dirPath, color, created_at as createdAt, updated_at as updatedAt FROM projects WHERE id = ?")
    .get(id) as unknown as Project | undefined;
}

export function updateProject(id: string, opts: Partial<Pick<Project, "name" | "description" | "dirPath" | "color">>): void {
  const db = getDb();
  const sets: string[] = [];
  const params: unknown[] = [];
  if (opts.name !== undefined) { sets.push("name = ?"); params.push(opts.name); }
  if (opts.description !== undefined) { sets.push("description = ?"); params.push(opts.description); }
  if (opts.dirPath !== undefined) { sets.push("dir_path = ?"); params.push(opts.dirPath); }
  if (opts.color !== undefined) { sets.push("color = ?"); params.push(opts.color); }
  if (sets.length === 0) return;
  sets.push("updated_at = ?"); params.push(Date.now()); params.push(id);
  db.prepare(`UPDATE projects SET ${sets.join(", ")} WHERE id = ?`).run(...(params as any[]));
}

export function deleteProject(id: string): void {
  const db = getDb();
  // 解除会话关联（不删会话）
  db.prepare("UPDATE conversations SET project_id = NULL WHERE project_id = ?").run(id);
  db.prepare("DELETE FROM projects WHERE id = ?").run(id);
}

/** 把会话归入项目 */
export function assignConversationToProject(conversationId: string, projectId: string | null): void {
  const db = getDb();
  db.prepare("UPDATE conversations SET project_id = ? WHERE id = ?").run(projectId, conversationId);
}

/** 列出项目下的会话 */
export function listProjectConversations(projectId: string): Array<{ id: string; title: string }> {
  const db = getDb();
  return db.prepare("SELECT id, title FROM conversations WHERE project_id = ? ORDER BY updated_at DESC")
    .all(projectId) as unknown as Array<{ id: string; title: string }>;
}
