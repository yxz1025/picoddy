import assert from "node:assert/strict";
import { test } from "node:test";

import type { Config } from "../src/config.ts";
import type { Database } from "../src/infra/db.ts";
import { HttpError } from "../src/shared/errors.ts";
import type { McpConnector } from "../src/platform/sandbox.ts";
import {
  createConnectorConnectionLimiter,
  createConnectorConnectionService,
  type ConnectorConnectionStore,
  type ConnectorRow,
} from "../src/domains/connector/node/connection.ts";

const OWNER_ID = "10000000-0000-4000-8000-000000000001";
const CONNECTOR_ID = "20000000-0000-4000-8000-000000000002";
const OPERATION_ID = "30000000-0000-4000-8000-000000000003";
const CONFIG_REVISION = "40000000-0000-4000-8000-000000000004";
const config = {} as Config;
const database = {} as Database;

test('database probe fences preserve PostgreSQL sub-millisecond timestamp precision', async () => {
  let timestamp = '2026-10-14 01:02:03.123456+00';
  const stored = row();
  const db = {
    async query(sql: string, values: readonly unknown[] = []) {
      const wire = () => ({ ...stored, updated_at: sql.includes('updated_at::text') ? timestamp : new Date(timestamp) });
      if (sql.startsWith('UPDATE')) {
        const expected = values.length === 5 ? values[2] : values[4];
        if (expected !== timestamp) return { rows: [], rowCount: 0 };
        stored.data.connection = JSON.parse(values.at(-1) as string);
        timestamp = '2026-10-14 01:02:03.654321+00';
      }
      return { rows: [wire()], rowCount: 1 };
    },
  } as unknown as Database;
  const service = createConnectorConnectionService({ database: db, config, ownerId: OWNER_ID,
    getAuthorizedConnector: async () => ({ transport: 'http', url: 'https://example.test' }),
    probe: async () => [{ name: 'search' }] });
  assert.equal((await service.connect({ id: CONNECTOR_ID })).toolCount, 1);
});

function row(overrides: Partial<ConnectorRow> = {}): ConnectorRow {
  return {
    id: CONNECTOR_ID,
    name: "knowledge",
    data: {
      transport: "http",
      url: "https://mcp.example.test/server",
      displayName: "Knowledge",
      enabled: true,
      revision: CONFIG_REVISION,
    },
    updatedAt: "2026-10-13T00:00:00.000Z",
    ...overrides,
  };
}

function memoryStore(initial: ConnectorRow[]): ConnectorConnectionStore & {
  rows: ConnectorRow[];
  finished: Array<Record<string, unknown>>;
} {
  const rows = structuredClone(initial);
  let version = 0;
  const finished: Array<Record<string, unknown>> = [];
  return {
    rows,
    finished,
    async list(ownerId) {
      assert.equal(ownerId, OWNER_ID);
      return structuredClone(rows);
    },
    async resolve(ownerId, selector) {
      assert.equal(ownerId, OWNER_ID);
      return structuredClone(rows.filter((item) => selector.id
        ? item.id === selector.id
        : item.name === selector.name));
    },
    async claim(ownerId, id, expectedUpdatedAt, expectedRevision, connection) {
      assert.equal(ownerId, OWNER_ID);
      const current = rows.find((item) => item.id === id);
      if (
        !current || current.updatedAt !== expectedUpdatedAt ||
        current.data.revision !== expectedRevision
      ) return undefined;
      current.data = { ...current.data, connection: structuredClone(connection) };
      current.updatedAt = `2026-10-13T00:00:0${++version}.000Z`;
      return structuredClone(current);
    },
    async fence(ownerId, id, operationRevision, expectedRevision) {
      assert.equal(ownerId, OWNER_ID);
      const current = rows.find((item) => item.id === id);
      const active = current?.data.connection as Record<string, unknown> | undefined;
      if (
        !current || current.data.revision !== expectedRevision ||
        active?.revision !== operationRevision
      ) return undefined;
      return structuredClone(current);
    },
    async finish(ownerId, id, revision, expectedUpdatedAt, expectedRevision, connection) {
      assert.equal(ownerId, OWNER_ID);
      const current = rows.find((item) => item.id === id);
      const active = current?.data.connection as Record<string, unknown> | undefined;
      if (
        !current || current.updatedAt !== expectedUpdatedAt ||
        active?.revision !== revision || current.data.revision !== expectedRevision
      ) return undefined;
      finished.push(structuredClone(connection));
      current.data = { ...current.data, connection: structuredClone(connection) };
      current.updatedAt = `2026-10-13T00:00:0${++version}.000Z`;
      return structuredClone(current);
    },
  };
}

function service(options: {
  store?: ConnectorConnectionStore;
  authorize?: (database: Database, config: Config, ownerId: string, id: string, expectedData?: Record<string, unknown>) => Promise<McpConnector>;
  probe?: (config: Config, operationId: string, connector: McpConnector) => Promise<Array<{ name: string }>>;
  limiter?: ReturnType<typeof createConnectorConnectionLimiter>;
} = {}) {
  return createConnectorConnectionService({
    database,
    config,
    ownerId: OWNER_ID,
    store: options.store ?? memoryStore([row()]),
    getAuthorizedConnector: options.authorize ?? (async () => ({
      transport: "http",
      url: "https://mcp.example.test/server",
      headers: { Authorization: "Bearer secret" },
    })),
    probe: options.probe ?? (async () => [{ name: "search" }]),
    limiter: options.limiter ?? createConnectorConnectionLimiter(),
    uuid: () => OPERATION_ID,
    now: () => new Date("2026-10-13T00:00:00.000Z"),
  });
}

test("connect probes an authorized connector and persists only safe tool names", async () => {
  const store = memoryStore([row()]);
  let authorizedData: Record<string, unknown> | undefined;
  let probedConnector: McpConnector | undefined;
  const result = await service({
    store,
    authorize: async (_database, _config, ownerId, id, expectedData) => {
      assert.equal(ownerId, OWNER_ID);
      assert.equal(id, CONNECTOR_ID);
      authorizedData = expectedData;
      return {
        transport: "http",
        url: "https://mcp.example.test/server",
        headers: { Authorization: "Bearer never-return-this" },
      };
    },
    probe: async (_config, operationId, connector) => {
      assert.equal(operationId, OPERATION_ID);
      probedConnector = connector;
      return [{ name: "search" }, { name: "fetch_document" }];
    },
  }).connect({ id: CONNECTOR_ID });

  assert.equal((authorizedData?.connection as Record<string, unknown>).status, "connecting");
  assert.equal((probedConnector as Extract<McpConnector, { transport: "http" }>).headers?.Authorization,
    "Bearer never-return-this");
  assert.deepEqual(result, {
    id: CONNECTOR_ID,
    name: "knowledge",
    displayName: "Knowledge",
    toolCount: 2,
    tools: ["search", "fetch_document"],
  });
  const persisted = store.rows[0]!.data.connection as Record<string, unknown>;
  assert.equal(persisted.status, "connected");
  assert.equal(persisted.success, true);
  assert.deepEqual(persisted.toolNames, ["search", "fetch_document"]);
  assert.equal(JSON.stringify(persisted).includes("never-return-this"), false);
});

test("name lookup rejects ambiguity instead of selecting credentials", async () => {
  let authorized = false;
  const duplicate = row({ id: "20000000-0000-4000-8000-000000000004" });
  await assert.rejects(
    service({
      store: memoryStore([row(), duplicate]),
      authorize: async () => {
        authorized = true;
        return { transport: "http", url: "https://mcp.example.test/server" };
      },
    }).connect({ name: "knowledge" }),
    (error: unknown) => error instanceof HttpError &&
      error.status === 409 && error.code === "CONNECTOR_NAME_AMBIGUOUS",
  );
  assert.equal(authorized, false);
});

test("disabled connectors are rejected before authorization or sandbox creation", async () => {
  let authorized = false;
  let probed = false;
  await assert.rejects(
    service({
      store: memoryStore([row({ data: { ...row().data, enabled: false } })]),
      authorize: async () => {
        authorized = true;
        return { transport: "http", url: "https://mcp.example.test/server" };
      },
      probe: async () => {
        probed = true;
        return [];
      },
    }).connect({ id: CONNECTOR_ID }),
    (error: unknown) => error instanceof HttpError && error.code === "CONNECTOR_DISABLED",
  );
  assert.equal(authorized, false);
  assert.equal(probed, false);
});

test("a concurrent config revision fences a late successful probe", async () => {
  const store = memoryStore([row()]);
  const originalFinish = store.finish;
  store.finish = async (...args) => {
    store.rows[0]!.data.revision = "60000000-0000-4000-8000-000000000006";
    return originalFinish(...args);
  };
  await assert.rejects(
    service({ store }).connect({ id: CONNECTOR_ID }),
    (error: unknown) => error instanceof HttpError &&
      error.status === 409 && error.code === "CONNECTOR_CHANGED",
  );
  assert.equal(store.finished.length, 0);
});

test("an OAuth credential refresh may advance updatedAt before the probe fence", async () => {
  const store = memoryStore([row()]);
  const connected = await service({
    store,
    authorize: async () => {
      store.rows[0]!.updatedAt = "2026-10-13T00:05:00.000Z";
      return { transport: "http", url: "https://mcp.example.test/server" };
    },
  }).connect({ id: CONNECTOR_ID });
  assert.equal(connected.id, CONNECTOR_ID);
  assert.equal((store.rows[0]!.data.connection as Record<string, unknown>).status, "connected");
});

test("probe failures persist a generic status without leaking diagnostics", async () => {
  const store = memoryStore([row()]);
  await assert.rejects(
    service({
      store,
      probe: async () => { throw new Error("Bearer top-secret internal path /host/private"); },
    }).connect({ id: CONNECTOR_ID }),
    (error: unknown) => error instanceof HttpError &&
      error.status === 502 && error.code === "MCP_CONNECTION_FAILED" &&
      !error.message.includes("top-secret"),
  );
  const persisted = store.finished[0]!;
  assert.equal(persisted.status, "failed");
  assert.equal(persisted.success, false);
  assert.deepEqual(persisted.toolNames, []);
  assert.equal(JSON.stringify(persisted).includes("top-secret"), false);
});

test("disconnect supersedes an in-flight revision and tools require a connected status", async () => {
  const store = memoryStore([row({
    data: {
      transport: "http",
      url: "https://mcp.example.test/server",
      revision: CONFIG_REVISION,
      connection: {
        revision: "50000000-0000-4000-8000-000000000005",
        status: "connected",
        success: true,
        toolNames: ["search"],
      },
    },
  })]);
  const api = service({ store });
  assert.deepEqual(await api.tools({ id: CONNECTOR_ID }), {
    id: CONNECTOR_ID,
    name: "knowledge",
    displayName: "knowledge",
    toolCount: 1,
    tools: ["search"],
  });
  assert.deepEqual(await api.disconnect({ id: CONNECTOR_ID }), {
    id: CONNECTOR_ID,
    name: "knowledge",
    disconnected: true,
  });
  await assert.rejects(
    api.tools({ id: CONNECTOR_ID }),
    (error: unknown) => error instanceof HttpError && error.code === "CONNECTOR_NOT_CONNECTED",
  );
});

test("MCP view omits secrets and keeps duplicate names addressable by UUID", async () => {
  const first = row({
    data: {
      transport: "stdio",
      revision: CONFIG_REVISION,
      command: "node",
      args: ["server.mjs"],
      env: { TOKEN: "must-not-leak" },
      headers: { Authorization: "must-not-leak" },
    },
  });
  const second = row({
    id: "20000000-0000-4000-8000-000000000004",
    data: { transport: "http", url: "https://second.example.test/mcp", revision: CONFIG_REVISION },
  });
  const view = await service({ store: memoryStore([first, second]) }).view();
  assert.deepEqual(Object.keys(view.config.mcpServers).sort(), [first.id, second.id].sort());
  assert.equal(view.config.mcpServers[first.id]?.displayName, "knowledge");
  assert.equal(JSON.stringify(view).includes("must-not-leak"), false);
});

test("owner limiter fails fast on concurrency and bounded request rate", () => {
  let current = 1_000;
  const limiter = createConnectorConnectionLimiter({
    maxConcurrent: 1,
    maxPerWindow: 2,
    windowMs: 60_000,
    now: () => current,
  });
  const release = limiter.acquire(OWNER_ID);
  assert.throws(
    () => limiter.acquire(OWNER_ID),
    (error: unknown) => error instanceof HttpError && error.code === "MCP_CONNECTION_BUSY",
  );
  release();
  const second = limiter.acquire(OWNER_ID);
  second();
  assert.throws(
    () => limiter.acquire(OWNER_ID),
    (error: unknown) => error instanceof HttpError && error.code === "MCP_CONNECTION_RATE_LIMITED",
  );
  current += 60_001;
  limiter.acquire(OWNER_ID)();
});
