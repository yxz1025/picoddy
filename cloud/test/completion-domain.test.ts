import test, { before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import type { Run } from '../src/cloud/runs/types.ts';
import type { Storage } from '../src/platform/storage.ts';
import type { CloudSandbox } from '../src/platform/sandbox.ts';
import { createCompletionService } from '../src/domains/interaction/node/completion.ts';
const url = process.env.TEST_DATABASE_URL;
const integration = url ? test : test.skip;
let db: typeof import('../src/infra/db.ts');
let run: Run;
const data = new Map<string, Uint8Array>();
const storage: Storage = { async get(key) { if (!data.has(key)) throw new Error('missing'); return data.get(key)!; }, async put() {}, async remove() {}, async ready() {} };
const sandbox = { async read(path: string) { if (!data.has(path)) throw new Error('missing'); return data.get(path)!; } } as CloudSandbox;
test('waiting for user ends the turn without claiming goal success; failures and cancellation still reject', async () => {
  let declaration = { success: false, status: 'waiting_for_user', summary: 'Select a connector', proof: 'Connector unavailable' };
  let owned = true;
  const database = { async query(sql: string) {
    if (sql.includes('FROM runs')) return { rows: owned ? [{ id: 'run' }] : [] };
    if (sql.includes("type='goal_declared'")) return { rows: [{ payload: declaration }] };
    throw new Error('Waiting must not claim delivery verification');
  } } as unknown as import('../src/infra/db.ts').Database;
  const service = createCompletionService({ database, storage, sandbox, run: {} as Run, maxBytes: 1024 });
  await assert.doesNotReject(service.verify());
  assert.equal((await service.get())?.success, false);
  await assert.rejects(service.verify(AbortSignal.abort(new Error('cancelled'))), /cancelled/);
  declaration = { ...declaration, status: '' };
  await assert.rejects(service.verify(), /GOAL_NOT_COMPLETED/);
  owned = false;
  await assert.rejects(service.verify(), /RUN_LEASE_LOST/);
});
test('contradictory completion status is rejected before persistence', async () => {
  const database = {query: async () => {throw new Error('unexpected persistence');}} as unknown as import('../src/infra/db.ts').Database;
  const service = createCompletionService({database,storage,sandbox,run:{} as Run,maxBytes:1024});
  await assert.rejects(service.declare('goal',{success:false,status:'completed',summary:'Done',proof:'None'}), /Completed requires success/);
});
before(async () => {
  if (!url) return; assert.match(new URL(url).pathname, /test/i); process.env.DATABASE_URL = url;
  db = await import('../src/infra/db.ts'); await db.initializeDatabase();
});
beforeEach(async () => {
  if (!url) return; await db.query('TRUNCATE users CASCADE'); data.clear();
  const owner = randomUUID(), conversation = randomUUID(), id = randomUUID(), token = randomUUID();
  await db.query("INSERT INTO users(id,subject,email,name) VALUES($1,'goal','goal@test.invalid','Goal')", [owner]);
  await db.query("INSERT INTO conversations(id,owner_id,title) VALUES($1,$2,'Goal')", [conversation, owner]);
  await db.query("INSERT INTO runs(id,owner_id,conversation_id,prompt,selection,idempotency_key,status,lease_token,lease_until) VALUES($1,$2,$3,'test','{}','test','running',$4,now()+interval '1 hour')", [id, owner, conversation, token]);
  run = { id, owner_id: owner, conversation_id: conversation, lease_token: token } as Run;
});
after(async () => { if (url) await db.pool.end(); });
integration('completion persists text-only declarations and rejects lost leases and duplicate declarations', async () => {
  const service = createCompletionService({ database: db.database, storage, sandbox, run, maxBytes: 1024 });
  await assert.rejects(service.declare('bad', { success: true, summary: '', proof: '' }), /summary/i);
  await service.declare('goal', { success: true, summary: 'Answered', proof: 'Reviewed reasoning' });
  assert.equal((await service.get())?.success, true);
  await assert.rejects(service.declare('other', { success: true, summary: 'Again', proof: 'none' }), /ALREADY/);
  await db.query('UPDATE runs SET cancel_requested=true WHERE id=$1', [run.id]);
  await assert.rejects(service.verify(), /LEASE/);
});
integration('completion rechecks both immutable delivery bytes and sandbox source, and changed output cannot pass', async () => {
  const id = randomUUID(), path = '/workspace/output/report.txt', key = `test/${id}`, bytes = Buffer.from('ready');
  data.set(path, bytes); data.set(key, bytes);
  const digest = createHash('sha256').update(bytes).digest('hex');
  await db.query('INSERT INTO files(id,owner_id,run_id,name,mime_type,object_key,size,sha256) VALUES($1,$2,$3,$4,$5,$6,$7,$8)', [id, run.owner_id, run.id, 'report.txt', 'text/plain', key, bytes.length, digest]);
  await db.query("INSERT INTO events(owner_id,run_id,type,payload) VALUES($1,$2,'delivery_batch',$3::jsonb)", [run.owner_id, run.id, JSON.stringify({ toolCallId: 'present', details: { files: [{ path: `/cloud-files/${id}/report.txt`, digest, bytes: bytes.length }] }, sources: [{ id, path, digest, bytes: bytes.length }] })]);
  const service = createCompletionService({ database: db.database, storage, sandbox, run, maxBytes: 1024 });
  data.set(path, Buffer.from('changed'));
  await assert.rejects(service.declare('goal', { success: true, summary: 'Done', proof: 'read file' }), /DELIVERY/);
  assert.equal(await service.get(), null);
  data.set(path, bytes);
  await service.declare('goal', { success: true, summary: 'Done', proof: 'read file' });
  data.set(key, Buffer.from('corrupt'));
  await assert.rejects(service.verify(), /DELIVERY/);
});
