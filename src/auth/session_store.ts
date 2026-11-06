import { type DatabaseSync } from "node:sqlite";
import { getDb } from "../infra/db.ts";

export interface AuthSessionRecord {
  id: string;
  userId: string;
  nick: string;
  avatar: string;
  profile: Record<string, string>;
  accessToken: string;
  refreshToken: string;
  loggedInAt: number;
  expiresAt: number;
}

export interface AuthSessionInput {
  userId: string;
  nick: string;
  avatar?: string;
  profile?: Record<string, string>;
  accessToken?: string;
  refreshToken?: string;
  ttlMs?: number;
  now?: number;
}

export interface AuthSessionStore {
  getActive(now?: number): AuthSessionRecord | null;
  save(input: AuthSessionInput): AuthSessionRecord;
  clear(): void;
}

const DEFAULT_TTL_MS = 30 * 24 * 60 * 60 * 1000;
let defaultAuthSessionStore: AuthSessionStore | null = null;

function toSession(row: Record<string, unknown>): AuthSessionRecord {
  const profileJson = String(row.profileJson ?? row.profile_json ?? "{}");
  let profile: Record<string, string> = {};
  try {
    const parsed = JSON.parse(profileJson);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      profile = Object.fromEntries(
        Object.entries(parsed).map(([key, value]) => [key, String(value)]),
      );
    }
  } catch {}
  return {
    id: String(row.id ?? ""),
    userId: String(row.userId ?? ""),
    nick: String(row.nick ?? ""),
    avatar: String(row.avatar ?? ""),
    profile,
    accessToken: String(row.accessToken ?? ""),
    refreshToken: String(row.refreshToken ?? ""),
    loggedInAt: Number(row.loggedInAt ?? 0),
    expiresAt: Number(row.expiresAt ?? 0),
  };
}

export function createAuthSessionStore(
  db: DatabaseSync = getDb(),
): AuthSessionStore {
  const clearExpired = (now: number) => {
    db.prepare("DELETE FROM auth_sessions WHERE expires_at <= ?").run(now);
  };

  return {
    getActive(now = Date.now()) {
      clearExpired(now);
      const row = db.prepare(
        "SELECT id, user_id as userId, nick, avatar, profile_json as profileJson, access_token as accessToken, refresh_token as refreshToken, logged_in_at as loggedInAt, expires_at as expiresAt FROM auth_sessions ORDER BY logged_in_at DESC LIMIT 1",
      ).get() as Record<string, unknown> | undefined;
      if (!row) return null;
      const session = toSession(row);
      if (!session.id || !session.userId || !session.accessToken) {
        return null;
      }
      if (session.expiresAt <= now) {
        clearExpired(now);
        return null;
      }
      return session;
    },
    save(input) {
      const now = input.now ?? Date.now();
      const ttlMs = input.ttlMs ?? DEFAULT_TTL_MS;
      const session: AuthSessionRecord = {
        id: crypto.randomUUID(),
        userId: input.userId.trim(),
        nick: input.nick.trim() || input.userId.trim(),
        avatar: input.avatar?.trim() ?? "",
        profile: input.profile ?? {},
        accessToken: input.accessToken?.trim() || crypto.randomUUID(),
        refreshToken: input.refreshToken?.trim() || "",
        loggedInAt: now,
        expiresAt: now + ttlMs,
      };
      db.prepare("DELETE FROM auth_sessions").run();
      db.prepare(
        "INSERT INTO auth_sessions (id, user_id, nick, avatar, profile_json, access_token, refresh_token, logged_in_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
      ).run(
        session.id,
        session.userId,
        session.nick,
        session.avatar,
        JSON.stringify(session.profile ?? {}),
        session.accessToken,
        session.refreshToken,
        session.loggedInAt,
        session.expiresAt,
      );
      return session;
    },
    clear() {
      db.prepare("DELETE FROM auth_sessions").run();
    },
  };
}

/**
 * Resolve the database for every operation. The updater closes and replaces
 * the process-wide SQLite connection while preparing an install, so a
 * long-lived auth store must not retain the old DatabaseSync handle.
 */
export function createResolvingAuthSessionStore(
  resolveDb: () => DatabaseSync,
): AuthSessionStore {
  return {
    getActive(now) {
      return createAuthSessionStore(resolveDb()).getActive(now);
    },
    save(input) {
      return createAuthSessionStore(resolveDb()).save(input);
    },
    clear() {
      createAuthSessionStore(resolveDb()).clear();
    },
  };
}

export function getAuthSessionStore(): AuthSessionStore {
  if (!defaultAuthSessionStore) {
    defaultAuthSessionStore = createResolvingAuthSessionStore(getDb);
  }
  return defaultAuthSessionStore;
}

export function getActiveAuthSession(
  now = Date.now(),
): AuthSessionRecord | null {
  const db = getDb();
  const saved = db.prepare("SELECT value FROM settings WHERE key='desktop_local_account'").get() as { value: string } | undefined;
  if (!saved) {
    const previous = db.prepare("SELECT user_id AS userId FROM auth_sessions ORDER BY logged_in_at DESC LIMIT 1").get() as { userId?: string } | undefined;
    db.prepare("INSERT INTO settings(key,value) VALUES('desktop_local_account',?) ON CONFLICT(key) DO NOTHING").run(previous?.userId || 'desktop-local');
  }
  const account = db.prepare("SELECT value FROM settings WHERE key='desktop_local_account'").get() as { value: string };
  return {
    id: 'desktop-local', userId: account.value, nick: '本地用户', avatar: '',
    profile: { mode: 'local' }, accessToken: '', refreshToken: '',
    loggedInAt: 0, expiresAt: Number.MAX_SAFE_INTEGER,
  };
}

export function saveAuthSession(input: AuthSessionInput): AuthSessionRecord {
  return getAuthSessionStore().save(input);
}

export function clearAuthSession(): void {
  getAuthSessionStore().clear();
}
