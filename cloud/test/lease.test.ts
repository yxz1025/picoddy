import test, { after, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

import type { Run } from '../src/cloud/runs/types.ts';

const databaseUrl = process.env.TEST_DATABASE_URL;
const integration = databaseUrl ? test : test.skip;
let db: typeof import('../src/infra/db.ts');
let events: typeof import('../src/cloud/runs/events.ts');
let worker: typeof import('../src/worker.ts');
let run: Run;

before(async () => {
  if (!databaseUrl) return;
  assert.match(new URL(databaseUrl).pathname, /test/i, 'Use a disposable test database');
  process.env.DATABASE_URL = databaseUrl;
  db = await import('../src/infra/db.ts');
  events = await import('../src/cloud/runs/events.ts');
  worker = await import('../src/worker.ts');
  await db.initializeDatabase();
});

beforeEach(async () => {
  if (!databaseUrl) return;
  await db.query('TRUNCATE users CASCADE');
  const ownerId = randomUUID();
  const conversationId = randomUUID();
  const runId = randomUUID();
  const leaseToken = randomUUID();
  await db.query(
    "INSERT INTO users(id,subject,email,name) VALUES($1,'lease','lease@test.invalid','Lease')",
    [ownerId],
  );
  await db.query(
    "INSERT INTO conversations(id,owner_id,title) VALUES($1,$2,'Lease')",
    [conversationId, ownerId],
  );
  const selection = {
    runtimeProfile: { mode: 'craft', category: 'assistant' },
    permission: 'full', skills: [], connectors: [], files: [],
    workspace: { scopeId: conversationId, ownerId, revision: 0, files: [] },
    settings: { customInstructions: '', language: 'zh-CN' },
    model: { id: randomUUID(), name: 'Test', data: {} },
  };
  await db.query(
    `INSERT INTO runs(id,owner_id,conversation_id,status,prompt,selection,idempotency_key,lease_token,lease_until)
     VALUES($1,$2,$3,'running','lease',$4::jsonb,$5,$6,now()+interval '5 minutes')`,
    [runId, ownerId, conversationId, JSON.stringify(selection), randomUUID(), leaseToken],
  );
  run = {
    id: runId,
    owner_id: ownerId,
    conversation_id: conversationId,
    lease_token: leaseToken,
    status: 'running',
    prompt: 'lease',
    sandbox_id: null,
    selection,
  } as Run;
});

after(async () => {
  if (databaseUrl) await db.pool.end();
});

integration('disabling an owner revokes lease guards, event writes, and heartbeat renewal', async () => {
  await events.assertLease(run);
  assert.equal(await worker.renewRunLease(run), true);

  await db.query('UPDATE users SET disabled_at=now() WHERE id=$1', [run.owner_id]);

  await assert.rejects(events.assertLease(run), /LEASE/);
  await assert.rejects(events.emitRun(run, 'status', { status: 'running' }), /LEASE/);
  assert.equal(await worker.renewRunLease(run), false);
  const emitted = await db.query('SELECT id FROM events WHERE run_id=$1', [run.id]);
  assert.equal(emitted.rowCount, 0);
});
