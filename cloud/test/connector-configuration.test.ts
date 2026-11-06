import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import type { Database } from '../src/infra/db.ts';
import type { Config } from '../src/config.ts';
import { seal, unseal } from '../src/infra/crypto.ts';
import { saveConnectorConfiguration } from '../src/domains/connector/node/configuration.ts';

const key = '0123456789abcdef0123456789abcdef';
function fixture() {
  let rows: any[] = [{ id: randomUUID(), name: 'docs', created_at: new Date(), updated_at: new Date(),
    data: { transport: 'http', url: 'https://example.test/mcp', revision: randomUUID(), oauth: { enabled: true, clientId: 'client' } },
    secret: seal({ headers: { Authorization: 'secret-header' }, oauthClientSecret: 'secret-client', oauthState: { tokens: { access_token: 'secret-token' } } }, key) }];
  const query = async (sql: string, values: any[] = []) => {
    if (sql.startsWith('SELECT id FROM users')) return { rows: [], rowCount: 0 };
    if (sql.startsWith('SELECT data')) return { rows: rows.filter(row => row.id === values[0]), rowCount: 1 };
    if (sql.startsWith('UPDATE resources SET name=')) {
      const row = rows.find(row => row.id === values[0]);
      Object.assign(row, { name: values[3], data: JSON.parse(values[4]), secret: values[5] });
      return { rows: [row], rowCount: 1 };
    }
    if (sql.startsWith('UPDATE resources SET deleted_at')) { rows = rows.filter(row => row.id !== values[0]); return { rows: [{ id: values[0] }], rowCount: 1 }; }
    if (sql.startsWith('INSERT INTO resources')) {
      const row = { id: randomUUID(), name: values[2], data: JSON.parse(values[3]), secret: values[4], created_at: new Date(), updated_at: new Date() };
      rows.push(row); return { rows: [row], rowCount: 1 };
    }
    return { rows: sql.includes('WHERE id=$1') ? rows.filter(row => row.id === values[0]) : rows, rowCount: rows.length };
  };
  const database = { query, transaction: async (work: any) => {
    const before = structuredClone(rows);
    try { return await work({ query }); } catch (error) { rows = before; throw error; }
  } } as unknown as Database;
  const config = { encryptionKey: key } as Config;
  return { save: (value: unknown) => saveConnectorConfiguration(database, config, 'owner', value), rows: () => rows };
}

test('desktop-shaped save preserves omitted secrets, OAuth and disabled metadata', async () => {
  const f = fixture();
  const before = f.rows()[0];
  await f.save({ mcpServers: { docs: { id: before.id, revision: before.data.revision, type: 'sse', url: before.data.url,
    disabled: true, displayName: 'Docs', exposure: 'deferred', headersConfigured: true,
    oauth: { enabled: true, clientId: 'client', clientSecretConfigured: true } } } });
  const saved = f.rows()[0];
  assert.equal(saved.data.transport, 'sse'); assert.equal(saved.data.enabled, false);
  const secret = unseal(saved.secret, key) as any;
  assert.equal(secret.headers.Authorization, 'secret-header'); assert.equal(secret.oauthClientSecret, 'secret-client');
  assert.equal(secret.oauthState, undefined, 'transport change invalidates authorization');
});

test('whole config saves roll back earlier writes when a later item is invalid', async () => {
  const f = fixture(); const before = structuredClone(f.rows());
  await assert.rejects(f.save({ mcpServers: { new: { type: 'http', url: 'https://example.test' }, bad: { type: 'http', url: 'https://example.test', forged: 'secret' } } }));
  assert.deepEqual(f.rows(), before);
});

test('save rejects foreign ids and stale revisions instead of changing another connector', async () => {
  const f = fixture(); const row = f.rows()[0];
  await assert.rejects(f.save({ mcpServers: { docs: { id: randomUUID(), type: 'http', url: row.data.url } } }), (error: any) => error.code === 'NOT_FOUND');
  await assert.rejects(f.save({ mcpServers: { docs: { id: row.id, revision: randomUUID(), type: 'http', url: row.data.url } } }), (error: any) => error.code === 'CONNECTOR_CHANGED');
});
