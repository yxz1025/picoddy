/** Presentation and status shared by persisted messages and live events. */
export interface AssistantResponse {
  role?: string;
  content?: Array<{ type?: string; text?: string }>;
  stopReason?: string;
  errorMessage?: string;
  runtimeRecovery?: boolean;
}

export const TRUNCATED_RESPONSE_NOTICE =
  "本次回复因长度限制中断，任务尚未完成。已保留当前进度，可继续追问。";

const CONTEXT_OVERFLOW_PATTERN =
  /Range of input length should be|context (?:length|window).*(?:exceed|overflow)|maximum context length|input.*too (?:long|large)|too many (?:input )?tokens/i;

export const CONTEXT_OVERFLOW_NOTICE =
  "模型服务返回上下文容量不足。可以切换更大上下文模型后继续，已有文档和会话记录仍保留；也可以减少本轮输入范围后重试。";

export function friendlyAssistantError(value: string): string {
  return CONTEXT_OVERFLOW_PATTERN.test(value)
    ? CONTEXT_OVERFLOW_NOTICE
    : value;
}

export function isAssistantResponseFailure(message: AssistantResponse | null | undefined): boolean {
  return message?.role === "assistant" &&
    (message.stopReason === "error" || (message.stopReason === "length" && !message.runtimeRecovery));
}

export function assistantResponseText(message: AssistantResponse | null | undefined): string {
  if (message?.role !== "assistant") return "";
  const text = (message.content ?? [])
    .filter((part) => part.type === "text")
    .map((part) => part.text ?? "")
    .join("");
  if (message.stopReason === "length") {
    const notice = message.runtimeRecovery
      ? "本轮回复因长度限制中断，正在检查已保存的进度并尝试恢复。"
      : TRUNCATED_RESPONSE_NOTICE;
    return text ? `${text}\n\n${notice}` : notice;
  }
  if (text) {
    if (message.stopReason !== "error") return text;
    const friendly = friendlyAssistantError(text);
    return friendly === text ? text : `出错了：${friendly}`;
  }
  if (message.stopReason === "error" && message.errorMessage) {
    return `出错了：${friendlyAssistantError(message.errorMessage)}`;
  }
  return "";
}
