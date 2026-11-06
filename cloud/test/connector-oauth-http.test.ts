import assert from "node:assert/strict";
import test from "node:test";

import type { Config } from "../src/config.ts";
import type { Database } from "../src/infra/db.ts";
import { seal } from "../src/infra/crypto.ts";
import { handleMcpOAuthRoutes } from "../src/transport/http/mcp-oauth.ts";
import type { RequestContext } from "../src/transport/http/routes.ts";

test("OAuth status route returns only public authorization state", async () => {
  const ownerId = "11111111-1111-4111-8111-111111111111";
  const sessionId = "22222222-2222-4222-8222-222222222222";
  const connectorId = "33333333-3333-4333-8333-333333333333";
  const key = "0123456789abcdef0123456789abcdef";
  const row = {
    id: connectorId,
    owner_id: ownerId,
    name: "remote",
    data: { transport: "http", url: "https://mcp.example.test", revision: "44444444-4444-4444-8444-444444444444", oauth: { enabled: true } },
    secret: seal({ oauthState: { version: 1, generation: "55555555-5555-4555-8555-555555555555", tokens: { access_token: "never-return-this" } } }, key),
  };
  const query = async () => ({ rows: [row], rowCount: 1 });
  const database = { query, transaction: async (fn: any) => fn({ query }) } as unknown as Database;
  let response: { status: number; data: unknown } | undefined;
  const context = {
    request: { method: "GET" },
    url: new URL(`https://cloud.example.test/api/mcp/oauth?name=${connectorId}`),
    config: { encryptionKey: key, publicOrigin: "https://cloud.example.test" } as Config,
    database,
    user: { id: ownerId, sessionId },
    json(status: number, data: unknown) { response = { status, data }; },
  } as unknown as RequestContext;
  assert.equal(await handleMcpOAuthRoutes(context), true);
  assert.deepEqual(response, { status: 200, data: { state: "authorized" } });
  assert.doesNotMatch(JSON.stringify(response), /never-return-this/);
});

test("OAuth route ignores unrelated endpoints", async () => {
  const context = { request: { method: "GET" }, url: new URL("https://cloud.example.test/api/other") } as unknown as RequestContext;
  assert.equal(await handleMcpOAuthRoutes(context), false);
});

test("OAuth callback failure renders fixed no-script HTML without reflecting query values", async () => {
  let status = 0;
  let headers: Record<string, string> = {};
  let body = "";
  const context = {
    request: { method: "GET" },
    response: {
      writeHead(nextStatus: number, nextHeaders: Record<string, string>) { status = nextStatus; headers = nextHeaders; },
      end(value: string) { body = value; },
    },
    url: new URL("https://cloud.example.test/api/mcp/oauth/callback?error=denied&error_description=SECRET_REFLECTION"),
    config: { encryptionKey: "0123456789abcdef0123456789abcdef", publicOrigin: "https://cloud.example.test" } as Config,
    database: { transaction: async () => { throw new Error("must not query without state"); } },
    user: { id: "11111111-1111-4111-8111-111111111111", sessionId: "22222222-2222-4222-8222-222222222222" },
  } as unknown as RequestContext;
  assert.equal(await handleMcpOAuthRoutes(context), true);
  assert.equal(status, 400);
  assert.match(headers["Content-Security-Policy"], /default-src 'none'/);
  assert.doesNotMatch(body, /SECRET_REFLECTION|denied|script/i);
});
