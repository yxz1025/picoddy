function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function extractText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((item) => {
        if (typeof item === "string") return item;
        if (!isRecord(item)) return "";
        if (item.type === "text" && typeof item.text === "string") return item.text;
        if (item.type === "output_text" && typeof item.text === "string") return item.text;
        return "";
      })
      .filter(Boolean)
      .join("\n\n");
  }
  if (isRecord(content)) {
    if (typeof content.text === "string") return content.text;
    if ("content" in content) return extractText(content.content);
  }
  return "";
}

export function readPiMessage(message: unknown): string {
  if (!isRecord(message)) return extractText(message);
  return extractText(message.content ?? message);
}

export type PiMessageRole = "user" | "assistant" | "toolResult" | "system";

export function getPiMessageRole(message: { role?: string; content: unknown }): PiMessageRole {
  if (isRecord(message.content) && typeof message.content.role === "string") {
    const role = message.content.role;
    if (role === "user" || role === "assistant" || role === "toolResult" || role === "system") return role;
  }
  if (message.role === "user" || message.role === "assistant" || message.role === "toolResult" || message.role === "system") return message.role;
  return "assistant";
}
