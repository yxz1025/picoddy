import test, { before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { Run } from '../src/cloud/runs/types.ts';
const url = process.env.TEST_DATABASE_URL;
const integration = url ? test : test.skip;
let db: typeof import('../src/infra/db.ts');
let questions: typeof import('../src/domains/interaction/node/questions.ts');
let run: Run;
before(async () => {
  if (!url) return;
  assert.match(new URL(url).pathname, /test/i);
  process.env.DATABASE_URL = url;
  db = await import('../src/infra/db.ts'); await db.initializeDatabase();
  questions = await import('../src/domains/interaction/node/questions.ts');
});
beforeEach(async () => {
  if (!url) return;
  await db.query('TRUNCATE users CASCADE');
  const owner = randomUUID(), conversation = randomUUID(), id = randomUUID(), token = randomUUID();
  await db.query("INSERT INTO users(id,subject,email,name) VALUES($1,'question','question@test.invalid','Question')", [owner]);
  await db.query("INSERT INTO conversations(id,owner_id,title) VALUES($1,$2,'Question')", [conversation, owner]);
  await db.query("INSERT INTO runs(id,owner_id,conversation_id,prompt,selection,idempotency_key,status,lease_token,lease_until) VALUES($1,$2,$3,'test','{}','test','running',$4,now()+interval '1 hour')", [id, owner, conversation, token]);
  run = { id, owner_id: owner, conversation_id: conversation, lease_token: token } as Run;
});
after(async () => { if (url) await db.pool.end(); });
const input = [{ question: 'Which output?', options: [{ label: 'PDF' }, { label: 'DOCX' }] }];
integration('questions survive reconnect, remain owner scoped and accept one idempotent answer', async () => {
  const service = questions.createQuestionService(db.database);
  const question = await service.open(run, 'call-1', input);
  assert.equal((await service.list(run.owner_id, run.id))[0].id, question.id);
  await assert.rejects(service.answer(randomUUID(), question.id, ['PDF']), /not found/i);
  await service.answer(run.owner_id, question.id, ['PDF']);
  await service.answer(run.owner_id, question.id, ['PDF']);
  await assert.rejects(service.answer(run.owner_id, question.id, ['DOCX']), /already answered/i);
  assert.deepEqual(await service.poll(run, question.id), ['PDF']);
  assert.deepEqual(await service.list(run.owner_id, run.id), []);
});
integration('cancelled or expired runs cannot receive answers or resume and malformed questions fail closed', async () => {
  const service = questions.createQuestionService(db.database);
  await assert.rejects(service.open(run, 'invalid', []), /question/i);
  const question = await service.open(run, 'call-1', input);
  await assert.rejects(service.answer(run.owner_id, question.id, []), /answer/i);
  await db.query('UPDATE runs SET cancel_requested=true WHERE id=$1', [run.id]);
  await assert.rejects(service.answer(run.owner_id, question.id, ['PDF']), /active/i);
  await assert.rejects(service.poll(run, question.id), /LEASE/);
  assert.deepEqual(await service.list(run.owner_id, run.id), []);
});

integration('question deadline expires independently of the run lease and duplicate calls do not reopen it', async () => {
  const service = questions.createQuestionService(db.database);
  const question = await service.open(run, 'deadline', input);
  const duplicate = await service.open(run, 'deadline', input);
  assert.equal(duplicate.id, question.id);
  await assert.rejects(service.open(run, 'deadline', [{ ...input[0], question: 'Different question?' }]), /different/i);
  await db.query("UPDATE user_questions SET expires_at=now()-interval '1 second' WHERE id=$1", [question.id]);
  await assert.rejects(service.answer(run.owner_id, question.id, ['PDF']), /active/i);
  await assert.rejects(service.poll(run, question.id), /EXPIRED/);
  assert.deepEqual(await service.list(run.owner_id, run.id), []);
  await service.close(run, question.id);
  assert.equal((await db.query('SELECT status FROM user_questions WHERE id=$1', [question.id])).rows[0].status, 'expired');
  assert.equal((await service.open(run, 'deadline', input)).status, 'expired');
});
