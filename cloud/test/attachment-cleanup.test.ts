import assert from 'node:assert/strict';
import test from 'node:test';

import { cleanupFileDeletions } from '../src/domains/attachment/node/cleanup.ts';
import type { Database } from '../src/infra/db.ts';
import type { Storage } from '../src/platform/storage.ts';

const deletionId = '11111111-1111-4111-8111-111111111111';
const leaseToken = '22222222-2222-4222-8222-222222222222';

function fixture(options: { removeError?: Error; attempts?: number } = {}) {
  const calls: Array<{ sql: string; values?: readonly unknown[] }> = [];
  const database = {
    async query(sql: string, values?: readonly unknown[]) {
      calls.push({ sql, values });
      if (sql.includes('UPDATE file_deletions AS deletion')) {
        return {
          rows: [{
            id: deletionId,
            object_key: 'users/owner/files/file',
            lease_token: leaseToken,
            attempts: options.attempts ?? 0,
          }],
          rowCount: 1,
        };
      }
      return { rows: [], rowCount: 0 };
    },
    async transaction<T>(fn: (client: any) => Promise<T>) { return fn(database); },
  } as Database;
  const removed: string[] = [];
  const storage: Storage = {
    async put() {},
    async get() { return new Uint8Array(); },
    async remove(key) {
      removed.push(key);
      if (options.removeError) throw options.removeError;
    },
    async ready() {},
  };
  return { calls, database, removed, storage };
}

test('cleanup claims a bounded batch and acknowledges successful object deletion', async () => {
  const f = fixture();

  const result = await cleanupFileDeletions({
    database: f.database,
    storage: f.storage,
    batchSize: 7,
    maxAttempts: 4,
    leaseMs: 30_000,
  });

  assert.deepEqual(result, { claimed: 1, deleted: 1, failed: 0, exhausted: 0 });
  assert.deepEqual(f.removed, ['users/owner/files/file']);
  assert.match(f.calls[0].sql, /FOR UPDATE SKIP LOCKED/);
  assert.match(f.calls[0].sql, /attempts < \$1/);
  assert.deepEqual(f.calls[0].values?.slice(0, 2), [4, 7]);
  assert.match(f.calls[1].sql, /DELETE FROM file_deletions/);
  assert.deepEqual(f.calls[1].values, [deletionId, leaseToken]);
});

test('cleanup records failures and leaves an exhausted row for inspection', async () => {
  const f = fixture({ removeError: new Error('object store down'), attempts: 2 });

  const result = await cleanupFileDeletions({
    database: f.database,
    storage: f.storage,
    batchSize: 5,
    maxAttempts: 3,
  });

  assert.deepEqual(result, { claimed: 1, deleted: 0, failed: 1, exhausted: 1 });
  assert.match(f.calls[1].sql, /UPDATE file_deletions/);
  assert.deepEqual(f.calls[1].values?.slice(0, 3), [deletionId, leaseToken, 'object store down']);
  assert.equal(f.calls.some(call => call.sql.includes('DELETE FROM file_deletions') && call !== f.calls[0]), false);
});
