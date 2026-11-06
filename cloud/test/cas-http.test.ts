import assert from 'node:assert/strict';
import test from 'node:test';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { createServer } from '../src/server.ts';
import { loadConfig } from '../src/config.ts';
import type { Database } from '../src/infra/db.ts';

const config = loadConfig({ CAS_LOGIN_URL: 'https://sso.example.test/cas/login', CAS_EXCHANGE_URL: 'https://auth.example.test/cas/validate', DATABASE_URL: 'postgres://unused/unused_test', PUBLIC_ORIGIN: 'http://localhost:8080', ENCRYPTION_KEY: 'a'.repeat(64), SANDBOX_DOMAIN: 'http://localhost:8090', SANDBOX_API_KEY: 'test' });
test('login issues browser-bound CAS challenge instead of accepting email/password', async () => {
  const calls: string[] = [];
  const database = { query: async (sql: string) => { calls.push(sql); return {rows: [], rowCount: 0}; }, transaction: async (fn: any) => fn(database) } as unknown as Database;
  const server = createServer(config, {database});
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  try {
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const r = await fetch(base+'/api/auth/login', {method:'POST', headers:{Origin:config.publicOrigin,'Content-Type':'application/json'}, body:'{}'});
    assert.equal(r.status, 200);
    const body = await r.json() as any;
    assert.equal(body.data.authenticated, false);
    const login = new URL(body.data.loginUrl);
    assert.equal(login.origin, 'https://sso.example.test');
    const service = new URL(login.searchParams.get('service')!);
    assert.equal(service.origin, config.publicOrigin);
    assert.equal(service.pathname, '/api/auth/callback');
    assert.ok(service.searchParams.get('state'));
    assert.match(r.headers.get('set-cookie')!, /HttpOnly/);
    assert.match(r.headers.get('set-cookie')!, /SameSite=Lax/);
    assert.ok(calls.some(sql => /INSERT INTO auth_challenges/.test(sql)));
    const rejected = await fetch(base+'/api/auth/login',{method:'POST',headers:{Origin:'https://evil.test','Content-Type':'application/json'},body:'{}'});
    assert.equal(rejected.status,403);
    const callback = await fetch(base+'/api/auth/callback?ticket=secret&state=invalid',{redirect:'manual'});
    assert.equal(callback.status,303);
    assert.equal(callback.headers.get('location'),'/?auth_error=CAS_LOGIN_EXPIRED');
    assert.equal(callback.headers.get('referrer-policy'),'no-referrer');
  } finally { server.close(); await once(server,'close'); }
});
