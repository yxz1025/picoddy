import assert from 'node:assert/strict';
import test from 'node:test';
import { loadConfig } from '../src/config.ts';

const env = { DATABASE_URL: 'postgres://test:test@localhost/test', PUBLIC_ORIGIN: 'http://localhost:8080', ENCRYPTION_KEY: 'a'.repeat(64), SANDBOX_DOMAIN: 'http://localhost:8090', SANDBOX_API_KEY: 'test' };
test('CAS endpoints are disabled until explicitly configured', () => {
  const c = loadConfig(env);
  assert.equal(c.casLoginUrl, '');
  assert.equal(c.casExchangeUrl, '');
  const configured = loadConfig({ ...env, CAS_LOGIN_URL: 'https://sso.example.test/cas/login', CAS_EXCHANGE_URL: 'https://auth.example.test/cas/validate' });
  assert.equal(configured.casLoginUrl, 'https://sso.example.test/cas/login');
  assert.equal(configured.casExchangeUrl, 'https://auth.example.test/cas/validate');
});
test('CAS endpoints reject plaintext, embedded credentials, query and fragment', () => {
  for (const endpoint of ['http://example.test/login', 'https://user:pass@example.test/login', 'https://example.test/login?service=evil', 'https://example.test/login#evil']) {
    assert.throws(() => loadConfig({ ...env, CAS_LOGIN_URL: endpoint }), /CAS_LOGIN_URL/);
    assert.throws(() => loadConfig({ ...env, CAS_EXCHANGE_URL: endpoint }), /CAS_EXCHANGE_URL/);
  }
});
test('only local HTTP is allowed and HTTPS cannot disable secure cookies',()=>{
  assert.throws(()=>loadConfig({...env,PUBLIC_ORIGIN:'http://cloud.example.test'}),/HTTPS/);
  assert.throws(()=>loadConfig({...env,PUBLIC_ORIGIN:'https://cloud.example.test',SECURE_COOKIES:'false'}),/SECURE_COOKIES/);
  assert.equal(loadConfig({...env,PUBLIC_ORIGIN:'http://127.0.0.1:8080'}).secureCookies,false);
  assert.equal(loadConfig({...env,PUBLIC_ORIGIN:'https://cloud.example.test'}).secureCookies,true);
});
