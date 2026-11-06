import { useState } from "react";
import { PiLogo } from "./PiLogo";
import "./AuthScreen.css";

export type AuthScreenPhase = "checking" | "signedOut" | "signingIn" | "error";

interface AuthScreenProps {
  phase: AuthScreenPhase;
  error?: string | null;
  onLogin: () => Promise<void>;
}

export default function AuthScreen({ phase, error, onLogin }: AuthScreenProps) {
  const [clicked, setClicked] = useState(false);

  const handleLogin = async () => {
    if (clicked) return;
    setClicked(true);
    try {
      await onLogin();
    } catch {
      // A failed redirect setup stays on this page and must remain retryable.
      setClicked(false);
    }
  };

  return (
    <div className="auth-shell">
      <div className="auth-orb auth-orb-a" />
      <div className="auth-orb auth-orb-b" />
      <div className="auth-panel">
        <div className="auth-brand">
          <PiLogo size={40} />
          <div>
            <div className="auth-kicker">PiCoddy Cloud</div>
            <h1>登录后继续</h1>
          </div>
        </div>
        <p className="auth-copy">
          通过企业 CAS 完成认证，进入你的云端独立工作空间。
        </p>

        <div className="auth-status">
          {phase === "checking"
            ? "正在检查登录态…"
            : phase === "signingIn"
            ? "正在前往企业认证…"
            : "尚未登录"}
        </div>

        <button
          type="button"
          className="auth-btn"
          disabled={clicked || phase === "signingIn" || phase === "checking"}
          onClick={() => { void handleLogin(); }}
        >
          {phase === "signingIn"
            ? "正在前往企业认证…"
            : clicked
            ? "正在发起认证…"
            : "使用企业账号登录"}
        </button>

        {error ? <div className="auth-error" role="alert">{error}</div> : null}

        <div className="auth-footnote">
          认证将在当前页面继续。成功后自动返回 PiCoddy；云端任务与本机文件保持隔离。
        </div>
      </div>
    </div>
  );
}
