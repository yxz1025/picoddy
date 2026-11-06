import { useEffect, useRef } from "react";
import "./WorkbenchView.css";

const WORKBENCH_URL = "https://www.baidu.com";

/**
 * 工作台 — 复用主进程 BrowserViewManager（WebContentsView）展示第三方网页。
 * 容器仅负责测量位置，实际渲染由主进程原生视图完成。
 */
export default function WorkbenchView() {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const browser = (window as any).electronAPI?.browser;
    if (!browser) return;

    const syncBounds = () => {
      const el = containerRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      browser.setBounds(
        Math.round(rect.x),
        Math.round(rect.y),
        Math.round(rect.width),
        Math.round(rect.height),
      );
    };

    void browser.navigate(WORKBENCH_URL);
    syncBounds();

    const observer = new ResizeObserver(() => syncBounds());
    if (containerRef.current) observer.observe(containerRef.current);

    return () => {
      observer.disconnect();
      void browser.hide();
    };
  }, []);

  return <div ref={containerRef} className="workbench-view"><div className="artifact-empty">云端业务工作台尚未接入。可在对话中使用云端浏览器工具；不访问本机浏览器。</div></div>;
}
