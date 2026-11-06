import { useState, type FormEvent } from "react";
import { ArrowRight, Cloud, LockKeyhole } from "lucide-react";

import { api, errorMessage } from "../api/client";
import type { User } from "../types";
import { Button } from "./ui";

export function Login({ onAuthenticated }: { onAuthenticated: (user: User) => void }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!email.trim() || !password) {
      setError("请输入邮箱和密码");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const user = await api.post<User>("/api/auth/login", { email: email.trim(), password });
      onAuthenticated(user);
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="login-page">
      <section className="login-mark" aria-label="产品介绍">
        <img className="login-mark__seal" src="/icon-128.png" alt="PiCoddy" />
        <div>
          <span className="eyebrow">PiCoddy · AI WORKSPACE</span>
          <h1>你好，我是 PiCoddy</h1>
          <p>从一个想法开始，一起把事情做成。</p>
        </div>
        <div className="login-mark__foot">
          <Cloud size={17} /> 云端隔离运行 · 任务持久保存
        </div>
      </section>

      <section className="login-card">
        <div className="login-card__number">01</div>
        <span className="eyebrow">安全登录</span>
        <h2>回到工作台</h2>
        <p className="muted">使用管理员为你创建的账号。凭据仅通过同源安全会话提交。</p>
        <form onSubmit={submit} className="login-form">
          <label>
            <span>邮箱</span>
            <input
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              autoComplete="email"
              placeholder="name@example.com"
              autoFocus
            />
          </label>
          <label>
            <span>密码</span>
            <div className="input-with-icon">
              <LockKeyhole size={16} />
              <input
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                autoComplete="current-password"
                placeholder="输入密码"
              />
            </div>
          </label>
          {error ? <p className="form-error" role="alert">{error}</p> : null}
          <Button variant="primary" type="submit" disabled={submitting}>
            {submitting ? "正在验证…" : "进入工作台"} <ArrowRight size={17} />
          </Button>
        </form>
        <small className="login-card__security">HttpOnly Cookie · Same-Origin API</small>
      </section>
    </main>
  );
}
