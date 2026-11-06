import { sessionRuntimeKey } from "./session_runtime_key.ts";
import { updateGate } from "../infra/update-gate.ts";
import { stat } from "node:fs/promises";
// src/agent/provider.ts
// AgentProvider 抽象 + LocalPiProvider（Pi 1.0 原生 SDK）。
// 对照 03 文档 §2.2：吸收 参考设计 双模式发现，抽象出 AgentProvider 接口，
// LocalPiProvider 在 Electron 内置 Node.js 中运行。

import type {
  AgentEvent,
  AgentTool,
} from "@earendil-works/pi-agent-core";
export type { AgentEvent };
import { loadSkillsFromDir, type Skill } from "@earendil-works/pi-coding-agent";
import type { PromptResources } from "./prompt-runtime/types.ts";
import { createPiSession, disposePiSession, type NativeAgentSession } from "./engine.ts";
import type { SessionManager } from "../vendor/pi_coding_agent.ts";
import {
  SessionManager as PiSessionManager,
} from "../vendor/pi_coding_agent.ts";
import { buildExpertRuntimeProfile } from "./experts/runtime_profile.ts";
import type { ExpertRuntimeProfile } from "./experts/runtime_profile.ts";
import { logExpertEvent } from "./experts/observability.ts";
import { loadPromptTemplateResources, loadSkillResources } from "./skills.ts";
import { getDb } from "../infra/db.ts";
import { setConversationExpertBinding } from "../domains/session/node/expert_binding_store.ts";
import { listArtifacts } from "../domains/artifact/node/store.ts";
import {
  appendAssistantMessageFromAgent,
  appendMessage,
  getCoreSessionPath,
  getMessages,
  setCoreSessionPath,
  updateConversationModel,
  updateConversationStatus,
} from "../domains/session/node/store.ts";
import {
  getProviderModels,
} from "./models.ts";
import { resolveModelCapabilities } from "./model_capabilities.ts";
import {
  compactHistoryForBudget,
  estimateContextBudget,
  formatContextCapacityMessage,
  shouldAttemptHistoryCompaction,
} from "./context_budget.ts";
import { normalizeModelId } from "./model_defaults.ts";
import {
  type ConnectorSessionContext,
  sessionContext,
} from "../infra/context.ts";
import { startOperation } from "../infra/operation_log.ts";
import { sessionFallbackArtifactDir } from "./session_output_path.ts";
import { creatorContextForConversation } from "./skill_creator_context.ts";
import { expertManagerContextForConversation } from "./expert_manager_context.ts";
import { resolveSelectedExpertSkills } from "./expert_selected_skills.ts";
import { recoveryPresentationEvent } from "./recovery_presentation.ts";
import { assistantMessageText, didAssistantResponseFail } from "./history.ts";
import { TaskRunCoordinator } from "./long_task.ts";
import {
  type ArtifactRequirement,
  inferTurnArtifactRequirement,
} from "./artifact_verification.ts";
import { resolveSessionRoot, type SessionRoot } from "./session_root.ts";
import {
  createDefaultProtectedPathPolicy,
  type ProtectedPathPolicy,
} from "../platform/path_policy.ts";
import { platformPaths } from "../platform/paths.ts";
import { currentPlatform } from "../platform/runtime.ts";
import { resolveSessionIntent } from "./prompt-runtime/session-intent.ts";
import { resolveRuntimeProfile } from "./prompt-runtime/runtime-profile.ts";
import { resolveToolPolicy } from "./prompt-runtime/tool-policy.ts";
import { getTools, refreshConnectorDelegateTools } from "./tools/index.ts";
import { resolvePermissionPolicy } from "./prompt-runtime/permission-policy.ts";
import { resolveTurnIntent } from "./prompt-runtime/turn-intent.ts";
import { buildPromptRuntimeEnvelope } from "./prompt-runtime/runtime.ts";
import { EnvironmentSource } from "./prompt-runtime/sources/environment.ts";
import { WorkspaceSource } from "./prompt-runtime/sources/workspace.ts";
import { SettingsSource } from "./prompt-runtime/sources/settings.ts";
import { MemorySource } from "./prompt-runtime/sources/memory.ts";
import { buildSkillContext } from "./prompt-runtime/sources/skills.ts";
import { buildExpertContext } from "./prompt-runtime/sources/expert.ts";
import {
  buildCapabilityContext,
  capabilityActivationContextFromProfile,
} from "./prompt-runtime/sources/capabilities.ts";
import { TurnContextSource } from "./prompt-runtime/sources/turn-context.ts";
import { sourceResult } from "./prompt-runtime/sources/base.ts";
import type { SnapshotSource } from "./prompt-runtime/context-assembler.ts";
import type {
  AttachmentContextItem,
  ConnectorChildRef,
  ConnectorContextItem,
  FileReferenceContext,
  PromptEnvelope,
  ResolvedPermissionPolicy,
  SubagentChildRef,
  TurnIntent,
} from "./prompt-runtime/types.ts";
import {
  type Memory,
  recallMemories,
  recallWorkingMemory,
} from "../domains/memory/node/store.ts";
import { getSetting } from "../domains/settings/node/store.ts";
import { fileURLToPath } from "node:url";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { release as osRelease } from "node:os";
import { searchChunks } from "../domains/rag/node/store.ts";
import { buildPromptImages } from "./prompt-images.ts";

/** 执行模式：Ask=仅问答 / Plan=先方案 / Craft=直接执行 */
export type RunMode = "ask" | "plan" | "craft";

/** 权限级别（三层模型，对标 参考设计）：
 * - readonly (L1)：只读，所有写工具被拦截
 * - default  (L2)：写工具需确认（兼容旧值）
 * - full     (L3)：完全自动，不确认（兼容旧值）
 */
export type PermLevel = "L1" | "L2" | "L3" | "readonly" | "default" | "full";

/** 单次 prompt 的选项（由 UI 传入） */
export interface PromptOptions {
  /** Backend-owned scope, never accepted from the renderer's prompt payload. */
  projectScoped?: boolean;
  mode: RunMode;
  permission: PermLevel;
  /** Explicit file-delivery contract takes precedence over request inference. */
  artifactRequirement?: ArtifactRequirement;
  /** Original user input before host context is appended. */
  userRequest?: string;
  modelProvider?: string;
  modelId?: string;
  /** 当前任务显式选择的 MCP 工具；不会跨连接器全局注入。 */
  mcpTools?: AgentTool[];
  /** Expert 创建任务按用户选择顺序传递的业务技能名称。 */
  selectedSkillNames?: string[];
  /** Expert 创建任务中选中的参考专家。 */
  selectedExpertId?: string;
  attachments?: AttachmentContextItem[];
  fileReferences?: FileReferenceContext[];
  connectorContext?: ConnectorContextItem[];
  /** 连接器子会话的结构化绑定：存在时本轮以 connector-agent 类别运行。 */
  connector?: ConnectorChildRef;
  /** 标准子代理子会话绑定。 */
  subagent?: SubagentChildRef;
  /** 子会话运行时的连接器命令上下文（注入 sessionContext，供 CLI 网关解析）。 */
  connectorCommandContext?: ConnectorSessionContext;
}

/** AgentProvider 契约：所有 agent 后端实现此接口 */
export interface AgentProvider {
  readonly id: "local" | "cloud";
  /** 发起一次 prompt（带模式/权限） */
  prompt(
    sessionId: string,
    text: string,
    opts?: PromptOptions,
    beforeExecute?: () => void | Promise<void>,
    onInitializationFailure?: () => void | Promise<void>,
  ): Promise<void>;
  /** 中途插话 */
  steer(sessionId: string, msg: string): Promise<void>;
  /** 中止当前 */
  abort(sessionId: string): Promise<void>;
  /** 订阅某会话的事件流 */
  onEvent(sessionId: string, cb: (e: AgentEvent) => void): Promise<() => void>;
  /** 向某会话广播一个事件（供外部注入非 agent 事件，如工具确认请求 tool_confirmation） */
  emitEvent(sessionId: string, event: AgentEvent): void;
  /** 销毁某会话 */
  dispose(sessionId: string): Promise<void>;
  /** 重新加载某会话的运行时专家配置（只允许空闲会话） */
  reloadProfile(sessionId: string): Promise<void>;
  /** Release expert-bound runtimes while retaining listeners and persistent history. */
  releaseExpertSessions(sessionIds: readonly string[]): Promise<void>;
}

/**
 * A profile switch cannot invalidate a session while it is being initialized
 * or while a prompt is queued.  Callers can use the stable code to surface a
 * conflict (for example, as HTTP 409) without depending on the message text.
 */
export class ExpertSwitchBusyError extends Error {
  readonly code = "EXPERT_SWITCH_BUSY" as const;

  constructor(sessionId: string) {
    super(`EXPERT_SWITCH_BUSY: session ${sessionId} is busy`);
    this.name = "ExpertSwitchBusyError";
  }
}

/** Stable error returned when an expert runtime cannot be drained safely. */
export class ExpertRuntimeReleaseError extends Error {
  readonly code = "EXPERT_RUNTIME_RELEASE_FAILED" as const;
  readonly status = 409;

  constructor(sessionId: string, cause?: unknown) {
    super(
      `EXPERT_RUNTIME_RELEASE_FAILED: session ${sessionId} could not be safely released`,
      { cause },
    );
    this.name = "ExpertRuntimeReleaseError";
  }
}

/**
 * A persisted expert binding must not silently turn into a normal session
 * when its prompt cannot be reconstructed during startup.  Keep the visible
 * message bounded; the original resolver failure is retained only as cause
 * for process-local diagnostics.
 */
export class ExpertInitializationError extends Error {
  readonly code = "EXPERT_INITIALIZATION_FAILED" as const;

  constructor(expertId: string, cause?: unknown) {
    super(`EXPERT_INITIALIZATION_FAILED: expert ${expertId} is unavailable`, {
      cause,
    });
    this.name = "ExpertInitializationError";
  }
}

interface ConversationRootDb {
  prepare(sql: string): { get(...params: unknown[]): unknown };
}

export async function resolveConversationSessionRoot(
  sessionId: string,
  options: { db?: ConversationRootDb; artifactsDir?: string } = {},
): Promise<SessionRoot> {
  const db = options.db ?? getDb();
  const row = db.prepare(
    `SELECT w.dir_path AS workspace_path
       FROM conversations c
       LEFT JOIN workspaces w ON w.id = c.workspace_id
      WHERE c.id = ?`,
  ).get(sessionId) as { workspace_path?: string | null } | undefined;
  return await resolveSessionRoot({
    workspacePath: row?.workspace_path,
    artifactsDir: sessionFallbackArtifactDir(
      options.artifactsDir ?? platformPaths.artifactsDir,
      sessionId,
      process.platform === "win32" ? "windows" : "posix",
    ),
  });
}

interface SessionEntry {
  runtimeKey?: string;
  session: NativeAgentSession;
  sessionManager: SessionManager;
  systemPrompt: string;
  listeners: Set<(e: AgentEvent) => void>;
  permissionPolicy?: ResolvedPermissionPolicy;
  toolCallGuard?: (
    toolName: string,
    input: unknown,
  ) => { block: true; reason: string } | undefined;
  runController?: AbortController;
  /** 最近一次 prompt 的选项（mode/permission） */
  lastOpts: PromptOptions;
  sessionRoot?: SessionRoot;
  protectedPathPolicy?: ProtectedPathPolicy;
}

export async function openNativeSessionManager(
  sessionId: string,
  cwd: string,
): Promise<SessionManager> {
  const existingPath = getCoreSessionPath(sessionId);
  const nativeSessionDir = join(
    platformPaths.appDataDir,
    "pi-agent",
    "sessions",
  );
  const create = () => {
    const manager = PiSessionManager.create(cwd, nativeSessionDir, {
      id: sessionId,
    });
    const path = manager.getSessionFile();
    if (path) setCoreSessionPath(sessionId, path);
    return manager;
  };
  if (!existingPath) return create();
  const resolvedPath = resolve(existingPath);
  const offset = relative(resolve(nativeSessionDir), resolvedPath);
  if (offset && offset !== ".." && !offset.startsWith(`..${sep}`) && !isAbsolute(offset)) {
    try {
      await stat(resolvedPath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      // Pi defers creating a file until the first conversation message.
      // Recreate only empty conversations; never silently discard lost history.
      if (getMessages(sessionId).length > 0) {
        throw new Error(`会话 ${sessionId} 的 Pi 会话文件不存在，已保留历史记录，未重置上下文。`);
      }
      return create();
    }
    // The database owns the conversation-to-file mapping. Pi's internal ID
    // is independent, including for existing sessions and native branches.
    return PiSessionManager.open(resolvedPath, dirname(resolvedPath), cwd);
  }

  throw new Error("当前会话不是 Pi 原生会话，请新建会话；原历史记录和文件保持不变。");
}

async function withRetrievedDocuments(
  envelope: PromptEnvelope,
  cwd: string,
): Promise<string> {
  if (!envelope.activeToolNames.includes("rag_query")) {
    return envelope.userPrompt;
  }
  const query = envelope.userPrompt.trim();
  if (query.length < 8) return envelope.userPrompt;
  try {
    const chunks = await searchChunks(query, cwd, 5);
    if (chunks.length === 0) return envelope.userPrompt;
    const context = chunks.map((chunk, index) =>
      `[${index + 1}] ${chunk.docPath}#${chunk.chunkIndex}\n${chunk.text}`
    ).join("\n\n");
    return `${envelope.userPrompt}\n\n<retrieved_documents>\n${context}\n</retrieved_documents>`;
  } catch (error) {
    console.warn(`[rag] 自动检索注入失败，继续原始请求：${String(error)}`);
    return envelope.userPrompt;
  }
}

/** 默认选项 */
const DEFAULT_OPTS: PromptOptions = { mode: "craft", permission: "default" };
const PROMPT_ROOT = fileURLToPath(
  new URL("../../resources/prompts/v2/", import.meta.url),
);

interface PromptConversationRow {
  category?: string | null;
  modelProvider?: string | null;
  modelId?: string | null;
  workspacePath?: string | null;
  expertId?: string | null;
  expertRevision?: string | null;
  expertCatalogSource?: string | null;
  expertOperation?: "create" | "edit" | null;
  expertTargetId?: string | null;
  expertTargetRevision?: string | null;
  skillOperation?: "create" | "edit" | null;
  skillTargetName?: string | null;
}

function loadPromptConversation(sessionId: string): PromptConversationRow {
  return (getDb().prepare(
    `SELECT c.category,
            c.model_provider AS modelProvider,
            c.model_id AS modelId,
            w.dir_path AS workspacePath,
            c.expert_id AS expertId,
            c.expert_revision AS expertRevision,
            c.expert_catalog_source AS expertCatalogSource,
            c.expert_operation AS expertOperation,
            c.expert_target_id AS expertTargetId,
            c.expert_target_revision AS expertTargetRevision,
            c.skill_operation AS skillOperation,
            c.skill_target_name AS skillTargetName
       FROM conversations c
       LEFT JOIN workspaces w ON w.id = c.workspace_id
      WHERE c.id = ?`,
  ).get(sessionId) ?? {}) as PromptConversationRow;
}

/**
 * 连接器子会话的 Skill 资源：读安装根下 skill/SKILL.md 并解析 frontmatter name。
 * 子会话不加载用户/内置技能，只暴露连接器自带的指令。
 */
function connectorChildSkills(ref: ConnectorChildRef): Skill[] {
  try {
    return loadSkillsFromDir({ dir: join(ref.installedVersionRoot, "skill"), source: "path" }).skills;
  } catch (cause) {
    console.warn(`[connector] 读取 ${ref.connectorId} SKILL.md 失败:`, cause);
    return [];
  }
}

function memoryContext(memory: Memory) {
  return {
    id: memory.id,
    content: memory.content,
    createdAt: new Date(memory.createdAt).toISOString(),
    updatedAt: new Date(memory.updatedAt).toISOString(),
  };
}

async function resolveExpertProfile(
  row: PromptConversationRow,
  availableToolNames: readonly string[],
  availableSkillNames: readonly string[],
): Promise<ExpertRuntimeProfile | undefined> {
  const expertId = row.expertId?.trim();
  if (!expertId) return undefined;
  try {
    const { getExpert, resolveExpertPromptById } = await import("./experts.ts");
    const manifest = getExpert(expertId);
    const resolvedPrompt = await resolveExpertPromptById(
      expertId,
      row.expertRevision ?? undefined,
    );
    if (!resolvedPrompt) throw new ExpertInitializationError(expertId);
    const runtimeManifest = manifest
      ? {
        ...manifest,
        revision: resolvedPrompt.revision,
        ...(row.expertCatalogSource
          ? {
            catalogSource: row.expertCatalogSource as
              | "builtin"
              | "installed"
              | "catalog",
          }
          : {}),
      }
      : {
        id: expertId,
        name: expertId,
        expertType: "agent" as const,
        categoryId: "uncategorized",
        description: "",
        icon: "",
        tags: [],
        quickPrompts: [],
        catalogSource: (row.expertCatalogSource ?? "builtin") as
          | "builtin"
          | "installed"
          | "catalog",
        revision: resolvedPrompt.revision,
        available: true,
        prompt: { maxBytes: 128 * 1024 },
        guidelines: [],
        capabilityHints: { preferredTools: [], bundledSkills: [] },
      };
    return buildExpertRuntimeProfile({
      manifest: runtimeManifest,
      resolvedPrompt,
      availableTools: new Set(availableToolNames),
      availableSkills: new Set(availableSkillNames),
    });
  } catch (error) {
    if (error instanceof ExpertInitializationError) throw error;
    throw new ExpertInitializationError(expertId, error);
  }
}

function valueSource(
  key: SnapshotSource["key"],
  id: string,
  value: unknown,
): SnapshotSource {
  return { key, id, collect: async () => sourceResult(value) };
}

/**
 * LocalPiProvider：pi Agent 在 Deno runtime 直跑。
 * spike 验证：new Agent({...}) + 真实 LLM 流式对话全通过。
 *
 * 每个 sessionId 对应一个独立的 pi Agent 实例（独立对话历史）。
 */
export class LocalPiProvider implements AgentProvider {
  readonly id = "local" as const;
  private sessions = new Map<string, SessionEntry>();
  /** attachPersistence 幂等：同一会话只挂一次监听（自动化触发可能重复调用）。 */
  private persistenceAttached = new Set<string>();
  private initializing = new Map<string, Promise<SessionEntry>>();
  /** Profile invalidation in progress; prevents prompts from reusing stale entries. */
  private reloading = new Set<string>();
  private sessionGenerations = new Map<string, number>();
  private disposedSessions = new Set<string>();
  /** Sessions whose current turn was explicitly cancelled by the UI. */
  private abortRequested = new Set<string>();
  private promptQueues = new Map<string, Promise<void>>();
  private sessionListeners = new Map<
    string,
    Set<(e: AgentEvent) => void>
  >();

  isBusy(sessionId: string): boolean {
    return this.initializing.has(sessionId) || this.promptQueues.has(sessionId) || this.reloading.has(sessionId);
  }

  private listenersForSession(
    sessionId: string,
  ): Set<(e: AgentEvent) => void> {
    let listeners = this.sessionListeners.get(sessionId);
    if (!listeners) {
      listeners = new Set();
      this.sessionListeners.set(sessionId, listeners);
    }
    return listeners;
  }

  private async ensureSession(sessionId: string): Promise<SessionEntry> {
    if (this.reloading.has(sessionId)) {
      throw new ExpertSwitchBusyError(sessionId);
    }
    if (this.disposedSessions.has(sessionId)) {
      throw new Error(`会话 ${sessionId} 已被销毁`);
    }
    const existing = this.sessions.get(sessionId);
    if (existing) return existing;

    const pending = this.initializing.get(sessionId);
    if (pending) return await pending;

    const generation = this.sessionGenerations.get(sessionId) ?? 0;
    const initialization = this.createSession(sessionId, generation);
    this.initializing.set(sessionId, initialization);
    try {
      return await initialization;
    } finally {
      if (this.initializing.get(sessionId) === initialization) {
        this.initializing.delete(sessionId);
      }
    }
  }

  private async createSession(
    sessionId: string,
    generation: number,
  ): Promise<SessionEntry> {
    const listeners = this.listenersForSession(sessionId);

    // Session construction only needs the initial model. Prompt facts are
    // resolved afresh inside the queued turn.
    const db = getDb();
    const conv = db.prepare(
      "SELECT model_provider, model_id FROM conversations WHERE id = ?",
    ).get(sessionId) as {
      model_provider: string;
      model_id: string;
    } | undefined;
    const modelProvider = conv?.model_provider || "deepseek";
    const modelId = normalizeModelId(
      modelProvider,
      conv?.model_id || "deepseek-v4-flash",
    );
    const sessionRoot = await resolveConversationSessionRoot(sessionId, { db });
    const protectedPathPolicy = createDefaultProtectedPathPolicy({
      cwd: sessionRoot.cwd,
    });
    const sessionManager = await openNativeSessionManager(
      sessionId,
      sessionRoot.cwd,
    );
    let createdSession: NativeAgentSession | undefined;
    try {
      let entry: SessionEntry | undefined;
      const handle = await createPiSession((event) => {
        // The coordinator emits one terminal event after recovery and acceptance.
        if (event.type === "agent_end" && entry?.runController) return;
        event = recoveryPresentationEvent(event, entry?.runController);
        // 广播给该会话的所有监听者
        for (const cb of listeners) {
          try {
            cb(event);
          } catch (e) {
            console.error("[provider] 事件监听器异常:", e);
          }
        }
      }, {
        sessionId,
        sessionManager,
        cwd: sessionRoot.cwd,
        agentDir: join(platformPaths.appDataDir, "pi-agent"),
        modelProvider,
        modelId,
        tools: getTools(),
        buildPrompt: () => entry?.systemPrompt ?? "",
        getPermission: () =>
          entry?.lastOpts.permission ?? DEFAULT_OPTS.permission,
        getPermissionPolicy: () => entry?.permissionPolicy,
        getProtectedPathPolicy: () =>
          entry?.protectedPathPolicy ?? protectedPathPolicy,
        getToolCallGuard: () => entry?.toolCallGuard,
        onRuntimeStatus: (phase, message) =>
          this.emitEvent(sessionId, {
            type: "task_status",
            phase,
            message,
          } as any),
      });
      createdSession = handle.session;
      if (
        this.disposedSessions.has(sessionId) ||
        (this.sessionGenerations.get(sessionId) ?? 0) !== generation
      ) {
        throw new Error(`会话 ${sessionId} 已被销毁`);
      }
      entry = {
        session: handle.session,
        sessionManager,
        systemPrompt: "",
        listeners,
        lastOpts: DEFAULT_OPTS,
        sessionRoot,
        protectedPathPolicy,
      };
      const nativePath = sessionManager.getSessionFile();
      if (nativePath) setCoreSessionPath(sessionId, nativePath);
      this.sessions.set(sessionId, entry);
      console.log(
        `[provider] 创建会话 ${sessionId} (模型: ${modelProvider}/${modelId})`,
      );
      return entry;
    } catch (error) {
      if (createdSession) {
        await createdSession.abort();
        await disposePiSession(createdSession);
      }
      throw error;
    }
  }

  async prompt(
    sessionId: string,
    text: string,
    opts?: PromptOptions,
    beforeExecute?: () => void | Promise<void>,
    onInitializationFailure?: () => void | Promise<void>,
  ): Promise<void> {
    return updateGate.run("agent", () => this.promptDuringUpdatePermit(sessionId, text, opts, beforeExecute, onInitializationFailure));
  }

  private async promptDuringUpdatePermit(
    sessionId: string, text: string, opts?: PromptOptions,
    beforeExecute?: () => void | Promise<void>, onInitializationFailure?: () => void | Promise<void>,
  ): Promise<void> {
    // reloadProfile marks this synchronously before its abort/wait await. Do
    // not enqueue a new turn that could otherwise reuse the stale harness.
    if (this.reloading.has(sessionId)) {
      throw new ExpertSwitchBusyError(sessionId);
    }
    // A new user turn supersedes a previous cancellation request. The active
    // turn is still aborted below, while this new turn is allowed to run.
    this.abortRequested.delete(sessionId);
    const previous = this.promptQueues.get(sessionId);
    // Start cancellation immediately, but do not await before publishing the
    // new queue tail. This keeps simultaneous B/C prompts chained as A→B→C.
    const active = previous ? this.sessions.get(sessionId) : undefined;
    let abortActive: Promise<unknown> = Promise.resolve();
    if (active) {
      try {
        active.runController?.abort();
        abortActive = active.session.abort().catch((error) => {
          console.error(
            `[provider] 会话 ${sessionId} 取消上一轮失败，将等待其自然结束:`,
            error,
          );
        });
      } catch (error) {
        console.error(
          `[provider] 会话 ${sessionId} 取消上一轮同步失败，将等待其自然结束:`,
          error,
        );
      }
    }
    const queued = (previous ?? Promise.resolve())
      .catch(() => {
        // A failed request must not poison the per-session queue.
      })
      .then(async () => {
        await abortActive;
        await this.executePrompt(
          sessionId,
          text,
          opts,
          beforeExecute,
          onInitializationFailure,
        );
      });
    this.promptQueues.set(sessionId, queued);
    try {
      await queued;
    } finally {
      if (this.promptQueues.get(sessionId) === queued) {
        this.promptQueues.delete(sessionId);
      }
    }
  }

  private async buildTurnEnvelope(
    sessionId: string,
    text: string,
    options: PromptOptions,
    sessionRoot: SessionRoot,
    protectedPathPolicy: ProtectedPathPolicy,
  ) {
    const row = loadPromptConversation(sessionId);
    // Refresh local packages once at the turn boundary, never while a turn runs.
    const expertId = row.expertId?.trim();
    const previousExpertRevision = row.expertRevision;
    const previousExpertSource = row.expertCatalogSource;
    if (expertId) {
      try {
        const { refreshInstalledExperts, refreshSkillHubExperts, getExpert } = await import("./experts.ts");
        await refreshInstalledExperts();
        await refreshSkillHubExperts();
        const expert = getExpert(expertId);
        if (!expert?.available || !expert.revision) throw new ExpertInitializationError(expertId);
        row.expertRevision = expert.revision;
        row.expertCatalogSource = expert.catalogSource;
      } catch (error) {
        if (error instanceof ExpertInitializationError) throw error;
        throw new ExpertInitializationError(expertId, error);
      }
    }
    // 主会话每轮刷新 ready 连接器的 delegate 工具缓存（resolveToolPolicy 同步装配用）。
    if (!options.connector && !options.projectScoped) {
      await refreshConnectorDelegateTools();
    }
    const session = await resolveSessionIntent({
      sessionId,
      mode: options.mode,
      permission: options.permission,
      selectedSkillNames: options.selectedSkillNames ?? [],
      selectedMcpTools: options.mcpTools ?? [],
      ...(options.connector ? { connector: options.connector } : {}),
      ...(options.subagent ? { subagent: options.subagent } : {}),
    }, {
      loadConversation: async () => row,
    });

    const resources: PromptResources = options.connector
      ? {
        // 连接器子会话只加载安装包自带的 skill，不混入用户/内置技能。
        skills: connectorChildSkills(options.connector),
        promptTemplates: [],
      }
      : {
        skills: loadSkillResources(),
        promptTemplates: loadPromptTemplateResources(sessionRoot.cwd),
      };
    let expertProfile: ExpertRuntimeProfile | undefined;
    let profile = await resolveRuntimeProfile({
      session,
      sessionRoot,
      platform: currentPlatform,
      protectedPathPolicy,
    }, {
      resolveTools: input => resolveToolPolicy({ ...input, projectScoped: options.projectScoped }),
      resolvePermission: resolvePermissionPolicy,
      loadResources: () => resources,
      resolveExpert: async (_intent, capabilities) => {
        expertProfile = await resolveExpertProfile(
          row,
          capabilities.activeToolNames,
          capabilities.skillNames,
        );
        if (expertProfile?.resourceSkills.length) {
          resources.skills = [...new Map([
            ...(resources.skills ?? []),
            ...expertProfile.resourceSkills,
          ].map(skill => [skill.name, skill])).values()];
        }
        if (expertProfile && (previousExpertRevision !== expertProfile.revision || previousExpertSource !== row.expertCatalogSource)) {
          setConversationExpertBinding(sessionId, {
            expertId: expertProfile.expertId,
            revision: expertProfile.revision,
            catalogSource: row.expertCatalogSource as "builtin" | "installed" | "catalog",
          });
        }
        return expertProfile
          ? {
            expertId: expertProfile.expertId,
            revision: expertProfile.revision,
          }
          : undefined;
      },
    });

    const browserAutomation = row.expertId === "team-qa--testing-expert"
      ? await (await import("../domains/browser-automation/node/service.ts")).browserAutomationContext(
        sessionId, sessionFallbackArtifactDir(platformPaths.artifactsDir, sessionId, process.platform === "win32" ? "windows" : "posix"))
      : "";
    const selectedSkills = session.category === "expert_creator"
      ? await resolveSelectedExpertSkills(options.selectedSkillNames ?? [])
      : [];
    if (options.selectedExpertId?.trim()) {
      const { getExpert } = await import("./experts.ts");
      if (!getExpert(options.selectedExpertId.trim())) {
        throw new Error(
          `Selected expert "${options.selectedExpertId}" is not available`,
        );
      }
    }

    const creator = await creatorContextForConversation(
      session.category,
      sessionId,
    );
    const expertManager = await expertManagerContextForConversation(
      session.category,
      sessionId,
    );
    const categoryRuntime: TurnIntent["categoryRuntime"] = creator
      ? session.skillOperation === "edit"
        ? {
          kind: "skill_editor",
          sessionId,
          draftId: creator.draft.id,
          targetName: row.skillTargetName ?? undefined,
        }
        : {
          kind: "skill_creator",
          sessionId,
          draftId: creator.draft.id,
        }
      : expertManager
      ? session.expertOperation === "edit"
        ? {
          kind: "expert_editor",
          sessionId,
          skillRoot: expertManager.skillRoot,
          targetId: row.expertTargetId ?? undefined,
          targetRevision: row.expertTargetRevision ?? undefined,
        }
        : {
          kind: "expert_creator",
          sessionId,
          skillRoot: expertManager.skillRoot,
          expertPluginsDir: join(
            platformPaths.appDataDir,
            "plugins",
            "marketplaces",
            "my-experts",
            "plugins",
          ),
          packagesDir: join(
            platformPaths.appDataDir,
            "plugins",
            "marketplaces",
            "my-experts",
            "packages",
          ),
        }
      : undefined;
    const turn = resolveTurnIntent({
      turnId: crypto.randomUUID(),
      text,
      skills: resources.skills ?? [],
      promptTemplates: resources.promptTemplates ?? [],
      attachments: options.attachments ?? [],
      fileReferences: [
        ...(options.fileReferences ?? []),
        ...listArtifacts(sessionId).slice(0, 8).map((artifact) => ({
          path: artifact.filePath,
        })),
      ],
      connectorContext: options.connectorContext ?? [],
      referenceExpertId: options.selectedExpertId?.trim() || undefined,
      selectedExpertSkills: selectedSkills.map((skill) => skill.name),
      selectedExpertSkillInputs: selectedSkills.map((skill) => ({
        ...skill,
        destination: `skills/${skill.name}`,
      })),
      categoryRuntime,
    });

    // Preserve the policy-resolved tools for native Pi discovery; do not prune
    // capabilities from user-text keywords or model size.

    const environment = new EnvironmentSource({
      read: () => ({
        platform: currentPlatform,
        osVersion: osRelease(),
        currentDate: new Date().toISOString().slice(0, 10),
        shell: process.env.SHELL,
        modelName: `${session.modelProvider}/${session.modelId}`,
        productName: "PiCoddy",
      }),
    });
    const workspace = new WorkspaceSource({
      resolve: () => ({
        cwd: sessionRoot.cwd,
        artifactDir: sessionRoot.cwd,
        protectedWorkspace: sessionRoot.protectedWorkspace,
      }),
    });
    const settings = new SettingsSource({
      getSetting: (key) => getSetting(key, "") || null,
    });
    const memory = new MemorySource({
      recallWorking: async (id) => recallWorkingMemory(id).map(memoryContext),
      recallUser: async () => recallMemories().map(memoryContext),
    });
    const capabilities = buildCapabilityContext(
      capabilityActivationContextFromProfile(profile),
    );
    const turnContext = new TurnContextSource({ turn });
    const sources: SnapshotSource[] = [
      {
        key: "environment",
        id: environment.id,
        collect: () => environment.collect(),
      },
      {
        key: "workspace",
        id: workspace.id,
        collect: () => workspace.collect(),
      },
      { key: "settings", id: settings.id, collect: () => settings.collect() },
      {
        key: "memory",
        id: memory.id,
        collect: (input) => memory.collect(input),
      },
      valueSource(
        "skills",
        "skills",
        buildSkillContext(resources.skills ?? [], profile.activeToolNames),
      ),
      ...(expertProfile
        ? [valueSource("expert", "expert", { ...buildExpertContext(expertProfile), workflow: [buildExpertContext(expertProfile).workflow, browserAutomation].filter(Boolean).join("\n\n") })]
        : []),
      valueSource("capabilities", "capabilities", capabilities),
      { key: "turn", id: turnContext.id, collect: () => turnContext.collect() },
    ];

    return await buildPromptRuntimeEnvelope({
      profile,
      turn,
      sources,
      promptRoot: PROMPT_ROOT,
    });
  }

  private async executePrompt(
    sessionId: string,
    text: string,
    opts?: PromptOptions,
    beforeExecute?: () => void | Promise<void>,
    onInitializationFailure?: () => void | Promise<void>,
  ): Promise<void> {
    let entry: SessionEntry | undefined;
    let beforeExecuteStarted = false;
    const runBeforeExecute = async () => {
      if (beforeExecuteStarted || !beforeExecute) return;
      beforeExecuteStarted = true;
      await beforeExecute();
    };
    try {
      if (this.abortRequested.has(sessionId)) {
        this.abortRequested.delete(sessionId);
        updateConversationStatus(sessionId, "cancelled");
        return;
      }
      entry = await this.ensureSession(sessionId);
      const controller = new AbortController();
      entry.runController = controller;
      if (this.abortRequested.has(sessionId)) {
        throw new Error("PROMPT_CANCELLED");
      }
      // Persist only after this queued turn owns a live SessionEntry. A later
      // turn must not enter SQLite while an earlier staged session can still
      // fail and roll back.
      await runBeforeExecute();
      const o = opts ?? entry.lastOpts;
      entry.lastOpts = o;

      if (o.modelProvider && o.modelId) {
        // The turn rebuild below resolves the selection against freshly loaded
        // providers and virtual models, rather than the previous turn's catalog.
        updateConversationModel(sessionId, o.modelProvider, o.modelId);
      }

      // Re-resolve on every turn so assigning or moving a conversation to a
      // workspace cannot leave a restored harness with stale filesystem roots.
      const sessionRoot = await resolveConversationSessionRoot(sessionId);
      const protectedPathPolicy = createDefaultProtectedPathPolicy({
        cwd: sessionRoot.cwd,
      });
      entry.sessionRoot = sessionRoot;
      entry.protectedPathPolicy = protectedPathPolicy;
      if (this.abortRequested.has(sessionId)) {
        throw new Error("PROMPT_CANCELLED");
      }
      const contextStarted = performance.now();
      const envelope = await this.buildTurnEnvelope(
        sessionId,
        text,
        o,
        sessionRoot,
        protectedPathPolicy,
      );
      entry.permissionPolicy = envelope.permissionPolicy;
      entry.systemPrompt = envelope.systemPrompt;
      const reboundProvider = o.modelProvider ?? entry.session.model?.provider ?? "deepseek";
      const reboundModel = o.modelId ?? entry.session.model?.id ?? "deepseek-v4-flash";
      const runtimeKey = sessionRuntimeKey(envelope, sessionRoot.cwd,
        `${reboundProvider}/${reboundModel}`);
      const reuseRuntime = entry.runtimeKey === runtimeKey;
      const runtimeStarted = performance.now();
      if (!reuseRuntime) {
        await disposePiSession(entry.session, "reload");
        const activeEntry = entry;
        const rebound = await createPiSession(
          (event) => {
            if (event.type === "agent_end" && activeEntry.runController) return;
            this.emitEvent(sessionId, recoveryPresentationEvent(event, activeEntry.runController));
          },
          {
            sessionId,
            sessionManager: entry.sessionManager,
            cwd: sessionRoot.cwd,
            agentDir: join(platformPaths.appDataDir, "pi-agent"),
            modelProvider: reboundProvider,
            modelId: reboundModel,
            tools: envelope.tools,
            resources: envelope.resources,
            buildPrompt: () => activeEntry.systemPrompt,
            getPermission: () => activeEntry.lastOpts.permission,
            getPermissionPolicy: () => activeEntry.permissionPolicy,
            getProtectedPathPolicy: () => activeEntry.protectedPathPolicy,
            getToolCallGuard: () => activeEntry.toolCallGuard,
            onRuntimeStatus: (phase, message) =>
              this.emitEvent(sessionId, {
                type: "task_status",
                phase,
                message,
              } as any),
          },
        );
        entry.session = rebound.session;
        entry.runtimeKey = runtimeKey;
      }
      console.info("[context.runtime]", JSON.stringify({ sessionId, reused: reuseRuntime,
        assemblyMs: Math.round(runtimeStarted - contextStarted),
        initializationMs: Math.round(performance.now() - runtimeStarted) }));
      entry.session.setActiveToolsByName(envelope.activeToolNames);
      const activeEntry = entry;
      if (this.abortRequested.has(sessionId)) controller.abort();
      let requirement = o.artifactRequirement;
      if (
        !requirement && o.mode === "craft" &&
        envelope.activeToolNames.includes("present_files")
      ) {
        requirement = inferTurnArtifactRequirement(
          text,
          o.userRequest,
          getMessages(sessionId).filter((m) => m.role === "user").map((m) => m.content),
        );
      }
      const runner = new TaskRunCoordinator({
        session: activeEntry.session,
        controller,
        requirement,
        onCheckpoint: async () => {
          const path = activeEntry.sessionManager.getSessionFile();
          if (path) setCoreSessionPath(sessionId, path);
        },
        onStatus: (phase, message) =>
          this.emitEvent(sessionId, {
            type: "task_status",
            phase,
            message,
          } as any),
      });
      activeEntry.toolCallGuard = (toolName, input) =>
        runner.guardToolCall(toolName, input);
      await sessionContext.run({
        sessionId,
        turnId: envelope.turnId,
        permission: o.permission,
        activeToolNames: envelope.activeToolNames,
        selectedMcpTools: [...(o.mcpTools ?? [])],
        delegationDepth: o.subagent?.delegationDepth ?? 0,
        attachments: [...(o.attachments ?? [])],
        declareTaskCompletion: (declaration) => runner.declareCompletion(declaration),
        verifyArtifactForDelivery: (path, signal) =>
          runner.verifyDelivery(path, signal),
        ...(envelope.invocation?.kind === "skill"
          ? { activeSkillName: envelope.invocation.name }
          : {}),
        ...(o.connectorCommandContext
          ? { connector: o.connectorCommandContext }
          : {}),
      }, async () => {
        const retrievedPrompt = await withRetrievedDocuments(
          envelope,
          sessionRoot.cwd,
        );
        const userPrompt = envelope.activeToolNames.includes("present_files")
          ? `${retrievedPrompt}\n\n[运行时交付约束]\n如果本次任务生成了文件或网页成果，必须先完成写入，再调用 present_files 交付。`
          : retrievedPrompt;
        const promptImages = await buildPromptImages({
          attachments: o.attachments ?? [],
          cwd: sessionRoot.cwd,
          model: activeEntry.session.model,
          signal: controller.signal,
        });
        const activeModel = activeEntry.session.model;
        const configuredModel = activeModel
          ? (getProviderModels()[activeModel.provider] ?? []).find((model) =>
            model.id === activeModel.id
          )
          : undefined;
        const capabilities = resolveModelCapabilities(
          activeModel?.provider ?? o.modelProvider ?? "",
          activeModel?.id ?? o.modelId ?? "",
          {
            ...configuredModel,
            contextWindow: configuredModel?.contextWindow ??
              activeModel?.contextWindow,
            maxOutputTokens: configuredModel?.maxOutputTokens,
          },
        );
        const budgetInput = () => ({
          capabilities,
          maxOutputTokens: activeModel?.maxTokens ?? 4096,
          systemPrompt: envelope.systemPrompt,
          userPrompt,
          imageCount: promptImages.length,
          history: activeEntry.session.messages,
          tools: envelope.tools,
        });
        let budget = estimateContextBudget(budgetInput());
        const budgetBeforeCompaction = budget;
        const compactionEnabled = activeEntry.session.settingsManager
          .getCompactionEnabled();
        const canCompactHistory = compactionEnabled &&
          activeEntry.session.messages.length > 1;
        let compactionOutcome: "not_needed" | "compacted" | "skipped" |
          "unavailable" = "not_needed";

        if (shouldAttemptHistoryCompaction(budget, canCompactHistory)) {
          const operation = startOperation(
            "agent.context.preflight_compaction",
            {
              sessionId,
              model: `${activeModel?.provider}/${activeModel?.id}`,
              estimatedInputBefore: budget.inputTokens,
              safeInputCapacity: budget.safeInputTokens,
              estimatedHistoryBefore: budget.historyTokens,
            },
          );
          this.emitEvent(sessionId, {
            type: "task_status",
            phase: "compacting",
            message: "正在整理长会话上下文，保留近期对话和关键进展…",
          } as any);
          try {
            const result = await compactHistoryForBudget({
              budget,
              canCompact: canCompactHistory,
              compact: () => activeEntry.session.compact(
                "生成供后续轮次继续使用的简洁检查点。保留用户当前目标和约束、已经确认的决策、已完成与未完成事项、必要的仓库路径与分支信息，以及仍需跟进的问题。合并重复内容，省略重复工具输出和过时的中间过程；只记录会话中明确出现的事实。",
              ),
            });
            compactionOutcome = result;
            budget = estimateContextBudget(budgetInput());
            operation.success({
              outcome: result,
              estimatedInputBefore: budgetBeforeCompaction.inputTokens,
              estimatedInputAfter: budget.inputTokens,
              estimatedHistoryBefore: budgetBeforeCompaction.historyTokens,
              estimatedHistoryAfter: budget.historyTokens,
              safeInputCapacity: budget.safeInputTokens,
              estimatedOverflowAfter: budget.overflowTokens,
            });
          } catch (error) {
            budget = estimateContextBudget(budgetInput());
            operation.error(error, {
              estimatedInputBefore: budgetBeforeCompaction.inputTokens,
              estimatedInputAfter: budget.inputTokens,
              safeInputCapacity: budget.safeInputTokens,
              estimatedOverflowAfter: budget.overflowTokens,
            });
            if (budget.overflowTokens > 0) {
              throw new Error(
                `${formatContextCapacityMessage(
                  `${activeModel?.provider}/${activeModel?.id}`,
                  budget,
                )} 自动整理会话历史失败：${error instanceof Error ? error.message : String(error)}`,
              );
            }
            // A failed early compaction must not block a request that still fits.
            compactionOutcome = "skipped";
          } finally {
            this.emitEvent(sessionId, {
              type: "task_status",
              phase: "running",
              message: "会话上下文已整理，正在准备本轮输入…",
            } as any);
          }
        }

        console.info("[context.preflight]", JSON.stringify({
          model: `${activeModel?.provider}/${activeModel?.id}`,
          capabilitySource: capabilities.source,
          contextWindow: capabilities.contextWindow,
          ...budget,
          inputTokensBeforeCompaction: budgetBeforeCompaction.inputTokens,
          historyTokensBeforeCompaction: budgetBeforeCompaction.historyTokens,
          compactionOutcome,
          decision: budget.overflowTokens > 0 ? "blocked_over_budget" :
            compactionOutcome === "compacted" ? "preturn_compacted" :
            "within_budget",
        }));
        if (budget.overflowTokens > 0) {
          throw new Error(formatContextCapacityMessage(
            `${activeModel?.provider}/${activeModel?.id}`,
            budget,
          ));
        }
        const response = await runner.execute(() =>
          activeEntry.session.prompt(
            envelope.invocation?.kind === "skill"
              ? `/skill:${envelope.invocation.name} ${userPrompt}`
              : userPrompt,
            {
              expandPromptTemplates: envelope.invocation?.kind === "skill",
              images: promptImages.length > 0 ? promptImages : undefined,
            },
          )
        );
        const abortRequested = this.abortRequested.delete(sessionId);
        const cancelled = abortRequested || response.stopReason === "aborted";
        const failed = didAssistantResponseFail(response);
        console.log(
          `[provider] 会话 ${sessionId} prompt ${
            cancelled
              ? "取消"
              : failed
              ? "失败"
              : runner.waitingForUser
              ? "等待用户"
              : "完成"
          }`,
        );
        updateConversationStatus(
          sessionId,
          cancelled
            ? "cancelled"
            : failed
            ? "failed"
            : runner.waitingForUser
            ? "pending"
            : "done",
        );
      });
    } catch (error) {
      // Preserve the failed user turn without running beforeExecute: that hook
      // may restore listeners by initializing a new staged SessionEntry, whose
      // snapshot would precede the failed turn.
      if (!beforeExecuteStarted) {
        try {
          await onInitializationFailure?.();
        } catch (persistError) {
          console.error(
            `[provider] 会话 ${sessionId} 用户消息持久化失败:`,
            persistError,
          );
        }
      }
      const abortedByUser = this.abortRequested.delete(sessionId);
      if (abortedByUser || entry?.runController?.signal.aborted) {
        updateConversationStatus(sessionId, "cancelled");
        return;
      }
      this.handlePromptFailure(sessionId, error, entry);
    } finally {
      if (entry) {
        entry.runController = undefined;
        entry.toolCallGuard = undefined;
      }
      this.emitEvent(sessionId, { type: "agent_end", messages: [] } as any);
    }
  }

  private handlePromptFailure(
    sessionId: string,
    error: unknown,
    entry?: SessionEntry,
  ): void {
    const detail = error instanceof Error ? error.message : String(error);
    const visibleDetail = entry ? detail : "会话初始化失败，请检查配置后重试";
    const errorMsg = `出错了：${visibleDetail}`;
    console.error(`[provider] 会话 ${sessionId} prompt 失败:`, detail);
    try {
      updateConversationStatus(sessionId, "failed");
    } catch (statusError) {
      console.error("[provider] 更新失败状态异常:", statusError);
    }

    const syntheticMessage = {
      role: "assistant",
      content: [{ type: "text", text: errorMsg }],
      stopReason: "error",
      errorMessage: visibleDetail,
    };
    this.emitEvent(sessionId, {
      type: "message_update" as any,
      sessionId,
      message: syntheticMessage,
    } as any);
    this.emitEvent(sessionId, {
      type: "message_end" as any,
      sessionId,
      message: syntheticMessage,
    } as any);

    const listeners = this.sessionListeners.get(sessionId);
    if (!listeners || listeners.size === 0) {
      try {
        appendMessage(sessionId, "assistant", errorMsg, { isError: true });
      } catch (persistError) {
        console.error("[provider] 错误消息持久化异常:", persistError);
      }
    }
  }

  /** 读取某会话当前权限级别（供权限钩子用） */
  getPermission(sessionId: string): PermLevel {
    return this.sessions.get(sessionId)?.lastOpts.permission ?? "default";
  }

  async steer(sessionId: string, msg: string): Promise<void> {
    const entry = this.sessions.get(sessionId);
    if (entry) await entry.session.steer(msg, undefined);
  }

  async abortAllForUpdate(): Promise<void> {
    await Promise.all([...this.promptQueues.keys()].map((id) => this.abort(id)));
  }

  async abort(sessionId: string): Promise<void> {
    this.abortRequested.add(sessionId);
    const entry = this.sessions.get(sessionId);
    if (!entry) return;
    entry.runController?.abort();
    await entry.session.abort();
    await entry.session.waitForIdle();
  }

  async onEvent(
    sessionId: string,
    cb: (e: AgentEvent) => void,
  ): Promise<() => void> {
    const listeners = this.listenersForSession(sessionId);
    listeners.add(cb);
    try {
      await this.ensureSession(sessionId);
      return () => listeners.delete(cb);
    } catch (error) {
      setTimeout(() => listeners.delete(cb), 0);
      throw error;
    }
  }

  /**
   * 为某会话挂接「消息落库」监听器：把 agent 的 message_end（assistant 文本）
   * 与 tool_execution_end（工具调用）持久化进 SQLite。
   * 这是 assistant/tool 消息唯一的持久化所有者。监听与会话同寿命，
   * 返回值仅为向后兼容保留，不会移除长期监听。
   */
  async attachPersistence(sessionId: string): Promise<() => void> {
    const entry = await this.ensureSession(sessionId);
    if (this.persistenceAttached.has(sessionId)) return () => {};
    this.persistenceAttached.add(sessionId);
    const toolArgs = new Map<string, string>();
    const cb = (event: any) => {
      try {
        if (event.type === "tool_execution_start") {
          const toolCallId = event.toolCallId;
          const args = event.args;
          if (toolCallId && args) {
            toolArgs.set(
              toolCallId,
              typeof args === "string" ? args : JSON.stringify(args),
            );
          }
        } else if (
          event.type === "message_end" && event.message?.role === "assistant"
        ) {
          appendAssistantMessageFromAgent(sessionId, event.message);
        } else if (event.type === "tool_execution_end") {
          const toolCallId = event.toolCallId;
          const argsStr = toolCallId ? toolArgs.get(toolCallId) : undefined;
          if (toolCallId) toolArgs.delete(toolCallId);
          const outputStr = toolOutputForDb(event.toolName, event.output);
          if (outputStr) {
            appendMessage(sessionId, "tool", outputStr, {
              toolName: event.toolName,
              toolArgs: argsStr,
              isError: event.isError,
            });
          }
        }
      } catch (e) {
        console.error("[provider] 消息持久化异常:", e);
      }
    };
    entry.listeners.add(cb);
    return () => {};
  }

  /**
   * 向某会话广播一个事件（供外部注入非 agent 事件，如工具确认请求 tool_confirmation）。
   * 与 create参考设计Agent 的事件回调走同一条 listeners 通路，
   * 因此 SSE（onEvent 订阅）与 getQueue（onEvent → push queue）都能实时收到。
   */
  emitEvent(sessionId: string, event: AgentEvent): void {
    const listeners = this.sessionListeners.get(sessionId);
    if (!listeners) return;
    for (const cb of listeners) {
      try {
        cb(event);
      } catch (e) {
        console.error("[provider] 事件监听器异常:", e);
      }
    }
  }

  /**
   * Invalidate an idle session's in-memory harness so its next prompt reads
   * the current expert binding from SQLite.  This is intentionally separate
   * from dispose(): profile reload must keep event listeners and the session's
   * Core/SQLite history, and it must not permanently mark the id as disposed.
   */
  async reloadProfile(sessionId: string): Promise<void> {
    if (
      this.initializing.has(sessionId) ||
      this.promptQueues.has(sessionId) ||
      this.reloading.has(sessionId)
    ) {
      const error = new ExpertSwitchBusyError(sessionId);
      logExpertEvent("expert.runtime.reload_failed", {
        errorCode: error.code,
        status: "busy",
      });
      throw error;
    }

    // Mark before the first await so no prompt can enter the stale entry while
    // abort/waitForIdle is draining it.
    this.reloading.add(sessionId);
    const generation = (this.sessionGenerations.get(sessionId) ?? 0) + 1;
    this.sessionGenerations.set(sessionId, generation);

    try {
      const entry = this.sessions.get(sessionId);
      if (!entry) {
        logExpertEvent("expert.runtime.reloaded", {
          result: "invalidated",
          status: "ok",
        });
        return;
      }
      await entry.session.abort();
      await entry.session.waitForIdle();
      await disposePiSession(entry.session, "reload");
      // Keep the listener set and all persisted history.  The generation bump
      // above prevents any stale initialization callback from re-inserting a
      // session entry after this deletion.
      if (this.sessions.get(sessionId) === entry) {
        this.sessions.delete(sessionId);
      }
      logExpertEvent("expert.runtime.reloaded", {
        result: "invalidated",
        status: "ok",
      });
    } catch (cause) {
      const errorCode = cause instanceof ExpertSwitchBusyError
        ? cause.code
        : "EXPERT_RUNTIME_RELOAD_FAILED";
      logExpertEvent("expert.runtime.reload_failed", {
        errorCode,
        status: "failed",
      });
      throw cause;
    } finally {
      this.reloading.delete(sessionId);
    }
  }

  /**
   * Drain and evict runtimes for an uninstall without disposing their
   * conversations.  Listeners are intentionally retained so an already-open
   * conversation can continue receiving events after it falls back to a
   * normal session on its next prompt.
   */
  async releaseExpertSessions(sessionIds: readonly string[]): Promise<void> {
    const ids = [...new Set(sessionIds)].filter((id) => id.trim().length > 0);
    const releasing: string[] = [];
    try {
      // Claim every session before the first await.  Otherwise a prompt for a
      // later ID could enter while an earlier ID is being drained.
      for (const sessionId of ids) {
        if (this.reloading.has(sessionId)) {
          throw new ExpertRuntimeReleaseError(sessionId);
        }
      }
      for (const sessionId of ids) {
        this.reloading.add(sessionId);
        releasing.push(sessionId);
        this.sessionGenerations.set(
          sessionId,
          (this.sessionGenerations.get(sessionId) ?? 0) + 1,
        );
        this.abortRequested.add(sessionId);
      }
      for (const sessionId of ids) {
        const entry = this.sessions.get(sessionId);
        if (entry) {
          entry.runController?.abort();
          await entry.session.abort();
          await entry.session.waitForIdle();
        }
        const queued = this.promptQueues.get(sessionId);
        if (queued) {
          try {
            await queued;
          } catch { /* prompt failure is already surfaced */ }
        }
        const pending = this.initializing.get(sessionId);
        if (pending) {
          try {
            await pending;
          } catch { /* initialization failure is surfaced */ }
        }
        const current = this.sessions.get(sessionId);
        if (current) {
          current.runController?.abort();
          await current.session.abort();
          await current.session.waitForIdle();
          await disposePiSession(current.session, "reload");
          if (this.sessions.get(sessionId) === current) {
            this.sessions.delete(sessionId);
          }
        }
      }
    } catch (cause) {
      if (cause instanceof ExpertRuntimeReleaseError) throw cause;
      const sessionId = releasing[releasing.length - 1] ?? ids[0] ?? "unknown";
      throw new ExpertRuntimeReleaseError(sessionId, cause);
    } finally {
      for (const sessionId of releasing) {
        this.reloading.delete(sessionId);
        this.abortRequested.delete(sessionId);
      }
    }
  }

  async dispose(sessionId: string): Promise<void> {
    this.disposedSessions.add(sessionId);
    const generation = (this.sessionGenerations.get(sessionId) ?? 0) + 1;
    this.sessionGenerations.set(sessionId, generation);

    const entry = this.sessions.get(sessionId);
    if (entry) {
      entry.runController?.abort();
      await entry.session.abort();
      await entry.session.waitForIdle();
      const queued = this.promptQueues.get(sessionId);
      if (queued) {
        try {
          await queued;
        } catch {
          // Prompt failure is already surfaced through handlePromptFailure.
        }
      }
      await disposePiSession(entry.session);
      entry.listeners.clear();
      this.sessions.delete(sessionId);
    }
    this.sessionListeners.delete(sessionId);

    const pending = this.initializing.get(sessionId);
    if (pending) {
      try {
        await pending;
      } catch {
        // createSession 会因 generation 失效而清理 handle 并拒绝。
      }
    }
    console.log(`[provider] 销毁会话 ${sessionId}`);
  }
}

/** 把工具输出规整为可存储的字符串（与 main.ts 的 getToolOutputString 同逻辑） */
function getToolOutputString(output: unknown): string {
  if (!output) return "";
  if (typeof output === "string") return output;
  const anyOutput = output as any;
  if (Array.isArray(anyOutput.content)) {
    return anyOutput.content
      .filter((c: any) => c.type === "text")
      .map((c: any) => c.text)
      .join("\n");
  }
  if (typeof anyOutput.text === "string") return anyOutput.text;
  return JSON.stringify(output);
}

/** 落库用：details 承载渲染数据（present_files/show_widget）的必须存完整 JSON，前端重载解析 details 恢复展示 */
function toolOutputForDb(toolName: string, output: unknown): string {
  if (toolName === "present_files" || toolName === "show_widget") {
    return output ? JSON.stringify(output) : "";
  }
  return getToolOutputString(output);
}

/** MVP 唯一的 provider 实例 */
export const provider = new LocalPiProvider();

/** 获取底层原生 AgentSession（用于内部访问）。 */
export function getSessionAgentSession(
  sessionId: string,
): NativeAgentSession | undefined {
  return provider["sessions"].get(sessionId)?.session;
}

/** 获取某会话当前权限级别 */
export function getSessionPermission(sessionId: string): PermLevel {
  return provider.getPermission(sessionId);
}
