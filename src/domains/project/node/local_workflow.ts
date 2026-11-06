import { createHash, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import {
  copyFileSync, mkdirSync, readFileSync, realpathSync, renameSync, rmSync,
  statSync, writeFileSync,
} from "node:fs";
import { basename, dirname, extname, join, resolve } from "node:path";
import type { DatabaseSync } from "node:sqlite";

import { getDb } from "../../../infra/db.ts";
import { platformPaths } from "../../../platform/paths.ts";
import type {
  LocalAsset, LocalProject, LocalProjectCreate, LocalProjectEvent, LocalRepository,
  LocalStage, LocalStageStatus,
} from "../shared/workflow.ts";

export const LOCAL_PROJECT_CONVERSATION_EXCLUSION_SQL =
  "NOT EXISTS (SELECT 1 FROM local_project_conversations lpc WHERE lpc.conversation_id = conversations.id)";

export class LocalProjectWorkflowError extends Error {
  constructor(
    message: string,
    readonly code = "LOCAL_PROJECT_ERROR",
    readonly status = 400,
  ) {
    super(message);
    this.name = "LocalProjectWorkflowError";
  }
}

export interface LocalProjectConversation {
  id: string;
  status: string;
  workspaceId?: string | null;
  expertId?: string | null;
  [key: string]: unknown;
}

export interface LocalProjectWorkflowRuntime {
  ensureWorkspace(input: { accountId: string; projectId: string; name: string; dirPath: string }):
    Promise<{ id: string; created: boolean }> | { id: string; created: boolean };
  deleteWorkspace?(workspaceId: string): Promise<void> | void;
  createConversation(input: {
    title: string; category: "project"; workspaceId: string;
    modelProvider: string; modelId: string;
  }): Promise<LocalProjectConversation> | LocalProjectConversation;
  deleteConversation?(conversationId: string): Promise<void> | void;
  bindExpert(conversationId: string, expertId: string): Promise<void> | void;
  getConversation(conversationId: string): Promise<LocalProjectConversation | null> | LocalProjectConversation | null;
  isConversationBusy(conversationId: string): boolean;
  collectPresentedFiles?(conversationId: string): Promise<Array<{ path: string }>> | Array<{ path: string }>;
}

export interface LocalProjectExecutionRevision {
  projectId: string;
  projectRevision: number;
  stageId: string;
  reviewVersion: number;
  expertId: string;
}

export interface LocalProjectConversationContext {
  project: LocalProject;
  stage: LocalStage;
  executionRevision: LocalProjectExecutionRevision;
  connectorIds: string[];
  upstream: Array<{
    stageId: string; title: string; summary: string; reviewVersion: number;
    assets: LocalAsset[];
  }>;
}

interface InternalAsset extends LocalAsset {
  snapshotPath: string;
  conversationId: string | null;
}
interface InternalStage extends LocalStage {
  confirmedRequestRevision?: number | null;
}
interface InternalProject extends Omit<LocalProject, "assets" | "stages"> {
  accountId: string;
  assets: InternalAsset[];
  stages: InternalStage[];
}

interface ServiceDependencies {
  db: DatabaseSync;
  runtime: LocalProjectWorkflowRuntime;
  now?: () => number;
  defaultProjectsDir?: string;
}

const missingRuntime: LocalProjectWorkflowRuntime = {
  ensureWorkspace: () => { throw new Error("Local project runtime is not configured"); },
  createConversation: () => { throw new Error("Local project runtime is not configured"); },
  bindExpert: () => { throw new Error("Local project runtime is not configured"); },
  getConversation: () => null,
  isConversationBusy: () => false,
};

function text(value: unknown, field: string, max = 10_000): string {
  if (typeof value !== "string") throw new LocalProjectWorkflowError(`${field} 必须是字符串`, "INVALID_INPUT");
  const result = value.trim();
  if (!result) throw new LocalProjectWorkflowError(`${field}不能为空`, "INVALID_INPUT");
  if (result.length > max) throw new LocalProjectWorkflowError(`${field}过长`, "INVALID_INPUT");
  return result;
}

function optionalText(value: unknown, field: string, max = 10_000): string {
  if (value === undefined || value === null) return "";
  if (typeof value !== "string") throw new LocalProjectWorkflowError(`${field} 必须是字符串`, "INVALID_INPUT");
  const result = value.trim();
  if (result.length > max) throw new LocalProjectWorkflowError(`${field}过长`, "INVALID_INPUT");
  return result;
}

function clonePublic(project: InternalProject): LocalProject {
  const { accountId: _accountId, assets: _assets, stages: _stages, ...publicProject } = project;
  return {
    ...publicProject,
    stages: project.stages.map(({ confirmedRequestRevision: _ignored, ...stage }) => ({
      ...stage,
      review: stage.review ? { ...stage.review, assetIds: [...stage.review.assetIds] } : null,
    })),
    assets: project.assets.map(({ snapshotPath: _snapshot, conversationId: _conversation, ...asset }) => ({ ...asset })),
    connectors: [...project.connectors], repositories: project.repositories.map((item) => ({ ...item })),
    events: project.events.map((item) => ({ ...item })),
  };
}

function sha256(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function atomicJson(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.${randomUUID()}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  renameSync(temporary, path);
}

function event(textValue: string, createdAt: number): LocalProjectEvent {
  return { id: randomUUID(), text: textValue, createdAt };
}

function cleanName(value: string): string {
  const cleaned = basename(value).replace(/[\\/:*?"<>|\u0000-\u001f]/g, "-").slice(0, 120);
  return cleaned || "asset";
}

function ensureTables(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS local_project_records (
      id TEXT PRIMARY KEY,
      account_id TEXT NOT NULL,
      data_json TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_local_project_records_account_updated
      ON local_project_records(account_id, updated_at DESC);
    CREATE TABLE IF NOT EXISTS local_project_conversations (
      conversation_id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      account_id TEXT NOT NULL,
      stage_id TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      FOREIGN KEY(project_id) REFERENCES local_project_records(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_local_project_conversations_project
      ON local_project_conversations(project_id, stage_id);
  `);
}

function validateStages(input: LocalProjectCreate["stages"]): InternalStage[] {
  if (!Array.isArray(input) || input.length === 0) throw new LocalProjectWorkflowError("项目至少需要一个阶段", "INVALID_STAGES");
  const ids = new Set<string>();
  return input.map((stage) => {
    const id = text(stage.id, "阶段 ID", 80);
    if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(id) || ids.has(id)) throw new LocalProjectWorkflowError("阶段 ID 无效或重复", "INVALID_STAGES");
    ids.add(id);
    return {
      id, title: text(stage.title, "阶段名称", 80), goal: text(stage.goal, "阶段目标", 2_000),
      expertId: optionalText(stage.expertId, "专家 ID", 200), expertName: optionalText(stage.expertName, "专家名称", 200),
      status: "pending" as LocalStageStatus, conversationId: null, review: null, approvedAt: null,
      confirmedRequestRevision: null,
    };
  });
}

export function createLocalProjectWorkflowService(dependencies: ServiceDependencies) {
  const { db, runtime } = dependencies;
  const now = dependencies.now ?? Date.now;
  const projectLocks = new Map<string, Promise<unknown>>();
  ensureTables(db);

  function read(id: string, accountId?: string): InternalProject | null {
    const row = db.prepare(
      `SELECT data_json as dataJson FROM local_project_records WHERE id = ?${accountId ? " AND account_id = ?" : ""}`,
    ).get(...(accountId ? [id, accountId] : [id])) as { dataJson: string } | undefined;
    return row ? JSON.parse(row.dataJson) as InternalProject : null;
  }
  function required(accountId: string, id: string): InternalProject {
    const project = read(id, accountId);
    if (!project) throw new LocalProjectWorkflowError("Local project not found", "PROJECT_NOT_FOUND", 404);
    return project;
  }
  function write(project: InternalProject): void {
    db.exec('SAVEPOINT local_project_write');
    try {
      const result = db.prepare("UPDATE local_project_records SET data_json = ?, updated_at = ? WHERE id = ? AND account_id = ? AND json_extract(data_json, '$.revision') = ?")
        .run(JSON.stringify(project), project.updatedAt, project.id, project.accountId, project.revision - 1);
      if (result.changes !== 1) throw new LocalProjectWorkflowError('项目版本已变化，请刷新后重试', 'STALE_REVISION', 409);
      atomicJson(join(project.dirPath, ".picoddy", "project.json"), clonePublic(project));
      db.exec('RELEASE local_project_write');
    } catch (error) {
      db.exec('ROLLBACK TO local_project_write');
      db.exec('RELEASE local_project_write');
      throw error;
    }
  }
  function bump(project: InternalProject, description: string): void {
    project.revision += 1;
    project.updatedAt = now();
    project.events.unshift(event(description, project.updatedAt));
  }
  function stage(project: InternalProject, stageId: string): InternalStage {
    const found = project.stages.find((item) => item.id === stageId);
    if (!found) throw new LocalProjectWorkflowError("阶段不存在", "STAGE_NOT_FOUND", 404);
    return found;
  }
  function assertMutable(project: InternalProject): void {
    if (project.archived) throw new LocalProjectWorkflowError("项目已归档", "PROJECT_ARCHIVED", 409);
  }
  function assertCurrent(project: InternalProject, stageId: string): InternalStage {
    assertMutable(project);
    if (project.currentStageId !== stageId) throw new LocalProjectWorkflowError("只能操作当前阶段，前序阶段尚未确认", "STAGE_LOCKED", 409);
    const current = stage(project, stageId);
    const index = project.stages.indexOf(current);
    if (project.stages.slice(0, index).some((item) => item.status !== "completed")) {
      throw new LocalProjectWorkflowError("前序阶段尚未确认", "STAGE_LOCKED", 409);
    }
    return current;
  }
  function assertIdle(current: InternalStage): void {
    if (current.conversationId && runtime.isConversationBusy(current.conversationId)) {
      throw new LocalProjectWorkflowError("当前阶段会话仍在运行中", "STAGE_BUSY", 409);
    }
  }
  function assertProjectIdle(project: InternalProject): void {
    const busy = project.stages.find((item) => item.conversationId && runtime.isConversationBusy(item.conversationId));
    if (busy) throw new LocalProjectWorkflowError(`项目阶段“${busy.title}”仍在运行中`, "STAGE_BUSY", 409);
  }
  function withLock<T>(projectId: string, operation: () => Promise<T>): Promise<T> {
    const previous = projectLocks.get(projectId) ?? Promise.resolve();
    const current = previous.catch(() => {}).then(operation);
    projectLocks.set(projectId, current);
    return current.finally(() => { if (projectLocks.get(projectId) === current) projectLocks.delete(projectId); });
  }
  function nextAssetVersion(project: InternalProject, stageId: string, name: string): number {
    return 1 + Math.max(0, ...project.assets.filter((asset) => asset.stageId === stageId && asset.name === name).map((asset) => asset.version));
  }
  function createAsset(project: InternalProject, stageId: string, sourcePath: string, preferredName?: string, conversationId?: string | null): InternalAsset {
    const targetStage = stage(project, stageId);
    const source = realpathSync(resolve(sourcePath));
    if (!statSync(source).isFile()) throw new LocalProjectWorkflowError("资产路径必须是普通文件", "INVALID_ASSET");
    const name = cleanName(preferredName || basename(source));
    const version = nextAssetVersion(project, stageId, name);
    const workPath = join(project.dirPath, "assets", stageId, `v${version}-${name}`);
    mkdirSync(dirname(workPath), { recursive: true });
    if (resolve(source) !== resolve(workPath)) copyFileSync(source, workPath);
    const hash = sha256(workPath);
    const id = randomUUID();
    const snapshotPath = join(project.dirPath, ".picoddy", "snapshots", id, `v${version}-${hash}${extname(name)}`);
    mkdirSync(dirname(snapshotPath), { recursive: true });
    copyFileSync(workPath, snapshotPath);
    const asset: InternalAsset = {
      id, name, path: workPath, hash, stageId: targetStage.id, version, createdAt: now(), confirmed: false,
      snapshotPath, conversationId: conversationId ?? targetStage.conversationId,
    };
    project.assets.push(asset);
    return asset;
  }
  function verifyAsset(asset: InternalAsset): void {
    try {
      if (!statSync(asset.path).isFile() || !statSync(asset.snapshotPath).isFile()) throw new Error("not a file");
      if (sha256(asset.path) !== asset.hash || sha256(asset.snapshotPath) !== asset.hash) throw new Error("hash changed");
    } catch (error) {
      throw new LocalProjectWorkflowError(`交付文件已缺失或发生变化：${asset.name}`, "ASSET_CHANGED", 409);
    }
  }
  function verifySnapshot(asset: InternalAsset): void {
    try {
      if (!statSync(asset.snapshotPath).isFile() || sha256(asset.snapshotPath) !== asset.hash) throw new Error("snapshot changed");
    } catch {
      throw new LocalProjectWorkflowError(`确认快照已缺失或损坏：${asset.name}`, "ASSET_CHANGED", 409);
    }
  }
  function invalidateChangedConfirmedAssets(project: InternalProject): boolean {
    let changed = false;
    const invalidated = new Set<string>();
    for (const asset of project.assets.filter((item) => item.confirmed && project.stages.some(source =>
      source.id === item.stageId && source.status === 'completed' && source.review?.assetIds.includes(item.id)))) {
      verifySnapshot(asset);
      let workChanged = false;
      try { workChanged = !statSync(asset.path).isFile() || sha256(asset.path) !== asset.hash; }
      catch { workChanged = true; }
      if (!workChanged) continue;
      const sourceIndex = project.stages.findIndex((item) => item.id === asset.stageId);
      if (sourceIndex < 0) continue;
      for (const downstream of project.stages.slice(sourceIndex + 1)) {
        if (downstream.status !== "needs-review") {
          downstream.status = "needs-review";
          downstream.approvedAt = null;
          downstream.confirmedRequestRevision = null;
          changed = true;
        }
        invalidated.add(downstream.title);
      }
    }
    if (changed) bump(project, `已确认工作文件发生变化，下游待复核：${[...invalidated].join("、")}`);
    return changed;
  }
  function executionRevision(project: InternalProject, current: InternalStage): LocalProjectExecutionRevision {
    return {
      projectId: project.id, projectRevision: project.revision, stageId: current.id,
      reviewVersion: current.review?.version ?? 0, expertId: current.expertId,
    };
  }

  async function createProject(accountIdValue: string, input: LocalProjectCreate): Promise<LocalProject> {
    const accountId = text(accountIdValue, "账号", 240);
    const name = text(input.name, "项目名称", 40);
    const id = randomUUID();
    const requestedDir = optionalText(input.dirPath, "项目目录", 4_096);
    const base = dependencies.defaultProjectsDir ?? join(platformPaths.appDataDir, "local-projects");
    let dirPath = resolve(requestedDir || join(base, `${name}-${id.slice(0, 8)}`));
    mkdirSync(dirPath, { recursive: true });
    dirPath = realpathSync(dirPath);
    const alreadyOwned = (db.prepare("SELECT data_json as dataJson FROM local_project_records").all() as unknown as Array<{ dataJson: string }>)
      .some((row) => resolve((JSON.parse(row.dataJson) as InternalProject).dirPath) === dirPath);
    if (alreadyOwned) throw new LocalProjectWorkflowError("项目目录已由另一个本地项目占用", "PROJECT_DIR_OWNED", 409);
    try {
      const manifest = JSON.parse(readFileSync(join(dirPath, ".picoddy", "project.json"), "utf8"));
      if (manifest && typeof manifest.id === "string") throw new LocalProjectWorkflowError("项目目录已包含另一个项目清单", "PROJECT_DIR_OWNED", 409);
    } catch (error) {
      if (error instanceof LocalProjectWorkflowError) throw error;
    }
    mkdirSync(join(dirPath, "assets"), { recursive: true });
    mkdirSync(join(dirPath, ".picoddy", "snapshots"), { recursive: true });
    const createdAt = now();
    const stages = validateStages(input.stages);
    const project: InternalProject = {
      id, accountId, name, description: text(input.description, "项目目标", 10_000),
      instructions: optionalText(input.instructions, "项目指令", 20_000), dirPath,
      templateId: text(input.templateId, "模板", 120),
      connectors: [...new Set((input.connectors ?? []).map((item) => text(item, "连接器", 240)))],
      repositories: [], stages, assets: [], currentStageId: stages[0].id, archived: false,
      events: [event("创建本地项目", createdAt)], createdAt, updatedAt: createdAt, revision: 1,
    };
    db.prepare("INSERT INTO local_project_records(id, account_id, data_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?)")
      .run(id, accountId, JSON.stringify(project), createdAt, createdAt);
    try {
      atomicJson(join(dirPath, ".picoddy", "project.json"), clonePublic(project));
      for (const repository of input.repositories ?? []) await addRepository(accountId, id, repository);
      return clonePublic(required(accountId, id));
    } catch (error) {
      db.prepare("DELETE FROM local_project_records WHERE id = ? AND account_id = ?").run(id, accountId);
      const manifestPath = join(dirPath, ".picoddy", "project.json");
      try {
        if (JSON.parse(readFileSync(manifestPath, "utf8"))?.id === id) rmSync(manifestPath);
      } catch { /* Do not remove a manifest that cannot be proven to belong to this failed create. */ }
      throw error;
    }
  }

  function listProjects(accountId: string): LocalProject[] {
    return (db.prepare("SELECT data_json as dataJson FROM local_project_records WHERE account_id = ? ORDER BY updated_at DESC")
      .all(accountId) as unknown as Array<{ dataJson: string }>).map((row) => clonePublic(JSON.parse(row.dataJson)));
  }
  function getProject(accountId: string, id: string): LocalProject {
    const project = required(accountId, id);
    if (invalidateChangedConfirmedAssets(project)) write(project);
    return clonePublic(project);
  }

  async function addRepository(accountId: string, id: string, input: { name: string; path: string; role: string }): Promise<LocalProject> {
    return withLock(id, async () => {
      const project = required(accountId, id); assertMutable(project);
      assertProjectIdle(project);
      let path: string;
      try { path = realpathSync(resolve(text(input.path, "仓库路径", 4_096))); }
      catch { throw new LocalProjectWorkflowError("代码仓库目录不存在", "INVALID_REPOSITORY"); }
      if (!statSync(path).isDirectory()) throw new LocalProjectWorkflowError("代码仓库路径不是目录", "INVALID_REPOSITORY");
      let branch: string, commit: string, dirty: boolean;
      try {
        execFileSync("git", ["-C", path, "rev-parse", "--is-inside-work-tree"], { encoding: "utf8", timeout: 10_000 });
        branch = execFileSync("git", ["-C", path, "branch", "--show-current"], { encoding: "utf8", timeout: 10_000 }).trim() || "(detached)";
        commit = execFileSync("git", ["-C", path, "rev-parse", "HEAD"], { encoding: "utf8", timeout: 10_000 }).trim();
        dirty = Boolean(execFileSync("git", ["-C", path, "status", "--porcelain"], { encoding: "utf8", timeout: 10_000 }).trim());
      } catch { throw new LocalProjectWorkflowError("目录不是可读取的 Git 仓库", "INVALID_REPOSITORY"); }
      const repository: LocalRepository = {
        id: randomUUID(), name: text(input.name, "仓库名称", 160), path,
        role: text(input.role, "仓库角色", 120), branch, commit, dirty,
      };
      const duplicate = project.repositories.findIndex((item) => item.path === path);
      if (duplicate >= 0) project.repositories[duplicate] = { ...repository, id: project.repositories[duplicate].id };
      else project.repositories.push(repository);
      bump(project, `关联代码仓库：${repository.name}`); write(project); return clonePublic(project);
    });
  }

  async function addAsset(accountId: string, id: string, input: { path: string; stageId: string }): Promise<LocalProject> {
    return withLock(id, async () => {
      const project = required(accountId, id); assertMutable(project);
      assertProjectIdle(project);
      let asset: InternalAsset;
      try { asset = createAsset(project, text(input.stageId, "阶段 ID", 80), text(input.path, "资产路径", 4_096)); }
      catch (error) {
        if (error instanceof LocalProjectWorkflowError) throw error;
        throw new LocalProjectWorkflowError("资产文件不存在或不可读取", "INVALID_ASSET");
      }
      bump(project, `添加本地资产：${asset.name}`); write(project); return clonePublic(project);
    });
  }

  async function startStage(accountId: string, id: string, input: { stageId: string; modelProvider: string; modelId: string }) {
    return withLock(id, async () => {
      const project = required(accountId, id); const current = assertCurrent(project, input.stageId);
      if (!current.expertId) throw new LocalProjectWorkflowError("本阶段尚未选择专家", "EXPERT_REQUIRED", 422);
      if (current.status === "completed" || current.status === "needs-review") throw new LocalProjectWorkflowError("阶段状态已失效，请刷新", "STALE_STAGE", 409);
      if (current.conversationId) {
        const existing = await runtime.getConversation(current.conversationId);
        if (!existing) throw new LocalProjectWorkflowError("阶段会话已不存在，请重新打开项目", "CONVERSATION_MISSING", 409);
        return { project: clonePublic(project), conversation: existing };
      }
      assertProjectIdle(project);
      const workspace = await runtime.ensureWorkspace({ accountId, projectId: id, name: project.name, dirPath: project.dirPath });
      let conversation: LocalProjectConversation | null = null;
      try {
        conversation = await runtime.createConversation({
          title: `${project.name} · ${current.title}`, category: "project", workspaceId: workspace.id,
          modelProvider: text(input.modelProvider, "模型提供商", 200), modelId: text(input.modelId, "模型", 400),
        });
        await runtime.bindExpert(conversation.id, current.expertId);
        current.conversationId = conversation.id; current.status = "active";
        bump(project, `开始阶段：${current.title}`);
        db.exec("BEGIN IMMEDIATE");
        try {
          db.prepare("INSERT INTO local_project_conversations(conversation_id, project_id, account_id, stage_id, created_at) VALUES (?, ?, ?, ?, ?)")
            .run(conversation.id, id, accountId, current.id, now());
          write(project); db.exec("COMMIT");
        } catch (error) { db.exec("ROLLBACK"); throw error; }
        return { project: clonePublic(project), conversation };
      } catch (error) {
        if (conversation && runtime.deleteConversation) await Promise.resolve(runtime.deleteConversation(conversation.id)).catch(() => {});
        if (workspace.created && runtime.deleteWorkspace) await Promise.resolve(runtime.deleteWorkspace(workspace.id)).catch(() => {});
        throw error;
      }
    });
  }

  async function submitReview(accountId: string, id: string, input: { stageId: string; summary: string; risks: string; assetIds: string[] }): Promise<LocalProject> {
    return withLock(id, async () => {
      const project = required(accountId, id); const current = assertCurrent(project, input.stageId); assertProjectIdle(project); assertIdle(current);
      if (!current.conversationId || (current.status !== "active" && current.status !== "review")) throw new LocalProjectWorkflowError("请先开始本阶段", "STAGE_NOT_STARTED", 409);
      const summary = text(input.summary, "交付摘要", 20_000); const risks = optionalText(input.risks, "风险", 20_000);
      const selected = [...new Set(input.assetIds ?? [])].map((assetId) => {
        const asset = project.assets.find((item) => item.id === assetId && item.stageId === current.id);
        if (!asset) throw new LocalProjectWorkflowError("交付资产不属于当前阶段", "INVALID_ASSET", 400);
        verifyAsset(asset); return asset;
      });
      const reviewVersion = (current.review?.version ?? 0) + 1;
      const reviewDir = join(project.dirPath, ".picoddy", "reviews", current.id);
      const reviewSource = join(reviewDir, `review-v${reviewVersion}.md`);
      mkdirSync(reviewDir, { recursive: true });
      writeFileSync(reviewSource, `# ${current.title}交付审核\n\n## 摘要\n\n${summary}\n\n## 风险与未决问题\n\n${risks || "无"}\n`, "utf8");
      const reviewAsset = createAsset(project, current.id, reviewSource, `review-v${reviewVersion}.md`, current.conversationId);
      const assetIds = [...selected.map((asset) => asset.id), reviewAsset.id];
      current.review = { summary, risks, assetIds, version: reviewVersion }; current.status = "review";
      bump(project, `提交阶段审核：${current.title} v${reviewVersion}`); write(project); return clonePublic(project);
    });
  }

  function confirmStage(accountId: string, id: string, input: { stageId: string; revision: number }): LocalProject {
    const project = required(accountId, id); const target = stage(project, input.stageId);
    if (target.status === "completed" && target.confirmedRequestRevision === input.revision) return clonePublic(project);
    const current = assertCurrent(project, input.stageId); assertProjectIdle(project); assertIdle(current);
    if (input.revision !== project.revision) throw new LocalProjectWorkflowError("项目版本已变化，请刷新后确认", "STALE_REVISION", 409);
    if (current.status !== "review" || !current.review) throw new LocalProjectWorkflowError("当前阶段没有可确认的交付", "REVIEW_REQUIRED", 409);
    const selected = current.review.assetIds.map((assetId) => {
      const asset = project.assets.find((item) => item.id === assetId && item.stageId === current.id);
      if (!asset) throw new LocalProjectWorkflowError("交付资产不存在", "INVALID_ASSET", 409);
      verifyAsset(asset); return asset;
    });
    db.exec("BEGIN IMMEDIATE");
    try {
      const fresh = required(accountId, id);
      if (fresh.revision !== input.revision) throw new LocalProjectWorkflowError("项目版本已变化，请刷新后确认", "STALE_REVISION", 409);
      const approvedAt = now(); current.status = "completed"; current.approvedAt = approvedAt; current.confirmedRequestRevision = input.revision;
      selected.forEach((asset) => { asset.confirmed = true; });
      const index = project.stages.indexOf(current); const next = project.stages[index + 1];
      if (next) {
        project.currentStageId = next.id;
        if (next.status === 'needs-review') {
          next.status = next.conversationId ? 'active' : 'pending';
          next.review = null;
        }
      }
      bump(project, `确认阶段交付：${current.title}`); write(project); db.exec("COMMIT");
      return clonePublic(project);
    } catch (error) { db.exec("ROLLBACK"); throw error; }
  }

  function reopenStage(accountId: string, id: string, input: { stageId: string }): LocalProject {
    const project = required(accountId, id); assertMutable(project); assertProjectIdle(project); const reopened = stage(project, input.stageId); assertIdle(reopened);
    if (reopened.status !== "completed") throw new LocalProjectWorkflowError("只能重新打开已完成阶段", "INVALID_STAGE_STATE", 409);
    const index = project.stages.indexOf(reopened);
    reopened.status = reopened.conversationId ? "active" : "pending"; reopened.approvedAt = null; reopened.review = null; reopened.confirmedRequestRevision = null;
    for (const downstream of project.stages.slice(index + 1)) {
      if (["completed", "review", "active"].includes(downstream.status)) downstream.status = "needs-review";
      downstream.approvedAt = null; downstream.confirmedRequestRevision = null;
    }
    project.currentStageId = reopened.id; bump(project, `重新打开阶段：${reopened.title}`); write(project); return clonePublic(project);
  }

  function updateSettings(accountId: string, id: string, patch: {
    name?: string; description?: string; instructions?: string; connectors?: string[];
    stages?: LocalProjectCreate["stages"];
  }): LocalProject {
    const project = required(accountId, id); assertMutable(project); assertProjectIdle(project);
    const baselineChanged = patch.description !== undefined && patch.description.trim() !== project.description ||
      patch.instructions !== undefined && patch.instructions.trim() !== project.instructions;
    if (baselineChanged && project.stages.some(item => item.status === 'completed')) {
      throw new LocalProjectWorkflowError('修改已确认的项目目标或指令前，请先重新打开首阶段', 'BASELINE_LOCKED', 409);
    }
    if (baselineChanged) {
      const current = stage(project, project.currentStageId);
      if (current.review) { current.review = null; current.status = 'active'; }
    }
    if (patch.name !== undefined) project.name = text(patch.name, "项目名称", 40);
    if (patch.description !== undefined) project.description = text(patch.description, "项目目标", 10_000);
    if (patch.instructions !== undefined) project.instructions = optionalText(patch.instructions, "项目指令", 20_000);
    if (patch.connectors !== undefined) project.connectors = [...new Set(patch.connectors.map((item) => text(item, "连接器", 240)))];
    if (patch.stages !== undefined) {
      const replacement = validateStages(patch.stages);
      const existingById = new Map(project.stages.map((item) => [item.id, item]));
      for (const candidate of replacement) {
        const existing = existingById.get(candidate.id);
        if (existing?.conversationId || existing?.status === "completed") {
          if (existing.expertId !== candidate.expertId) throw new LocalProjectWorkflowError('已建立会话的阶段不能更换专家，请新增阶段以保留历史绑定', 'EXPERT_LOCKED', 409);
          if (project.stages.indexOf(existing) !== replacement.indexOf(candidate)) throw new LocalProjectWorkflowError('不能调整已开始阶段的顺序', 'INVALID_STAGES', 409);
          Object.assign(candidate, existing, { title: candidate.title, goal: candidate.goal, expertId: candidate.expertId, expertName: candidate.expertName });
        }
      }
      for (const existing of project.stages) if ((existing.conversationId || existing.status === "completed") && !replacement.some((item) => item.id === existing.id)) {
        throw new LocalProjectWorkflowError("不能删除已开始阶段", "INVALID_STAGES", 409);
      }
      project.stages = replacement;
      if (!replacement.some((item) => item.id === project.currentStageId)) project.currentStageId = replacement[0].id;
    }
    bump(project, "更新项目设置"); write(project); return clonePublic(project);
  }

  function setArchived(accountId: string, id: string, archived: boolean): LocalProject {
    const project = required(accountId, id);
    for (const item of project.stages) if (item.conversationId && runtime.isConversationBusy(item.conversationId)) throw new LocalProjectWorkflowError("项目仍有会话运行中", "STAGE_BUSY", 409);
    project.archived = Boolean(archived); bump(project, project.archived ? "归档项目" : "恢复项目"); write(project); return clonePublic(project);
  }

  async function getContextForConversation(accountId: string, conversationId: string, expected?: LocalProjectExecutionRevision): Promise<LocalProjectConversationContext | null> {
    const mapping = db.prepare("SELECT project_id as projectId, account_id as accountId, stage_id as stageId FROM local_project_conversations WHERE conversation_id = ?")
      .get(conversationId) as { projectId: string; accountId: string; stageId: string } | undefined;
    if (!mapping) return null;
    if (mapping.accountId !== accountId) throw new LocalProjectWorkflowError("无权访问本地项目会话", "PROJECT_NOT_FOUND", 404);
    const project = required(accountId, mapping.projectId); assertMutable(project);
    if (invalidateChangedConfirmedAssets(project)) write(project);
    const current = stage(project, mapping.stageId);
    if (project.currentStageId !== current.id || current.conversationId !== conversationId || current.status === "completed" || current.status === "needs-review") {
      throw new LocalProjectWorkflowError("阶段会话已失效，请返回项目工作台", "STALE_STAGE", 409);
    }
    const conversation = await runtime.getConversation(conversationId);
    if (!conversation) throw new LocalProjectWorkflowError("阶段会话不存在", "CONVERSATION_MISSING", 409);
    if (conversation.expertId !== undefined && conversation.expertId !== null && conversation.expertId !== current.expertId) {
      throw new LocalProjectWorkflowError("阶段专家绑定已变化，请刷新项目", "EXPERT_CHANGED", 409);
    }
    const revision = executionRevision(project, current);
    if (expected && JSON.stringify(expected) !== JSON.stringify(revision)) throw new LocalProjectWorkflowError("项目执行上下文已变化", "STALE_REVISION", 409);
    const currentIndex = project.stages.indexOf(current);
    const upstream = project.stages.slice(0, currentIndex).map((item) => {
      if (item.status !== "completed" || !item.review) throw new LocalProjectWorkflowError("上游阶段确认已失效", "STALE_STAGE", 409);
      const assets = item.review.assetIds.map((assetId) => {
        const asset = project.assets.find((candidate) => candidate.id === assetId && candidate.confirmed);
        if (!asset) throw new LocalProjectWorkflowError("上游确认资产不存在", "ASSET_CHANGED", 409);
        verifySnapshot(asset); return asset;
      });
      return { stageId: item.id, title: item.title, summary: item.review.summary, reviewVersion: item.review.version, assets };
    });
    const contextProject = clonePublic(project);
    contextProject.assets = contextProject.assets.map((asset) => {
      const internal = project.assets.find((candidate) => candidate.id === asset.id)!;
      return internal.confirmed ? { ...asset, path: internal.snapshotPath } : asset;
    });
    return {
      project: contextProject,
      stage: contextProject.stages[currentIndex],
      executionRevision: revision,
      connectorIds: [...project.connectors],
      upstream: upstream.map((item) => ({
        ...item,
        assets: item.assets.map(({ snapshotPath, conversationId: _c, ...asset }) => ({ ...asset, path: snapshotPath })),
      })),
    };
  }

  async function refreshPresentedAssets(accountId: string, id: string): Promise<LocalProject> {
    const project = required(accountId, id); const current = stage(project, project.currentStageId);
    if (!current.conversationId || !runtime.collectPresentedFiles || runtime.isConversationBusy(current.conversationId)) return clonePublic(project);
    const files = await runtime.collectPresentedFiles(current.conversationId);
    const seenHashes = new Set(project.assets.filter((asset) => asset.stageId === current.id && asset.conversationId === current.conversationId).map((asset) => asset.hash));
    for (const file of files) {
      let source: string;
      try { source = realpathSync(resolve(file.path)); if (!statSync(source).isFile()) continue; } catch { continue; }
      const hash = sha256(source);
      if (seenHashes.has(hash)) continue;
      await addAsset(accountId, id, { path: source, stageId: current.id });
      seenHashes.add(hash);
    }
    return getProject(accountId, id);
  }

  async function beginConversationTurn(accountId: string, conversationId: string, expected?: LocalProjectExecutionRevision): Promise<LocalProjectConversationContext | null> {
    const context = await getContextForConversation(accountId, conversationId, expected);
    if (!context || !context.stage.review) return context;
    db.exec("BEGIN IMMEDIATE");
    try {
      const project = required(accountId, context.project.id);
      const current = stage(project, context.stage.id);
      const actual = executionRevision(project, current);
      if (expected && JSON.stringify(actual) !== JSON.stringify(expected)) throw new LocalProjectWorkflowError("项目执行上下文已变化", "STALE_REVISION", 409);
      if (current.conversationId !== conversationId || current.status !== "review" || !current.review) {
        throw new LocalProjectWorkflowError("阶段审核状态已变化", "STALE_STAGE", 409);
      }
      current.review = null;
      current.status = "active";
      bump(project, `继续修改阶段交付：${current.title}`);
      write(project);
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
    return getContextForConversation(accountId, conversationId);
  }

  function ownsConversation(conversationId: string, accountId?: string): boolean {
    const row = db.prepare(`SELECT 1 as owned FROM local_project_conversations WHERE conversation_id = ?${accountId ? " AND account_id = ?" : ""}`)
      .get(...(accountId ? [conversationId, accountId] : [conversationId]));
    return Boolean(row);
  }
  function inspectAssetSnapshot(accountId: string, id: string, assetId: string) {
    const asset = required(accountId, id).assets.find((item) => item.id === assetId);
    if (!asset) throw new LocalProjectWorkflowError("资产不存在", "ASSET_NOT_FOUND", 404);
    return { snapshotPath: asset.snapshotPath, conversationId: asset.conversationId };
  }

  return {
    createProject, listProjects, getProject, addRepository, addAsset, startStage, submitReview,
    confirmStage, reopenStage, updateSettings, setArchived, getContextForConversation,
    validateConversationExecution: getContextForConversation, beginConversationTurn, refreshPresentedAssets,
    ownsConversation, inspectAssetSnapshot,
  };
}

export type LocalProjectWorkflowService = ReturnType<typeof createLocalProjectWorkflowService>;
let defaultService: LocalProjectWorkflowService | null = null;
let defaultRuntime: LocalProjectWorkflowRuntime = missingRuntime;
let runtimeConfigured = false;

export function configureLocalProjectWorkflowRuntime(runtime: LocalProjectWorkflowRuntime): LocalProjectWorkflowService {
  if (!runtimeConfigured) {
    defaultRuntime = runtime;
    runtimeConfigured = true;
    defaultService = null;
  }
  return getLocalProjectWorkflowService();
}

export function getLocalProjectWorkflowService(runtime?: LocalProjectWorkflowRuntime): LocalProjectWorkflowService {
  if (runtime) return configureLocalProjectWorkflowRuntime(runtime);
  if (!defaultService) defaultService = createLocalProjectWorkflowService({
    db: getDb(), runtime: defaultRuntime,
    defaultProjectsDir: join(platformPaths.appDataDir, "local-projects"),
  });
  return defaultService;
}

export async function getContextForConversation(accountId: string, conversationId: string, expected?: LocalProjectExecutionRevision) {
  return getLocalProjectWorkflowService().getContextForConversation(accountId, conversationId, expected);
}
export async function validateConversationExecution(accountId: string, conversationId: string, expected?: LocalProjectExecutionRevision) {
  return getLocalProjectWorkflowService().validateConversationExecution(accountId, conversationId, expected);
}
export async function beginConversationTurn(accountId: string, conversationId: string, expected?: LocalProjectExecutionRevision) {
  return getLocalProjectWorkflowService().beginConversationTurn(accountId, conversationId, expected);
}
export function ownsConversation(conversationId: string, accountId?: string): boolean {
  return getLocalProjectWorkflowService().ownsConversation(conversationId, accountId);
}
