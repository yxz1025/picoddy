// API 客户端：IPC 优先，HTTP 降级。统一封装前后端调用。
//
// 路由采用正则模式匹配，支持路径参数提取（如 /api/automations/:id/run）。
// 未匹配的路由自动降级到 HTTP fetch。

import { mapPromptRequestToSessionContinue } from "./promptRequestModel";

const API = "";

// ── IPC 路由表 ──
// pattern: 支持 :param 路径参数，优先级按注册顺序（先注册先匹配）
// mapReq: (path, body, params) => IPC payload
// mapRes: (ipcResult) => apiGet/apiPost 兼容的返回值

interface IPCRouteDef {
  method: string;
  pattern: RegExp;
  paramNames: string[];
  invoke?: string;
  send?: string;
  mapReq?: (path: string, body: any, params: Record<string, string>) => any;
  mapRes?: (data: any) => any;
}

function route(method: string, pattern: string, opts: Omit<IPCRouteDef, "method" | "pattern" | "paramNames">): IPCRouteDef {
  const paramNames: string[] = [];
  const regexStr = "^" + pattern.replace(/:([a-zA-Z_]+)/g, (_, name) => {
    paramNames.push(name);
    return "([^/]+)";
  }) + "$";
  return { method, pattern: new RegExp(regexStr), paramNames, ...opts };
}

const IPC_ROUTES: IPCRouteDef[] = [
  // ── 会话 ──
  route("GET",    "/api/conv",             { invoke: "session.list", mapRes: (d: any[]) => d }),
  route("POST",   "/api/conv",             { invoke: "session.start", mapReq: (_p, b) => ({ title: b?.title, category: b?.category, workspaceId: b?.workspaceId, provider: b?.modelProvider, model: b?.modelId, prompt: b?.prompt, expertOperation: b?.expertOperation }), mapRes: (d: any) => d?.session || d }),
  route("DELETE", "/api/conv/:id",         { invoke: "session.delete", mapReq: (_p, _b, params) => ({ sessionId: params.id }) }),
  route("PUT",    "/api/conversations/:id/expert", { invoke: "expert.assign", mapReq: (_p, b, params) => ({ sessionId: params.id, expertId: b?.expertId }) }),
  route("DELETE", "/api/conversations/:id/expert", { invoke: "expert.clear", mapReq: (_p, _b, params) => ({ sessionId: params.id }) }),
  route("POST",   "/api/conv/:id/fork",    { invoke: "session.fork", mapReq: (_p, b, params) => ({ sessionId: params.id, fromMessageId: b?.fromMessageId }) }),
  route("GET",    "/api/conv/:id/export",  { invoke: "session.export", mapReq: (_p, _b, params) => ({ sessionId: params.id, format: "md" }) }),

  // ── Prompt ──
  route("POST",   "/api/prompt",           { invoke: "client-invoke", mapReq: (_p, b) => ({ type: "session.continue", payload: mapPromptRequestToSessionContinue(b ?? {}) }), mapRes: (d) => ({ ...d, ok: true }) }),
  route("POST",   "/api/abort",            { send: "session.stop", mapReq: (_p, b) => ({ sessionId: b?.sessionId }), mapRes: () => ({ ok: true }) }),

  // ── 消息 ──
  route("GET",    "/api/msgs/:id",         { invoke: "session.getMessages", mapReq: (_p, _b, params) => ({ sessionId: params.id }) }),

  // ── 设置 ──
  route("GET",    "/api/settings",         { invoke: "config.get" }),
  route("POST",   "/api/settings",         { invoke: "config.save", mapReq: (_p, b) => b }),
  route("GET", "/api/settings/openai-subscription", { invoke: "config.openaiSubscriptionStatus" }),
  route("POST", "/api/settings/openai-subscription", { invoke: "config.openaiSubscription", mapReq: (_p, b) => b }),
  route("GET",    "/api/settings/keys",    { invoke: "config.getApiKeys" }),
  route("POST",   "/api/settings/keys",    { invoke: "config.saveApiKey", mapReq: (_p, b) => b }),
  route("DELETE", "/api/settings/keys/:p", { invoke: "config.deleteApiKey", mapReq: (_p, _b, params) => ({ provider: params.p }) }),
  route("POST",   "/api/settings/custom-providers/models", { invoke: "config.customProviderModels", mapReq: (_p, b) => b }),
  route("POST",   "/api/settings/custom-providers",     { invoke: "config.saveCustomProvider", mapReq: (_p, b) => b }),
  route("DELETE", "/api/settings/custom-providers/:id", { invoke: "config.deleteCustomProvider", mapReq: (_p, _b, params) => ({ id: params.id }) }),
  route("POST",   "/api/settings/test-connection",      { invoke: "config.testConnection", mapReq: (_p, b) => b }),

  // ── 记忆 ──
  route("GET",    "/api/memories",         { invoke: "memory.list" }),
  route("POST",   "/api/memories",         { invoke: "memory.create", mapReq: (_p, b) => b }),
  route("DELETE", "/api/memories/:id",     { invoke: "memory.delete", mapReq: (_p, _b, params) => ({ id: params.id }) }),

  // ── 技能 ──
  route("GET", "/api/clawhub/skills", { invoke: "clawhub.list", mapReq: p => Object.fromEntries(new URLSearchParams(p.split("?")[1] || "")) }),
  route("POST", "/api/clawhub/install", { invoke: "clawhub.install", mapReq: (_p, b) => b }),
  route("POST",   "/api/skillhub/auth/ensure", { invoke: "skillhub.ensureAuth" }),
  route("GET",    "/api/skillhub/auth/config", { invoke: "skillhub.authConfig" }),
  route("POST",   "/api/skillhub/auth/config", { invoke: "skillhub.saveAuthConfig", mapReq: (_p, b) => ({ secret: b?.secret }) }),
  route("GET",    "/api/skillhub/namespaces", { invoke: "skillhub.namespaces" }),
  route("GET",    "/api/skillhub/skills",  { invoke: "skillhub.list" }),
  route("GET",    "/api/skillhub/experts", { invoke: "skillhub.experts" }),
  route("GET",    "/api/skillhub/experts/:namespace/:slug", { invoke: "skillhub.expertDetail", mapReq: (_p, _b, params) => params }),
  route("POST",   "/api/skillhub/install", { invoke: "skillhub.install", mapReq: (_p, b) => b }),
  route("POST",   "/api/skillhub/experts/install", { invoke: "skillhub.expertInstall", mapReq: (_p, b) => b }),
  route("GET",    "/api/skills",           { invoke: "skills.list" }),
  route("POST",   "/api/skills/:name/edit-session", { invoke: "skill.createEditSession", mapReq: (_p, b, params) => ({ name: params.name, ...(b || {}) }) }),
  route("POST",   "/api/skills",           { invoke: "skills.create", mapReq: (_p, b) => b }),
  route("PUT",    "/api/skills/:name",     { invoke: "skills.update", mapReq: (_p, b, params) => ({ name: params.name, ...b }) }),
  route("DELETE", "/api/skills/:name",     { invoke: "skills.delete", mapReq: (_p, _b, params) => ({ name: params.name }) }),

  // ── 插件 ──
  route("GET",    "/api/plugins",           { invoke: "plugins.list" }),
  route("GET",    "/api/plugins/catalog",   { invoke: "plugins.catalog" }),
  route("GET",    "/api/plugins/search",    { invoke: "plugins.search", mapReq: (_p) => ({ q: new URLSearchParams(_p.split("?")[1] || "").get("q") || "" }) }),
  route("POST",   "/api/plugins/install",   { invoke: "plugins.install", mapReq: (_p, b) => b }),
  route("POST",   "/api/plugins/uninstall", { invoke: "plugins.uninstall", mapReq: (_p, b) => b }),

  // ── 自动化 ──
  route("GET",    "/api/automations",              { invoke: "automation.list" }),
  route("POST",   "/api/automations",              { invoke: "automation.create", mapReq: (_p, b) => b }),
  route("PUT",    "/api/automations/:id",          { invoke: "automation.update", mapReq: (_p, b, params) => ({ id: params.id, ...b }) }),
  route("DELETE", "/api/automations/:id",          { invoke: "automation.delete", mapReq: (_p, _b, params) => ({ id: params.id }) }),
  route("POST",   "/api/automations/:id/run",      { invoke: "automation.run", mapReq: (_p, _b, params) => ({ id: params.id }) }),
  route("GET",    "/api/automations/:id/runs",     { invoke: "automation.runs", mapReq: (_p, _b, params) => ({ id: params.id }) }),

  // ── 微应用 ──

  // ── 工作空间 ──
  route("GET",    "/api/workspaces",             { invoke: "workspace.list" }),
  route("POST",   "/api/workspaces",             { invoke: "workspace.create", mapReq: (_p, b) => b }),
  route("PUT",    "/api/workspaces/:id",         { invoke: "workspace.update", mapReq: (_p, b, params) => ({ id: params.id, ...b }) }),
  route("DELETE", "/api/workspaces/:id",         { invoke: "workspace.delete", mapReq: (_p, _b, params) => ({ id: params.id }) }),
  route("POST",   "/api/workspaces/:id/assign",  { invoke: "workspace.assign", mapReq: (_p, b, params) => ({ id: params.id, conversationId: b?.conversationId }) }),
  route("POST",   "/api/conversations/:id/workspace", { invoke: "workspace.assignConversation", mapReq: (_p, b, params) => ({ conversationId: params.id, workspaceId: b?.workspaceId ?? null }) }),

  // ── 专家 ──
  route("GET",    "/api/experts",           { invoke: "expert.list" }),
  route("GET",    "/api/experts/installed", { invoke: "expert.listInstalled" }),
  route("POST",   "/api/experts/:id/edit-session", { invoke: "expert.createEditSession", mapReq: (_p, b, params) => ({ id: params.id, ...(b || {}) }) }),
  route("POST",   "/api/experts/:id/open-folder",  { invoke: "expert.openFolder", mapReq: (_p, b, params) => ({ id: params.id, ...(b || {}) }) }),
  route("DELETE", "/api/experts/:id",       { invoke: "expert.uninstall", mapReq: (_p, _b, params) => ({ id: params.id }) }),
  route("GET",    "/api/experts/:id",       { invoke: "expert.get", mapReq: (_p, _b, params) => ({ id: params.id }) }),

  // ── 连接器（受管 CLI 连接器） ──
  route("GET",    "/api/connectors",                     { invoke: "connector.list" }),
  route("POST",   "/api/connectors/:id/activate",        { invoke: "connector.activate", mapReq: (_p, _b, params) => ({ id: params.id }) }),
  route("POST",   "/api/connectors/:id/cancel",          { invoke: "connector.cancel", mapReq: (_p, _b, params) => ({ id: params.id }) }),
  route("POST",   "/api/connectors/:id/reauthorize",     { invoke: "connector.reauthorize", mapReq: (_p, _b, params) => ({ id: params.id }) }),
  route("POST",   "/api/connectors/:id/logout",          { invoke: "connector.logout", mapReq: (_p, _b, params) => ({ id: params.id }) }),
  route("POST",   "/api/connectors/:id/repair",          { invoke: "connector.repair", mapReq: (_p, _b, params) => ({ id: params.id }) }),
  route("POST",   "/api/connectors/:id/update",          { invoke: "connector.update", mapReq: (_p, _b, params) => ({ id: params.id }) }),
  route("DELETE", "/api/connectors/:id",                 { invoke: "connector.uninstall", mapReq: (_p, _b, params) => ({ id: params.id }) }),
  route("GET",    "/api/connectors/:id",                 { invoke: "connector.get", mapReq: (_p, _b, params) => ({ id: params.id }) }),

  // ── MCP ──
  route("POST", "/api/mcp/presets/figma", { invoke: "mcp.addFigma", mapReq: (_p, b) => b }),
  route("GET", "/api/mcp/builtin/npm/:id", { invoke: "mcp.npmStatus", mapReq: (_p, _b, params) => ({ id: params.id }) }),
  route("POST", "/api/mcp/builtin/npm/:id/install", { invoke: "mcp.npmInstall", mapReq: (_p, _b, params) => ({ id: params.id }) }),
  route("POST", "/api/mcp/builtin/npm/:id/configure", { invoke: "mcp.npmConfigure", mapReq: (_p, b, params) => ({ id: params.id, env: b?.env }) }),
  route("GET", "/api/mcp/oauth", { invoke: "mcp.oauthStatus", mapReq: (p) => ({ name: new URL(p, "http://localhost").searchParams.get("name") }) }),
  route("POST", "/api/mcp/oauth", { invoke: "mcp.oauth", mapReq: (_p, b) => b }),
  route("GET",    "/api/mcp",               { invoke: "mcp.list" }),
  route("POST",   "/api/mcp/connect",       { invoke: "mcp.connect", mapReq: (_p, b) => b }),
  route("POST",   "/api/mcp",               { invoke: "mcp.save", mapReq: (_p, b) => b }),

  // ── Ollama / 审计 / 使用统计 ──
  route("GET",    "/api/ollama/models",      { invoke: "ollama.models" }),
  route("POST",   "/api/providers/:provider/models", {
    invoke: "provider.models",
    mapReq: (_p, body, params) => ({ provider: params.provider, apiKey: body?.apiKey }),
  }),
  route("GET",    "/api/settings/audit-logs",{ invoke: "audit.list" }),
  route("GET",    "/api/usage",              { invoke: "usage.get" }),
  route("GET",    "/api/usage/audit",        { invoke: "audit.list" }),

  // ── 产物 / 项目 ──
  route("GET",    "/api/artifacts",          { invoke: "artifacts.list" }),
  route("GET",    "/api/projects",           { invoke: "projects.list" }),
  route("GET",    "/api/tapd/requirements",  { invoke: "tapd.requirements", mapReq: (p) => { const q = new URLSearchParams(p.split("?")[1] || ""); return { refresh: q.get("refresh") === "1", page: Number(q.get("page")) || 1, pageSize: Number(q.get("pageSize")) || 20, query: q.get("query") || "", workspaceId: q.get("workspaceId") || "", status: q.get("status") || "" }; } }),
  route("GET",    "/api/tapd/requirements/:workspaceId/:storyId", { invoke: "tapd.requirementOpen", mapReq: (_p, _b, params) => params }),
  route("GET", "/api/tapd/requirements/:workspaceId/:storyId/preview", { invoke: "tapd.previewGet", mapReq: (_p, _b, params) => params }),
  route("POST", "/api/tapd/requirements/:workspaceId/:storyId/preview", { invoke: "tapd.previewAction", mapReq: (_p, b, params) => ({ ...params, ...b }) }),
  route("GET", "/api/tapd/requirements/:workspaceId/:storyId/testing-execution", { invoke: "tapd.testingExecutionGet", mapReq: (_p, _b, params) => params }),
  route("POST", "/api/tapd/requirements/:workspaceId/:storyId/testing-execution", { invoke: "tapd.testingExecutionSave", mapReq: (_p, b, params) => ({ ...params, ...b }) }),
  route("GET", "/api/tapd/requirements/:workspaceId/:storyId/inputs", { invoke: "tapd.inputsGet", mapReq: (p, _b, params) => ({ ...params, stageKey: new URLSearchParams(p.split("?")[1] || "").get("stageKey") }) }),
  route("POST", "/api/tapd/requirements/:workspaceId/:storyId/inputs", { invoke: "tapd.inputsSave", mapReq: (_p, b, params) => ({ ...params, ...b }) }),
  route("GET", "/api/conversations/:id/requirement-completion", { invoke: "tapd.completionGet", mapReq: (_p, _b, params) => params }),
  route("GET", "/api/conversations/:id/testing-delivery", { invoke: "tapd.testingGet", mapReq: (p, _b, params) => { const q = new URL(p, 'http://localhost').searchParams; return { ...params, assetId: q.get('assetId'), resultsOnly: q.get('resultsOnly') === '1', destinationsOnly: q.get('destinationsOnly') === '1' }; } }),
  route("POST", "/api/conversations/:id/testing-delivery", { invoke: "tapd.testingSubmit", mapReq: (_p, b, params) => ({ ...params, ...b }) }),
  route("POST", "/api/conversations/:id/requirement-completion", { invoke: "tapd.completionSubmit", mapReq: (_p, b, params) => ({ ...params, ...b }) }),
  route("GET", "/api/conversations/:id/requirement-inputs", { invoke: "tapd.inputHistory", mapReq: (_p, _b, params) => params }),
  route("GET", "/api/tapd/requirements/:workspaceId/:storyId/assets", { invoke: "tapd.assetsList", mapReq: (_p, _b, params) => params }),
  route("POST", "/api/tapd/requirements/:workspaceId/:storyId/assets", { invoke: "tapd.assetsSave", mapReq: (_p, b, params) => ({ ...params, ...(b || {}) }) }),
  route("POST",   "/api/tapd/requirements/:workspaceId/:storyId/conversations", { invoke: "tapd.requirementConversation", mapReq: (_p, b, params) => ({ ...params, ...(b || {}) }) }),

  // ── 附件 ──
  route("DELETE", "/api/attachments/:id",    { invoke: "attachments.delete", mapReq: (_p, _b, params) => ({ id: decodeURIComponent(params.id) }) }),

  // ── 权限 / 交互 ──
  route("POST",   "/api/confirm",            { invoke: "permission.respond", mapReq: (_p, b) => ({ requestId: b?.requestId, approved: b?.approved }) }),
  route("POST",   "/api/ask-answer",         { invoke: "ask.respond", mapReq: (_p, b) => ({ requestId: b?.requestId, answers: b?.answers }) }),

  // ── Auth ──
  route("GET",    "/api/auth/session",    { invoke: "auth.session" }),
  route("POST",   "/api/auth/login",      { invoke: "auth.login" }),
  route("POST",   "/api/auth/logout",     { invoke: "auth.logout" }),

  // ── 非 JSON API（文件预览 / 目录选择 / 文件下载） ──
  route("GET",    "/api/preview",            { invoke: "file.preview", mapReq: (p) => ({ path: new URLSearchParams(p.split("?")[1] || "").get("path") || "" }), mapRes: (d: any) => d }),
  route("GET",    "/api/preview/markdown",  { invoke: "file.previewMarkdown", mapReq: (p) => ({ path: new URLSearchParams(p.split("?")[1] || "").get("path") || "" }), mapRes: (d: any) => d }),
  route("GET",    "/api/file",               { invoke: "file.read", mapReq: (_p, _b) => ({ path: new URLSearchParams(_p.split("?")[1] || "").get("path") || "" }), mapRes: (d: any) => d }),
  route("GET",    "/api/pick-dir",           { invoke: "dialog.pickDir", mapRes: (d: any) => d }),
  route("GET",    "/api/open",               { invoke: "file.openExternal", mapReq: (_p, _b) => ({ path: new URLSearchParams(_p.split("?")[1] || "").get("path") || "" }), mapRes: (d: any) => d }),

  // ── 系统 ──
  route("GET", "/api/system/browser-automation", { invoke: "system.browserAutomationGet" }),
  route("POST", "/api/system/browser-automation", { invoke: "system.browserAutomationSet", mapReq: (_p, b) => b }),
  route("GET",    "/api/system/permissions",     { invoke: "system.permissions" }),
  route("POST",   "/api/system/permissions/open",{ invoke: "system.openPermissionSettings" }),
  route("GET",    "/api/system/context",         { invoke: "system.context" }),
  route("GET",    "/api/system/sidecar",         { invoke: "system.sidecar" }),
  route("POST",   "/api/system/exit",            { invoke: "system.exit" }),
  route("POST",   "/api/float/transfer",         { invoke: "float.transfer", mapReq: (_p, b) => b }),
  route("GET",    "/api/float/close",            { invoke: "float.close" }),

  // ── Skill Drafts ──
  route("GET",    "/api/skill-drafts/:id",                   { invoke: "skillDraft.get",    mapReq: (_p, _b, params) => ({ id: params.id }) }),
  route("GET",    "/api/skill-drafts/:id/files",             { invoke: "skillDraft.files",  mapReq: (_p, _b, params) => ({ id: params.id }) }),
  route("GET",    "/api/skill-drafts/:id/file",              { invoke: "skillDraft.readFile", mapReq: (_p, _b, params) => ({ id: params.id, path: new URLSearchParams(_p.split("?")[1] || "").get("path") || "" }) }),
  route("POST",   "/api/skill-drafts/:id/revision",          { invoke: "skillDraft.revision", mapReq: (_p, _b, params) => ({ id: params.id }) }),
  route("GET",    "/api/skill-drafts/:id/installed-files",   { invoke: "skillDraft.installedFiles", mapReq: (_p, _b, params) => ({ id: params.id }) }),
  route("GET",    "/api/skill-drafts/:id/installed-file",    { invoke: "skillDraft.readInstalledFile", mapReq: (_p, _b, params) => ({ id: params.id, path: new URLSearchParams(_p.split("?")[1] || "").get("path") || "" }) }),
  route("POST",   "/api/skill-drafts/:id/validate",          { invoke: "skillDraft.validate", mapReq: (_p, _b, params) => ({ id: params.id }) }),
  route("POST",   "/api/skill-drafts/:id/install",           { invoke: "skillDraft.install", mapReq: (_p, _b, params) => ({ id: params.id }) }),
];

function matchIPCRoute(method: string, path: string): { route: IPCRouteDef; params: Record<string, string> } | null {
  // 去掉 query string
  const cleanPath = path.split("?")[0];
  for (const r of IPC_ROUTES) {
    if (r.method !== method) continue;
    const m = r.pattern.exec(cleanPath);
    if (!m) continue;
    const params: Record<string, string> = {};
    r.paramNames.forEach((name, i) => { params[name] = m[i + 1]; });
    return { route: r, params };
  }
  return null;
}

export function resolveIPCRouteForTest(
  method: string,
  path: string,
  body?: unknown,
): { invoke?: string; payload: unknown } | null {
  const matched = matchIPCRoute(method, path);
  if (!matched) return null;
  const payload = matched.route.mapReq
    ? matched.route.mapReq(path, body, matched.params)
    : (body || {});
  return { invoke: matched.route.invoke, payload };
}

function getIPC() {
  return (window as any).electronAPI;
}

// ── 公共类型 ──
export interface AuthSessionView {
  id: string; userId: string; nick: string; avatar: string;
  profile: Record<string, string>; loggedInAt: number; expiresAt: number;
}
export interface AuthSessionResponse {
  authenticated: boolean; session: AuthSessionView | null;
}

export class ApiError extends Error {
  readonly status: number; readonly code?: string;
  constructor(status: number, message: string, code?: string) {
    super(message); this.name = "ApiError"; this.status = status; this.code = code;
    if (typeof window !== 'undefined' && ['TAPD_AUTH_EXPIRED', 'TAPD_UNAUTHORIZED', 'TAPD_NOT_CONFIGURED'].includes(code || '')) window.dispatchEvent(new Event('project-tapd-auth-error'));
  }
}

interface IpcApiErrorEnvelope {
  name: "ApiError";
  message?: unknown;
  status?: unknown;
  code?: unknown;
}

function isIpcApiErrorEnvelope(value: unknown): value is IpcApiErrorEnvelope {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<IpcApiErrorEnvelope>;
  return candidate.name === "ApiError" && Number.isInteger(candidate.status);
}

/** Convert the serializable main-process error envelope back to ApiError. */
export function normalizeIpcError(error: unknown): unknown {
  if (!isIpcApiErrorEnvelope(error)) {
    if (error instanceof Error) {
      const match = error.message.match(
        /^Error invoking remote method '[^']+':\s*(?:Error:\s*)?([\s\S]+)$/,
      );
      if (match) return new Error(match[1]);
    }
    return error;
  }
  const status = Number(error.status);
  const message = typeof error.message === "string" && error.message.trim()
    ? error.message
    : `请求失败 (${status})`;
  const code = typeof error.code === "string" ? error.code : undefined;
  return new ApiError(status, message, code);
}

/** Invoke a main-process route while preserving the fetch-style error shape. */
export async function callIPC<T = any>(
  ipc: { call: (name: string, ...args: any[]) => Promise<unknown> },
  name: string,
  ...args: any[]
): Promise<T> {
  try {
    const result = await ipc.call(name, ...args);
    const normalized = normalizeIpcError(result);
    if (normalized instanceof Error) throw normalized;
    return result as T;
  } catch (error) {
    throw normalizeIpcError(error);
  }
}

async function throwApiError(response: Response): Promise<never> {
  let message: string | undefined; let code: string | undefined;
  try {
    const data = await response.json();
    if (data && typeof data === "object") {
      const err = data as Record<string, unknown>;
      if (typeof err.error === "string" && err.error.trim()) message = err.error;
      if (typeof err.code === "string") code = err.code;
    }
  } catch { /* ignore */ }
  throw new ApiError(response.status, message ?? `请求失败 (${response.status})`, code);
}

// ── API 函数 ──

export async function apiGet<T = any>(path: string): Promise<T> {
  const ipc = getIPC();
  const matched = matchIPCRoute("GET", path);
  if (ipc && matched) {
    const { route: r, params } = matched;
    const payload = r.mapReq ? r.mapReq(path, undefined, params) : {};
    let raw: any = {};
    if (r.invoke) {
      try {
        raw = await callIPC(ipc, r.invoke, payload);
      } catch (error) {
        // 允许前端热更新先于 Electron 主进程更新；旧主进程没有新通道时走 HTTP。
        if (!String(error instanceof Error ? error.message : error).includes("No handler registered")) throw error;
        const resp = await fetch(API + path);
        if (!resp.ok) return throwApiError(resp);
        raw = await resp.json();
      }
    }
    return r.mapRes ? r.mapRes(raw) : raw;
  }
  const resp = await fetch(API + path);
  if (!resp.ok) return throwApiError(resp);
  return resp.json();
}

export async function apiPost<T = any>(path: string, body?: any): Promise<T> {
  const ipc = getIPC();
  const matched = matchIPCRoute("POST", path);
  if (ipc && matched) {
    const { route: r, params } = matched;
    const payload = r.mapReq ? r.mapReq(path, body, params) : (body || {});
    if (r.send) {
      ipc.send({ type: r.send, payload });
      return (r.mapRes ? r.mapRes(null) : { ok: true }) as T;
    }
    let raw: any;
    try {
      raw = await callIPC(ipc, r.invoke!, payload);
    } catch (error) {
      if (!String(error instanceof Error ? error.message : error).includes("No handler registered")) throw error;
      const resp = await fetch(API + path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body ?? {}) });
      if (!resp.ok) return throwApiError(resp);
      raw = await resp.json();
    }
    return r.mapRes ? r.mapRes(raw) : raw;
  }
  const resp = await fetch(API + path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: body ? JSON.stringify(body) : "{}",
  });
  if (!resp.ok) return throwApiError(resp);
  return resp.json();
}

export async function apiDelete<T = any>(path: string): Promise<T> {
  const ipc = getIPC();
  const matched = matchIPCRoute("DELETE", path);
  if (ipc && matched) {
    const { route: r, params } = matched;
    const payload = r.mapReq ? r.mapReq(path, undefined, params) : {};
    const raw = await callIPC(ipc, r.invoke!, payload);
    return r.mapRes ? r.mapRes(raw) : raw;
  }
  const resp = await fetch(API + path, { method: "DELETE" });
  if (!resp.ok) return throwApiError(resp);
  return resp.json();
}

export async function apiPut<T = any>(path: string, body?: any): Promise<T> {
  const ipc = getIPC();
  const matched = matchIPCRoute("PUT", path);
  if (ipc && matched) {
    const { route: r, params } = matched;
    const payload = r.mapReq ? r.mapReq(path, body, params) : (body || {});
    const raw = await callIPC(ipc, r.invoke!, payload);
    return r.mapRes ? r.mapRes(raw) : raw;
  }
  const resp = await fetch(API + path, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: body ? JSON.stringify(body) : "{}",
  });
  if (!resp.ok) return throwApiError(resp);
  return resp.json();
}

export interface PickDirectoryResult {
  cancelled: boolean;
  path: string | null;
  name?: string;
}

/** Open Electron's native directory picker, with routed IPC/HTTP fallback. */
export async function pickDirectory(): Promise<PickDirectoryResult> {
  const ipc = getIPC();
  if (typeof ipc?.pickDirectory === "function") {
    try {
      return await ipc.pickDirectory();
    } catch (error) {
      throw normalizeIpcError(error);
    }
  }
  return apiGet<PickDirectoryResult>("/api/pick-dir");
}

// ── Auth / SSE ──

export async function authSession(): Promise<AuthSessionResponse> {
  return apiGet<AuthSessionResponse>("/api/auth/session");
}

export async function authLogin(): Promise<{
  ok: boolean; authenticated: boolean; loginUrl?: string; serviceUrl?: string; session?: AuthSessionView | null;
}> {
  return apiPost("/api/auth/login", {});
}

export async function authLogout(): Promise<{ ok: boolean }> {
  return apiPost("/api/auth/logout", {});
}

export function createEventSource(sessionId: string): EventSource | null {
  const ipc = getIPC();
  if (ipc?.on) return null; // IPC 模式下由 useIPC 接管
  return new EventSource(API + "/api/events/" + sessionId + "/stream");
}
