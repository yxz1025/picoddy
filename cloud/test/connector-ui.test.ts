import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { afterEach, test } from "node:test";

import { requestDesktopApi } from "../web/desktop/src/api/cloudAdapter.ts";
import { safeOAuthUrl } from "../web/desktop/src/components/McpOAuthControls.tsx";
import { useSkillStore } from "../web/desktop/src/store/useSkillStore.ts";

const CONNECTOR_ID = "10000000-0000-4000-8000-000000000001";
const originalFetch = globalThis.fetch;

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify({ data: value }), {
    status,
    headers: { "content-type": "application/json" },
  });
}

afterEach(() => {
  globalThis.fetch = originalFetch;
});

test("cloud MCP management routes forward desktop-shaped contracts without rewriting secrets", async () => {
  const calls: Array<{ method: string; path: string; body?: unknown }> = [];
  const config = {
    mcpServers: {
      docs: {
        id: CONNECTOR_ID,
        type: "http",
        url: "https://mcp.example.test",
        enabled: true,
        displayName: "文档连接器",
        exposure: "deferred",
        toolExposure: { search: "direct" },
        oauth: { clientId: "public-client", clientSecretConfigured: true },
        headersConfigured: true,
      },
    },
  };
  globalThis.fetch = async (input, init) => {
    const path = String(input);
    const method = init?.method ?? "GET";
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ method, path, ...(body === undefined ? {} : { body }) });
    if (path === "/api/mcp" && method === "GET") {
      return json({ config, availableConfig: config, connected: [] });
    }
    if (path === "/api/mcp" && method === "POST") {
      return json({ config, availableConfig: config, connected: [] });
    }
    if (path === "/api/mcp/connect") {
      return json({ id: CONNECTOR_ID, name: "docs", displayName: "文档连接器", toolCount: 1, tools: ["search"] });
    }
    if (path === "/api/mcp/disconnect") return json({ ok: true });
    if (path === `/api/mcp/tools?id=${CONNECTOR_ID}`) return json({ tools: ["search"] });
    if (path === `/api/mcp/oauth?id=${CONNECTOR_ID}` && method === "GET") {
      return json({ state: "authorizing", url: "https://idp.example.test/authorize" });
    }
    if (path === "/api/mcp/oauth" && method === "POST") return json({ state: "cancelled" });
    if (path === "/api/mcp/oauth/callback?code=safe-code&state=safe-state") {
      return json({ state: "authorized" });
    }
    throw new Error(`Unexpected request: ${method} ${path}`);
  };

  assert.deepEqual(await requestDesktopApi("GET", "/api/mcp"), {
    config, availableConfig: config, connected: [],
  });
  await requestDesktopApi("POST", "/api/mcp", {
    mcpServers: {
      docs: {
        id: CONNECTOR_ID,
        type: "http",
        url: "https://mcp.example.test",
        displayName: "文档连接器",
        enabled: true,
        oauth: { clientId: "public-client", clientSecret: "write-only-secret" },
      },
    },
  });
  await requestDesktopApi("POST", "/api/mcp/connect", { id: CONNECTOR_ID });
  await requestDesktopApi("POST", "/api/mcp/disconnect", { id: CONNECTOR_ID });
  await requestDesktopApi("GET", `/api/mcp/tools?id=${CONNECTOR_ID}`);
  await requestDesktopApi("GET", `/api/mcp/oauth?id=${CONNECTOR_ID}`);
  await requestDesktopApi("POST", "/api/mcp/oauth", { id: CONNECTOR_ID, action: "cancel" });
  await requestDesktopApi("GET", "/api/mcp/oauth/callback?code=safe-code&state=safe-state");

  assert.deepEqual(calls[1], {
    method: "POST",
    path: "/api/mcp",
    body: {
      mcpServers: {
        docs: {
          id: CONNECTOR_ID,
          type: "http",
          url: "https://mcp.example.test",
          displayName: "文档连接器",
          enabled: true,
          oauth: { clientId: "public-client", clientSecret: "write-only-secret" },
        },
      },
    },
  });
  assert.equal(JSON.stringify(calls[0]).includes("write-only-secret"), false);
  assert.deepEqual(calls.slice(2).map(({ method, path }) => ({ method, path })), [
    { method: "POST", path: "/api/mcp/connect" },
    { method: "POST", path: "/api/mcp/disconnect" },
    { method: "GET", path: `/api/mcp/tools?id=${CONNECTOR_ID}` },
    { method: "GET", path: `/api/mcp/oauth?id=${CONNECTOR_ID}` },
    { method: "POST", path: "/api/mcp/oauth" },
    { method: "GET", path: "/api/mcp/oauth/callback?code=safe-code&state=safe-state" },
  ]);
});

test("store prefers connector UUID for connect and disconnect operations", async () => {
  const originalState = useSkillStore.getState();
  const writes: Array<{ path: string; body: unknown }> = [];
  globalThis.fetch = async (input, init) => {
    const path = String(input);
    const body = JSON.parse(String(init?.body));
    writes.push({ path, body });
    if (path === "/api/mcp/connect") {
      return json({ id: CONNECTOR_ID, name: "docs", displayName: "文档连接器", toolCount: 1, tools: ["search"] });
    }
    if (path === "/api/mcp/disconnect") return json({ ok: true });
    throw new Error(`Unexpected request: ${path}`);
  };
  try {
    useSkillStore.setState({
      customMcpConfig: {
        mcpServers: {
          docs: { id: CONNECTOR_ID, type: "http", url: "https://mcp.example.test", enabled: true },
        },
      },
      mcpConnected: [],
    });
    await useSkillStore.getState().connectMcp("docs");
    await useSkillStore.getState().disconnectMcp("docs");
    assert.deepEqual(writes, [
      { path: "/api/mcp/connect", body: { id: CONNECTOR_ID } },
      { path: "/api/mcp/disconnect", body: { id: CONNECTOR_ID } },
    ]);
    assert.deepEqual(useSkillStore.getState().mcpConnected, []);
  } finally {
    useSkillStore.setState(originalState, true);
  }
});

test("OAuth and connector management UI expose safe browser flow without token fields", () => {
  const oauth = readFileSync(
    new URL("../web/desktop/src/components/McpOAuthControls.tsx", import.meta.url),
    "utf8",
  );
  const panel = readFileSync(
    new URL("../web/desktop/src/components/ExpertPanel.tsx", import.meta.url),
    "utf8",
  );
  const store = readFileSync(
    new URL("../web/desktop/src/store/useSkillStore.ts", import.meta.url),
    "utf8",
  );
  assert.match(oauth, /safeOAuthUrl/);
  assert.match(oauth, /rel="noreferrer noopener"/);
  assert.match(oauth, /id\?:\s*string/);
  assert.doesNotMatch(oauth, /accessToken|refreshToken|idToken/);
  assert.match(panel, /最近探测成功/);
  assert.match(panel, /测试连接/);
  assert.match(panel, /断开/);
  assert.match(store, /disconnectMcp/);
  assert.match(store, /mcpBusyIds/);
});

test("OAuth links allow HTTPS and local development callbacks only", () => {
  assert.equal(
    safeOAuthUrl("https://idp.example.test/authorize?state=opaque"),
    "https://idp.example.test/authorize?state=opaque",
  );
  assert.equal(safeOAuthUrl("http://127.0.0.1:8080/callback"), "http://127.0.0.1:8080/callback");
  assert.equal(safeOAuthUrl("http://localhost:8080/callback"), "http://localhost:8080/callback");
  assert.equal(safeOAuthUrl("javascript:alert(1)"), null);
  assert.equal(safeOAuthUrl("http://idp.example.test/authorize"), null);
  assert.equal(safeOAuthUrl("https://user:secret@idp.example.test/authorize"), null);
});

test('connecting a second UUID keeps another connector with the same display name', async () => {
  const originalState = useSkillStore.getState();
  const secondId = '20000000-0000-4000-8000-000000000002';
  globalThis.fetch = async () => json({ id: secondId, name: 'docs', displayName: 'Docs', toolCount: 1, tools: ['search'] });
  try {
    useSkillStore.setState({ customMcpConfig: { mcpServers: {
      [CONNECTOR_ID]: { id: CONNECTOR_ID, type: 'http', url: 'https://one.example.test' },
      [secondId]: { id: secondId, type: 'http', url: 'https://two.example.test' },
    } }, mcpConnected: [{ id: CONNECTOR_ID, name: 'docs', displayName: 'Docs', toolCount: 1, tools: ['search'] }] });
    await useSkillStore.getState().connectMcp(secondId);
    assert.deepEqual(useSkillStore.getState().mcpConnected.map(item => item.id), [CONNECTOR_ID, secondId]);
  } finally { useSkillStore.setState(originalState, true); }
});
