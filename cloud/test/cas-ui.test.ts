import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  authLogin,
  authSession,
  consumeCasCallbackError,
  requireEnterpriseLoginUrl,
} from '../web/desktop/src/api/client.ts';

const OWNER_ID = '10000000-0000-4000-8000-000000000001';
const SESSION_ID = '20000000-0000-4000-8000-000000000002';

async function withFetch(
  implementation: typeof fetch,
  work: () => Promise<void>,
): Promise<void> {
  const original = globalThis.fetch;
  globalThis.fetch = implementation;
  try {
    await work();
  } finally {
    globalThis.fetch = original;
  }
}

test('enterprise login posts an empty same-origin request and returns the CAS URL', async () => {
  await withFetch(async (input, init) => {
    assert.equal(input, '/api/auth/login');
    assert.equal(init?.method, 'POST');
    assert.equal(init?.credentials, 'same-origin');
    assert.equal(init?.body, '{}');
    return new Response(JSON.stringify({
      data: {
        ok: true,
        authenticated: false,
        loginUrl: 'https://login.example.test/cas?service=cloud',
      },
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  }, async () => {
    const result = await authLogin();
    assert.equal(result.authenticated, false);
    assert.equal(result.loginUrl, 'https://login.example.test/cas?service=cloud');
  });
});

test('cloud session keeps the owner UUID for isolation and exposes enterprise subject', async () => {
  await withFetch(async () => new Response(JSON.stringify({ data: {
    id: OWNER_ID,
    email: null,
    name: '云端用户展示名',
    subject: 'enterprise.subject',
    avatar: 'https://cdn.example.test/avatar.png',
    sessionId: SESSION_ID,
    loggedInAt: '2026-10-12T08:00:00.000Z',
    expiresAt: '2026-10-12T18:00:00.000Z',
  } }), { status: 200, headers: { 'content-type': 'application/json' } }), async () => {
    const result = await authSession();
    assert.equal(result.authenticated, true);
    assert.equal(result.session?.userId, OWNER_ID);
    assert.equal(result.session?.id, SESSION_ID);
    assert.equal(result.session?.nick, '云端用户展示名');
    assert.equal(result.session?.avatar, 'https://cdn.example.test/avatar.png');
    assert.equal(result.session?.profile.username, 'enterprise.subject');
    assert.equal(result.session?.profile.subject, 'enterprise.subject');
    assert.equal('email' in (result.session?.profile ?? {}), false);
    assert.equal(result.session?.loggedInAt, Date.parse('2026-10-12T08:00:00.000Z'));
    assert.equal(result.session?.expiresAt, Date.parse('2026-10-12T18:00:00.000Z'));
  });
});

test('CAS callback errors use safe Chinese messages and clear the query for retry', () => {
  for (const [code, expected] of [
    ['CAS_LOGIN_FAILED', '企业登录失败，请重试。'],
    ['CAS_LOGIN_EXPIRED', '登录请求已过期，请重新发起企业认证。'],
    ['UNKNOWN_SECRET_CODE', '企业登录未完成，请重试。'],
  ] as const) {
    let replacement = '';
    const message = consumeCasCallbackError(
      `https://cloud.example.test/?auth_error=${code}&ticket=must-not-survive#login`,
      value => { replacement = value; },
    );
    assert.equal(message, expected);
    assert.equal(replacement, '/#login');
    assert.doesNotMatch(message ?? '', /UNKNOWN_SECRET_CODE|ticket/i);
  }
  let called = false;
  assert.equal(consumeCasCallbackError('https://cloud.example.test/', () => { called = true; }), null);
  assert.equal(called, false);
});

test('enterprise redirect accepts only an absolute HTTPS login URL', () => {
  assert.equal(
    requireEnterpriseLoginUrl('https://login.example.test/cas?service=cloud'),
    'https://login.example.test/cas?service=cloud',
  );
  for (const unsafe of ['', '/cas', 'http://login.example.test/cas', 'javascript:alert(1)']) {
    assert.throws(() => requireEnterpriseLoginUrl(unsafe), /企业登录地址无效/);
  }
});

test('cloud auth screen is enterprise-only and App redirects the current tab', () => {
  const screen = readFileSync(new URL('../web/desktop/src/components/AuthScreen.tsx', import.meta.url), 'utf8');
  const app = readFileSync(new URL('../web/desktop/src/App.tsx', import.meta.url), 'utf8');

  assert.match(screen, /使用企业账号登录/);
  assert.doesNotMatch(screen, /type="email"|type="password"|邮箱\s*<|密码\s*</);
  assert.match(screen, /onLogin:\s*\(\)\s*=>\s*Promise<void>/);
  assert.match(screen, /catch\s*\{[\s\S]*setClicked\(false\)/);
  assert.match(app, /consumeCasCallbackError/);
  assert.match(app, /window\.location\.assign\(loginUrl\)/);
  assert.doesNotMatch(app, /JSON\.stringify\(\{\s*email,\s*password\s*\}\)/);
});
