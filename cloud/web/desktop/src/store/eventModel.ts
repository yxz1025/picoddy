import { assistantResponseText } from "../../shared/assistant_response.ts";

export type StreamChannel = "thinking" | "answer";

export interface MessageContentPart {
  type: "thinking" | "text";
  contentIndex: number;
  content: string;
}

export interface StreamDeltaEvent {
  type: "stream.delta";
  sessionId: string;
  messageId: string;
  channel: StreamChannel;
  contentIndex: number;
  delta: string;
  seq: number;
}

export interface StreamStartEvent {
  type: "stream.start";
  sessionId: string;
  messageId: string;
}

export interface StreamEndEvent {
  type: "stream.end";
  sessionId: string;
  messageId: string;
  stopReason?: string;
  blocks: MessageContentPart[];
}

export function applyStreamDelta(
  parts: MessageContentPart[],
  delta: { channel: StreamChannel; contentIndex: number; delta: string },
): MessageContentPart[] {
  const type: MessageContentPart["type"] = delta.channel === "thinking"
    ? "thinking"
    : "text";
  const next = parts.map((part) => ({ ...part }));
  const existing = next.find((part) => part.contentIndex === delta.contentIndex);
  if (existing) {
    existing.content += delta.delta;
    existing.type = type;
    return next;
  }
  next.push({
    type,
    contentIndex: delta.contentIndex,
    content: delta.delta,
  });
  next.sort((a, b) => a.contentIndex - b.contentIndex);
  return next;
}

export function answerTextFromParts(parts: MessageContentPart[]): string {
  return parts
    .filter((part) => part.type === "text")
    .map((part) => part.content)
    .join("");
}

interface AssistantEventMessage {
  role?: string;
  content?: Array<{
    type: string;
    text?: string;
    [key: string]: unknown;
  }>;
  stopReason?: string;
  errorMessage?: string;
  runtimeRecovery?: boolean;
}

export function thinkingTextFromParts(
  parts: MessageContentPart[] | null | undefined,
): string {
  return (parts ?? [])
    .filter((part) => part.type === "thinking")
    .map((part) => part.content)
    .join("");
}

export function assistantEventText(
  message: AssistantEventMessage | null | undefined,
): string {
  return assistantResponseText(message);
}

export function assistantEventThinking(
  message: AssistantEventMessage | null | undefined,
): string {
  if (message?.role !== "assistant") return "";
  return (message.content ?? [])
    .filter((content) => content.type === "thinking")
    .map((content) => {
      const thinking = content.thinking;
      if (typeof thinking === "string") return thinking;
      return content.text ?? "";
    })
    .join("");
}
