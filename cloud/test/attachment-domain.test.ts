import assert from 'node:assert/strict';
import test from 'node:test';
import type { Database } from '../src/infra/db.ts';
import type { Storage } from '../src/platform/storage.ts';
import { createAttachmentService } from '../src/domains/attachment/node/service.ts';
import { HttpError } from '../src/shared/errors.ts';
import { createHash } from 'node:crypto';

const owner = '11111111-1111-4111-8111-111111111111';
function fixture(rows: Record<string, unknown>[][]) {
  const calls: { sql: string; values?: readonly unknown[] }[] = [];
  const objects = new Map<string, Uint8Array>();
  const operations: string[] = [];
  let inTransaction = false;
  const database = {
    async query(sql: string, values?: readonly unknown[]) {
      operations.push(`sql:${sql.replace(/\s+/g, ' ').trim()}`);
      calls.push({ sql, values });
      const next = rows.shift();
      assert.ok(next, `Unexpected query: ${sql}`);
      return { rows: next, rowCount: next.length };
    },
    async transaction(fn: (client: unknown) => Promise<unknown>) {
      inTransaction = true;
      try { return await fn(database); }
      finally { inTransaction = false; }
    },
  } as unknown as Database;
  const storage: Storage = {
    async put(key, bytes) { objects.set(key, bytes); },
    async get(key) { return objects.get(key)!; },
    async remove(key) {
      assert.equal(inTransaction, false, 'object deletion must run after the database transaction');
      operations.push(`storage:remove:${key}`);
      objects.delete(key);
    },
    async ready() {},
  };
  return {
    calls,
    database,
    objects,
    operations,
    storage,
    service: createAttachmentService({ database, storage, maxUploadBytes: 8 }),
  };
}

test('attachment domain rejects invalid bodies, header controls and oversize uploads before storage', async () => {
  const f = fixture([]);
  for (const body of [
    null,
    [],
    { name: '../x', mimeType: 'text/plain', contentBase64: '' },
    { name: 'x.txt', mimeType: 'text/plain; note=bad\0value', contentBase64: '' },
  ]) {
    await assert.rejects(f.service.upload(owner, body), (e: unknown) => e instanceof HttpError && e.status === 400);
  }
  await assert.rejects(f.service.upload(owner, {
    name: 'x.txt', mimeType: 'text/plain', contentBase64: Buffer.from('123456789').toString('base64'),
  }), (e: unknown) => e instanceof HttpError && e.status === 413);
  assert.equal(f.objects.size, 0);
  assert.equal(f.calls.length, 0);
});

test('attachment download checks owner before accessing object storage', async () => {
  const f = fixture([[]]);
  await assert.rejects(f.service.download(owner, 'missing'), (e: unknown) => e instanceof HttpError && e.status === 404);
  assert.match(f.calls[0].sql, /id=\$1 AND owner_id=\$2/);
  assert.deepEqual(f.calls[0].values, ['missing', owner]);
});

test('attachment reads enforce metadata limits and verify stored bytes', async () => {
  const row = { id: 'file', run_id: null, name: 'report.txt', mime_type: 'text/plain',
    object_key: 'key', size: 4, sha256: createHash('sha256').update('safe').digest('hex'), created_at: new Date() };
  const f = fixture([[row]]);
  f.objects.set('key', Buffer.from('evil'));
  await assert.rejects(f.service.download(owner, 'file'), (e: unknown) => e instanceof HttpError && e.code === 'FILE_INTEGRITY_FAILED');
  const large = fixture([[{ ...row, size: 9 }]]);
  await assert.rejects(large.service.download(owner, 'file'), (e: unknown) => e instanceof HttpError && e.status === 413);
  const valid = fixture([[row]]);
  valid.objects.set('key', Buffer.from('safe'));
  assert.equal(Buffer.from((await valid.service.download(owner, 'file')).bytes).toString(), 'safe');
});

test('deletion uses enqueue lock order and refuses active references', async () => {
  const f = fixture([[{ id: owner }], [{ id: 'file', object_key: 'key' }], [{ id: 'active' }]]);
  f.objects.set('key', Buffer.from('keep'));
  await assert.rejects(f.service.remove(owner, 'file'), (e: unknown) => e instanceof HttpError && e.code === 'FILE_IN_ACTIVE_RUN');
  assert.match(f.calls[0].sql, /FROM users.*FOR UPDATE/);
  assert.match(f.calls[1].sql, /FROM files[\s\S]*FOR UPDATE/);
  assert.ok(f.objects.has('key'));
});

test('deletion commits an outbox row and file removal before touching object storage', async () => {
  const deletionId = '22222222-2222-4222-8222-222222222222';
  const leaseToken = '33333333-3333-4333-8333-333333333333';
  const f = fixture([
    [{ id: owner }],
    [{ id: 'file', object_key: 'key' }],
    [],
    [{ id: deletionId, object_key: 'key', lease_token: leaseToken, attempts: 0 }],
    [],
    [],
  ]);
  f.objects.set('key', Buffer.from('remove'));

  await f.service.remove(owner, 'file');

  const outboxIndex = f.operations.findIndex(operation => operation.includes('INSERT INTO file_deletions'));
  const fileDeleteIndex = f.operations.findIndex(operation => operation.includes('DELETE FROM files'));
  const objectDeleteIndex = f.operations.indexOf('storage:remove:key');
  const outboxDeleteIndex = f.operations.findIndex(operation => operation.includes('DELETE FROM file_deletions'));
  assert.ok(outboxIndex >= 0 && outboxIndex < fileDeleteIndex);
  assert.ok(fileDeleteIndex < objectDeleteIndex);
  assert.ok(objectDeleteIndex < outboxDeleteIndex);
  assert.equal(f.objects.has('key'), false);
});

test('post-commit object deletion failure keeps a retryable outbox row and does not fail the API deletion', async () => {
  const deletionId = '22222222-2222-4222-8222-222222222222';
  const leaseToken = '33333333-3333-4333-8333-333333333333';
  const f = fixture([
    [{ id: owner }],
    [{ id: 'file', object_key: 'key' }],
    [],
    [{ id: deletionId, object_key: 'key', lease_token: leaseToken, attempts: 0 }],
    [],
    [],
  ]);
  const failingStorage: Storage = {
    ...f.storage,
    async remove() { throw new Error('storage unavailable'); },
  };
  const service = createAttachmentService({
    database: f.database,
    storage: failingStorage,
    maxUploadBytes: 8,
  });

  await service.remove(owner, 'file');

  assert.match(f.calls.at(-1)!.sql, /UPDATE file_deletions/);
  assert.equal(f.calls.at(-1)!.values?.[0], deletionId);
  assert.equal(f.calls.at(-1)!.values?.[1], leaseToken);
  assert.match(String(f.calls.at(-1)!.values?.[2]), /storage unavailable/);
});
