import test, { before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
const url = process.env.TEST_DATABASE_URL;
const integration = url ? test : test.skip;
let db: typeof import('../src/infra/db.ts');
let drafts: typeof import('../src/domains/skill-draft/node/service.ts');
let owner: string, conversation: string;
before(async () => {
  if (!url) return;
  assert.match(new URL(url).pathname, /test/i);
  process.env.DATABASE_URL = url;
  db = await import('../src/infra/db.ts');
  await db.initializeDatabase();
  drafts = await import('../src/domains/skill-draft/node/service.ts');
});
beforeEach(async () => {
  if (!url) return;
  await db.query('TRUNCATE users CASCADE');
  owner = randomUUID(); conversation = randomUUID();
  await db.query("INSERT INTO users(id,subject,email,name) VALUES($1,'draft','draft@test.invalid','Draft')", [owner]);
  await db.query("INSERT INTO conversations(id,owner_id,title,category) VALUES($1,$2,'Draft','skill_creator')", [conversation, owner]);
});
after(async () => { if (url) await db.pool.end(); });
const markdown = '---\nname: demo\ndescription: Useful skill\n---\n\nDo useful work.\n';

integration('draft is private, requires validation of the exact revision and publishes the complete package atomically', async () => {
  const service = drafts.createSkillDraftService(db.database, owner);
  let draft = await service.ensure(conversation);
  await assert.rejects(drafts.createSkillDraftService(db.database, randomUUID()).get(draft.id), /not found/i);
  draft = await service.write(draft.id, 'SKILL.md', Buffer.from(markdown), draft.revision);
  draft = await service.write(draft.id, 'assets/data.bin', Buffer.from([0, 255, 1]), draft.revision);
  await assert.rejects(service.publish(draft.id, draft.revision), /validat/i);
  const validation = await service.validate(draft.id);
  assert.equal(validation.valid, true);
  const published = await service.publish(draft.id, draft.revision);
  assert.equal(published.name, 'demo');
  const installed = (await db.query('SELECT files FROM skill_versions WHERE skill_id=$1', [published.skillId])).rows[0].files;
  assert.equal(installed.length, 2);
  assert.equal(installed.find((f: any) => f.path === 'assets/data.bin').contentBase64, 'AP8B');
  await assert.rejects(service.write(draft.id, 'SKILL.md', Buffer.from(markdown), draft.revision), /read.only/i);
  assert.deepEqual(await service.publish(draft.id, draft.revision), published);
});

integration('editing invalidates validation and old browser confirmations cannot publish unseen changes', async () => {
  const service = drafts.createSkillDraftService(db.database, owner);
  let draft = await service.ensure(conversation);
  draft = await service.write(draft.id, 'SKILL.md', Buffer.from(markdown), draft.revision);
  await service.validate(draft.id);
  const stale = draft.revision;
  draft = await service.write(draft.id, 'references/info.txt', Buffer.from('new'), draft.revision);
  await assert.rejects(service.publish(draft.id, draft.revision), /validat/i);
  await service.validate(draft.id);
  await assert.rejects(service.publish(draft.id, stale), /changed/i);
  await assert.rejects(service.write(draft.id, '../escape', Buffer.from('x'), draft.revision), /path/i);
});

integration('revision copies every installed file, preserves name, and refuses an externally changed base', async () => {
  const service = drafts.createSkillDraftService(db.database, owner);
  let draft = await service.ensure(conversation);
  draft = await service.write(draft.id, 'SKILL.md', Buffer.from(markdown), draft.revision);
  draft = await service.write(draft.id, 'scripts/helper.py', Buffer.from('print(1)'), draft.revision);
  await service.validate(draft.id);
  const installed = await service.publish(draft.id, draft.revision);
  draft = await service.revise(draft.id, draft.revision);
  assert.equal(draft.installedAt, undefined);
  assert.equal((await service.files(draft.id)).length, 2);
  draft = await service.write(draft.id, 'SKILL.md', Buffer.from(markdown.replace('name: demo', 'name: renamed')), draft.revision);
  assert.equal((await service.validate(draft.id)).valid, false);
  draft = await service.write(draft.id, 'SKILL.md', Buffer.from(markdown + 'Revised.'), draft.revision);
  await service.validate(draft.id);
  await db.query("UPDATE resources SET data=jsonb_set(data,'{currentVersion}','\"other\"') WHERE id=$1", [installed.skillId]);
  await assert.rejects(service.publish(draft.id, draft.revision), /installed skill changed/i);
});

integration('agent mutations require its live lease and cannot edit another conversation draft', async () => {
  const service = drafts.createSkillDraftService(db.database, owner);
  const draft = await service.ensure(conversation);
  const fence = { id: randomUUID(), lease_token: randomUUID(), conversation_id: conversation, owner_id: owner };
  await assert.rejects(service.write(draft.id, 'SKILL.md', Buffer.from(markdown), draft.revision, fence), /LEASE/);
  await assert.rejects(service.ensure(conversation, { ...fence, conversation_id: randomUUID() }), /SCOPE/);
});

integration('editing an installed skill creates a separate creator session with a frozen complete base', async () => {
  const service = drafts.createSkillDraftService(db.database, owner);
  let draft = await service.ensure(conversation);
  draft = await service.write(draft.id, 'SKILL.md', Buffer.from(markdown), draft.revision);
  await service.validate(draft.id);
  const installed = await service.publish(draft.id, draft.revision);
  const edit = await service.createRevisionSession(installed.skillId);
  assert.notEqual(edit.id, conversation);
  assert.equal(edit.category, 'skill_creator');
  const revision = await service.byConversation(edit.id);
  assert.equal(revision.baseVersion, installed.version);
  assert.equal((await service.files(revision.id)).length, 1);
  await assert.rejects(drafts.createSkillDraftService(db.database, randomUUID()).createRevisionSession(installed.skillId), /not found/i);
});

integration('rollback selects an owned immutable version only when the expected installed pointer matches', async () => {
  const service = drafts.createSkillDraftService(db.database, owner);
  const { createSkillService } = await import('../src/domains/skill/node/service.ts');
  const skills = createSkillService({ database: db.database, maxUploadBytes: 1024 * 1024 });
  let draft = await service.ensure(conversation);
  draft = await service.write(draft.id, 'SKILL.md', Buffer.from(markdown), draft.revision);
  await service.validate(draft.id);
  const original = await service.publish(draft.id, draft.revision);
  draft = await service.revise(draft.id, draft.revision);
  draft = await service.write(draft.id, 'SKILL.md', Buffer.from(markdown + 'Changed.'), draft.revision);
  await service.validate(draft.id);
  const changed = await service.publish(draft.id, draft.revision);
  await assert.rejects(skills.rollback(owner, original.skillId, { version: original.version, expectedVersion: original.version }), /changed/i);
  const restored = await skills.rollback(owner, original.skillId, { version: original.version, expectedVersion: changed.version });
  assert.equal(restored.version, original.version);
  assert.equal((await skills.versions(owner, original.skillId)).length, 2);
  await assert.rejects(skills.rollback(randomUUID(), original.skillId, { version: original.version, expectedVersion: original.version }), /not found/i);
});
