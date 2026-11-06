import { createHash, randomBytes } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";

import type { Config } from "../../config.ts";
import type { Database } from "../../infra/db.ts";

const SESSION_DAYS = 30;
export const SESSION_COOKIE = "picoddy_session";

export interface AuthUser {
  id: string;
  email: string | null;
  subject: string;
  avatar: string;
  sessionId: string;
  loggedInAt: string;
  expiresAt: string;
  name: string;
  role: "user" | "admin";
}

export function createSessionToken(): string {
  return randomBytes(32).toString("base64url");
}

/** Delete expired encrypted credentials; never infer liveness from last_seen_at. */
export async function cleanupExpiredAuth(database: Database): Promise<void> {
  await database.transaction(async db => {
    await db.query('DELETE FROM sessions WHERE expires_at <= now()');
    await db.query('DELETE FROM auth_challenges WHERE expires_at <= now()');
  });
}

export function hashSessionToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export function sessionExpiry(now = new Date()): Date {
  return new Date(now.getTime() + SESSION_DAYS * 24 * 60 * 60 * 1000);
}

export function sessionCookie(token: string, config: Config, expires: Date): string {
  const parts = [
    `${SESSION_COOKIE}=${encodeURIComponent(token)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Expires=${expires.toUTCString()}`,
  ];
  if (config.secureCookies) parts.push("Secure");
  return parts.join("; ");
}

export function expiredSessionCookie(config: Config): string {
  const parts = [
    `${SESSION_COOKIE}=`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    "Expires=Thu, 01 Jan 1970 00:00:00 GMT",
    "Max-Age=0",
  ];
  if (config.secureCookies) parts.push("Secure");
  return parts.join("; ");
}

export function parseCookies(header: string | undefined): Map<string, string> {
  const cookies = new Map<string, string>();
  if (!header) return cookies;
  for (const item of header.split(";")) {
    const separator = item.indexOf("=");
    if (separator < 1) continue;
    const name = item.slice(0, separator).trim();
    const value = item.slice(separator + 1).trim();
    try {
      cookies.set(name, decodeURIComponent(value));
    } catch {
      // Ignore malformed cookies instead of failing the whole request.
    }
  }
  return cookies;
}

export function requestSessionToken(request: IncomingMessage): string | undefined {
  return parseCookies(request.headers.cookie).get(SESSION_COOKIE);
}

export async function authenticate(
  request: IncomingMessage,
  database: Database,
): Promise<AuthUser | null> {
  const token = requestSessionToken(request);
  if (!token) return null;
  const result = await database.query<AuthUser>(
    `SELECT u.id, u.email, u.name, u.role, u.subject, u.avatar,
            s.id AS "sessionId", s.created_at AS "loggedInAt", s.expires_at AS "expiresAt"
       FROM sessions s
       JOIN users u ON u.id = s.owner_id
      WHERE s.token_hash = $1
        AND s.expires_at > now()
        AND u.disabled_at IS NULL`,
    [hashSessionToken(token)],
  );
  return result.rows[0] ?? null;
}

export function assertRequestOrigin(request: IncomingMessage, config: Config): void {
  if (!request.method || !["POST", "PATCH", "PUT", "DELETE"].includes(request.method)) {
    return;
  }
  const origin = request.headers.origin;
  if (!origin || origin !== config.publicOrigin) {
    const error = new Error("Request origin is not allowed") as Error & {
      status?: number;
      code?: string;
    };
    error.status = 403;
    error.code = "ORIGIN_FORBIDDEN";
    throw error;
  }
}

export function remoteAddress(request: IncomingMessage): string {
  return request.socket.remoteAddress || "unknown";
}

export function setSessionCookie(
  response: ServerResponse,
  token: string,
  config: Config,
  expires: Date,
): void {
  response.setHeader("Set-Cookie", sessionCookie(token, config, expires));
}
