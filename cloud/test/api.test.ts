import assert from "node:assert/strict";
import { randomUUID, createHash } from 'node:crypto';
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import test, { after, before, beforeEach } from "node:test";

import { Pool, type PoolClient, type QueryResult, type QueryResultRow } from "pg";

import {
  createSessionToken,
  hashSessionToken,
  SESSION_COOKIE,
  sessionExpiry,
} from "../src/cloud/auth/service.ts";
import type { Config } from "../src/config.ts";
import type { Database } from "../src/infra/db.ts";
import { initializeDatabase } from "../src/infra/db.ts";
import { createServer } from "../src/server.ts";
import type { Storage } from "../src/platform/storage.ts";

const databaseUrl = process.env.TEST_DATABASE_URL;
const integrationTest = databaseUrl ? test : test.skip;
const origin = "http://cloud.example.test";

const config: Config = {
  databaseUrl: databaseUrl ?? "postgres://unused/unused_test",
  host: "127.0.0.1",
  port: 0,
  publicOrigin: origin,
  secureCookies: false,
  encryptionKey: "0123456789abcdef0123456789abcdef",
  casLoginUrl: "https://sso.example.test/cas/login",
  casExchangeUrl: "https://gateway.example.test/cas/exchange",
  skillHubBaseUrl: 'https://market.example.test',
  skillHubSecret: '',
  skillHubSecretFile: '/unused/skillhub-secret.enc',
  skillHubDownloadHosts: ['downloads.example.test'],
  sandboxDomain: "https://sandbox.example.test",
  sandboxApiKey: "sandbox-key",
  sandboxImage: "cloud-agent:latest",
  sandboxTimeoutSeconds: 900,
  storageDriver: "s3",
  storageLocalRoot: "/unused/local-storage",
  storageEndpoint: "https://storage.example.test",
  storageRegion: "us-east-1",
  storageBucket: "cloud-test",
  storageAccessKey: "access",
  storageSecretKey: "secret",
  maxUploadBytes: 1024 * 1024,
  workerConcurrency: 2,
  modelAllowedHosts: ["models.example.test", "api.openai.com"],
};

const objects = new Map<string, Uint8Array>();
const storage: Storage = {
  async put(key, bytes) {
    objects.set(key, new Uint8Array(bytes));
  },
  async get(key) {
    const bytes = objects.get(key);
    if (!bytes) throw new Error("missing test object");
    return new Uint8Array(bytes);
  },
  async remove(key) {
    objects.delete(key);
  },
  async ready() {},
};

let pool: Pool;
let database: Database;
let server: ReturnType<typeof createServer>;
let baseUrl = "";

before(async () => {
  if (!databaseUrl) return;
  const parsed = new URL(databaseUrl);
  assert.match(parsed.pathname, /test/i, "TEST_DATABASE_URL must identify a test database");
  pool = new Pool({ connectionString: databaseUrl });
  database = {
    query<T extends QueryResultRow = QueryResultRow>(sql: string, values?: readonly unknown[]) {
      return pool.query<T>(sql, values as unknown[] | undefined);
    },
    async transaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const result = await fn(client);
        await client.query("COMMIT");
        return result;
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    },
  } satisfies Database;
  await initializeDatabase(pool);
  server = createServer(config, { database, storage });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${address.port}`;
});

beforeEach(async () => {
  if (!databaseUrl) return;
  await pool.query(
    "TRUNCATE auth_challenges, sessions, approvals, events, messages, runs, files, skill_versions, conversations, resources, users RESTART IDENTITY CASCADE",
  );
  objects.clear();
});

after(async () => {
  if (!databaseUrl) return;
  server.close();
  await once(server, "close");
  await pool.end();
});

async function createUser(email: string, name: string): Promise<string> {
  const result = await pool.query<{ id: string }>(
    "INSERT INTO users (provider, subject, email, name) VALUES ('cas', $1, $1, $2) RETURNING id",
    [email, name],
  );
  return result.rows[0].id;
}

integrationTest('skill creator conversations persist their category and expose owner-scoped drafts', async () => {
  await createUser('creator@example.test', 'Creator');
  const cookie = await login('creator@example.test');
  const created = await request('/api/conversations', { method: 'POST', body: JSON.stringify({ title: 'Create skill', category: 'skill_creator' }) }, cookie);
  assert.equal(created.status, 201);
  const conversation = (await created.json()).data;
  assert.equal(conversation.category, 'skill_creator');
  const found = await request(`/api/skill-drafts/by-conversation/${conversation.id}`, {}, cookie);
  assert.equal(found.status, 200);
  const draft = (await found.json()).data;
  assert.equal(draft.conversationId, conversation.id);
  assert.equal((await request(`/api/skill-drafts/${draft.id}/install`, { method: 'POST', body: '{}' }, cookie)).status, 400);
  const invalidExpert = await request(`/api/conversations/${conversation.id}/runs`, {
    method: 'POST', body: JSON.stringify({ prompt: 'create', expertId: randomUUID(), idempotencyKey: 'invalid-expert' }),
  }, cookie);
  assert.equal(invalidExpert.status, 400);
  assert.equal((await invalidExpert.json()).error.code, 'EXPERT_CATEGORY_MISMATCH');
});

integrationTest('expert creator freezes an owner-scoped reference id without activating its prompt', async () => {
  const owner = await createUser('reference-owner@example.test', 'Reference Owner');
  const otherOwner = await createUser('reference-other@example.test', 'Reference Other');
  const cookie = await login('reference-owner@example.test');
  const ownedExpert = randomUUID();
  const foreignExpert = randomUUID();
  await pool.query(
    `INSERT INTO resources(id,owner_id,kind,name,data) VALUES
      ($1,$2,'expert','Owned reference',$3::jsonb),
      ($4,$5,'expert','Foreign reference',$6::jsonb)`,
    [
      ownedExpert,
      owner,
      JSON.stringify({ prompt: 'REFERENCE_PROMPT_MUST_NOT_ACTIVATE', skillIds: [] }),
      foreignExpert,
      otherOwner,
      JSON.stringify({ prompt: 'FOREIGN_REFERENCE', skillIds: [] }),
    ],
  );
  assert.equal((await request('/api/models', {
    method: 'POST',
    body: JSON.stringify({
      name: 'Test', provider: 'openai', model: 'gpt-test',
      baseUrl: 'https://models.example.test/v1', apiKey: 'test', isDefault: true,
    }),
  }, cookie)).status, 201);

  const creator = (await (await request('/api/conversations', {
    method: 'POST',
    body: JSON.stringify({ title: 'Create expert', category: 'expert_creator' }),
  }, cookie)).json()).data;
  const accepted = await request(`/api/conversations/${creator.id}/runs`, {
    method: 'POST',
    body: JSON.stringify({
      prompt: 'Use this expert as a reference',
      mode: 'craft',
      referenceExpertId: ownedExpert,
      idempotencyKey: 'owned-reference',
    }),
  }, cookie);
  assert.equal(accepted.status, 201);
  const run = (await accepted.json()).data;
  const frozen = await pool.query('SELECT selection FROM runs WHERE id=$1', [run.id]);
  assert.equal(frozen.rows[0].selection.referenceExpertId, ownedExpert);
  assert.equal(Object.hasOwn(frozen.rows[0].selection, 'expert'), false);
  assert.equal(frozen.rows[0].selection.referenceExpert.profile.prompt, 'REFERENCE_PROMPT_MUST_NOT_ACTIVATE');
  assert.equal(JSON.stringify(run.selection).includes('REFERENCE_PROMPT_MUST_NOT_ACTIVATE'), false);
  await pool.query("UPDATE resources SET data=jsonb_set(data,'{prompt}','\"Changed after submission\"'::jsonb) WHERE id=$1", [ownedExpert]);
  assert.equal((await pool.query('SELECT selection FROM runs WHERE id=$1',[run.id])).rows[0].selection.referenceExpert.profile.prompt, 'REFERENCE_PROMPT_MUST_NOT_ACTIVATE');
  assert.equal(run.selection.referenceExpertId, ownedExpert);

  await pool.query("UPDATE runs SET status='succeeded' WHERE id=$1", [run.id]);
  const foreign = await request(`/api/conversations/${creator.id}/runs`, {
    method: 'POST',
    body: JSON.stringify({
      prompt: 'Use a foreign expert', mode: 'craft',
      referenceExpertId: foreignExpert, idempotencyKey: 'foreign-reference',
    }),
  }, cookie);
  assert.equal(foreign.status, 400);
  assert.equal((await foreign.json()).error.code, 'INVALID_REFERENCE_EXPERT');

  const assistant = (await (await request('/api/conversations', {
    method: 'POST', body: JSON.stringify({ title: 'Assistant' }),
  }, cookie)).json()).data;
  const wrongCategory = await request(`/api/conversations/${assistant.id}/runs`, {
    method: 'POST',
    body: JSON.stringify({
      prompt: 'Reference is creator-only', referenceExpertId: ownedExpert,
      idempotencyKey: 'assistant-reference',
    }),
  }, cookie);
  assert.equal(wrongCategory.status, 400);
  assert.equal((await wrongCategory.json()).error.code, 'REFERENCE_EXPERT_CATEGORY_MISMATCH');
});

integrationTest('expert create, validate, publish and edit routes preserve creator identity and reject foreign access', async () => {
  await createUser('expert-creator@example.test', 'Creator');
  await createUser('expert-other@example.test', 'Other');
  const cookie=await login('expert-creator@example.test'), foreign=await login('expert-other@example.test');
  const created=await request('/api/conversations',{method:'POST',body:JSON.stringify({title:'Create expert',category:'expert_creator'})},cookie);
  assert.equal(created.status,201);
  const conversation=(await created.json()).data;
  assert.equal(conversation.expertOperation,'create');
  const draft=(await (await request(`/api/expert-drafts/by-conversation/${conversation.id}`,{},cookie)).json()).data;
  assert.deepEqual(draft.profile.tags,[]);
  assert.deepEqual(draft.profile.quickPrompts,[]);
  assert.equal(draft.profile.icon,'🤖');
  assert.equal(draft.profile.categoryId,'cloud');
  assert.equal((await request(`/api/expert-drafts/${draft.id}`,{},foreign)).status,404);
  const updated=await request(`/api/expert-drafts/${draft.id}`,{method:'PUT',body:JSON.stringify({expectedRevision:draft.revision,profile:{name:'Writer',prompt:'Write carefully',skillIds:[],description:'Private writer',tags:['writing','editing','proofreading'],quickPrompts:['Draft a note','Edit a draft','Check spelling'],icon:'✍️',categoryId:'private'}})},cookie);
  assert.equal(updated.status,200);
  const revision=(await updated.json()).data.revision;
  const validated=await request(`/api/expert-drafts/${draft.id}/validate`,{method:'POST',body:'{}'},cookie);
  assert.equal(validated.status,200);
  assert.equal((await validated.json()).data.valid,true);
  const published=await request(`/api/expert-drafts/${draft.id}/publish`,{method:'POST',body:JSON.stringify({expectedRevision:revision})},cookie);
  assert.equal(published.status,200);
  const expert=(await published.json()).data;
  const editing=await request(`/api/experts/${expert.expertId}/edit-session`,{method:'POST',body:'{}'},cookie);
  assert.equal(editing.status,201);
  const edit=(await editing.json()).data;
  assert.equal(edit.category,'expert_creator');
  assert.equal(edit.expertOperation,'edit');
  assert.equal(edit.expertTargetId,expert.expertId);
  assert.equal(edit.expertTargetRevision,expert.revision);
  assert.equal(edit.expertId,null);
  const reloaded=(await (await request(`/api/conversations/${edit.id}`,{},cookie)).json()).data;
  assert.equal(reloaded.expertOperation,'edit');
  const renamed=await request(`/api/conversations/${edit.id}`,{method:'PATCH',body:'{"title":"Renamed edit"}'},cookie);
  assert.equal(renamed.status,200);
  assert.equal((await renamed.json()).data.expertOperation,'edit');
  const list=(await (await request('/api/conversations',{},cookie)).json()).data;
  assert.equal(list.find((item:any)=>item.id===edit.id).expertOperation,'edit');
});

integrationTest('child approvals recover through parent but require the child run, and parent cancellation fences all children', async () => {
  const owner=await createUser('delegate@example.test','Delegate');
  await createUser('delegate-other@example.test','Other');
  const cookie=await login('delegate@example.test'), foreign=await login('delegate-other@example.test');
  const parent=randomUUID(), child=randomUUID(), queued=randomUUID(), approval=randomUUID(), conversation=randomUUID();
  await pool.query("INSERT INTO conversations(id,owner_id,title) VALUES($1,$2,'Parent')",[conversation,owner]);
  for(const [id,status,index] of [[parent,'running',null],[child,'waiting_approval',0],[queued,'queued',1]] as const){
    const convo=id===parent?conversation:randomUUID();
    if(id!==parent)await pool.query("INSERT INTO conversations(id,owner_id,title,parent_id) VALUES($1,$2,'Child',$3)",[convo,owner,conversation]);
    await pool.query(`INSERT INTO runs(id,owner_id,conversation_id,prompt,selection,idempotency_key,status,lease_token,lease_until,parent_run_id,parent_tool_call_id,child_index)
      VALUES($1::uuid,$2,$3,'test',$4::jsonb,($1::uuid)::text,$5,$6,now()+interval '1 hour',$7,$8,$9)`,[id,owner,convo,JSON.stringify({skills:[],connectors:[],files:[],runtimeProfile:{mode:'craft',category:'assistant'},permission:'full'}),status,randomUUID(),index===null?null:parent,index===null?null:'delegate',index]);
  }
  await pool.query("INSERT INTO approvals(id,owner_id,run_id,tool_call_id,tool,input) VALUES($1,$2,$3,'shell','bash','{}')",[approval,owner,child]);
  const list=(await (await request(`/api/runs/${parent}/approvals`,{},cookie)).json()).data;
  assert.equal(list[0].runId,child);
  const decision={method:'POST',body:'{"approved":true}'};
  assert.equal((await request(`/api/runs/${child}/approvals/${approval}`,decision,foreign)).status,404);
  assert.equal((await request(`/api/runs/${parent}/approvals/${approval}`,decision,cookie)).status,404);
  assert.equal((await request(`/api/runs/${child}/approvals/${approval}`,decision,cookie)).status,200);
  assert.equal((await pool.query("SELECT id FROM events WHERE run_id=$1 AND type='approval_decided'",[parent])).rowCount,1);
  assert.equal((await request(`/api/runs/${parent}/cancel`,{method:'POST',body:'{}'},cookie)).status,200);
  const rows=(await pool.query('SELECT id,status,cancel_requested FROM runs WHERE parent_run_id=$1',[parent])).rows;
  assert.ok(rows.every(row=>row.cancel_requested));
  assert.equal(rows.find(row=>row.id===queued).status,'cancelled');
  assert.equal(rows.find(row=>row.id===child).status,'cancelling');
  assert.equal((await request(`/api/runs/${child}/approvals/${approval}`,decision,cookie)).status,404);
});

integrationTest('bound expert uses latest configuration each turn and freezes accepted runs', async () => {
  const owner = await createUser('bound@example.test', 'Bound');
  const cookie = await login('bound@example.test');
  const expert = randomUUID();
  await pool.query("INSERT INTO resources(id,owner_id,kind,name,data) VALUES($1,$2,'expert','Writer',$3::jsonb)",
    [expert, owner, JSON.stringify({ prompt: 'version one', skillIds: [] })]);
  const model = await request('/api/models', { method: 'POST', body: JSON.stringify({
    name: 'Test', provider: 'openai', model: 'gpt-test', baseUrl: 'https://models.example.test/v1', apiKey: 'test', isDefault: true,
  }) }, cookie);
  assert.equal(model.status, 201);
  const conversation = (await (await request('/api/conversations', { method: 'POST', body: '{"title":"Bound"}' }, cookie)).json()).data;
  const path = `/api/conversations/${conversation.id}`;
  assert.equal((await request(`${path}/expert`, { method: 'PUT', body: JSON.stringify({ expertId: expert }) }, cookie)).status, 200);
  for (const version of ['one', 'two']) {
    await pool.query("UPDATE resources SET data=jsonb_set(data,'{prompt}',$2::jsonb) WHERE id=$1", [expert, JSON.stringify(`version ${version}`)]);
    const accepted = await request(`${path}/runs`, { method: 'POST', body: JSON.stringify({ prompt: 'write', idempotencyKey: version }) }, cookie);
    assert.equal(accepted.status, 201);
    const run = (await accepted.json()).data;
    const frozen = await pool.query('SELECT selection FROM runs WHERE id=$1', [run.id]);
    assert.equal(frozen.rows[0].selection.expert.data.prompt, `version ${version}`);
    await pool.query("UPDATE runs SET status='succeeded' WHERE id=$1", [run.id]);
  }
  const snapshots = await pool.query('SELECT selection FROM runs WHERE owner_id=$1 ORDER BY created_at', [owner]);
  assert.deepEqual(snapshots.rows.map(row => row.selection.expert.data.prompt), ['version one', 'version two']);
});

integrationTest('workspace file APIs conceal foreign owners and internal keys and serve bounded content', async () => {
  const owner = await createUser('workspace-owner@example.test', 'Owner');
  await createUser('workspace-other@example.test', 'Other');
  const cookie = await login('workspace-owner@example.test'), other = await login('workspace-other@example.test');
  const scope = randomUUID(), version = randomUUID();
  const key = `users/${owner}/workspaces/${scope}/${version}/file`;
  const bytes = Buffer.from('hello');
  const manifest = [{ path: 'work/hello.txt', size: 5, sha256: createHash('sha256').update(bytes).digest('hex'), objectKey: key }];
  objects.set(key, bytes);
  await pool.query("INSERT INTO conversations(id,owner_id,title) VALUES($1,$2,'files')", [scope, owner]);
  await pool.query('INSERT INTO workspace_heads(id,owner_id,conversation_id,revision,manifest) VALUES($1,$2,$1,1,$3::jsonb)', [scope, owner, JSON.stringify(manifest)]);
  await pool.query("INSERT INTO workspace_versions(id,owner_id,scope_id,expected_revision,committed_revision,status,manifest) VALUES($1,$2,$3,0,1,'committed',$4::jsonb)", [version, owner, scope, JSON.stringify(manifest)]);
  const path = `/api/workspace-files/${scope}`;
  assert.equal((await request(path, {}, other)).status, 404);
  const list = await request(path, {}, cookie);
  assert.equal(list.status, 200);
  assert.equal(JSON.stringify(await list.json()).includes('objectKey'), false);
  const content = await request(`${path}/content?path=work%2Fhello.txt`, { headers: { Range: 'bytes=1-3' } }, cookie);
  assert.equal(content.status, 206); assert.equal(await content.text(), 'ell');
  assert.equal((await request(`${path}/content?path=work%2Fhello.txt`, {}, other)).status, 404);
  assert.equal((await request(`${path}/versions`, {}, cookie)).status, 200);
  assert.equal((await request(`${path}/restore`, { method: 'POST', body: JSON.stringify({ versionId: version, expectedRevision: 0 }) }, cookie)).status, 409);
  assert.equal((await request(`${path}/restore`, { method: 'POST', body: JSON.stringify({ versionId: version, expectedRevision: 1 }) }, cookie)).status, 200);
});

async function request(
  path: string,
  init: RequestInit = {},
  cookie?: string,
): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set("Origin", origin);
  if (init.body) headers.set("Content-Type", "application/json");
  if (cookie) headers.set("Cookie", cookie);
  return fetch(`${baseUrl}${path}`, { ...init, headers });
}

async function login(email: string): Promise<string> {
  const user = await pool.query<{ id: string }>(
    "SELECT id FROM users WHERE provider='cas' AND subject=$1 AND disabled_at IS NULL",
    [email],
  );
  assert.ok(user.rows[0], `Missing enabled test user ${email}`);
  const token = createSessionToken();
  await pool.query(
    "INSERT INTO sessions(owner_id,token_hash,expires_at) VALUES($1,$2,$3)",
    [user.rows[0].id, hashSessionToken(token), sessionExpiry()],
  );
  return `${SESSION_COOKIE}=${encodeURIComponent(token)}`;
}

async function readSseUpdate(response: Response): Promise<{ id: string; data: unknown }> {
  assert.ok(response.body);
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let text = "";
  while (text.length < 256_000) {
    const chunk = await reader.read();
    if (chunk.done) break;
    text += decoder.decode(chunk.value, { stream: true });
    for (const frame of text.split("\n\n")) {
      if (!frame.includes("event: update")) continue;
      const id = frame.match(/^id: (\d+)$/m)?.[1];
      const data = frame.match(/^data: (.+)$/m)?.[1];
      if (id && data) {
        await reader.cancel();
        return { id, data: JSON.parse(data) as unknown };
      }
    }
  }
  throw new Error("SSE update was not received");
}

integrationTest("sessions authenticate and tenant ownership is concealed with 404", async () => {
  await createUser("one@example.test", "One");
  await createUser("two@example.test", "Two");
  const one = await login("one@example.test");
  const two = await login("two@example.test");

  const created = await request(
    "/api/conversations",
    { method: "POST", body: JSON.stringify({ title: "Private" }) },
    one,
  );
  assert.equal(created.status, 201);
  const conversation = (await created.json() as { data: { id: string } }).data;

  const concealed = await request(`/api/conversations/${conversation.id}`, {}, two);
  assert.equal(concealed.status, 404);
});

integrationTest("expired sessions stop authenticating", async () => {
  await createUser("expired@example.test", "Expired");
  const cookie = await login("expired@example.test");
  await pool.query("UPDATE sessions SET expires_at=now()-interval '1 second'");

  const response = await request("/api/auth/me", {}, cookie);
  assert.equal(response.status, 401);
});

integrationTest("run submission fails clearly when no model is configured", async () => {
  await createUser("no-model@example.test", "No Model");
  const cookie = await login("no-model@example.test");
  const conversationResponse = await request(
    "/api/conversations",
    { method: "POST", body: JSON.stringify({ title: "No model" }) },
    cookie,
  );
  const conversation = (await conversationResponse.json() as { data: { id: string } }).data;

  const response = await request(
    `/api/conversations/${conversation.id}/runs`,
    {
      method: "POST",
      body: JSON.stringify({
        prompt: "This must not queue",
        skillIds: [], connectorIds: [], fileIds: [], idempotencyKey: "no-model",
      }),
    },
    cookie,
  );
  assert.equal(response.status, 400);
  assert.equal((await response.json() as { error: { code: string } }).error.code, "MODEL_REQUIRED");
});

integrationTest("run submission stores Pi content, deduplicates, and enforces one active run", async () => {
  const ownerId = await createUser("runner@example.test", "Runner");
  const cookie = await login("runner@example.test");
  const preferences = await request(
    "/api/preferences",
    {
      method: "PATCH",
      body: JSON.stringify({ agentSystemPrompt: "Use frozen terminology", language: "zh-CN" }),
    },
    cookie,
  );
  assert.equal(preferences.status, 200);
  const modelResponse = await request(
    "/api/models",
    {
      method: "POST",
      body: JSON.stringify({
        name: "Test model",
        provider: "openai",
        model: "gpt-test",
        baseUrl: "https://models.example.test/v1",
        apiKey: "test-api-key",
        isDefault: true,
      }),
    },
    cookie,
  );
  assert.equal(modelResponse.status, 201);
  const conversationResponse = await request(
    "/api/conversations",
    { method: "POST", body: JSON.stringify({ title: "Run" }) },
    cookie,
  );
  const conversation = (await conversationResponse.json() as { data: { id: string } }).data;
  const body = {
    prompt: "Use the selected resources",
    skillIds: [],
    connectorIds: [],
    fileIds: [],
    idempotencyKey: "stable-client-key",
    mode: "plan",
    category: "assistant",
    permission: "readonly",
  };

  const first = await request(
    `/api/conversations/${conversation.id}/runs`,
    { method: "POST", body: JSON.stringify(body) },
    cookie,
  );
  assert.equal(first.status, 201);
  const firstRun = (await first.json() as {
    data: { id: string; selection: Record<string, unknown> };
  }).data;
  assert.deepEqual(firstRun.selection.runtimeProfile, { mode: "plan", category: "assistant" });
  assert.equal(firstRun.selection.permission, "readonly");
  const frozen = await pool.query<{ selection: {
    runtimeProfile: unknown;
    permission: unknown;
    settings: unknown;
  } }>("SELECT selection FROM runs WHERE id=$1 AND owner_id=$2", [firstRun.id, ownerId]);
  assert.deepEqual(
    frozen.rows[0]?.selection.runtimeProfile,
    { mode: "plan", category: "assistant" },
  );
  assert.equal(frozen.rows[0]?.selection.permission, "readonly");
  assert.deepEqual(
    frozen.rows[0]?.selection.settings,
    { customInstructions: "Use frozen terminology", language: "zh-CN" },
  );

  const duplicate = await request(
    `/api/conversations/${conversation.id}/runs`,
    { method: "POST", body: JSON.stringify(body) },
    cookie,
  );
  assert.equal(duplicate.status, 200);
  assert.equal((await duplicate.json() as { data: { id: string } }).data.id, firstRun.id);

  const competing = await request(
    `/api/conversations/${conversation.id}/runs`,
    { method: "POST", body: JSON.stringify({ ...body, idempotencyKey: "second-key" }) },
    cookie,
  );
  assert.equal(competing.status, 409);

  const blockedConversationDelete = await request(
    `/api/conversations/${conversation.id}`,
    { method: "DELETE" },
    cookie,
  );
  assert.equal(blockedConversationDelete.status, 409);

  await pool.query(
    `UPDATE runs SET selection=jsonb_set(selection,'{skills}',$2::jsonb)
      WHERE id=$1`,
    [firstRun.id, JSON.stringify([{
      id: "11111111-1111-4111-8111-111111111111",
      name: "Private skill",
      version: "digest",
      files: [{ path: "SKILL.md", contentBase64: "PRIVATE_SKILL_BYTES" }],
    }])],
  );
  const runList = await request(`/api/runs?conversationId=${conversation.id}`, {}, cookie);
  const runListText = await runList.text();
  assert.equal(runList.status, 200);
  assert.doesNotMatch(runListText, /PRIVATE_SKILL_BYTES|contentBase64|"secret"/);
  const runDetail = await request(`/api/runs/${firstRun.id}`, {}, cookie);
  assert.doesNotMatch(await runDetail.text(), /PRIVATE_SKILL_BYTES|contentBase64|"secret"/);

  await pool.query(
    `INSERT INTO approvals(owner_id,run_id,tool_call_id,tool,input)
     VALUES($1,$2,'call-1','bash','{}'::jsonb)`,
    [ownerId, firstRun.id],
  );
  const approvals = await request(`/api/runs/${firstRun.id}/approvals`, {}, cookie);
  const approvalRows = (await approvals.json() as { data: Array<{ runId: string }> }).data;
  assert.equal(approvalRows[0].runId, firstRun.id);

  const cancelled = await request(`/api/runs/${firstRun.id}/cancel`, { method: "POST" }, cookie);
  const cancelledText = await cancelled.text();
  assert.equal(cancelled.status, 200);
  assert.doesNotMatch(cancelledText, /PRIVATE_SKILL_BYTES|contentBase64|"secret"/);

  const messages = await request(`/api/conversations/${conversation.id}/messages`, {}, cookie);
  const rows = (await messages.json() as {
    data: Array<{ role: string; content: Array<{ type: string; text: string }> }>;
  }).data;
  assert.equal(rows.length, 1);
  assert.equal(rows[0].role, "user");
  assert.deepEqual(rows[0].content, [{ type: "text", text: body.prompt }]);
  assert.match(String((rows[0] as { id?: unknown }).id), /^[0-9a-f-]{36}$/i);
  assert.ok((rows[0] as { createdAt?: unknown }).createdAt);

  const deletedConversation = await request(
    `/api/conversations/${conversation.id}`,
    { method: "DELETE" },
    cookie,
  );
  assert.equal(deletedConversation.status, 204);
});

integrationTest("resource secrets never round-trip and model URLs use the allowlist", async () => {
  await createUser("resource@example.test", "Resource");
  const cookie = await login("resource@example.test");

  const blocked = await request(
    "/api/models",
    {
      method: "POST",
      body: JSON.stringify({
        name: "Blocked",
        provider: "openai",
        model: "gpt-test",
        baseUrl: "http://169.254.169.254/latest",
        apiKey: "must-not-leak",
      }),
    },
    cookie,
  );
  assert.equal(blocked.status, 400);

  const created = await request(
    "/api/models",
    {
      method: "POST",
      body: JSON.stringify({
        name: "Allowed",
        provider: "openai",
        model: "gpt-test",
        baseUrl: "https://models.example.test/v1",
        apiKey: "must-not-leak",
      }),
    },
    cookie,
  );
  assert.equal(created.status, 201);
  const text = await created.text();
  assert.doesNotMatch(text, /must-not-leak/);
  const createdModel = JSON.parse(text).data as { id: string; apiKeyConfigured: boolean };
  assert.equal(createdModel.apiKeyConfigured, true);

  const perSecondAutomation = await request(
    "/api/automations",
    {
      method: "POST",
      body: JSON.stringify({
        name: "Too frequent",
        prompt: "Run",
        cron: "*/5 * * * * *",
        timezone: "UTC",
        skillIds: [],
        connectorIds: [],
        modelId: createdModel.id,
        enabled: true,
      }),
    },
    cookie,
  );
  assert.equal(perSecondAutomation.status, 400);
  assert.equal(
    (await perSecondAutomation.json() as { error: { code: string } }).error.code,
    "INVALID_SCHEDULE",
  );
});

integrationTest('workspace bindings and memories are owner-scoped without project aliases', async () => {
  await createUser('space-one@example.test', 'One');
  await createUser('space-two@example.test', 'Two');
  const one = await login('space-one@example.test');
  const two = await login('space-two@example.test');
  const created = await request('/api/workspaces', { method: 'POST', body: JSON.stringify({ name: 'Private space' }) }, one);
  assert.equal(created.status, 201);
  const { data: space } = await created.json() as { data: { id: string } };
  const conversation = await request('/api/conversations', { method: 'POST', body: JSON.stringify({ title: 'Work', workspaceId: space.id }) }, one);
  assert.equal(conversation.status, 201);
  const { data: session } = await conversation.json() as { data: { workspaceId: string } };
  assert.equal(session.workspaceId, space.id);
  assert.equal(Object.hasOwn(session, 'projectId'), false);
  const inUse = await request(`/api/workspaces/${space.id}`, { method: 'DELETE' }, one);
  assert.equal(inUse.status, 409);
  assert.equal((await inUse.json() as { error: { code: string } }).error.code, 'WORKSPACE_IN_USE');
  const foreign = await request('/api/conversations', { method: 'POST', body: JSON.stringify({ title: 'Foreign', workspaceId: space.id }) }, two);
  assert.equal(foreign.status, 400);
  const memory = await request('/api/memories', { method: 'POST', body: JSON.stringify({ title: 'Private', content: 'Decision', workspaceId: space.id }) }, two);
  assert.equal(memory.status, 400);
  assert.equal((await request('/api/projects', {}, one)).status, 404);
});

integrationTest("files are owner-scoped and downloaded as attachments", async () => {
  await createUser("file@example.test", "File");
  const cookie = await login("file@example.test");
  const created = await request(
    "/api/files",
    {
      method: "POST",
      body: JSON.stringify({
        name: "report.html",
        mimeType: "text/html",
        contentBase64: Buffer.from("<script>unsafe()</script>").toString("base64"),
      }),
    },
    cookie,
  );
  assert.equal(created.status, 201);
  const file = (await created.json() as { data: { id: string } }).data;

  const downloaded = await request(`/api/files/${file.id}/download`, {}, cookie);
  assert.equal(downloaded.status, 200);
  assert.match(downloaded.headers.get("content-disposition") ?? "", /^attachment;/);
  assert.equal(downloaded.headers.get("x-content-type-options"), "nosniff");
  const inline = await request(`/api/files/${file.id}/content`, { headers: { Range: 'bytes=0-6' } }, cookie);
  assert.equal(inline.status, 206);
  assert.equal(inline.headers.get('content-type'), 'text/plain; charset=utf-8');
  assert.equal(inline.headers.get('content-range'), 'bytes 0-6/25');
  assert.equal(await inline.text(), '<script');
  const invalidRange = await request(`/api/files/${file.id}/content`, { headers: { Range: 'bytes=100-' } }, cookie);
  assert.equal(invalidRange.status, 416);
  assert.equal(invalidRange.headers.get('content-range'), 'bytes */25');
  const head = await request(`/api/files/${file.id}/content`, { method: 'HEAD' }, cookie);
  assert.equal(head.status, 200);
  assert.equal(head.headers.get('content-length'), '25');
  assert.equal(await head.text(), '');
  assert.equal((await request(`/api/files/${file.id}/content`)).status, 401);
  await createUser('file-other@example.test', 'Other');
  const otherCookie = await login('file-other@example.test');
  assert.equal((await request(`/api/files/${file.id}/content`, {}, otherCookie)).status, 404);

  const model = await request(
    "/api/models",
    {
      method: "POST",
      body: JSON.stringify({
        name: "File model", provider: "openai", model: "gpt-test",
        baseUrl: "https://models.example.test/v1", apiKey: "test-key", isDefault: true,
      }),
    },
    cookie,
  );
  assert.equal(model.status, 201);
  const conversationResponse = await request(
    "/api/conversations",
    { method: "POST", body: JSON.stringify({ title: "File run" }) },
    cookie,
  );
  const conversation = (await conversationResponse.json() as { data: { id: string } }).data;
  const run = await request(
    `/api/conversations/${conversation.id}/runs`,
    {
      method: "POST",
      body: JSON.stringify({
        prompt: "Read the file", skillIds: [], connectorIds: [], fileIds: [file.id],
        idempotencyKey: "file-run",
      }),
    },
    cookie,
  );
  assert.equal(run.status, 201);
  const blockedDelete = await request(`/api/files/${file.id}`, { method: "DELETE" }, cookie);
  assert.equal(blockedDelete.status, 409);
  assert.equal(objects.size, 1);
});

integrationTest("SSE resumes after the Last-Event-ID cursor", { timeout: 10_000 }, async () => {
  const ownerId = await createUser("events@example.test", "Events");
  const cookie = await login("events@example.test");
  const model = await request(
    "/api/models",
    {
      method: "POST",
      body: JSON.stringify({
        name: "Events model", provider: "openai", model: "gpt-test",
        baseUrl: "https://models.example.test/v1", apiKey: "test-key", isDefault: true,
      }),
    },
    cookie,
  );
  assert.equal(model.status, 201);
  const conversationResponse = await request(
    "/api/conversations",
    { method: "POST", body: JSON.stringify({ title: "Events" }) },
    cookie,
  );
  const conversation = (await conversationResponse.json() as { data: { id: string } }).data;
  const runResponse = await request(
    `/api/conversations/${conversation.id}/runs`,
    {
      method: "POST",
      body: JSON.stringify({
        prompt: "Stream", skillIds: [], connectorIds: [], fileIds: [], idempotencyKey: "events-run",
      }),
    },
    cookie,
  );
  const run = (await runResponse.json() as { data: { id: string } }).data;

  const firstResponse = await request(`/api/runs/${run.id}/events?after=0`, {}, cookie);
  assert.equal(firstResponse.status, 200);
  const first = await readSseUpdate(firstResponse);
  await pool.query(
    "INSERT INTO events(owner_id,run_id,type,payload) VALUES($1,$2,'test',$3::jsonb)",
    [ownerId, run.id, JSON.stringify({ sequence: 2 })],
  );

  const resumedResponse = await request(
    `/api/runs/${run.id}/events`,
    { headers: { "Last-Event-ID": first.id } },
    cookie,
  );
  const resumed = await readSseUpdate(resumedResponse);
  assert.ok(BigInt(resumed.id) > BigInt(first.id));
  assert.deepEqual((resumed.data as { payload: unknown }).payload, { sequence: 2 });
});
