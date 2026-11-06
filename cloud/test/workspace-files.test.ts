import test, { before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { snapshotWorkspace, persistWorkspace, createWorkspaceFilesService } from '../src/domains/workspace/node/files.ts';
import type { Run } from '../src/cloud/runs/types.ts';
import type { Storage } from '../src/platform/storage.ts';
import type { CloudSandbox } from '../src/platform/sandbox.ts';

const url = process.env.TEST_DATABASE_URL;
const integration = url ? test : test.skip;
let db: typeof import('../src/infra/db.ts');
let owner: string, conversation: string;
before(async () => {
  if (!url) return;
  assert.match(new URL(url).pathname, /test/i);
  process.env.DATABASE_URL = url;
  db = await import('../src/infra/db.ts');
  // files.ts has a type-only database dependency, so pool initializes here.
  await db.initializeDatabase();
});
beforeEach(async () => {
  if (!url) return;
  await db.query('TRUNCATE users CASCADE');
  owner = randomUUID(); conversation = randomUUID();
  await db.query("INSERT INTO users(id,subject,email,name) VALUES($1,'space','space@test.invalid','Space')", [owner]);
  await db.query("INSERT INTO conversations(id,owner_id,title) VALUES($1,$2,'Space')", [conversation, owner]);
});
after(async () => { if (url) await db.pool.end(); });

async function run(workspaceId: string | null = null): Promise<Run> {
  const workspace = await db.transaction(client => snapshotWorkspace(client, owner, { id: conversation, workspace_id: workspaceId }));
  const selection = { workspace, skills: [], connectors: [], files: [], model: { id: 'model', name: 'model', data: {} },
    runtimeProfile: { mode: 'craft' as const, category: 'assistant' as const }, permission: 'full' as const, settings: { customInstructions: '', language: 'zh-CN' } };
  const id = randomUUID(), token = randomUUID();
  await db.query(`INSERT INTO runs(id,owner_id,conversation_id,prompt,selection,idempotency_key,status,lease_token,lease_until)
    VALUES($1,$2,$3,'test',$4::jsonb,$5,'running',$6,now()+interval '1 hour')`, [id, owner, conversation, JSON.stringify(selection), randomUUID(), token]);
  return { id, owner_id: owner, conversation_id: conversation, prompt: 'test', selection, status: 'running', lease_token: token, sandbox_id: 'fake' };
}

function dependencies(content: string) {
  const objects = new Map<string, Uint8Array>();
  const bytes = Buffer.from(content);
  const manifest = [{ path: 'work/report.txt', size: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') }];
  const sandbox = { exec: async () => ({ exitCode: 0 }), read: async (path: string) => path.includes('.workspace-manifest-') ? Buffer.from(JSON.stringify(manifest)) : bytes } as unknown as CloudSandbox;
  const storage = { put: async (key: string, value: Uint8Array) => { objects.set(key, value); } } as unknown as Storage;
  return { sandbox, storage, signal: new AbortController().signal, guard: async () => {}, objects };
}

integration('concurrent frozen revisions preserve conflicting output without overwriting the winner', async () => {
  const space = randomUUID();
  await db.query("INSERT INTO resources(id,owner_id,kind,name,data) VALUES($1,$2,'workspace','Shared','{}')", [space, owner]);
  await db.query('UPDATE conversations SET workspace_id=$1 WHERE id=$2', [space, conversation]);
  const first = await run(space);
  conversation = randomUUID();
  await db.query("INSERT INTO conversations(id,owner_id,title,workspace_id) VALUES($1,$2,'Second',$3)", [conversation, owner, space]);
  const second = await run(space);
  const results = await Promise.all([persistWorkspace({ database: db.database, run: first, ...dependencies('first') }),
    persistWorkspace({ database: db.database, run: second, ...dependencies('second') })]);
  assert.deepEqual(results.map(r => r.status).sort(), ['committed', 'conflict']);
  const service = createWorkspaceFilesService(db.database, owner);
  assert.equal((await service.list(space)).revision, 1);
  assert.equal((await service.versions(space)).length, 2);
  await assert.rejects(createWorkspaceFilesService(db.database, randomUUID()).list(space));
  const conflict = results.find(r => r.status === 'conflict')!;
  await assert.rejects(service.restore(space, conflict.versionId!, 0));
  assert.deepEqual(await service.restore(space, conflict.versionId!, 1), { revision: 2 });
  assert.equal((await service.file(space, 'work/report.txt')).objectKey.includes(conflict.versionId!), true);
});

integration('deleting a conversation queues every workspace version object for cleanup', async () => {
  const task = await run(), deps = dependencies('output');
  await persistWorkspace({ database: db.database, run: task, ...deps });
  await db.query('DELETE FROM conversations WHERE id=$1 AND owner_id=$2', [conversation, owner]);
  assert.equal((await db.query('SELECT id FROM workspace_heads WHERE id=$1', [conversation])).rowCount, 0);
  for (const key of deps.objects.keys()) assert.equal((await db.query('SELECT id FROM file_deletions WHERE object_key=$1', [key])).rowCount, 1);
});
