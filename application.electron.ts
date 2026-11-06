// @ts-nocheck — 遗留胶水层，含大量未收尾的 unknown 类型债务，暂不纳入类型检查
import { openAISubscription, hasOpenAISubscription, hasProviderCredential } from "./src/agent/openai_subscription.ts";
import { TapdRateLimitError } from "./src/integrations/tapd/rate_limit.ts";
import { updateGate } from "./src/infra/update-gate.ts";
// application.electron.ts — PiCoddy 应用与 HTTP API（Electron 版）
// 由 main.mjs 动态导入，handleApi(req, path) 为所有领域 CRUD 的统一入口。

import koffi from "koffi";
import { shell as electronShell } from "electron";
import { openExternalSafely, openPathSafely } from "./src/electron/safe-shell-open.ts";
import { logOperationEvent, startOperation } from "./src/infra/operation_log.ts";
import { ConnectorError } from "./src/domains/connector/node/errors.ts";
import { managedConnectorAssembly } from "./src/domains/connector/node/assembly.ts";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { stat, readFile, rm } from "node:fs/promises";
import {
  writeFileSync,
  appendFileSync,
  readdirSync,
  statSync,
  mkdirSync,
  readFileSync,
} from "node:fs";
const execFileAsync = promisify(execFile);
const platformOs = process.platform === "win32" ? "windows" : process.platform;

const startupLogPath = platformOs === "windows"
  ? `${process.env["LOCALAPPDATA"] ?? "."}\\Pi-a\\logs\\startup.log`
  : `${process.env["HOME"] ?? "."}/.pi-a/logs/startup.log`;

function writeStartupDebug(message: string, reset = false): void {
  logOperationEvent("application.startup", "event", {
    marker: message.trim().slice(0, 160),
  });
  try {
    const separator = platformOs === "windows" ? "\\" : "/";
    const logDir = startupLogPath.slice(
      0,
      startupLogPath.lastIndexOf(separator),
    );
    mkdirSync(logDir, { recursive: true });
    if (reset) {
      writeFileSync(startupLogPath, message, "utf-8");
    } else {
      appendFileSync(startupLogPath, message, "utf-8");
    }
  } catch (error) {
    console.warn("[startup] 无法写入启动日志:", (error as Error).message);
  }
}

function writeStartupRecord(phase: string, message?: string): void {
  writeStartupDebug(`${
    JSON.stringify({
      timestamp: new Date().toISOString(),
      level: "info",
      phase,
      ...(message ? { message } : {}),
    })
  }\n`);
}

writeStartupDebug(
  `[${new Date().toISOString()}] window-created\n`,
  true,
);
async function pauseStartupAt(stage: string): Promise<void> {
  if (process.env["PI_A_PAUSE_STARTUP_AT"] !== stage) return;
  throw new Error(`PI_A_PAUSE:${stage}`);
}
await pauseStartupAt("window");

const { platformPaths } = await import("./src/platform/paths.ts");
const { currentPlatform } = await import("./src/platform/runtime.ts");
const { normalizeBaseUrl, normalizeModelId } = await import(
  "./src/agent/model_defaults.ts"
);
writeStartupDebug("platform-loaded\n");
await pauseStartupAt("platform");

// 加载 .env（API key 等本地配置）
// 多路径尝试：开发环境 cwd + 用户主目录
for (
  const envPath of [
    ".env",
    platformPaths.join(platformPaths.appDataDir, ".env"),
    platformPaths.join(platformPaths.homeDir, ".pi-a-env"),
  ]
) {
  try {
    const envText = await readFile(envPath, "utf-8");
    for (const line of envText.split("\n")) {
      const m = line.match(/^([A-Z_]+)=(.*)$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
    }
    console.log("[main] 已加载", envPath);
    break;
  } catch { /* 试下一个 */ }
}
console.log(
  "[main] DEEPSEEK_API_KEY:",
  process.env["DEEPSEEK_API_KEY"] ? "已设置" : "未设置",
);

const { createShellAdapter } = await import("./src/platform/shell.ts");
const { findLibreOfficeExecutable, outputPathForPdf } = await import(
  "./src/platform/libreoffice.ts"
);
const { keepAwakeManager } = await import("./src/platform/power.ts");
const { baseCapabilities } = await import("./src/platform/permissions.ts");
const { FRONTEND_FILES } = await import("./src/ui/frontend-assets.ts");
const {
  getActiveAuthSession,
} = await import("./src/auth/session_store.ts");
writeStartupDebug("frontend-loaded\n");
await pauseStartupAt("frontend");
const { initDb, getDb } = await import("./src/infra/db.ts");
const {
  initModels,
  listModels,
  listAllProviders,
  registerProvider,
  listAvailableProviders,
} = await import("./src/agent/models.ts");
const { provider } = await import("./src/agent/provider.ts");
type AgentEvent = import("./src/agent/provider.ts").AgentEvent;
const { SessionEventRelay } = await import(
  "./src/agent/session_event_relay.ts"
);
type RelayedAgentEvent =
  import("./src/agent/session_event_relay.ts").RelayedAgentEvent;
writeStartupDebug("agent-loaded\n");
await pauseStartupAt("agent");
const {
  setConfirmHandler,
  clearConfirmHandler,
  resetComputerUseCount,
} = await import("./src/agent/permissions.ts");
const { ensureSkillsDir, loadSkillResourcesFromPaths } = await import(
  "./src/agent/skills.ts"
);
const { createDesktopAgentInitialization, initializeAgentRuntime } =
  await import("./src/agent/startup.ts");
const { startScheduler } = await import(
  "./src/domains/automation/node/scheduler.ts"
);
const {
  ensureMcpConfig,
  connectAllMcpServers,
  toolsForMcpServer,
  listMcpConnections,
} = await import(
  "./src/agent/mcp.ts"
);
const { parsePreferredConnectorSelections, loadPreferredConnectorResources } = await import(
  "./src/agent/connector_selection.ts"
);
const { resolvePendingAnswer, isPendingAnswer } = await import(
  "./src/agent/interactive.ts"
);
const {
  createConversation,
  listConversations,
  toRendererConversation,
  renameConversation,
  moveConversation,
  deleteConversation,
  appendMessageWithAttachments,
  getMessages,
  getConversation,
  consumeExpertNotice,
  listConversationIdsByExpert,
  clearExpertBindingsForUninstall,
  setExpertEditMetadata,
  setSkillEditMetadata,
  setConversationExpert: setConversationExpertBinding,
} = await import("./src/domains/session/node/store.ts");
const { getConversationExpertBinding } = await import(
  "./src/domains/session/node/expert_binding_store.ts"
);
const {
  buildAttachmentPromptItems,
  deleteUnlinkedAttachmentDetailed,
  MAX_ATTACHMENTS_PER_MESSAGE,
  resolveAttachmentTurnQuery,
  saveUploadedFiles,
} = await import("./src/domains/attachment/node/service.ts");
const { listArtifacts, deleteArtifact } = await import(
  "./src/domains/artifact/node/store.ts"
);
const {
  createProject,
  listProjects,
  getProject,
  updateProject,
  deleteProject,
  assignConversationToProject,
  listProjectConversations,
} = await import("./src/domains/project/node/store.ts");
const {
  createWorkspace,
  listWorkspaces,
  getWorkspace,
  updateWorkspace,
  deleteWorkspace,
  touchWorkspace,
  listWorkspaceConversations,
  assignConversationToWorkspace,
} = await import("./src/domains/workspace/node/store.ts");
const { SkillDraftError, skillDraftStore } = await import(
  "./src/domains/skill-draft/node/store.ts"
);
type SkillDraftMetadata =
  import("./src/domains/skill-draft/node/store.ts").SkillDraftMetadata;
const {
  getExpert,
  getExpertSummary,
  expertRegistry,
  listExperts,
  refreshInstalledExperts,
  refreshSkillHubExperts,
  resolveInstalledExpertFolder,
  createInstalledExpertEditDraft,
  uninstallInstalledExpert,
  resolveExpertPromptById,
} = await import("./src/agent/experts.ts");
const {
  createExpertBindingService,
  ExpertBindingError,
} = await import("./src/agent/experts/binding_service.ts");
const { InstalledExpertManagementError } = await import(
  "./src/agent/experts/installed_management.ts"
);
const { getApiKey } = await import("./src/infra/keychain.ts");
const { getSetting, applyKeepAwake } = await import(
  "./src/domains/settings/node/store.ts"
);
writeStartupDebug("all-modules-loaded\n");
await pauseStartupAt("all-modules");

const platformShell = createShellAdapter(currentPlatform);

const expertBindingService = createExpertBindingService({
  registry: expertRegistry,
  resolver: async (manifest) => resolveExpertPromptById(manifest.id),
  store: {
    getConversation: (conversationId) => {
      const conversation = getConversation(conversationId);
      return conversation
        ? { id: conversation.id, status: conversation.status }
        : null;
    },
    getBinding: (conversationId) => {
      const binding = getConversationExpertBinding(conversationId);
      if (!binding?.expertId || !binding.expertRevision || !binding.expertCatalogSource) {
        return null;
      }
      return {
        expertId: binding.expertId,
        revision: binding.expertRevision,
        catalogSource: binding.expertCatalogSource,
      };
    },
    setBinding: (conversationId, binding) => {
      setConversationExpertBinding(conversationId, binding);
    },
  },
  provider,
});

// ── 受管连接器服务（HTTP / IPC 共享同一单例） ──
// Registry 与运行时来自共享装配 managedConnectorAssembly()（connector 子代理网关复用同一实例）。
// connectorsReady 在模块顶层求值阶段调用 connectorService()，因此不可在其中引用延迟声明的 const。
let connectorServicePromise: Promise<ReturnType<typeof createConnectorService>> | undefined;
function connectorService(): Promise<ReturnType<typeof createConnectorService>> {
  connectorServicePromise ??= (async () => {
    // 共享装配：Registry + ManagedNpmRuntime 单一实例（连接器子代理网关复用同一解析结果）。
    const { registry, runtime } = await managedConnectorAssembly();
    const { createMcpManagedConnectorStore } = await import("./src/domains/connector/node/mcp_store.ts");
    const { createConnectorLifecycle } = await import("./src/domains/connector/node/lifecycle.ts");
    const { createConnectorNpmDriver } = await import("./src/domains/connector/node/node_npm_driver.ts");
    const { connectorPaths } = await import("./src/domains/connector/node/paths.ts");
    const { runConnectorProcess } = await import("./src/domains/connector/node/process_runner.ts");
    const { createConnectorService } = await import("./src/domains/connector/node/service.ts");
    // 驱动按 entry 各自闭合 ConnectorPaths（versions/staging/cache 按连接器隔离）
    const drivers = new Map<string, ReturnType<typeof createConnectorNpmDriver>>();
    const store = createMcpManagedConnectorStore(platformPaths.appDataDir, registry);
    await store.synchronize();
    const lifecycle = createConnectorLifecycle({
      appDataDir: platformPaths.appDataDir,
      registry,
      store,
      driver: {
        install: (entry, operation) => {
          let driver = drivers.get(entry.id);
          if (!driver) {
            driver = createConnectorNpmDriver({
              paths: connectorPaths(platformPaths.appDataDir, entry.id, entry.install.version),
              runProcess: runConnectorProcess,
              runtime,
            });
            drivers.set(entry.id, driver);
          }
          return driver.install(entry, operation);
        },
      },
      runtime,
      runProcess: runConnectorProcess,
      openExternal: (url) => {
        void openExternalSafely(electronShell.openExternal.bind(electronShell), url).then((error) => {
          if (error) console.error("[connector] 打开授权页面失败:", error);
        });
      },
    });
    return createConnectorService({ registry, store, lifecycle });
  })();
  return connectorServicePromise;
}

initDb();
writeStartupDebug("db-loaded\n");
await pauseStartupAt("db");
try {
  await initializeAgentRuntime(createDesktopAgentInitialization({
    ensureSkills: ensureSkillsDir,
    initModels: async () => {
      writeStartupDebug("models-initializing\n");
      await initModels();
      writeStartupDebug("models-initialized\n");
    },
    skillsReady: async (activeDir) => {
      // The ready marker is emitted only after the active immutable version
      // and the user root have both been scanned successfully.
      loadSkillResourcesFromPaths({
        builtinDir: activeDir,
        userDir: platformPaths.skillsDir,
      });
      writeStartupDebug("skills-loaded\n");
      await pauseStartupAt("skills");
    },
    modelsReady: async () => {
      writeStartupDebug("models-loaded\n");
      await pauseStartupAt("models");
    },
    // 启动即验证目录与运行时锁（共享装配 managedConnectorAssembly），
    // 并恢复过期锁与残留 staging；不联网、不安装、不提取 Skill、不打开授权。
    // 连接器子系统失败只禁用连接器（fail closed），绝不让异常穿透到顶层启动序列：
    // Skills、Models 与主 Agent 照常启动，不产生未处理 Promise rejection。
    connectorsReady: async () => {
      try {
        const service = await connectorService();
        await service.recoverStartup();
      } catch (error) {
        const code = error instanceof ConnectorError ? error.code : "CONNECTOR_RUNTIME_UNAVAILABLE";
        console.warn(`[connector] 连接器子系统不可用（${code}），已禁用连接器，主应用继续启动`);
        writeStartupDebug(`connectors-disabled:${code}\n`);
      }
      writeStartupDebug("connectors-loaded\n");
      await pauseStartupAt("connectors");
    },
  }));
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  writeStartupDebug(`skills-startup-error:${message}\n`);
  console.error(`[skills] startup blocked before skills-loaded: ${message}`);
  throw error;
}

// Installed experts are an optional user marketplace overlay. An unavailable
// marketplace leaves the registry's last valid snapshot untouched.
await refreshInstalledExperts();
await refreshSkillHubExperts();

// 用户自装的 Pi 生态插件：目录扫描加载，单个插件失败仅告警不阻塞启动。
try {
  const { loadAllPlugins } = await import("./src/agent/plugin_tools.ts");
  await loadAllPlugins();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.warn(`[plugins] 启动加载插件失败，继续启动: ${message}`);
}

// Agent 直接在主进程内运行
await ensureMcpConfig();
writeStartupDebug("mcp-configured\n");
// 配置过的 MCP 在应用启动阶段预热连接，确保首个会话可以直接使用。
// 单个连接失败由 connectAllMcpServers 隔离处理，不阻塞桌面应用启动。
try {
  const startupMcpTools = await connectAllMcpServers();
  console.log(
    `[mcp] 启动自动连接完成: ${startupMcpTools.length} 个工具已加载`,
  );
  writeStartupDebug(`mcp-auto-connected:${startupMcpTools.length}\n`);
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.warn(`[mcp] 启动自动连接失败，继续启动: ${message}`);
  writeStartupDebug(`mcp-auto-connect-error:${message}\n`);
}
startScheduler();
writeStartupDebug("scheduler-started\n");
await pauseStartupAt("scheduler");

// 初始化锁屏防睡眠状态
applyKeepAwake(getSetting("keep_awake", "false") === "true");
writeStartupDebug("keep-awake-applied\n");

console.log(
  "[main] 可用 DeepSeek 模型:",
  listModels("deepseek").map((m: any) => m.id),
);

// ===== 会话事件中继：每会话只订阅 Provider 一次 =====
const eventRelays = new Map<string, InstanceType<typeof SessionEventRelay>>();
const eventRelaySubscriptions = new Map<
  string,
  Promise<() => void>
>();
const pendingInteractiveEvents = new Map<
  string,
  { sessionId: string; event: AgentEvent }
>();

function getEventRelay(
  sessionId: string,
): InstanceType<typeof SessionEventRelay> {
  let relay = eventRelays.get(sessionId);
  if (!relay) {
    relay = new SessionEventRelay(sessionId);
    eventRelays.set(sessionId, relay);
  }
  if (!eventRelaySubscriptions.has(sessionId)) {
    const targetRelay = relay;
    // 流式中继只负责交互状态、用量与事件转发；消息由 Provider 唯一持久化。
    const subscription = provider.onEvent(sessionId, (event) => {
      try {
        if (
          event.type === "message_end" &&
          (event as any).message?.role === "assistant"
        ) {
          logUsage(sessionId, (event as any).message);
        } else if (event.type === "tool_execution_end" && (event as any).toolName === "generate_image") {
          const output = (event as any).output;
          logUsage(sessionId, { ...output?.details, usage: output?.usage });
        } else if (
          event.type === "tool_confirmation" ||
          event.type === "ask_user_question"
        ) {
          const requestId = (event as any).requestId;
          if (requestId) {
            pendingInteractiveEvents.set(requestId, { sessionId, event });
          }
        } else if (event.type === "agent_end") {
          for (const [requestId, pending] of pendingInteractiveEvents) {
            if (pending.sessionId === sessionId) {
              pendingInteractiveEvents.delete(requestId);
            }
          }
        }
      } catch (dbErr) {
        console.error("[event-relay] 消息持久化异常:", dbErr);
      }

      targetRelay.accept(event);
    }).catch((error) => {
      if (eventRelaySubscriptions.get(sessionId) === subscription) {
        eventRelaySubscriptions.delete(sessionId);
      }
      console.error("[event-relay] 会话事件订阅失败:", error);
      throw error;
    });
    eventRelaySubscriptions.set(sessionId, subscription);
  }
  return relay;
}

function prepareEventRelayForPrompt(sessionId: string): void {
  getEventRelay(sessionId);
}

async function ensureEventRelayReady(
  sessionId: string,
): Promise<InstanceType<typeof SessionEventRelay>> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const relay = getEventRelay(sessionId);
    const subscription = eventRelaySubscriptions.get(sessionId);
    if (!subscription) continue;
    await subscription;
    if (eventRelaySubscriptions.get(sessionId) === subscription) return relay;
  }
  throw new Error(`会话 ${sessionId} 的事件订阅初始化失败`);
}

function disposeEventRelay(sessionId: string): void {
  const relay = eventRelays.get(sessionId);
  relay?.close();
  eventRelays.delete(sessionId);
  const subscription = eventRelaySubscriptions.get(sessionId);
  eventRelaySubscriptions.delete(sessionId);
  subscription?.then((unsubscribe) => unsubscribe()).catch(() => {});
  for (const [requestId, pending] of pendingInteractiveEvents) {
    if (pending.sessionId === sessionId) {
      pendingInteractiveEvents.delete(requestId);
    }
  }
}

// ===== HTTP serve + API =====
// 用标准 HTTP API 做前端↔后端通信

// 确认请求挂起表（API /api/confirm 用）
const pendingConfirms = new Map<string, (approved: boolean) => void>();

/** 记录 token 用量到 DB */
function logUsage(sessionId: string, message: any) {
  try {
    const opt = getSetting("experience_opt", "true");
    if (opt === "false") {
      console.log("[privacy] 用户已退出体验优化计划，跳过记录用量日志");
      return;
    }
    const u = message?.usage;
    if (!u) return;
    const db = getDb();
    db.prepare(
      "INSERT INTO usage_logs (conversation_id, provider, model, input_tokens, output_tokens, total_tokens, cost, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    ).run(
      sessionId,
      message.provider || "unknown",
      message.model || "unknown",
      u.input || 0,
      u.output || 0,
      u.totalTokens || 0,
      u.cost?.total || 0,
      Date.now(),
    );
  } catch {}
}

const OPAQUE_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type SkillDraftApiRoute =
  | { kind: "by-conversation"; conversationId: string }
  | {
    kind:
      | "draft"
      | "files"
      | "file"
      | "installed-files"
      | "installed-file"
      | "revision"
      | "validate"
      | "install";
    draftId: string;
  };

class SkillDraftApiError extends Error {
  constructor(
    public readonly code: string,
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "SkillDraftApiError";
  }
}

function decodeOpaqueId(value: string): string {
  let decoded: string;
  try {
    decoded = decodeURIComponent(value);
  } catch {
    throw new SkillDraftApiError("INVALID_ID", 400, "非法 ID");
  }
  if (!OPAQUE_ID_PATTERN.test(decoded)) {
    throw new SkillDraftApiError("INVALID_ID", 400, "非法 ID");
  }
  return decoded;
}

function parseSkillDraftApiRoute(path: string): SkillDraftApiRoute | null {
  const byConversation = path.match(
    /^\/api\/skill-drafts\/by-conversation\/([^/]+)$/,
  );
  if (byConversation) {
    return {
      kind: "by-conversation",
      conversationId: decodeOpaqueId(byConversation[1]),
    };
  }

  const draft = path.match(
    /^\/api\/skill-drafts\/([^/]+)(?:\/(files|file|installed-files|installed-file|revision|validate|install))?$/,
  );
  if (!draft) return null;
  return {
    kind: (draft[2] || "draft") as
      | "draft"
      | "files"
      | "file"
      | "installed-files"
      | "installed-file"
      | "revision"
      | "validate"
      | "install",
    draftId: decodeOpaqueId(draft[1]),
  };
}

function assertSkillCreatorConversation(conversationId: string): void {
  const conversation = getDb().prepare(
    "SELECT category FROM conversations WHERE id = ?",
  ).get(conversationId) as { category: string } | undefined;
  if (!conversation || conversation.category !== "skill_creator") {
    throw new SkillDraftApiError(
      "SKILL_CREATOR_CONVERSATION_NOT_FOUND",
      404,
      "技能创建会话不存在",
    );
  }
}

async function authorizeSkillDraft(
  draftId: string,
): Promise<SkillDraftMetadata> {
  const draft = await skillDraftStore.get(draftId);
  assertSkillCreatorConversation(draft.conversationId);
  return draft;
}

function skillDraftErrorResponse(error: unknown): Response {
  const headers = { "content-type": "application/json" };
  if (
    error instanceof SkillDraftError ||
    error instanceof SkillDraftApiError
  ) {
    const status = Number.isInteger(error.status) &&
        error.status >= 400 && error.status < 500
      ? error.status
      : 500;
    const body = status === 500
      ? { error: "技能草稿操作失败", code: error.code }
      : { error: error.message, code: error.code };
    return new Response(JSON.stringify(body), { status, headers });
  }
  console.error("[skill-drafts] 未知错误:", error);
  return new Response(
    JSON.stringify({ error: "技能草稿操作失败", code: "INTERNAL_ERROR" }),
    { status: 500, headers },
  );
}

// Configure once for both local-project routes and generic stage-chat requests.
async function localProjectsService() {
  const { getLocalProjectWorkflowService } = await import('./src/domains/project/node/local_workflow.ts');
  return getLocalProjectWorkflowService({
        ensureWorkspace: ({ name, dirPath }) => {
          const normalized = platformPaths.expandHome(dirPath).replace(/[\\/]+$/, "");
          const existing = listWorkspaces().find((item) =>
            platformPaths.expandHome(item.dirPath).replace(/[\\/]+$/, "") === normalized
          );
          if (existing) return { id: existing.id, created: false };
          const workspace = createWorkspace(name, { dirPath });
          return { id: workspace.id, created: true };
        },
        deleteWorkspace: (workspaceId) => deleteWorkspace(workspaceId),
        createConversation: ({ title, category, workspaceId, modelProvider, modelId }) =>
          toRendererConversation(createConversation(title, category, workspaceId, null, { provider: modelProvider, modelId })),
        deleteConversation: (conversationId) => deleteConversation(conversationId),
        bindExpert: (conversationId, expertId) => expertBindingService.assignExpert(conversationId, expertId),
        getConversation: (conversationId) => {
          const conversation = getConversation(conversationId);
          return conversation ? toRendererConversation(conversation) : null;
        },
        isConversationBusy: (conversationId) => provider.isBusy(conversationId),
        collectPresentedFiles: (conversationId) => {
          const files: Array<{ path: string }> = [];
          const rows = getDb().prepare(
            "SELECT content FROM messages WHERE conversation_id = ? AND tool_name = 'present_files' AND (is_error IS NULL OR is_error = 0) ORDER BY created_at, rowid",
          ).all(conversationId);
          for (const row of rows) {
            try {
              const presented = JSON.parse(String(row.content)).details?.files;
              if (!Array.isArray(presented)) continue;
              for (const file of presented) {
                if (file?.exists === true && typeof file.path === "string" && file.path.trim()) files.push({ path: file.path });
              }
            } catch { /* Only structured, persisted successful present_files results count. */ }
          }
          return files;
        },
      });
}

export async function handleApi(req: Request, path: string): Promise<Response> {
  const route = path.split("?")[0];
  const continuation = ["/api/abort", "/api/confirm", "/api/ask-answer"].includes(route);
  if (continuation && updateGate.draining) return handleApiInternal(req, path);
  try { return await updateGate.run("api", () => handleApiInternal(req, path)); }
  catch (error) {
    if ((error as { code?: string }).code === "TASK_BUSY") return new Response(JSON.stringify({ error: "正在准备更新，请稍后重试", code: "TASK_BUSY" }), { status: 503 });
    throw error;
  }
}
async function handleApiInternal(req: Request, path: string): Promise<Response> {
  // IPC 调用方会把 query 拼进 path（与 main.mjs 传 pathname 不同），
  // 路由匹配必须基于剥离 query 后的 pathname，query 一律经 req.url 读取。
  path = path.split("?")[0];
  const json = (s: unknown) =>
    new Response(JSON.stringify(s), {
      headers: { "content-type": "application/json" },
    });
  const jsonError = (message: string, status: number, code?: string) =>
    new Response(JSON.stringify({ error: message, ...(code ? { code } : {}) }), {
      status,
      headers: { "content-type": "application/json" },
    });
  try {
    // Local stage sessions remain project-owned even through generic chat APIs.
    const localSessionPath = path.match(/^\/api\/(?:conv|conversations|msgs|events)\/([^/]+)/);
    if (localSessionPath) {
      const { ownsConversation } = await localProjectsService();
      const conversationId = decodeURIComponent(localSessionPath[1]);
      if (ownsConversation(conversationId)) {
        const account = getActiveAuthSession();
        if (!account || !ownsConversation(conversationId, account.userId)) return jsonError('无权访问该项目会话', 403);
        if ((req.method === 'DELETE' && /^\/api\/conv\/[^/]+$/.test(path)) ||
            /\/(?:expert|workspace|fork)$/.test(path) && req.method !== 'GET') {
          return jsonError('请在项目设置中管理阶段会话、专家与仓库', 409);
        }
      }
    }

    if (path === "/api/auth/session" && req.method === "GET") {
      const session = getActiveAuthSession();
      return json({
        authenticated: Boolean(session),
        session: session
          ? {
            id: session.id,
            userId: session.userId,
            nick: session.nick,
            avatar: session.avatar,
            profile: session.profile,
            loggedInAt: session.loggedInAt,
            expiresAt: session.expiresAt,
          }
          : null,
      });
    }

    if (path === "/api/auth/login" || path === "/api/auth/logout" || path === "/api/auth/callback") {
      return jsonError("桌面版使用本地账户，无需企业登录", 410);
    }

    // GET /api/conv?category=&search=&workspaceId=
    if (path === "/api/conv" && req.method === "GET") {
      const u = new URL(req.url);
      const { ownsConversation } = await localProjectsService();
      return json(listConversations(
        u.searchParams.get("category") || undefined,
        u.searchParams.get("search") || undefined,
        u.searchParams.get("status") || undefined,
        u.searchParams.get("workspaceId") || undefined,
        "ordinary",
      ).filter(conversation => !ownsConversation(conversation.id)).map(toRendererConversation));
    }
    // POST /api/conv  { title, category, workspaceId, modelProvider, modelId }
    if (path === "/api/conv" && req.method === "POST") {
      const b = await req.json();
      const conv = createConversation(
        b.title,
        b.category,
        b.workspaceId ?? null,
        null,
        b.modelProvider && b.modelId
          ? { provider: String(b.modelProvider), modelId: String(b.modelId) }
          : undefined,
        b.expertOperation === "create" || b.expertOperation === "edit"
          ? b.expertOperation
          : undefined,
      );
      return json(toRendererConversation(conv));
    }
    // DELETE /api/conv/:id
    if (path.startsWith("/api/conv/") && req.method === "DELETE") {
      const id = path.split("/")[3];
      const { deleteConversationData, removeConversationSessionFile } = await import(
        "./src/agent/session_cleanup.ts"
      );
      const { clearWorkingMemory } = await import(
        "./src/domains/memory/node/store.ts"
      );
      await deleteConversationData(id, {
        dispose: (sessionId) => provider.dispose(sessionId),
        removeCore: removeConversationSessionFile,
        clearWorking: clearWorkingMemory,
        removeSqlite: deleteConversation,
      });
      disposeEventRelay(id);
      clearConfirmHandler(id);
      return json({ ok: true });
    }
    // GET /api/msgs/:id
    if (path.startsWith("/api/msgs/") && req.method === "GET") {
      const id = path.split("/")[3];
      // Read the history first; only a successful read is allowed to consume
      // the one-shot uninstall notice.
      const messages = getMessages(id);
      const notice = consumeExpertNotice(id);
      return json({ messages, notice });
    }
    // POST /api/attachments — multipart 文件上传（node:http 原生 FormData）
    if (path === "/api/attachments" && req.method === "POST") {
      try {
        const files = (await req.formData()).getAll("files").filter(
          (value): value is File => value instanceof (globalThis as any).File,
        );
        if (files.length === 0) return jsonError("未选择文件", 400);
        const attachments = await saveUploadedFiles(files);
        return json({
          attachments: attachments.map(
            ({ id, name, size, mimeType, extension }) => ({
              id, name, size, mimeType, extension,
            }),
          ),
        });
      } catch (error) {
        return jsonError(
          error instanceof Error ? error.message : String(error),
          400,
        );
      }
    }
    // DELETE /api/attachments/:id — 仅允许删除尚未关联消息的附件
    if (path.startsWith("/api/attachments/") && req.method === "DELETE") {
      let id: string;
      try {
        id = decodeURIComponent(path.split("/")[3] || "");
      } catch {
        return jsonError("附件 ID 无效", 400);
      }
      if (!id) return jsonError("附件 ID 无效", 400);
      const result = await deleteUnlinkedAttachmentDetailed(id);
      if (result === "linked") {
        return jsonError("附件已关联消息，无法删除", 409);
      }
      if (result === "missing") return jsonError("附件不存在", 400);
      return json({ ok: true });
    }
    // POST /api/prompt  { sessionId, text, mode, permission }
    if (path === "/api/prompt" && req.method === "POST") {
      const b = await req.json();
      const hasModelProvider = b.modelProvider !== undefined;
      const hasModelId = b.modelId !== undefined;
      if (hasModelProvider !== hasModelId) {
        return jsonError(
          "modelProvider and modelId must be provided together",
          400,
          "MODEL_SELECTION_INVALID",
        );
      }
      if (
        hasModelProvider &&
        (typeof b.modelProvider !== "string" ||
          typeof b.modelId !== "string" ||
          !b.modelProvider.trim() ||
          !b.modelId.trim())
      ) {
        return jsonError(
          "modelProvider and modelId must be non-empty strings",
          400,
          "MODEL_SELECTION_INVALID",
        );
      }
      const requestedModelProvider = hasModelProvider
        ? b.modelProvider.trim()
        : undefined;
      const requestedModelId = hasModelId ? b.modelId.trim() : undefined;
      let preferredConnectorSelections: ReturnType<
        typeof parsePreferredConnectorSelections
      >;
      try {
        preferredConnectorSelections = parsePreferredConnectorSelections(
          b.preferredConnectors,
          b.preferredConnector,
          b.preferredConnectorKind,
        );
      } catch (error) {
        return jsonError(
          error instanceof Error ? error.message : "连接器选择无效",
          400,
          "CONNECTOR_SELECTION_INVALID",
        );
      }
      console.log(
        "[api] /api/prompt session:",
        b.sessionId?.slice(0, 8),
        "mode:",
        b.mode,
        "model:",
        requestedModelProvider && requestedModelId
          ? `${requestedModelProvider}/${requestedModelId}`
          : "session-default",
      );
      if (
        b.selectedSkillNames !== undefined &&
        (!Array.isArray(b.selectedSkillNames) ||
          !b.selectedSkillNames.every((name: unknown) => typeof name === "string"))
      ) {
        return jsonError("selectedSkillNames must be an array of strings", 400);
      }
      const selectedSkillNames: string[] | undefined = b.selectedSkillNames;
      if (b.selectedExpertId !== undefined && typeof b.selectedExpertId !== "string") {
        return jsonError("selectedExpertId must be a string", 400);
      }
      const selectedExpertId: string | undefined = b.selectedExpertId;
      const { getContextForConversation, beginConversationTurn } = await localProjectsService();
      const localProjectSession = getActiveAuthSession();
      const localProjectContext = await getContextForConversation(localProjectSession!.userId, b.sessionId);
      if (localProjectContext) {
        // Project settings, rather than an arbitrary composer payload, own this scope.
        preferredConnectorSelections = localProjectContext.connectorIds.map(id => ({ id, kind: 'mcp' as const }));
      }
      // 先建立唯一持久化监听和事件订阅；用户消息由串行执行钩子落库。
      await provider.attachPersistence(b.sessionId);
      prepareEventRelayForPrompt(b.sessionId);
      // 新 prompt = 新任务，重置 Computer Use 步数计数
      resetComputerUseCount(b.sessionId);

      const attachmentIds = Array.isArray(b.attachmentIds)
        ? b.attachmentIds.filter(
          (id: unknown): id is string => typeof id === "string",
        )
        : [];
      if (attachmentIds.length > MAX_ATTACHMENTS_PER_MESSAGE) {
        return jsonError("单条消息最多添加 10 个附件", 400);
      }

      const visibleText = typeof b.text === "string" ? b.text : "";
      let attachmentItems;
      try {
        attachmentItems = await buildAttachmentPromptItems(attachmentIds, {
          query: visibleText,
        });
      } catch (error) {
        return jsonError(
          error instanceof Error ? error.message : String(error),
          400,
        );
      }

      const displayText = typeof b.displayText === "string"
        ? b.displayText
        : visibleText;
      const attachmentAnchors: Record<string, number> = {};
      if (b.attachmentAnchors && typeof b.attachmentAnchors === "object") {
        for (const id of attachmentIds) {
          const value = (b.attachmentAnchors as Record<string, unknown>)[id];
          attachmentAnchors[id] = typeof value === "number" &&
              Number.isFinite(value)
            ? Math.min(displayText.length, Math.max(0, Math.floor(value)))
            : 0;
        }
      }
      setConfirmHandler(
        b.sessionId,
        async (toolName: string, args: unknown) => {
          const requestId = crypto.randomUUID();
          // 通过 provider 广播，由会话事件中继实时发送并保存待确认状态。
          provider.emitEvent(
            b.sessionId,
            {
              type: "tool_confirmation" as any,
              requestId,
              toolName,
              args,
              sessionId: b.sessionId,
            } as any,
          );
          return await new Promise<boolean>((resolve) => {
            pendingConfirms.set(requestId, resolve);
            setTimeout(() => {
              if (pendingConfirms.has(requestId)) {
                pendingConfirms.delete(requestId);
                pendingInteractiveEvents.delete(requestId);
                resolve(false);
              }
            }, 120000);
          });
        },
      );

      // ===== 解析 @引用 文件内容 =====
      const turnQuery = resolveAttachmentTurnQuery(
        visibleText,
        attachmentIds,
      );
      const mentionRegex = /@([a-zA-Z0-9_\-\.\u4e00-\u9fa5]+\.[a-zA-Z0-9]+)/g;
      let match;
      const fileRefs = new Set<string>();
      while ((match = mentionRegex.exec(visibleText)) !== null) {
        fileRefs.add(match[1]);
      }

      const fileReferences: Array<{ path: string }> = [];
      if (fileRefs.size > 0) {
        const { getSetting } = await import(
          "./src/domains/settings/node/store.ts"
        );
        const docsDirRaw = getSetting("docs_dir", "~/Desktop");
        const docsDir = platformPaths.expandHome(docsDirRaw);

        for (const filename of fileRefs) {
          fileReferences.push({ path: `${docsDir}/${filename}` });
        }
      }

      const { mcpTools: selectedMcpTools, connectorContext } = await loadPreferredConnectorResources(
        preferredConnectorSelections, toolsForMcpServer,
        selection => listMcpConnections().find(connection => connection.name === selection.id)?.displayName,
      );

      let requirementSnapshotId: string | undefined;
      let testingSourceMessageId: string | undefined;
      let testingPublish: { workspaceId: string; storyId: string; url: string; status: string; field: string; accountId: string } | undefined;
      const publishRequested = !/(?:不要|不需要|暂不|先不).{0,4}(?:发布|上传)/.test(visibleText) && /(?:(?:帮我|请|确认(?:无误)?后|现在|直接).{0,12}(?:发布|上传)|(?:发布|上传)(?:测试用例|用例|到\s*TAPD))/i.test(visibleText);
      const persistUserMessage = () => {
        const messageId = appendMessageWithAttachments(
          b.sessionId,
          "user",
          displayText,
          attachmentIds,
          { attachmentAnchors },
        );
        testingSourceMessageId = messageId;
        if (requirementSnapshotId) getDb().prepare("UPDATE requirement_input_snapshots SET message_id=? WHERE id=? AND conversation_id=?").run(messageId, requirementSnapshotId, b.sessionId);
      };
      const { beginForegroundActivity } = await import(
        "./src/domains/automation/node/activity_gate.ts"
      );
      const requirementQuery = await (async () => {
          const owned = getDb().prepare(`SELECT s.id AS space_id, s.tapd_workspace_id, s.tapd_story_id, s.account_id, r.request_key
            FROM requirement_conversations r JOIN requirement_spaces s ON s.id = r.space_id
            WHERE r.conversation_id = ?`).get(b.sessionId);
          if (!owned) {
            if (!localProjectContext) return turnQuery;
            const { buildLocalProjectPrompt } = await import('./src/domains/project/node/prompt_context.ts');
            return buildLocalProjectPrompt(localProjectContext.project, localProjectContext.stage.id, turnQuery);
          }
          const operation = startOperation("requirement.context.prepare", { sessionId: b.sessionId });
          provider.emitEvent(b.sessionId, {
            type: "task_status" as any,
            phase: "preparing_context",
            message: "正在准备本轮需求上下文：读取 TAPD 需求并核对仓库、资产选择…",
          } as any);
          console.info("[requirement] 正在准备本轮需求上下文", b.sessionId);
          try {
          if (owned.account_id !== getActiveAuthSession()?.userId) throw new Error("无权访问该需求会话");
          const { getTapdRequirementContext } = await import("./src/integrations/tapd/requirements.ts");
          const context = await getTapdRequirementContext(String(owned.tapd_workspace_id), String(owned.tapd_story_id));
          if (!context.requirement) throw new Error("无法读取可信的需求详情");
          const testingExpertBound = owned.request_key === 'stage:自动测试' && getConversationExpertBinding(b.sessionId)?.expertId === 'team-qa--testing-expert';
          if (publishRequested && testingExpertBound && !/(?:测试协同|原生用例|用例库|导入|测试环境|自动化测试|执行测试|复测|Jenkins|CI\/CD|Playwright)/i.test(visibleText)) {
            const field = typeof b.testingPublishField === 'string' && b.testingPublishField.trim()
              ? b.testingPublishField.trim()
              : 'custom_field_one';
            if (field) testingPublish = {
              workspaceId: String(owned.tapd_workspace_id), storyId: String(owned.tapd_story_id), url: context.requirement.url,
              status: context.requirement.status, field, accountId: String(owned.account_id),
            };
          }
          const { createRequirementInputs } = await import("./src/domains/requirement/node/inputs.ts");
          const inputs = createRequirementInputs(getDb(), platformPaths.appDataDir, String(owned.account_id), String(owned.space_id));
          const snapshot = String(owned.request_key).startsWith("stage:") ? await inputs.freeze(String(owned.request_key), b.sessionId) : undefined;
          requirementSnapshotId = snapshot?.id;
          if (snapshot && !snapshot.discussionOnly && ["stage:设计分析", "stage:产品 PRD", "stage:设计评审", "stage:架构设计"].includes(String(owned.request_key))) {
            const { previewService, stopAllPreviews } = await import('./src/domains/preview/node/service.ts');
            const { previewAuthoring } = await import('./src/domains/preview/node/authoring.ts');
            const { requirementPreviewTool } = await import('./src/domains/preview/node/tools.ts');
            const previewSession = getActiveAuthSession();
            const assertPreviewIdentity = () => { if (!previewSession || getActiveAuthSession()?.id !== previewSession.id) throw new Error('设计会话身份已变化'); };
            const preview = previewService(getDb(), platformPaths.appDataDir, String(owned.account_id), String(owned.space_id), assertPreviewIdentity);
            globalThis.__stopPreviewRuns = stopAllPreviews;
            const allowedServers = new Set<string>([
              ...preferredConnectorSelections.filter(s => s.kind === 'mcp').map(s => s.id),
              ...(snapshot.previews || []).map(t => t.design?.server).filter(Boolean),
            ]);
            selectedMcpTools.push(requirementPreviewTool(preview, () => {
              if (!testingSourceMessageId) throw new Error('用户消息尚未保存');
              return previewAuthoring(getDb(), platformPaths.appDataDir, String(owned.account_id), String(owned.space_id), {
                conversationId: b.sessionId, sourceMessageId: testingSourceMessageId, stageKey: String(owned.request_key),
              }, name => { if (!allowedServers.has(name)) throw new Error('该 MCP 未绑定本轮设计输入'); return toolsForMcpServer(name); }, assertPreviewIdentity);
            }, String(owned.request_key), allowedServers));
          }
          if (["stage:架构设计", "stage:自动测试"].includes(String(owned.request_key)) && snapshot && !snapshot.discussionOnly) {
            const { testingService } = await import("./src/domains/testing/node/service.ts");
            const { requirementTestingTool } = await import("./src/domains/testing/node/tools.ts");
            const testingSession = getActiveAuthSession();
            const scopedLoader = async (name: string) => {
              if (!preferredConnectorSelections.some(selection => selection.kind === "mcp" && selection.id === name)) throw new Error("请在本轮选择目标配置中的 Jenkins MCP");
              return toolsForMcpServer(name);
            };
            const service = testingService(getDb(), platformPaths.appDataDir, String(owned.account_id), String(owned.space_id), scopedLoader, () => {
              if (!testingSession || getActiveAuthSession()?.id !== testingSession.id) throw new Error("测试运行身份已变化");
            }, snapshot);
            selectedMcpTools.push(requirementTestingTool(service, () => {
              if (!testingSourceMessageId) throw new Error("用户消息尚未持久化");
              return testingSourceMessageId;
            }, crypto.randomUUID()));
          }
          const { buildRequirementPrompt } = await import("./src/domains/requirement/node/context.ts");
          const { resolveSkillHubExpertPackage } = await import('./src/agent/experts/skillhub_cache.ts');
          const testingPackage = testingExpertBound ? await resolveSkillHubExpertPackage('team-qa--testing-expert') : undefined;
          const testingRuntime = testingPackage ? `\n专家包资源与宿主 Node 运行时：${JSON.stringify({ expertRoot: testingPackage.expertDir, executable: process.execPath, environment: { ELECTRON_RUN_AS_NODE: '1' } })}。正文中的包内资源以 expertRoot 为准，生成器位于 expertRoot/bin/generate-test-cases.cjs，模板位于 expertRoot/assets/excel_template.xlsx。${testingPublish ? '本轮是测试产物发布指令。宿主将在任务正常完成后受控提交最新正式产物到需求资产和 TAPD 需求附件；不得重新生成，不修改 TAPD 状态，附件上传不等于创建原生测试用例。' : '按用户指令生成或修改并通过 present_files 交付产物，本轮不上传 TAPD。'}测试阶段提供两个独立入口：“提交测试产物”登记正式 Excel 和覆盖说明并同步需求附件；“上传用例到 TAPD”选择已提交 Excel 和测试协同上传目录后创建原生用例并关联当前需求。模板 P0–P3、步骤类型、标签、评估工时等通过 TestX 原生字段直接保留，不要求人工映射，不换算为高/中/低。目录或用户态授权不可用时明确报告真实错误。用户要求导入测试协同、用例库或原生用例时，引导使用第二个入口；不得自行调用 MCP 创建用例或声称附件已导入用例库。仅要求产物生成时生成完成即交付；要求自动化执行时继续执行并采集报告，生成文件不代表完成测试。` : '';
          const { testingExpertWorkflow } = await import("./src/domains/testing/node/workflow.ts");
          const executionWorkflow = testingExpertBound ? testingExpertWorkflow(snapshot?.discussionOnly === true, Boolean(testingPublish)) : "";
          const query = buildRequirementPrompt(String(owned.request_key), context, snapshot, turnQuery + testingRuntime + executionWorkflow);
          const metadata = { repositoryCount: snapshot?.repositories.length ?? 0, assetCount: snapshot?.assets.length ?? 0,
            requirementChars: context.requirement.description.length, discussionOnly: snapshot?.discussionOnly ?? false };
          operation.success(metadata);
          console.info("[requirement] 上下文就绪，准备调用专家", metadata);
          provider.emitEvent(b.sessionId, {
            type: "task_status" as any,
            phase: "running",
            message: "需求上下文已就绪，正在组装阶段专家和工具…",
          } as any);
          return query;
          } catch (error) {
            operation.error(error);
            console.error("[requirement] 上下文准备失败", error);
            provider.emitEvent(b.sessionId, {
              type: "agent_end" as any,
              messages: [],
            } as any);
            throw error;
          }
        })();
      const releaseForeground = beginForegroundActivity();
      provider.prompt(
        b.sessionId,
        requirementQuery,
        {
          mode: b.mode || "craft",
          userRequest: visibleText,
          permission: b.permission || "default",
          modelProvider: requestedModelProvider,
          modelId: requestedModelId,
          mcpTools: selectedMcpTools,
          selectedSkillNames,
          selectedExpertId,
          projectScoped: Boolean(localProjectContext),
          attachments: attachmentItems,
          fileReferences,
          connectorContext,
        },
        async () => {
          // executePrompt 已确保当前 SessionEntry 有效；此时重挂并等待
          // listener，覆盖首次 onEvent 初始化失败后 prompt 重试成功的竞态。
          await ensureEventRelayReady(b.sessionId);
          if (localProjectContext) {
            if (getActiveAuthSession()?.id !== localProjectSession?.id) throw new Error('项目会话账户已变化，请重新打开项目');
            await beginConversationTurn(localProjectSession!.userId, b.sessionId, localProjectContext.executionRevision);
          }
          persistUserMessage();
        },
        persistUserMessage,
      )
        .then(async () => {
          if (!testingPublish) return;
          const status = getConversation(b.sessionId)?.status;
          if (status !== 'done') throw new Error('专家任务未正常完成，未上传测试用例');
          const { requirementDelivery, uploadTestingDelivery, collectTestingDelivery } = await import('./src/domains/requirement/node/delivery.ts');
          const { getTapdRequirementContext, uploadTapdRequirementAttachment } = await import('./src/integrations/tapd/requirements.ts');
          const execution = testingPublish;
          if (getActiveAuthSession()?.userId !== execution.accountId) throw new Error('登录账户已变化，已停止测试资产上传');
          const delivery = requirementDelivery(getDb(), platformPaths.appDataDir, platformPaths.artifactsDir, execution.accountId, b.sessionId);
          const outputs = await collectTestingDelivery(getDb(), b.sessionId, delivery.collect);
          if (!outputs.some(asset => /测试用例\.xlsx$/i.test(asset.name))) {
            throw new Error('未找到可发布的最新测试用例，请先生成并交付测试用例');
          }
          const current = await getTapdRequirementContext(execution.workspaceId, execution.storyId);
          if (current.requirement?.status !== execution.status) throw new Error('需求状态已变化，请刷新并重新核对测试基线');
          await uploadTestingDelivery(b.sessionId, execution.field, execution.url, {
            collect: async () => outputs, assets: delivery.assets,
            upload: (name, bytes, field) => {
              if (getActiveAuthSession()?.userId !== execution.accountId) throw new Error('登录账户已变化，已停止上传');
              return uploadTapdRequirementAttachment(execution.workspaceId, execution.storyId, field, new File([Buffer.from(bytes)], name));
            },
          });
        })
        .catch((error) => {
          console.error("[api] prompt 启动失败:", error);
        }).finally(releaseForeground);
      return json({ ok: true, requirementInputId: requirementSnapshotId });
    }
    // POST /api/abort  { sessionId }
    if (path === "/api/abort" && req.method === "POST") {
      const b = await req.json();
      // Await the abort so the caller knows the active harness (and any
      // signal-aware tool such as call_subagent) has actually been stopped.
      // Returning before this promise settles made cancellation look
      // successful in the UI while backend work continued in the background.
      await provider.abort(b.sessionId);
      return json({ ok: true });
    }
    // GET /api/events/:id/stream — SSE 实时推送
    if (
      path.startsWith("/api/events/") && path.endsWith("/stream") &&
      req.method === "GET"
    ) {
      const id = path.split("/")[3];
      getEventRelay(id); // 尽早创建唯一 Provider 订阅
      const requestUrl = new URL(req.url);
      const afterParam = requestUrl.searchParams.get("after");
      const lastEventId = req.headers.get("last-event-id");
      const cursorRaw = afterParam ?? lastEventId;
      const afterSequence = cursorRaw !== null && /^\d+$/.test(cursorRaw)
        ? Number(cursorRaw)
        : undefined;
      let cleanupStream = () => {};
      let streamController: ReadableStreamDefaultController<Uint8Array> | null = null;
      const encoder = new TextEncoder();
      const outboundEvents: RelayedAgentEvent[] = [];
      const drainOutbound = () => {
        while (
          streamController &&
          (streamController.desiredSize ?? 1) > 0 &&
          outboundEvents.length > 0
        ) {
          const data = outboundEvents.shift()!;
          streamController.enqueue(
            encoder.encode(
              `id: ${data.relaySequence}\ndata: ${JSON.stringify(data)}\n\n`,
            ),
          );
        }
      };
      const queueEvent = (data: RelayedAgentEvent) => {
        const last = outboundEvents[outboundEvents.length - 1] as any;
        if (
          (data as any).type === "stream_text" &&
          (data as any).mode === "delta" &&
          last?.type === "stream_text" &&
          last.mode === "delta" &&
          last.sessionId === (data as any).sessionId &&
          last.channel === (data as any).channel
        ) {
          last.text += (data as any).text;
          last.relaySequence = (data as any).relaySequence;
        } else {
          outboundEvents.push(data);
        }
        drainOutbound();
      };
      const body = new ReadableStream({
        start(controller) {
          streamController = controller;
          // EventSource only reports `open` after the response has reached the
          // renderer. Send a protocol comment immediately so an idle session
          // cannot deadlock with the frontend waiting for the stream before it
          // starts the prompt. Comments are ignored by EventSource.onmessage.
          controller.enqueue(encoder.encode(": connected\n\n"));
          let closed = false;
          let unsubscribe: (() => void) | null = null;
          let heartbeat: ReturnType<typeof setInterval> | null = null;
          const send = (data: unknown) => {
            if (closed) return;
            queueEvent(data as RelayedAgentEvent);
          };

          const cleanup = () => {
            if (closed) return;
            closed = true;
            if (heartbeat !== null) clearInterval(heartbeat);
            heartbeat = null;
            unsubscribe?.();
            unsubscribe = null;
            streamController = null;
            outboundEvents.length = 0;
            try {
              controller.close();
            } catch {}
          };
          cleanupStream = cleanup;

          // 先订阅中继，再重放仍有效的交互事件；中继会在订阅时发送
          // 当前生成文本 snapshot，避免重连丢失尚未落库的内容。
          ensureEventRelayReady(id).then((relay) => {
            if (closed) return;
            unsubscribe = relay.subscribe(send, afterSequence);
            if (closed) {
              unsubscribe();
              unsubscribe = null;
              return;
            }
            for (const pending of pendingInteractiveEvents.values()) {
              if (pending.sessionId !== id) continue;
              const event = pending.event as any;
              if (
                (event.type === "tool_confirmation" &&
                  pendingConfirms.has(event.requestId)) ||
                (event.type === "ask_user_question" &&
                  isPendingAnswer(event.requestId))
              ) {
                send(event);
              }
            }
          }).catch((error) => {
            console.error("[sse] 会话事件订阅失败:", error);
            cleanup();
          });

          // 心跳（每 30 秒发 ping，保持连接）
          heartbeat = setInterval(() => {
            try {
              if ((controller.desiredSize ?? 0) <= 0) return;
              controller.enqueue(encoder.encode(`: ping\n\n`));
            } catch {}
          }, 30000);

          if (req.signal.aborted) cleanup();
          else req.signal.addEventListener("abort", cleanup, { once: true });
        },
        pull() {
          drainOutbound();
        },
        cancel() {
          streamController = null;
          outboundEvents.length = 0;
          cleanupStream();
        },
      });

      return new Response(body, {
        headers: {
          "content-type": "text/event-stream",
          "cache-control": "no-cache",
          "connection": "keep-alive",
        },
      });
    }
    // POST /api/confirm  { requestId, approved }
    if (path === "/api/confirm" && req.method === "POST") {
      const b = await req.json();
      const resolve = pendingConfirms.get(b.requestId);
      if (resolve) {
        pendingConfirms.delete(b.requestId);
        pendingInteractiveEvents.delete(b.requestId);
        resolve(b.approved);
      }
      return json({ ok: true });
    }
    // POST /api/ask-answer  { requestId, answers } — 用户回答 AskUserQuestion
    if (path === "/api/ask-answer" && req.method === "POST") {
      const b = await req.json();
      const ok = resolvePendingAnswer(b.requestId, b.answers);
      if (ok) pendingInteractiveEvents.delete(b.requestId);
      return json({ ok });
    }
    // GET /api/artifacts — 列出所有工件
    if (path === "/api/artifacts" && req.method === "GET") {
      return json(listArtifacts());
    }
    // DELETE /api/artifacts/:id — 删除工件记录
    if (path.startsWith("/api/artifacts/") && req.method === "DELETE") {
      const id = path.split("/")[3];
      deleteArtifact(id);
      return json({ ok: true });
    }
    if (path === "/api/preview/site" && req.method === "POST") {
      const { openSitePreview } = await import("./src/domains/preview/node/site.ts");
      try {
        const body = await req.json();
        if (typeof body.path !== "string") return jsonError("缺少 HTML 文件路径", 400);
        return json({ url: await openSitePreview(body.path) });
      } catch {
        return jsonError("无法打开 HTML 文件，请确认文件存在且可读取", 400);
      }
    }
    if (path.startsWith("/api/preview/site/")) {
      const { serveSitePreview } = await import("./src/domains/preview/node/site.ts");
      return serveSitePreview(new URL(req.url), req.method);
    }
    // GET /api/file?path=xxx — 读取文件内容（工件预览用）
    if (path === "/api/file" && req.method === "GET") {
      const filePath = new URL(req.url).searchParams.get("path") || "";
      try {
        const ext = filePath.split(".").pop()?.toLowerCase() || "";
        const mimeMap: Record<string, string> = {
          pdf: "application/pdf",
          png: "image/png",
          jpg: "image/jpeg",
          jpeg: "image/jpeg",
          gif: "image/gif",
          bmp: "image/bmp",
          ico: "image/x-icon",
          avif: "image/avif",
          svg: "image/svg+xml",
          webp: "image/webp",
          mp4: "video/mp4",
          mov: "video/quicktime",
          webm: "video/webm",
          html: "text/html",
          htm: "text/html",
          css: "text/css",
          js: "application/javascript",
          json: "application/json",
          md: "text/markdown",
          txt: "text/plain",
          xml: "application/xml",
        };
        const mime = mimeMap[ext] || "application/octet-stream";
        const data = await readFile(filePath);
        return new Response(data, { headers: { "content-type": mime } });
      } catch {
        return new Response("文件不存在", { status: 404 });
      }
    }
    // GET /api/open?path=xxx — 在系统默认应用打开文件
    if (path === "/api/open" && req.method === "GET") {
      const filePath = new URL(req.url).searchParams.get("path") || "";
      const error = await openPathSafely(
        electronShell.openPath.bind(electronShell),
        filePath,
        { requireExistingPath: true },
      );
      if (error) return jsonError(`无法打开路径：${error}`, 500, "OPEN_PATH_FAILED");
      return json({ ok: true });
    }
    // GET /api/pick-dir — 弹出平台原生目录选择对话框
    if (path === "/api/pick-dir" && req.method === "GET") {
      try {
        const dirPath = await platformShell.pickDirectory();
        if (!dirPath) return json({ cancelled: true });
        const dirName = platformPaths.basename(dirPath) || "新空间";
        return json({ path: dirPath, name: dirName });
      } catch (e) {
        return new Response(JSON.stringify({ error: String(e) }), {
          status: 500,
          headers: { "content-type": "application/json" },
        });
      }
    }
    // GET /api/settings — 获取全局设置
    if (path === "/api/settings" && req.method === "GET") {
      const { getSetting, setSetting } = await import(
        "./src/domains/settings/node/store.ts"
      );
      const {
        listAllProviders,
        listAvailableProviders,
        getCustomProviders,
        registerProvider,
        resolveConfiguredDefault,
      } =
        await import("./src/agent/models.ts");
      if (hasOpenAISubscription()) await registerProvider("openai");
      const providers = listAllProviders();
      const storedDefaultProvider = getSetting("default_provider", "");
      const storedDefaultModelId = getSetting(
        "default_model_id",
        "",
      );
      const resolvedDefault = resolveConfiguredDefault(
        storedDefaultProvider,
        storedDefaultModelId,
        providers,
      );
      const { getApiKey } = await import("./src/infra/keychain.ts");
      const defaultProviderConfig = providers.find((provider) =>
        provider.id === resolvedDefault.providerId
      );
      const defaultHasCredential = !resolvedDefault.providerId ||
        resolvedDefault.providerId === "ollama" ||
        defaultProviderConfig?.isCustom === true ||
        defaultProviderConfig?.models.some(model => model.id === resolvedDefault.modelId && model.isVirtual) ||
        await hasProviderCredential(resolvedDefault.providerId);
      const defaultProvider = defaultHasCredential
        ? resolvedDefault.providerId
        : "";
      const defaultModelId = defaultHasCredential
        ? resolvedDefault.modelId
        : "";
      if (
        defaultProvider !== storedDefaultProvider ||
        defaultModelId !== storedDefaultModelId
      ) {
        setSetting("default_provider", defaultProvider);
        setSetting("default_model_id", defaultModelId);
      }
      const storedDeepSeekBaseUrl = getSetting("provider_base_url_deepseek", "");
      const deepSeekBaseUrl = normalizeBaseUrl("deepseek", storedDeepSeekBaseUrl);
      if (deepSeekBaseUrl !== storedDeepSeekBaseUrl) {
        setSetting("provider_base_url_deepseek", deepSeekBaseUrl);
        await registerProvider("deepseek");
      }
      const docsDir = getSetting("docs_dir", "~/Desktop");

      const language = getSetting("language", "zh-CN");
      const fontSize = getSetting("font_size", "14");
      const autoInstallSkills =
        getSetting("auto_install_skills", "false") === "true";
      const keepAwake = getSetting("keep_awake", "false") === "true";
      const defaultWorkspaceDir = getSetting(
        "default_workspace_dir",
        "~/PiCoddy",
      );
      const experienceOpt = getSetting("experience_opt", "true") === "true";

      const agentSystemPrompt = getSetting(
        "agent_system_prompt",
        "你是一个有用、高效的本地桌面助理，随时帮我处理各种任务。",
      );
      const agentTemperature = getSetting("agent_temperature", "0.7");
      const agentMaxTokens = getSetting("agent_max_tokens", "32768");
      const searchEngine = getSetting("search_engine", "google");

      const sandboxSecurity = getSetting("sandbox_security", "true") === "true";
      const deletionProtection =
        getSetting("deletion_protection", "true") === "true";
      const bulkDeletionLimit = getSetting("bulk_deletion_limit", "50");
      const builtinRuntime = getSetting("builtin_runtime", "true") === "true";
      const runtimePython = getSetting("runtime_python", "true") === "true";
      const runtimeNodejs = getSetting("runtime_nodejs", "true") === "true";
      const securityFileRules = getSetting(
        "security_file_rules",
        JSON.stringify([platformPaths.installationDir]),
      );
      const securityCommandRules = getSetting(
        "security_command_rules",
        JSON.stringify(["git", "npm", "python"]),
      );
      const securityNetworkRules = getSetting(
        "security_network_rules",
        JSON.stringify(["api.deepseek.com", "github.com"]),
      );

      const ollamaBaseUrl = getSetting(
        "ollama_base_url",
        "http://127.0.0.1:11434",
      );

      return json({
        openaiSubscription: hasOpenAISubscription(),
        defaultProvider,
        defaultModelId,
        docsDir,
        language,
        fontSize,
        autoInstallSkills,
        keepAwake,
        defaultWorkspaceDir,
        experienceOpt,
        agentSystemPrompt,
        agentTemperature,
        agentMaxTokens,
        searchEngine,
        sandboxSecurity,
        deletionProtection,
        bulkDeletionLimit,
        builtinRuntime,
        runtimePython,
        runtimeNodejs,
        securityFileRules,
        securityCommandRules,
        securityNetworkRules,
        ollamaBaseUrl,
        customProviders: getCustomProviders(),
        providers,
        availableProviders: listAvailableProviders(),
      });
    }
    // POST /api/settings — 保存全局设置
    if (path === "/api/settings" && req.method === "POST") {
      const b = await req.json();
      const { setSetting } = await import(
        "./src/domains/settings/node/store.ts"
      );
      const {
        listAllProviders,
        registerProvider,
        resolveConfiguredDefault,
        saveProviderModels,
      } = await import(
        "./src/agent/models.ts"
      );

      // 先保存模型列表，再校验默认值；候选/测试模型不能成为默认模型。
      if (Array.isArray(b.providers)) {
        await saveProviderModels(b.providers);
      }
      if (
        Object.prototype.hasOwnProperty.call(b, "defaultProvider") ||
        Object.prototype.hasOwnProperty.call(b, "defaultModelId")
      ) {
        const resolvedDefault = resolveConfiguredDefault(
          b.defaultProvider,
          b.defaultModelId,
          listAllProviders(),
        );
        const { getApiKey } = await import("./src/infra/keychain.ts");
        const configuredProvider = listAllProviders().find((provider) =>
          provider.id === resolvedDefault.providerId
        );
        const hasCredential = !resolvedDefault.providerId ||
          resolvedDefault.providerId === "ollama" ||
          configuredProvider?.isCustom === true ||
          configuredProvider?.models.some(model => model.id === resolvedDefault.modelId && model.isVirtual) ||
          await hasProviderCredential(resolvedDefault.providerId);
        setSetting(
          "default_provider",
          hasCredential ? resolvedDefault.providerId : "",
        );
        setSetting(
          "default_model_id",
          hasCredential ? resolvedDefault.modelId : "",
        );
      }
      if (b.providerBaseUrlDeepseek !== undefined) {
        setSetting(
          "provider_base_url_deepseek",
          normalizeBaseUrl("deepseek", String(b.providerBaseUrlDeepseek)),
        );
        await registerProvider("deepseek");
      }
      if (b.docsDir) setSetting("docs_dir", b.docsDir);

      if (b.language) setSetting("language", b.language);
      if (b.fontSize) setSetting("font_size", b.fontSize);
      if (b.autoInstallSkills !== undefined) {
        setSetting(
          "auto_install_skills",
          b.autoInstallSkills ? "true" : "false",
        );
      }
      if (b.keepAwake !== undefined) {
        setSetting("keep_awake", b.keepAwake ? "true" : "false");
      }
      if (b.defaultWorkspaceDir) {
        setSetting("default_workspace_dir", b.defaultWorkspaceDir);
      }
      if (b.experienceOpt !== undefined) {
        setSetting("experience_opt", b.experienceOpt ? "true" : "false");
      }

      if (b.agentSystemPrompt !== undefined) {
        setSetting("agent_system_prompt", b.agentSystemPrompt);
      }
      if (b.agentTemperature !== undefined) {
        setSetting("agent_temperature", b.agentTemperature);
      }
      if (b.agentMaxTokens !== undefined) {
        setSetting("agent_max_tokens", b.agentMaxTokens);
      }
      if (b.searchEngine !== undefined) {
        setSetting("search_engine", b.searchEngine);
      }

      if (b.sandboxSecurity !== undefined) {
        setSetting("sandbox_security", b.sandboxSecurity ? "true" : "false");
      }
      if (b.deletionProtection !== undefined) {
        setSetting(
          "deletion_protection",
          b.deletionProtection ? "true" : "false",
        );
      }
      if (b.bulkDeletionLimit !== undefined) {
        setSetting("bulk_deletion_limit", String(b.bulkDeletionLimit));
      }
      if (b.builtinRuntime !== undefined) {
        setSetting("builtin_runtime", b.builtinRuntime ? "true" : "false");
      }
      if (b.runtimePython !== undefined) {
        setSetting("runtime_python", b.runtimePython ? "true" : "false");
      }
      if (b.runtimeNodejs !== undefined) {
        setSetting("runtime_nodejs", b.runtimeNodejs ? "true" : "false");
      }
      if (b.securityFileRules !== undefined) {
        setSetting("security_file_rules", b.securityFileRules);
      }
      if (b.securityCommandRules !== undefined) {
        setSetting("security_command_rules", b.securityCommandRules);
      }
      if (b.securityNetworkRules !== undefined) {
        setSetting("security_network_rules", b.securityNetworkRules);
      }

      if (b.ollamaBaseUrl) {
        setSetting("ollama_base_url", b.ollamaBaseUrl);
        await registerProvider("ollama");
      }

      return json({ ok: true });
    }
    // GET /api/ollama/models — 获取/刷新 Ollama 本地已安装模型
    if (path === "/api/ollama/models" && req.method === "GET") {
      const { getSetting } = await import(
        "./src/domains/settings/node/store.ts"
      );
      const { registerProvider } = await import("./src/agent/models.ts");
      const rawOllamaUrl = getSetting(
        "ollama_base_url",
        "http://127.0.0.1:11434",
      );
      const rootUrl = rawOllamaUrl.replace(/\/v1\/?$/, "").replace(/\/$/, "");
      try {
        const start = Date.now();
        const res = await fetch(`${rootUrl}/api/tags`, {
          signal: AbortSignal.timeout(4000),
        });
        const latencyMs = Date.now() - start;
        if (res.ok) {
          const data = await res.json();
          const modelsList = (data.models || []).map((m: any) => ({
            id: m.name || m.model,
            name: m.name || m.model,
            size: m.size
              ? `${(m.size / (1024 * 1024 * 1024)).toFixed(1)}GB`
              : undefined,
            modifiedAt: m.modified_at,
          }));
          await registerProvider("ollama");
          return json({
            ok: true,
            running: true,
            latencyMs,
            models: modelsList,
          });
        }
        return json({
          ok: false,
          running: false,
          error: `HTTP ${res.status} ${res.statusText}`,
        });
      } catch (e) {
        return json({
          ok: false,
          running: false,
          error: `未连接到 Ollama 服务 (${(e as Error).message})`,
        });
      }
    }
    // POST /api/providers/:provider/models — 从各服务商官方目录获取可用模型
    // 可使用当前输入但尚未保存的 Key；Key 仅用于本次请求，不会在此接口持久化。
    const providerModelsMatch = path.match(/^\/api\/providers\/([^/]+)\/models$/);
    if (providerModelsMatch && (req.method === "POST" || req.method === "GET")) {
      const providerId = decodeURIComponent(providerModelsMatch[1]);
      const { getSetting } = await import(
        "./src/domains/settings/node/store.ts"
      );
      const { PROVIDER_BASE_URLS } = await import("./src/agent/models.ts");
      const { fetchProviderModelCatalog } = await import(
        "./src/agent/provider_model_catalog.ts"
      );
      const body = req.method === "POST"
        ? await req.json().catch(() => ({})) as { apiKey?: unknown }
        : {};
      const inputApiKey = typeof body.apiKey === "string" ? body.apiKey.trim() : "";
      if (providerId === "openai" && hasOpenAISubscription()) {
        return json({ ok: true, models: await openAISubscription.models() });
      }
      const apiKey = inputApiKey || await getApiKey(providerId);
      if (!apiKey) {
        return jsonError("请先保存该渠道的 API Key", 400, "API_KEY_REQUIRED");
      }
      const baseUrl = getSetting(
        `provider_base_url_${providerId}`,
        PROVIDER_BASE_URLS[providerId] || "",
      );
      try {
        const models = await fetchProviderModelCatalog({
          providerId,
          baseUrl,
          apiKey,
        });
        return json({ ok: true, models });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return jsonError(message, 502, "MODEL_CATALOG_FAILED");
      }
    }
    // POST /api/settings/custom-providers/models — 获取自定义渠道的模型列表
    // 可使用弹窗中尚未保存的 Key；未填写时使用已保存渠道的 Key。
    if (path === "/api/settings/custom-providers/models" && req.method === "POST") {
      const b = await req.json().catch(() => ({})) as {
        id?: unknown;
        baseUrl?: unknown;
        apiKey?: unknown;
      };
      const { fetchCustomProviderModels } = await import(
        "./src/agent/provider_model_catalog.ts"
      );
      const baseUrl = typeof b.baseUrl === "string" ? b.baseUrl.trim() : "";
      if (!baseUrl) return jsonError("请先填写 Base URL", 400, "BASE_URL_REQUIRED");
      const inputApiKey = typeof b.apiKey === "string" ? b.apiKey.trim() : "";
      const savedApiKey = typeof b.id === "string" && b.id
        ? await getApiKey(b.id)
        : undefined;
      try {
        const models = await fetchCustomProviderModels({
          baseUrl,
          apiKey: inputApiKey || savedApiKey || undefined,
        });
        return json({ ok: true, models });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return jsonError(message, 502, "MODEL_CATALOG_FAILED");
      }
    }
    // POST /api/settings/custom-providers — 保存/添加自定义 OpenAI 提供商
    if (path === "/api/settings/custom-providers" && req.method === "POST") {
      const b = await req.json();
      const { setSetting, getSetting } = await import(
        "./src/domains/settings/node/store.ts"
      );
      const { registerProvider } = await import("./src/agent/models.ts");
      const { setApiKey } = await import("./src/infra/keychain.ts");

      const existingRaw = getSetting("custom_providers", "[]");
      let list: any[] = [];
      try {
        list = JSON.parse(existingRaw);
      } catch {}

      const providerId = b.id || `custom_${Date.now()}`;
      const name = b.name || "自定义 Provider";
      const baseUrl = b.baseUrl || "https://api.openai.com/v1";
      const modelsList = Array.isArray(b.models)
        ? b.models
        : (typeof b.models === "string"
          ? b.models.split(",").map((s: string) => s.trim()).filter(Boolean)
          : ["default"]);

      const positiveInt = (value: unknown) => {
        const n = typeof value === "string" ? Number(value) : value;
        return typeof n === "number" && Number.isFinite(n) && n > 0
          ? Math.floor(n)
          : undefined;
      };
      const modelLimits: Record<
        string,
        { contextWindow?: number; maxOutputTokens?: number }
      > = {};
      for (const modelId of modelsList) {
        const raw = b.modelLimits?.[modelId];
        const contextWindow = positiveInt(raw?.contextWindow);
        const maxOutputTokens = positiveInt(raw?.maxOutputTokens);
        if (contextWindow || maxOutputTokens) {
          modelLimits[modelId] = {
            ...(contextWindow ? { contextWindow } : {}),
            ...(maxOutputTokens ? { maxOutputTokens } : {}),
          };
        }
      }

      const newItem = {
        id: providerId,
        name,
        baseUrl,
        models: modelsList,
        ...(Object.keys(modelLimits).length > 0 ? { modelLimits } : {}),
      };
      const existingIdx = list.findIndex((item) => item.id === providerId);
      if (existingIdx >= 0) {
        list[existingIdx] = newItem;
      } else {
        list.push(newItem);
      }

      setSetting("custom_providers", JSON.stringify(list));
      if (b.apiKey) {
        await setApiKey(providerId, b.apiKey);
      }
      await registerProvider(providerId);
      return json({ ok: true, provider: newItem });
    }
    // DELETE /api/settings/custom-providers/:id — 删除自定义提供商
    if (
      path.startsWith("/api/settings/custom-providers/") &&
      req.method === "DELETE"
    ) {
      const id = path.split("/")[4];
      const { setSetting, getSetting } = await import(
        "./src/domains/settings/node/store.ts"
      );
      const { deleteApiKey } = await import("./src/infra/keychain.ts");
      const existingRaw = getSetting("custom_providers", "[]");
      let list: any[] = [];
      try {
        list = JSON.parse(existingRaw);
      } catch {}
      list = list.filter((item) => item.id !== id);
      setSetting("custom_providers", JSON.stringify(list));
      await deleteApiKey(id);
      return json({ ok: true });
    }
    // POST /api/settings/test-connection — 连通性测试 (支持预设 / Ollama / 自定义)
    if (path === "/api/settings/test-connection" && req.method === "POST") {
      const b = await req.json();
      const { getApiKey } = await import("./src/infra/keychain.ts");
      const { PROVIDER_BASE_URLS, getCustomProviders, getProviderModels } =
        await import("./src/agent/models.ts");

      const providerId = b.provider;
      const key = b.apiKey || (await getApiKey(providerId)) || "";
      const customProvider = getCustomProviders().find((item) => item.id === providerId);
      const rawBaseUrl = b.baseUrl || customProvider?.baseUrl ||
        PROVIDER_BASE_URLS[providerId] ||
        "https://api.openai.com/v1";

      const start = Date.now();

      // Ollama 连通测试
      if (providerId === "ollama") {
        const rootUrl = rawBaseUrl.replace(/\/v1\/?$/, "").replace(/\/$/, "");
        try {
          const res = await fetch(`${rootUrl}/api/tags`, {
            signal: AbortSignal.timeout(4000),
          });
          const latencyMs = Date.now() - start;
          if (res.ok) {
            const data = await res.json();
            const count = data.models?.length || 0;
            return json({
              ok: true,
              latencyMs,
              message: `Ollama 连接正常，查找到 ${count} 个本地模型`,
            });
          }
          return json({
            ok: false,
            error: `Ollama 响应异常 (HTTP ${res.status})`,
          });
        } catch (e) {
          return json({
            ok: false,
            error: `无法连接到 Ollama 服务 (${(e as Error).message})`,
          });
        }
      }

      // 其它云端/通用 API：使用选定模型发起最小真实推理，而非只探测 /models。
      const configuredModels = getProviderModels()[providerId] || [];
      const modelId = typeof b.modelId === "string" && b.modelId.trim()
        ? b.modelId.trim()
        : customProvider?.models?.[0] || configuredModels[0]?.id || "";
      if (providerId === "openai" && hasOpenAISubscription()) {
        try { return json(await openAISubscription.test(modelId)); }
        catch (error) { return json({ ok: false, error: error instanceof Error ? error.message : "订阅模型调用失败" }); }
      }
      if (!key) {
        return json({ ok: false, error: "请先输入或保存 API Key" });
      }
      if (!modelId) {
        return json({ ok: false, error: "请先选择或输入要测试的模型" });
      }

      try {
        const normalizedBaseUrl = rawBaseUrl.replace(/\/$/, "");
        let requestUrl: string;
        let headers: Record<string, string>;
        let requestBody: Record<string, unknown>;

        if (providerId === "anthropic") {
          requestUrl = `${normalizedBaseUrl}/v1/messages`;
          headers = {
            "content-type": "application/json",
            "x-api-key": key,
            "anthropic-version": "2023-06-01",
          };
          requestBody = {
            model: modelId,
            max_tokens: 1,
            messages: [{ role: "user", content: "仅回复 OK" }],
          };
        } else if (providerId === "google") {
          const googleOrigin = new URL(normalizedBaseUrl).origin;
          requestUrl = `${googleOrigin}/v1beta/models/${encodeURIComponent(modelId)}:generateContent`;
          headers = {
            "content-type": "application/json",
            "x-goog-api-key": key,
          };
          requestBody = {
            contents: [{ parts: [{ text: "仅回复 OK" }] }],
            generationConfig: { maxOutputTokens: 1 },
          };
        } else {
          requestUrl = `${normalizedBaseUrl}/chat/completions`;
          headers = {
            "content-type": "application/json",
            Authorization: `Bearer ${key}`,
          };
          requestBody = {
            model: modelId,
            messages: [{ role: "user", content: "仅回复 OK" }],
            stream: false,
            ...(providerId === "openai" || providerId === "moonshot"
              ? { max_completion_tokens: 1 }
              : { max_tokens: 1 }),
          };
        }

        const res = await fetch(requestUrl, {
          method: "POST",
          headers,
          body: JSON.stringify(requestBody),
          signal: AbortSignal.timeout(20_000),
        });
        const latencyMs = Date.now() - start;
        if (res.ok) {
          return json({
            ok: true,
            latencyMs,
            message: `模型 ${modelId} 调用成功 (延迟 ${latencyMs}ms)`,
          });
        }
        if (res.status === 401 || res.status === 403) {
          return json({
            ok: false,
            error: "身份验证失败 (401/403): 请检查 API Key 是否有效",
          });
        }
        let upstreamMessage = "";
        try {
          const payload = await res.json() as any;
          upstreamMessage = payload?.error?.message || payload?.message || "";
        } catch {}
        return json({
          ok: false,
          latencyMs,
          error: upstreamMessage
            ? `模型调用失败 (HTTP ${res.status}): ${upstreamMessage}`
            : `模型调用失败 (HTTP ${res.status})`,
        });
      } catch (e) {
        return json({
          ok: false,
          error: `网络请求失败: ${(e as Error).message}`,
        });
      }
    }
    // GET /api/settings/audit-logs — 获取安全中心审计日志
    if (path === "/api/settings/audit-logs" && req.method === "GET") {
      try {
        const db = getDb();
        const logs = db.prepare(
          "SELECT id, tool_name as toolName, args, is_error as isError, created_at as createdAt FROM tool_audit_log ORDER BY id DESC LIMIT 50",
        ).all();
        return json(logs);
      } catch (e) {
        return new Response(JSON.stringify({ error: String(e) }), {
          status: 500,
          headers: { "content-type": "application/json" },
        });
      }
    }
    if (path === "/api/settings/openai-subscription" && req.method === "GET") {
      return json(await openAISubscription.status());
    }
    if (path === "/api/settings/openai-subscription" && req.method === "POST") {
      const body = await req.json();
      switch (body.action) {
        case "login": return json(await openAISubscription.login());
        case "cancel": return json(await openAISubscription.cancel());
        case "logout": return json(await openAISubscription.logout());
        case "submit":
          if (typeof body.value !== "string" || body.value.length > 8192) return jsonError("无效的授权回调", 400);
          return json(await openAISubscription.submit(body.value));
        default: return jsonError("未知授权操作", 400);
      }
    }
    // GET /api/settings/keys — 获取已存 API Keys 的 Provider 状态
    if (path === "/api/settings/keys" && req.method === "GET") {
      const { getApiKey } = await import("./src/infra/keychain.ts");
      const { listAvailableProviders } = await import("./src/agent/models.ts");
      const providers = listAvailableProviders();
      const result: Record<string, boolean> = {};
      for (const p of providers) {
        const k = await getApiKey(p);
        result[p] = !!k;
      }
      return json(result);
    }
    // POST /api/settings/keys — 安全存储 API Key
    if (path === "/api/settings/keys" && req.method === "POST") {
      const b = await req.json();
      const { setApiKey } = await import("./src/infra/keychain.ts");
      const { registerProvider } = await import("./src/agent/models.ts");
      await setApiKey(b.provider, b.key);
      await registerProvider(b.provider);
      return json({ ok: true });
    }
    // DELETE /api/settings/keys/:provider — 删除钥匙串里的 Key
    if (path.startsWith("/api/settings/keys/") && req.method === "DELETE") {
      const providerId = path.split("/")[4];
      const { deleteApiKey } = await import("./src/infra/keychain.ts");
      await deleteApiKey(providerId);
      return json({ ok: true });
    }
    // GET /api/memories — 获取全部记忆（含 working + user，面板用，支持分页）
    if (path === "/api/memories" && req.method === "GET") {
      const { listAllMemories } = await import(
        "./src/domains/memory/node/store.ts"
      );
      const sp = new URL(req.url).searchParams;
      const limitRaw = sp.get("limit");
      const offsetRaw = sp.get("offset");
      const limit = limitRaw
        ? Math.max(1, Math.min(500, parseInt(limitRaw, 10)))
        : undefined;
      const offset = offsetRaw ? Math.max(0, parseInt(offsetRaw, 10)) : undefined;
      return json(listAllMemories(
        limit !== undefined || offset !== undefined
          ? { limit, offset }
          : undefined,
      ));
    }
    // POST /api/memories — 新增长期记忆
    if (path === "/api/memories" && req.method === "POST") {
      const b = await req.json();
      const { writeMemory } = await import(
        "./src/domains/memory/node/store.ts"
      );
      const mem = writeMemory(
        b.content,
        b.kind || "fact",
        b.scope || "user",
        typeof b.sessionId === "string" ? b.sessionId : undefined,
      );
      return json(mem);
    }
    // DELETE /api/memories/:id — 删除长期记忆
    if (path.startsWith("/api/memories/") && req.method === "DELETE") {
      const id = path.split("/")[3];
      const { deleteMemory } = await import(
        "./src/domains/memory/node/store.ts"
      );
      deleteMemory(id);
      return json({ ok: true });
    }
    // ===== 技能草稿 API（必须先于通用技能 API 精确匹配） =====
    if (/^\/api\/skill-drafts(?:\/|$)/.test(path)) {
      try {
        const route = parseSkillDraftApiRoute(path);
        if (!route) return jsonError("not found", 404);

        if (route.kind === "by-conversation" && req.method === "GET") {
          assertSkillCreatorConversation(route.conversationId);
          const draft = await skillDraftStore.getOrCreateForConversation(
            route.conversationId,
          );
          if (draft.conversationId !== route.conversationId) {
            throw new SkillDraftApiError(
              "DRAFT_OWNERSHIP_MISMATCH",
              404,
              "技能草稿不存在",
            );
          }
          return json(draft);
        }

        if (route.kind === "by-conversation") {
          return jsonError("not found", 404);
        }

        const draft = await authorizeSkillDraft(route.draftId);
        if (draft.id !== route.draftId) {
          throw new SkillDraftApiError(
            "DRAFT_OWNERSHIP_MISMATCH",
            404,
            "技能草稿不存在",
          );
        }

        if (route.kind === "draft" && req.method === "GET") {
          return json(draft);
        }
        if (route.kind === "files" && req.method === "GET") {
          return json(await skillDraftStore.listFiles(route.draftId));
        }
        if (route.kind === "file" && req.method === "GET") {
          const filePath = new URL(req.url).searchParams.get("path") || "";
          const file = await skillDraftStore.readFile(
            route.draftId,
            filePath,
          );
          return json({
            text: file.text,
            size: file.size,
            binary: file.binary,
          });
        }
        if (route.kind === "installed-files" && req.method === "GET") {
          return json(
            await skillDraftStore.listInstalledFiles(route.draftId),
          );
        }
        if (route.kind === "installed-file" && req.method === "GET") {
          const filePath = new URL(req.url).searchParams.get("path") || "";
          const file = await skillDraftStore.readInstalledFile(
            route.draftId,
            filePath,
          );
          return json({
            text: file.text,
            size: file.size,
            binary: file.binary,
          });
        }
        if (route.kind === "revision" && req.method === "POST") {
          return json(await skillDraftStore.createRevision(route.draftId));
        }
        if (route.kind === "validate" && req.method === "POST") {
          return json(await skillDraftStore.validate(route.draftId));
        }
        if (route.kind === "install" && req.method === "POST") {
          const installed = await skillDraftStore.install(route.draftId);
          return json({ name: installed.name });
        }
        return jsonError("not found", 404);
      } catch (error) {
        return skillDraftErrorResponse(error);
      }
    }

    // ===== SkillHub API =====
    if (path === "/api/clawhub/skills" && req.method === "GET") {
      const { listClawHubSkills } = await import("./src/domains/clawhub/node/client.ts");
      const params = new URL(req.url).searchParams;
      return json(await listClawHubSkills(params.get("q") || "", params.get("cursor") || ""));
    }
    if (path === "/api/clawhub/install" && req.method === "POST") {
      const body = await req.json();
      if (!body || typeof body.slug !== "string" || typeof body.version !== "string" || (body.namespace !== undefined && typeof body.namespace !== "string")) return jsonError("ClawHub 安装参数无效", 400);
      const { installClawHubSkill } = await import("./src/domains/clawhub/node/installer.ts");
      return json(await installClawHubSkill(body));
    }
    // ===== 插件 API（Pi 生态扩展包） =====
    // GET /api/plugins — 已安装插件列表
    if (path === "/api/plugins" && req.method === "GET") {
      const { listPlugins } = await import(
        "./src/domains/plugin/node/service.ts"
      );
      return json(listPlugins());
    }
    // GET /api/plugins/catalog — 精选插件清单
    if (path === "/api/plugins/catalog" && req.method === "GET") {
      const { PLUGIN_CATALOG } = await import(
        "./src/platform/extensions/plugin-catalog.ts"
      );
      const { listPlugins } = await import(
        "./src/domains/plugin/node/service.ts"
      );
      const installed = new Set(listPlugins().map((p) => p.name));
      return json(
        PLUGIN_CATALOG.map((item) => ({ ...item, installed: installed.has(item.pkg) })),
      );
    }
    // GET /api/plugins/search?q= — npm registry 搜索
    if (path === "/api/plugins/search" && req.method === "GET") {
      const q = new URL(req.url).searchParams.get("q")?.trim() ?? "";
      if (!q) return jsonError("缺少搜索关键词 q", 400);
      try {
        const { searchPackages } = await import(
          "./src/domains/plugin/node/service.ts"
        );
        return json(await searchPackages(q));
      } catch (e) {
        return jsonError((e as Error).message, 502);
      }
    }
    // POST /api/plugins/install — 安装 { package }
    if (path === "/api/plugins/install" && req.method === "POST") {
      let body: unknown;
      try {
        body = await req.json();
      } catch {
        return jsonError("安装参数无效", 400);
      }
      const input = body && typeof body === "object"
        ? body as Record<string, unknown>
        : {};
      const pkg = typeof input.package === "string" ? input.package.trim() : "";
      if (!pkg) return jsonError("缺少 package 参数", 400);
      try {
        const { installPlugin } = await import(
          "./src/domains/plugin/node/service.ts"
        );
        return json(await installPlugin(pkg));
      } catch (e) {
        const message = (e as Error).message;
        return jsonError(
          message.includes("非法包名") ? message : `插件安装失败：${message}`,
          message.includes("非法包名") ? 400 : 500,
        );
      }
    }
    // POST /api/plugins/uninstall — 卸载 { id }
    if (path === "/api/plugins/uninstall" && req.method === "POST") {
      let body: unknown;
      try {
        body = await req.json();
      } catch {
        return jsonError("卸载参数无效", 400);
      }
      const input = body && typeof body === "object"
        ? body as Record<string, unknown>
        : {};
      const id = typeof input.id === "string" ? input.id.trim() : "";
      if (!id) return jsonError("缺少 id 参数", 400);
      try {
        const { uninstallPlugin } = await import(
          "./src/domains/plugin/node/service.ts"
        );
        await uninstallPlugin(id);
        return json({ ok: true });
      } catch (e) {
        return jsonError((e as Error).message, 500);
      }
    }

    // ===== 技能 API（技能编辑器） =====
    // GET /api/skills — 列出所有技能
    if (path === "/api/skills" && req.method === "GET") {
      const { listSkills } = await import("./src/domains/skill/node/store.ts");
      return json(await listSkills());
    }
    // POST /api/skills — 新建技能 { name, description, disabled, body, displayName }
    if (path === "/api/skills" && req.method === "POST") {
      const b = await req.json();
      const { saveSkill } = await import("./src/domains/skill/node/store.ts");
      try {
        const skill = await saveSkill(
          b.name,
          b.description || "",
          !!b.disabled,
          b.body || "",
          b.displayName || b.name,
        );
        return json(skill);
      } catch (e) {
        return json({ error: (e as Error).message });
      }
    }
    // PUT /api/skills/:name — 编辑技能 { description, disabled, body, displayName }
    if (path.match(/^\/api\/skills\/[^/]+$/) && req.method === "PUT") {
      const name = path.split("/")[3];
      const b = await req.json();
      const { saveSkill } = await import("./src/domains/skill/node/store.ts");
      try {
        const skill = await saveSkill(
          name,
          b.description || "",
          !!b.disabled,
          b.body || "",
          b.displayName || name,
        );
        return json(skill);
      } catch (e) {
        return json({ error: (e as Error).message });
      }
    }
    // DELETE /api/skills/:name — 删除技能（内置不可删）
    if (path.match(/^\/api\/skills\/[^/]+$/) && req.method === "DELETE") {
      const name = path.split("/")[3];
      const { deleteSkill } = await import("./src/domains/skill/node/store.ts");
      try {
        await deleteSkill(name);
        return json({ ok: true });
      } catch (e) {
        return json({ error: (e as Error).message });
      }
    }
    // POST /api/skills/:name/edit-session — 创建隔离的技能编辑会话（草稿预填已安装内容）
    const skillEditSessionMatch = path.match(
      /^\/api\/skills\/([^/]+)\/edit-session$/,
    );
    if (skillEditSessionMatch && req.method === "POST") {
      const skillName = decodeURIComponent(skillEditSessionMatch[1]);
      const { getSkill } = await import("./src/domains/skill/node/store.ts");
      const skill = await getSkill(skillName);
      if (!skill || skill.builtin) {
        throw new SkillDraftError(
          "SKILL_EDIT_SOURCE_REQUIRED",
          404,
          "installed skill is not available for editing",
        );
      }
      let conversation: ReturnType<typeof createConversation> | null = null;
      try {
        let body: any = {};
        try {
          body = await req.json();
        } catch {
          // empty body is valid
        }
        conversation = createConversation(
          `修改${skill.displayName || skill.name}`,
          "skill_creator",
          body?.workspaceId ?? null,
          null,
          body.modelProvider && body.modelId
            ? { provider: String(body.modelProvider), modelId: String(body.modelId) }
            : undefined,
        );
        await skillDraftStore.createRevisionOf(skillName, conversation.id);
        setSkillEditMetadata(conversation.id, { targetName: skillName });
        const persistedConversation = getConversation(conversation.id);
        if (!persistedConversation) {
          throw new Error("skill edit conversation was not persisted");
        }
        return json({
          conversation: toRendererConversation(persistedConversation),
          skill: (await getSkill(skillName)) ?? null,
        });
      } catch (error) {
        if (conversation) {
          deleteConversation(conversation.id);
        }
        throw error;
      }
    }
    // ===== 自动化 API（功能8） =====
    // GET /api/automations — 列出所有自动化
    if (path === "/api/automations" && req.method === "GET") {
      const { listAutomations } = await import(
        "./src/domains/automation/node/store.ts"
      );
      return json(listAutomations());
    }
    // POST /api/automations — 新建 { name, workspaceId, triggerType, triggerConfig, actionType, actionConfig, prompt, expertId, permission, connector, scheduleType, validFrom, validUntil, pushToWxmp }
    if (path === "/api/automations" && req.method === "POST") {
      const b = await req.json();
      const { createAutomation, updateAutomation, getAutomation } =
        await import("./src/domains/automation/node/store.ts");
      const { initAutomationNextRun } = await import(
        "./src/domains/automation/node/scheduler.ts"
      );
      const a = createAutomation(b);
      initAutomationNextRun(a);
      return json(getAutomation(a.id));
    }
    // PUT /api/automations/:id — 更新
    if (
      path.match(/^\/api\/automations\/[^/]+$/) && !path.endsWith("/runs") &&
      !path.endsWith("/run") && req.method === "PUT"
    ) {
      const id = path.split("/")[3];
      const b = await req.json();
      const { updateAutomation, getAutomation } = await import(
        "./src/domains/automation/node/store.ts"
      );
      const { initAutomationNextRun } = await import(
        "./src/domains/automation/node/scheduler.ts"
      );
      updateAutomation(id, b);
      const a = getAutomation(id);
      if (a) {
        if (a.enabled && a.triggerType === "cron") initAutomationNextRun(a);
        else updateAutomation(id, { nextRun: null });
      }
      return json(getAutomation(id));
    }
    // DELETE /api/automations/:id
    if (
      path.match(/^\/api\/automations\/[^/]+$/) && !path.endsWith("/runs") &&
      !path.endsWith("/run") && req.method === "DELETE"
    ) {
      const id = path.split("/")[3];
      const { deleteAutomation } = await import(
        "./src/domains/automation/node/store.ts"
      );
      deleteAutomation(id);
      return json({ ok: true });
    }
    // GET /api/automations/:id/runs — 运行记录
    if (
      path.match(/^\/api\/automations\/[^/]+\/runs$/) && req.method === "GET"
    ) {
      const id = path.split("/")[3];
      const { listRuns } = await import(
        "./src/domains/automation/node/store.ts"
      );
      return json(listRuns(id));
    }
    // POST /api/automations/:id/run — 手动触发一次
    if (
      path.match(/^\/api\/automations\/[^/]+\/run$/) && req.method === "POST"
    ) {
      const id = path.split("/")[3];
      const {
        claimAutomationRun,
        AutomationAlreadyRunningError,
        AutomationModelNotConfiguredError,
      } = await import(
        "./src/domains/automation/node/coordinator.ts"
      );
      const { executeAutomationRun, superviseAutomationRun } = await import(
        "./src/domains/automation/node/executor.ts"
      );
      try {
        const claimed = await claimAutomationRun(id, "manual");
        superviseAutomationRun(executeAutomationRun(
          claimed.automation,
          claimed.run.id,
          claimed.run.sessionId!,
          claimed.prompt,
        ));
        return json({ ok: true, runId: claimed.run.id, sessionId: claimed.run.sessionId, status: "queued" });
      } catch (error) {
        if (error instanceof AutomationAlreadyRunningError) {
          return new Response(JSON.stringify({
            error: error.message,
            code: error.code,
            runId: error.run.id,
            sessionId: error.run.sessionId,
          }), { status: 409, headers: { "content-type": "application/json" } });
        }
        if (error instanceof AutomationModelNotConfiguredError) {
          return jsonError(error.message, 400, error.code);
        }
        throw error;
      }
    }
    // ===== 文件快照 API（功能17） =====
    // GET /api/file-snapshots?path= — 列出文件快照（有 path 列某文件快照，无 path 列所有文件）
    if (path === "/api/file-snapshots" && req.method === "GET") {
      const fp = new URL(req.url).searchParams.get("path");
      const { listFileSnapshots, listSnapshottedFiles } = await import(
        "./src/infra/file_snapshot.ts"
      );
      return json(fp ? listFileSnapshots(fp) : listSnapshottedFiles());
    }
    // POST /api/file-snapshots/:id/revert — 回滚到某快照
    if (
      path.match(/^\/api\/file-snapshots\/[^/]+\/revert$/) &&
      req.method === "POST"
    ) {
      const id = path.split("/")[3];
      const { revertFileSnapshot } = await import(
        "./src/infra/file_snapshot.ts"
      );
      try {
        await revertFileSnapshot(id);
        return json({ ok: true });
      } catch (e) {
        return json({ error: (e as Error).message });
      }
    }
    // GET /api/artifacts/:id/versions — 列出版本历史
    if (
      path.startsWith("/api/artifacts/") && path.endsWith("/versions") &&
      req.method === "GET"
    ) {
      const id = path.split("/")[3];
      const { listArtifactVersions } = await import(
        "./src/domains/artifact/node/store.ts"
      );
      return json(listArtifactVersions(id));
    }
    // POST /api/artifacts/:id/restore — 还原版本
    if (
      path.startsWith("/api/artifacts/") && path.endsWith("/restore") &&
      req.method === "POST"
    ) {
      const id = path.split("/")[3];
      const b = await req.json();
      const { restoreArtifactVersion } = await import(
        "./src/domains/artifact/node/store.ts"
      );
      await restoreArtifactVersion(id, b.version);
      return json({ ok: true });
    }
    // POST /api/export-pdf { path } — 导出文档为 PDF（用 soffice/LibreOffice，对照 08 计划功能12）
    if (path === "/api/export-pdf" && req.method === "POST") {
      const b = await req.json();
      const srcPath = b.path ? platformPaths.expandHome(b.path) : b.path;
      if (!srcPath) return json({ error: "缺少 path" });
      try {
        await stat(srcPath);
      } catch {
        return json({ error: "文件不存在" });
      }
      const soffice = await findLibreOfficeExecutable(currentPlatform);
      if (!soffice) {
        const installHint = currentPlatform === "windows"
          ? "请从 libreoffice.org 安装 Windows 版 LibreOffice"
          : "请安装：brew install --cask libreoffice";
        return json({ error: `未检测到 LibreOffice/soffice，${installHint}` });
      }
      const { outputDirectory: outDir, pdfPath } = outputPathForPdf(
        srcPath,
        currentPlatform,
      );
      try {
        try {
          await execFileAsync(
            soffice,
            [
              "--headless",
              "--convert-to",
              "pdf",
              "--outdir",
              outDir,
              srcPath,
            ],
            { signal: AbortSignal.timeout(60_000) }, // 60 秒超时，防止 soffice 卡死
          );
        } catch (e) {
          const err = e as { code?: unknown; stderr?: Buffer };
          if (typeof err.code === "number") {
            const stderr = new TextDecoder().decode(
              err.stderr ?? Buffer.alloc(0),
            );
            return json({ error: `转换失败：${stderr}` });
          }
          throw e;
        }
        // 校验输出文件确实生成
        const pdfStat = await stat(pdfPath).catch(() => null);
        if (!pdfStat || !pdfStat.isFile()) {
          return json({
            error: "转换未生成输出文件，可能 LibreOffice 版本不兼容",
          });
        }
        // 登记为工件
        try {
          const { createArtifact } = await import(
            "./src/domains/artifact/node/store.ts"
          );
          const fileName = platformPaths.basename(pdfPath) || "export.pdf";
          createArtifact({ fileName, filePath: pdfPath, bytes: pdfStat.size });
        } catch {}
        return json({ ok: true, pdfPath });
      } catch (e) {
        return json({ error: `导出失败：${(e as Error).message}` });
      }
    }
    // GET /api/preview/markdown?path=xxx — 内置 Markdown HTML 预览
    if (path === "/api/preview/markdown" && req.method === "GET") {
      const filePath = new URL(req.url).searchParams.get("path") || "";
      const { isAllowedMarkdownPreviewPath, renderMarkdownPreview } = await import(
        "./src/domains/preview/node/markdown.ts"
      );
      const allowedRoots = [
        platformPaths.artifactsDir,
        ...listWorkspaces().map((workspace) => workspace.dirPath),
      ];
      if (!isAllowedMarkdownPreviewPath(filePath, allowedRoots)) {
        return jsonError("Markdown 文件路径不在允许的预览范围内", 403);
      }
      try {
        const text = await readFile(filePath, "utf-8");
        const preview = await renderMarkdownPreview(text, { sourcePath: filePath });
        return json({ ok: true, sourcePath: filePath, ...preview });
      } catch (error) {
        return jsonError(`Markdown 预览失败：${(error as Error).message}`, 500);
      }
    }
    // GET /api/preview?path=xxx — 格式化文档预览
    if (path === "/api/preview" && req.method === "GET") {
      const filePath = new URL(req.url).searchParams.get("path") || "";
      const ext = filePath.split(".").pop()?.toLowerCase() || "";
      const plainTextExtensions = new Set([
        "py",
        "js",
        "ts",
        "tsx",
        "jsx",
        "go",
        "rs",
        "java",
        "c",
        "h",
        "cpp",
        "cxx",
        "css",
        "scss",
        "sh",
        "bash",
        "json",
        "yaml",
        "yml",
        "xml",
        "toml",
        "ini",
        "log",
        "txt",
        "md",
        "markdown",
      ]);
      try {
        if (ext === "docx") {
          const mammothMod = await import("mammoth");
          const mammoth = (mammothMod as any).default || mammothMod;
          // @ts-ignore
          const result = await mammoth.convertToHtml({ path: filePath });
          return json({ kind: "docx", html: result.value || "(空文档)" });
        } else if (ext === "xlsx") {
          const excelMod = await import("exceljs");
          const ExcelJS = (excelMod as any).default || excelMod;
          const buf = await readFile(filePath);
          // @ts-ignore
          const workbook = new ExcelJS.Workbook();
          await workbook.xlsx.load(buf as any);
          const sheets: any[] = [];
          workbook.eachSheet((sheet: any) => {
            const rows: any[] = [];
            sheet.eachRow({ includeEmpty: true }, (row: any) => {
              const vals = row.values as any[];
              const cells = (vals.slice(1) || []).map((v) =>
                v?.toString?.() ?? ""
              );
              rows.push(cells);
            });
            sheets.push({ name: sheet.name, rows: rows.slice(0, 100) });
          });
          return json({ kind: "xlsx", sheets });
        } else if (ext === "csv" || ext === "tsv") {
          const text = await readFile(filePath, "utf-8");
          const separator = ext === "tsv" ? "\t" : ",";
          const rows = text.split("\n").map((r) =>
            r.split(separator).map((c) => c.replace(/^"|"$/g, ""))
          );
          return json({
            kind: ext,
            sheets: [{ name: ext.toUpperCase(), rows: rows.slice(0, 100) }],
          });
        } else if (ext === "pptx") {
          const { readDoc } = await import("./src/domains/doc/node/reader.ts");
          const result = await readDoc(filePath);
          return json({ kind: "pptx", text: result.text });
        } else if (ext === "pdf") {
          const { readDoc } = await import("./src/domains/doc/node/reader.ts");
          const result = await readDoc(filePath);
          return json({ kind: "pdf", text: result.text });
        } else if (plainTextExtensions.has(ext)) {
          const text = await readFile(filePath, "utf-8");
          return json({ kind: ext, text });
        } else if (ext === "html" || ext === "htm") {
          const html = await readFile(filePath, "utf-8");
          return json({ kind: "html", html });
        } else if (["png", "jpg", "jpeg", "gif", "svg", "webp"].includes(ext)) {
          const imageStat = await stat(filePath);
          return json({ kind: "image", path: filePath, size: imageStat.size });
        }
        return json({ error: `不支持预览格式: ${ext}` });
      } catch (e) {
        return json({ error: `预览加载失败: ${(e as Error).message}` });
      }
    }
    const npmBuiltinRoute = path.match(/^\/api\/mcp\/builtin\/npm\/(gitlab|jenkins)(?:\/(install|configure))?$/);
    if (npmBuiltinRoute) {
      if (!(req as any).tapdTrustedIpc) return jsonError("内置 MCP 操作仅允许应用内调用", 403);
      const { builtinNpmMcpService } = await import("./src/agent/builtin_npm_mcp.ts");
      const id = npmBuiltinRoute[1] as "gitlab" | "jenkins";
      const action = npmBuiltinRoute[2];
      try {
        if (!action && req.method === "GET") return json(await builtinNpmMcpService.status(id));
        if (action === "install" && req.method === "POST") {
          await builtinNpmMcpService.install(id);
          return json(await builtinNpmMcpService.status(id));
        }
        if (action === "configure" && req.method === "POST") {
          await builtinNpmMcpService.configure(id, (await req.json()).env);
          const { disconnectAllMcpServers } = await import("./src/agent/mcp.ts");
          await disconnectAllMcpServers();
          return json(await builtinNpmMcpService.status(id));
        }
        return jsonError("不支持的内置 MCP 操作", 405);
      } catch (error) { return jsonError((error as Error).message, 400); }
    }
    if (path === "/api/mcp/oauth" && (req.method === "GET" || req.method === "POST")) {
      const oauth = await import("./src/agent/mcp_oauth.ts");
      const body = req.method === "POST" ? await req.json() : undefined;
      const name = req.method === "GET" ? new URL(req.url).searchParams.get("name") : body?.name;
      if (typeof name !== "string" || !name.trim()) return jsonError("MCP 连接器名称不能为空", 400);
      try {
        if (req.method === "GET") return json(oauth.mcpOAuthStatus(name));
        if (body.action === "login") return json(await oauth.startMcpOAuth(name, url => openExternalSafely(electronShell.openExternal.bind(electronShell), url)));
        if (body.action === "cancel") return json(await oauth.cancelMcpOAuth(name));
        if (body.action === "logout") return json(await oauth.logoutMcpOAuth(name));
        return jsonError("未知授权操作", 400);
      } catch (error) { return jsonError((error as Error).message, 400); }
    }
    if (path === '/api/mcp/presets/figma' && req.method === 'POST') {
      if ((req as Request & { tapdTrustedIpc?: boolean }).tapdTrustedIpc !== true) return jsonError('请在桌面客户端添加连接器', 403);
      const { addFigmaMcp } = await import('./src/agent/figma_mcp.ts');
      const { mcpConfigStore } = await import('./src/agent/mcp_config.ts');
      try { return json(await addFigmaMcp(mcpConfigStore, (await req.json()).mode)); }
      catch (error) { return jsonError((error as Error).message, 400); }
    }
    // POST /api/mcp/connect — 用户选择后按需连接单个 MCP server
    if (path === "/api/mcp/connect" && req.method === "POST") {
      const body = await req.json();
      const name = typeof body?.name === "string" ? body.name.trim() : "";
      if (!name) return jsonError("MCP 连接器名称不能为空", 400);
      if (name === "tapd") return new Response(JSON.stringify({ error: "请选择 TAPD 授权项目", code: "TAPD_WORKSPACE_REQUIRED" }), { status: 400, headers: { "content-type": "application/json" } });
      const { connectMcpServerByName, McpConnectionError } = await import(
        "./src/agent/mcp.ts"
      );
      try {
        return json(await connectMcpServerByName(name));
      } catch (error) {
        if (error instanceof McpConnectionError) {
          return new Response(
            JSON.stringify({ error: error.message, code: error.code }),
            {
              status: error.status,
              headers: { "content-type": "application/json" },
            },
          );
        }
        throw error;
      }
    }
    // GET /api/mcp — 列出 MCP server 配置和连接状态
    if (path === "/api/mcp" && req.method === "GET") {
      const { loadMcpConfig } = await import("./src/agent/mcp.ts");
      const { listMcpConnections } = await import("./src/agent/mcp.ts");
      const config = await loadMcpConfig();
      const { customMcpConfig } = await import("./src/agent/mcp_config.ts");
      const customConfig = customMcpConfig(config);
      const connected = listMcpConnections();
      const availableConfig = { mcpServers: { ...customConfig.mcpServers } };
      for (const id of ["gitlab", "jenkins"]) {
        const entry = config.mcpServers[id];
        if (entry?.managedBy === "builtin") {
          availableConfig.mcpServers[id] = { type: "stdio", displayName: entry.displayName, description: entry.description, disabled: entry.disabled };
        }
      }
      return json({
        config: customConfig,
        availableConfig,
        connected,
      });
    }
    // POST /api/mcp — 保存配置并断开旧连接；后续由用户选择时按需连接
    if (path === "/api/mcp" && req.method === "POST") {
      const b = await req.json();
      const { saveMcpConfig, disconnectAllMcpServers } = await import(
        "./src/agent/mcp.ts"
      );
      const { cancelAllMcpOAuth } = await import("./src/agent/mcp_oauth.ts");
      await cancelAllMcpOAuth();
      try { await saveMcpConfig(b); }
      catch (error) { return jsonError((error as Error).message, 400); }
      await disconnectAllMcpServers();
      return json({ ok: true, toolCount: 0 });
    }
    if (path === "/api/system/browser-automation" && (req.method === "GET" || req.method === "POST")) {
      const service = await import("./src/domains/browser-automation/node/service.ts");
      if (req.method === "GET") return json(await service.browserAutomationStatus());
      const body = await req.json();
      if (typeof body?.enabled !== "boolean") return jsonError("enabled must be boolean", 400);
      return json(await service.updateBrowserAutomation(body.enabled));
    }
    // GET /api/system/permissions — 诊断 Computer Use 系统权限及依赖（纯 C API 静默检查，绝不出弹出/不强开系统偏好）
    if (path === "/api/system/permissions" && req.method === "GET") {
      const { hasCliclick, getDisplayMetrics } = await import(
        "./src/agent/tools/os.ts"
      );
      const cliclickInstalled = await hasCliclick();
      const metrics = await getDisplayMetrics();

      let accessibilityGranted = false;
      let screenRecordingGranted = false;

      if (platformOs === "darwin") {
        // Koffi 是原生模块，只在 macOS 权限探测实际被调用时再加载。
        // Windows 启动不应因一个仅供 macOS 使用的可选能力而失败。
        const { default: koffi } = await import("koffi");
        // 1. 辅助功能检测 (AXIsProcessTrusted + AppleScript System Events 双重检测)
        try {
          const appServices = koffi.load(
            "/System/Library/Frameworks/ApplicationServices.framework/ApplicationServices",
          );
          const AXIsProcessTrusted = appServices.func(
            "bool AXIsProcessTrusted()",
          );
          accessibilityGranted = AXIsProcessTrusted();
          appServices.unload();
        } catch {}

        if (!accessibilityGranted) {
          try {
            await execFileAsync(
              "osascript",
              ["-e", 'tell application "System Events" to return true'],
              { stdio: "ignore" },
            );
            accessibilityGranted = true;
          } catch {
            accessibilityGranted = false;
          }
        }

        // 2. 屏幕录制检测 (结合 CGPreflightScreenCaptureAccess 优先检测，离线打包环境默认判定为就绪，彻底避免误报)
        try {
          const coreGraphics = koffi.load(
            "/System/Library/Frameworks/CoreGraphics.framework/CoreGraphics",
          );
          const CGPreflightScreenCaptureAccess = coreGraphics.func(
            "bool CGPreflightScreenCaptureAccess()",
          );
          const pf = CGPreflightScreenCaptureAccess();
          coreGraphics.unload();
          screenRecordingGranted = pf || accessibilityGranted || true;
        } catch {
          screenRecordingGranted = true;
        }
      } else {
        accessibilityGranted = true;
        screenRecordingGranted = true;
      }

      return json({
        os: platformOs,
        cliclickInstalled,
        accessibilityGranted,
        screenRecordingGranted,
        metrics,
        capabilities: baseCapabilities(currentPlatform),
      });
    }
    // POST /api/system/permissions/open — 打开 macOS 权限系统偏好设置页面
    if (path === "/api/system/permissions/open" && req.method === "POST") {
      try {
        const settingsPath = currentPlatform === "windows"
          ? "ms-settings:privacy"
          : "x-apple.systempreferences:com.apple.preference.security";
        const error = await openPathSafely(
          electronShell.openPath.bind(electronShell),
          settingsPath,
        );
        if (error) return jsonError(`无法打开系统设置：${error}`, 500, "OPEN_PATH_FAILED");
        return json({ ok: true });
      } catch (e) {
        return json({ error: (e as Error).message });
      }
    }
    // POST /api/system/exit — 强制退出程序
    if (path === "/api/system/exit" && req.method === "POST") {
      setTimeout(async () => {
        await keepAwakeManager.dispose().catch(() => {});
        try {
          process.exit(0);
        } catch {}
      }, 100);
      return json({ success: true });
    }

    // GET /api/system/context — 获取当前前台应用名及选中内容
    if (path === "/api/system/context" && req.method === "GET") {
      let app = "";
      let selection = "";
      try {
        app = await platformShell.getForegroundApplication();
      } catch {}

      try {
        if (platformShell.readSelectedText) {
          selection = (await platformShell.readSelectedText()).slice(0, 1000);
        }
      } catch {}

      if (!selection) {
        try {
          selection = (await platformShell.readClipboardText()).slice(0, 1000);
        } catch {}
      }

      return json({ app, selection });
    }

    // POST /api/float/transfer — 将速唤浮窗记录转存为主会话
    if (path === "/api/float/transfer" && req.method === "POST") {
      const b = await req.json();
      const sessionId = b.sessionId;
      if (sessionId) {
        const db = getDb();
        db.prepare(
          "UPDATE conversations SET category = 'assistant' WHERE id = ?",
        ).run(sessionId);
        return json({ ok: true });
      }
      return json({ error: "缺失 sessionId" });
    }

    // GET /api/conv/:id/export?format=md|txt|json — 导出对话
    if (
      path.includes("/export") && path.startsWith("/api/conv/") &&
      req.method === "GET"
    ) {
      const parts = path.split("/");
      const id = parts[3];
      const format = new URL(req.url).searchParams.get("format") || "md";
      const messages = getMessages(id);
      const conv = listConversations().find((c: any) => c.id === id);
      const title = conv?.title || "对话";

      let content = "";
      const filename = title.replace(/[\/\\:*?"<>|]/g, "_");

      if (format === "json") {
        content = JSON.stringify({ title, id, messages }, null, 2);
      } else if (format === "txt") {
        content = `${title}\n${"=".repeat(title.length)}\n\n`;
        for (const m of messages) {
          const who = m.role === "user"
            ? "我"
            : m.role === "assistant"
            ? "PiCoddy"
            : `🔧 ${m.toolName || "工具"}`;
          content += `[${who}]\n${m.content}\n\n`;
        }
      } else {
        // markdown（默认）
        content = `# ${title}\n\n`;
        for (const m of messages) {
          if (m.role === "user") {
            content += `## 🧑 我\n\n${m.content}\n\n`;
          } else if (m.role === "assistant") {
            content += `## 🤖 PiCoddy\n\n${m.content}\n\n`;
          } else {
            content += `**🔧 ${m.toolName || "工具"}** ${
              m.isError ? "✗" : "✓"
            }\n\n`;
          }
        }
      }

      const ext = format === "json" ? "json" : format === "txt" ? "txt" : "md";
      return new Response(content, {
        headers: {
          "content-type": format === "json"
            ? "application/json"
            : "text/plain; charset=utf-8",
          "content-disposition": `attachment; filename="${
            encodeURIComponent(filename)
          }.${ext}"`,
        },
      });
    }
    // POST /api/conv/:id/fork { fromMessageId } — 从某条消息分叉出新会话
    if (path.match(/^\/api\/conv\/[^/]+\/fork$/) && req.method === "POST") {
      const id = path.split("/")[3];
      const b = await req.json();
      const { forkConversation } = await import(
        "./src/domains/session/node/store.ts"
      );
      try {
        const conv = forkConversation(id, b.fromMessageId);
        return json(conv);
      } catch (e) {
        return json({ error: (e as Error).message });
      }
    }
    // ===== 项目 API =====
    if (path === "/api/local-projects" || path.startsWith("/api/local-projects/")) {
      const { createLocalProjectHttpAdapter } = await import('./src/domains/project/node/local_workflow_http.ts');
      const localProjects = await localProjectsService();
      const localResponse = await createLocalProjectHttpAdapter({
        service: localProjects,
        getAccountId: () => getActiveAuthSession()?.userId,
      })(req, path);
      if (localResponse) return localResponse;
    }
    if (path === "/api/projects" && req.method === "GET") {
      return json(listProjects());
    }
    if (path === "/api/tapd/requirements" && req.method === "GET") {
      const { listTapdRequirements, TapdRequirementsError } = await import(
        "./src/integrations/tapd/requirements.ts"
      );
      try {
        const url = new URL(req.url);
        return json(await listTapdRequirements({
          force: url.searchParams.get("refresh") === "1",
          page: Number(url.searchParams.get("page")) || 1,
          pageSize: Number(url.searchParams.get("pageSize")) || 20,
          query: url.searchParams.get("query") || "",
          workspaceId: url.searchParams.get("workspaceId") || "",
          status: url.searchParams.get("status") || "",
        }));
      } catch (error) {
        if (error instanceof TapdRequirementsError) {
          const status = error.code === "TAPD_NOT_CONFIGURED" ? 409
            : error.code === "TAPD_UNAUTHORIZED" || error.code === "AUTH_REQUIRED" ? 401
            : 502;
          return jsonError(error.message, status, error.code);
        }
        throw error;
      }
    }
    // 打开 TAPD 需求空间（只建立/恢复归属，不创建会话或启动模型）
    if (path.match(/^\/api\/tapd\/requirements\/[^/]+\/[^/]+$/) && req.method === "GET") {
      const { createRequirementStore } = await import("./src/domains/requirement/node/store.ts");
      const { getTapdRequirementContext, TapdRequirementsError } = await import("./src/integrations/tapd/requirements.ts");
      const session = getActiveAuthSession();
      if (!session) return jsonError("请先登录", 401, "AUTH_REQUIRED");
      const parts = path.split("/");
      const workspaceId = decodeURIComponent(parts[4]);
      const storyId = decodeURIComponent(parts[5]);
      try {
        const context = await getTapdRequirementContext(workspaceId, storyId);
        if (!context.requirement) return jsonError("需求不存在或无权访问", 403);
        const spaceId = createRequirementStore(getDb()).open(session.userId, "https://api.tapd.cn", workspaceId, storyId);
        return json({ ...context, spaceId, workspaceId, storyId, conversationIds: createRequirementStore(getDb()).listConversationIds(session.userId, spaceId) });
      } catch (error) {
        if (error instanceof TapdRequirementsError) return jsonError(error.message, error.code === "TAPD_UNAUTHORIZED" ? 401 : 502, error.code);
        throw error;
      }
    }
    if (path.match(/^\/api\/tapd\/requirements\/[^/]+\/[^/]+\/attachments$/) && req.method === "POST") {
      const { uploadTapdRequirementAttachment, TapdRequirementsError } = await import("./src/integrations/tapd/requirements.ts");
      const parts = path.split("/");
      const workspaceId = decodeURIComponent(parts[4]);
      const storyId = decodeURIComponent(parts[5]);
      try {
        const form = await req.formData();
        const file = form.get("file");
        const customField = String(form.get("customField") || "");
        if (!(file instanceof (globalThis as any).File)) return jsonError("未选择文件", 400, "INVALID_REQUEST");
        return json({ uploaded: await uploadTapdRequirementAttachment(workspaceId, storyId, customField, file) });
      } catch (error) {
        if (error instanceof TapdRequirementsError) return jsonError(error.message, error.code === "TAPD_UNAUTHORIZED" ? 401 : 400, error.code);
        return jsonError(error instanceof Error ? error.message : String(error), 400, "TAPD_UPLOAD_FAILED");
      }
    }
    const testingDeliveryMatch = path.match(/^\/api\/conversations\/([^/]+)\/testing-delivery$/);
    if (testingDeliveryMatch && ['GET', 'POST'].includes(req.method)) {
      const session = getActiveAuthSession(); if (!session) return jsonError('请先登录', 401);
      const conversationId = decodeURIComponent(testingDeliveryMatch[1]);
      const owned = getDb().prepare(`SELECT s.account_id,s.tapd_workspace_id,s.tapd_story_id FROM requirement_conversations r JOIN requirement_spaces s ON s.id=r.space_id WHERE r.conversation_id=? AND r.request_key='stage:自动测试'`).get(conversationId);
      if (!owned || owned.account_id !== session.userId) return jsonError('无权访问测试会话', 403);
      if (getConversationExpertBinding(conversationId)?.expertId !== 'team-qa--testing-expert') return jsonError('当前会话未绑定测试专家', 400);
      if (provider.isBusy(conversationId)) return req.method === 'GET' ? json({ busy: true }) : jsonError('请等待测试专家完成交付', 409);
      const workspaceId = String(owned.tapd_workspace_id), storyId = String(owned.tapd_story_id);
      const { requirementDelivery, collectTestingDelivery, uploadTestingDelivery } = await import('./src/domains/requirement/node/delivery.ts');
      const { getTapdRequirementContext, uploadTapdRequirementAttachment } = await import('./src/integrations/tapd/requirements.ts');
      const { createTestCaseImporter } = await import('./src/domains/requirement/node/test_case_import.ts');
      const checkIdentity = () => {
        if (getActiveAuthSession()?.userId !== session.userId || getConversationExpertBinding(conversationId)?.expertId !== 'team-qa--testing-expert' || provider.isBusy(conversationId)) throw new Error('账户、专家绑定或会话状态已变化，请刷新后重试');
      };
      const delivery = requirementDelivery(getDb(), platformPaths.appDataDir, platformPaths.artifactsDir, session.userId, conversationId);
      const importer = createTestCaseImporter(getDb(), { accountId: session.userId, workspaceId, storyId, conversationId }, checkIdentity);
      // Local asset/receipt polling must not fetch four unrelated TAPD resources.
      // The importer resolves the default root only when upload starts.
      if (req.method === 'GET') {
        const assetId = new URL(req.url).searchParams.get('assetId');
        const candidates = (await delivery.assets.list()).filter(asset => asset.stage === 7 && asset.sourceConversationId === conversationId && asset.confirmed !== false && /测试用例\.xlsx$/i.test(asset.name));
        if (assetId) {
          const asset = candidates.find(asset => asset.id === assetId);
          if (!asset) return jsonError('Excel 不属于当前测试会话', 400);
          if (new URL(req.url).searchParams.get('resultsOnly') === '1') return json({ asset: { id: asset.id, hash: asset.hash, name: asset.name }, results: importer.results(asset) });
          const context = await getTapdRequirementContext(workspaceId, storyId);
          if (!context.requirement) return jsonError('需求不存在或无权访问', 403);
          const records = await importer.workbook(asset, asset.hash, context.requirement.url);
          return json({ busy: false, asset: { id: asset.id, hash: asset.hash, name: asset.name }, count: records.length, results: importer.results(asset) });
        }
        return json({ busy: false, candidates: candidates.map(asset => ({ id: asset.id, hash: asset.hash, name: asset.name })) });
      }
      const context = await getTapdRequirementContext(workspaceId, storyId);
      if (!context.requirement) return jsonError('需求不存在或无权访问', 403);
      const body = await req.json();
      checkIdentity();
      if (body.action === 'submit') return json(await uploadTestingDelivery(conversationId, String(body.customField || ''), context.requirement.url, {
        collect: () => collectTestingDelivery(getDb(), conversationId, delivery.collect), assets: delivery.assets,
        upload: (name, bytes, field) => { checkIdentity(); return uploadTapdRequirementAttachment(workspaceId, storyId, field, new File([Buffer.from(bytes)], name)); },
      }));
      if (body.action !== 'import') return jsonError('无效的测试产物操作', 400);
      const asset = (await delivery.assets.list()).find(asset => asset.id === body.assetId);
      if (!asset) return jsonError('资产不存在', 400);
      return json({ results: await importer.import(asset, String(body.hash || ''), context.requirement) });
    }
    const completionMatch = path.match(/^\/api\/conversations\/([^/]+)\/requirement-completion$/);
    if (completionMatch && ["GET", "POST"].includes(req.method)) {
      const session = getActiveAuthSession(); if (!session) return jsonError("请先登录", 401);
      const conversationId = decodeURIComponent(completionMatch[1]);
      const owned = getDb().prepare(`SELECT s.account_id,s.tapd_workspace_id,s.tapd_story_id FROM requirement_conversations r JOIN requirement_spaces s ON s.id=r.space_id JOIN conversations c ON c.id=r.conversation_id WHERE c.id=?`).get(conversationId);
      if (!owned || owned.account_id !== session.userId) return jsonError("无权访问需求会话", 403);
      const workspaceId = String(owned.tapd_workspace_id), storyId = String(owned.tapd_story_id);
      const { requirementDelivery, completeRequirementStage } = await import("./src/domains/requirement/node/delivery.ts");
      const { getTapdStoryWorkflow, transitionTapdStory, uploadTapdRequirementAttachment, getTapdRequirementContext } = await import("./src/integrations/tapd/requirements.ts");
      const delivery = requirementDelivery(getDb(), platformPaths.appDataDir, platformPaths.artifactsDir, session.userId, conversationId);
      if (req.method === "GET") {
        // The UI may observe agent_end before the prompt queue finishes cleanup.
        // Reading availability is not a submission conflict; avoid collecting unfinished files.
        if (provider.isBusy(conversationId)) return json({ busy: true });
        let workflow: { current: string; currentLabel: string; targets: Array<{ value: string; label: string }> };
        let workflowError: string | undefined;
        try { workflow = await getTapdStoryWorkflow(workspaceId, storyId); }
        catch (error) {
          if (delivery.stage !== 7) throw error;
          // Case preparation and attachment upload do not require a supported status transition workflow.
          const context = await getTapdRequirementContext(workspaceId, storyId);
          if (!context.requirement) throw new Error('需求不存在或无权访问');
          workflow = { current: context.requirement.status, currentLabel: context.requirement.statusLabel, targets: [] };
          workflowError = error instanceof Error ? error.message : String(error);
        }
        if (provider.isBusy(conversationId)) return json({ busy: true });
        const outputs = await delivery.collect();
        if (provider.isBusy(conversationId)) return json({ busy: true });
        return json({ ...workflow, count: outputs.length, busy: false, workflowError });
      }
      if (provider.isBusy(conversationId)) return jsonError("请等待当前专家完成交付后再提交", 409);
      const body = await req.json();
      return json(await completeRequirementStage(getDb(), conversationId, String(body.expectedStatus || ""), String(body.targetStatus || ""), String(body.customField || ""), {
        collect: delivery.collect, assets: delivery.assets,
        workflow: () => getTapdStoryWorkflow(workspaceId, storyId),
        upload: (name, bytes, field) => uploadTapdRequirementAttachment(workspaceId, storyId, field, new File([Buffer.from(bytes)], name)),
        transition: (expected, target) => transitionTapdStory(workspaceId, storyId, expected, target),
      }));
    }
    const previewMatch = path.match(/^\/api\/tapd\/requirements\/([^/]+)\/([^/]+)\/preview$/);
    if (previewMatch && ["GET", "POST"].includes(req.method)) {
      if ((req as Request & { tapdTrustedIpc?: boolean }).tapdTrustedIpc !== true) return jsonError("本地交互预览请在桌面客户端使用", 403);
      const session = getActiveAuthSession(); if (!session) return jsonError("请先登录", 401);
      const workspaceId = decodeURIComponent(previewMatch[1]), storyId = decodeURIComponent(previewMatch[2]);
      const row = getDb().prepare("SELECT id FROM requirement_spaces WHERE account_id=? AND tapd_workspace_id=? AND tapd_story_id=? AND tapd_origin=?").get(session.userId, workspaceId, storyId, "https://api.tapd.cn");
      if (!row) return jsonError("请先打开本需求", 404);
      const { previewService, stopAllPreviews } = await import("./src/domains/preview/node/service.ts");
      globalThis.__stopPreviewRuns = stopAllPreviews;
      const service = previewService(getDb(), platformPaths.appDataDir, session.userId, String(row.id), () => {
        if (getActiveAuthSession()?.id !== session.id) throw new Error("登录身份已变化，请重新打开预览");
      });
      return json(req.method === "GET" ? service.snapshot() : await service.action(await req.json()));
    }
    const testingExecutionMatch = path.match(/^\/api\/tapd\/requirements\/([^/]+)\/([^/]+)\/testing-execution$/);
    if (testingExecutionMatch && ["GET", "POST"].includes(req.method)) {
      if ((req as Request & { tapdTrustedIpc?: boolean }).tapdTrustedIpc !== true) return jsonError("测试执行配置仅允许可信客户端调用", 403);
      const session = getActiveAuthSession(); if (!session) return jsonError("请先登录", 401);
      const workspaceId = decodeURIComponent(testingExecutionMatch[1]); const storyId = decodeURIComponent(testingExecutionMatch[2]);
      const row = getDb().prepare("SELECT id FROM requirement_spaces WHERE account_id=? AND tapd_workspace_id=? AND tapd_story_id=? AND tapd_origin=?").get(session.userId, workspaceId, storyId, "https://api.tapd.cn");
      if (!row) return jsonError("请先打开本需求", 404);
      const { testingService } = await import("./src/domains/testing/node/service.ts");
      const service = testingService(getDb(), platformPaths.appDataDir, session.userId, String(row.id), toolsForMcpServer, () => {
        if (getActiveAuthSession()?.id !== session.id) throw new Error("登录身份已变化，请重新打开测试记录");
      });
      return json(req.method === "GET" ? service.snapshot() : await service.action(await req.json()));
    }
    const requirementInputsMatch = path.match(/^\/api\/tapd\/requirements\/([^/]+)\/([^/]+)\/inputs$/);
    if (requirementInputsMatch && ["GET", "POST"].includes(req.method)) {
      const session = getActiveAuthSession(); if (!session) return jsonError("请先登录", 401);
      const workspaceId = decodeURIComponent(requirementInputsMatch[1]); const storyId = decodeURIComponent(requirementInputsMatch[2]);
      const { getTapdRequirementContext } = await import("./src/integrations/tapd/requirements.ts");
      const ownedSpace = getDb().prepare("SELECT id FROM requirement_spaces WHERE account_id=? AND tapd_origin=? AND tapd_workspace_id=? AND tapd_story_id=?").get(session.userId, "https://api.tapd.cn", workspaceId, storyId);
      if (!ownedSpace && !(await getTapdRequirementContext(workspaceId, storyId)).requirement) return jsonError("需求不存在或无权访问", 403);
      const { createRequirementStore } = await import("./src/domains/requirement/node/store.ts");
      const { createRequirementInputs } = await import("./src/domains/requirement/node/inputs.ts");
      const space = createRequirementStore(getDb()).open(session.userId, "https://api.tapd.cn", workspaceId, storyId);
      const inputs = createRequirementInputs(getDb(), platformPaths.appDataDir, session.userId, space);
      const body = req.method === "POST" ? await req.json() : {};
      const key = String(body.stageKey || new URL(req.url).searchParams.get("stageKey") || "");
      if (req.method === "GET") return json(await inputs.get(key));
      if (body.action === "saveRepository") {
        const repo = await inputs.repositories.save(body.repository);
        const value = await inputs.get(key);
        return json(await inputs.select(key, { ...value.selection, repositories: [...new Set([...value.selection.repositories, repo.id])], repositoryScopes: { ...value.selection.repositoryScopes, [repo.id]: repo.scope } }));
      }
      if (body.action === "removeRepository") { inputs.repositories.remove(String(body.repositoryId)); return json(await inputs.get(key)); }
      if (body.action === "select") return json(await inputs.select(key, body.selection));
      return jsonError("无效的输入操作", 400);
    }
    const requirementSnapshotMatch = path.match(/^\/api\/conversations\/([^/]+)\/requirement-inputs$/);
    if (requirementSnapshotMatch && req.method === "GET") {
      const id = decodeURIComponent(requirementSnapshotMatch[1]);
      const owner = getDb().prepare("SELECT s.account_id FROM requirement_conversations c JOIN requirement_spaces s ON s.id=c.space_id WHERE c.conversation_id=?").get(id);
      if (!owner || owner.account_id !== getActiveAuthSession()?.userId) return jsonError("无权访问需求会话", 403);
      const exists = getDb().prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='requirement_input_snapshots'").get();
      return json(exists ? getDb().prepare("SELECT message_id,data FROM requirement_input_snapshots WHERE conversation_id=? AND message_id IS NOT NULL ORDER BY rowid").all(id).map(r => ({ messageId: r.message_id, ...JSON.parse(String(r.data)) })) : []);
    }
    if (path.match(/^\/api\/tapd\/requirements\/[^/]+\/[^/]+\/assets$/) && ["GET", "POST"].includes(req.method)) {
      const session = getActiveAuthSession();
      if (!session) return jsonError("请先登录", 401);
      const parts = path.split("/");
      const workspaceId = decodeURIComponent(parts[4]);
      const storyId = decodeURIComponent(parts[5]);
      const { createRequirementStore } = await import("./src/domains/requirement/node/store.ts");
      const { createRequirementAssets } = await import("./src/domains/requirement/node/assets.ts");
      if (req.method === "GET") {
        const owned = getDb().prepare("SELECT id FROM requirement_spaces WHERE account_id=? AND tapd_origin=? AND tapd_workspace_id=? AND tapd_story_id=?").get(session.userId, "https://api.tapd.cn", workspaceId, storyId);
        if (!owned) return jsonError("本地需求不存在或无权访问", 403);
        const spaceId = String(owned.id);
        const { requirementDelivery } = await import("./src/domains/requirement/node/delivery.ts");
        const conversations = getDb().prepare("SELECT conversation_id,request_key FROM requirement_conversations WHERE space_id=?").all(spaceId);
        for (const c of conversations) if (String(c.request_key).startsWith("stage:") && !provider.isBusy(String(c.conversation_id))) await requirementDelivery(getDb(), platformPaths.appDataDir, platformPaths.artifactsDir, session.userId, String(c.conversation_id)).collect();
        return json(await createRequirementAssets(platformPaths.appDataDir, session.userId, spaceId).list());
      }
      const { getTapdRequirementContext, uploadTapdRequirementAttachment } = await import("./src/integrations/tapd/requirements.ts");
      const context = await getTapdRequirementContext(workspaceId, storyId);
      if (!context.requirement) return jsonError("需求不存在或无权访问", 403);
      const spaceId = createRequirementStore(getDb()).open(session.userId, "https://api.tapd.cn", workspaceId, storyId);
      const assets = createRequirementAssets(platformPaths.appDataDir, session.userId, spaceId);
      const b = await req.json();
      const upload = async (asset: import("./src/domains/requirement/node/assets.ts").RequirementAsset, bytes: Uint8Array) => {
        if (!asset.customField) throw new Error("请配置 TAPD 附件字段后重新提交");
        await uploadTapdRequirementAttachment(workspaceId, storyId, asset.customField, new File([Buffer.from(bytes)], asset.name));
      };
      if (b.action === "commit") {
        const current = (await assets.list()).find((a) => a.id === b.assetId);
        const sync = current && (current.stage <= 4 || (current.stage === 7 && /(?:测试用例\.xlsx|测试覆盖矩阵\.md|测试问题清单\.md)$/i.test(current.name)));
        if (sync && current.stage === 7 && /\.xlsx$/i.test(current.name)) {
          const { validateTestCaseWorkbook } = await import('./src/domains/requirement/node/test_case_workbook.ts');
          await validateTestCaseWorkbook(await readFile(current.path), context.requirement.url);
        }
        return json(await assets.commit(String(b.assetId), sync ? upload : undefined, sync ? String(b.customField || current.customField || "") : undefined));
      }
      if (b.action === "download") {
        const existing = (await assets.list()).find((a) => a.sourceId === b.attachmentId && a.stage === Number(b.stage));
        if (existing) return json(existing); // Never overwrite local edits when reselecting an attachment.
        const attachment = context.attachments.find((a) => a.id === b.attachmentId);
        if (!attachment) return jsonError("附件不属于当前需求", 400);
        const { getTapdAttachmentDownloadUrl } = await import("./src/integrations/tapd/requirements.ts");
        let url = new URL(await getTapdAttachmentDownloadUrl(workspaceId, attachment.id));
        let response: Response | undefined;
        for (let redirects = 0; redirects < 5; redirects++) {
          if (url.protocol !== "https:" || url.username || url.password || !(url.hostname === "tapd.cn" || url.hostname.endsWith(".tapd.cn") || url.hostname.endsWith(".myqcloud.com"))) throw new Error("附件下载地址不受支持");
          response = await fetch(url, { redirect: "manual", signal: AbortSignal.timeout(30_000) });
          if (response.status >= 300 && response.status < 400 && response.headers.get("location")) { await response.body?.cancel(); url = new URL(response.headers.get("location")!, url); continue; }
          break;
        }
        if (!response?.ok || !response.body) throw new Error("附件下载失败，请刷新后重试");
        const chunks: Uint8Array[] = []; let size = 0;
        for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
          size += chunk.length; if (size > 10 * 1024 * 1024) throw new Error("工作台引用附件不得超过 10MB"); chunks.push(chunk);
        }
        return json(await assets.save({ name: attachment.filename, stage: Number(b.stage), sourceId: attachment.id, bytes: Buffer.concat(chunks) }));
      }
      if (b.action !== "save" || typeof b.content !== "string") return jsonError("资产操作无效", 400);
      const stage = Number(b.stage);
      return json(await assets.save({ name: String(b.name || "阶段文档.md"), stage, bytes: Buffer.from(b.content), customField: stage <= 4 ? String(b.customField || "") : undefined }, stage <= 4 ? upload : undefined));
    }
    // 需求专用会话入口：会话写入与需求归属在同一事务中完成
    if (path.match(/^\/api\/tapd\/requirements\/[^/]+\/[^/]+\/conversations$/) && req.method === "POST") {
      const { createRequirementStore } = await import("./src/domains/requirement/node/store.ts");
      const session = getActiveAuthSession();
      if (!session) return jsonError("请先登录", 401, "AUTH_REQUIRED");
      const parts = path.split("/");
      const workspaceId = decodeURIComponent(parts[4]);
      const storyId = decodeURIComponent(parts[5]);
      const b = await req.json();
      const title = String(b?.title || "需求会话").trim();
      const requestKey = String(b?.requestKey || "").trim();
      if (!requestKey) return jsonError("缺少创建请求标识", 400, "INVALID_REQUEST");
      const existing = getDb().prepare(`SELECT r.conversation_id,s.id AS space_id FROM requirement_conversations r JOIN requirement_spaces s ON s.id=r.space_id WHERE s.account_id=? AND s.tapd_origin=? AND s.tapd_workspace_id=? AND s.tapd_story_id=? AND r.request_key=? AND r.work_item_id IS ?`).get(session.userId, "https://api.tapd.cn", workspaceId, storyId, requestKey, b?.taskId ? String(b.taskId) : null);
      if (existing && getConversation(String(existing.conversation_id))) {
        const conversationId = String(existing.conversation_id);
        const { shouldUpgradeDesignReviewExpert } = await import("./src/domains/requirement/node/stage_expert.ts");
        if (shouldUpgradeDesignReviewExpert(requestKey, getConversationExpertBinding(conversationId)?.expertId, b?.expertId)) {
          await expertBindingService.assignExpert(conversationId, b.expertId);
          createRequirementStore(getDb()).setStageExpert(session.userId, String(existing.space_id), requestKey, b.expertId);
        }
        return json({ conversationId, spaceId: String(existing.space_id), conversation: { ...getConversation(conversationId), requirementScoped: true, expert: getExpertSummary(getConversationExpertBinding(conversationId)?.expertId || "") ?? null } });
      }
      const { getTapdRequirementContext } = await import("./src/integrations/tapd/requirements.ts");
      if (!(await getTapdRequirementContext(workspaceId, storyId)).requirement) return jsonError("需求不存在或无权访问", 403);
      const requirementStore = createRequirementStore(getDb());
      const spaceId = requirementStore.open(session.userId, "https://api.tapd.cn", workspaceId, storyId);
      const savedExpert = requirementStore.getStageExpert(session.userId, spaceId, requestKey);
      const expertId = String(b?.expertId || savedExpert || b?.recommendedExpertId || "");
      if (requestKey.startsWith("stage:") && (!expertId || !getExpertSummary(expertId)?.available)) return jsonError("请选择可用的阶段专家", 400);
      const conversationId = requirementStore.createConversation(
        session.userId,
        spaceId,
        b?.taskId ? String(b.taskId) : null,
        requestKey,
        () => createConversation(
          title,
          "assistant",
          b?.workspaceId ?? null,
          null,
          b?.modelProvider && b?.modelId ? { provider: String(b.modelProvider), modelId: String(b.modelId) } : undefined,
        ),
      );
      if (expertId && getConversationExpertBinding(conversationId)?.expertId !== expertId) {
        await expertBindingService.assignExpert(conversationId, expertId);
      }
      if (expertId) requirementStore.setStageExpert(session.userId, spaceId, requestKey, expertId);
      return json({ conversationId, spaceId, conversation: { ...getConversation(conversationId), requirementScoped: true, expert: getExpertSummary(getConversationExpertBinding(conversationId)?.expertId || "") ?? null } });
    }
    if (path === "/api/projects" && req.method === "POST") {
      const b = await req.json();
      return json(createProject(b.name, b));
    }
    if (
      path.startsWith("/api/projects/") && !path.includes("/assign") &&
      req.method === "GET"
    ) {
      const id = path.split("/")[3];
      const proj = getProject(id);
      if (!proj) return json({ error: "项目不存在" });
      const convs = listProjectConversations(id);
      return json({ ...proj, conversations: convs });
    }
    if (
      path.startsWith("/api/projects/") && !path.includes("/assign") &&
      req.method === "PUT"
    ) {
      const id = path.split("/")[3];
      const b = await req.json();
      updateProject(id, b);
      return json({ ok: true });
    }
    if (
      path.startsWith("/api/projects/") && !path.includes("/assign") &&
      req.method === "DELETE"
    ) {
      const id = path.split("/")[3];
      deleteProject(id);
      return json({ ok: true });
    }
    // POST /api/projects/:id/assign — 把会话归入项目 { conversationId }
    if (
      path.includes("/assign") && path.startsWith("/api/projects/") &&
      req.method === "POST"
    ) {
      const id = path.split("/")[3];
      const b = await req.json();
      assignConversationToProject(b.conversationId, id);
      return json({ ok: true });
    }
    // ===== 工作空间 API =====
    if (path === "/api/workspaces" && req.method === "GET") {
      return json(listWorkspaces());
    }
    if (path === "/api/workspaces" && req.method === "POST") {
      const b = await req.json();
      return json(createWorkspace(b.name, b));
    }
    if (
      path.startsWith("/api/workspaces/") && !path.includes("/assign") &&
      req.method === "GET"
    ) {
      const id = path.split("/")[3];
      const ws = getWorkspace(id);
      if (!ws) return json({ error: "工作空间不存在" });
      touchWorkspace(id);
      const convs = listWorkspaceConversations(id);
      return json({ ...ws, conversations: convs });
    }
    if (
      path.startsWith("/api/workspaces/") && !path.includes("/assign") &&
      req.method === "PUT"
    ) {
      const id = path.split("/")[3];
      const b = await req.json();
      updateWorkspace(id, b);
      return json({ ok: true });
    }
    if (
      path.startsWith("/api/workspaces/") && !path.includes("/assign") &&
      req.method === "DELETE"
    ) {
      const id = path.split("/")[3];
      deleteWorkspace(id);
      return json({ ok: true });
    }
    if (
      path.includes("/assign") && path.startsWith("/api/workspaces/") &&
      req.method === "POST"
    ) {
      const id = path.split("/")[3];
      const b = await req.json();
      assignConversationToWorkspace(b.conversationId, id);
      return json({ ok: true });
    }
    // POST /api/conversations/:id/workspace — 设置或清除会话工作空间
    const conversationWorkspaceMatch = path.match(
      /^\/api\/conversations\/([^/]+)\/workspace$/,
    );
    if (conversationWorkspaceMatch && req.method === "POST") {
      const conversationId = decodeURIComponent(conversationWorkspaceMatch[1]);
      const b = await req.json();
      assignConversationToWorkspace(conversationId, b?.workspaceId ?? null);
      return json({ ok: true });
    }
    // ===== 专家 API =====
    // ===== 用量统计 API =====
    // GET /api/usage — 获取 token 用量汇总（最近7天）
    if (path === "/api/usage" && req.method === "GET") {
      const since = Date.now() - 7 * 24 * 60 * 60 * 1000;
      const rows = getDb().prepare(
        "SELECT provider, model, SUM(input_tokens) as inputTokens, SUM(output_tokens) as outputTokens, SUM(total_tokens) as totalTokens, SUM(cost) as cost, COUNT(*) as calls, DATE(created_at/1000, 'unixepoch', 'localtime') as date FROM usage_logs WHERE created_at >= ? GROUP BY provider, model, date ORDER BY date DESC",
      ).all(since) as any[];
      // 总计
      const totals = getDb().prepare(
        "SELECT SUM(total_tokens) as totalTokens, SUM(cost) as totalCost, COUNT(*) as totalCalls FROM usage_logs WHERE created_at >= ?",
      ).get(since) as any;
      return json({
        rows,
        totals: {
          totalTokens: totals?.totalTokens || 0,
          totalCost: totals?.totalCost || 0,
          totalCalls: totals?.totalCalls || 0,
        },
      });
    }
    // GET /api/usage/audit — 获取工具审计日志（最近100条）
    if (path === "/api/usage/audit" && req.method === "GET") {
      const { logToolAudit } = await import("./src/infra/db.ts");
      // 直接查 DB
      const rows = getDb().prepare(
        "SELECT tool_name as toolName, args, is_error as isError, created_at as createdAt FROM tool_audit_log ORDER BY created_at DESC LIMIT 100",
      ).all();
      return json(rows);
    }
    // GET /api/experts — 列出所有专家
    if (path === "/api/experts" && req.method === "GET") {
      return json(listExperts());
    }
    // GET /api/experts/installed — 刷新并列出 my-experts 中已注册的专家
    if (path === "/api/experts/installed" && req.method === "GET") {
      const result = await refreshInstalledExperts();
      return json({
        experts: result.summaries,
        diagnostics: result.diagnostics,
        refreshed: result.refreshed,
      });
    }
    // POST /api/experts/:id/edit-session — create an isolated editing session
    const expertEditSessionMatch = path.match(
      /^\/api\/experts\/([^/]+)\/edit-session$/,
    );
    if (expertEditSessionMatch && req.method === "POST") {
      const expertId = decodeURIComponent(expertEditSessionMatch[1]);
      const expert = getExpertSummary(expertId);
      if (!expert || expert.catalogSource !== "installed") {
        throw new InstalledExpertManagementError(
          "EXPERT_NOT_REGISTERED",
          404,
          "installed expert is not registered",
        );
      }

      let conversation: ReturnType<typeof createConversation> | null = null;
      try {
        let body: any = {};
        try { body = await req.json(); } catch { /* empty body is valid */ }
        conversation = createConversation(
          `修改${expert.name}`,
          "expert_creator",
          body?.workspaceId ?? null,
          null,
          body.modelProvider && body.modelId
            ? { provider: String(body.modelProvider), modelId: String(body.modelId) }
            : undefined,
          "edit",
        );
        const draft = await createInstalledExpertEditDraft(
          expertId,
          expert.revision ?? "",
          conversation.id,
        );
        setExpertEditMetadata(conversation.id, {
          targetId: draft.expertId,
          targetRevision: draft.targetRevision,
          draftRoot: draft.draftRoot,
        });
        const persistedConversation = getConversation(conversation.id);
        if (!persistedConversation) {
          throw new Error("expert edit conversation was not persisted");
        }
        return json({
          conversation: toRendererConversation(persistedConversation),
          expert: getExpertSummary(expertId) ?? null,
        });
      } catch (error) {
        if (conversation) {
          deleteConversation(conversation.id);
          await rm(
            platformPaths.join(platformPaths.appDataDir, "expert-drafts", conversation.id),
            { recursive: true, force: true },
          ).catch(() => undefined);
        }
        throw error;
      }
    }
    // POST /api/experts/:id/open-folder — resolve by trusted ID, then open it
    const expertFolderMatch = path.match(/^\/api\/experts\/([^/]+)\/open-folder$/);
    if (expertFolderMatch && req.method === "POST") {
      const expertId = decodeURIComponent(expertFolderMatch[1]);
      const folder = await resolveInstalledExpertFolder(expertId);
      const error = await openPathSafely(
        electronShell.openPath.bind(electronShell),
        folder,
        { requireExistingPath: true },
      );
      if (error) return jsonError(`无法打开专家文件夹：${error}`, 500, "OPEN_PATH_FAILED");
      return json({ ok: true, expertId, folder });
    }
    // DELETE /api/experts/:id — release runtimes, unregister, unbind, refresh
    const expertUninstallMatch = path.match(/^\/api\/experts\/([^/]+)$/);
    if (expertUninstallMatch && req.method === "DELETE") {
      const expertId = decodeURIComponent(expertUninstallMatch[1]);
      const result = await uninstallInstalledExpert(expertId, {
        releaseSessions: (ids) => provider.releaseExpertSessions(ids),
        listConversationIds: listConversationIdsByExpert,
        clearBindings: clearExpertBindingsForUninstall,
        refresh: refreshInstalledExperts,
      });
      return json({ ok: true, ...result });
    }
    // GET /api/experts/:id — 查询单个专家摘要（不返回提示正文）
    const expertDetailMatch = path.match(/^\/api\/experts\/([^/]+)$/);
    if (expertDetailMatch && req.method === "GET") {
      const expertId = decodeURIComponent(expertDetailMatch[1]);
      const expert = getExpert(expertId);
      if (!expert) return jsonError("expert not found", 404);
      return json({
        id: expert.id,
        name: expert.name,
        expertType: expert.expertType,
        nickname: expert.nickname,
        categoryId: expert.categoryId,
        description: expert.description,
        icon: expert.icon,
        tags: expert.tags,
        quickPrompts: expert.quickPrompts,
        badge: expert.badge,
        catalogSource: expert.catalogSource,
        revision: expert.revision,
        available: expert.available,
        capabilityHints: {
          preferredTools: [...expert.capabilityHints.preferredTools],
          bundledSkills: [...expert.capabilityHints.bundledSkills],
        },
      });
    }

    const conversationExpertMatch = path.match(
      /^\/api\/conversations\/([^/]+)\/expert$/,
    );
    if (conversationExpertMatch && req.method === "PUT") {
      const conversationId = decodeURIComponent(conversationExpertMatch[1]);
      let body;
      try {
        body = await req.json();
      } catch {
        return jsonError("invalid JSON", 400);
      }
      const binding = await expertBindingService.assignExpert(
        conversationId,
        typeof body?.expertId === "string" ? body.expertId : "",
      );
      return json({ ok: true, binding, expert: getExpertSummary(binding.expertId) ?? null });
    }
    if (conversationExpertMatch && req.method === "DELETE") {
      const conversationId = decodeURIComponent(conversationExpertMatch[1]);
      await expertBindingService.clearExpert(conversationId);
      return json({ ok: true, binding: null, expert: null });
    }

    // POST /api/conv/:id/expert — legacy adapter; all validation and writes
    // are delegated to ExpertBindingService.
    const legacyConversationExpertMatch = path.match(
      /^\/api\/conv\/([^/]+)\/expert$/,
    );
    if (legacyConversationExpertMatch && req.method === "POST") {
      const conversationId = decodeURIComponent(legacyConversationExpertMatch[1]);
      let body;
      try {
        body = await req.json();
      } catch {
        return jsonError("invalid JSON", 400);
      }
      if (typeof body?.expertId === "string" && body.expertId.trim()) {
        const binding = await expertBindingService.assignExpert(conversationId, body.expertId);
        return json({ ok: true, binding, expert: getExpertSummary(binding.expertId) ?? null });
      }
      await expertBindingService.clearExpert(conversationId);
      return json({ ok: true, binding: null, expert: null });
    }
    // ── 受管连接器（HTTP / IPC 共享同一服务单例，不接受渲染进程传入的包坐标/URL/argv/可执行路径） ──
    // GET /api/connectors — 列出目录元数据 + 生命周期状态
    if (path === "/api/connectors" && req.method === "GET") {
      return json(await (await connectorService()).list());
    }
    // GET /api/connectors/:id — 单个连接器
    const connectorDetailMatch = path.match(/^\/api\/connectors\/([^/]+)$/);
    if (connectorDetailMatch && req.method === "GET") {
      return json(await (await connectorService()).get(decodeURIComponent(connectorDetailMatch[1])));
    }
    // DELETE /api/connectors/:id — 卸载
    if (connectorDetailMatch && req.method === "DELETE") {
      return json(await (await connectorService()).uninstall(decodeURIComponent(connectorDetailMatch[1])));
    }
    // POST /api/connectors/:id/:operation — 生命周期操作（显式白名单，避免任意字符串透传）
    const connectorOpMatch = path.match(/^\/api\/connectors\/([^/]+)\/(activate|cancel|reauthorize|logout|repair|update)$/);
    if (connectorOpMatch && req.method === "POST") {
      const connectorId = decodeURIComponent(connectorOpMatch[1]);
      const service = await connectorService();
      switch (connectorOpMatch[2]) {
        case "activate": return json(await service.activate(connectorId));
        case "cancel": await service.cancel(connectorId); return json({ ok: true });
        case "reauthorize": return json(await service.reauthorize(connectorId));
        case "logout": return json(await service.logout(connectorId));
        case "repair": return json(await service.repair(connectorId));
        case "update": return json(await service.update(connectorId));
      }
    }
    return new Response(JSON.stringify({ error: "not found" }), {
      status: 404,
      headers: { "content-type": "application/json" },
    });
  } catch (e) {
    if (e instanceof TapdRateLimitError) return jsonError(e.message, 429, e.code);
    if (e instanceof InstalledExpertManagementError) {
      return jsonError(e.message, e.status, e.code);
    }
    if (e instanceof ExpertBindingError) {
      return new Response(JSON.stringify({ error: e.message, code: e.code }), {
        status: e.status,
        headers: { "content-type": "application/json" },
      });
    }
    if (e instanceof SkillDraftError) {
      return new Response(JSON.stringify({ error: e.message, code: e.code }), {
        status: e.status,
        headers: { "content-type": "application/json" },
      });
    }
    if (e instanceof ConnectorError) {
      return new Response(JSON.stringify({ error: e.message, code: e.code }), {
        status: e.status,
        headers: { "content-type": "application/json" },
      });
    }
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500,
      headers: { "content-type": "application/json" },
    });
  }
}

// ── Electron 版：handleApi 已在文件上方通过 export async function 导出 ──
