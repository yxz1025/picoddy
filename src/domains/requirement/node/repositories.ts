import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { randomUUID } from "node:crypto";
import { access, realpath, stat } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";
import type { DatabaseSync } from "node:sqlite";

const exec = promisify(execFile);
// Keys are persisted identifiers, independent of the displayed stage title.
export const stageTitles = ["设计分析", "产品 PRD", "设计评审", "架构设计", "研发计划", "软件开发", "代码审核", "自动测试", "构建验证", "交付归档"];
export const stageIndex = (key: string, includeArchived = false) => {
  const index = stageTitles.indexOf(key.replace(/^stage:/, ""));
  return !includeArchived && [4, 5].includes(index) ? -1 : index;
};
export interface Repository { id: string; name: string; roles: string[]; path: string; root: string; branch: string; commit: string; dirty: boolean; scope: string[]; }
export interface Selection { repositoryScopes?: Record<string, string[]>; repositories: string[]; assets: Array<{ id: string; hash: string }>; discussionOnly: boolean; }
export async function inspectRepository(path: string, scope: string[] = ["."]) {
  if (!isAbsolute(path)) throw new Error("请填写本地绝对路径");
  const canonical = await realpath(path);
  if (!(await stat(canonical)).isDirectory()) throw new Error("仓库路径不是目录");
  const git = async (args: string[]) => (await exec("git", ["-C", canonical, ...args], { timeout: 15_000, maxBuffer: 4 * 1024 * 1024, windowsHide: true })).stdout.trim();
  const root = await realpath(await git(["rev-parse", "--show-toplevel"]));
  if (root !== canonical) throw new Error(`请选择 Git 根目录：${root}；子目录请填入分析范围`);
  if (!scope.length || scope.length > 20) throw new Error("请配置 1 至 20 个分析范围");
  const normalized = scope.map((p) => {
    const value = p.trim().replaceAll("\\", "/");
    if (!value || isAbsolute(value) || value.startsWith(":") || value.split("/").includes("..") || value.split("/").includes(".git")) throw new Error("分析范围必须为仓库内相对路径，不能包含 .. 或 .git");
    return value;
  });
  for (const p of normalized) {
    const target = await realpath(resolve(root, p));
    const rel = relative(root, target);
    if (rel.startsWith("..") || isAbsolute(rel)) throw new Error("分析范围指向仓库之外");
    await access(target);
  }
  return { path: canonical, root, branch: await git(["rev-parse", "--abbrev-ref", "HEAD"]), commit: await git(["rev-parse", "HEAD"]), dirty: Boolean(await git(["status", "--porcelain"])), scope: normalized };
}
export function createRepositoryStore(db: DatabaseSync, accountId: string, spaceId: string) {
  if (!db.prepare("SELECT id FROM requirement_spaces WHERE id=? AND account_id=?").get(spaceId, accountId)) throw new Error("需求空间不存在或无权访问");
  db.exec(`CREATE TABLE IF NOT EXISTS requirement_repositories (id TEXT PRIMARY KEY, space_id TEXT NOT NULL REFERENCES requirement_spaces(id), data TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS requirement_stage_inputs (space_id TEXT NOT NULL, stage_key TEXT NOT NULL, data TEXT NOT NULL, PRIMARY KEY(space_id,stage_key));
    CREATE TABLE IF NOT EXISTS requirement_input_snapshots (id TEXT PRIMARY KEY, conversation_id TEXT NOT NULL, message_id TEXT, data TEXT NOT NULL);`);
  function list(): Repository[] { return db.prepare("SELECT data FROM requirement_repositories WHERE space_id=? ORDER BY rowid").all(spaceId).map(r => JSON.parse(String(r.data))); }
  function selection(key: string): Selection | undefined {
    if (stageIndex(key) < 0) throw new Error("需求阶段无效");
    const r = db.prepare("SELECT data FROM requirement_stage_inputs WHERE space_id=? AND stage_key=?").get(spaceId, key);
    return r ? JSON.parse(String(r.data)) : undefined;
  }
  return { list, selection,
    async save(input: { id?: string; name: string; roles: string[]; path: string; scope: string[] }) {
      if (!Array.isArray(input.roles) || !input.roles.length || input.roles.some(r => !["前端", "后端", "公共库", "其他"].includes(r))) throw new Error("请选择仓库用途");
      if (!input.name?.trim()) throw new Error("仓库名称不能为空");
      const verified = await inspectRepository(input.path, input.scope);
      const previous = list();
      if (input.id && !previous.some(r => r.id === input.id)) throw new Error("仓库关联不属于当前需求");
      if (previous.some(r => r.path === verified.path && r.id !== input.id)) throw new Error("此仓库已关联，请编辑其用途或分析范围");
      const repo: Repository = { ...verified, id: input.id || randomUUID(), name: input.name.trim(), roles: [...new Set(input.roles)] };
      db.prepare("INSERT INTO requirement_repositories VALUES (?,?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data").run(repo.id, spaceId, JSON.stringify(repo));
      return repo;
    },
    remove(id: string) {
      if (!list().some(r => r.id === id)) throw new Error("仓库关联不存在");
      db.prepare("DELETE FROM requirement_repositories WHERE id=? AND space_id=?").run(id, spaceId);
      for (const row of db.prepare("SELECT stage_key,data FROM requirement_stage_inputs WHERE space_id=?").all(spaceId)) {
        const s: Selection = JSON.parse(String(row.data)); s.repositories = s.repositories.filter(r => r !== id);
        db.prepare("UPDATE requirement_stage_inputs SET data=? WHERE space_id=? AND stage_key=?").run(JSON.stringify(s), spaceId, String(row.stage_key));
      }
    },
    select(key: string, value: Selection) {
      selection(key);
      if (!Array.isArray(value.repositories) || !Array.isArray(value.assets) || value.repositories.length > 20 || value.assets.length > 100) throw new Error("引用选择无效");
      const ids = new Set(list().map(r => r.id));
      if (value.repositories.some(id => !ids.has(id))) throw new Error("引用了不属于本需求的仓库");
      db.prepare("INSERT INTO requirement_stage_inputs VALUES (?,?,?) ON CONFLICT(space_id,stage_key) DO UPDATE SET data=excluded.data").run(spaceId, key, JSON.stringify({ ...value, repositories: [...new Set(value.repositories)], discussionOnly: value.discussionOnly === true }));
    },
  };
}

/** Capture repository identity, not source bytes. Tools read the working tree on demand. */
export async function referenceRepository(repo: Repository) {
  const verified = await inspectRepository(repo.path, repo.scope);
  if (verified.root !== repo.root) throw new Error("仓库根目录已变化，请重新关联");
  return { ...repo, ...verified, sourceMode: "working-tree" as const };
}
