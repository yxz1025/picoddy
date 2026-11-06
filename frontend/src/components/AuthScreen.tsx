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
            <div className="auth-kicker">PiCoddy Desktop</div>
            <h1>登录后继续</h1>
          </div>
        </div>
        <p className="auth-copy">
          需要先通过企业 CAS 完成认证，然后才能进入客户端。
        </p>

        <div className="auth-status">
          {phase === "checking"
            ? "正在检查登录态…"
            : phase === "signingIn"
            ? "已打开系统浏览器，请完成认证后返回。"
            : "尚未登录"}
        </div>

        <button
          type="button"
          className="auth-btn"
          onClick={handleLogin}
          disabled={clicked || phase === "signingIn"}
        >
          {phase === "signingIn"
            ? "认证中…"
            : clicked
            ? "已发送请求…"
            : "使用企业账号登录"}
        </button>

        {error ? <div className="auth-error">{error}</div> : null}

        <div className="auth-footnote">
          登录地址由系统浏览器打开，认证成功后自动进入客户端。
        </div>
      </div>
    </div>
  );
}
