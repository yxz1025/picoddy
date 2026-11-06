import { randomUUID } from "../../../src/lib/uuid";
import { addConnectorSelection, removeConnectorSelection } from "../components/composerConnectorSelection";
import { create } from "zustand";
import { syncTaskUrl } from "../taskNavigation";
import { apiDelete, apiGet, apiPost, apiPut } from "../api/client";
import {
  dispatchCloudRunStart,
  streamRunEvents,
  type CloudRun,
  type CloudRunEvent,
  type CloudRunStatus,
} from "../api/runStream";
import {
  canSendComposerMessage,
  type PublicAttachment,
} from "../components/composerMenuModel";
import {
  deliveryBatchFromOutput,
  type DeliveryBatch,
  type PresentedFile,
  type PreviewTarget,
} from "../utils/artifactPresentation";
import {
  assistantEventText,
  assistantEventThinking,
  thinkingTextFromParts,
  type MessageContentPart,
} from "./eventModel";
import type { ExpertSummary } from "../types/experts";
import {
  type ExpertComposerBootstrap,
  takeExpertComposerBootstrap,
} from "../components/expertCreatorModel";
import {
  addExpertSkill,
  removeExpertSkill,
} from "../components/expertSkillSelectionModel";
import {
  deriveWorkspaceSelection,
  resolveWorkspaceActivationTarget,
} from "./workspaceSelectionModel";
import { shouldAutoOpenArtifactPanel } from "../components/artifactPanelModel";
import { clearActiveStream, useStreamStore } from "./useStreamStore";

export type { DeliveryBatch, PresentedFile, PreviewTarget } from "../utils/artifactPresentation";
export type { MessageContentPart } from "./eventModel";

export type RunMode = "ask" | "plan" | "craft";
export type PermLevel = "L1" | "L2" | "L3" | "readonly" | "default" | "full";
export type Theme = "light" | "dark";
export type ExpertPanelTab = "expert" | "skill" | "connector";

export interface Conversation {
  requirementScoped?: boolean;
  requirementContext?: string;
  id: string;
  title: string;
  category: string;
  status: string;
  modelProvider: string;
  modelId: string;
  workspaceId?: string;
  parentId?: string | null;
  expertId?: string | null;
  expertRevision?: string | null;
  expertCatalogSource?: "builtin" | "installed" | "catalog" | null;
  expertOperation?: "create" | "edit" | null;
  expertTargetId?: string | null;
  expertTargetRevision?: string | null;
  expertNotice?: "uninstalled" | null;
  expert?: ExpertSummary | null;
  createdAt: number;
  updatedAt: number;
}

export interface Workspace {
  id: string;
  name: string;
  dirPath: string;
  icon: string;
  lastOpenedAt: number;
  createdAt: number;
}

export interface WorkspaceCreationDraft {
  source: "blank" | "local-directory";
  name: string;
  dirPath: string;
  icon: string;
}

export interface Message {
  requirementInputId?: string;
  id: string;
  role: string;
  content: string;
  attachments?: PublicAttachment[];
  /** 附件在展示用正文中的插入偏移。 */
  attachmentAnchors?: Record<string, number>;
  toolName?: string;
  toolArgs?: string;
  isError?: boolean;
  status?: "running" | "success" | "error";
  thinking?: string;
  contentParts?: MessageContentPart[];
  /** show_widget 的可视化数据（实时路径，重载路径从 content JSON 的 details.widget 解析） */
  widget?: WidgetData;
  /** present_files 的交付批次（消息级，保证多批次互不覆盖） */
  deliveryBatch?: DeliveryBatch;
  createdAt: number;
}

/** show_widget 可视化数据（对标 参考设计 s19 Visualizer） */
export interface WidgetData {
  title: string;
  widget_code: string;
  module?: string;
  loading_messages?: string[];
}

/** 工具确认请求（对标 参考设计 permissionRequest） */
export interface PendingConfirm {
  requestId: string;
  toolName: string;
  args: any;
  sessionId: string;
  runId?: string;
}

export interface UiDialogOptions {
  title?: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: "default" | "danger" | "success";
}

export interface PendingUiDialog extends UiDialogOptions {
  id: number;
  kind: "alert" | "confirm";
}

export type ComposerConnectorKind = "mcp" | "managed-cli";

export interface ComposerConnectorSelection {
  id: string;
  displayName: string;
  icon?: string;
  kind: ComposerConnectorKind;
}

/** 交互式提问（AskUserQuestion） */
export interface AskQuestion {
  question: string;
  header?: string;
  multiSelect?: boolean;
  options: { label: string; description?: string }[];
}
export interface PendingAsk {
  requestId: string;
  sessionId: string;
  questions: AskQuestion[];
}

interface AppState {
  // 侧边栏
  sidebarCollapsed: boolean;
  activeCategory: string;
  conversations: Conversation[];
  currentConvId: string | null;
  searchQuery: string;

  // 工作空间
  workspaces: Workspace[];
  composerWorkspaceId: string | null; // Composer 里选的空间，新建会话时绑定
  composerConnectors: ComposerConnectorSelection[];
  composerConnectorsByConversation: Record<string, ComposerConnectorSelection[]>;
  addComposerConnector: (connector: ComposerConnectorSelection) => void;
  removeComposerConnector: (connector: Pick<ComposerConnectorSelection, "id" | "kind">) => void;
  expertComposerBootstrap: ExpertComposerBootstrap | null;
  consumeExpertComposerBootstrap: (
    conversationId: string | null,
  ) => ExpertComposerBootstrap | null;
  expertNotice: "uninstalled" | null;
  dismissExpertNotice: () => void;
  expertComposerSkills: Record<string, string[]>;
  expertComposerExperts: Record<string, ExpertSummary>;
  setExpertComposerExpert: (conversationId: string, expert: ExpertSummary) => void;
  clearExpertComposerExpert: (conversationId: string) => void;
  addExpertComposerSkill: (conversationId: string, skillName: string) => void;
  removeExpertComposerSkill: (conversationId: string, skillName: string) => void;
  clearExpertComposerSkills: (conversationId: string) => void;

  // 对话
  messages: Message[];
  busy: boolean;
  taskStatus: { phase: string; message: string } | null;
  mode: RunMode;
  permission: PermLevel;

  // 主题
  theme: Theme;

  // 模型
  modelId: string; // 当前选择的模型 ID（如 "Hy3", "deepseek-v4-flash"）
  modelProvider: string; // 当前模型提供商（如 "zhipu", "deepseek"）

  // 工具确认（对标 参考设计 permissionRequest 弹窗）
  pendingConfirm: PendingConfirm | null;
  respondConfirm: (approved: boolean) => Promise<void>;

  // 应用内 UTF-8 对话框，不使用 Windows CEF 原生 alert/confirm。
  pendingUiDialog: PendingUiDialog | null;
  requestUiConfirm: (
    options: string | UiDialogOptions,
  ) => Promise<boolean>;
  showUiAlert: (options: string | UiDialogOptions) => Promise<void>;
  resolveUiDialog: (approved: boolean) => void;

  // 交互式提问（AskUserQuestion）
  pendingAsk: PendingAsk | null;
  respondAsk: (answers: any) => Promise<void>;

  // UI 面板
  showSettings: boolean;
  showArtifacts: boolean;
  panelMode: "preview" | "browser" | "status" | "memories";
  setPanelMode: (m: "preview" | "browser" | "status" | "memories") => void;
  previewFile: PreviewTarget | null;
  openPreview: (
    target: string | PreviewTarget,
    toolName?: string,
    batchFiles?: PresentedFile[],
  ) => void;
  presentedFiles: PresentedFile[] | null;
  clearPresentedFiles: () => void;
  showWorkspaceManager: boolean;
  expertPanelTab: ExpertPanelTab;
  projectTapdAuthorization: boolean;
  openProjectTapdAuthorization: () => void;
  returnFromProjectTapdAuthorization: () => void;
  workspaceCreationDraft: WorkspaceCreationDraft | null;

  // 全局设置状态与动作
  settings: {
    openaiSubscription?: boolean;
    defaultProvider: string;
    defaultModelId: string;
    defaultModelResourceId: string;
    docsDir: string;
    language: string;
    fontSize: string;
    autoInstallSkills: boolean;
    keepAwake: boolean;
    defaultWorkspaceDir: string;
    experienceOpt: boolean;
    agentSystemPrompt: string;
    agentTemperature: string;
    agentMaxTokens: string;
    searchEngine: string;
    sandboxSecurity: boolean;
    deletionProtection: boolean;
    bulkDeletionLimit: string;
    builtinRuntime: boolean;
    runtimePython: boolean;
    runtimeNodejs: boolean;
    securityFileRules: string;
    securityCommandRules: string;
    securityNetworkRules: string;
    ollamaBaseUrl: string;
    customProviders: Array<
      {
        id: string;
        name: string;
        provider?: string;
        baseUrl: string;
        apiKey?: string;
        apiKeyConfigured?: boolean;
        models: string[];
      }
    >;
    providers: any[];
    availableProviders: any[];
  };
  apiKeys: Record<string, boolean>;
  memories: Array<
    {
      id: string;
      content: string;
      scope: string;
      kind: string;
      createdAt: number;
    }
  >;
  auditLogs: Array<
    {
      id: number;
      toolName: string;
      args: string;
      isError: number;
      createdAt: number;
    }
  >;

  loadSettings: () => Promise<void>;
  updateSettings: (patch: Partial<AppState["settings"]>) => Promise<void>;
  saveApiKey: (
    provider: string,
    key: string,
    model: { modelId: string; modelName?: string; resourceId?: string },
  ) => Promise<void>;
  deleteApiKey: (provider: string) => Promise<void>;
  loadMemories: () => Promise<void>;
  deleteMemory: (id: string) => Promise<void>;
  loadAuditLogs: () => Promise<void>;
  testConnection: (
    params: {
      provider: string;
      apiKey?: string;
      baseUrl?: string;
      resourceId?: string;
      modelId?: string;
    },
  ) => Promise<
    { ok: boolean; latencyMs?: number; message?: string; error?: string }
  >;
  saveCustomProvider: (
    data: {
      id?: string;
      name: string;
      baseUrl: string;
      apiKey?: string;
      models: string | string[];
    },
  ) => Promise<void>;
  deleteCustomProvider: (id: string) => Promise<void>;
  fetchOllamaModels: () => Promise<
    { ok: boolean; running: boolean; models?: any[]; error?: string }
  >;
  fetchProviderModels: (
    provider: string,
    apiKey?: string,
    resourceId?: string,
  ) => Promise<{
    ok: boolean;
    models?: Array<{
      id: string;
      name: string;
      description?: string;
      contextWindow?: number;
      features: string[];
    }>;
    error?: string;
  }>;

  // Actions
  toggleSidebar: () => void;
  setCategory: (cat: string) => void;
  loadConversations: () => Promise<void>;
  selectConversation: (
    id: string,
    options?: { preserveComposerConnector?: boolean; preserveCategory?: boolean },
  ) => Promise<void>;
  createConversation: (title?: string) => Promise<string>;
  resetToWelcome: (options?: { preserveComposerConnectors?: boolean }) => void; // 回到起始页（欢迎屏 + 工作空间选择器），不直接建会话
  deleteConversation: (id: string) => Promise<void>;
  sendMessage: (
    text: string,
    options?: {
      attachmentIds?: string[];
      attachments?: PublicAttachment[];
      attachmentAnchors?: Record<string, number>;
      preferredConnectors?: { id: string; kind: ComposerConnectorKind }[];
      preferredConnector?: string;
      preferredConnectorKind?: ComposerConnectorKind;
      displayText?: string;
      selectedSkillNames?: string[];
      selectedExpertId?: string;
      testingPublishField?: string;
    },
  ) => Promise<boolean>;
  abortGeneration: () => Promise<void>;
  startRunStream: (conversationId: string, runId: string) => void;
  setMode: (m: RunMode) => void;
  setPermission: (p: PermLevel) => void;
  toggleTheme: () => void;
  setShowSettings: (v: boolean) => void;
  setShowArtifacts: (v: boolean) => void;
  setBusy: (v: boolean) => void;
  updateLastMessage: (id: string, content: string) => void;
  updateConversationStatus: (id: string, status: string) => void;
  setShowWorkspaceManager: (v: boolean) => void;
  openWorkspaceCreator: (draft?: WorkspaceCreationDraft) => void;
  clearWorkspaceCreationDraft: () => void;
  setExpertPanelTab: (tab: ExpertPanelTab) => void;
  showCommandPalette: boolean;
  setShowCommandPalette: (v: boolean) => void;
  setModel: (provider: string, modelId: string) => void;
  setComposerWorkspaceId: (id: string | null) => void;

  // 工作空间
  loadWorkspaces: () => Promise<void>;
  selectWorkspace: (id: string) => void;
  createWorkspace: (
    name: string,
    dirPath?: string,
    icon?: string,
  ) => Promise<Workspace>;
  activateWorkspace: (id: string | null) => Promise<void>;
  updateWorkspace: (
    id: string,
    patch: { name?: string; dirPath?: string; icon?: string },
  ) => Promise<void>;
  deleteWorkspace: (id: string) => Promise<void>;
  assignConversation: (convId: string, workspaceId: string | null) => Promise<void>;
}

type ActiveRunStream = {
  conversationId: string;
  runId: string;
  controller: AbortController;
  sequence: number;
};

const ACTIVE_CLOUD_RUN_STATUSES = new Set<CloudRunStatus>([
  "queued", "provisioning", "running", "waiting_approval", "cancelling", "cleanup_pending",
]);
const TERMINAL_CLOUD_RUN_STATUSES = new Set<CloudRunStatus>([
  "succeeded", "failed", "cancelled", "interrupted",
]);

let activeRunStream: ActiveRunStream | null = null;
let selectionGeneration = 0;
let conversationLoadGeneration = 0;

const STREAM_COMMIT_INTERVAL_MS = 33;
type StreamChannel = "answer" | "thinking";
type PendingStreamText = {
  mode: "delta" | "snapshot";
  channel: StreamChannel;
  text: string;
  relaySequence: number;
};
const pendingStreamText = new Map<string, PendingStreamText>();
const streamSequences = new Map<string, number>();
const resyncingSessions = new Set<string>();
const queuedResyncEvents = new Map<string, any[]>();

function streamBufferKey(sessionId: string, channel: StreamChannel): string {
  return `${sessionId}\0${channel}`;
}

function streamChannel(value: unknown): StreamChannel {
  return value === "thinking" ? "thinking" : "answer";
}

function hydrateAssistantThinking(messages: Message[]): Message[] {
  return messages.map((message) => {
    if (message.role !== "assistant") return message;
    const thinking = message.thinking || thinkingTextFromParts(message.contentParts);
    return thinking ? { ...message, thinking } : message;
  });
}
let streamCommitTimer: number | null = null;
let streamCommitFrame: number | null = null;
let lastStreamCommitAt = 0;

function cancelScheduledStreamCommit(): void {
  if (streamCommitTimer !== null) window.clearTimeout(streamCommitTimer);
  if (streamCommitFrame !== null) cancelAnimationFrame(streamCommitFrame);
  streamCommitTimer = null;
  streamCommitFrame = null;
}

function clearStreamBuffers(sessionId?: string): void {
  if (sessionId) {
    for (const channel of ["thinking", "answer"] as const) {
      pendingStreamText.delete(streamBufferKey(sessionId, channel));
      streamSequences.delete(streamBufferKey(sessionId, channel));
    }
    streamSequences.delete(sessionId);
    resyncingSessions.delete(sessionId);
    queuedResyncEvents.delete(sessionId);
  } else {
    pendingStreamText.clear();
    streamSequences.clear();
    resyncingSessions.clear();
    queuedResyncEvents.clear();
  }
  if (pendingStreamText.size === 0) cancelScheduledStreamCommit();
}

function flushStreamText(get: any, sessionId?: string): void {
  const currentSessionId = get().currentConvId as string | null;
  const targetSessionId = sessionId ?? currentSessionId;
  if (!targetSessionId || targetSessionId !== currentSessionId) {
    if (targetSessionId) {
      for (const channel of ["thinking", "answer"] as const) {
        pendingStreamText.delete(streamBufferKey(targetSessionId, channel));
      }
    }
    return;
  }
  const pendingItems = (["thinking", "answer"] as const)
    .map((channel) => pendingStreamText.get(streamBufferKey(targetSessionId, channel)))
    .filter((item): item is PendingStreamText => Boolean(item));
  if (pendingItems.length === 0) return;
  for (const channel of ["thinking", "answer"] as const) {
    pendingStreamText.delete(streamBufferKey(targetSessionId, channel));
  }
  lastStreamCommitAt = performance.now();
  const state = get() as AppState;
  if (state.currentConvId !== targetSessionId) return;
  useStreamStore.setState((streamState) => {
    let next = streamState.activeStream ?? {
      id: randomUUID(),
      role: "assistant",
      content: "",
      createdAt: Date.now(),
    };
    for (const pending of pendingItems) {
      if (pending.channel === "thinking") {
        const thinking = pending.mode === "snapshot"
          ? pending.text
          : `${next.thinking ?? ""}${pending.text}`;
        next = { ...next, thinking };
      } else {
        const content = pending.mode === "snapshot"
          ? pending.text
          : `${next.content ?? ""}${pending.text}`;
        next = { ...next, content };
      }
    }
    return { activeStream: next };
  });
}

function scheduleStreamCommit(get: any): void {
  if (streamCommitTimer !== null || streamCommitFrame !== null) return;
  const delay = Math.max(
    0,
    STREAM_COMMIT_INTERVAL_MS - (performance.now() - lastStreamCommitAt),
  );
  streamCommitTimer = window.setTimeout(() => {
    streamCommitTimer = null;
    streamCommitFrame = requestAnimationFrame(() => {
      streamCommitFrame = null;
      flushStreamText(get);
      if (pendingStreamText.size > 0) scheduleStreamCommit(get);
    });
  }, delay);
}

function bufferStreamText(ev: any, get: any): void {
  const sessionId = typeof ev.sessionId === "string" ? ev.sessionId : "";
  const relaySequence = Number(ev.relaySequence);
  const text = typeof ev.text === "string" ? ev.text : "";
  const mode = ev.mode === "snapshot" ? "snapshot" : "delta";
  const channel = streamChannel(ev.channel);
  if (!sessionId || !text || get().currentConvId !== sessionId) return;
  const key = streamBufferKey(sessionId, channel);
  const previousSequence = streamSequences.get(key) ?? -1;
  if (
    (mode === "delta" && relaySequence <= previousSequence) ||
    (mode === "snapshot" && relaySequence < previousSequence)
  ) return;
  streamSequences.set(key, relaySequence);
  const pending = pendingStreamText.get(key);
  if (mode === "snapshot") {
    pendingStreamText.set(key, { mode, channel, text, relaySequence });
  } else if (pending && pending.channel === channel) {
    pending.text += text;
    pending.relaySequence = relaySequence;
  } else {
    pendingStreamText.set(key, { mode, channel, text, relaySequence });
  }
  scheduleStreamCommit(get);
}
let uiDialogSequence = 0;
let uiDialogResolver: ((approved: boolean) => void) | null = null;

function normalizeUiDialogOptions(
  options: string | UiDialogOptions,
): UiDialogOptions {
  return typeof options === "string" ? { message: options } : options;
}

/** Keep backend-only edit draft paths out of renderer conversation state. */
function toRendererConversation(
  conversation: Conversation & { expertDraftRoot?: string | null },
): Conversation {
  const { expertDraftRoot: _expertDraftRoot, ...rendererConversation } = conversation;
  return rendererConversation;
}

function closeSSE(): void {
  activeRunStream?.controller.abort();
  activeRunStream = null;
}

function isCurrentRunStream(
  stream: ActiveRunStream,
  get: () => AppState,
): boolean {
  return activeRunStream === stream && !stream.controller.signal.aborted &&
    get().currentConvId === stream.conversationId;
}

function cloudRunStage(status: CloudRunStatus): { phase: string; message: string } | null {
  switch (status) {
    case "queued": return { phase: status, message: "任务已进入队列" };
    case "provisioning": return { phase: status, message: "正在准备云端运行环境" };
    case "running": return { phase: status, message: "正在执行任务" };
    case "waiting_approval": return { phase: status, message: "等待工具执行审批" };
    case "cancelling": return { phase: status, message: "正在取消任务" };
    case "cleanup_pending": return { phase: status, message: "正在清理云端运行环境" };
    default: return null;
  }
}

interface CloudApproval {
  id: string;
  runId: string;
  tool: string;
  input: unknown;
  status: string;
}

interface CloudFileRecord {
  id: string;
  runId: string | null;
  name: string;
  mimeType: string;
  size: number;
}

function cloudPresentedFiles(files: CloudFileRecord[]): PresentedFile[] {
  return files.map((file) => ({
    path: `/cloud-files/${file.id}/${encodeURIComponent(file.name)}`,
    title: file.name,
    type: file.mimeType,
    size: file.size >= 1024 * 1024
      ? `${(file.size / (1024 * 1024)).toFixed(1)} MB`
      : `${Math.max(1, Math.ceil(file.size / 1024))} KB`,
    exists: true,
  }));
}

function withDurableRunError(messages: Message[], run: CloudRun | null): Message[] {
  if (!run || !["failed", "interrupted"].includes(run.status)) return messages;
  const id = `run-error:${run.id}`;
  if (messages.some((message) => message.id === id)) return messages;
  const label = run.status === "interrupted" ? "任务已中断" : "任务执行失败";
  const waitingForUser = run.status === "failed" && run.error === "GOAL_WAITING_FOR_USER";
  return [...messages, {
    id,
    role: "assistant",
    content: waitingForUser
      ? "等待你补充信息后继续，请查看上方说明。"
      : run.error ? `${label}：${run.error}` : label,
    isError: !waitingForUser,
    createdAt: run.updatedAt ? Date.parse(run.updatedAt) : Date.now(),
  }];
}

async function reloadCloudArtifacts(
  conversationId: string,
  set: (patch: Partial<AppState> | ((state: AppState) => Partial<AppState>)) => void,
  get: () => AppState,
  stream?: ActiveRunStream,
  autoOpen = false,
): Promise<void> {
  const [runs, files] = await Promise.all([
    apiGet<CloudRun[]>(`/api/runs?conversationId=${encodeURIComponent(conversationId)}`),
    apiGet<CloudFileRecord[]>("/api/files"),
  ]);
  if (get().currentConvId !== conversationId || (stream && !isCurrentRunStream(stream, get))) return;
  const runIds = new Set(runs.map((run) => run.id));
  const latestBatch = [...get().messages].reverse().find(message =>
    !message.isError && message.toolName === 'present_files' && message.deliveryBatch?.files.length,
  )?.deliveryBatch;
  const presentedFiles = latestBatch?.files ?? cloudPresentedFiles(
    files.filter((file) => file.runId && runIds.has(file.runId)),
  );
  const first = presentedFiles[0];
  set((state) => {
    const currentStillExists = state.previewFile && presentedFiles.some((file) =>
      file.path === state.previewFile?.path
    );
    return {
      presentedFiles: presentedFiles.length ? presentedFiles : null,
      previewFile: currentStillExists
        ? state.previewFile
        : first ? { ...first, toolName: "present_files" } : null,
      ...(autoOpen && first
        ? { showArtifacts: true, panelMode: "preview" as const }
        : {}),
    };
  });
}

async function reloadCloudRunState(
  stream: ActiveRunStream,
  set: (patch: Partial<AppState> | ((state: AppState) => Partial<AppState>)) => void,
  get: () => AppState,
): Promise<CloudRun | null> {
  const [messagesResult, runResult, approvalsResult, questionsResult] = await Promise.allSettled([
    apiGet<Message[] | { messages: Message[]; notice?: "uninstalled" | null }>(
      `/api/msgs/${encodeURIComponent(stream.conversationId)}`,
    ),
    apiGet<CloudRun>(`/api/runs/${encodeURIComponent(stream.runId)}`),
    apiGet<CloudApproval[]>(`/api/runs/${encodeURIComponent(stream.runId)}/approvals`),
    apiGet<Array<{ id: string; questions: AskQuestion[] }>>(`/api/runs/${encodeURIComponent(stream.runId)}/questions`),
  ]);
  if (!isCurrentRunStream(stream, get)) return null;

  // Let the stream retry instead of acknowledging a terminal event before the
  // authoritative messages and run state have actually been recovered.
  if (messagesResult.status === 'rejected') throw messagesResult.reason;
  if (runResult.status === 'rejected') throw runResult.reason;
  if (questionsResult.status === 'rejected') throw questionsResult.reason;

  const patch: Partial<AppState> = {};
  const question = questionsResult.value[0];
  patch.pendingAsk = question ? { requestId: question.id, sessionId: stream.conversationId, questions: question.questions } : null;
  if (messagesResult.status === "fulfilled") {
    const value = messagesResult.value;
    const messages = Array.isArray(value) ? value : value.messages;
    patch.messages = hydrateAssistantThinking(messages);
    patch.expertNotice = !Array.isArray(value) && value.notice === "uninstalled"
      ? "uninstalled"
      : null;
  }
  const run = runResult.status === "fulfilled" ? runResult.value : null;
  if (run) {
    const active = ACTIVE_CLOUD_RUN_STATUSES.has(run.status);
    patch.busy = active;
    patch.taskStatus = active ? cloudRunStage(run.status) : null;
    if (patch.messages) patch.messages = withDurableRunError(patch.messages, run);
  }
  if (approvalsResult.status === "fulfilled") {
    const approval = approvalsResult.value.find((item) => item.status === "pending");
    patch.pendingConfirm = approval
      ? {
        requestId: approval.id,
        toolName: approval.tool,
        args: approval.input,
        sessionId: stream.conversationId,
        runId: approval.runId,
      }
      : null;
  }
  set(patch);
  if (run) get().updateConversationStatus(stream.conversationId, run.status);
  return run;
}

async function handleCloudRunEvent(
  stream: ActiveRunStream,
  event: CloudRunEvent,
  set: (patch: Partial<AppState> | ((state: AppState) => Partial<AppState>)) => void,
  get: () => AppState,
): Promise<void> {
  if (!isCurrentRunStream(stream, get) || event.runId !== stream.runId) return;
  const sequence = ++stream.sequence;
  const payload = event.payload ?? {};

  if (event.type === 'model_activity') {
    set({ taskStatus: payload.phase === 'idle' ? cloudRunStage('running') : { phase: 'model_activity', message: typeof payload.message === 'string' ? payload.message : '正在生成' } });
    return;
  }
  if (event.type === "text_delta") {
    handleEvent({
      type: "stream_text",
      sessionId: stream.conversationId,
      relaySequence: sequence,
      channel: "answer",
      mode: "delta",
      text: typeof payload.text === "string" ? payload.text : "",
    }, set, get);
    return;
  }
  if (event.type === "tool_start") {
    handleEvent({
      type: "tool_execution_start",
      sessionId: stream.conversationId,
      relaySequence: sequence,
      toolCallId: payload.id,
      toolName: payload.name,
      args: payload.args,
    }, set, get);
    return;
  }
  if (event.type === "tool_end") {
    handleEvent({
      type: "tool_execution_end",
      sessionId: stream.conversationId,
      relaySequence: sequence,
      toolCallId: payload.id,
      toolName: payload.name,
      isError: payload.isError === true,
      output: payload.result,
    }, set, get);
    return;
  }
  if (event.type === 'delivery_batch') {
    // The receipt is authoritative even if the worker stops before tool_end.
    await reloadCloudRunState(stream, set, get);
    if (!isCurrentRunStream(stream, get)) return;
    const batch = deliveryBatchFromOutput({ details: payload.details });
    if (batch) {
      const conversation = get().conversations.find(item => item.id === stream.conversationId);
      set({
        presentedFiles: batch.files,
        previewFile: { ...batch.files[0], toolName: 'present_files' },
        ...(shouldAutoOpenArtifactPanel(conversation?.category)
          ? { showArtifacts: true, panelMode: 'preview' as const } : {}),
      });
    }
    return;
  }
  if (event.type === 'ask_user_question') {
    if (typeof payload.requestId === 'string' && Array.isArray(payload.questions)) set({ pendingAsk: {
      requestId: payload.requestId, sessionId: stream.conversationId, questions: payload.questions as AskQuestion[],
    } });
    return;
  }
  if (event.type === 'subagent.lifecycle') {
    await get().loadConversations();
    return;
  }
  if (event.type === 'question_answered') {
    if (get().pendingAsk?.requestId === payload.requestId) set({ pendingAsk: null });
    return;
  }
  if (event.type === "approval") {
    if (typeof payload.id === "string") {
      set({
        pendingConfirm: {
          requestId: payload.id,
          toolName: typeof payload.tool === "string" ? payload.tool : "tool",
          args: payload.input,
          sessionId: stream.conversationId,
          runId: typeof payload.runId === 'string' ? payload.runId : stream.runId,
        },
      });
    }
    return;
  }
  if (event.type === "approval_decided") {
    if (get().pendingConfirm?.requestId === payload.id) set({ pendingConfirm: null });
    return;
  }
  if (event.type === "message") {
    flushStreamText(get, stream.conversationId);
    if (pendingStreamText.size === 0) cancelScheduledStreamCommit();
    await reloadCloudRunState(stream, set, get);
    if (!isCurrentRunStream(stream, get)) return;
    clearActiveStream();
    return;
  }
  if (event.type === "artifact") {
    // Ordered present_files batches arrive with their tool result. Refresh the
    // file inventory without replacing that batch with reverse creation order.
    if (typeof payload.batchToolCallId !== 'string') {
      await reloadCloudArtifacts(stream.conversationId, set, get, stream, true);
    }
    if (!isCurrentRunStream(stream, get)) return;
    window.dispatchEvent(new CustomEvent("cloud-files-changed", {
      detail: { conversationId: stream.conversationId, runId: stream.runId },
    }));
    return;
  }
  if (event.type === 'diagnostic' && typeof payload.message === 'string') {
    set({ taskStatus: { phase: 'running', message: payload.message } });
    return;
  }
  if (event.type === "error") {
    set({
      taskStatus: {
        phase: "error",
        message: typeof payload.message === "string" ? payload.message : "任务执行出现错误",
      },
    });
    return;
  }
  if (event.type !== "status" || typeof payload.status !== "string") return;

  const status = payload.status as CloudRunStatus;
  get().updateConversationStatus(stream.conversationId, status);
  if (!TERMINAL_CLOUD_RUN_STATUSES.has(status)) {
    set({ busy: true, taskStatus: cloudRunStage(status) });
    return;
  }

  flushStreamText(get, stream.conversationId);
  clearActiveStream();
  set({ busy: false, taskStatus: null, pendingConfirm: null });
  await reloadCloudRunState(stream, set, get);
  if (!isCurrentRunStream(stream, get)) return;
  await reloadCloudArtifacts(stream.conversationId, set, get, stream);
  if (!isCurrentRunStream(stream, get)) return;
  window.dispatchEvent(new CustomEvent("cloud-run-terminal", {
    detail: { conversationId: stream.conversationId, runId: stream.runId, status },
  }));
  void get().loadConversations();
  stream.controller.abort();
}

function connectRunStream(
  conversationId: string,
  runId: string,
  set: (patch: Partial<AppState> | ((state: AppState) => Partial<AppState>)) => void,
  get: () => AppState,
): void {
  if (
    activeRunStream?.conversationId === conversationId &&
    activeRunStream.runId === runId &&
    !activeRunStream.controller.signal.aborted
  ) return;
  closeSSE();
  clearStreamBuffers(conversationId);
  const stream: ActiveRunStream = {
    conversationId,
    runId,
    controller: new AbortController(),
    sequence: 0,
  };
  activeRunStream = stream;
  if (get().currentConvId === conversationId) {
    set({ busy: true, taskStatus: { phase: "connecting", message: "正在连接云端任务" } });
  }

  void streamRunEvents({
    runId,
    signal: stream.controller.signal,
    onEvent: (event) => handleCloudRunEvent(stream, event, set, get),
    onReconnect: async () => {
      const run = await reloadCloudRunState(stream, set, get);
      if (run && TERMINAL_CLOUD_RUN_STATUSES.has(run.status) && isCurrentRunStream(stream, get)) {
        flushStreamText(get, stream.conversationId);
        if (pendingStreamText.size === 0) cancelScheduledStreamCommit();
        clearActiveStream();
        await reloadCloudArtifacts(stream.conversationId, set, get, stream);
        if (!isCurrentRunStream(stream, get)) return;
        window.dispatchEvent(new CustomEvent("cloud-run-terminal", {
          detail: {
            conversationId: stream.conversationId,
            runId: stream.runId,
            status: run.status,
          },
        }));
        void get().loadConversations();
        stream.controller.abort();
      }
    },
    onError: (error) => {
      if (!isCurrentRunStream(stream, get)) return;
      set({ taskStatus: { phase: "reconnecting", message: `${error.message}，正在恢复…` } });
    },
  }).catch((error) => {
    if (!isCurrentRunStream(stream, get)) return;
    set({ busy: false, taskStatus: { phase: "error", message: String(error) } });
  }).finally(() => {
    if (activeRunStream === stream) activeRunStream = null;
  });
}

function composerDefaultModelId(settings: AppState["settings"]): string {
  const resourceId = settings.defaultModelResourceId?.trim();
  return resourceId || settings.defaultModelId || "";
}

function adoptDefaultModelForEmptySelection(get: () => AppState): void {
  const state = get();
  if (state.modelProvider.trim() || state.modelId.trim()) return;
  const provider = state.settings.defaultProvider?.trim();
  const modelId = composerDefaultModelId(state.settings);
  if (provider && modelId) state.setModel(provider, modelId);
}

export const useStore = create<AppState>((set, get) => ({
  sidebarCollapsed: false,
  activeCategory: "assistant",
  conversations: [],
  currentConvId: null,
  searchQuery: "",
  workspaces: [],
  composerWorkspaceId: null,
  composerConnectors: [],
  composerConnectorsByConversation: {},
  addComposerConnector: (connector) => set(state => {
    const composerConnectors = addConnectorSelection(state.composerConnectors, connector);
    return {
      composerConnectors,
      ...(state.currentConvId ? { composerConnectorsByConversation: {
        ...state.composerConnectorsByConversation, [state.currentConvId]: composerConnectors,
      } } : {}),
    };
  }),
  removeComposerConnector: (connector) => set(state => {
    const composerConnectors = removeConnectorSelection(state.composerConnectors, connector);
    return {
      composerConnectors,
      ...(state.currentConvId ? { composerConnectorsByConversation: {
        ...state.composerConnectorsByConversation, [state.currentConvId]: composerConnectors,
      } } : {}),
    };
  }),
  expertComposerBootstrap: null,
  expertNotice: null,
  dismissExpertNotice: () => set({ expertNotice: null }),
  expertComposerSkills: {},
  expertComposerExperts: {},
  setExpertComposerExpert: (conversationId, expert) => set((state) => ({
    expertComposerExperts: {
      ...state.expertComposerExperts,
      [conversationId]: expert,
    },
  })),
  clearExpertComposerExpert: (conversationId) => set((state) => {
    const expertComposerExperts = { ...state.expertComposerExperts };
    delete expertComposerExperts[conversationId];
    return { expertComposerExperts };
  }),
  addExpertComposerSkill: (conversationId, skillName) => set((state) => ({
    expertComposerSkills: {
      ...state.expertComposerSkills,
      [conversationId]: addExpertSkill(
        state.expertComposerSkills[conversationId] ?? [],
        skillName,
      ),
    },
  })),
  removeExpertComposerSkill: (conversationId, skillName) => set((state) => ({
    expertComposerSkills: {
      ...state.expertComposerSkills,
      [conversationId]: removeExpertSkill(
        state.expertComposerSkills[conversationId] ?? [],
        skillName,
      ),
    },
  })),
  clearExpertComposerSkills: (conversationId) => set((state) => {
    const expertComposerSkills = { ...state.expertComposerSkills };
    delete expertComposerSkills[conversationId];
    return { expertComposerSkills };
  }),
  consumeExpertComposerBootstrap: (conversationId) => {
    const result = takeExpertComposerBootstrap(
      get().expertComposerBootstrap,
      conversationId,
    );
    if (result.remaining !== get().expertComposerBootstrap) {
      set({ expertComposerBootstrap: result.remaining });
    }
    return result.bootstrap;
  },
  messages: [],
  busy: false,
  taskStatus: null,
  mode: "craft",
  permission: "full",
  theme: "light",
  pendingConfirm: null,
  pendingUiDialog: null,

  respondConfirm: async (approved: boolean) => {
    const confirm = get().pendingConfirm;
    if (!confirm) return;
    try {
      await apiPost("/api/confirm", {
        requestId: confirm.requestId,
        approved,
        sessionId: confirm.sessionId,
        runId: confirm.runId,
      });
      if (get().pendingConfirm?.requestId === confirm.requestId) {
        set({ pendingConfirm: null });
      }
    } catch (e) {
      console.error("[confirm] 发送确认响应失败:", e);
      void get().showUiAlert({
        title: "审批提交失败",
        message: `${(e as Error).message || "网络连接异常"}。审批请求仍保留，请重试。`,
        confirmLabel: "知道了",
        tone: "danger",
      });
    }
  },

  requestUiConfirm: (options) =>
    new Promise<boolean>((resolve) => {
      uiDialogResolver?.(false);
      uiDialogResolver = resolve;
      const normalized = normalizeUiDialogOptions(options);
      set({
        pendingUiDialog: {
          id: ++uiDialogSequence,
          kind: "confirm",
          title: normalized.title ?? "请确认",
          message: normalized.message,
          confirmLabel: normalized.confirmLabel ?? "确认",
          cancelLabel: normalized.cancelLabel ?? "取消",
          tone: normalized.tone ?? "default",
        },
      });
    }),

  showUiAlert: (options) =>
    new Promise<void>((resolve) => {
      uiDialogResolver?.(false);
      uiDialogResolver = () => resolve();
      const normalized = normalizeUiDialogOptions(options);
      set({
        pendingUiDialog: {
          id: ++uiDialogSequence,
          kind: "alert",
          title: normalized.title ?? "提示",
          message: normalized.message,
          confirmLabel: normalized.confirmLabel ?? "知道了",
          tone: normalized.tone ?? "default",
        },
      });
    }),

  resolveUiDialog: (approved) => {
    const resolver = uiDialogResolver;
    uiDialogResolver = null;
    set({ pendingUiDialog: null });
    resolver?.(approved);
  },

  pendingAsk: null,

  respondAsk: async (answers: any) => {
    const ask = get().pendingAsk;
    if (!ask) return;
    try {
      await apiPost("/api/ask-answer", { requestId: ask.requestId, answers });
      if (get().pendingAsk?.requestId === ask.requestId) set({ pendingAsk: null });
    } catch (e) {
      console.error("[ask] 发送回答失败:", e);
      void get().showUiAlert({ title: '回答未提交', message: e instanceof Error ? e.message : '请重试；原问题仍保留。' });
    }
  },

  // 模型与设置
  modelId: "",
  modelProvider: "",
  showSettings: false,
  showArtifacts: false,
  panelMode: "preview" as const,
  setPanelMode: (m) => set({ panelMode: m }),
  previewFile: null,
  openPreview: (target, toolName, batchFiles) => {
    const previewFile: PreviewTarget = typeof target === "string"
      ? { path: target, toolName }
      : { ...target, toolName: target.toolName ?? toolName };
    set({
      previewFile,
      presentedFiles: batchFiles ?? [previewFile],
      showArtifacts: true,
      panelMode: "preview" as const,
    });
  },
  presentedFiles: null,
  clearPresentedFiles: () => set({ presentedFiles: null }),
  showWorkspaceManager: false,
  expertPanelTab: "skill",
  projectTapdAuthorization: false,
  openProjectTapdAuthorization: () => set({ projectTapdAuthorization: true, activeCategory: "expert", expertPanelTab: "connector" }),
  returnFromProjectTapdAuthorization: () => set({ projectTapdAuthorization: false, activeCategory: "project" }),
  showCommandPalette: false,
  setShowCommandPalette: (v) => set({ showCommandPalette: v }),
  setModel: (provider, modelId) =>
    set((state) => ({
      modelProvider: provider,
      modelId,
      conversations: state.currentConvId
        ? state.conversations.map((conversation) =>
          conversation.id === state.currentConvId
            ? { ...conversation, modelProvider: provider, modelId }
            : conversation
        )
        : state.conversations,
    })),
  workspaceCreationDraft: null,

  settings: {
    defaultProvider: "",
    defaultModelId: "",
    defaultModelResourceId: "",
    docsDir: "~/Desktop",
    language: "zh-CN",
    fontSize: "14",
    autoInstallSkills: false,
    keepAwake: false,
    defaultWorkspaceDir: "~/PiCoddy",
    experienceOpt: true,
    agentSystemPrompt:
      "你是一个有用、高效的本地桌面助理，随时帮我处理各种任务。",
    agentTemperature: "0.7",
    agentMaxTokens: "4096",
    searchEngine: "google",
    sandboxSecurity: true,
    deletionProtection: true,
    bulkDeletionLimit: "50",
    builtinRuntime: true,
    runtimePython: true,
    runtimeNodejs: true,
    // 启动后由 /api/settings 注入后端按 process.execPath 解析出的系统安装目录。
    securityFileRules: "[]",
    securityCommandRules: JSON.stringify(["git", "npm", "python"]),
    securityNetworkRules: JSON.stringify([
      "api.deepseek.com",
      "github.com",
    ]),
    ollamaBaseUrl: "http://127.0.0.1:11434",
    customProviders: [],
    providers: [],
    availableProviders: [],
  },
  apiKeys: {},
  memories: [],
  auditLogs: [],

  loadSettings: async () => {
    try {
      const data = await apiGet("/api/settings");
      set((state) => ({
        settings: data,
        ...(!state.currentConvId
          ? {
            modelProvider: data.defaultProvider || "",
            modelId: composerDefaultModelId(data),
          }
          : {}),
      }));
      if (data.fontSize) {
        document.documentElement.style.setProperty(
          "--app-font-size",
          `${data.fontSize}px`,
        );
      }
      const keys = await apiGet("/api/settings/keys");
      set({ apiKeys: keys });
    } catch (e) {
      console.error("[settings] loadSettings error:", e);
    }
  },

  updateSettings: async (patch) => {
    try {
      const current = get().settings;
      const next = { ...current, ...patch };
      const saved = await apiPost<AppState["settings"]>("/api/settings", next);
      set({ settings: saved });
      adoptDefaultModelForEmptySelection(get);
      if (patch.fontSize) {
        document.documentElement.style.setProperty(
          "--app-font-size",
          `${patch.fontSize}px`,
        );
      }
    } catch (e) {
      console.error("[settings] updateSettings error:", e);
      await get().showUiAlert(e instanceof Error ? e.message : "设置保存失败");
    }
  },

  saveApiKey: async (provider, key, model) => {
    try {
      await apiPost("/api/settings/keys", {
        provider,
        key,
        modelId: model.modelId,
        ...(model.modelName ? { modelName: model.modelName } : {}),
        ...(model.resourceId ? { resourceId: model.resourceId } : {}),
      });
      const apiKeys = { ...get().apiKeys, [provider]: true };
      set({ apiKeys });
      await get().loadSettings();
      adoptDefaultModelForEmptySelection(get);
    } catch (e) {
      console.error("[settings] saveApiKey error:", e);
      throw e;
    }
  },

  deleteApiKey: async (provider) => {
    try {
      await apiDelete(`/api/settings/keys/${provider}`);
      const apiKeys = { ...get().apiKeys, [provider]: false };
      set({ apiKeys });
      await get().loadSettings();
    } catch (e) {
      console.error("[settings] deleteApiKey error:", e);
      await get().showUiAlert(e instanceof Error ? e.message : "密钥删除失败");
    }
  },

  testConnection: async (params) => {
    try {
      return await apiPost("/api/settings/test-connection", params);
    } catch (e) {
      return { ok: false, error: (e as Error).message };
    }
  },

  saveCustomProvider: async (data) => {
    try {
      await apiPost("/api/settings/custom-providers", data);
      await get().loadSettings();
      adoptDefaultModelForEmptySelection(get);
    } catch (e) {
      console.error("[settings] saveCustomProvider error:", e);
      throw e;
    }
  },

  deleteCustomProvider: async (id) => {
    try {
      await apiDelete(`/api/settings/custom-providers/${id}`);
      await get().loadSettings();
    } catch (e) {
      console.error("[settings] deleteCustomProvider error:", e);
    }
  },

  fetchOllamaModels: async () => {
    try {
      const res = await apiGet("/api/ollama/models");
      await get().loadSettings();
      return res;
    } catch (e) {
      return { ok: false, running: false, error: (e as Error).message };
    }
  },

  fetchProviderModels: async (provider, apiKey, resourceId) => {
    try {
      return await apiPost(`/api/providers/${encodeURIComponent(provider)}/models`, {
        ...(apiKey?.trim() ? { apiKey: apiKey.trim() } : {}),
        ...(resourceId ? { resourceId } : {}),
      });
    } catch (e) {
      return { ok: false, error: (e as Error).message };
    }
  },

  loadMemories: async () => {
    try {
      const res = await apiGet("/api/memories?limit=500");
      set({ memories: res.items });
    } catch (e) {
      console.error("[settings] loadMemories error:", e);
    }
  },

  deleteMemory: async (id) => {
    try {
      await apiDelete(`/api/memories/${id}`);
      const memories = get().memories.filter((m) => m.id !== id);
      set({ memories });
    } catch (e) {
      console.error("[settings] deleteMemory error:", e);
    }
  },

  loadAuditLogs: async () => {
    try {
      const list = await apiGet("/api/settings/audit-logs");
      set({ auditLogs: list });
    } catch (e) {
      console.error("[settings] loadAuditLogs error:", e);
    }
  },

  toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),

  setCategory: (cat) => {
    set({ activeCategory: cat, projectTapdAuthorization: false });
    // 四个分类都是独立功能模块，暂未开发
  },

  loadConversations: async () => {
    const generation = ++conversationLoadGeneration;
    try {
      const params = new URLSearchParams();
      const s = get();
      if (s.searchQuery) params.set("search", s.searchQuery);
      // 加载全部会话（侧边栏按「任务」/「空间」分组展示）
      const list = await apiGet<Array<Conversation & { expertDraftRoot?: string | null }>>(
        "/api/conv?" + params.toString(),
      );
      if (generation !== conversationLoadGeneration) return;
      set({ conversations: [...list.map(toRendererConversation), ...get().conversations.filter((c) => c.requirementScoped)] });
      // 不自动选中——保持初始界面（欢迎屏+工作空间选择器），对齐 参考设计
    } catch {}
  },

  selectConversation: async (id, options) => {
    syncTaskUrl(id);
    const generation = ++selectionGeneration;
    closeSSE();
    clearStreamBuffers();
    // 选择会话即强制回到聊天视图（退出自动化/专家等独立面板）
    const state = get();
    const selectedConversation = state.conversations.find((c) => c.id === id);
    const composerConnectors = state.composerConnectorsByConversation[id]
      ?? (options?.preserveComposerConnector && state.currentConvId === null ? state.composerConnectors : []);
    set({
      currentConvId: id,
      ...(selectedConversation?.category === 'skill_creator' || selectedConversation?.category === 'expert_creator' ? {mode: 'craft' as const} : {}),
      busy: ACTIVE_CLOUD_RUN_STATUSES.has(
        selectedConversation?.status as CloudRunStatus,
      ),
      taskStatus: null,
      messages: [],
      expertNotice: null,
      presentedFiles: null,
      previewFile: null,
      showArtifacts: false,
      activeCategory: options?.preserveCategory ? get().activeCategory : "assistant",
      composerConnectors,
      composerConnectorsByConversation: { ...state.composerConnectorsByConversation, [id]: composerConnectors },
      ...(selectedConversation
        ? {
          modelProvider: selectedConversation.modelProvider,
          modelId: selectedConversation.modelId,
          composerWorkspaceId: deriveWorkspaceSelection(
            id,
            selectedConversation.workspaceId,
            get().composerWorkspaceId,
          ),
        }
        : {}),
    });
    clearActiveStream();
    // 确保该会话出现在侧边栏列表中（自动化等后台创建的会话需在选入时补进列表）
    const { conversations } = get();
    if (!conversations.find((c) => c.id === id)) {
      get().loadConversations();
    }
    let msgs: Message[] | null = null;
    let activeRun: CloudRun | null = null;
    let runsLoaded = false;
    let conversationRuns: CloudRun[] = [];
    let cloudFiles: CloudFileRecord[] = [];
    let expertNotice: "uninstalled" | null = null;
    try {
      const [messagesResult, runsResult, filesResult] = await Promise.allSettled([
        apiGet<Message[] | { messages: Message[]; notice?: "uninstalled" | null }>(
          "/api/msgs/" + id,
        ),
        apiGet<CloudRun[]>(`/api/runs?conversationId=${encodeURIComponent(id)}`),
        apiGet<CloudFileRecord[]>("/api/files"),
      ]);
      if (messagesResult.status === "fulfilled") {
        const result = messagesResult.value;
        if (Array.isArray(result)) {
          msgs = result;
        } else if (result && Array.isArray(result.messages)) {
          msgs = result.messages;
          expertNotice = result.notice === "uninstalled" ? result.notice : null;
        }
        if (msgs) msgs = hydrateAssistantThinking(msgs);
      }
      if (runsResult.status === "fulfilled") {
        runsLoaded = true;
        conversationRuns = runsResult.value;
        activeRun = conversationRuns.find((run) => ACTIVE_CLOUD_RUN_STATUSES.has(run.status)) ?? null;
      }
      if (filesResult.status === "fulfilled") cloudFiles = filesResult.value;
    } catch {
      // 读取失败时保留当前选择的空消息状态；过期选择不得影响新会话。
    }
    if (
      selectionGeneration !== generation ||
      get().currentConvId !== id
    ) return;
    const runIds = new Set(conversationRuns.map((run) => run.id));
    const presentedFiles = cloudPresentedFiles(
      cloudFiles.filter((file) => file.runId && runIds.has(file.runId)),
    );
    const latestRun = conversationRuns[0] ?? null;
    const restoredMessages = msgs
      ? withDurableRunError(msgs, latestRun)
      : withDurableRunError([], latestRun);
    set({
      ...(msgs || restoredMessages.length ? { messages: restoredMessages, expertNotice } : {}),
      presentedFiles: presentedFiles.length ? presentedFiles : null,
      previewFile: presentedFiles[0]
        ? { ...presentedFiles[0], toolName: "present_files" }
        : null,
      ...(runsLoaded
        ? {
          busy: activeRun !== null,
          taskStatus: activeRun ? cloudRunStage(activeRun.status) : null,
        }
        : {}),
    });
    if (activeRun) connectRunStream(id, activeRun.id, set, get);
  },

  createConversation: async (title = "新对话") => {
    const state = get();
    const wsId = state.composerWorkspaceId; // Composer 里选的空间
    const conv = await apiPost<Conversation>("/api/conv", {
      title,
      workspaceId: wsId,
      modelProvider: state.modelProvider,
      modelId: state.modelId,
    });
    // 会话创建后保留其持久化工作空间绑定，后续消息和产物继续使用同一空间。
    set({
      composerWorkspaceId: deriveWorkspaceSelection(
        conv.id,
        conv.workspaceId,
        wsId,
      ),
    });
    await get().loadConversations();
    await get().selectConversation(conv.id, { preserveComposerConnector: true });
    return conv.id;
  },

  resetToWelcome: (options) => {
    syncTaskUrl(null);
    selectionGeneration += 1;
    closeSSE();
    clearStreamBuffers();
    set({
      currentConvId: null,
      taskStatus: null,
      messages: [],
      presentedFiles: null,
      previewFile: null,
      showArtifacts: false,
      expertNotice: null,
      composerWorkspaceId: null,
      composerConnectors: options?.preserveComposerConnectors ? get().composerConnectors : [],
      busy: false,
      activeCategory: "assistant",
    });
    clearActiveStream();
  },

  deleteConversation: async (id) => {
    await apiDelete("/api/conv/" + id);
    get().clearExpertComposerSkills(id);
    get().clearExpertComposerExpert(id);
    set(state => {
      const composerConnectorsByConversation = { ...state.composerConnectorsByConversation };
      delete composerConnectorsByConversation[id];
      return { composerConnectorsByConversation };
    });
    if (get().currentConvId === id) {
      syncTaskUrl(null, window, true);
      selectionGeneration += 1;
      closeSSE();
      clearStreamBuffers();
      set({
        currentConvId: null,
        messages: [],
        presentedFiles: null,
        previewFile: null,
        showArtifacts: false,
        expertNotice: null,
        composerConnectors: [],
      });
      clearActiveStream();
    }
    await get().loadConversations();
  },

  sendMessage: async (text, options) => {
    const s = get();
    const attachmentIds = options?.attachmentIds ??
      options?.attachments?.map((attachment) => attachment.id) ??
      [];
    if (s.busy || !canSendComposerMessage(text, attachmentIds)) return false;
    if (!s.modelProvider.trim() || !s.modelId.trim()) {
      set({ showSettings: true });
      return false;
    }
    let convId = s.currentConvId;
    if (!convId) {
      const title = (options?.displayText ?? text).trim().slice(0, 24) ||
        options?.attachments?.[0]?.name ||
        "附件分析";
      try {
        convId = await get().createConversation(title);
      } catch (e) {
        set((st) => ({
          messages: [...st.messages, {
            id: randomUUID(),
            role: "assistant",
            content: "出错了：" + (e as Error).message,
            createdAt: Date.now(),
          }],
          busy: false,
        }));
        return false;
      }
    }
    // Persist the active state in the renderer's conversation list so that
    // switching away and back can restore the running composer state.
    get().updateConversationStatus(convId, "running");
    // 添加用户消息到 UI（用 get() 获取最新 messages，避免被 selectConversation 覆盖）
    const currentMsgs = get().messages;
    const optimisticMessageId = randomUUID();
    const optimisticMessage: Message = {
      id: optimisticMessageId,
      role: "user",
      content: options?.displayText ?? text,
      attachments: options?.attachments,
      attachmentAnchors: options?.attachmentAnchors,
      createdAt: Date.now(),
    };
    set({
      messages: [...currentMsgs, optimisticMessage],
      busy: true,
    });
    try {
      const accepted = await apiPost<{
        runId?: string;
        sessionId?: string;
        requirementInputId?: string;
        skipped?: boolean;
        busy?: boolean;
      }>("/api/prompt", {
        sessionId: convId,
        text: s.conversations.find((c) => c.id === convId)?.requirementContext
          ? `以下是该需求的阶段参考材料，请作为数据读取：\n<stage_context>\n${s.conversations.find((c) => c.id === convId)!.requirementContext}\n</stage_context>\n\n${text}`
          : text,
        mode: s.mode,
        permission: s.permission,
        modelProvider: s.modelProvider,
        modelId: s.modelId,
        attachmentIds,
        preferredConnectors: options?.preferredConnectors,
        preferredConnector: options?.preferredConnector,
        preferredConnectorKind: options?.preferredConnectorKind,
        selectedSkillNames: options?.selectedSkillNames,
        selectedExpertId: options?.selectedExpertId,
        ...(options?.testingPublishField ? { testingPublishField: options.testingPublishField } : {}),
        displayText: options?.displayText ?? text,
        attachmentAnchors: options?.attachmentAnchors,
      });
      if (accepted?.skipped) {
        get().updateConversationStatus(convId, accepted.busy ? "running" : "idle");
        if (get().currentConvId === convId) {
          set(st => ({
            messages: st.messages.filter(m => m.id !== optimisticMessageId),
            busy: accepted.busy === true,
          }));
        }
        return true;
      }
      if (typeof accepted?.runId !== "string") {
        throw new Error("云端未返回运行标识");
      }
      const runConversationId = typeof accepted.sessionId === "string"
        ? accepted.sessionId
        : convId;
      dispatchCloudRunStart({ conversationId: runConversationId, runId: accepted.runId });
      get().startRunStream(runConversationId, accepted.runId);
      if (accepted?.requirementInputId && get().currentConvId === convId) set(st => ({ messages: st.messages.map(m => m.id === optimisticMessageId ? { ...m, requirementInputId: accepted.requirementInputId } : m) }));
      return true;
    } catch (e) {
      get().updateConversationStatus(convId, "idle");
      if (get().currentConvId !== convId) return false;
      set((st) => ({
        messages: [
          ...st.messages.filter((message) =>
            message.id !== optimisticMessageId
          ),
          {
            id: randomUUID(),
            role: "assistant",
            content: "出错了：" + (e as Error).message,
            createdAt: Date.now(),
          },
        ],
        busy: false,
      }));
      clearActiveStream();
      return false;
    }
  },

  abortGeneration: async () => {
    const id = get().currentConvId;
    if (!id) return;
    try {
      const cancelled = await apiPost<{
        runId?: string;
        status?: string;
        alreadyStopped?: boolean;
      }>(
        "/api/abort",
        { sessionId: id, runId: activeRunStream?.runId },
      );
      get().updateConversationStatus(
        id,
        typeof cancelled.status === "string"
          ? cancelled.status
          : cancelled.alreadyStopped ? "idle" : "cancelling",
      );
      if (get().currentConvId !== id) return;
      if (cancelled.alreadyStopped) {
        closeSSE();
        clearStreamBuffers(id);
        clearActiveStream();
        set({ busy: false, taskStatus: null });
        return;
      }
      if (typeof cancelled.runId === "string") {
        get().startRunStream(id, cancelled.runId);
      }
      set({ busy: true, taskStatus: cloudRunStage("cancelling") });
    } catch (error) {
      if (get().currentConvId === id) {
        set({ taskStatus: { phase: "error", message: (error as Error).message } });
      }
    }
  },

  startRunStream: (conversationId, runId) => {
    if (get().currentConvId !== conversationId) return;
    connectRunStream(conversationId, runId, set, get);
  },

  setMode: (m) => set({ mode: m }),
  setPermission: (p) => set({ permission: p }),

  toggleTheme: () => {
    const next = get().theme === "dark" ? "light" : "dark";
    set({ theme: next });
    document.documentElement.dataset.theme = next;
    try {
      localStorage.setItem("pi-a-theme", next);
    } catch {}
  },

  setShowSettings: (v) => set({ showSettings: v }),
  setShowArtifacts: (v) => set({ showArtifacts: v }),
  setBusy: (v: boolean) => set({ busy: v }),
  updateLastMessage: (id: string, content: string) => set((s) => ({ messages: s.messages.map((m) => m.id === id ? { ...m, content } : m) })),
  updateConversationStatus: (id: string, status: string) => set((s) => ({
    conversations: s.conversations.map((c) => c.id === id ? { ...c, status } : c),
    // Background sessions update the sidebar, but never lock this composer.
    // Intermediate idle/done notifications must not unlock an active stream.
    ...(s.currentConvId === id && ["running", "pending", "initializing"].includes(status)
      ? { busy: true }
      : {}),
  })),
  setShowWorkspaceManager: (v) => set({ showWorkspaceManager: v }),
  openWorkspaceCreator: (draft) =>
    set({
      workspaceCreationDraft: draft ?? {
        source: "blank",
        name: "",
        dirPath: "",
        icon: "folder",
      },
      showWorkspaceManager: true,
    }),
  clearWorkspaceCreationDraft: () => set({ workspaceCreationDraft: null }),
  setExpertPanelTab: (expertPanelTab) => set({ expertPanelTab }),
  setComposerWorkspaceId: (id) => set({ composerWorkspaceId: id }),

  // ===== 工作空间 =====
  loadWorkspaces: async () => {
    try {
      const list = await apiGet<Workspace[]>("/api/workspaces");
      // 不自动创建默认空间——空间由用户主动创建
      set({ workspaces: list });
    } catch {}
  },

  selectWorkspace: (id) => {
    set({ composerWorkspaceId: id });
  },

  createWorkspace: async (name, dirPath, icon) => {
    const ws = await apiPost<Workspace>("/api/workspaces", {
      name,
      dirPath: dirPath || "",
      icon: icon || "folder",
    });
    await get().loadWorkspaces();
    if (!get().workspaces.some((workspace) => workspace.id === ws.id)) {
      set((state) => ({
        workspaces: [
          ws,
          ...state.workspaces.filter((workspace) => workspace.id !== ws.id),
        ],
      }));
    }
    return ws;
  },

  activateWorkspace: async (id) => {
    const target = resolveWorkspaceActivationTarget(get().currentConvId);
    if (target.kind === "composer") {
      set({ composerWorkspaceId: id });
      return;
    }
    const previousWorkspaceId = get().conversations.find((conversation) =>
      conversation.id === target.conversationId
    )?.workspaceId;
    set((state) => ({
      conversations: state.conversations.map((conversation) =>
        conversation.id === target.conversationId
          ? { ...conversation, workspaceId: id ?? undefined }
          : conversation
      ),
    }));
    try {
      await get().assignConversation(target.conversationId, id);
    } catch (error) {
      set((state) => ({
        conversations: state.conversations.map((conversation) =>
          conversation.id === target.conversationId
            ? { ...conversation, workspaceId: previousWorkspaceId }
            : conversation
        ),
      }));
      throw error;
    }
  },

  updateWorkspace: async (id, patch) => {
    await apiPut("/api/workspaces/" + id, patch);
    await get().loadWorkspaces();
  },

  deleteWorkspace: async (id) => {
    await apiDelete("/api/workspaces/" + id);
    // 清除 composer 选择如果删的是当前选的
    if (get().composerWorkspaceId === id) set({ composerWorkspaceId: null });
    await get().loadWorkspaces();
    await get().loadConversations();
  },

  assignConversation: async (convId, workspaceId) => {
    await apiPost(`/api/conversations/${encodeURIComponent(convId)}/workspace`, {
      workspaceId,
    });
    set((state) => ({
      conversations: state.conversations.map((conversation) =>
        conversation.id === convId
          ? { ...conversation, workspaceId: workspaceId ?? undefined }
          : conversation
      ),
    }));
    await get().loadConversations();
  },
}));

// SSE 事件处理
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

function handleEvent(ev: any, set: any, get: any) {
  const sessionId = typeof ev.sessionId === "string" ? ev.sessionId : "";
  const relaySequence = Number(ev.relaySequence);
  if (!sessionId || get().currentConvId !== sessionId) return;
  if (resyncingSessions.has(sessionId) && ev.type !== "stream_resync_required") {
    const queued = queuedResyncEvents.get(sessionId) ?? [];
    queued.push(ev);
    queuedResyncEvents.set(sessionId, queued);
    return;
  }
  if (ev.type === "stream_resync_required") {
    if (Number.isSafeInteger(relaySequence)) {
      streamSequences.set(sessionId, relaySequence);
      streamSequences.set(streamBufferKey(sessionId, "answer"), relaySequence);
      streamSequences.set(streamBufferKey(sessionId, "thinking"), relaySequence);
    }
    pendingStreamText.delete(streamBufferKey(sessionId, "answer"));
    pendingStreamText.delete(streamBufferKey(sessionId, "thinking"));
    const resyncText = typeof ev.text === "string" ? ev.text : "";
    const resyncThinking = typeof ev.thinking === "string" ? ev.thinking : "";
    if (resyncText || resyncThinking) {
      useStreamStore.setState({
        activeStream: {
          id: randomUUID(),
          role: "assistant",
          content: resyncText,
          thinking: resyncThinking || undefined,
          createdAt: Date.now(),
        },
      });
    } else {
      clearActiveStream();
    }
    resyncingSessions.add(sessionId);
    queuedResyncEvents.set(sessionId, []);
    void apiGet<
      Message[] | { messages: Message[]; notice?: "uninstalled" | null }
    >("/api/msgs/" + sessionId).then((result) => {
      if (get().currentConvId !== sessionId) return;
      const messages = Array.isArray(result) ? result : result.messages;
      set({ messages: hydrateAssistantThinking(messages) });
    }).catch((error) => {
      console.error("[SSE] 会话消息重同步失败:", error);
    }).finally(() => {
      const queued = queuedResyncEvents.get(sessionId) ?? [];
      queuedResyncEvents.delete(sessionId);
      resyncingSessions.delete(sessionId);
      if (get().currentConvId !== sessionId) return;
      for (const event of queued) handleEvent(event, set, get);
    });
    return;
  }
  if (!Number.isSafeInteger(relaySequence)) return;
  if (ev.type !== "stream_text") {
    const previousSequence = streamSequences.get(sessionId) ?? -1;
    if (relaySequence <= previousSequence) return;
    streamSequences.set(sessionId, relaySequence);
  } else {
    const previousSequence = streamSequences.get(sessionId) ?? -1;
    if (relaySequence > previousSequence) {
      streamSequences.set(sessionId, relaySequence);
    }
  }
  if (ev.type === "agent_start") {
    set({ busy: true, taskStatus: null });
  } else if (ev.type === "task_status") {
    if (typeof ev.phase === "string" && typeof ev.message === "string") {
      set({ busy: true, taskStatus: { phase: ev.phase, message: ev.message } });
    }
  } else if (ev.type === "stream_text") {
    bufferStreamText(ev, get);
  } else if (ev.type === "message_end") {
    flushStreamText(get, sessionId);
    if (pendingStreamText.size === 0) cancelScheduledStreamCommit();
    const text = assistantEventText(ev.message);
    const thinking = assistantEventThinking(ev.message);
    if (ev.message?.role !== "assistant") return;
    set((state: AppState) => {
      const activeStream = useStreamStore.getState().activeStream;
      if (!text && !thinking && !activeStream) return {};
      const completed: Message = activeStream
        ? {
          ...activeStream,
          content: text || activeStream.content,
          thinking: thinking || activeStream.thinking,
          isError: ev.message?.stopReason === "error" || (ev.message?.stopReason === "length" && !ev.message?.runtimeRecovery),
        }
        : {
          id: randomUUID(),
          role: "assistant",
          content: text,
          thinking: thinking || undefined,
          isError: ev.message?.stopReason === "error" || (ev.message?.stopReason === "length" && !ev.message?.runtimeRecovery),
          createdAt: Date.now(),
        };
      if (!completed.content && !completed.thinking) return {};
      return {
        messages: [...state.messages, completed],
      };
    });
    clearActiveStream();
  } else if (ev.type === "tool_preparing") {
    const toolName = typeof ev.toolName === "string" ? ev.toolName : "tool";
    const toolCallId = typeof ev.toolCallId === "string" ? ev.toolCallId : "";
    set((st: AppState) => {
      const exists = st.messages.some((message) =>
        (toolCallId && message.id === toolCallId) ||
        (message.role === "tool" &&
          message.status === "running" &&
          message.toolName === toolName)
      );
      if (exists) return {};
      return {
        messages: [...st.messages, {
          id: toolCallId || `preparing:${toolName}:${Date.now()}`,
          role: "tool",
          content: "",
          toolName,
          status: "running" as const,
          createdAt: Date.now(),
          isError: false,
        }],
      };
    });
  } else if (ev.type === "tool_execution_start") {
    set((st: AppState) => {
      const args = typeof ev.args === "string"
        ? ev.args
        : JSON.stringify(ev.args ?? {});
      const existingIndex = st.messages.findIndex((message) =>
        message.id === ev.toolCallId ||
        (message.role === "tool" &&
          message.status === "running" &&
          message.toolName === ev.toolName)
      );
      const nextMessage: Message = {
        id: ev.toolCallId,
        role: "tool",
        content: existingIndex >= 0 ? st.messages[existingIndex].content : "",
        toolName: ev.toolName,
        toolArgs: args,
        status: "running",
        createdAt: existingIndex >= 0
          ? st.messages[existingIndex].createdAt
          : Date.now(),
        isError: false,
        widget: existingIndex >= 0 ? st.messages[existingIndex].widget : undefined,
      };
      if (existingIndex < 0) {
        return { messages: [...st.messages, nextMessage] };
      }
      return {
        messages: st.messages.map((message, index) =>
          index === existingIndex ? nextMessage : message
        ),
      };
    });
  } else if (ev.type === "tool_execution_end") {
    set((st: AppState) => {
      const outputStr = getToolOutputString(ev.output);
      const deliveryBatch = !ev.isError && ev.toolName === "present_files"
        ? deliveryBatchFromOutput(ev.output)
        : null;
      const widget = !ev.isError && ev.toolName === "show_widget"
        ? (ev.output?.details?.widget as WidgetData | undefined)
        : undefined;
      const msgs: Message[] = st.messages.map((m): Message =>
        m.id === ev.toolCallId
          ? {
            ...m,
            content: outputStr,
            widget,
            deliveryBatch: deliveryBatch ?? undefined,
            status: ev.isError ? "error" as const : "success" as const,
            isError: ev.isError,
          }
          : m
      );
      const patch: Partial<AppState> = { messages: msgs };
      // present_files 交付：按序展示，第一个自动打开
      // 技能创建会话由中间的 SkillDraftPanel 展示草稿文件，不弹出右侧预览面板
      if (deliveryBatch) {
        const first = deliveryBatch.files[0];
        patch.presentedFiles = deliveryBatch.files;
        patch.previewFile = { ...first, toolName: "present_files" };
        const currentConv = get().conversations.find(
          (c: Conversation) => c.id === get().currentConvId,
        );
        if (shouldAutoOpenArtifactPanel(currentConv?.category)) {
          patch.showArtifacts = true;
          patch.panelMode = "preview";
        }
      }
      return patch;
    });
  } else if (ev.type === "agent_end") {
    flushStreamText(get, ev.sessionId);
    clearActiveStream();
    set({ busy: false, taskStatus: null });
    get().loadConversations();
  } else if (ev.type === "tool_confirmation") {
    // 对标 参考设计 permissionRequest 流程：
    // 后端发来工具确认请求，展示确认弹窗
    set({
      pendingConfirm: {
        requestId: ev.requestId,
        toolName: ev.toolName,
        args: ev.args,
        sessionId: ev.sessionId,
      },
    });
  } else if (ev.type === "ask_user_question") {
    // 后端发来交互式提问（AskUserQuestion），展示提问卡片
    set({
      pendingAsk: {
        requestId: ev.requestId,
        sessionId: ev.sessionId,
        questions: ev.questions,
      },
    });
  }
}
