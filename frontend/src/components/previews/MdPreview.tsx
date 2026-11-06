import { useEffect, useRef, useState } from "react";
import mermaid from "mermaid";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import "katex/dist/katex.min.css";

import {
  isMermaidCodeBlock,
  parseMarkdownPreviewResponse,
} from "../../utils/markdownPreview";

interface MdPreviewProps {
  filePath: string;
}

async function readJson(response: Response): Promise<unknown> {
  const data = await response.json();
  if (!response.ok) {
    const message = data && typeof data === "object" && "error" in data
      ? String((data as { error?: unknown }).error)
      : `请求失败（${response.status}）`;
    throw new Error(message);
  }
  return data;
}

async function renderMermaidBlocks(container: HTMLDivElement): Promise<void> {
  const blocks = Array.from(container.querySelectorAll("pre > code, code"))
    .filter(isMermaidCodeBlock);
  if (blocks.length === 0) return;

  mermaid.initialize({
    startOnLoad: false,
    securityLevel: "strict",
    theme: document.documentElement.dataset.theme === "dark" ? "dark" : "default",
  });

  for (const [index, block] of blocks.entries()) {
    const source = block.textContent?.trim();
    const pre = block.closest("pre");
    if (!source || !pre) continue;
    try {
      const rendered = await mermaid.render(`markdown-mermaid-${Date.now()}-${index}`, source);
      const wrapper = document.createElement("div");
      wrapper.className = "preview-mermaid";
      wrapper.innerHTML = rendered.svg;
      pre.replaceWith(wrapper);
      rendered.bindFunctions?.(wrapper);
    } catch (error) {
      console.warn("[markdown-preview] Mermaid 渲染失败，保留源码块:", error);
    }
  }
}

export default function MdPreview({ filePath }: MdPreviewProps) {
  const [html, setHtml] = useState<string | null>(null);
  const [fallbackText, setFallbackText] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const htmlRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setHtml(null);
    setFallbackText(null);

    const load = async () => {
      try {
        const response = await fetch(`/api/preview/markdown?path=${encodeURIComponent(filePath)}`);
        const data = await readJson(response);
        const preview = parseMarkdownPreviewResponse(data);
        if (!cancelled) setHtml(preview.html);
        return;
      } catch (primaryError) {
        try {
          const response = await fetch(`/api/preview?path=${encodeURIComponent(filePath)}`);
          const data = await readJson(response) as { text?: unknown };
          if (typeof data.text !== "string") throw new Error("无法读取 Markdown 文件内容");
          if (!cancelled) setFallbackText(data.text);
          return;
        } catch (fallbackError) {
          if (!cancelled) {
            setError(fallbackError instanceof Error
              ? fallbackError.message
              : primaryError instanceof Error ? primaryError.message : "预览失败");
          }
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void load();
    return () => {
      cancelled = true;
    };
  }, [filePath]);

  useEffect(() => {
    if (!html || !htmlRef.current) return;
    void renderMermaidBlocks(htmlRef.current);
  }, [html]);

  if (loading) return <div className="preview-loading">加载中...</div>;
  if (error) return <div className="preview-error">预览失败: {error}</div>;
  if (html !== null) {
    if (!html.trim()) return <div className="preview-empty">空文档</div>;
    return (
      <div className="preview-md">
        <div
          ref={htmlRef}
          className="preview-md-content preview-md-html"
          dangerouslySetInnerHTML={{ __html: html }}
        />
      </div>
    );
  }
  if (fallbackText !== null) {
    if (!fallbackText.trim()) return <div className="preview-empty">空文档</div>;
    return (
      <div className="preview-md">
        <div className="preview-md-content">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{fallbackText}</ReactMarkdown>
        </div>
      </div>
    );
  }
  return <div className="preview-empty">空文档</div>;
}
