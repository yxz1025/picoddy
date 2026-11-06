import assert from "node:assert/strict";
import test from "node:test";

import type { Message } from "../store/useStore";
import {
  formatRunDuration,
  hasAnswerText,
  isSettledRun,
  runElapsedMs,
  settleAssistantRun,
  type AssistantRunItem,
} from "./assistantRunModel";

function assistant(
  id: string,
  fields: Partial<Message> = {},
): Message {
  return {
    id,
    role: "assistant",
    content: "",
    createdAt: 1,
    ...fields,
  };
}

function tool(id: string, fields: Partial<Message> = {}): Message {
  return {
    id,
    role: "tool",
    content: "",
    toolName: "read",
    status: "success",
    createdAt: 1,
    ...fields,
  };
}

test("isSettledRun: last run waits for busy, stream, and running tools", () => {
  assert.equal(
    isSettledRun({
      isLastRun: true,
      busy: true,
      hasActiveStream: false,
      hasRunningTool: false,
    }),
    false,
  );
  assert.equal(
    isSettledRun({
      isLastRun: true,
      busy: false,
      hasActiveStream: true,
      hasRunningTool: false,
    }),
    false,
  );
  assert.equal(
    isSettledRun({
      isLastRun: true,
      busy: false,
      hasActiveStream: false,
      hasRunningTool: true,
    }),
    false,
  );
  assert.equal(
    isSettledRun({
      isLastRun: true,
      busy: false,
      hasActiveStream: false,
      hasRunningTool: false,
    }),
    true,
  );
});

test("isSettledRun: historical runs are always settled", () => {
  assert.equal(
    isSettledRun({
      isLastRun: false,
      busy: true,
      hasActiveStream: true,
      hasRunningTool: true,
    }),
    true,
  );
});

test("hasAnswerText ignores whitespace-only content", () => {
  assert.equal(hasAnswerText("  \n\t"), false);
  assert.equal(hasAnswerText("ok"), true);
});

test("settleAssistantRun packs thinking after deliverables into process", () => {
  const items: AssistantRunItem[] = [
    { kind: "message", message: assistant("t1", { thinking: "先读规范" }) },
    {
      kind: "tool-group",
      id: "tools-a",
      messages: [tool("op1", { toolName: "read" })],
    },
    {
      kind: "present-files",
      id: "present-1",
      message: tool("files", { toolName: "present_files" }),
    },
    { kind: "message", message: assistant("t2", { thinking: "交付后再确认" }) },
    {
      kind: "message",
      message: assistant("final", { content: "专家已创建并注册成功。" }),
    },
  ];

  const settled = settleAssistantRun(items);
  assert.equal(settled.finalMessageId, "final");
  assert.deepEqual(
    settled.process.map((item) =>
      item.kind === "message" ? `message:${item.message.id}` : `${item.kind}:${item.id}`
    ),
    ["message:t1", "tool-group:tools-a", "message:t2"],
  );
  assert.deepEqual(
    settled.outputs.map((entry) => `${entry.kind}:${entry.id}`),
    ["present-files:present-1", "answer:final"],
  );
});

test("settleAssistantRun keeps intermediate answer text as original messages", () => {
  const items: AssistantRunItem[] = [
    {
      kind: "message",
      message: assistant("draft", {
        thinking: "草案",
        content: "专家草案正文",
      }),
    },
    {
      kind: "tool-group",
      id: "tools-b",
      messages: [tool("op2")],
    },
    {
      kind: "message",
      message: assistant("final", { content: "最终结果" }),
    },
  ];

  const settled = settleAssistantRun(items);
  assert.equal(settled.process[0]?.kind, "message");
  if (settled.process[0]?.kind === "message") {
    assert.equal(settled.process[0].message.content, "专家草案正文");
    assert.equal(settled.process[0].message.thinking, "草案");
  }
  assert.equal(settled.process[1]?.kind, "tool-group");
  assert.deepEqual(
    settled.outputs.map((entry) => entry.kind),
    ["answer"],
  );
});

test("settleAssistantRun splits thinking off the final message", () => {
  const items: AssistantRunItem[] = [
    {
      kind: "message",
      message: assistant("final", {
        thinking: "最后确认",
        content: "完成了",
      }),
    },
  ];

  const settled = settleAssistantRun(items);
  assert.equal(settled.process.length, 1);
  assert.equal(settled.process[0]?.kind, "message");
  if (settled.process[0]?.kind === "message") {
    assert.equal(settled.process[0].message.thinking, "最后确认");
    assert.equal(settled.process[0].message.content, "");
  }
  assert.equal(settled.outputs[0]?.kind, "answer");
  assert.equal(settled.finalMessageId, "final");
});

test("settleAssistantRun keeps multiple deliverables and widgets in order", () => {
  const items: AssistantRunItem[] = [
    { kind: "widget", id: "widget-1", message: tool("w1", { toolName: "show_widget" }) },
    { kind: "present-files", id: "present-1", message: tool("p1", { toolName: "present_files" }) },
    { kind: "present-files", id: "present-2", message: tool("p2", { toolName: "present_files" }) },
    { kind: "message", message: assistant("final", { content: "好了" }) },
  ];

  const settled = settleAssistantRun(items);
  assert.deepEqual(
    settled.outputs.map((entry) => entry.kind),
    ["widget", "present-files", "present-files", "answer"],
  );
});

test("settleAssistantRun can output deliverables without a final answer", () => {
  const items: AssistantRunItem[] = [
    { kind: "message", message: assistant("t1", { thinking: "准备交付" }) },
    {
      kind: "present-files",
      id: "present-1",
      message: tool("p1", { toolName: "present_files" }),
    },
  ];

  const settled = settleAssistantRun(items);
  assert.equal(settled.finalMessageId, undefined);
  assert.deepEqual(
    settled.outputs.map((entry) => entry.kind),
    ["present-files"],
  );
  assert.equal(settled.process.length, 1);
});

test("settleAssistantRun leaves a plain reply without a process bundle", () => {
  const items: AssistantRunItem[] = [
    { kind: "message", message: assistant("final", { content: "你好" }) },
  ];

  const settled = settleAssistantRun(items);
  assert.equal(settled.process.length, 0);
  assert.equal(settled.outputs[0]?.kind, "answer");
});

test("formatRunDuration omits minutes below 1m and does not pad", () => {
  assert.equal(formatRunDuration(0), "（耗时：0s）");
  assert.equal(formatRunDuration(1000), "（耗时：1s）");
  assert.equal(formatRunDuration(59000), "（耗时：59s）");
  assert.equal(formatRunDuration(60000), "（耗时：1m0s）");
  assert.equal(formatRunDuration(65000), "（耗时：1m5s）");
  assert.equal(formatRunDuration(600000), "（耗时：10m0s）");
});

test("runElapsedMs spans user start to last run event", () => {
  const items: AssistantRunItem[] = [
    { kind: "message", message: assistant("a", { createdAt: 4000 }) },
    {
      kind: "tool-group",
      id: "tools",
      messages: [tool("t", { createdAt: 9000 })],
    },
  ];
  assert.equal(runElapsedMs(items, 1000), 8000);
});

test("failed present_files stay in the tool process", () => {
  const items: AssistantRunItem[] = [
    {
      kind: "tool-group",
      id: "tools-fail",
      messages: [
        tool("fail", { toolName: "present_files", isError: true, status: "error" }),
      ],
    },
    { kind: "message", message: assistant("final", { content: "失败说明" }) },
  ];

  const settled = settleAssistantRun(items);
  assert.equal(settled.process[0]?.kind, "tool-group");
  assert.equal(settled.outputs[0]?.kind, "answer");
});
