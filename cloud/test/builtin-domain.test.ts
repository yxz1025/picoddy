import assert from 'node:assert/strict';
import test from 'node:test';
import { createBuiltinNpmService, mergeBuiltinEnvironment } from '../src/domains/connector/node/builtin-npm.ts';
import { unseal } from '../src/infra/crypto.ts';
import type { Database } from '../src/infra/db.ts';
import type { Config } from '../src/config.ts';
import { createApplication } from '../src/application.ts';
import { loadConfig } from '../src/config.ts';
import { SESSION_COOKIE } from '../src/cloud/auth/service.ts';
import { Readable } from 'node:stream';
import type { IncomingMessage, ServerResponse } from 'node:http';

const config = { encryptionKey: '0123456789abcdef0123456789abcdef' } as Config;
function fixture() {
  const rows: any[] = [];
  const query = async (sql: string, args: any[] = []) => {
    let result: any[];
    if (sql.includes('FROM sessions s')) result = [{ id: 'owner', sessionId: 'session' }];
    else if (sql.startsWith('SELECT id FROM users')) result = [];
    else if (sql.startsWith('INSERT INTO resources')) {
      const row = { id: `11111111-1111-4111-8111-${String(rows.length+1).padStart(12, '0')}`, owner_id: args[0], name: args[2], data: JSON.parse(args[3]), secret: args[4], created_at: new Date(), updated_at: new Date() };
      rows.push(row); result = [row];
    } else if (sql.startsWith('UPDATE resources SET secret')) {
      const row = rows.find(row => row.id === args[0] && row.owner_id === args[1]); if (row) row.secret = args[2]; result = row ? [row] : [];
    } else if (sql.startsWith('UPDATE resources SET name')) {
      const row = rows.find(row => row.id === args[0] && row.owner_id === args[1]);
      if (row) Object.assign(row, { name: args[3], data: JSON.parse(args[4]), secret: args[5] }); result = row ? [row] : [];
    } else if (sql.includes('WHERE id=$1')) result = rows.filter(row => row.id === args[0] && row.owner_id === args[1]);
    else result = rows.filter(row => row.owner_id === args[0] && (!sql.includes('name=$2') || row.name === args[1]) && (!sql.includes("name='tapd'") || row.name === 'tapd'));
    return { rows: structuredClone(result), rowCount: result.length };
  };
  const database = { query, transaction: (work: any) => work({ query }) } as unknown as Database;
  return { database, rows };
}

test('npm presets configure encrypted secrets, preserve blank token and refuse custom collision', async () => {
  const f = fixture(), service = createBuiltinNpmService(f.database, config, 'owner', async () => true);
  await service.configure('gitlab', { env: { GITLAB_API_URL: 'https://gitlab.test/api/v4', GITLAB_PERSONAL_ACCESS_TOKEN: 'token-1' } });
  const state = await service.configure('gitlab', { env: { GITLAB_API_URL: 'https://other.test/api/v4', GITLAB_PERSONAL_ACCESS_TOKEN: '' } });
  assert.equal(state.configured, true); assert.equal(state.hasToken, true);
  assert.equal(JSON.stringify(state).includes('token-1'), false);
  assert.equal((unseal(f.rows[0].secret, config.encryptionKey) as any).env.GITLAB_PERSONAL_ACCESS_TOKEN, 'token-1');
  f.rows[0].data.command = 'custom';
  await assert.rejects(service.configure('gitlab', { env: {} }), (e: any) => e.code === 'BUILTIN_PRESET_CONFLICT');
  assert.equal(f.rows[0].data.command, 'custom');
  assert.equal((await createBuiltinNpmService(f.database, config, 'other', async () => true).status('gitlab')).configured, false);
  assert.throws(() => mergeBuiltinEnvironment('jenkins', { MCP_JENKINS_URL: 'https://u:pw@test', MCP_JENKINS_USER: 'user', MCP_JENKINS_API_TOKEN: 'token' }, {}));
});
