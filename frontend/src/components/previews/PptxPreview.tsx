import { useState, useEffect } from "react";

interface PptxPreviewProps {
  filePath: string;
}

interface SlideData {
  title: string;
  text: string;
}

function parseSlides(rawText: string): SlideData[] {
  const slides: SlideData[] = [];
  const parts = rawText.split(/^## /gm);
  for (const part of parts) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const lines = trimmed.split("\n");
    const title = lines[0].replace(/^第\s*\d+\s*页[：:]\s*/, "").trim();
    slides.push({ title: title || "幻灯片", text: lines.slice(1).join("\n").trim() });
  }
  return slides.length > 0 ? slides : [{ title: "幻灯片 1", text: rawText }];
}

export default function PptxPreview({ filePath }: PptxPreviewProps) {
  const [slides, setSlides] = useState<SlideData[]>([]);
  const [current, setCurrent] = useState(0);
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
          setSlides(parseSlides(data.text || ""));
          setCurrent(0);
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
  if (slides.length === 0) return <div className="preview-empty">空演示文稿</div>;

  const slide = slides[current];

  return (
    <div className="preview-pptx">
      <div className="preview-pptx-controls">
        <button
          className="preview-pptx-nav"
          disabled={current === 0}
          onClick={() => setCurrent((c) => c - 1)}
        >
          ◀ 上一页
        </button>
        <span className="preview-pptx-indicator">
          {current + 1} / {slides.length}
        </span>
        <button
          className="preview-pptx-nav"
          disabled={current >= slides.length - 1}
          onClick={() => setCurrent((c) => c + 1)}
        >
          下一页 ▶
        </button>
      </div>
      <div className="preview-pptx-slide">
        <h3 className="preview-pptx-title">{slide.title}</h3>
        <div className="preview-pptx-body">
          {slide.text.split("\n").map((line, i) => (
            <p key={i}>{line}</p>
          ))}
        </div>
      </div>
    </div>
  );
}
