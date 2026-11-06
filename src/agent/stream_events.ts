import {
  type AssistantContentPart,
  extractAssistantResponseParts,
} from "../domains/session/node/message_content.ts";

export type ClientStreamEvent =
  | {
    type: "stream.start";
    sessionId: string;
    messageId: string;
  }
  | {
    type: "stream.delta";
    sessionId: string;
    messageId: string;
    channel: "thinking" | "answer";
    contentIndex: number;
    delta: string;
    seq: number;
  }
  | {
    type: "stream.end";
    sessionId: string;
    messageId: string;
    stopReason?: string;
    blocks: AssistantContentPart[];
  };

function streamMessageId(sessionId: string, event: {
  message?: { responseId?: string; timestamp?: number };
}): string {
  return event.message?.responseId
    ?? `${sessionId}:${event.message?.timestamp ?? "stream"}`;
}

function deltaChannel(
  eventType: string | undefined,
): "thinking" | "answer" | null {
  if (eventType === "thinking_delta" || eventType === "thinking_start") {
    return "thinking";
  }
  if (eventType === "text_delta" || eventType === "text_start") {
    return "answer";
  }
  return null;
}

/** 把 core AgentEvent 收成前端可用的轻量 stream.*，不带 partial / 完整 message / usage。 */
export function toClientStreamEvent(
  sessionId: string,
  event: {
    type?: string;
    assistantMessageEvent?: {
      type?: string;
      delta?: string;
      contentIndex?: number;
    };
    message?: {
      role?: string;
      responseId?: string;
      timestamp?: number;
      stopReason?: string;
      errorMessage?: string;
      content?: Array<{ type?: string; text?: string; thinking?: string }>;
    };
  },
  seq: number,
): ClientStreamEvent | null {
  if (event.type === "message_start") {
    if (event.message?.role !== "assistant") return null;
    return {
      type: "stream.start",
      sessionId,
      messageId: streamMessageId(sessionId, event),
    };
  }

  if (event.type === "message_update") {
    const ame = event.assistantMessageEvent;
    const channel = deltaChannel(ame?.type);
    if (!channel) return null;
    const delta = typeof ame?.delta === "string" ? ame.delta : "";
    if (!delta) return null;
    return {
      type: "stream.delta",
      sessionId,
      messageId: streamMessageId(sessionId, event),
      channel,
      contentIndex: typeof ame?.contentIndex === "number" ? ame.contentIndex : 0,
      delta,
      seq,
    };
  }

  if (event.type === "message_end") {
    if (event.message?.role && event.message.role !== "assistant") return null;
    const blocks = extractAssistantResponseParts(event.message);
    return {
      type: "stream.end",
      sessionId,
      messageId: streamMessageId(sessionId, event),
      stopReason: event.message?.stopReason,
      blocks,
    };
  }

  return null;
}
