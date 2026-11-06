import { clearCloudAdapterCaches, requestDesktopApi, setCloudAdapterUser } from "./cloudAdapter";
import { ApiError, requestCloudJson } from "./cloudHttp";

export { ApiError, requestCloudJson } from "./cloudHttp";

export interface AuthSessionView {
  id: string; userId: string; nick: string; avatar: string;
  profile: Record<string, string>; loggedInAt: number; expiresAt: number;
}
export interface AuthSessionResponse { authenticated: boolean; session: AuthSessionView | null }
interface CloudUser {
  id: string;
  email: string | null;
  name: string;
  subject: string;
  avatar: string;
  sessionId: string;
  loggedInAt: string;
  expiresAt: string;
}

export interface EnterpriseLoginResponse {
  ok: true;
  authenticated: false;
  loginUrl: string;
}

let sessionUserId: string | null = null;
function resetForUser(userId: string | null): void {
  if (sessionUserId !== userId) clearCloudAdapterCaches();
  sessionUserId = userId;
  setCloudAdapterUser(userId);
}

/** Browser-only compatibility export: cloud never resolves Electron routes. */
export function resolveIPCRouteForTest(_method: string, _path: string, _body?: unknown): null { return null; }

export function normalizeIpcError(error: unknown): unknown {
  if (!error || typeof error !== "object") return error;
  const value = error as { name?: unknown; message?: unknown; status?: unknown; code?: unknown };
  if (value.name !== "ApiError" || !Number.isInteger(value.status)) return error;
  return new ApiError(
    Number(value.status),
    typeof value.message === "string" ? value.message : `请求失败 (${value.status})`,
    typeof value.code === "string" ? value.code : undefined,
  );
}

/** Retained for import compatibility; invoking IPC in a browser is an explicit error. */
export async function callIPC<T = any>(
  _ipc: { call: (name: string, ...args: any[]) => Promise<unknown> },
  _name: string,
  ..._args: any[]
): Promise<T> {
  throw new ApiError(501, "云端浏览器不提供 Electron IPC", "IPC_UNAVAILABLE");
}

export const apiGet = <T = any>(path: string): Promise<T> => requestDesktopApi<T>("GET", path);
export const apiPost = <T = any>(path: string, body?: any): Promise<T> => requestDesktopApi<T>("POST", path, body ?? {});
export const apiPut = <T = any>(path: string, body?: any): Promise<T> => requestDesktopApi<T>("PUT", path, body ?? {});
export const apiDelete = <T = any>(path: string): Promise<T> => requestDesktopApi<T>("DELETE", path);

export interface PickDirectoryResult { cancelled: boolean; path: string | null; name?: string }
export const pickDirectory = (): Promise<PickDirectoryResult> => requestDesktopApi("GET", "/api/pick-dir");

export async function authSession(): Promise<AuthSessionResponse> {
  try {
    const user = await requestCloudJson<CloudUser>("GET", "/api/auth/me");
    resetForUser(user.id);
    const profile: Record<string, string> = {
      username: user.subject,
      subject: user.subject,
    };
    if (user.email) profile.email = user.email;
    return {
      authenticated: true,
      session: {
        id: user.sessionId,
        // Keep the cloud owner UUID distinct from the enterprise subject/session ID.
        userId: user.id,
        nick: user.name || user.subject,
        avatar: user.avatar || "",
        profile,
        loggedInAt: parseIsoTime(user.loggedInAt),
        expiresAt: parseIsoTime(user.expiresAt),
      },
    };
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) {
      resetForUser(null);
      return { authenticated: false, session: null };
    }
    throw error;
  }
}

function parseIsoTime(value: string): number {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function authLogin(): Promise<EnterpriseLoginResponse> {
  return requestCloudJson<EnterpriseLoginResponse>("POST", "/api/auth/login", {});
}

export function requireEnterpriseLoginUrl(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error("企业登录地址无效，请重试。");
  }
  try {
    const url = new URL(value);
    if (url.protocol !== "https:") throw new Error();
    return url.href;
  } catch {
    throw new Error("企业登录地址无效，请重试。");
  }
}

const CAS_CALLBACK_MESSAGES: Record<string, string> = {
  CAS_LOGIN_FAILED: "企业登录失败，请重试。",
  CAS_LOGIN_EXPIRED: "登录请求已过期，请重新发起企业认证。",
};

/** Consumes the server's allowlisted callback error without reflecting its raw value. */
export function consumeCasCallbackError(
  href: string,
  replaceLocation: (url: string) => void,
): string | null {
  let url: URL;
  try {
    url = new URL(href);
  } catch {
    return null;
  }
  const code = url.searchParams.get("auth_error");
  if (!code) return null;
  replaceLocation(`${url.pathname}${url.hash}`);
  return CAS_CALLBACK_MESSAGES[code] ?? "企业登录未完成，请重试。";
}

export async function authLogout(): Promise<{ ok: boolean }> {
  await requestCloudJson("POST", "/api/auth/logout", {});
  clearCloudAdapterCaches();
  resetForUser(null);
  return { ok: true };
}

/** Compatibility helper: this argument is a cloud run ID, not a conversation ID. */
export function createEventSource(runId: string): EventSource {
  return new EventSource(`/api/runs/${encodeURIComponent(runId)}/events`);
}
