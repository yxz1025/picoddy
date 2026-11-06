import { useState } from "react";
import { apiGet, apiPost } from "../api/client";

interface SecretStatus {
  configured: boolean;
  source: "environment" | "secure-store" | "none";
  error: string | null;
}

export function SkillHubAuthConfig({ checking, onSaved }: {
  checking: boolean;
  onSaved: () => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [secret, setSecret] = useState("");
  const [status, setStatus] = useState<SecretStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function showConfig() {
    setOpen(true);
    setSecret("");
    setStatus(null);
    setError(null);
    setBusy(true);
    try { setStatus(await apiGet<SecretStatus>("/api/skillhub/auth/config")); }
    catch { setError("无法读取技能市场配置，请关闭后重试"); }
    finally { setBusy(false); }
  }

  async function save() {
    setBusy(true);
    setError(null);
    try {
      await apiPost<SecretStatus>("/api/skillhub/auth/config", { secret });
      setSecret("");
      setOpen(false);
      await onSaved();
    } catch (failure) {
      setSecret("");
      setError(failure instanceof Error ? failure.message : "配置保存失败，请重试");
    } finally { setBusy(false); }
  }

  return (
    <div className="skillhub-auth-config">
      {!open ? (
        <button type="button" className="skillhub-retry-btn" disabled={checking || busy} onClick={() => void showConfig()}>
          配置技能市场
        </button>
      ) : (
        <form className="skillhub-config-form" aria-label="技能市场配置" onSubmit={event => { event.preventDefault(); void save(); }}>
          <strong>配置技能市场</strong>
          <p>请填写管理员提供的共享密钥。密钥须与技能库服务端一致，保存后自动重新连接。</p>
          {busy && <p role="status">正在处理…</p>}
          {status?.source === "environment" ? (
            <p>当前使用环境变量配置。修改密钥前，请修正或移除 SKILLHUB_AUTH_ACCESS_TOKEN_SECRET（或 SKILLHUB_ACCESS_TOKEN_SECRET_API_KEY）并重启应用。</p>
          ) : (
            <>
              {status?.configured && <p>已配置密钥，可填写新密钥替换。</p>}
              <label htmlFor="skillhub-shared-secret">共享密钥（32 字节的 Base64 编码）</label>
              <input id="skillhub-shared-secret" type="password" autoComplete="off" spellCheck={false}
                maxLength={256} value={secret} disabled={busy || !status}
                onChange={event => setSecret(event.target.value)} />
              <p>密钥使用系统安全存储保存。</p>
            </>
          )}
          {(error || status?.error) && <p role="alert">{error || status?.error}</p>}
          <div className="skillhub-config-actions">
            <button type="submit" className="skillhub-retry-btn"
              disabled={busy || checking || !secret.trim() || !status || status.source === "environment"}>
              保存并连接
            </button>
            <button type="button" className="skillhub-retry-btn" disabled={busy}
              onClick={() => { setSecret(""); setOpen(false); }}>关闭</button>
          </div>
        </form>
      )}
    </div>
  );
}
