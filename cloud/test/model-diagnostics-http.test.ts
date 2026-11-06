import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import test, { after, before, beforeEach } from 'node:test';

import { Pool, type PoolClient, type QueryResultRow } from 'pg';

import { createSessionToken, hashSessionToken, sessionExpiry } from '../src/cloud/auth/service.ts';
import { loadConfig } from '../src/config.ts';
import { initializeDatabase, type Database } from '../src/infra/db.ts';
import { seal } from '../src/infra/crypto.ts';
import type { ModelRequest, ModelRequestInit } from '../src/platform/model-request.ts';
import { createServer } from '../src/server.ts';
import type { Storage } from '../src/platform/storage.ts';
import type { RouteDependencies } from '../src/transport/http/routes.ts';

type UpstreamCall = { url: URL; init: ModelRequestInit };

const databaseUrl = process.env.TEST_DATABASE_URL;
const integration = databaseUrl ? test : test.skip;
const config = loadConfig({
  DATABASE_URL: databaseUrl ?? 'postgres://unused/unused_test',
  PUBLIC_ORIGIN: 'http://localhost:8080',
  ENCRYPTION_KEY: 'a'.repeat(64),
  SANDBOX_DOMAIN: 'http://localhost:8090',
  SANDBOX_API_KEY: 'test',
  MODEL_ALLOWED_HOSTS: 'api.openai.com,models-a.example.test,models-b.example.test',
});

const storage: Storage = {
  async put() { throw new Error('Unexpected storage write'); },
  async get() { throw new Error('Unexpected storage read'); },
  async remove() { throw new Error('Unexpected storage deletion'); },
  async ready() {},
};

let pool: Pool;
let database: Database;
let server: ReturnType<typeof createServer>;
let baseUrl = '';
let upstreamCalls: UpstreamCall[] = [];
let upstreamResults: Array<{ status: number; body: unknown }> = [];

const modelRequest: ModelRequest = async (url, init) => {
  upstreamCalls.push({
    url: new URL(url),
    init: { ...init, headers: { ...init.headers } },
  });
  const result = upstreamResults.shift();
  if (!result) throw new Error('Unexpected model request');
  return result;
};

before(async () => {
  if (!databaseUrl) return;
  assert.equal(
    new URL(databaseUrl).pathname,
    '/picoddy_cloud_cas_security_test',
    'Model diagnostics HTTP tests require the dedicated CAS security test database',
  );
  pool = new Pool({ connectionString: databaseUrl });
  database = {
    query<T extends QueryResultRow = QueryResultRow>(sql: string, values?: readonly unknown[]) {
      return pool.query<T>(sql, values ? [...values] : undefined);
    },
    async transaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const result = await fn(client);
        await client.query('COMMIT');
        return result;
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    },
  };
  await initializeDatabase(pool);
  const dependencies: RouteDependencies = {
    database,
    storage,
    modelRequest,
  };
  server = createServer(config, dependencies);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

beforeEach(async () => {
  if (!databaseUrl) return;
  await pool.query('TRUNCATE users CASCADE');
  upstreamCalls = [];
  upstreamResults = [];
});

after(async () => {
  if (!databaseUrl) return;
  if (server) {
    server.close();
    await once(server, 'close');
  }
  if (pool) await pool.end();
});

async function createAuthenticatedOwner(label: string): Promise<{ ownerId: string; cookie: string }> {
  const subject = `${label}-${randomUUID()}`;
  const user = await pool.query<{ id: string }>(
    `INSERT INTO users(provider,subject,email,name)
     VALUES('cas',$1,$2,$3) RETURNING id`,
    [subject, `${subject}@example.test`, label],
  );
  const token = createSessionToken();
  await pool.query(
    'INSERT INTO sessions(owner_id,token_hash,expires_at) VALUES($1,$2,$3)',
    [user.rows[0].id, hashSessionToken(token), sessionExpiry()],
  );
  return { ownerId: user.rows[0].id, cookie: `picoddy_session=${encodeURIComponent(token)}` };
}

async function createSavedModel(input: {
  ownerId: string;
  apiKey: string;
  provider?: string;
  model?: string;
  baseUrl?: string;
}): Promise<string> {
  const id = randomUUID();
  await pool.query(
    `INSERT INTO resources(id,owner_id,kind,name,data,secret)
     VALUES($1,$2,'model',$3,$4::jsonb,$5)`,
    [
      id,
      input.ownerId,
      input.model ?? 'gpt-4.1-mini',
      JSON.stringify({
        provider: input.provider ?? 'openai',
        model: input.model ?? 'gpt-4.1-mini',
        ...(input.baseUrl ? { baseUrl: input.baseUrl } : {}),
        isDefault: false,
      }),
      seal({ apiKey: input.apiKey }, config.encryptionKey),
    ],
  );
  return id;
}

function catalogResult(id = 'gpt-4.1-mini') {
  return { status: 200, body: { data: [{ id }] } };
}

async function post(
  path: string,
  body: Record<string, unknown>,
  cookie?: string,
  origin = config.publicOrigin,
): Promise<Response> {
  return fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: {
      Origin: origin,
      'Content-Type': 'application/json',
      ...(cookie ? { Cookie: cookie } : {}),
    },
    body: JSON.stringify(body),
  });
}

async function payload(response: Response): Promise<any> {
  return response.json() as Promise<any>;
}

integration('model diagnostics require both an authenticated session and the trusted Origin', async () => {
  upstreamResults.push(catalogResult());
  const unauthenticated = await post('/api/providers/openai/models', { apiKey: 'temporary-key' });
  assert.equal(unauthenticated.status, 401);

  const owner = await createAuthenticatedOwner('origin-owner');
  const wrongOrigin = await post(
    '/api/providers/openai/models',
    { apiKey: 'temporary-key' },
    owner.cookie,
    'https://evil.example.test',
  );
  assert.equal(wrongOrigin.status, 403);
  assert.equal(upstreamCalls.length, 0);

  const accepted = await post(
    '/api/providers/openai/models',
    { apiKey: 'temporary-key' },
    owner.cookie,
  );
  assert.equal(accepted.status, 200);
  assert.equal((await payload(accepted)).data.ok, true);
  assert.equal(upstreamCalls.length, 1);
  assert.equal(upstreamCalls[0].url.toString(), 'https://api.openai.com/v1/models');
  assert.equal(upstreamCalls[0].init.method, 'GET');
  assert.equal(upstreamCalls[0].init.headers.authorization, 'Bearer temporary-key');
  assert.equal((await pool.query("SELECT count(*)::int AS count FROM resources WHERE kind='model'")).rows[0].count, 0);
});

integration('saved credentials remain owner scoped and a foreign resource is concealed with 404', async () => {
  const owner = await createAuthenticatedOwner('owner');
  const foreign = await createAuthenticatedOwner('foreign');
  const ownedResource = await createSavedModel({ ownerId: owner.ownerId, apiKey: 'owned-key' });
  const foreignResource = await createSavedModel({ ownerId: foreign.ownerId, apiKey: 'foreign-key' });

  upstreamResults.push(catalogResult('owned-model'));
  const owned = await post('/api/providers/openai/models', { resourceId: ownedResource }, owner.cookie);
  assert.equal(owned.status, 200);
  assert.equal(upstreamCalls[0].init.headers.authorization, 'Bearer owned-key');
  assert.doesNotMatch(JSON.stringify(await payload(owned)), /owned-key|foreign-key/);

  const concealed = await post('/api/providers/openai/models', {
    resourceId: foreignResource,
    apiKey: 'must-not-bypass-ownership',
  }, owner.cookie);
  assert.equal(concealed.status, 404);
  assert.equal(upstreamCalls.length, 1);

  upstreamResults.push(catalogResult('foreign-model'));
  const foreignOwned = await post('/api/providers/openai/models', { resourceId: foreignResource }, foreign.cookie);
  assert.equal(foreignOwned.status, 200);
  assert.equal(upstreamCalls[1].init.headers.authorization, 'Bearer foreign-key');
});

integration('the implicit provider endpoint never borrows a key saved for a custom endpoint', async () => {
  const owner = await createAuthenticatedOwner('custom-owner');
  const resourceId = await createSavedModel({
    ownerId: owner.ownerId,
    apiKey: 'custom-endpoint-key',
    baseUrl: 'https://models-a.example.test/v1',
  });

  const implicit = await post('/api/providers/openai/models', {}, owner.cookie);
  assert.equal(implicit.status, 400);
  assert.equal(upstreamCalls.length, 0);
  assert.doesNotMatch(JSON.stringify(await payload(implicit)), /custom-endpoint-key/);

  upstreamResults.push(catalogResult());
  const explicit = await post('/api/providers/openai/models', { resourceId }, owner.cookie);
  assert.equal(explicit.status, 200);
  assert.equal(upstreamCalls[0].url.toString(), 'https://models-a.example.test/v1/models');
  assert.equal(upstreamCalls[0].init.headers.authorization, 'Bearer custom-endpoint-key');
});

integration('a saved key cannot be redirected by overriding its resource endpoint', async () => {
  const owner = await createAuthenticatedOwner('endpoint-owner');
  const resourceId = await createSavedModel({
    ownerId: owner.ownerId,
    apiKey: 'endpoint-bound-key',
    baseUrl: 'https://models-a.example.test/v1',
  });

  const response = await post('/api/providers/openai/models', {
    resourceId,
    baseUrl: 'https://models-b.example.test/v1',
  }, owner.cookie);
  assert.equal(response.status, 400);
  assert.equal(upstreamCalls.length, 0);
  assert.doesNotMatch(JSON.stringify(await payload(response)), /endpoint-bound-key/);
});

integration('ambiguous saved credentials require an explicit resource selection', async () => {
  const owner = await createAuthenticatedOwner('ambiguous-owner');
  const first = await createSavedModel({ ownerId: owner.ownerId, apiKey: 'first-key' });
  await createSavedModel({ ownerId: owner.ownerId, apiKey: 'second-key', model: 'gpt-4.1' });

  const ambiguous = await post('/api/providers/openai/models', {}, owner.cookie);
  assert.equal(ambiguous.status, 409);
  assert.equal(upstreamCalls.length, 0);

  upstreamResults.push(catalogResult());
  const selected = await post('/api/providers/openai/models', { resourceId: first }, owner.cookie);
  assert.equal(selected.status, 200);
  assert.equal(upstreamCalls.length, 1);
  assert.equal(upstreamCalls[0].init.headers.authorization, 'Bearer first-key');
});

integration('connection testing succeeds only for a structurally valid inference response', async () => {
  const owner = await createAuthenticatedOwner('connection-owner');
  const resourceId = await createSavedModel({ ownerId: owner.ownerId, apiKey: 'connection-key' });

  upstreamResults.push({
    status: 200,
    body: {
      choices: [{
        message: { role: 'assistant', content: 'OK' },
        finish_reason: 'stop',
      }],
    },
  });
  const succeeded = await post('/api/settings/test-connection', {
    provider: 'openai',
    resourceId,
    modelId: 'gpt-4.1-mini',
  }, owner.cookie);
  assert.equal(succeeded.status, 200);
  const successBody = await payload(succeeded);
  assert.equal(successBody.data.ok, true);
  assert.equal(typeof successBody.data.latencyMs, 'number');
  assert.equal(upstreamCalls[0].url.toString(), 'https://api.openai.com/v1/chat/completions');
  assert.equal(upstreamCalls[0].init.method, 'POST');
  assert.equal(upstreamCalls[0].init.headers.authorization, 'Bearer connection-key');
  const requestBody = JSON.parse(upstreamCalls[0].init.body ?? '{}');
  assert.equal(requestBody.model, 'gpt-4.1-mini');
  assert.ok(Array.isArray(requestBody.messages));

  upstreamResults.push({
    status: 401,
    body: { error: { message: 'SENSITIVE_UPSTREAM_AUTH_FAILURE' } },
  });
  const rejected = await post('/api/settings/test-connection', {
    provider: 'openai',
    resourceId,
    modelId: 'gpt-4.1-mini',
  }, owner.cookie);
  assert.equal(rejected.status, 200);
  const rejectedText = await rejected.text();
  assert.doesNotMatch(rejectedText, /SENSITIVE_UPSTREAM_AUTH_FAILURE|connection-key/);
  const rejectedBody = JSON.parse(rejectedText);
  assert.equal(rejectedBody.data.ok, false);
  assert.match(rejectedBody.data.error, /API Key|账号状态/);

  upstreamResults.push({ status: 200, body: { choices: [] } });
  const malformed = await post('/api/settings/test-connection', {
    provider: 'openai',
    resourceId,
    modelId: 'gpt-4.1-mini',
  }, owner.cookie);
  assert.equal(malformed.status, 200);
  const malformedBody = await payload(malformed);
  assert.equal(malformedBody.data.ok, false);
  assert.match(malformedBody.data.error, /响应格式/);
});
