import { useState, useEffect } from "react";

interface DocxPreviewProps {
  filePath: string;
}

export default function DocxPreview({ filePath }: DocxPreviewProps) {
  const [html, setHtml] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetch(`/api/preview?path=${encodeURIComponent(filePath)}`)
      .then((r) => r.json())
      .then((data) => {
        if (cancelled) return;
        if (data.error) {
          setError(data.error);
        } else {
          setHtml(data.html || "(空文档)");
        }
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
  if (!html) return <div className="preview-empty">空文档</div>;

  return (
    <div className="preview-docx">
      <div
        className="preview-docx-content"
        dangerouslySetInnerHTML={{ __html: html }}
      />
    </div>
  );
}
