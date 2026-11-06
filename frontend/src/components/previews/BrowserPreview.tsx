import { useEffect, useRef, useState } from "react";

interface BrowserPreviewProps {
  filePath?: string;
  url?: string;
}

function LocalSitePreview({ filePath }: { filePath: string }) {
  const [src, setSrc] = useState("");
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const view = useRef<HTMLElement | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    setSrc("");
    setError("");
    void fetch("/api/preview/site", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: filePath }), signal: controller.signal,
    }).then(async response => {
      if (!response.ok) throw new Error("无法打开网页文件，请确认文件存在且可读取。");
      const data = await response.json();
      if (typeof data.url !== "string") throw new Error("预览地址无效。");
      if (!controller.signal.aborted) setSrc(new URL(data.url, window.location.origin).href);
    }).catch(reason => {
      if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "网页预览失败。");
    });
    return () => controller.abort();
  }, [filePath, attempt]);

  useEffect(() => {
    const element = view.current;
    if (!element) return;
    const failed = (event: Event) => {
      const failure = event as Event & { isMainFrame?: boolean; errorCode?: number; errorDescription?: string };
      if (failure.isMainFrame && failure.errorCode !== -3) setError(`网页加载失败：${failure.errorDescription || "请重试"}`);
    };
    element.addEventListener("did-fail-load", failed);
    return () => element.removeEventListener("did-fail-load", failed);
  }, [src]);

  if (error) return <div className="preview-error">{error} <button onClick={() => setAttempt(value => value + 1)}>重新加载</button></div>;
  if (!src) return <div className="preview-loading">正在加载网页…</div>;
  return <div className="preview-browser">
    {/* @ts-ignore — Electron webview tag */}
    <webview ref={view} src={src} className="preview-browser-webview" partition="persist:agent-browser" />
  </div>;
}

export default function BrowserPreview({ filePath, url }: BrowserPreviewProps) {
  const [srcUrl, setSrcUrl] = useState(url || "");
  const [inputUrl, setInputUrl] = useState(url || "");

  useEffect(() => {
    if (url !== undefined) {
      setSrcUrl(url);
      setInputUrl(url);
    }
  }, [url]);

  const handleNavigate = () => {
    const normalized = inputUrl.startsWith("http") ? inputUrl : `https://${inputUrl}`;
    setSrcUrl(normalized);
  };

  // Preserve the site's directory URL so styles, modules and images resolve.
  if (filePath && !url) {
    return <LocalSitePreview key={filePath} filePath={filePath} />;
  }

  return (
    <div className="preview-browser">
      <div className="preview-browser-toolbar">
        <input
          className="preview-browser-url"
          value={inputUrl}
          onChange={(e) => setInputUrl(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleNavigate()}
          placeholder="输入网址..."
        />
        <button className="preview-browser-go" onClick={handleNavigate}>
          →
        </button>
      </div>
      {srcUrl ? (
        // @ts-ignore — Electron webview tag
        <webview
          src={srcUrl}
          className="preview-browser-webview"
          // @ts-ignore
          partition="persist:agent-browser"
          // @ts-ignore
          allowpopups="true"
        />
      ) : (
        <div className="preview-browser-empty">
          <div className="preview-empty-icon">🌐</div>
          <div className="preview-empty-text">输入网址开始浏览</div>
        </div>
      )}
    </div>
  );
}
