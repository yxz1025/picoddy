import { signInMcpServer } from "../vendor/pi_native_extensions.ts";
import { connectMcpServerByName, getNativeMcpConnection, loadMcpConfig, nativeMcpCredentials } from "./mcp.ts";

type Status = { state: "idle" | "connecting" | "authorizing" | "authorized" | "cancelled" | "error"; url?: string; error?: string };
type Attempt = { status: Status; cancelled: boolean; cancel?: () => void; done: Promise<void> };
const attempts = new Map<string, Attempt>();
export function mcpOAuthStatus(name: string): Status { return attempts.get(name)?.status ?? { state: "idle" }; }

async function assertStandardOAuth(name: string) {
  const config = (await loadMcpConfig()).mcpServers[name];
  if (!config?.url || config.command || config.type?.toLowerCase() === "sse" || config.managedBy || config.authProvider || config.provider || config.auth || Object.keys({ ...config.staticHeaders, ...config.headers }).some(key => key.toLowerCase() === "authorization")) {
    throw new Error("此连接器不使用标准 MCP OAuth，请使用原有连接器授权或请求头配置");
  }
  if (config.disabled || config.enabled === false) throw new Error("请先启用此连接器");
  return config;
}

export async function startMcpOAuth(name: string, openUrl?: (url: string) => Promise<string | undefined | null>): Promise<Status> {
  await assertStandardOAuth(name);
  const old = attempts.get(name);
  if (old && ["connecting", "authorizing"].includes(old.status.state)) return old.status;
  const attempt: Attempt = { status: { state: "connecting" }, cancelled: false, done: Promise.resolve() };
  attempts.set(name, attempt);
  const timeout = setTimeout(() => { attempt.cancelled = true; attempt.cancel?.(); }, 5 * 60_000);
  timeout.unref();
  attempt.done = (async () => {
    try {
      try { await connectMcpServerByName(name); } catch (error) {
        if ((error as { code?: string }).code !== "MCP_AUTH_REQUIRED") throw error;
      }
      const connection = getNativeMcpConnection(name);
      if (!connection?.oauthUrl) throw new Error("MCP OAuth 连接不可用");
      if (attempt.cancelled) { attempt.status = { state: "cancelled" }; return; }
      if (connection.state !== "connected") {
        await signInMcpServer({
          serverUrl: connection.oauthUrl,
          store: nativeMcpCredentials().forServer(name, connection.oauthUrl),
          settings: connection.oauthSettings(), challenge: connection.challenge,
          prompt: {
            showAuthorizationUrl: url => {
              attempt.status = { state: "authorizing", url: url.href };
              void openUrl?.(url.href).then(error => {
                if (error && attempt.status.state === 'authorizing') attempt.status.error = '无法打开浏览器，请点击打开授权页面';
              }).catch(() => {
                if (attempt.status.state === 'authorizing') attempt.status.error = '无法打开浏览器，请点击打开授权页面';
              });
            },
            promptForRedirectUrl: signal => new Promise(resolve => {
              attempt.cancel = () => resolve(undefined);
              signal.addEventListener("abort", attempt.cancel, { once: true });
              if (attempt.cancelled || signal.aborted) resolve(undefined);
            }),
          },
        });
        if (attempt.cancelled) { attempt.status = { state: "cancelled" }; return; }
        await connection.reconnect();
        await connectMcpServerByName(name);
      }
      attempt.status = { state: "authorized" };
    } catch (error) {
      attempt.status = attempt.cancelled ? { state: "cancelled" } : { state: "error", error: error instanceof Error ? error.message : String(error) };
    } finally { clearTimeout(timeout); attempt.cancel = undefined; }
  })();
  return attempt.status;
}
export async function cancelMcpOAuth(name: string): Promise<Status> {
  const attempt = attempts.get(name);
  if (attempt) {
    attempt.cancelled = true;
    attempt.cancel?.();
    await attempt.done;
  }
  return mcpOAuthStatus(name);
}
export async function logoutMcpOAuth(name: string): Promise<Status> {
  const config = await assertStandardOAuth(name);
  await cancelMcpOAuth(name);
  const connection = getNativeMcpConnection(name);
  if (connection) await connection.close(); // Let any rotating refresh save its result before removing it.
  nativeMcpCredentials().remove(name, config.url!);
  if (connection) await connection.signOut();
  attempts.delete(name);
  return { state: "idle" };
}
export async function cancelAllMcpOAuth(): Promise<void> {
  await Promise.all([...attempts.keys()].map(cancelMcpOAuth));
}
