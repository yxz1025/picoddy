// 助手消息内容块：thinking / text 分块提取与 SQLite 持久化。
// messages.content 仍只存最终回答；思考过程只放 message_content_parts。

import { getDb } from "../../../infra/db.ts";
import { assistantResponseText, type AssistantResponse } from "../../../shared/assistant_response.ts";

export type AssistantContentPartType = "thinking" | "text";

export interface AssistantContentPart {
  type: AssistantContentPartType;
  contentIndex: number;
  content: string;
}

interface AssistantContentBlock {
  type?: string;
  text?: string;
  thinking?: string;
}

export function extractAssistantContentParts(
  message: { content?: AssistantContentBlock[] } | null | undefined,
): AssistantContentPart[] {
  const parts: AssistantContentPart[] = [];
  for (const [index, part] of (message?.content ?? []).entries()) {
    if (part.type === "thinking") {
      const content = part.thinking ?? "";
      if (content) {
        parts.push({ type: "thinking", contentIndex: index, content });
      }
      continue;
    }
    if (part.type === "text") {
      const content = part.text ?? "";
      if (content) {
        parts.push({ type: "text", contentIndex: index, content });
      }
    }
  }
  return parts;
}

export function assistantAnswerText(parts: AssistantContentPart[]): string {
  return parts
    .filter((part) => part.type === "text")
    .map((part) => part.content)
    .join("");
}

/** Add terminal notices without replacing the model's text or thinking blocks. */
export function extractAssistantResponseParts(
  message: (AssistantResponse & { content?: AssistantContentBlock[] }) | null | undefined,
): AssistantContentPart[] {
  const parts = extractAssistantContentParts(message);
  const answer = assistantAnswerText(parts);
  const rendered = assistantResponseText(message);
  const suffix = rendered.startsWith(answer) ? rendered.slice(answer.length) : "";
  if (!suffix) return parts;
  const contentIndex = parts.reduce((max, part) => Math.max(max, part.contentIndex), -1) + 1;
  return [...parts, { type: "text", contentIndex, content: suffix }];
}

export function appendAnswerFallback(
  parts: AssistantContentPart[],
  fallback: string,
): AssistantContentPart[] {
  if (!fallback || assistantAnswerText(parts)) return parts;
  const contentIndex = parts.reduce(
    (max, part) => Math.max(max, part.contentIndex),
    -1,
  ) + 1;
  return [...parts, { type: "text", contentIndex, content: fallback }];
}

export function replaceMessageContentParts(
  messageId: string,
  parts: AssistantContentPart[],
): void {
  const db = getDb();
  db.prepare("DELETE FROM message_content_parts WHERE message_id = ?").run(
    messageId,
  );
  const insert = db.prepare(
    `INSERT INTO message_content_parts
       (message_id, content_index, part_type, content)
     VALUES (?, ?, ?, ?)`,
  );
  for (const part of parts) {
    insert.run(messageId, part.contentIndex, part.type, part.content);
  }
}

export function listMessageContentParts(
  messageId: string,
): AssistantContentPart[] {
  const rows = getDb().prepare(
    `SELECT part_type as type, content_index as contentIndex, content
       FROM message_content_parts
      WHERE message_id = ?
      ORDER BY content_index ASC`,
  ).all(messageId) as Array<{
    type: string;
    contentIndex: number;
    content: string;
  }>;
  return rows
    .filter((row) => row.type === "thinking" || row.type === "text")
    .map((row) => ({
      type: row.type as AssistantContentPartType,
      contentIndex: row.contentIndex,
      content: row.content,
    }));
}

export function listMessageContentPartsByIds(
  messageIds: string[],
): Map<string, AssistantContentPart[]> {
  const byMessage = new Map<string, AssistantContentPart[]>();
  if (messageIds.length === 0) return byMessage;
  const placeholders = messageIds.map(() => "?").join(",");
  const rows = getDb().prepare(
    `SELECT message_id as messageId, part_type as type,
            content_index as contentIndex, content
       FROM message_content_parts
      WHERE message_id IN (${placeholders})
      ORDER BY message_id, content_index ASC`,
  ).all(...messageIds) as Array<{
    messageId: string;
    type: string;
    contentIndex: number;
    content: string;
  }>;
  for (const row of rows) {
    if (row.type !== "thinking" && row.type !== "text") continue;
    const list = byMessage.get(row.messageId) ?? [];
    list.push({
      type: row.type,
      contentIndex: row.contentIndex,
      content: row.content,
    });
    byMessage.set(row.messageId, list);
  }
  return byMessage;
}

export function copyMessageContentParts(
  fromMessageId: string,
  toMessageId: string,
): void {
  replaceMessageContentParts(toMessageId, listMessageContentParts(fromMessageId));
}

export function deleteMessageContentPartsForConversation(
  conversationId: string,
): void {
  getDb().prepare(
    `DELETE FROM message_content_parts
      WHERE message_id IN (
        SELECT id FROM messages WHERE conversation_id = ?
      )`,
  ).run(conversationId);
}
