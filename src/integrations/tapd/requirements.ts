import { tapdReadCache } from "./read_cache.ts";
import { getActiveAuthSession } from "../../auth/session_store.ts";
import { createHash } from "node:crypto";
import { createTapdReadScheduler } from "./read_scheduler.ts";
import { TapdRateLimitError, assertTapdRateLimit } from "./rate_limit.ts";
import { loadMcpConfig } from "../../agent/mcp.ts";

interface TapdEnvelope<T> {
  status?: number;
  data?: T;
  info?: string;
  message?: string;
}

interface TapdWorkspace {
  id: string;
  name: string;
  pretty_name?: string;
  category?: string;
  status?: string;
  closed?: string;
}

interface TapdStory {
  id: string;
  name: string;
  description?: string;
  workspace_id?: string;
  status?: string;
  owner?: string;
  creator?: string;
  created?: string;
  modified?: string;
  priority?: string;
  priority_label?: string;
  step?: string;
  workitem_type_id?: string;
}

export interface TapdRequirement {
  id: string;
  name: string;
  description: string;
  status: string;
  statusLabel: string;
  owner: string;
  priority: string;
  createdAt: string;
  modifiedAt: string;
  workspaceId: string;
  workspaceName: string;
  url: string;
}

export interface TapdRequirementsResult {
  requirements: TapdRequirement[];
  workspaces: Array<{ id: string; name: string }>;
  selectedWorkspaceId: string;
  statuses: string[];
  failedWorkspaceCount: number;
  syncedAt: string;
  owner: string;
  page: number;
  pageSize: number;
  total: number;
}

export interface TapdTask {
  id: string;
  name: string;
  description: string;
  status: string;
  owner: string;
  creator: string;
  storyId: string;
  workspaceId: string;
  modifiedAt: string;
}

export interface TapdAttachment {
  id: string;
  filename: string;
  url: string;
  size: number;
  contentType: string;
  owner: string;
  createdAt: string;
  entryId: string;
}

export interface TapdRequirementContext {
  requirement: TapdRequirement | null;
  tasks: TapdTask[];
  attachments: TapdAttachment[];
  syncedAt: string;
}

export class TapdRequirementsError extends Error {
  constructor(message: string, public readonly code: string) {
    super(message);
    this.name = "TapdRequirementsError";
  }
}

const lastWorkspace = new Map<string, string>();
const CACHE_TTL_MS = 30_000;
const cache = new Map<string, { expiresAt: number; value: TapdRequirementsResult }>();

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : value == null ? "" : String(value);
}

function stripHtml(value: unknown): string {
  return text(value)
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/\s+/g, " ")
    .trim();
}

let cacheGeneration = 0;
export function invalidateTapdReadCache() { cacheGeneration++; tapdReadCache.clear(); cache.clear(); }
let freshReadId = 0;
const STORY_FIELDS = "id,name,description,workspace_id,status,owner,creator,created,modified,priority,priority_label,step,workitem_type_id";
const tapdReads = createTapdReadScheduler();
function readScope(baseUrl: string, token: string) {
  return `${getActiveAuthSession()?.userId || 'signed-out'}:${new URL(baseUrl).origin}:${createHash('sha256').update(token).digest('hex')}`;
}
async function tapdGet<T>(baseUrl: string, token: string, endpoint: string, params: Record<string, string | number> = {}, fresh = false): Promise<T> {
  const scope = readScope(baseUrl, token);
  const key = JSON.stringify([baseUrl, endpoint, Object.entries(params).sort(([a], [b]) => a.localeCompare(b))]);
  const generation = cacheGeneration;
  const ttl = endpoint.startsWith('workflows/') ? 30 * 60_000 : 30_000;
  return tapdReadCache.read(`${scope}:${key}`, ttl,
    () => tapdReads.run(scope, fresh ? `${key}:fresh:${++freshReadId}` : `${generation}:${key}`, () => tapdGetDirect<T>(baseUrl, token, endpoint, params)), fresh);
}

async function tapdGetDirect<T>(
  baseUrl: string,
  token: string,
  endpoint: string,
  params: Record<string, string | number> = {},
): Promise<T> {
  const url = new URL(`${baseUrl.replace(/\/$/, "")}/${endpoint.replace(/^\//, "")}`);
  url.searchParams.set("s", "mcp");
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, String(value));
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${token}`, Via: "mcp" },
    signal: AbortSignal.timeout(30_000),
  });
  if (response.status === 401 || response.status === 403) invalidateTapdReadCache();
  assertTapdRateLimit(response, endpoint);
  let payload: TapdEnvelope<T>;
  try {
    payload = await response.json() as TapdEnvelope<T>;
  } catch {
    throw new TapdRequirementsError("TAPD 返回了无法解析的数据", "TAPD_BAD_RESPONSE");
  }
  if (!response.ok || payload.status !== 1 || payload.data === undefined) {
    throw new TapdRequirementsError(
      text(payload.info || payload.message) || `TAPD 请求失败 (${response.status})`,
      response.status === 401 || response.status === 403 ? "TAPD_UNAUTHORIZED" : "TAPD_REQUEST_FAILED",
    );
  }
  return payload.data;
}

export async function listTapdRequirements(options: {
  force?: boolean;
  page?: number;
  pageSize?: number;
  query?: string;
  workspaceId?: string;
  status?: string;
} = {}): Promise<TapdRequirementsResult> {
  const config = (await loadMcpConfig()).mcpServers.tapd;
  const { refreshProjectGrants, acquireTapdCredential } = await import('../../domains/tapd-auth/node/service.ts');
  const grants = (await refreshProjectGrants()).filter(item => item.authorization === 'authorized');
  if (!grants.length) throw new TapdRequirementsError('暂无可访问的 TAPD 项目，请确认账号授权及项目权限', 'TAPD_NOT_CONFIGURED');
  if (grants.some(item => !item.tapdNick)) throw new TapdRequirementsError('TAPD 授权服务尚未返回经过验证的查询 nick，无法安全筛选“我的需求”', 'TAPD_IDENTITY_UNVERIFIED');
  const apiBaseUrl = text(config?.env?.TAPD_API_BASE_URL) || "https://api.tapd.cn";
  const webBaseUrl = text(config?.env?.TAPD_BASE_URL) || "https://www.tapd.cn";
  const owners = [...new Set(grants.map(g => g.tapdNick!))];
  const owner = owners.length === 1 ? owners[0] : '多个 TAPD 账号';
  const page = Math.max(1, Math.floor(Number(options.page) || 1));
  const pageSize = [20, 50, 100].includes(Number(options.pageSize)) ? Number(options.pageSize) : 20;
  const query = text(options.query).slice(0, 100);
  const accountKey = JSON.stringify([getActiveAuthSession()?.userId, [...new Set(grants.map(g => g.grantId))].sort()]);
  const remembered = lastWorkspace.get(accountKey);
  const workspaceId = text(options.workspaceId) || (grants.some(g => g.workspaceId === remembered) ? remembered! : grants[0].workspaceId);
  if (workspaceId !== '*' && !grants.some(g => g.workspaceId === workspaceId)) throw new TapdRequirementsError('所选 TAPD 项目已不可访问，请重新选择项目', 'TAPD_WORKSPACE_UNAVAILABLE');
  if (workspaceId !== '*') {
    if (lastWorkspace.size >= 512 && !lastWorkspace.has(accountKey)) lastWorkspace.delete(lastWorkspace.keys().next().value!);
    lastWorkspace.set(accountKey, workspaceId);
  }
  const statusFilter = text(options.status).slice(0, 100);
  const cacheKey = JSON.stringify({ account: getActiveAuthSession()?.userId, grants: grants.map(g => [g.grantId, g.revision, g.workspaceId]), owner, page, pageSize, query, workspaceId, statusFilter });
  if (options.force) invalidateTapdReadCache();
  const cached = cache.get(cacheKey);
  if (!options.force && cached && cached.expiresAt > Date.now()) return cached.value;

  const generation = cacheGeneration;
  const workspaces = grants.map(item => ({ id: item.workspaceId, name: item.workspaceName } as TapdWorkspace));
  const queriedWorkspaces = workspaceId !== '*'
    ? workspaces.filter((workspace) => workspace.id === workspaceId)
    : workspaces;

  const settled = await Promise.allSettled(queriedWorkspaces.map(async (workspace) => {
    const grant = grants.find(item => item.workspaceId === workspace.id)!;
    const token = (await acquireTapdCredential(workspace.id)).accessToken;
    const projectOwner = grant.tapdNick!;
    const statusMap = await tapdGet<Record<string, string>>(apiBaseUrl, token, "workflows/status_map", {
      workspace_id: workspace.id,
      system: "story",
    }).catch(error => { if (error instanceof TapdRateLimitError) throw error; return {} as Record<string, string>; });
    const statusCodes = statusFilter
      ? Object.entries(statusMap).filter(([, label]) => text(label) === statusFilter).map(([code]) => code)
      : [];
    if (statusFilter && statusCodes.length === 0) {
      return { count: 0, requirements: [] as TapdRequirement[], statuses: Object.values(statusMap).map(text) };
    }
    const filterParams: Record<string, string | number> = {
      workspace_id: workspace.id,
      owner: projectOwner,
      ...(query ? { name: `%${query}%` } : {}),
      ...(statusCodes.length ? { status: statusCodes.join("|") } : {}),
    };
    const countData = await tapdGet<{ count?: number | string }>(
      apiBaseUrl,
      token,
      "stories/count",
      filterParams,
    );
    const count = Math.max(0, Number(countData.count) || 0);
    const requiredPerWorkspace = Math.min(count, page * pageSize);
    const apiPageSize = 200;
    const apiPageCount = Math.ceil(requiredPerWorkspace / apiPageSize);
    const storyPages = await Promise.all(Array.from({ length: apiPageCount }, (_, index) =>
        tapdGet<Array<{ Story?: TapdStory }>>(apiBaseUrl, token, "stories", {
          ...filterParams,
          fields: "id,name,description,workspace_id,status,owner,creator,created,modified,priority,priority_label",
          page: index + 1,
          limit: apiPageSize,
          order: "modified desc",
        })
      ));
    const requirements = storyPages.flat().flatMap((row): TapdRequirement[] => {
      const story = row.Story;
      if (!story?.id || !story.name) return [];
      const status = text(story.status);
      return [{
        id: text(story.id),
        name: text(story.name),
        description: stripHtml(story.description),
        status,
        statusLabel: text(statusMap[status]) || status || "未设置",
        owner: text(story.owner) || text(story.creator) || "未分配",
        priority: text(story.priority_label) || text(story.priority) || "未设置",
        createdAt: text(story.created),
        modifiedAt: text(story.modified),
        workspaceId: workspace.id,
        workspaceName: text(workspace.name) || text(workspace.pretty_name) || workspace.id,
        url: `${webBaseUrl.replace(/\/$/, "")}/${workspace.id}/prong/stories/view/${story.id}`,
      }];
    });
    return { count, requirements, statuses: Object.values(statusMap).map(text) };
  }));

  const limited = settled.find(result => result.status === 'rejected' && result.reason instanceof TapdRateLimitError);
  if (limited?.status === 'rejected') throw limited.reason;
  const allRequirements = settled
    .flatMap((result) => result.status === "fulfilled" ? result.value.requirements : [])
    .sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt));
  const total = settled.reduce(
    (sum, result) => sum + (result.status === "fulfilled" ? result.value.count : 0),
    0,
  );
  const requirements = allRequirements.slice((page - 1) * pageSize, page * pageSize);
  const value: TapdRequirementsResult = {
    requirements,
    selectedWorkspaceId: workspaceId,
    workspaces: workspaces.map((workspace) => ({
      id: workspace.id,
      name: text(workspace.name) || text(workspace.pretty_name) || workspace.id,
    })),
    statuses: [...new Set(settled.flatMap((result) =>
      result.status === "fulfilled" ? result.value.statuses : []
    ).filter(Boolean))].sort((a, b) => a.localeCompare(b, "zh-CN")),
    failedWorkspaceCount: settled.filter((result) => result.status === "rejected").length,
    syncedAt: new Date().toISOString(),
    owner,
    page,
    pageSize,
    total,
  };
  if (generation === cacheGeneration) cache.set(cacheKey, { expiresAt: Date.now() + CACHE_TTL_MS, value });
  return value;
}

/** 读取需求详情、其下任务和已有附件；不修改 TAPD。 */
export async function getTapdRequirementContext(
  workspaceId: string,
  storyId: string,
  options: { fresh?: boolean } = {},
): Promise<TapdRequirementContext> {
  const config = (await loadMcpConfig()).mcpServers.tapd;
  const token = (await tapdCredential(workspaceId)).accessToken;
  const apiBaseUrl = text(config?.env?.TAPD_API_BASE_URL) || "https://api.tapd.cn";
  const webBaseUrl = text(config?.env?.TAPD_BASE_URL) || "https://www.tapd.cn";
  if (!workspaceId.trim() || !storyId.trim()) throw new TapdRequirementsError("TAPD 需求标识不完整", "INVALID_REQUEST");

  const [storyRows, taskRows, attachmentRows, statusMap] = await Promise.all([
    tapdGet<Array<{ Story?: TapdStory }>>(apiBaseUrl, token, "stories", {
      workspace_id: workspaceId, id: storyId, limit: 1,
      fields: STORY_FIELDS,
    }, options.fresh),
    tapdGet<Array<{ Task?: Record<string, unknown> }>>(apiBaseUrl, token, "tasks", {
      workspace_id: workspaceId, story_id: storyId, limit: 200, page: 1,
    }, options.fresh),
    tapdGet<Array<{ Attachment?: Record<string, unknown> }>>(apiBaseUrl, token, "attachments", {
      workspace_id: workspaceId, entry_id: storyId, limit: 200, page: 1,
    }, options.fresh),
    tapdGet<Record<string, string>>(apiBaseUrl, token, "workflows/status_map", {
      workspace_id: workspaceId, system: "story",
    }, options.fresh).catch(error => { if (error instanceof TapdRateLimitError) throw error; return {} as Record<string, string>; }),
  ]);
  const story = storyRows[0]?.Story;
  const requirement = story?.id ? {
    id: text(story.id), name: text(story.name), description: stripHtml(story.description),
    status: text(story.status), statusLabel: text(statusMap[text(story.status)]) || text(story.status), owner: text(story.owner) || text(story.creator) || "未分配",
    priority: text(story.priority_label) || text(story.priority) || "未设置", createdAt: text(story.created), modifiedAt: text(story.modified),
    workspaceId, workspaceName: workspaceId, url: `${webBaseUrl.replace(/\/$/, "")}/${workspaceId}/prong/stories/view/${story.id}`,
  } satisfies TapdRequirement : null;
  const tasks = taskRows.flatMap((row): TapdTask[] => {
    const task = row.Task;
    if (!task || !text(task.id)) return [];
    return [{ id: text(task.id), name: text(task.name), description: stripHtml(task.description), status: text(task.status), owner: text(task.owner), creator: text(task.creator), storyId, workspaceId, modifiedAt: text(task.modified) }];
  });
  const attachments = attachmentRows.flatMap((row): TapdAttachment[] => {
    const file = row.Attachment;
    if (!file || !text(file.id)) return [];
    return [{ id: text(file.id), filename: text(file.filename || file.name || file.title), url: text(file.url || file.download_url), size: Number(file.size) || 0, contentType: text(file.content_type || file.type), owner: text(file.owner || file.creator), createdAt: text(file.created), entryId: text(file.entry_id || storyId) }];
  });
  return { requirement, tasks, attachments, syncedAt: new Date().toISOString() };
}

export async function uploadTapdRequirementAttachment(
  workspaceId: string,
  storyId: string,
  customField: string,
  file: File,
  credential = tapdCredential,
): Promise<Record<string, unknown>> {
  const config = (await loadMcpConfig()).mcpServers.tapd;
  const token = (await credential(workspaceId, 120_000)).accessToken;
  if (!workspaceId.trim() || !storyId.trim() || !customField.trim()) throw new TapdRequirementsError("上传目标不完整", "INVALID_REQUEST");
  if (!(file instanceof File) || file.size <= 0) throw new TapdRequirementsError("未选择有效文件", "INVALID_REQUEST");
  if (file.size >= 150 * 1024 * 1024) throw new TapdRequirementsError("TAPD 单个附件必须小于 150MB", "FILE_TOO_LARGE");
  const apiBaseUrl = text(config?.env?.TAPD_API_BASE_URL) || "https://api.tapd.cn";
  const form = new FormData();
  form.set("workspace_id", workspaceId);
  form.set("entry_id", storyId);
  // custom_field uploads require the work item type, not the attachment response type.
  form.set("type", "story");
  form.set("custom_field", customField.trim());
  form.set("file", file, file.name);
  const response = await tapdMutation(() => fetch(`${apiBaseUrl.replace(/\/$/, "")}/files/upload_attachment`, {
    method: "POST", headers: { Authorization: `Bearer ${token}`, Via: "mcp" }, body: form,
    signal: AbortSignal.timeout(60_000),
  }));
  const payload = await response.json() as TapdEnvelope<Record<string, unknown>>;
  if (!response.ok || payload.status !== 1 || payload.data === undefined) {
    throw new TapdRequirementsError(text(payload.info || payload.message) || `TAPD 上传失败 (${response.status})`, response.status === 401 || response.status === 403 ? "TAPD_UNAUTHORIZED" : "TAPD_UPLOAD_FAILED");
  }
  return payload.data;
}

async function tapdCredential(workspaceId: string, minTtlMs = 60_000) {
  const { acquireTapdCredential } = await import('../../domains/tapd-auth/node/service.ts');
  return acquireTapdCredential(workspaceId, minTtlMs);
}
async function tapdConnection(workspaceId: string) {
  const config = (await loadMcpConfig()).mcpServers.tapd;
  const token = (await tapdCredential(workspaceId)).accessToken;
  return { token, base: text(config?.env?.TAPD_API_BASE_URL) || "https://api.tapd.cn" };
}

// Reuse the connector's OAuth credential; callers never accept credentials or URLs from the renderer.
export async function tapdTestXRequest<T>(method: 'GET' | 'POST', endpoint: string, params: Record<string, unknown> = {}, options: { cacheDirectory?: boolean; fresh?: boolean } = {}): Promise<T> {
  const namespace = endpoint.match(/(?:^|\/)namespaces\/([^/]+)/)?.[1];
  const workspaceId = text(params.workspace_id || (namespace ? decodeURIComponent(namespace) : ''));
  if (!workspaceId) throw new TapdRequirementsError('TestX 请求缺少 TAPD 项目范围', 'TAPD_WORKSPACE_REQUIRED');
  if (namespace && decodeURIComponent(namespace) !== workspaceId) throw new TapdRequirementsError('TestX 项目范围不匹配', 'TAPD_WORKSPACE_REQUIRED');
  const { token, base } = await tapdConnection(workspaceId);
  const url = new URL(`${base.replace(/\/$/, '')}/${endpoint}`);
  url.searchParams.set('s', 'mcp');
  if (method === 'GET') for (const [key, value] of Object.entries(params)) url.searchParams.set(key, String(value));
  const readOnly = method === 'GET' || endpoint.endsWith('/search');
  // Only explicit directory discovery can be cached, never case reconciliation or writes.
  const directory = options.cacheDirectory && (
    (method === 'GET' && /\/repos$/.test(endpoint)) ||
    (method === 'POST' && endpoint.endsWith('/cases/search') && (params.Filter as { ItemType?: string } | undefined)?.ItemType === 'FOLDER')
  );
  const perform = async (): Promise<T> => {
    const response = await fetch(url, {
      method, headers: { Authorization: `Bearer ${token}`, Via: 'mcp', 'Content-Type': 'application/json' },
      body: method === 'POST' ? JSON.stringify(params) : undefined,
      signal: AbortSignal.timeout(30_000),
    });
    if (response.status === 401 || response.status === 403) invalidateTapdReadCache();
    assertTapdRateLimit(response, endpoint);
    if (response.status === 401 || response.status === 403) throw new TapdRequirementsError('TAPD 测试协同未认证或无权访问，请在连接器设置中配置支持 TestX 的用户态授权令牌后重试', 'TAPD_TESTX_UNAUTHORIZED');
    const payload = await response.json() as { Error?: { Message?: string } | null; Data?: T };
    if (response.status >= 500 || response.status === 408) throw new Error('TAPD 测试协同未确认请求结果，请核对后重试');
    if (payload.Error || !response.ok) {
      throw new TapdRequirementsError(text(payload.Error?.Message) || `TAPD 测试协同请求失败 (${response.status})`, 'TAPD_TESTX_REJECTED');
    }
    if (payload.Data === undefined || payload.Error === undefined) throw new Error('TAPD 测试协同返回格式无效，未确认请求结果');
    return payload.Data;
  };
  if (!readOnly) return tapdMutation(perform);
  const scope = readScope(base, token);
  const key = JSON.stringify([base, method, endpoint, params]);
  const generation = cacheGeneration;
  const run = () => tapdReads.run(scope, options.fresh ? `${key}:fresh:${++freshReadId}` : `${generation}:${key}`, perform);
  return directory ? tapdReadCache.read(`${scope}:${key}`, 5 * 60_000, run, options.fresh) : run();
}
export async function getTapdAttachmentDownloadUrl(workspaceId: string, attachmentId: string): Promise<string> {
  const { token, base } = await tapdConnection(workspaceId);
  const data = await tapdGet<{ Attachment?: { download_url?: string }; download_url?: string }>(base, token, "attachments/down", { workspace_id: workspaceId, id: attachmentId });
  const url = data.Attachment?.download_url || data.download_url;
  if (!url) throw new Error("TAPD 未返回附件下载链接");
  return url;
}
export function tapdTransitionTargets(value: unknown, current: string): string[] {
  const targets = new Set<string>();
  function walk(v: unknown) {
    if (!v || typeof v !== "object") return;
    const r = v as Record<string, unknown>;
    if (r.StepPrevious === current && typeof r.StepNext === "string" && r.StepNext !== current) targets.add(r.StepNext);
    for (const child of Object.values(r)) if (typeof child === "object") walk(child);
  }
  walk(value); return [...targets];
}
export async function getTapdStoryWorkflow(workspaceId: string, storyId: string, fresh = false) {
  const { token, base } = await tapdConnection(workspaceId);
  const stories = await tapdGet<Array<{ Story: Record<string, unknown> }>>(base, token, "stories", { workspace_id: workspaceId, id: storyId, limit: 1, fields: STORY_FIELDS }, fresh);
  const story = stories[0]?.Story;
  if (!story) throw new Error("需求不存在或无权访问");
  if (text(story.step)) throw new Error("该需求使用并行工作流，需要通过节点完成接口流转，当前不能直接修改状态");
  const params = { workspace_id: workspaceId, system: "story", ...(text(story.workitem_type_id) ? { workitem_type_id: text(story.workitem_type_id) } : {}) };
  const [transitions, statusMap] = await Promise.all([
    tapdGet<unknown>(base, token, "workflows/all_transitions", params, fresh),
    tapdGet<Record<string, string>>(base, token, "workflows/status_map", params, fresh),
  ]);
  const current = text(story.status);
  return { current, currentLabel: statusMap[current] || current, targets: tapdTransitionTargets(transitions, current).map(value => ({ value, label: statusMap[value] || value })) };
}
export async function transitionTapdStory(workspaceId: string, storyId: string, expected: string, target: string) {
  const workflow = await getTapdStoryWorkflow(workspaceId, storyId, true);
  if (workflow.current === target) return workflow;
  if (workflow.current !== expected) throw new Error("TAPD 状态已变化，请刷新后重新提交，已上传产物会保留");
  if (!workflow.targets.some(t => t.value === target)) throw new Error("目标状态不在当前工作流允许的流转范围内");
  const { token, base } = await tapdConnection(workspaceId);
  const response = await tapdMutation(() => fetch(`${base.replace(/\/$/, "")}/stories`, { method: "POST", headers: { Authorization: `Bearer ${token}` }, body: new URLSearchParams({ workspace_id: workspaceId, id: storyId, status: target }), signal: AbortSignal.timeout(30_000) }));
  const result = await response.json() as TapdEnvelope<unknown>;
  if (!response.ok || result.status !== 1) throw new Error(text(result.info || result.message) || "TAPD 状态流转失败");
  const updated = await getTapdStoryWorkflow(workspaceId, storyId, true);
  if (updated.current !== target) throw new Error("TAPD 尚未确认目标状态，请刷新后重试");
  return updated;
}

async function tapdMutation<T>(action: () => Promise<T>): Promise<T> {
  invalidateTapdReadCache();
  try { return await action(); } finally { invalidateTapdReadCache(); }
}
