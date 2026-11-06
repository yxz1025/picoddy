// src/agent/tools/ask.ts
// ask_user_question 工具：让模型向用户提问并收集选项/输入。
//
// 实现本质（与 tool_confirmation 同构）：
//   模型发出该 tool_call → execute 广播 ask_user_question 事件 →
//   前端渲染提问卡片 → 用户作答经 POST /api/ask-answer 回传 →
//   解除挂起的 Promise → 答案作为 tool_result 回灌模型，模型继续生成。

import { Type } from "typebox";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import { sessionContext } from "../../infra/context.ts";
import { registerPendingAnswer, resolvePendingAnswer } from "../interactive.ts";

const optionSchema = Type.Object({
  label: Type.String({ description: "选项标签（简洁，≤12字）" }),
  description: Type.Optional(Type.String({ description: "选项补充说明（可选）" })),
});

const questionSchema = Type.Object({
  question: Type.String({ description: "要问用户的具体问题" }),
  header: Type.Optional(Type.String({ description: "问题分类标签（≤12字，前端显示为小 chip）" })),
  multiSelect: Type.Optional(Type.Boolean({ description: "是否多选，默认 false（单选）" })),
  options: Type.Array(optionSchema, { description: "2-4 个候选选项" }),
});

const askSchema = Type.Object({
  questions: Type.Array(questionSchema, { description: "1-4 个问题，建议单次不超过 4 个" }),
}, {
  description:
    "向用户提问并收集答案。当任务需要用户澄清、或要在多个候选方案间让用户选择时使用。支持单选/多选以及自由文本输入。",
});

export const askUserQuestionTool: AgentTool<typeof askSchema, { answers?: unknown; skipped?: boolean }> = {
  name: "ask_user_question",
  label: "向用户提问",
  description:
    "向用户提问并收集答案。用于需要用户澄清、或要在多个候选方案间让用户选择时。支持单选/多选以及自由文本输入。",
  parameters: askSchema,
  execute: async (_id, p, signal) => {
    signal?.throwIfAborted();
    const sessionId = sessionContext.getStore()?.sessionId;
    if (!sessionId) {
      return {
        content: [{ type: "text", text: "⚠️ 无法获取会话上下文，已跳过提问并继续。" }],
        details: { skipped: true },
      };
    }

    // 自动化无人值守运行不能打开全局提问 UI。
    const { getDb } = await import("../../infra/db.ts");
    const conversation = getDb().prepare(
      "SELECT category FROM conversations WHERE id=?",
    ).get(sessionId) as { category?: string } | undefined;
    if (conversation?.category === "automation") {
      return {
        content: [{ type: "text", text: "自动化任务无法等待用户回答，请提供无需交互即可执行的完整输入。" }],
        details: { skipped: true },
      };
    }

    const requestId = crypto.randomUUID();

    // 延迟导入 provider，避免 tools → provider → engine → tools 的循环依赖在模块加载期触发
    const { provider } = await import("../provider.ts");

    // 广播事件：SSE 与轮询队列都会收到，前端据此渲染提问卡片
    provider.emitEvent(sessionId, {
      type: "ask_user_question",
      requestId,
      sessionId,
      questions: p.questions,
    } as any);

    // 挂起等待用户作答（超时自动 null）
    const pending = registerPendingAnswer(requestId);
    const abort = () => resolvePendingAnswer(requestId, { cancelled: true });
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) abort();
    let answers: unknown;
    try {
      answers = await pending;
      signal?.throwIfAborted();
    } finally {
      signal?.removeEventListener("abort", abort);
    }

    const payload = answers ?? { timedOut: true };
    return {
      content: [{ type: "text", text: JSON.stringify(payload) }],
      details: { answers: payload },
    };
  },
};
