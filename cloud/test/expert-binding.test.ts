import test, { before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
const url = process.env.TEST_DATABASE_URL;
const integration = url ? test : test.skip;
let db: typeof import('../src/infra/db.ts');
let bindings: typeof import('../src/domains/expert/node/binding.ts');
let owner: string, conversation: string, expert: string;
before(async () => {
  if (!url) return;
  assert.match(new URL(url).pathname, /test/i);
  process.env.DATABASE_URL = url;
  db = await import('../src/infra/db.ts'); await db.initializeDatabase();
  bindings = await import('../src/domains/expert/node/binding.ts');
});
beforeEach(async () => {
  if (!url) return;
  await db.query('TRUNCATE users CASCADE');
  owner = randomUUID(); conversation = randomUUID(); expert = randomUUID();
  await db.query("INSERT INTO users(id,subject,email,name) VALUES($1,'expert','expert@test.invalid','Expert')", [owner]);
  await db.query("INSERT INTO conversations(id,owner_id,title) VALUES($1,$2,'Expert')", [conversation, owner]);
  await db.query("INSERT INTO resources(id,owner_id,kind,name,data) VALUES($1,$2,'expert','Report expert',$3::jsonb)", [expert, owner, JSON.stringify({ prompt: 'Help write reports', skillIds: [] })]);
});
after(async () => { if (url) await db.pool.end(); });
integration('expert binding persists and conceals cross-user conversations and experts', async () => {
  const service = bindings.createExpertBindingService(db.database, owner);
  const binding = await service.assign(conversation, expert);
  assert.equal(binding.expertId, expert);
  assert.equal(binding.catalogSource, 'installed');
  assert.deepEqual(await service.get(conversation), binding);
  await assert.rejects(bindings.createExpertBindingService(db.database, randomUUID()).assign(conversation, expert), /not found/i);
  await assert.rejects(service.assign(conversation, randomUUID()), /not found/i);
  await service.clear(conversation);
  assert.equal(await service.get(conversation), null);
});
integration('active runs prevent expert switching and clearing without cancelling the run', async () => {
  const service = bindings.createExpertBindingService(db.database, owner);
  await service.assign(conversation, expert);
  await db.query("INSERT INTO runs(owner_id,conversation_id,prompt,selection,idempotency_key) VALUES($1,$2,'test','{}','test')", [owner, conversation]);
  await assert.rejects(service.clear(conversation), /active/i);
  await assert.rejects(service.assign(conversation, expert), /active/i);
  assert.equal((await service.get(conversation))?.expertId, expert);
});
