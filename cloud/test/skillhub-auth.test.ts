import assert from 'node:assert/strict';
import { createDecipheriv } from 'node:crypto';
import test from 'node:test';

import { createSkillHubAccessToken, createSkillHubAuthClient, SkillHubAuthError } from '../src/domains/skillhub/node/auth.ts';
import { listSkillHubSkills } from '../src/domains/skillhub/node/client.ts';
import { createSkillHubService } from '../src/domains/skillhub/node/service.ts';
import { handleSkillHubRoutes } from '../src/transport/http/skillhub.ts';
import { loadConfig } from '../src/config.ts';
import { seal, unseal } from '../src/infra/crypto.ts';
import type { Database } from '../src/infra/db.ts';

const sharedSecret = Buffer.alloc(32, 7).toString('base64');
const config = loadConfig({
  DATABASE_URL: 'postgres://unused/test', PUBLIC_ORIGIN: 'http://localhost:8080',
  ENCRYPTION_KEY: 'a'.repeat(64), SANDBOX_DOMAIN: 'http://localhost:8090', SANDBOX_API_KEY: 'test',
  SKILLHUB_BASE_URL: 'https://skillhub.example.test', SKILLHUB_AUTH_ACCESS_TOKEN_SECRET: sharedSecret,
});
const user = {
  id: '00000000-0000-4000-8000-000000000010', email: 'cloud.user@example.test', subject: 'employee-10',
  avatar: 'https://example.test/avatar.png', sessionId: '00000000-0000-4000-8000-000000000020',
  loggedInAt: '2026-10-13T00:00:00Z', expiresAt: '2026-11-13T00:00:00Z', name: 'Cloud User', role: 'user' as const,
};

function fakeSessionDatabase(initial: Record<string, unknown> = { accessToken: 'gateway-token' }) {
  let gatewaySecret = seal(initial, config.encryptionKey);
  let valid = true;
  const query = async (sql: string, values: readonly unknown[] = []) => {
    if (/SELECT s\.gateway_secret/.test(sql)) {
      assert.deepEqual(values.slice(0, 2), [user.sessionId, user.id]);
      return { rows: valid ? [{ gateway_secret: gatewaySecret }] : [], rowCount: valid ? 1 : 0 };
    }
    if (/UPDATE sessions SET gateway_secret/.test(sql)) {
      assert.deepEqual(values.slice(0, 2), [user.sessionId, user.id]);
      if (valid) gatewaySecret = String(values[2]);
      return { rows: valid ? [{ id: user.sessionId }] : [], rowCount: valid ? 1 : 0 };
    }
    throw new Error(`Unexpected SQL: ${sql}`);
  };
  const database = {
    query,
    transaction: async <T>(work: (client: any) => Promise<T>) => work({ query }),
  } as unknown as Database;
  return { database, invalidate: () => { valid = false; }, secret: () => gatewaySecret };
}

function jsonResponse(value: unknown, cookies: string[] = []) {
  const headers = new Headers({ 'content-type': 'application/json' });
  for (const cookie of cookies) headers.append('set-cookie', cookie);
  return new Response(JSON.stringify(value), { status: 200, headers });
}

function decryptAccessToken(token: string) {
  const [version, encodedIv, encodedBody, encodedTag] = token.split('.');
  assert.equal(version, 'v1');
  const decipher = createDecipheriv('aes-256-gcm', Buffer.from(sharedSecret, 'base64'), Buffer.from(encodedIv, 'base64url'));
  decipher.setAAD(Buffer.from('skillhub-access-token:v1', 'utf8'));
  decipher.setAuthTag(Buffer.from(encodedTag, 'base64url'));
  return JSON.parse(Buffer.concat([
    decipher.update(Buffer.from(encodedBody, 'base64url')),
    decipher.final(),
  ]).toString('utf8')) as Record<string, unknown>;
}

test('managed access token contains only the normalized authenticated identity and expires in five minutes', () => {
  const payload = decryptAccessToken(createSkillHubAccessToken({
    email: ' User@Example.Test ',
    nickName: 'Cloud User',
    headimgurl: 'https://example.test/avatar.png',
  }, sharedSecret, 1_700_000_000_000));
  assert.equal(payload.appId, 'skillhub');
  assert.equal(payload.email, 'user@example.test');
  assert.equal(payload.nickName, 'Cloud User');
  assert.equal(payload.headimgurl, 'https://example.test/avatar.png');
  assert.equal(payload.exp, Number(payload.iat) + 300);
  assert.equal(typeof payload.jti, 'string');
});

test('catalog client sends only managed session cookies and returns the desktop catalog shape', async () => {
  const skills = await listSkillHubSkills({
    baseUrl: 'https://skillhub.example.test',
    cookies: { SESSION: 'session-cookie', 'XSRF-TOKEN': 'csrf-cookie', ignored: 'secret' },
    fetchImpl: async (input, init) => {
      assert.match(String(input), /\/api\/web\/skills\?type=SKILL/);
      assert.equal(init?.redirect, 'error');
      assert.equal((init?.headers as Record<string, string>).Cookie, 'SESSION=session-cookie; XSRF-TOKEN=csrf-cookie');
      return Response.json({ code: 0, data: { total: 1, items: [{
        id: 7, slug: 'writer', namespace: 'team', displayName: 'Writer', summary: 'Writes',
        status: 'PUBLISHED', downloadCount: 2, updatedAt: '2026-10-13T00:00:00Z',
        publishedVersion: { id: 9, version: '1.0.0', status: 'PUBLISHED' },
      }] } });
    },
  });
  assert.deepEqual(skills, [{
    id: 7, slug: 'writer', namespace: 'team', displayName: 'Writer', summary: 'Writes',
    status: 'PUBLISHED', downloadCount: 2, updatedAt: '2026-10-13T00:00:00Z',
    headlineVersion: null, publishedVersion: { id: 9, version: '1.0.0', status: 'PUBLISHED' },
  }]);
});

test('auth and catalog reject oversized response bodies without exposing upstream content', async () => {
  const auth = createSkillHubAuthClient({
    baseUrl: config.skillHubBaseUrl, getIdentity: () => ({ email: user.email! }), getSecret: () => sharedSecret,
    tokenName: `cloud-session-${user.sessionId}`,
    store: { read: async () => null, write: async () => {}, clear: async () => {} },
    fetch: async () => new Response(`upstream-secret-${'x'.repeat(1024 * 1024)}`),
  });
  await assert.rejects(auth.ensure(), (error: any) => error instanceof SkillHubAuthError && !error.message.includes('upstream-secret'));
  await assert.rejects(listSkillHubSkills({
    baseUrl: config.skillHubBaseUrl,
    cookies: { SESSION: 's', 'XSRF-TOKEN': 'x' },
    fetchImpl: async () => new Response(`upstream-secret-${'x'.repeat(2 * 1024 * 1024)}`),
  }), (error: any) => error instanceof Error && !error.message.includes('upstream-secret'));
});

test('service authenticates the current session identity and merges credentials without replacing CAS data', async () => {
  const state = fakeSessionDatabase();
  const paths: string[] = [];
  const service = createSkillHubService({ config, database: state.database, user, fetch: async (input, init) => {
    const url = new URL(String(input));
    paths.push(url.pathname);
    if (url.pathname === '/api/v1/auth/access-token/login') {
      const payload = decryptAccessToken(JSON.parse(String(init?.body)).accessToken);
      assert.equal(payload.email, user.email);
      assert.equal(payload.nickName, user.name);
      assert.equal(payload.headimgurl, user.avatar);
      return jsonResponse({ code: 0, data: { email: user.email } }, [
        'SESSION=session-value; Path=/; HttpOnly',
        'XSRF-TOKEN=csrf-value; Path=/',
      ]);
    }
    if (url.pathname === '/api/v1/tokens') {
      const body = JSON.parse(String(init?.body));
      assert.equal(body.name, `cloud-session-${user.sessionId}`);
      assert.deepEqual(body.scopes, ['skill:read']);
      assert.match(String((init?.headers as Record<string, string>)?.Cookie), /SESSION=session-value/);
      assert.equal((init?.headers as Record<string, string>)['X-XSRF-TOKEN'], 'csrf-value');
      return jsonResponse({ code: 0, data: { token: 'sk_user_read_token', expiresAt: null } });
    }
    throw new Error(`Unexpected fetch: ${url.pathname}`);
  }});
  const ensured=await service.ensure();
  assert.deepEqual(ensured, { ok: true });
  assert.deepEqual(paths, ['/api/v1/auth/access-token/login', '/api/v1/tokens']);
  const stored = unseal(state.secret(), config.encryptionKey) as Record<string, any>;
  assert.equal(stored.accessToken, 'gateway-token');
  assert.equal(stored.skillhub.token, 'sk_user_read_token');
  assert.equal(JSON.stringify(ensured).includes('sk_user_read_token'), false);
});

test('concurrent services for the same cloud session share one login and token creation', async () => {
  const state = fakeSessionDatabase();
  let logins = 0, tokens = 0;
  const fetcher = async (input: string | URL | Request) => {
    const path = new URL(String(input)).pathname;
    if (path === '/api/v1/auth/access-token/login') {
      logins++;
      await new Promise<void>(resolve => setImmediate(resolve));
      return jsonResponse({ code: 0, data: { email: user.email } }, ['SESSION=s; Path=/', 'XSRF-TOKEN=x; Path=/']);
    }
    if (path === '/api/v1/tokens') {
      tokens++;
      return jsonResponse({ code: 0, data: { token: 'sk_concurrent_token', expiresAt: null } });
    }
    throw new Error(`Unexpected fetch: ${path}`);
  };
  const first = createSkillHubService({ config, database: state.database, user, fetch: fetcher });
  const second = createSkillHubService({ config, database: state.database, user, fetch: fetcher });
  await Promise.all([first.ensure(), second.ensure()]);
  assert.equal(logins, 1);
  assert.equal(tokens, 1);
});

test('in-flight authentication never crosses owners even if a fake database reuses a session id', async () => {
  const other = { ...user, id: '00000000-0000-4000-8000-000000000011', email: 'other@example.test' };
  const secrets = new Map([[user.id, seal({ accessToken: 'first' }, config.encryptionKey)], [other.id, seal({ accessToken: 'second' }, config.encryptionKey)]]);
  const query = async (sql: string, values: readonly unknown[] = []) => {
    const ownerId = String(values[1]);
    if (/SELECT s\.gateway_secret/.test(sql)) return { rows: [{ gateway_secret: secrets.get(ownerId) }], rowCount: 1 };
    if (/UPDATE sessions SET gateway_secret/.test(sql)) {
      secrets.set(ownerId, String(values[2]));
      return { rows: [{ id: user.sessionId }], rowCount: 1 };
    }
    throw new Error(`Unexpected SQL: ${sql}`);
  };
  const database = { query, transaction: async <T>(work: (client: any) => Promise<T>) => work({ query }) } as unknown as Database;
  const identities: string[] = [];
  const fetcher = async (input: string | URL | Request, init?: RequestInit) => {
    const path = new URL(String(input)).pathname;
    if (path.endsWith('/access-token/login')) {
      const email = String(decryptAccessToken(JSON.parse(String(init?.body)).accessToken).email);
      identities.push(email);
      await new Promise<void>(resolve => setImmediate(resolve));
      return jsonResponse({ code: 0, data: { email } }, [`SESSION=${email}; Path=/`, `XSRF-TOKEN=${email}; Path=/`]);
    }
    return jsonResponse({ code: 0, data: { token: `sk_${identities.length}_token`, expiresAt: null } });
  };
  await Promise.all([
    createSkillHubService({ config, database, user, fetch: fetcher }).ensure(),
    createSkillHubService({ config, database, user: other, fetch: fetcher }).ensure(),
  ]);
  assert.deepEqual(identities.sort(), [other.email, user.email].sort());
});

test('expired or disabled cloud sessions fail before SkillHub requests and cannot persist credentials', async () => {
  const invalid = fakeSessionDatabase();
  invalid.invalidate();
  let calls = 0;
  const service = createSkillHubService({ config, database: invalid.database, user, fetch: async () => {
    calls++;
    throw new Error('must not call');
  }});
  await assert.rejects(service.ensure(), (error: any) => error?.status === 401);
  assert.equal(calls, 0);

  const revokedDuringLogin = fakeSessionDatabase();
  const racing = createSkillHubService({ config, database: revokedDuringLogin.database, user, fetch: async input => {
    const path = new URL(String(input)).pathname;
    if (path.endsWith('/access-token/login')) return jsonResponse({ code: 0, data: { email: user.email } }, ['SESSION=s; Path=/', 'XSRF-TOKEN=x; Path=/']);
    revokedDuringLogin.invalidate();
    return jsonResponse({ code: 0, data: { token: 'sk_racing_token', expiresAt: null } });
  }});
  await assert.rejects(racing.ensure(), (error: any) => error?.status === 401);
  assert.equal((unseal(revokedDuringLogin.secret(), config.encryptionKey) as any).skillhub, undefined);
});

test('valid session credentials are reused for every read-only desktop catalog operation', async () => {
  const state = fakeSessionDatabase({ accessToken: 'gateway-token', skillhub: {
    identity: `${config.skillHubBaseUrl}\n${user.email}`, token: 'sk_existing_token', tokenExpiresAt: null,
    cookies: { SESSION: 'existing-session', 'XSRF-TOKEN': 'existing-csrf' },
  }});
  const paths: string[] = [];
  const service = createSkillHubService({ config, database: state.database, user, fetch: async (input, init) => {
    const url = new URL(String(input));
    paths.push(url.pathname);
    if (url.pathname === '/api/v1/auth/me') return jsonResponse({ code: 0, data: { email: user.email } });
    if (url.pathname === '/api/v1/whoami') {
      assert.equal((init?.headers as Record<string, string>).Authorization, 'Bearer sk_existing_token');
      return jsonResponse({ data: { user: { email: user.email } } });
    }
    if (url.pathname === '/api/v1/namespaces') {
      assert.equal((init?.headers as Record<string, string>).Authorization, 'Bearer sk_existing_token');
      return jsonResponse({ code: 0, data: [{ id: 3, slug: 'team', displayName: 'Team' }] });
    }
    if (url.pathname === '/api/web/skills/team/expert') return jsonResponse({ code: 0, data: {
      id: 4, slug: 'expert', namespace: 'team', expert: {},
    } });
    if (url.pathname === '/api/web/skills') return jsonResponse({ code: 0, data: { total: 0, items: [] } });
    throw new Error(`Unexpected fetch: ${url.pathname}`);
  }});
  assert.deepEqual(await service.skills(), []);
  assert.deepEqual(await service.experts(), []);
  assert.deepEqual(await service.namespaces(), [{ id: 3, slug: 'team', displayName: 'Team', status: '', description: null, type: '' }]);
  assert.equal((await service.expertDetail('team', 'expert')).slug, 'expert');
  assert.equal(paths.includes('/api/v1/auth/access-token/login'), false);
  assert.equal(paths.includes('/api/v1/tokens'), false);
});

test('backend installers can use a managed token without exposing it through HTTP DTOs', async () => {
  const state = fakeSessionDatabase({ accessToken: 'gateway-token', skillhub: {
    identity: `${config.skillHubBaseUrl}\n${user.email}`, token: 'sk_installer_token', tokenExpiresAt: null,
    cookies: { SESSION: 'session', 'XSRF-TOKEN': 'csrf' },
  }});
  const service = createSkillHubService({ config, database: state.database, user, fetch: async input => {
    const path = new URL(String(input)).pathname;
    if (path === '/api/v1/auth/me') return jsonResponse({ code: 0, data: { email: user.email } });
    if (path === '/api/v1/whoami') return jsonResponse({ data: { user: { email: user.email } } });
    throw new Error(`Unexpected fetch: ${path}`);
  }});
  assert.equal(await service.withToken(async token => `used:${token}`), 'used:sk_installer_token');
});

test('HTTP adapter exposes server-managed status without accepting a browser secret', async () => {
  let response: { status: number; data: unknown } | undefined;
  const context = {
    request: { method: 'GET' }, url: new URL('http://localhost/api/skillhub/auth/config'),
    config, database: fakeSessionDatabase().database, user,
    json: (status: number, data: unknown) => { response = { status, data }; },
  } as any;
  assert.equal(await handleSkillHubRoutes(context), true);
  assert.deepEqual(response, { status: 200, data: { configured: true, source: 'server', error: null } });
  context.request.method = 'POST';
  response = undefined;
  assert.equal(await handleSkillHubRoutes(context), false);
  assert.equal(response, undefined);
});

test('HTTP ensure returns the desktop-compatible flag and never accepts browser identity', async () => {
  const state = fakeSessionDatabase();
  let response: { status: number; data: unknown } | undefined;
  const context = {
    request: { method: 'POST' }, url: new URL('http://localhost/api/skillhub/auth/ensure'),
    config, database: state.database, user,
    readJson: async () => { throw new Error('adapter must not read browser identity'); },
    json: (status: number, data: unknown) => { response = { status, data }; },
    fail: (status: number, code: string, message: string) => { throw Object.assign(new Error(message), { status, code }); },
  } as any;
  const handled = await handleSkillHubRoutes(context, async (input, init) => {
    const path = new URL(String(input)).pathname;
    if (path.endsWith('/access-token/login')) {
      const payload = decryptAccessToken(JSON.parse(String(init?.body)).accessToken);
      assert.equal(payload.email, user.email);
      return jsonResponse({ code: 0, data: { email: user.email } }, ['SESSION=s; Path=/', 'XSRF-TOKEN=x; Path=/']);
    }
    return jsonResponse({ code: 0, data: { token: 'sk_http_token', expiresAt: null } });
  });
  assert.equal(handled, true);
  assert.deepEqual(response, { status: 200, data: { ok: true, authenticated: true } });
});
