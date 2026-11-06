import { useEffect, useRef, useState } from "react";
import { apiGet, apiPost } from "../api/client";

type Status = { state: string; url?: string; error?: string };

export function safeOAuthUrl(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    const url = new URL(value);
    if (url.username || url.password) return null;
    if (url.protocol === "https:") return url.href;
    const loopback = url.hostname === "localhost" || url.hostname === "127.0.0.1" ||
      url.hostname === "[::1]";
    return url.protocol === "http:" && loopback ? url.href : null;
  } catch {
    return null;
  }
}

export function openOAuthWindow(): Window | null {
  try {
    const popup = window.open('about:blank', '_blank');
    if (popup) {
      popup.opener = null;
      popup.document.title = '正在准备授权';
      popup.document.body.textContent = '正在准备授权页面，请稍候…';
    }
    return popup;
  } catch { return null; }
}

/** Standard MCP OAuth lives on the existing connector card. Enterprise cards keep their own flows. */
export default function McpOAuthControls({ id, name, onConnected, autoStart = false, onAutoStarted, hideLogin = false, authorizationWindow }: { id?: string; name: string; onConnected: () => void; autoStart?: boolean; onAutoStarted?: () => void; hideLogin?: boolean; authorizationWindow?: { current: Window | null } }) {
  const [status, setStatus] = useState<Status>({ state: "idle" });
  const [busy, setBusy] = useState(false);
  const pending = status.state === "connecting" || status.state === "authorizing";
  const started = useRef(false);
  const localWindow = useRef<Window | null>(null);
  const popup = authorizationWindow ?? localWindow;
  const ownedWindow = useRef<Window | null>(null);
  const notified = useRef(false);
  const onConnectedRef = useRef(onConnected);
  onConnectedRef.current = onConnected;
  function notifyConnected() {
    if (notified.current) return;
    notified.current = true;
    if (ownedWindow.current && popup.current === ownedWindow.current) {
      popup.current?.close(); popup.current = null; ownedWindow.current = null;
      window.focus();
    }
    onConnectedRef.current();
  }
  const identity = id ? { id } : { name };
  const statusPath = `/api/mcp/oauth?${id
    ? `id=${encodeURIComponent(id)}`
    : `name=${encodeURIComponent(name)}`}`;
  const oauthUrl = safeOAuthUrl(status.url);
  useEffect(() => {
    if (autoStart && !started.current) {
      started.current = true;
      onAutoStarted?.();
      ownedWindow.current = popup.current;
      void action('login', false);
    } else if (!autoStart && !started.current) {
      let active = true;
      void apiGet<Status>(statusPath).then(next => { if (active) { setStatus(next); if (next.state === "authorized") notifyConnected(); } }).catch(() => {});
      return () => { active = false; };
    }
  }, [statusPath, autoStart, onAutoStarted]);
  useEffect(() => {
    if (!pending) return;
    let disposed = false;
    const timer = setInterval(() => {
      apiGet<Status>(statusPath).then(next => {
        if (disposed) return;
        setStatus(next);
        if (next.state === "authorized") notifyConnected();
      }).catch(error => { if (!disposed) setStatus({ state: "error", error: String(error) }); });
    }, 1000);
    return () => { disposed = true; clearInterval(timer); };
  }, [statusPath, pending]);
  async function action(action: "login" | "cancel" | "logout", reserveWindow = true) {
    if (action === 'login') {
      notified.current = false;
      if (reserveWindow) { popup.current?.close(); popup.current = openOAuthWindow(); ownedWindow.current = popup.current; }
    } else { popup.current?.close(); popup.current = null; }
    setBusy(true);
    try {
      const next = await apiPost<Status>("/api/mcp/oauth", { ...identity, action });
      setStatus(next);
      if (action === 'login' && next.state !== 'authorized') {
        const safeUrl = safeOAuthUrl(next.url);
        if (safeUrl && popup.current && !popup.current.closed) popup.current.location.replace(safeUrl);
        else if (!safeUrl) { popup.current?.close(); popup.current = null; }
      }
      if (next.state === "authorized") notifyConnected();
      else if (action === "logout") onConnectedRef.current();
    } catch (error) { popup.current?.close(); popup.current = null; setStatus({ state: "error", error: error instanceof Error ? error.message : String(error) }); }
    finally { setBusy(false); }
  }
  return <div className="mcp-detail-row">
    {!hideLogin && <button className="ep-btn ep-btn-secondary" disabled={busy || pending} onClick={() => void action("login")}>授权连接</button>}
    {pending && <button className="ep-btn ep-btn-secondary" disabled={busy} onClick={() => void action("cancel")}>取消授权</button>}
    {!pending && <button className="ep-btn ep-btn-secondary" disabled={busy} onClick={() => void action("logout")}>退出授权</button>}
    {oauthUrl && <a href={oauthUrl} target="_blank" rel="noreferrer noopener">打开授权页面</a>}
    <span role="status">{status.url && !oauthUrl
      ? "授权地址无效"
      : status.error || ({ connecting: "正在连接…", authorizing: "等待浏览器授权", authorized: "已授权", cancelled: "已取消" } as Record<string, string>)[status.state]}</span>
  </div>;
}
