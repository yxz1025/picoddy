import assert from "node:assert/strict";
import test from "node:test";

import { ApiError, unwrapResponse } from "../web/src/api/client";
import { parseSseChunk } from "../web/src/api/stream";
import { extractText, getPiMessageRole, readPiMessage } from "../web/src/lib/pi-content";
import { createRunFingerprint } from "../web/src/lib/run-key";

test("unwrapResponse returns the API data envelope", async () => {
  const response = new Response(JSON.stringify({ data: { id: "conversation-1" } }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });

  assert.deepEqual(await unwrapResponse(response), { id: "conversation-1" });
});

test("unwrapResponse converts the API error envelope to ApiError", async () => {
  const response = new Response(
    JSON.stringify({ error: { code: "INVALID_PROMPT", message: "请输入任务内容" } }),
    { status: 400, headers: { "content-type": "application/json" } },
  );

  await assert.rejects(() => unwrapResponse(response), (error: unknown) => {
    assert.ok(error instanceof ApiError);
    assert.equal(error.code, "INVALID_PROMPT");
    assert.equal(error.message, "请输入任务内容");
    return true;
  });
});

test("unwrapResponse accepts a successful empty delete response", async () => {
  assert.equal(await unwrapResponse(new Response(null, { status: 204 })), undefined);
});

test("parseSseChunk reads update events and preserves an incomplete tail", () => {
  const parsed = parseSseChunk(
    "id: 42\nevent: update\ndata: {\"id\":42,\"type\":\"text_delta\"}\n\nid: 43\ndata: {\"id\"",
  );

  assert.equal(parsed.events.length, 1);
  assert.deepEqual(parsed.events[0], {
    id: "42",
    event: "update",
    data: '{"id":42,"type":"text_delta"}',
  });
  assert.equal(parsed.rest, 'id: 43\ndata: {"id"');
});

test("readPiMessage extracts text blocks without treating markup as HTML", () => {
  const content = [
    { type: "text", text: "完成 **分析**。" },
    { type: "toolCall", name: "read_file" },
    { type: "text", text: "下一步。" },
  ];

  assert.equal(extractText(content), "完成 **分析**。\n\n下一步。");
  assert.equal(readPiMessage({ role: "assistant", content }), "完成 **分析**。\n\n下一步。");
});

test("getPiMessageRole prefers the role inside raw Pi content", () => {
  assert.equal(
    getPiMessageRole({ role: "assistant", content: { role: "toolResult", content: [{ type: "text", text: "done" }] } }),
    "toolResult",
  );
});

test("createRunFingerprint is stable for unordered selections", () => {
  const first = createRunFingerprint({
    prompt: "分析文件",
    skillIds: ["b", "a"],
    connectorIds: ["z", "c"],
    fileIds: ["2", "1"],
    expertId: "expert",
    modelId: "model",
  });
  const second = createRunFingerprint({
    prompt: "分析文件",
    skillIds: ["a", "b"],
    connectorIds: ["c", "z"],
    fileIds: ["1", "2"],
    expertId: "expert",
    modelId: "model",
  });

  assert.equal(first, second);
});
