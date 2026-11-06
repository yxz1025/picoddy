import type { PoolClient, QueryResultRow } from 'pg';

import type { Config } from '../../../config.ts';
import type { Database } from '../../../infra/db.ts';
import { seal, unseal } from '../../../infra/crypto.ts';
import { loadSkillHubSecret } from '../../../platform/skillhub-secret.ts';
import type { AuthUser } from '../../../cloud/auth/service.ts';
import {
  createSkillHubAuthClient,
  SkillHubAuthError,
  type SkillHubCredential,
  type SkillHubCredentialStore,
} from './auth.ts';
import {
  getSkillHubExpertDetail,
  listSkillHubExperts,
  listSkillHubNamespaces,
  listSkillHubSkills,
  type FetchLike,
} from './client.ts';

interface Queryable {
  query<T extends QueryResultRow = QueryResultRow>(sql: string, values?: readonly unknown[]): Promise<{ rows: T[]; rowCount: number | null }>;
}

const pendingByDatabase = new WeakMap<Database, Map<string, Promise<SkillHubCredential>>>();

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function sessionError(): SkillHubAuthError {
  return new SkillHubAuthError('当前登录会话已失效，请重新登录', 401);
}

function decodeRoot(ciphertext: unknown, config: Config): Record<string, unknown> {
  if (ciphertext == null || ciphertext === '') return {};
  if (typeof ciphertext !== 'string') throw new SkillHubAuthError('无法读取技能市场登录凭据', 503);
  let value: unknown;
  try { value = unseal(ciphertext, config.encryptionKey); }
  catch { throw new SkillHubAuthError('无法读取技能市场登录凭据', 503); }
  if (!isRecord(value)) throw new SkillHubAuthError('无法读取技能市场登录凭据', 503);
  return value;
}

function decodeCredential(value: unknown): SkillHubCredential | null {
  if (value === undefined || value === null) return null;
  if (!isRecord(value) || typeof value.identity !== 'string' || value.identity.length > 4096 ||
      typeof value.token !== 'string' || !/^sk_[A-Za-z0-9_-]+$/.test(value.token) ||
      !(value.tokenExpiresAt === null || (typeof value.tokenExpiresAt === 'number' && Number.isFinite(value.tokenExpiresAt))) ||
      !isRecord(value.cookies) || typeof value.cookies.SESSION !== 'string' || typeof value.cookies['XSRF-TOKEN'] !== 'string' ||
      value.cookies.SESSION.length > 8192 || value.cookies['XSRF-TOKEN'].length > 8192) {
    throw new SkillHubAuthError('无法读取技能市场登录凭据', 503);
  }
  return {
    identity: value.identity,
    token: value.token,
    tokenExpiresAt: value.tokenExpiresAt as number | null,
    cookies: { SESSION: value.cookies.SESSION, 'XSRF-TOKEN': value.cookies['XSRF-TOKEN'] },
  };
}

async function guardedSecret(database: Queryable, user: AuthUser, lock = false): Promise<string | null> {
  const result = await database.query<{ gateway_secret: string | null }>(
    `SELECT s.gateway_secret FROM sessions s JOIN users u ON u.id=s.owner_id
      WHERE s.id=$1 AND s.owner_id=$2 AND s.expires_at>now() AND u.disabled_at IS NULL${lock ? ' FOR UPDATE OF s' : ''}`,
    [user.sessionId, user.id],
  );
  if (!result.rows[0]) throw sessionError();
  return result.rows[0].gateway_secret;
}

function createSessionCredentialStore(database: Database, user: AuthUser, config: Config): SkillHubCredentialStore {
  return {
    async read() {
      const root = decodeRoot(await guardedSecret(database, user), config);
      return decodeCredential(root.skillhub);
    },
    async write(credential) {
      await database.transaction(async (client: PoolClient) => {
        const root = decodeRoot(await guardedSecret(client, user, true), config);
        const ciphertext = seal({ ...root, skillhub: credential }, config.encryptionKey);
        const result = await client.query(
          `UPDATE sessions SET gateway_secret=$3 WHERE id=$1 AND owner_id=$2 AND expires_at>now()
            AND EXISTS(SELECT 1 FROM users WHERE id=$2 AND disabled_at IS NULL) RETURNING id`,
          [user.sessionId, user.id, ciphertext],
        );
        if (!result.rows[0]) throw sessionError();
      });
    },
    async clear() {
      await database.transaction(async (client: PoolClient) => {
        const root = decodeRoot(await guardedSecret(client, user, true), config);
        delete root.skillhub;
        const result = await client.query(
          `UPDATE sessions SET gateway_secret=$3 WHERE id=$1 AND owner_id=$2 AND expires_at>now()
            AND EXISTS(SELECT 1 FROM users WHERE id=$2 AND disabled_at IS NULL) RETURNING id`,
          [user.sessionId, user.id, seal(root, config.encryptionKey)],
        );
        if (!result.rows[0]) throw sessionError();
      });
    },
  };
}

function pathPart(value: string, label: string): string {
  const result = value.trim();
  if (!result || result.length > 200 || /[\/\\\u0000-\u001f\u007f]/.test(result)) {
    throw new SkillHubAuthError(`${label} 无效`, 400);
  }
  return result;
}

export function createSkillHubService(input: {
  config: Config;
  database: Database;
  user: AuthUser;
  fetch?: typeof fetch;
}) {
  const store = createSessionCredentialStore(input.database, input.user, input.config);
  const auth = createSkillHubAuthClient({
    baseUrl: input.config.skillHubBaseUrl,
    getIdentity: () => ({ email: input.user.email ?? '', nickName: input.user.name, headimgurl: input.user.avatar }),
    getSecret: () => loadSkillHubSecret(input.config),
    tokenName: `cloud-session-${input.user.sessionId}`,
    store,
    fetch: input.fetch,
  });
  const fetchImpl = input.fetch as FetchLike | undefined;

  async function credential(checkSession = true): Promise<SkillHubCredential> {
    let pending = pendingByDatabase.get(input.database);
    if (!pending) {
      pending = new Map();
      pendingByDatabase.set(input.database, pending);
    }
    const pendingKey = `${input.user.id}:${input.user.sessionId}`;
    const existing = pending.get(pendingKey);
    if (existing) return existing;
    const operation = auth.ensure(checkSession);
    pending.set(pendingKey, operation);
    try { return await operation; }
    finally { if (pending.get(pendingKey) === operation) pending.delete(pendingKey); }
  }

  const options = (value: SkillHubCredential) => ({
    baseUrl: input.config.skillHubBaseUrl,
    fetchImpl,
    cookies: { ...value.cookies },
    token: value.token,
  });

  async function withSession<T>(operation: (current: SkillHubCredential) => Promise<T>): Promise<T> {
    const current = await credential(true);
    try { return await operation(current); }
    catch (error) {
      if (!isRecord(error) || error.status !== 401) throw error;
      const refreshed = await credential(true);
      if (refreshed.cookies.SESSION === current.cookies.SESSION) throw error;
      return operation(refreshed);
    }
  }

  async function withTokenCredential<T>(operation: (current: SkillHubCredential) => Promise<T>): Promise<T> {
    const current = await credential(true);
    try { return await operation(current); }
    catch (error) {
      if (!isRecord(error) || error.status !== 401) throw error;
      const refreshed = await credential(true);
      if (refreshed.token === current.token) throw error;
      return operation(refreshed);
    }
  }

  return {
    async ensure() { await credential(true); return { ok: true as const }; },
    skills: () => withSession(current => listSkillHubSkills(options(current))),
    experts: () => withSession(current => listSkillHubExperts(options(current))),
    namespaces: () => withTokenCredential(current => listSkillHubNamespaces(options(current))),
    expertDetail: (namespace: string, slug: string) => withSession(current => getSkillHubExpertDetail(
      pathPart(namespace, 'namespace'), pathPart(slug, 'slug'), options(current),
    )),
    withToken: <T>(operation: (token: string) => Promise<T>) => withTokenCredential(current => operation(current.token)),
  };
}
