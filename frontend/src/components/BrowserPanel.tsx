import { useState, useEffect, useCallback, useRef } from "react";
import "./BrowserPanel.css";

interface BrowserStatus {
  visible: boolean;
  url: string;
  title: string;
  isLoading: boolean;
  canGoBack: boolean;
  canGoForward: boolean;
}

function normalizeUrl(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) return "";
  if (/^https?:\/\//i.test(trimmed) || /^about:/i.test(trimmed)) return trimmed;
  if (/^[\w-]+(\.[\w-]+)+/.test(trimmed)) return `https://${trimmed}`;
  return `https://www.google.com/search?q=${encodeURIComponent(trimmed)}`;
}

export default function BrowserPanel() {
  const [status, setStatus] = useState<BrowserStatus>({
    visible: false, url: "about:blank", title: "", isLoading: false,
    canGoBack: false, canGoForward: false,
  });
  const [urlInput, setUrlInput] = useState("");
  const contentRef = useRef<HTMLDivElement>(null);
  const api = (window as any).electronAPI?.browser;

  // 同步 WebContentsView 坐标
  const syncBounds = useCallback(() => {
    if (!contentRef.current || !api) return;
    const rect = contentRef.current.getBoundingClientRect();
    api.setBounds(Math.round(rect.x), Math.round(rect.y), Math.round(rect.width), Math.round(rect.height));
  }, [api]);

  useEffect(() => {
    const el = contentRef.current;
    if (!el || !api) return;
    syncBounds();
    const observer = new ResizeObserver(syncBounds);
    observer.observe(el);
    return () => observer.disconnect();
  }, [syncBounds, api]);

  // 订阅浏览器状态
  useEffect(() => {
    if (!api) return;
    api.getStatus().then((s: BrowserStatus) => {
      if (s) {
        setStatus(s);
        if (s.url && s.url !== "about:blank") setUrlInput(s.url);
      }
    });
    const unsub = api.onStateChanged((s: BrowserStatus) => {
      setStatus(s);
      if (s.url && s.url !== "about:blank") setUrlInput(s.url);
    });
    return unsub;
  }, [api]);

  // 打开时自动显示 WebContentsView
  useEffect(() => {
    api?.show();
    return () => { api?.hide(); };
  }, [api]);

  const handleNavigate = () => {
    const url = normalizeUrl(urlInput);
    if (url) api?.navigate(url);
  };

  if (!api) {
    return <div className="browser-panel-fallback">内置浏览器仅在 Electron 环境下可用</div>;
  }

  return (
    <div className="browser-panel">
      <div className="browser-header">
        <button className="browser-nav-btn" disabled={!status.canGoBack} onClick={() => api.goBack()} title="后退">◀</button>
        <button className="browser-nav-btn" disabled={!status.canGoForward} onClick={() => api.goForward()} title="前进">▶</button>
        <button className="browser-nav-btn" onClick={() => status.isLoading ? api.stop() : api.reload()} title={status.isLoading ? "停止" : "刷新"}>
          {status.isLoading ? "✕" : "⟳"}
        </button>
        <input
          className="browser-url-input"
          value={urlInput}
          onChange={(e) => setUrlInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleNavigate()}
          placeholder="输入网址或搜索..."
        />
        <button className="browser-nav-btn" onClick={handleNavigate} title="转到">→</button>
      </div>
      <div className="browser-content" ref={contentRef} />
    </div>
  );
}
