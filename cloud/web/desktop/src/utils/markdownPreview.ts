export interface MarkdownPreviewResponse {
  ok: true;
  html: string;
  sourcePath?: string;
  resourceRoot?: string;
}

export function parseMarkdownPreviewResponse(
  value: unknown,
): Pick<MarkdownPreviewResponse, "html"> {
  if (!value || typeof value !== "object") {
    throw new Error("Markdown HTML 预览响应无效");
  }
  const response = value as Record<string, unknown>;
  if (response.ok !== true || typeof response.html !== "string") {
    const message = typeof response.error === "string"
      ? response.error
      : "Markdown HTML 预览响应无效";
    throw new Error(message);
  }
  return { html: response.html };
}

export function isMermaidCodeBlock(element: Element): boolean {
  return element.matches("pre > code.language-mermaid, code.language-mermaid");
}
