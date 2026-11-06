import { Type } from "typebox";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import { getDb } from "../../infra/db.ts";
import { sessionContext } from "../../infra/context.ts";
import { provider } from "../provider.ts";
import type { SubagentRole } from "../prompt-runtime/types.ts";
import {
  appendMessageWithAttachments,
  createConversation,
} from "../../domains/session/node/store.ts";

const roleSchema = Type.Union([
  Type.Literal("scout"),
  Type.Literal("researcher"),
  Type.Literal("reviewer"),
  Type.Literal("verifier"),
  Type.Literal("worker"),
]);
const requestSchema = Type.Object({
  role: roleSchema,
  task: Type.String({ description: "边界清晰、可以独立完成的任务" }),
  expectedOutput: Type.Optional(Type.String()),
  includeAttachments: Type.Optional(
    Type.Boolean({ description: "是否显式传递当前轮附件，默认 false" }),
  ),
});
const subagentSchema = Type.Object({
  role: Type.Optional(roleSchema),
  task: Type.Optional(
    Type.String({ description: "单任务模式下边界清晰、可以独立完成的任务" }),
  ),
  expectedOutput: Type.Optional(Type.String()),
  includeAttachments: Type.Optional(Type.Boolean()),
  tasks: Type.Optional(
    Type.Array(requestSchema, {
      minItems: 1,
      maxItems: 8,
      description: "并行任务数组；使用该字段时不要同时填写 role 和 task",
    }),
  ),
});
const READ_TOOLS = new Set([
  "read",
  "grep",
  "find",
  "ls",
  "memory_recall",
  "read_doc",
  "rag_query",
  "rag_status",
  "web_fetch",
  "web_search",
]);
const RESEARCH_TOOLS = new Set([...READ_TOOLS, "connect_cloud_service"]);
const VERIFY_TOOLS = new Set([...READ_TOOLS, "bash", "windows_shell"]);
const NEVER_DELEGATE = new Set([
  "subagent",
  "task",
  "call_subagent",
  "ask_user_question",
  "goal_complete",
  "connect_cloud_service",
  "computer",
  "mouse_click",
  "mouse_move",
  "key_type",
  "app_focus",
  "cursor_pos",
]);
interface SubagentRequest {
  role: SubagentRole;
  task: string;
  expectedOutput?: string;
  includeAttachments?: boolean;
}

function allowedTools(
  role: SubagentRole,
  parentTools: readonly string[],
): string[] {
  const roleTools = role === "worker"
    ? new Set(parentTools)
    : role === "verifier"
    ? VERIFY_TOOLS
    : role === "researcher"
    ? RESEARCH_TOOLS
    : READ_TOOLS;
  return parentTools.filter((name) =>
    roleTools.has(name) && !NEVER_DELEGATE.has(name)
  );
}
function lifecycle(
  parentId: string,
  childId: string,
  role: SubagentRole,
  status: string,
) {
  provider.emitEvent(
    parentId,
    {
      type: "subagent.lifecycle",
      childSessionId: childId,
      role,
      status,
    } as any,
  );
}
async function runOne(request: SubagentRequest, signal?: AbortSignal) {
  const parent = sessionContext.getStore();
  if (!parent) throw new Error("未检测到当前会话上下文");
  if ((parent.delegationDepth ?? 0) > 0) {
    throw new Error("子代理不能继续创建子代理");
  }
  const db = getDb();
  const parentConversation = db.prepare(
    "SELECT model_provider, model_id, workspace_id FROM conversations WHERE id = ?",
  ).get(parent.sessionId) as {
    model_provider?: string;
    model_id?: string;
    workspace_id?: string;
  } | undefined;
  if (!parentConversation) throw new Error("父会话不存在");
  const child = createConversation(
    `子任务: ${request.role}`,
    "subagent",
    parentConversation.workspace_id || null,
    parent.sessionId,
  );
  db.prepare(
    "UPDATE conversations SET model_provider = ?, model_id = ? WHERE id = ?",
  ).run(
    parentConversation.model_provider || "deepseek",
    parentConversation.model_id || "deepseek-v4-flash",
    child.id,
  );
  const attachments = request.includeAttachments
    ? [...(parent.attachments ?? [])]
    : [];
  const attachmentIds = attachments.flatMap((item) => item.id ? [item.id] : []);
  const delegatedTask = parent.activeSkillName
    ? `/${parent.activeSkillName} ${request.task}`
    : request.task;
  const prompt = [
    delegatedTask,
    `子代理角色：${request.role}`,
    request.expectedOutput ? `输出要求：${request.expectedOutput}` : "",
  ].filter(Boolean).join("\n\n");
  const persistPrompt = () => {
    appendMessageWithAttachments(child.id, "user", prompt, attachmentIds);
  };
  const abortChild = () => void provider.abort(child.id);
  signal?.addEventListener("abort", abortChild, { once: true });
  lifecycle(parent.sessionId, child.id, request.role, "started");
  const detach = await provider.attachPersistence(child.id);
  try {
    if (signal?.aborted) throw new Error("PROMPT_CANCELLED");
    await provider.prompt(
      child.id,
      prompt,
      {
        mode: "craft",
        permission: parent.permission ?? "default",
        modelProvider: parentConversation.model_provider || "deepseek",
        modelId: parentConversation.model_id || "deepseek-v4-flash",
        mcpTools: [...(parent.selectedMcpTools ?? [])],
        attachments,
        subagent: {
          role: request.role,
          parentSessionId: parent.sessionId,
          parentTurnId: parent.turnId,
          allowedToolNames: allowedTools(
            request.role,
            parent.activeToolNames ?? [],
          ),
          delegationDepth: (parent.delegationDepth ?? 0) + 1,
        },
      },
      persistPrompt,
      persistPrompt,
    );
    const state = db.prepare("SELECT status FROM conversations WHERE id = ?")
      .get(child.id) as { status?: string } | undefined;
    const last = db.prepare(
      "SELECT content FROM messages WHERE conversation_id = ? AND role = 'assistant' ORDER BY created_at DESC LIMIT 1",
    ).get(child.id) as { content?: string } | undefined;
    const status = state?.status === "cancelled"
      ? "cancelled"
      : state?.status === "done"
      ? "completed"
      : "failed";
    lifecycle(parent.sessionId, child.id, request.role, status);
    return {
      childSessionId: child.id,
      role: request.role,
      status,
      output: last?.content ?? "(子代理未返回文本结果)",
    };
  } catch (error) {
    const status = signal?.aborted ? "cancelled" : "failed";
    lifecycle(parent.sessionId, child.id, request.role, status);
    return {
      childSessionId: child.id,
      role: request.role,
      status,
      output: error instanceof Error ? error.message : String(error),
    };
  } finally {
    signal?.removeEventListener("abort", abortChild);
    detach();
  }
}
async function runBounded<T, R>(
  items: readonly T[],
  limit: number,
  run: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (cursor < items.length) {
        const index = cursor++;
        results[index] = await run(items[index]);
      }
    }),
  );
  return results;
}
export const subagentTool: AgentTool<typeof subagentSchema, any> = {
  name: "subagent",
  label: "子代理",
  description:
    "将一个独立任务交给子代理，或并行执行最多 8 个只读子任务。并行任务不允许 worker 角色。",
  parameters: subagentSchema,
  execute: async (_id, input, signal) => {
    const requests: SubagentRequest[] = input.tasks ?? (
        input.role && input.task
          ? [{
            role: input.role,
            task: input.task,
            expectedOutput: input.expectedOutput,
            includeAttachments: input.includeAttachments,
          }]
          : []
      );
    if (requests.length === 0) {
      return {
        content: [{
          type: "text",
          text: "参数无效：请提供 role + task，或提供 tasks 数组",
        }],
        details: { error: true },
      };
    }
    if (
      requests.length > 1 &&
      requests.some((request) => request.role === "worker")
    ) {
      return {
        content: [{
          type: "text",
          text: "并行子任务只允许 scout、researcher、reviewer 或 verifier 角色",
        }],
        details: { error: true },
      };
    }
    const results = await runBounded(
      requests,
      4,
      (request) => runOne(request, signal),
    );
    return {
      content: [{
        type: "text",
        text: results.map((result) => result.output).join("\n\n---\n\n"),
      }],
      details: { results },
    };
  },
};
