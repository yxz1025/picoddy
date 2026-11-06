// 主会话的 connector delegate 工具：仅暴露目录定义的名称与描述，
// 不把 Skill 或 CLI schema 嵌入主 prompt；执行时把任务文本与显式附件引用
// 交给持久化的隐藏 child 会话运行。

import { readFileSync, statSync } from "node:fs";
import { Type } from "typebox";
import type { AgentTool } from "@earendil-works/pi-agent-core";

import type { AgentManager, AgentDelegateResult } from "../../domains/connector/node/agent_manager.ts";
import { ConnectorError } from "../../domains/connector/node/errors.ts";
import type { ConnectorStateStore } from "../../domains/connector/node/state_store.ts";
import type { ConnectorCatalogEntry } from "../../domains/connector/node/types.ts";
import { getAttachment } from "../../domains/attachment/node/store.ts";
import { getMessages } from "../../domains/session/node/store.ts";
import { sessionContext } from "../../infra/context.ts";
import type { ConnectorSessionContext } from "../../infra/context.ts";
import type { AttachmentContextItem, ConnectorChildRef } from "../prompt-runtime/types.ts";

const delegateSchema = Type.Object({
  task: Type.String({ minLength: 1, maxLength: 8000 }),
  summary: Type.Optional(Type.String({ maxLength: 2000 })),
  attachmentIds: Type.Optional(
    Type.Array(Type.String({ minLength: 1, maxLength: 64 }), { maxItems: 16 }),
  ),
}, { additionalProperties: false });

export interface ConnectorChildTurnOptions {
  childConversationId: string;
  task: string;
  summary?: string;
  attachmentIds?: readonly string[];
  connector: ConnectorChildRef;
  connectorContext: ConnectorSessionContext;
}

export type ConnectorRunChildTurn = (options: ConnectorChildTurnOptions) => Promise<void>;

export interface ConnectorDelegateToolDependencies {
  readonly entry: ConnectorCatalogEntry;
  readonly manager: AgentManager;
  readonly runChildTurn: ConnectorRunChildTurn;
  readonly readChildOutput?: (childConversationId: string) => string;
}

export interface BuildConnectorDelegateToolsOptions {
  readonly registry: { readonly list: () => readonly ConnectorCatalogEntry[] };
  readonly store: ConnectorStateStore;
  readonly manager: AgentManager;
  readonly runChildTurn: ConnectorRunChildTurn;
}

/** 只对 ready 连接器暴露主 agent 的 delegate 工具（描述来自目录）。 */
export async function buildConnectorDelegateTools(
  options: BuildConnectorDelegateToolsOptions,
): Promise<AgentTool[]> {
  const tools: AgentTool[] = [];
  for (const entry of options.registry.list()) {
    try {
      const record = await options.store.read(entry.id);
      if (record.state !== "ready") continue;
      tools.push(createConnectorDelegateTool({
        entry,
        manager: options.manager,
        runChildTurn: options.runChildTurn,
      }));
    } catch (cause) {
      // 单个连接器状态损坏不影响其余 delegate 工具
      console.warn(`[connector] 跳过不可用的委托工具 ${entry.id}:`, cause);
    }
  }
  return tools;
}

export function createConnectorDelegateTool(
  dependencies: ConnectorDelegateToolDependencies,
): AgentTool<typeof delegateSchema, unknown> {
  const readChildOutput = dependencies.readChildOutput ?? defaultReadChildOutput;
  return {
    name: dependencies.entry.delegate.toolName,
    label: `委托给 ${dependencies.entry.displayName}`,
    description: dependencies.entry.delegate.description,
    parameters: delegateSchema,
    execute: async (_id, params) => {
      const sessionId = sessionContext.getStore()?.sessionId;
      if (!sessionId) {
        return failure("SESSION_CONTEXT_MISSING", 400, "无法确定当前会话");
      }
      try {
        const binding: AgentDelegateResult = await dependencies.manager.delegate(
          sessionId,
          dependencies.entry.id,
          params.task,
        );
        await dependencies.runChildTurn({
          childConversationId: binding.childConversationId,
          task: params.task,
          ...(params.summary ? { summary: params.summary } : {}),
          ...(params.attachmentIds?.length ? { attachmentIds: params.attachmentIds } : {}),
          connector: {
            connectorId: binding.connector.connectorId,
            installedVersionRoot: binding.connector.versionRoot,
            ...(binding.catalogVersion ? { catalogVersion: binding.catalogVersion } : {}),
          },
          connectorContext: binding.connector,
        });
        const output = readChildOutput(binding.childConversationId);
        return result({
          ok: true,
          childConversationId: binding.childConversationId,
          output,
          reused: binding.reused,
        });
      } catch (cause) {
        if (cause instanceof ConnectorError) {
          return failure(cause.code, cause.status, cause.message);
        }
        const message = cause instanceof Error ? cause.message : String(cause);
        return failure("CONNECTOR_BROKEN", 502, `连接器委托失败: ${message}`);
      }
    },
  };
}

function result(details: Record<string, unknown>) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(details) }],
    details,
  };
}

function failure(code: string, status: number, message: string): ReturnType<typeof result> {
  return result({ ok: false, error: { code, status, message } });
}

const MAX_ATTACHMENT_READ_BYTES = 256 * 1024;
const MAX_ATTACHMENT_TEXT_BYTES = 32 * 1024;

/** 把显式附件引用解析为 child 可用的上下文（纯文本受限读入，二进制标记不可用）。 */
export function resolveChildAttachmentItems(
  ids: readonly string[],
): AttachmentContextItem[] {
  return ids.map((id) => {
    const record = getAttachment(id);
    if (!record) throw new ConnectorError("CONNECTOR_NOT_FOUND", `Attachment not found: ${id}`);
    let content: string | undefined;
    let contentUnavailableReason: "binary_asset" | undefined;
    try {
      const stat = statSync(record.filePath);
      if (stat.size > 0 && stat.size <= MAX_ATTACHMENT_READ_BYTES) {
        const buffer = readFileSync(record.filePath);
        if (buffer.includes(0)) {
          contentUnavailableReason = "binary_asset";
        } else {
          content = buffer.toString("utf8").slice(0, MAX_ATTACHMENT_TEXT_BYTES);
        }
      } else {
        contentUnavailableReason = "binary_asset";
      }
    } catch {
      contentUnavailableReason = "binary_asset";
    }
    return {
      id: record.id,
      name: record.name,
      ...(record.filePath ? { path: record.filePath } : {}),
      ...(record.mimeType ? { mimeType: record.mimeType } : {}),
      ...(record.extension ? { extension: record.extension } : {}),
      size: record.size,
      ...(content !== undefined ? { content } : {}),
      ...(contentUnavailableReason !== undefined ? { contentUnavailableReason } : {}),
    };
  });
}

function defaultReadChildOutput(childConversationId: string): string {
  const messages = getMessages(childConversationId);
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === "assistant") return messages[i].content;
  }
  return "(子任务完成，未返回具体回答)";
}
