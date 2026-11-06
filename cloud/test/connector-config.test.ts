import assert from 'node:assert/strict';
import test from 'node:test';
import type { Database } from '../src/infra/db.ts';
import { seal, unseal } from '../src/infra/crypto.ts';
import { createConnectorResourceService } from '../src/domains/connector/node/service.ts';

const key = '0123456789abcdef0123456789abcdef';
function fixture() {
  let row = { id: '22222222-2222-4222-8222-222222222222', name: 'test',
    data: { transport: 'http', url: 'https://example.test/mcp', revision: 'before',
      connection: { state: 'connected', tools: ['one'] }, oauth: { clientId: 'client' } } as Record<string, unknown>,
    secret: seal({ env: { KEY: 'env-secret' }, headers: {}, oauthClientSecret: 'client-secret', oauthState: { tokens: { access_token: 'token-secret' } } }, key),
    created_at: new Date(), updated_at: new Date() };
  const query = async (sql: string, values?: readonly unknown[]) => {
    if (sql.startsWith('UPDATE resources SET name=')) row = { ...row, name: values![3] as string,
      data: JSON.parse(values![4] as string), secret: values![5] as string };
    return { rows: [row], rowCount: 1 };
  };
  const database = { query, transaction: (fn: any) => fn({ query }) } as Database;
  const service = createConnectorResourceService({ database, ownerId: 'owner', config: { encryptionKey: key } });
  return { service, current: () => row };
}

test('connector metadata updates keep OAuth credentials encrypted and preserve authorization', async () => {
  const f = fixture();
  const view = await f.service.update(f.current().id, { displayName: '显示名称', enabled: false, exposure: 'hidden' });
  assert.equal(view.displayName, '显示名称');
  assert.equal(view.enabled, false);
  assert.equal(view.exposure, 'hidden');
  assert.notEqual(f.current().data.revision, 'before');
  assert.equal(f.current().data.connection, undefined);
  assert.equal((unseal(f.current().secret, key) as any).oauthState.tokens.access_token, 'token-secret');
  assert.doesNotMatch(JSON.stringify(view), /env-secret|client-secret|token-secret/);
});

test('connector endpoint or credentials change invalidates old OAuth state', async () => {
  const f = fixture();
  await f.service.update(f.current().id, { url: 'https://other.test/mcp' });
  const secret = unseal(f.current().secret, key) as any;
  assert.equal(secret.oauthState, undefined);
  assert.equal(secret.oauthClientSecret, 'client-secret');
});

test('connector rejects forged status and secret-shaped OAuth fields', async () => {
  const f = fixture();
  await assert.rejects(f.service.update(f.current().id, { connection: { state: 'connected' } }));
  await assert.rejects(f.service.update(f.current().id, { oauth: { access_token: 'forged' } }));
});

test('connector supports SSE and hides submitted OAuth client secret', async () => {
  const f = fixture();
  const view = await f.service.update(f.current().id, { transport: 'sse', oauth: { clientId: 'registered', clientSecret: 'new-secret', scope: 'tools:read' } });
  assert.equal(view.transport, 'sse');
  assert.deepEqual(view.oauth, { clientId: 'registered', scope: 'tools:read' });
  assert.equal((unseal(f.current().secret, key) as any).oauthClientSecret, 'new-secret');
  assert.doesNotMatch(JSON.stringify(view), /new-secret/);
});
