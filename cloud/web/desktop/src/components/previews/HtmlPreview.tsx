import { useState, useEffect } from "react";

interface HtmlPreviewProps {
  filePath: string;
}

export default function HtmlPreview({ filePath }: HtmlPreviewProps) {
  const [htmlContent, setHtmlContent] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetch(`/api/file?path=${encodeURIComponent(filePath)}`)
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.text();
      })
      .then((text) => {
        if (!cancelled) setHtmlContent(text);
      })
      .catch((e) => {
        if (!cancelled) setError(e.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [filePath]);

  if (loading) return <div className="preview-loading">加载中...</div>;
  if (error) return <div className="preview-error">预览失败: {error}</div>;
  if (!htmlContent) return <div className="preview-empty">空文档</div>;

  return (
    <div className="preview-html">
      <iframe
        srcDoc={htmlContent}
        className="preview-html-frame"
        title="HTML 预览"
        sandbox="allow-scripts allow-same-origin"
      />
    </div>
  );
}
