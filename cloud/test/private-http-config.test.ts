import assert from 'node:assert/strict';
import test from 'node:test';
import { loadConfig } from '../src/config.ts';
const base = { DATABASE_URL: 'postgres://user:password@postgres/db', ENCRYPTION_KEY: 'a'.repeat(64), SANDBOX_DOMAIN: 'http://opensandbox-server:8090', SANDBOX_API_KEY: 'test', PUBLIC_ORIGIN: 'http://172.18.36.79' };
test('private HTTP requires explicit opt-in and usable cookies', () => {
  assert.throws(() => loadConfig(base), /HTTPS/);
  assert.equal(loadConfig({...base, ALLOW_INSECURE_HTTP:'true', SECURE_COOKIES:'false'}).secureCookies, false);
  assert.throws(() => loadConfig({...base, ALLOW_INSECURE_HTTP:'true', SECURE_COOKIES:'true'}), /SECURE_COOKIES/);
  for (const host of ['8.8.8.8', '172.32.0.1', 'example.com']) {
    assert.throws(() => loadConfig({...base, PUBLIC_ORIGIN:`http://${host}`, ALLOW_INSECURE_HTTP:'true'}), /HTTPS/);
  }
  assert.throws(() => loadConfig({...base, PUBLIC_ORIGIN:'https://cloud.example.com', ALLOW_INSECURE_HTTP:'true',SECURE_COOKIES:'false'}), /SECURE_COOKIES/);
});
