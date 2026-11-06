// src/domains/session/node/store.ts
// 会话持久化。对照 03 文档 §4.5：SQLite 元数据 + provider 内存态。

import { getDb } from "../../../infra/db.ts";
import { ordinaryConversationCondition } from "../../requirement/node/store.ts";
import {
  attachToMessage,
  decodeAttachmentLayout,
  listMessageAttachments,
} from "../../attachment/node/store.ts";
import {
  assistantAnswerText,
  copyMessageContentParts,
  deleteMessageContentPartsForConversation,
  extractAssistantResponseParts,
  listMessageContentPartsByIds,
  replaceMessageContentParts,
  type AssistantContentPart,
} from "./message_content.ts";
import {
  didAssistantResponseFail,
  type AssistantLikeMessage,
} from "../../../agent/history.ts";
import { deleteAgentChildrenForParent } from "../../connector/node/agent_session_store.ts";
import type {
  ExpertBinding,
  ExpertCatalogSource,
} from "../../../agent/experts/types.ts";
import { createExpertBindingStore } from "./expert_binding_store.ts";
import { normalizeModelId } from "../../../agent/model_defaults.ts";

type ExpertOperation = "create" | "edit";
type ExpertNotice = "uninstalled";

export interface Conversation {
  id: string;
  title: string;
  category: string; // assistant | project | expert | automation
  status: string; // idle | running | done | failed | pending | planning
  modelProvider: string;
  modelId: string;
  workspaceId?: string | null;
  parentId?: string | null;
  expertId?: string | null;
  expertRevision?: string | null;
  expertCatalogSource?: ExpertCatalogSource | null;
  expertOperation?: ExpertOperation | null;
  expertTargetId?: string | null;
  expertTargetRevision?: string | null;
  /** Internal only; never include this field in renderer-facing DTOs. */
  expertDraftRoot?: string | null;
  expertNotice?: ExpertNotice | null;
  skillOperation?: ExpertOperation | null;
  skillTargetName?: string | null;
  createdAt: number;
  updatedAt: number;
}

/** Renderer-safe conversation DTO; draft roots remain backend-only metadata. */
export type RendererConversation = Omit<Conversation, "expertDraftRoot">;

export interface MessageRecord {
  id: string;
  conversationId: string;
  role: string;
  content: string;
  toolName?: string;
  toolArgs?: string;
  isError: boolean;
  createdAt: number;
  parentId?: string;
  attachments: PublicAttachment[];
  attachmentAnchors?: Record<string, number>;
  contentParts?: AssistantContentPart[];
}

export interface PublicAttachment {
  id: string;
  name: string;
  mimeType: string;
  extension: string;
  size: number;
}

function uuid(): string {
  return crypto.randomUUID();
}

function normalizeExpertCatalogSource(value: unknown): ExpertCatalogSource | null {
  return value === "builtin" || value === "installed" || value === "catalog"
    ? value
    : null;
}

function normalizeExpertOperation(value: unknown): ExpertOperation | null {
  return value === "create" || value === "edit" ? value : null;
}

function normalizeExpertNotice(value: unknown): ExpertNotice | null {
  return value === "uninstalled" ? value : null;
}

function mapConversationRow(row: Record<string, unknown>): Conversation {
  return {
    ...(row as unknown as Conversation),
    expertCatalogSource: normalizeExpertCatalogSource(row.expertCatalogSource),
    expertOperation: normalizeExpertOperation(row.expertOperation),
    expertNotice: normalizeExpertNotice(row.expertNotice),
    skillOperation: normalizeExpertOperation(row.skillOperation),
  };
}

/** 新建会话 */
export function createConversation(
  title = "新对话",
  category = "assistant",
  workspaceId?: string | null,
  parentId?: string | null,
  selectedModel?: { provider: string; modelId: string },
  expertOperation?: ExpertOperation | null,
): Conversation {
  const db = getDb();
  const id = uuid();
  const now = Date.now();

  // 查询全局默认模型设置
  let provider = "deepseek";
  let modelId = "deepseek-v4-flash";
  try {
    const rowProv = db.prepare(
      "SELECT value FROM settings WHERE key = 'default_provider'",
    ).get() as { value: string } | undefined;
    const rowModel = db.prepare(
      "SELECT value FROM settings WHERE key = 'default_model_id'",
    ).get() as { value: string } | undefined;
    if (rowProv) provider = rowProv.value;
    if (rowModel) modelId = normalizeModelId(provider, rowModel.value);
  } catch { /* 表不存在或未初始化 */ }

  if (selectedModel?.provider.trim() && selectedModel.modelId.trim()) {
    provider = selectedModel.provider.trim();
    modelId = normalizeModelId(provider, selectedModel.modelId);
  }

  db.prepare(
    "INSERT INTO conversations (id, title, category, status, model_provider, model_id, workspace_id, parent_id, expert_operation, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
  ).run(
    id,
    title,
    category,
    "idle",
    provider,
    modelId,
    workspaceId ?? null,
    parentId ?? null,
    normalizeExpertOperation(expertOperation),
    now,
    now,
  );
  return {
    id,
    title,
    category,
    status: "idle",
    modelProvider: provider,
    modelId: modelId,
    workspaceId: workspaceId ?? null,
    parentId: parentId ?? null,
    expertId: null,
    expertRevision: null,
    expertCatalogSource: null,
    expertOperation: normalizeExpertOperation(expertOperation),
    expertTargetId: null,
    expertTargetRevision: null,
    expertDraftRoot: null,
    expertNotice: null,
    skillOperation: null,
    skillTargetName: null,
    createdAt: now,
    updatedAt: now,
  };
}

/** Removes backend-only draft metadata before serializing a conversation. */
export function toRendererConversation(
  conversation: Conversation,
): RendererConversation {
  const { expertDraftRoot: _expertDraftRoot, ...rendererConversation } = conversation;
  return rendererConversation;
}

export function updateConversationModel(
  id: string,
  provider: string,
  modelId: string,
): void {
  getDb().prepare(
    "UPDATE conversations SET model_provider = ?, model_id = ?, updated_at = ? WHERE id = ?",
  ).run(provider, modelId, Date.now(), id);
}

/** 列出会话（可按分类/状态/工作空间筛选 + 关键词搜索，按更新时间倒序） */
export function listConversations(
  category?: string,
  search?: string,
  status?: string,
  workspaceId?: string | null,
  scope: "all" | "ordinary" = "all",
): Conversation[] {
  const db = getDb();
  const conds: string[] = [];
  const params: unknown[] = [];
  if (scope === "ordinary") conds.push(ordinaryConversationCondition);
  if (category && category !== "all") {
    conds.push("category = ?");
    params.push(category);
  } else {
    // 隐藏的 connector child 会话不出现在默认/全部会话列表
    conds.push("category <> 'connector-agent'");
  }
  if (search && search.trim()) {
    conds.push("LOWER(title) LIKE ?");
    params.push(`%${search.trim().toLowerCase()}%`);
  }
  if (status && status !== "all") {
    conds.push("status = ?");
    params.push(status);
  }
  if (workspaceId) {
    conds.push("workspace_id = ?");
    params.push(workspaceId);
  }
  const where = conds.length ? "WHERE " + conds.join(" AND ") : "";
  const stmt = db.prepare(
    `SELECT id, title, category, status, model_provider as modelProvider, model_id as modelId, workspace_id as workspaceId, parent_id as parentId,
            expert_id as expertId, expert_revision as expertRevision, expert_catalog_source as expertCatalogSource,
            expert_operation as expertOperation, expert_target_id as expertTargetId,
            expert_target_revision as expertTargetRevision, expert_draft_root as expertDraftRoot,
            expert_notice as expertNotice,
            skill_operation as skillOperation, skill_target_name as skillTargetName,
            created_at as createdAt, updated_at as updatedAt
       FROM conversations ${where} ORDER BY updated_at DESC`,
  );
  const rows = stmt.all(...(params as any[])) as unknown as Record<string, unknown>[];
  return rows.map(mapConversationRow);
}

/** Reads one conversation and its persisted expert binding. */
export function getConversation(id: string): Conversation | null {
  const row = getDb().prepare(
    `SELECT id, title, category, status,
            model_provider as modelProvider, model_id as modelId,
            workspace_id as workspaceId, parent_id as parentId,
            expert_id as expertId, expert_revision as expertRevision,
            expert_catalog_source as expertCatalogSource,
            expert_operation as expertOperation, expert_target_id as expertTargetId,
            expert_target_revision as expertTargetRevision, expert_draft_root as expertDraftRoot,
            expert_notice as expertNotice,
            skill_operation as skillOperation, skill_target_name as skillTargetName,
            created_at as createdAt, updated_at as updatedAt
       FROM conversations WHERE id = ?`,
  ).get(id) as Record<string, unknown> | undefined;
  return row ? mapConversationRow(row) : null;
}

/** Persists or clears the complete session expert binding. */
export function setConversationExpert(
  id: string,
  binding: ExpertBinding | null,
): void {
  createExpertBindingStore(getDb()).set(id, binding);
  touchConversation(id);
}

/** Persists the pinned target and isolated draft for a skill edit session. */
export function setSkillEditMetadata(
  conversationId: string,
  input: { targetName: string },
): void {
  const result = getDb().prepare(
    `UPDATE conversations
     SET skill_operation = 'edit',
         skill_target_name = ?,
         updated_at = ?
     WHERE id = ?`,
  ).run(input.targetName, Date.now(), conversationId);
  if (Number(result.changes) !== 1) {
    throw new Error(`skill edit metadata update failed: ${conversationId}`);
  }
}

/** Persists the pinned target and isolated draft for an expert edit session. */
export function setExpertEditMetadata(
  conversationId: string,
  input: {
    targetId: string;
    targetRevision: string;
    draftRoot: string;
  },
): void {
  const result = getDb().prepare(
    `UPDATE conversations
     SET expert_operation = 'edit',
         expert_target_id = ?,
         expert_target_revision = ?,
         expert_draft_root = ?,
         updated_at = ?
     WHERE id = ?`,
  ).run(
    input.targetId,
    input.targetRevision,
    input.draftRoot,
    Date.now(),
    conversationId,
  );
  if (Number(result.changes) !== 1) {
    throw new Error(`expert edit metadata update failed: ${conversationId}`);
  }
}

function selectConversationIdsByExpert(expertId: string): string[] {
  const rows = getDb().prepare(
    "SELECT id FROM conversations WHERE expert_id = ? ORDER BY updated_at DESC",
  ).all(expertId) as unknown as Array<{ id: string }>;
  return rows.map((row) => row.id);
}

/** Lists conversation IDs currently bound to an expert without changing state. */
export function listConversationIdsByExpert(expertId: string): string[] {
  return selectConversationIdsByExpert(expertId);
}

/**
 * Atomically clears all bindings for an uninstalled expert and records a
 * one-shot notice on every affected conversation.
 */
export function clearExpertBindingsForUninstall(expertId: string): string[] {
  const db = getDb();
  let transactionStarted = false;
  try {
    db.exec("BEGIN");
    transactionStarted = true;
    const affectedConversationIds = selectConversationIdsByExpert(expertId);
    db.prepare(
      `UPDATE conversations
       SET expert_id = NULL,
           expert_revision = NULL,
           expert_catalog_source = NULL,
           expert_notice = 'uninstalled'
       WHERE expert_id = ?`,
    ).run(expertId);
    db.exec("COMMIT");
    transactionStarted = false;
    return affectedConversationIds;
  } catch (error) {
    if (transactionStarted) {
      try { db.exec("ROLLBACK"); } catch { /* preserve original error */ }
    }
    throw error;
  }
}

/** Reads and clears one conversation's uninstall notice in one transaction. */
export function consumeExpertNotice(conversationId: string): ExpertNotice | null {
  const db = getDb();
  let transactionStarted = false;
  try {
    db.exec("BEGIN");
    transactionStarted = true;
    const row = db.prepare(
      "SELECT expert_notice as expertNotice FROM conversations WHERE id = ?",
    ).get(conversationId) as { expertNotice?: unknown } | undefined;
    db.prepare(
      "UPDATE conversations SET expert_notice = NULL WHERE id = ?",
    ).run(conversationId);
    db.exec("COMMIT");
    transactionStarted = false;
    return normalizeExpertNotice(row?.expertNotice);
  } catch (error) {
    if (transactionStarted) {
      try { db.exec("ROLLBACK"); } catch { /* preserve original error */ }
    }
    throw error;
  }
}

/** 重命名 */
export function renameConversation(id: string, title: string): void {
  const db = getDb();
  db.prepare("UPDATE conversations SET title = ?, updated_at = ? WHERE id = ?")
    .run(title, Date.now(), id);
}

/** 更改分类 */
export function moveConversation(id: string, category: string): void {
  const db = getDb();
  db.prepare(
    "UPDATE conversations SET category = ?, updated_at = ? WHERE id = ?",
  ).run(category, Date.now(), id);
}

/** 删除会话及其关联数据（消息 + 产物 + 隐藏 child），避免外键约束失败 */
export function deleteConversation(id: string): void {
  const db = getDb();
  // 级联删除该 parent 的隐藏 connector child（关联 + 会话数据）
  deleteAgentChildrenForParent(db, id);
  // artifacts 表有 conversation_id 外键（on_delete=NO ACTION），须先清子表
  db.prepare("DELETE FROM artifacts WHERE conversation_id = ?").run(id);
  deleteMessageContentPartsForConversation(id);
  db.prepare("DELETE FROM messages WHERE conversation_id = ?").run(id);
  db.prepare("DELETE FROM conversations WHERE id = ?").run(id);
}

/** 触摸更新时间 */
export function touchConversation(id: string): void {
  const db = getDb();
  db.prepare("UPDATE conversations SET updated_at = ? WHERE id = ?").run(
    Date.now(),
    id,
  );
}

/** 更新会话状态 */
export function updateConversationStatus(id: string, status: string): void {
  const db = getDb();
  db.prepare("UPDATE conversations SET status = ?, updated_at = ? WHERE id = ?")
    .run(status, Date.now(), id);
}

export function getCoreSessionPath(id: string): string | null {
  const row = getDb().prepare(
    "SELECT core_session_path as path FROM conversations WHERE id = ?",
  ).get(id) as { path: string | null } | undefined;
  if (!row) throw new Error(`会话 ${id} 不存在`);
  return row.path;
}

export function setCoreSessionPath(id: string, path: string): void {
  getDb().prepare(
    "UPDATE conversations SET core_session_path = ? WHERE id = ?",
  ).run(path, id);
}

/** 记录一条消息 */
export function appendMessage(
  conversationId: string,
  role: string,
  content: string,
  opts?: {
    toolName?: string;
    toolArgs?: string;
    isError?: boolean;
    parentId?: string;
  },
): string {
  const db = getDb();
  const id = uuid();
  const now = Date.now();
  db.prepare(
    "INSERT INTO messages (id, conversation_id, role, content, tool_name, tool_args, is_error, created_at, parent_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
  ).run(
    id,
    conversationId,
    role,
    content,
    opts?.toolName ?? null,
    opts?.toolArgs ?? null,
    opts?.isError ? 1 : 0,
    now,
    opts?.parentId ?? null,
  );
  touchConversation(conversationId);
  return id;
}

/** 把 agent message_end 落库：正文进 messages.content，thinking/text 进 parts。 */
export function appendAssistantMessageFromAgent(
  conversationId: string,
  message: AssistantLikeMessage,
): string | null {
  const parts = extractAssistantResponseParts(message);
  const text = assistantAnswerText(parts);
  if (!text && parts.length === 0) return null;
  const id = appendMessage(conversationId, "assistant", text, {
    isError: didAssistantResponseFail(message),
  });
  if (parts.length > 0) replaceMessageContentParts(id, parts);
  return id;
}

/**
 * Persists the user-visible message and its attachment links as one unit.
 * A failed attachment FK/trigger rolls back both the links and message row.
 */
export function appendMessageWithAttachments(
  conversationId: string,
  role: string,
  content: string,
  attachmentIds: string[],
  opts?: {
    toolName?: string;
    toolArgs?: string;
    isError?: boolean;
    parentId?: string;
    attachmentAnchors?: Readonly<Record<string, number>>;
  },
): string {
  const db = getDb();
  db.exec("BEGIN");
  try {
    const messageId = appendMessage(conversationId, role, content, opts);
    attachToMessage(messageId, attachmentIds, opts?.attachmentAnchors);
    db.exec("COMMIT");
    return messageId;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

/** 读取会话历史消息 */
export function getMessages(conversationId: string): MessageRecord[] {
  const db = getDb();
  const messages = db.prepare(
    "SELECT id, conversation_id as conversationId, role, content, tool_name as toolName, tool_args as toolArgs, is_error as isError, created_at as createdAt, parent_id as parentId FROM messages WHERE conversation_id = ? ORDER BY created_at ASC",
  ).all(conversationId) as unknown as MessageRecord[];
  const partsById = listMessageContentPartsByIds(messages.map((m) => m.id));
  return messages.map((message) => {
    const linked = listMessageAttachments(message.id);
    const attachmentAnchors: Record<string, number> = {};
    const attachments = linked.map((item) => {
      attachmentAnchors[item.id] = decodeAttachmentLayout(item.position).offset;
      return {
        id: item.id,
        name: item.name,
        mimeType: item.mimeType,
        extension: item.extension,
        size: item.size,
      };
    });
    return {
      ...message,
      contentParts: partsById.get(message.id),
      attachments,
      ...(attachments.length > 0 ? { attachmentAnchors } : {}),
    };
  });
}

/**
 * 从某条消息处分叉出新会话（对标 参考设计 session/fork）。
 * 拷贝源会话中 createdAt <= fromMsg 的消息到新会话，原会话不变。
 * 新会话同分类、标题加" 分支"后缀，记录 fork 关系到 conversation_forks 表。
 */
export function forkConversation(
  srcId: string,
  fromMsgId: string,
): Conversation {
  const db = getDb();
  db.exec("SAVEPOINT fork_conversation");
  try {
    const result = forkConversationInternal(srcId, fromMsgId);
    // A fork is a new root; explicitly retain the source's effective requirement ownership.
    db.prepare(`WITH RECURSIVE ancestors(id) AS (
      SELECT id FROM conversations WHERE id = ?
      UNION
      SELECT c.parent_id FROM conversations c JOIN ancestors a ON c.id = a.id
      WHERE c.parent_id IS NOT NULL
    )
    INSERT INTO requirement_conversations
      (conversation_id, space_id, work_item_id, request_key, created_at)
    SELECT ?, r.space_id, r.work_item_id, ?, ?
    FROM requirement_conversations r JOIN ancestors a ON r.conversation_id = a.id LIMIT 1`)
      .run(srcId, result.id, `fork:${result.id}`, Date.now());
    db.exec("RELEASE fork_conversation");
    return result;
  } catch (error) {
    db.exec("ROLLBACK TO fork_conversation");
    db.exec("RELEASE fork_conversation");
    throw error;
  }
}

function forkConversationInternal(
  srcId: string,
  fromMsgId: string,
): Conversation {
  const db = getDb();
  const srcConv = db.prepare(
    `SELECT title, category, model_provider as modelProvider, model_id as modelId,
            workspace_id as workspaceId
       FROM conversations WHERE id = ?`,
  ).get(srcId) as {
    title: string;
    category: string;
    modelProvider: string;
    modelId: string;
    workspaceId: string | null;
  } | undefined;
  if (!srcConv) throw new Error("源会话不存在");
  const srcMsgs = getMessages(srcId);
  const cutoff = srcMsgs.find((m) => m.id === fromMsgId);
  if (!cutoff) throw new Error("分叉点消息不存在");
  const keep = srcMsgs.filter((m) => m.createdAt <= cutoff.createdAt);

  // 新建会话（同分类，标题加" 分支"）
  const newConv = createConversation(
    (srcConv.title || "对话") + " 分支",
    srcConv.category,
    srcConv.workspaceId,
    null,
    { provider: srcConv.modelProvider, modelId: srcConv.modelId },
  );

  // Expert binding is orthogonal to category and must follow the source
  // session even when the category is the ordinary assistant category.
  createExpertBindingStore(db).copy(srcId, newConv.id);

  // 拷贝消息（重新生成 id，parent_id 清空——分叉后新分支根）
  for (const m of keep) {
    const newId = uuid();
    db.prepare(
      "INSERT INTO messages (id, conversation_id, role, content, tool_name, tool_args, is_error, created_at, parent_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
    ).run(
      newId,
      newConv.id,
      m.role,
      m.content,
      m.toolName ?? null,
      m.toolArgs ?? null,
      m.isError ? 1 : 0,
      m.createdAt,
      null,
    );
    copyMessageContentParts(m.id, newId);
  }
  // 记录 fork 关系
  db.prepare(
    "INSERT OR REPLACE INTO conversation_forks (src, dst, from_msg, created_at) VALUES (?, ?, ?, ?)",
  ).run(srcId, newConv.id, fromMsgId, Date.now());
  // The initial DTO is created before the binding copy. Re-read the row so
  // callers receive the same expert/model/workspace state that was persisted.
  return getConversation(newConv.id)!;
}
