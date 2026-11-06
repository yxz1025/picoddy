import { createMcpOAuthService } from "../../domains/connector/node/oauth.ts";
import { fail } from "../../shared/errors.ts";
import { randomBytes } from 'node:crypto';
import type { RequestContext } from "./routes.ts";

const CALLBACK_PATH = "/api/mcp/oauth/callback";
const OAUTH_PATH = "/api/mcp/oauth";

function identifier(value: unknown): string {
  if (typeof value !== "string" || !value.trim() || value.length > 200) {
    fail(400, "INVALID_REQUEST", "连接器标识不能为空");
  }
  return value.trim();
}

export function sendCallbackHtml(context: RequestContext, success: boolean): void {
  const nonce = randomBytes(18).toString('base64');
  const title = success ? "授权完成" : "授权未完成";
  const message = success
    ? "连接器授权已完成，正在返回应用。"
    : "连接器授权未完成。请关闭此页面并返回应用重试。";
  const script = success ? `<script nonce="${nonce}">window.close();setTimeout(function(){window.location.replace('/')},250);</script>` : '';
  const body = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title></head><body><main><h1>${title}</h1><p>${message}</p><a href="/">返回应用</a></main>${script}</body></html>`;
  context.response.writeHead(success ? 200 : 400, {
    "Content-Type": "text/html; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    "Cache-Control": "no-store",
    "Content-Security-Policy": `default-src 'none'; ${success ? `script-src 'nonce-${nonce}'; ` : ''}base-uri 'none'; form-action 'none'; frame-ancestors 'none'`,
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
  });
  context.response.end(body);
}

export async function handleMcpOAuthRoutes(context: RequestContext): Promise<boolean> {
  const method = context.request.method ?? "GET";
  const path = context.url.pathname;
  if (path !== OAUTH_PATH && path !== CALLBACK_PATH) return false;

  const service = createMcpOAuthService({
    database: context.database,
    config: context.config,
    ownerId: context.user.id,
    sessionId: context.user.sessionId,
  });

  if (path === CALLBACK_PATH) {
    if (method !== "GET") return false;
    try {
      const state = context.url.searchParams.get("state");
      if (!state) throw new Error("missing state");
      await service.callback({
        state,
        code: context.url.searchParams.get("code") ?? undefined,
        error: context.url.searchParams.get("error") ?? undefined,
      });
      sendCallbackHtml(context, true);
    } catch {
      sendCallbackHtml(context, false);
    }
    return true;
  }

  if (method === "GET") {
    const name = context.url.searchParams.get("id") ?? context.url.searchParams.get("name");
    if (!name) context.fail(400, "INVALID_REQUEST", "连接器标识不能为空");
    context.json(200, await service.status(identifier(name)));
    return true;
  }

  if (method === "POST") {
    const body = await context.readJson<Record<string, unknown>>(32 * 1024);
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      context.fail(400, "INVALID_REQUEST", "请求正文无效");
    }
    if (Object.keys(body).some((key) => !["id", "name", "action"].includes(key))) {
      context.fail(400, "INVALID_REQUEST", "请求包含不支持的字段");
    }
    const target = identifier(body.id ?? body.name);
    if (body.action === "login") {
      context.json(200, await service.begin(target));
      return true;
    }
    if (body.action === "cancel") {
      context.json(200, await service.cancel(target));
      return true;
    }
    if (body.action === "logout") {
      context.json(200, await service.logout(target));
      return true;
    }
    context.fail(400, "INVALID_REQUEST", "OAuth 操作无效");
  }

  return false;
}
