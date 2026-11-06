import assert from 'node:assert/strict';
import test from 'node:test';
import type { Database } from '../src/infra/db.ts';
import type { Run } from '../src/cloud/runs/types.ts';
import { loadSessionRuntime, saveSessionRuntime } from '../src/domains/session/node/runtime.ts';

const run = { id: 'run', owner_id: 'owner', conversation_id: 'conversation', lease_token: 'lease' } as Run;
test('runtime checkpoint lookup is owner scoped and tail starts after its cursor', async () => {
  const calls: Array<{ sql: string; args: readonly unknown[] | undefined }> = [];
  const header = { type: 'session', id: 'conversation', cwd: '/workspace', timestamp: new Date(0).toISOString() };
  const db = { query: async (sql: string, args?: readonly unknown[]) => {
    calls.push({ sql, args });
    return { rows: calls.length === 1 ? [{ entries: [header], transcript_cursor: '2' }]
      : calls.length === 2 ? [{ bytes: '0', cursor: null }] : [] };
  } } as unknown as Database;
  assert.deepEqual(await loadSessionRuntime(run, db), { messages: [], entries: [header], cursor: '2' });
  assert.match(calls[0].sql, /owner_id=\$1 AND conversation_id=\$2/);
  assert.match(calls[2].sql, /runtime_sequence>\$4/);
  assert.deepEqual(calls[2].args, ['owner', 'conversation', 'run', '2']);
});

test('checkpoint miss restores all raw messages instead of dropping interrupted context', async () => {
  let call = 0;
  const message = { role: 'user', content: 'earlier task', timestamp: 0 };
  const db = { query: async () => ({ rows: ++call === 1 ? []
    : call === 2 ? [{ bytes: '50', cursor: '1' }] : [{ content: message }] }) } as unknown as Database;
  assert.deepEqual(await loadSessionRuntime(run, db), { messages: [message], cursor: '1' });
});

test('lost lease prevents checkpoint writes', async () => {
  let writes = 0;
  const db = { transaction: async (fn: (client: unknown) => unknown) => fn({
    query: async (sql: string) => {
      if (sql.includes('INSERT')) writes++;
      return { rows: [], rowCount: 0 };
    },
  }) } as unknown as Database;
  await assert.rejects(saveSessionRuntime(run, [], '0', db), /RUN_LEASE_LOST/);
  assert.equal(writes, 0);
});
