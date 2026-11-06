export interface StoredHistoryMessage {
  role: string;
  content: string;
  createdAt: number;
}

interface MessageContent {
  type: string;
  text?: string;
  thinking?: string;
}

export interface AssistantLikeMessage {
  role?: string;
  content?: MessageContent[];
  stopReason?: string;
  errorMessage?: string;
  runtimeRecovery?: boolean;
}

const EMPTY_USAGE = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 0,
  cost: {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    total: 0,
  },
};

export function toAgentHistoryMessages(
  history: StoredHistoryMessage[],
  provider: string,
  model: string,
): AgentMessage[] {
  return history
    .filter((message) =>
      message.role === "user" || message.role === "assistant"
    )
    .map((message) => {
      const base = {
        role: message.role,
        content: [{ type: "text", text: message.content }],
        timestamp: message.createdAt,
      };
      if (message.role === "user") return base;

      return {
        ...base,
        api: "openai-completions",
        provider,
        model,
        usage: {
          ...EMPTY_USAGE,
          cost: { ...EMPTY_USAGE.cost },
        },
        stopReason: "stop",
      };
    }) as AgentMessage[];
}

export {
  assistantResponseText as assistantMessageText,
  isAssistantResponseFailure as didAssistantResponseFail,
} from "../shared/assistant_response.ts";
import type { AgentMessage } from "@earendil-works/pi-agent-core";

