import assert from 'node:assert/strict';
import test from 'node:test';
import { createArtifactService } from '../src/domains/artifact/node/service.ts';
import type { Database } from '../src/infra/db.ts';
import type { Storage } from '../src/platform/storage.ts';
import type { CloudSandbox } from '../src/platform/sandbox.ts';
import type { Run } from '../src/cloud/runs/types.ts';

function fixture(lease = true) {
  const objects = new Map<string, Uint8Array>();
  const calls: string[] = [];
  let receipt: unknown;
  const database = {
    async query(sql: string, values?: unknown[]) {
      calls.push(sql);
      if (sql.includes('SELECT payload FROM events')) return { rows: receipt ? [{ payload: receipt }] : [], rowCount: receipt ? 1 : 0 };
      if (sql.includes("'delivery_batch'")) receipt = JSON.parse(String(values?.[2]));
      return { rows: lease ? [{ id: 'run' }] : [], rowCount: lease ? 1 : 0 };
    },
    async transaction(fn: (client: unknown) => Promise<unknown>) { return fn(database); },
  } as unknown as Database;
  const storage: Storage = {
    async put(key, bytes) { objects.set(key, bytes); }, async get(key) { return objects.get(key)!; },
    async remove(key) { objects.delete(key); }, async ready() {},
  };
  const sandbox = { async read(path: string) {
    if (path.endsWith('empty.txt')) return new Uint8Array();
    return Buffer.from('result');
  } } as CloudSandbox;
  const run = { id: 'run', owner_id: 'owner', lease_token: 'lease' } as Run;
  return { objects, calls, publish: (files: Array<string | { path: string; title?: string }>) =>
    createArtifactService({ database, storage, maxUploadBytes: 1024 }).present(run, 'call', sandbox, { files }) };
}

test('present_files preserves ordered desktop delivery metadata using authenticated cloud paths', async () => {
  const f = fixture();
  const result = await f.publish([{ path: '/workspace/output/report.md', title: '报告' }, '/workspace/output/chart.txt']);
  assert.equal(result.files.length, 2);
  assert.equal(result.files[0].title, '报告');
  assert.match(result.files[0].path!, /^\/cloud-files\/[^/]+\/report.md$/);
  assert.equal(result.files[0].bytes, 6);
  assert.ok(result.files[0].digest);
  assert.equal(f.objects.size, 2);
});

test('empty, escaped and partly invalid batches do not publish partial artifacts', async () => {
  for (const files of [[], ['/workspace/output/../input/secret'], ['/workspace/output/a.txt', '/workspace/output/empty.txt']]) {
    const f = fixture();
    await assert.rejects(f.publish(files));
    assert.equal(f.objects.size, 0);
    assert.equal(f.calls.some(sql => sql.includes('INSERT INTO files')), false);
  }
});

test('lost run lease prevents delivery records and cleans staged objects', async () => {
  const f = fixture(false);
  await assert.rejects(f.publish(['/workspace/output/a.txt']), /RUN_LEASE_LOST/);
  assert.equal(f.objects.size, 0);
});

test('delivery receipt is committed with files and reused for the same tool call', async () => {
  const f = fixture();
  const first = await f.publish(['/workspace/output/a.txt']);
  const writes = f.calls.filter(sql => sql.includes('INSERT INTO files')).length;
  const replay = await f.publish(['/workspace/output/a.txt']);
  assert.deepEqual(replay.files, first.files);
  assert.equal(f.objects.size, 1);
  assert.equal(f.calls.filter(sql => sql.includes('INSERT INTO files')).length, writes);
  assert.equal(f.calls.filter(sql => sql.includes('INSERT INTO events')).length, 2);
  await assert.rejects(f.publish(['/workspace/output/b.txt']), /TOOL_CALL_ID_REUSED_WITH_DIFFERENT_INPUT/);
});
