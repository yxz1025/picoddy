import { createCipheriv, randomBytes, randomUUID } from "node:crypto";

export interface SkillHubIdentity {
  email: string;
  nickName?: string;
  headimgurl?: string;
}

export interface SkillHubCredential {
  identity: string;
  token: string;
  tokenExpiresAt: number | null;
  cookies: Record<string, string>;
}

export interface SkillHubCredentialStore {
  read(): Promise<SkillHubCredential | null>;
  write(value: SkillHubCredential): Promise<void>;
  clear(): Promise<void>;
}

export class SkillHubAuthError extends Error {
  constructor(message: string, readonly status = 502) { super(message); }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function normalizeIdentity(input: SkillHubIdentity): SkillHubIdentity {
  const email = input.email.trim().toLowerCase();
  if (email.length > 256 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new SkillHubAuthError("当前登录用户缺少有效邮箱，无法登录技能市场", 400);
  }
  const nickName = input.nickName?.trim();
  const headimgurl = input.headimgurl?.trim();
  return {
    email,
    ...(nickName && nickName.length <= 128 ? { nickName } : {}),
    ...(headimgurl && headimgurl.length <= 512 && /^https?:\/\//i.test(headimgurl) ? { headimgurl } : {}),
  };
}

export function validateSkillHubSecret(secret: string): void {
  if (!secret) {
    throw new SkillHubAuthError("技能市场登录配置缺失，请联系管理员完善客户端部署配置", 503);
  }
  if (!/^[A-Za-z0-9+/]{43}=$/.test(secret)) {
    throw new SkillHubAuthError("技能市场共享密钥格式无效：需要 Base64 编码的 32 字节密钥", 503);
  }
  const key = Buffer.from(secret, "base64");
  if (key.length !== 32 || key.toString("base64") !== secret) {
    throw new SkillHubAuthError("SKILLHUB_AUTH_ACCESS_TOKEN_SECRET 格式无效", 503);
  }
}

export function createSkillHubAccessToken(input: SkillHubIdentity, secret: string, now = Date.now()): string {
  validateSkillHubSecret(secret);
  const key = Buffer.from(secret, "base64");
  const iat = Math.floor(now / 1000);
  const payload = { appId: "skillhub", ...normalizeIdentity(input), iat, exp: iat + 300, jti: randomUUID() };
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv, { authTagLength: 16 });
  cipher.setAAD(Buffer.from("skillhub-access-token:v1", "utf8"));
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(payload), "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64url"), ciphertext.toString("base64url"), cipher.getAuthTag().toString("base64url")].join(".");
}

export function createSkillHubAuthClient(options: {
  baseUrl: string;
  getIdentity(): SkillHubIdentity;
  getSecret(): string | Promise<string>;
  tokenName: string;
  store: SkillHubCredentialStore;
  fetch?: typeof fetch;
  now?: () => number;
}) {
  const baseUrl = options.baseUrl.replace(/\/+$/, "");
  const fetcher = options.fetch ?? fetch;
  const now = options.now ?? Date.now;
  let cached: SkillHubCredential | null = null;
  let checked = false;
  let generation = 0;
  let pending: Promise<SkillHubCredential> | undefined;
  // All mutation, including logout, shares a queue so an old login cannot overwrite logout.
  let writes = Promise.resolve();
  function persist(operation: () => Promise<void>) {
    const next = writes.then(operation);
    writes = next.catch(() => {});
    return next;
  }

  async function request(path: string, cookies: Record<string, string>, token?: string, body?: unknown): Promise<
    { valid: false; data: null; status: number } | { valid: true; data: Record<string, unknown> }
  > {
    let response: Response;
    try {
      response = await fetcher(`${baseUrl}${path}`, {
        method: body === undefined ? "GET" : "POST",
        headers: {
          Accept: "application/json",
          ...(body === undefined ? {} : { "Content-Type": "application/json" }),
          ...(Object.keys(cookies).length ? { Cookie: Object.entries(cookies).map(([k, v]) => `${k}=${v}`).join("; ") } : {}),
          ...(body !== undefined && cookies["XSRF-TOKEN"] ? { "X-XSRF-TOKEN": decodeURIComponent(cookies["XSRF-TOKEN"]) } : {}),
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        redirect: "error",
        signal: AbortSignal.timeout(15_000),
      });
    } catch { throw new SkillHubAuthError("SkillHub 登录服务暂时不可用，请重试"); }
    const setCookies = response.headers.getSetCookie();
    for (const cookie of setCookies) {
      const pair = cookie.split(";", 1)[0];
      const equals = pair.indexOf("=");
      const name = pair.slice(0, equals).trim();
      if (equals > 0 && (name === "SESSION" || name === "XSRF-TOKEN")) {
        const value = pair.slice(equals + 1);
        if (!value || /max-age=0(?:;|$)/i.test(cookie)) delete cookies[name];
        else cookies[name] = value;
      }
    }
    if (response.status === 401 || response.status === 403) return { valid: false, data: null, status: response.status };
    if (!response.ok) throw new SkillHubAuthError(`SkillHub 登录请求失败（${response.status}）`);
    const envelope = await response.json().catch(() => null);
    if (!isRecord(envelope)) throw new SkillHubAuthError("SkillHub 登录响应无效");
    // whoami is a CLI response; session/token endpoints use the business envelope.
    if (path === "/api/v1/whoami") {
      const data = envelope?.data ?? envelope;
      if (!isRecord(data) || !isRecord(data.user)) throw new SkillHubAuthError("SkillHub Token 验证响应无效");
      return { valid: true, data };
    }
    if (envelope.code !== 0 || !isRecord(envelope.data)) {
      throw new SkillHubAuthError("SkillHub 登录响应无效");
    }
    return { valid: true, data: envelope.data };
  }

  async function acquire(checkSession: boolean, expectedGeneration: number) {
    const identity = normalizeIdentity(options.getIdentity());
    const key = `${baseUrl}\n${identity.email}`;
    const stored = cached ?? await options.store.read();
    let credential = stored?.identity === key ? { ...stored, cookies: { ...stored.cookies } } : null;
    const tokenCurrent = credential && (credential.tokenExpiresAt === null || credential.tokenExpiresAt > now());
    if (!checkSession && checked && tokenCurrent) return credential!;
    checked = false;
    let sessionValid = false;
    if (credential?.cookies.SESSION) {
      const result = await request("/api/v1/auth/me", credential.cookies);
      sessionValid = result.valid;
      if (result.valid && String(result.data.email ?? "").trim().toLowerCase() !== identity.email) {
        throw new SkillHubAuthError("SkillHub 登录身份与当前用户不一致", 401);
      }
    }
    if (sessionValid && tokenCurrent) {
      const result = await request("/api/v1/whoami", {}, credential!.token);
      if (result.valid) {
        await save(credential!, expectedGeneration);
        return credential!;
      }
    }
    async function login() {
      const cookies: Record<string, string> = {};
      const accessToken = createSkillHubAccessToken(identity, await options.getSecret(), now());
      const result = await request("/api/v1/auth/access-token/login", cookies, undefined, { accessToken });
      if (!result.valid) throw new SkillHubAuthError("SkillHub 邮箱登录被拒绝，请检查登录配置或账号状态", 401);
      if (String(result.data.email ?? "").trim().toLowerCase() !== identity.email || !cookies.SESSION || !cookies["XSRF-TOKEN"]) {
        throw new SkillHubAuthError("SkillHub 登录响应缺少匹配身份或 Session/CSRF Cookie");
      }
      credential = { identity: key, token: "", tokenExpiresAt: null, cookies };
    }
    if (!sessionValid) await login();
    const tokenBody = {
      name: options.tokenName, scopes: ["skill:read"], expiresAt: null,
    };
    let result = await request("/api/v1/tokens", credential!.cookies, undefined, tokenBody);
    // A session can expire between the check and token creation. Refresh once, never loop.
    if (!result.valid && result.status === 401 && sessionValid) {
      await login();
      result = await request("/api/v1/tokens", credential!.cookies, undefined, tokenBody);
    }
    if (!result.valid) throw new SkillHubAuthError("SkillHub 创建 Token 被拒绝，请重新进入技能市场", 401);
    if (typeof result.data.token !== "string" || !/^sk_[A-Za-z0-9_-]+$/.test(result.data.token)) {
      throw new SkillHubAuthError("SkillHub 创建 Token 响应无效");
    }
    const expiration = result.data.expiresAt ? Date.parse(String(result.data.expiresAt)) : null;
    if (expiration !== null && (!Number.isFinite(expiration) || expiration <= now())) {
      throw new SkillHubAuthError("SkillHub 返回了已过期的 Token");
    }
    credential = { ...credential!, token: result.data.token, tokenExpiresAt: expiration };
    await save(credential, expectedGeneration);
    return credential;
  }

  async function save(value: SkillHubCredential, expectedGeneration: number) {
    await persist(async () => {
      const currentKey = `${baseUrl}\n${normalizeIdentity(options.getIdentity()).email}`;
      if (expectedGeneration !== generation || value.identity !== currentKey) throw new SkillHubAuthError("登录用户已变更，请重新进入技能市场", 401);
      await options.store.write(value);
      cached = value;
      checked = true;
    });
  }

  return {
    async ensure(checkSession = true): Promise<SkillHubCredential> {
      if (pending) {
        const result = await pending;
        const key = `${baseUrl}\n${normalizeIdentity(options.getIdentity()).email}`;
        if (result.identity === key) return result;
        return this.ensure(checkSession);
      }
      const operation = acquire(checkSession, generation);
      pending = operation;
      try { return await operation; }
      finally { if (pending === operation) pending = undefined; }
    },
    async clear() {
      generation++;
      cached = null;
      checked = false;
      await persist(() => options.store.clear());
    },
  };
}
