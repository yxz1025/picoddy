import assert from "node:assert/strict";
import test from "node:test";

import { seal, unseal } from "../src/infra/crypto.ts";
import type { Database } from "../src/infra/db.ts";
import {
  createMcpOAuthService,
  getAuthorizedConnector,
  type OAuthRunner,
} from "../src/domains/connector/node/oauth.ts";
import type { Config } from "../src/config.ts";

const encryptionKey = "0123456789abcdef0123456789abcdef";
const ownerId = "11111111-1111-4111-8111-111111111111";
const sessionId = "22222222-2222-4222-8222-222222222222";
const connectorId = "33333333-3333-4333-8333-333333333333";

function fixture() {
  const row = {
    id: connectorId,
    owner_id: ownerId,
    name: "remote",
    data: {
      transport: "http",
      url: "https://mcp.example.test/rpc",
      revision: "44444444-4444-4444-8444-444444444444",
      oauth: { enabled: true, clientId: "registered", scope: "tools:read" },
    },
    secret: seal({ headers: { "X-Tenant": "one" }, oauthClientSecret: "client-secret" }, encryptionKey),
  };
  let sessionValid = true;
  const query = async (sql: string, values: readonly unknown[] = []) => {
    if (sql.includes("FROM resources r") && sql.includes("FOR UPDATE")) {
      const matches = values.includes(connectorId) && values.includes(ownerId) && sessionValid;
      return { rows: matches ? [{ ...row, session_valid: true }] : [], rowCount: matches ? 1 : 0 };
    }
    if (sql.startsWith("UPDATE resources SET secret=")) {
      row.secret = values[0] as string;
      return { rows: [{ id: connectorId }], rowCount: 1 };
    }
    if (sql.startsWith('UPDATE resources SET data=$1')) {
      row.data = JSON.parse(values[0] as string);
      return { rows: [{ id: connectorId }], rowCount: 1 };
    }
    if (sql.includes("data=data-'connection'")) {
      delete (row.data as Record<string, unknown>).connection;
      return { rows: [{ id: connectorId }], rowCount: 1 };
    }
    throw new Error(`Unexpected SQL: ${sql}`);
  };
  const database = { query, transaction: async (fn: any) => fn({ query }) } as Database;
  const calls: Array<{ operation: string; state?: string; code?: string }> = [];
  const runner: OAuthRunner = async (request) => {
    calls.push({ operation: request.operation, state: request.state, code: request.authorizationCode });
    if (request.operation === "begin") {
      return {
        authorizationUrl: `https://login.example.test/authorize?state=${encodeURIComponent(request.state!)}`,
        state: {
          clientInformation: { client_id: "registered", client_secret: "client-secret" },
          codeVerifier: `verifier-${calls.length}`,
          discovery: { authorizationServerUrl: "https://login.example.test" },
        },
      };
    }
    if (request.operation === "exchange") {
      return {
        state: {
          ...request.providerState,
          tokens: { access_token: "access", refresh_token: "refresh", token_type: "Bearer", expires_in: 3600 },
          tokenExpiresAt: Date.now() + 3_600_000,
        },
      };
    }
    throw new Error("Unexpected runner operation");
  };
  const service = createMcpOAuthService({
    database,
    config: {
      encryptionKey,
      publicOrigin: "https://cloud.example.test",
    },
    ownerId,
    sessionId,
    runOAuth: runner,
  });
  return { service, row, calls, invalidateSession: () => { sessionValid = false; } };
}

test("OAuth begin supersedes the prior challenge and callback consumes state once", async () => {
  const f = fixture();
  const first = await f.service.begin(connectorId);
  const second = await f.service.begin(connectorId);
  assert.equal(first.state, "authorizing");
  assert.equal(second.state, "authorizing");
  assert.notEqual(first.url, second.url);

  const firstState = new URL(first.url!).searchParams.get("state")!;
  const secondState = new URL(second.url!).searchParams.get("state")!;
  await assert.rejects(f.service.callback({ state: firstState, code: "old-code" }), (error: any) =>
    error?.code === "MCP_OAUTH_STATE_INVALID");

  await f.service.callback({ state: secondState, code: "new-code" });
  await assert.rejects(f.service.callback({ state: secondState, code: "replay" }), (error: any) =>
    error?.code === "MCP_OAUTH_STATE_INVALID");
  const saved = unseal(f.row.secret, encryptionKey) as any;
  assert.equal(saved.oauthState.tokens.access_token, "access");
  assert.equal(saved.oauthState.challenge, undefined);
  assert.deepEqual(f.calls.map((call) => call.operation), ["begin", "begin", "exchange"]);
});

test('authorization button enables standard OAuth and logout clears probe state', async () => {
  const f = fixture();
  const oldRevision = f.row.data.revision;
  delete (f.row.data as Record<string, unknown>).oauth;
  const login = await f.service.begin(connectorId);
  assert.equal(login.state, 'authorizing');
  assert.equal(f.row.data.oauth.enabled, true);
  assert.notEqual(f.row.data.revision, oldRevision);
  (f.row.data as Record<string, unknown>).connection = { status: 'connected' };
  await f.service.logout(connectorId);
  assert.equal((f.row.data as Record<string, unknown>).connection, undefined);
  const secret = unseal(f.row.secret, encryptionKey) as any;
  assert.equal(secret.oauthState.tokens, undefined);
});

test("OAuth interactive operations require the current owner session", async () => {
  const f = fixture();
  f.invalidateSession();
  await assert.rejects(f.service.begin(connectorId), (error: any) => error?.code === "MCP_CONNECTOR_NOT_FOUND");
  assert.equal(f.calls.length, 0);
});

test("provider denial consumes the matching challenge without erasing an older token", async () => {
  const f = fixture();
  const login = await f.service.begin(connectorId);
  const state = new URL(login.url!).searchParams.get("state")!;
  const before = unseal(f.row.secret, encryptionKey) as any;
  before.oauthState.tokens = { access_token: "older-token" };
  f.row.secret = seal(before, encryptionKey);
  await assert.rejects(
    f.service.callback({ state, error: "access_denied" }),
    (error: any) => error?.code === "MCP_OAUTH_DENIED",
  );
  const saved = unseal(f.row.secret, encryptionKey) as any;
  assert.equal(saved.oauthState.challenge, undefined);
  assert.equal(saved.oauthState.tokens.access_token, "older-token");
});

test("runtime authorization is owner scoped, revision fenced, and replaces Authorization case-insensitively", async () => {
  const data = {
    transport: "sse",
    url: "https://mcp.example.test/events",
    revision: "44444444-4444-4444-8444-444444444444",
    oauth: { enabled: true },
  };
  const row = {
    id: connectorId,
    owner_id: ownerId,
    name: "remote",
    data,
    secret: seal({
      headers: { authorization: "Basic stale", "X-Tenant": "one" },
      oauthState: {
        version: 1,
        generation: "55555555-5555-4555-8555-555555555555",
        tokens: { access_token: "token-value", token_type: "Bearer" },
      },
    }, encryptionKey),
  };
  const database = {
    query: async (sql: string, values: readonly unknown[] = []) => {
      assert.ok(sql.includes("r.owner_id=$2"));
      const found = values[0] === connectorId && values[1] === ownerId;
      return { rows: found ? [row] : [], rowCount: found ? 1 : 0 };
    },
    transaction: async (fn: any) => fn(database),
  } as unknown as Database;
  const config = { encryptionKey, publicOrigin: "https://cloud.example.test" } as Config;
  const connector = await getAuthorizedConnector(database, config, ownerId, connectorId, { ...data });
  assert.deepEqual(connector, {
    transport: "sse",
    url: "https://mcp.example.test/events",
    headers: { "X-Tenant": "one", Authorization: "Bearer token-value" },
  });
  await assert.rejects(
    getAuthorizedConnector(database, config, ownerId, connectorId, {
      ...data,
      revision: "66666666-6666-4666-8666-666666666666",
    }),
    (error: any) => error?.code === "MCP_CONNECTOR_CHANGED",
  );
});
