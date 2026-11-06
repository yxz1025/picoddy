import test, { after, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

import {
  createExpertDraftAgentService,
  createExpertDraftService,
  normalizeExpertDraftProfile,
} from '../src/domains/expert-draft/node/service.ts';
import { createExpertDraftTools } from '../src/agent/tools/expert-draft.ts';
import type { Run } from '../src/cloud/runs/types.ts';
import type { Database } from '../src/infra/db.ts';
import { HttpError } from '../src/shared/errors.ts';

const databaseUrl = process.env.TEST_DATABASE_URL;
const integration = databaseUrl ? test : test.skip;

let db: typeof import('../src/infra/db.ts');
let ownerId: string;
let otherOwnerId: string;
let conversationId: string;
let skillId: string;

function completeProfile(name: string, prompt: string, skillIds: string[] = []) {
  return {
    name,
    prompt,
    skillIds,
    description: `${name} description`,
    tags: ['analysis', 'planning', 'delivery'],
    quickPrompts: ['Analyze this', 'Make a plan', 'Review the result'],
    icon: '🤖',
    categoryId: 'cloud',
  };
}

before(async () => {
  if (!databaseUrl) return;
  assert.match(new URL(databaseUrl).pathname, /test/i);
  process.env.DATABASE_URL = databaseUrl;
  db = await import('../src/infra/db.ts');
  await db.initializeDatabase();
});

beforeEach(async () => {
  if (!databaseUrl) return;
  await db.query('TRUNCATE users CASCADE');
  ownerId = randomUUID();
  otherOwnerId = randomUUID();
  conversationId = randomUUID();
  skillId = randomUUID();
  await db.query(
    `INSERT INTO users(id,subject,email,name) VALUES
      ($1,'expert-draft','expert-draft@test.invalid','Expert Draft'),
      ($2,'other-expert-draft','other-expert-draft@test.invalid','Other')`,
    [ownerId, otherOwnerId],
  );
  await db.query(
    "INSERT INTO conversations(id,owner_id,title,category) VALUES($1,$2,'Expert Draft','expert_creator')",
    [conversationId, ownerId],
  );
  await db.query(
    "INSERT INTO resources(id,owner_id,kind,name,data) VALUES($1,$2,'skill','owned-skill','{\"enabled\":true}')",
    [skillId, ownerId],
  );
});

after(async () => {
  if (databaseUrl) await db.pool.end();
});

test('profile normalization is complete and rejects silently dropped fields', () => {
  const input = {
    name: '  Retail Expert  ',
    prompt: '  Follow policy.  ',
    skillIds: [skillId ?? '11111111-1111-4111-8111-111111111111'],
    description: '  Helps retail teams.  ',
    tags: [' Retail ', 'Operations', 'Analysis'],
    quickPrompts: [' Summarize sales ', 'Review inventory', 'Draft a plan'],
    icon: ' 🛍️ ',
    categoryId: ' retail ',
  };
  assert.deepEqual(
    normalizeExpertDraftProfile(input),
    {
      name: 'Retail Expert',
      prompt: 'Follow policy.',
      skillIds: [skillId ?? '11111111-1111-4111-8111-111111111111'],
      description: 'Helps retail teams.',
      tags: ['Retail', 'Operations', 'Analysis'],
      quickPrompts: ['Summarize sales', 'Review inventory', 'Draft a plan'],
      icon: '🛍️',
      categoryId: 'retail',
    },
  );
  assert.throws(
    () => normalizeExpertDraftProfile({ name: 'Expert', prompt: 'Rules', skillIds: [], preferredTools: ['bash'] }),
    /unsupported expert profile field/i,
  );
  assert.throws(
    () => normalizeExpertDraftProfile({ name: 'Expert', prompt: 'x'.repeat(8_001), skillIds: [] }),
    /exceed/i,
  );
});

test('agent surface exposes bounded draft operations and never publication', () => {
  const tools = createExpertDraftTools({
    id: '11111111-1111-4111-8111-111111111111',
    owner_id: '22222222-2222-4222-8222-222222222222',
    conversation_id: '33333333-3333-4333-8333-333333333333',
    lease_token: '44444444-4444-4444-8444-444444444444',
    selection: { runtimeProfile: { category: 'expert_creator', mode: 'craft' } },
  } as unknown as Run, {} as Database);
  assert.deepEqual(tools.map(tool => tool.name), [
    'expert_draft_read',
    'expert_draft_write',
    'expert_draft_validate',
  ]);
  assert.equal(tools.some(tool => tool.name.includes('publish')), false);
});

integration('create draft is owner-private and publishes only an exactly validated revision', async () => {
  const service = createExpertDraftService(db.database, ownerId);
  let draft = await service.ensure(conversationId);
  await assert.rejects(createExpertDraftService(db.database, otherOwnerId).get(draft.id), /not found/i);

  draft = await service.write(
    draft.id,
    completeProfile('Retail Expert', 'Use retail terminology.', [skillId]),
    draft.revision,
  );
  await assert.rejects(service.publish(draft.id, draft.revision), /validat/i);
  const validation = await service.validate(draft.id);
  assert.equal(validation.valid, true);

  const published = await service.publish(draft.id, draft.revision);
  const stored = await db.query("SELECT name,data FROM resources WHERE id=$1 AND owner_id=$2 AND kind='expert'", [published.expertId, ownerId]);
  assert.equal(stored.rows[0].name, 'Retail Expert');
  assert.deepEqual(stored.rows[0].data, {
    prompt: 'Use retail terminology.',
    skillIds: [skillId],
    description: 'Retail Expert description',
    tags: ['analysis', 'planning', 'delivery'],
    quickPrompts: ['Analyze this', 'Make a plan', 'Review the result'],
    icon: '🤖',
    categoryId: 'cloud',
  });
  assert.deepEqual(await service.publish(draft.id, draft.revision), published);
  await assert.rejects(service.write(draft.id, draft.profile, draft.revision), /read.only/i);
});

integration('profile writes reject another owner skill and invalidate prior validation', async () => {
  const service = createExpertDraftService(db.database, ownerId);
  let draft = await service.ensure(conversationId);
  const foreignSkill = randomUUID();
  await db.query(
    "INSERT INTO resources(id,owner_id,kind,name,data) VALUES($1,$2,'skill','foreign-skill','{\"enabled\":true}')",
    [foreignSkill, otherOwnerId],
  );
  await assert.rejects(
    service.write(draft.id, completeProfile('Unsafe', 'Rules', [foreignSkill]), draft.revision),
    /unavailable resource/i,
  );

  draft = await service.write(draft.id, completeProfile('Safe', 'Rules', [skillId]), draft.revision);
  await service.validate(draft.id);
  draft = await service.write(draft.id, completeProfile('Safe', 'Changed rules', [skillId]), draft.revision);
  await assert.rejects(service.publish(draft.id, draft.revision), /validat/i);
});

integration('edit sessions freeze the complete expert profile and reject a changed base revision', async () => {
  const expertId = randomUUID();
  await db.query(
    "INSERT INTO resources(id,owner_id,kind,name,data) VALUES($1,$2,'expert','Existing',$3::jsonb)",
    [expertId, ownerId, JSON.stringify({ prompt: 'Original prompt', skillIds: [skillId] })],
  );
  const service = createExpertDraftService(db.database, ownerId);
  const conversation = await service.createEditSession(expertId);
  assert.equal(conversation.category, 'expert_creator');
  let draft = await service.byConversation(conversation.id);
  assert.equal(draft.operation, 'edit');
  assert.equal(draft.expertId, expertId);
  assert.equal(draft.profile.prompt, 'Original prompt');

  draft = await service.write(
    draft.id,
    completeProfile(draft.profile.name, 'Edited prompt', draft.profile.skillIds),
    draft.revision,
  );
  await service.validate(draft.id);
  await db.query(
    "UPDATE resources SET data=jsonb_set(data,'{prompt}','\"Concurrent prompt\"'),updated_at=now() WHERE id=$1 AND owner_id=$2",
    [expertId, ownerId],
  );
  await assert.rejects(
    service.publish(draft.id, draft.revision, draft.baseRevision),
    /expert changed/i,
  );
});

integration('edit publish requires the browser base revision and atomically replaces the resource', async () => {
  const expertId = randomUUID();
  await db.query(
    "INSERT INTO resources(id,owner_id,kind,name,data) VALUES($1,$2,'expert','Existing',$3::jsonb)",
    [expertId, ownerId, JSON.stringify({
      prompt: 'Original prompt',
      skillIds: [],
      legacyConfig: { mode: 'safe' },
    })],
  );
  const service = createExpertDraftService(db.database, ownerId);
  const conversation = await service.createEditSession(expertId);
  let draft = await service.byConversation(conversation.id);
  draft = await service.write(
    draft.id,
    completeProfile('Renamed', 'Edited prompt', [skillId]),
    draft.revision,
  );
  await service.validate(draft.id);
  await assert.rejects(
    service.publish(draft.id, draft.revision),
    (error: unknown) => error instanceof HttpError
      && error.code === 'EXPECTED_BASE_REVISION_REQUIRED',
  );
  await assert.rejects(
    service.publish(draft.id, draft.revision, 'stale'),
    (error: unknown) => error instanceof HttpError
      && error.code === 'BASE_REVISION_CHANGED',
  );
  const published = await service.publish(draft.id, draft.revision, draft.baseRevision);
  assert.equal(published.expertId, expertId);
  const stored = await db.query('SELECT name,data FROM resources WHERE id=$1 AND owner_id=$2', [expertId, ownerId]);
  assert.equal(stored.rows[0].name, 'Renamed');
  assert.deepEqual(stored.rows[0].data, {
    legacyConfig: { mode: 'safe' },
    prompt: 'Edited prompt',
    skillIds: [skillId],
    description: 'Renamed description',
    tags: ['analysis', 'planning', 'delivery'],
    quickPrompts: ['Analyze this', 'Make a plan', 'Review the result'],
    icon: '🤖',
    categoryId: 'cloud',
  });
});

integration('human draft mutation and publication refuse every active run state', async () => {
  const service = createExpertDraftService(db.database, ownerId);
  const draft = await service.ensure(conversationId);
  for (const status of ['queued', 'provisioning', 'running', 'waiting_approval', 'cancelling', 'cleanup_pending']) {
    const runId = randomUUID();
    await db.query(
      `INSERT INTO runs(id,owner_id,conversation_id,status,prompt,selection,idempotency_key)
       VALUES($1,$2,$3,$4,'draft','{}',$5)`,
      [runId, ownerId, conversationId, status, randomUUID()],
    );
    await assert.rejects(
      service.write(draft.id, completeProfile('Busy', 'Rules'), draft.revision),
      /active run/i,
    );
    await assert.rejects(service.publish(draft.id, draft.revision), /active run/i);
    await db.query('UPDATE runs SET status=$2 WHERE id=$1', [runId, status === 'cleanup_pending' ? 'failed' : 'cancelled']);
  }
});

integration('agent edits are conversation-scoped and require a live running lease, without publish capability', async () => {
  const service = createExpertDraftService(db.database, ownerId);
  let draft = await service.ensure(conversationId);
  const run = {
    id: randomUUID(),
    owner_id: ownerId,
    conversation_id: conversationId,
    lease_token: randomUUID(),
  };
  await db.query(
    `INSERT INTO runs(id,owner_id,conversation_id,status,prompt,selection,idempotency_key,lease_token,lease_until)
     VALUES($1,$2,$3,'running','draft','{}',$4,$5,now()+interval '5 minutes')`,
    [run.id, ownerId, conversationId, randomUUID(), run.lease_token],
  );
  const agent = createExpertDraftAgentService(db.database, run);
  assert.equal('publish' in agent, false);
  draft = await agent.write(
    draft.id,
    completeProfile('Agent', 'Agent-edited rules'),
    draft.revision,
  );
  assert.equal(draft.revision, 1);
  await assert.rejects(
    createExpertDraftAgentService(db.database, { ...run, lease_token: randomUUID() }).validate(draft.id),
    /lease/i,
  );
  await assert.rejects(
    createExpertDraftAgentService(db.database, { ...run, conversation_id: randomUUID() }).read(draft.id),
    /scope/i,
  );
});
