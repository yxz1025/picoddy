import { useEffect, useRef, useState } from "react";
import { apiGet, apiPost } from "../api/client";

type Status = { state: string; url?: string; error?: string };
/** Standard MCP OAuth lives on the existing connector card. Enterprise cards keep their own flows. */
export default function McpOAuthControls({ name, onConnected, autoStart = false, onAutoStarted, hideLogin = false }: { name: string; onConnected: () => void; autoStart?: boolean; onAutoStarted?: () => void; hideLogin?: boolean }) {
  const [status, setStatus] = useState<Status>({ state: "idle" });
  const [busy, setBusy] = useState(false);
  const pending = status.state === "connecting" || status.state === "authorizing";
  const started = useRef(false);
  useEffect(() => {
    if (autoStart && !started.current) {
      started.current = true;
      onAutoStarted?.();
      void action('login');
    } else if (!autoStart && !started.current) {
      let active = true;
      void apiGet<Status>(`/api/mcp/oauth?name=${encodeURIComponent(name)}`).then(next => { if (active) setStatus(next); }).catch(() => {});
      return () => { active = false; };
    }
  }, [name, autoStart, onAutoStarted]);
  useEffect(() => {
    if (!pending) return;
    let disposed = false;
    const timer = setInterval(() => {
      apiGet<Status>(`/api/mcp/oauth?name=${encodeURIComponent(name)}`).then(next => {
        if (disposed) return;
        setStatus(next);
        if (next.state === "authorized") onConnected();
      }).catch(error => { if (!disposed) setStatus({ state: "error", error: String(error) }); });
    }, 1000);
    return () => { disposed = true; clearInterval(timer); };
  }, [name, pending, onConnected]);
  async function action(action: "login" | "cancel" | "logout") {
    setBusy(true);
    try {
      const next = await apiPost<Status>("/api/mcp/oauth", { name, action });
      setStatus(next);
      if (next.state === "authorized" || action === "logout") onConnected();
    } catch (error) { setStatus({ state: "error", error: error instanceof Error ? error.message : String(error) }); }
    finally { setBusy(false); }
  }
  return <div className="mcp-detail-row">
    {!hideLogin && <button className="ep-btn ep-btn-secondary" disabled={busy || pending} onClick={() => void action("login")}>授权连接</button>}
    {pending && <button className="ep-btn ep-btn-secondary" disabled={busy} onClick={() => void action("cancel")}>取消授权</button>}
    {!pending && <button className="ep-btn ep-btn-secondary" disabled={busy} onClick={() => void action("logout")}>退出授权</button>}
    {status.url && <a href={status.url} target="_blank" rel="noreferrer">打开授权页面</a>}
    <span role="status">{status.error || ({ connecting: "正在连接…", authorizing: "等待浏览器授权", authorized: "已授权", cancelled: "已取消" } as Record<string, string>)[status.state]}</span>
  </div>;
}
