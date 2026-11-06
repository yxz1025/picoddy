import { ArrowUpRight, Check, LoaderCircle } from "lucide-react";
import "./OpenAISubscriptionControls.css";
import { useEffect, useRef, useState } from "react";
import { apiGet, apiPost } from "../api/client";
import { useStore } from "../store/useStore";

type Status = { state: string; authorized: boolean; url?: string; manualInput?: boolean; error?: string };
export default function OpenAISubscriptionControls({ mode, onMode }: {
  mode: "oauth" | "api_key"; onMode: (mode: "oauth" | "api_key") => void;
}) {
  const loadSettings = useStore(s => s.loadSettings);
  const [status, setStatus] = useState<Status>({state:"idle",authorized:false});
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(false);
  const [callback, setCallback] = useState("");
  const lastAuthorized = useRef<boolean | undefined>(undefined);
  const opened = useRef<string | undefined>(undefined);
  const pending = status.state === "connecting" || status.state === "authorizing";
  useEffect(() => {
    let active = true;
    const poll = async () => {
      try {
        const next = await apiGet<Status>("/api/settings/openai-subscription");
        if (!active) return;
        if (lastAuthorized.current !== undefined && lastAuthorized.current !== next.authorized) void loadSettings();
        lastAuthorized.current = next.authorized;
        setStatus(next);
        setReady(true);
      } catch { if (active) setStatus(s => ({...s,error:"无法读取授权状态，请重试"})); }
    };
    void poll();
    const timer = setInterval(() => void poll(), 1500);
    return () => {active=false;clearInterval(timer);};
  }, [loadSettings]);
  useEffect(() => {
    if (status.url && status.url !== opened.current) {
      opened.current = status.url;
      window.open(status.url, "_blank", "noopener,noreferrer");
    }
  }, [status.url]);
  async function action(action: "login" | "cancel" | "logout" | "submit") {
    setBusy(true);
    try {
      const next = await apiPost<Status>("/api/settings/openai-subscription", {action, ...(action === "submit" ? {value:callback} : {})});
      setStatus(next);
      setCallback("");
      if (action === "logout" || next.authorized) await loadSettings();
      return true;
    } catch { setStatus(s => ({...s,error:"授权操作失败，请重试"})); return false; }
    finally {setBusy(false);}
  }
  const statusText = pending ? "等待授权" : status.authorized ? "已授权" : status.state === "cancelled" ? "已取消" : "未登录";
  return <div className="openai-auth">
    <div className="openai-auth-methods" role="group" aria-label="OpenAI 认证方式">
      <button aria-pressed={mode === "oauth"} disabled={!ready || busy || pending} onClick={() => onMode("oauth")}>ChatGPT 订阅</button>
      <button aria-pressed={mode === "api_key"} disabled={!ready || busy || pending} onClick={async () => {
        if (!status.authorized || await action("logout")) onMode("api_key");
      }}>{status.authorized ? "退出订阅，使用 API Key" : "API Key"}</button>
    </div>
    {mode === "oauth" && <div className="openai-auth-panel">
      <div className="openai-auth-main">
        <div className="openai-auth-copy">
          <div className="openai-auth-heading">
            <span>连接 ChatGPT 账号</span>
            <span className={`openai-auth-status${status.authorized ? " is-connected" : ""}`} role="status">
              {pending ? <LoaderCircle size={12} className="openai-auth-spinner" /> : status.authorized ? <Check size={12} /> : <span className="openai-auth-dot" />}
              {statusText}
            </span>
          </div>
          <p>浏览器授权一次，即可使用订阅模型。</p>
        </div>
        <div className="openai-auth-actions">
          <button className="settings-btn btn-primary openai-auth-login" disabled={!ready || busy || pending} onClick={() => void action("login")}>
            {status.authorized ? "重新登录 ChatGPT" : "使用 ChatGPT 登录"}<ArrowUpRight size={15} aria-hidden="true" />
          </button>
          {pending && <button className="openai-auth-secondary" disabled={busy} onClick={() => void action("cancel")}>取消授权</button>}
          {status.authorized && !pending && <button className="openai-auth-secondary" disabled={busy} onClick={() => void action("logout")}>退出登录</button>}
        </div>
      </div>
      <p className="openai-auth-note">登录状态保存在本机，可用模型与额度以账号授权为准。</p>
      {status.error && <p className="openai-auth-error" role="alert">{status.error}</p>}
      {status.url && <a className="openai-auth-link" href={status.url} target="_blank" rel="noreferrer">打开 ChatGPT 授权页面<ArrowUpRight size={13} aria-hidden="true" /></a>}
      {pending && status.manualInput && <details className="openai-auth-manual">
        <summary>浏览器未自动返回？粘贴完整回调地址</summary>
        <div className="openai-auth-callback">
          <input aria-label="授权回调地址" placeholder="粘贴浏览器中的完整回调地址" className="settings-input" type="password" value={callback} onChange={e=>setCallback(e.target.value)} autoComplete="off" />
          <button className="settings-btn" disabled={busy || !callback.trim()} onClick={() => void action("submit")}>完成授权</button>
        </div>
      </details>}
    </div>}
  </div>;
}
