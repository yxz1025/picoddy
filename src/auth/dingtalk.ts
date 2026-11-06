// src/auth/dingtalk.ts
// 钉钉扫码登录（OAuth 2.0）—— 方案 B：浏览器跳转

export interface DingTalkConfig {
  appId: string;
  appSecret: string;
}

/** 获取钉钉配置（优先从环境变量读取） */
export function getDingTalkConfig(): DingTalkConfig | null {
  const appId = process.env["DINGTALK_APP_ID"] || "";
  const appSecret = process.env["DINGTALK_APP_SECRET"] || "";
  if (!appId || !appSecret) return null;
  return { appId, appSecret };
}

/** 生成钉钉扫码登录 URL（桌面端回调到本地 localhost） */
export function getDingTalkQRCodeUrl(state: string, port: number): string {
  const redirectUri = encodeURIComponent(`http://127.0.0.1:${port}/api/auth/callback`);
  return `https://login.dingtalk.com/oauth2/auth` +
    `?response_type=code` +
    `&client_id=${getDingTalkConfig()!.appId}` +
    `&redirect_uri=${redirectUri}` +
    `&scope=openid` +
    `&state=${state}`;
}

/** 用授权码换 access_token */
export async function exchangeCodeForToken(code: string): Promise<{
  accessToken: string;
  refreshToken: string;
  openId: string;
  corpId?: string;
  expiresIn?: number;
}> {
  const config = getDingTalkConfig()!;
  const resp = await fetch("https://api.dingtalk.com/v1.0/oauth2/accessToken", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      clientId: config.appId,
      clientSecret: config.appSecret,
      code,
      grantType: "authorization_code",
    }),
  });
  if (!resp.ok) {
    const errText = await resp.text();
    throw new Error(`钉钉 token 换取失败: ${resp.status} ${errText}`);
  }
  return resp.json();
}

/** 获取用户信息 */
export async function getUserInfo(accessToken: string): Promise<{
  nick: string;
  openId: string;
  unionId: string;
  avatar?: string;
  email?: string;
  mobile?: string;
}> {
  const resp = await fetch("https://api.dingtalk.com/v1.0/oauth2/userinfo", {
    headers: { "x-acs-dingtalk-access-token": accessToken },
  });
  if (!resp.ok) {
    const errText = await resp.text();
    throw new Error(`钉钉用户信息获取失败: ${resp.status} ${errText}`);
  }
  return resp.json();
}

// ===== 本地会话管理 =====

export interface AuthSession {
  userId: string;
  nick: string;
  avatar?: string;
  accessToken: string;
  refreshToken: string;
  loggedInAt: number;
  expiresAt: number;
}

/** 登录成功通知回调（供 main.ts 注册） */
export type LoginSuccessCallback = (session: AuthSession) => void;

// ===== HTML 回调页面（展示给用户 "登录成功，请关闭浏览器"）=====

export function buildLoginSuccessHtml(nick: string): string {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head><meta charset="UTF-8"><title>登录成功</title>
<style>
  body { font-family: -apple-system, sans-serif; display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0; background: #f5f5f5; }
  .card { background: white; padding: 40px; border-radius: 16px; box-shadow: 0 4px 24px rgba(0,0,0,0.1); text-align: center; }
  .check { font-size: 64px; color: #16a34a; }
  h2 { margin: 16px 0 8px; color: #1d1d1f; }
  p { color: #6b7280; margin: 0; }
</style></head>
<body>
<div class="card">
  <div class="check">✓</div>
  <h2>登录成功</h2>
  <p>欢迎回来，${nick}</p>
  <p style="margin-top: 12px; font-size: 13px;">你可以关闭此页面了</p>
</div>
</body></html>`;
}