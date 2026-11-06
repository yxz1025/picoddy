// src/agent/tools/memory.ts
// memory_recall / memory_write 工具

import { Type } from "typebox";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import { writeMemory, recallMemories, recallWorkingMemory, recallAllMemories } from "../../domains/memory/node/store.ts";
import { sessionContext } from "../../infra/context.ts";

const recallSchema = Type.Object({
  scope: Type.Optional(Type.Union([
    Type.Literal("user"),
    Type.Literal("working"),
    Type.Literal("all"),
  ], { description: "记忆范围：user=长期记忆(默认，跨会话) / working=工作记忆(当前任务) / all=全部" })),
}, { description: "召回记忆，可选范围" });

export const memoryRecallTool: AgentTool<typeof recallSchema, { count: number }> = {
  name: "memory_recall",
  label: "回忆",
  description: "召回记忆。默认召回长期记忆(scope=user)；传 scope=working 召回当前任务的工作记忆；scope=all 召回全部。",
  parameters: recallSchema,
  execute: async (_id, p) => {
    const scope = (p as any).scope ?? "user";
    const sessionId = sessionContext.getStore()?.sessionId;
    const mems = scope === "working"
      ? sessionId ? recallWorkingMemory(sessionId) : []
      : scope === "all" ? recallAllMemories(sessionId)
      : recallMemories();
    const text = mems.length === 0
      ? "(暂无记忆)"
      : mems.map((m) => `- [${m.kind}] ${m.content}`).join("\n");
    return {
      content: [{ type: "text", text }],
      details: { count: mems.length },
    };
  },
};

const writeSchema = Type.Object({
  content: Type.String({ description: "要记住的内容" }),
  kind: Type.Optional(Type.String({ description: "记忆类型: fact/preference/note，默认 fact" })),
  scope: Type.Optional(Type.Union([
    Type.Literal("user"),
    Type.Literal("working"),
  ], { description: "记忆范围：user=长期记忆(默认，跨会话保留) / working=工作记忆(当前任务，随会话清理)" })),
});

export const memoryWriteTool: AgentTool<typeof writeSchema, { id: string }> = {
  name: "memory_write",
  label: "记住",
  description: "写入一条记忆。默认写长期记忆(scope=user，跨会话保留)；传 scope=working 写入当前任务的工作记忆。",
  parameters: writeSchema,
  execute: async (_id, p) => {
    const scope = (p as any).scope ?? "user";
    const sessionId = sessionContext.getStore()?.sessionId;
    if (scope === "working" && !sessionId) {
      return {
        content: [{
          type: "text",
          text: "写入工作记忆失败：当前没有会话上下文",
        }],
        details: { id: "" },
      };
    }
    const mem = writeMemory(p.content, p.kind, scope, sessionId);
    return {
      content: [{ type: "text", text: `✓ 已记住: ${mem.content}` }],
      details: { id: mem.id },
    };
  },
};
