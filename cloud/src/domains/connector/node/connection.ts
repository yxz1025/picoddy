import { randomUUID } from "node:crypto";

import type { QueryResultRow } from "pg";

import type { Config } from "../../../config.ts";
import { unseal } from "../../../infra/crypto.ts";
import type { Database } from "../../../infra/db.ts";
import type { ConnectorSandboxProbe, DiscoveredConnectorTool } from "../../../platform/connector-sandbox.ts";
import { probeConnectorInSandbox } from "../../../platform/connector-sandbox.ts";
import type { McpConnector } from "../../../platform/sandbox.ts";
import { HttpError, fail } from "../../../shared/errors.ts";
import { UUID, object, string } from "../../../shared/validation.ts";

const MAX_STORED_TOOLS = 512;
const MAX_TOOL_NAME_LENGTH = 256;
const EXPOSURES = new Set(["direct", "deferred", "codemode", "hidden"]);

export interface ConnectorRow {
  id: string;
  name: string;
  data: Record<string, unknown>;
  updatedAt: Date | string;
  secret?: string | null;
}

export interface ConnectorSelector {
  id?: string;
  name?: string;
}

export interface StoredConnectorConnection extends Record<string, unknown> {
  revision: string;
  status: "connecting" | "connected" | "failed" | "disconnected";
  success: boolean;
  toolNames: string[];
}

export interface ConnectorConnectionStore {
  list(ownerId: string): Promise<ConnectorRow[]>;
  resolve(ownerId: string, selector: ConnectorSelector): Promise<ConnectorRow[]>;
  claim(
    ownerId: string,
    id: string,
    expectedUpdatedAt: Date | string,
    expectedRevision: string,
    connection: StoredConnectorConnection,
  ): Promise<ConnectorRow | undefined>;
  fence(
    ownerId: string,
    id: string,
    operationRevision: string,
    expectedRevision: string,
  ): Promise<ConnectorRow | undefined>;
  finish(
    ownerId: string,
    id: string,
    operationRevision: string,
    expectedUpdatedAt: Date | string,
    expectedRevision: string,
    connection: StoredConnectorConnection,
  ): Promise<ConnectorRow | undefined>;
}

export type AuthorizedConnectorResolver = (
  database: Database,
  config: Config,
  ownerId: string,
  id: string,
  expectedData?: Record<string, unknown>,
) => Promise<McpConnector>;

export interface ConnectorOperationLimiter {
  acquire(ownerId: string): () => void;
}

export interface ConnectorConnectionInfo {
  id: string;
  name: string;
  displayName: string;
  toolCount: number;
  tools: string[];
}

interface ConnectorDatabaseRow extends QueryResultRow {
  id: string;
  name: string;
  data: Record<string, unknown>;
  updated_at: Date | string;
  secret?: string | null;
}

interface Queryable {
  query<T extends QueryResultRow = QueryResultRow>(
    sql: string,
    values?: readonly unknown[],
  ): Promise<{ rows: T[]; rowCount: number | null }>;
}

function connectorRow(row: ConnectorDatabaseRow): ConnectorRow {
  return { id: row.id, name: row.name, data: row.data, updatedAt: row.updated_at, ...(row.secret !== undefined ? { secret: row.secret } : {}) };
}

function createConnectorConnectionStore(database: Database): ConnectorConnectionStore {
  async function matching(
    queryable: Queryable,
    ownerId: string,
    selector: ConnectorSelector,
  ): Promise<ConnectorRow[]> {
    const result = selector.id
      ? await queryable.query<ConnectorDatabaseRow>(
        `SELECT id,name,data,updated_at::text AS updated_at FROM resources
          WHERE owner_id=$1 AND kind='connector' AND id=$2 AND deleted_at IS NULL`,
        [ownerId, selector.id],
      )
      : await queryable.query<ConnectorDatabaseRow>(
        `SELECT id,name,data,updated_at::text AS updated_at FROM resources
          WHERE owner_id=$1 AND kind='connector' AND name=$2 AND deleted_at IS NULL
          ORDER BY id LIMIT 3`,
        [ownerId, selector.name],
      );
    return result.rows.map(connectorRow);
  }

  return {
    async list(ownerId) {
      const result = await database.query<ConnectorDatabaseRow>(
        `SELECT id,name,data,secret,updated_at::text AS updated_at FROM resources
          WHERE owner_id=$1 AND kind='connector' AND deleted_at IS NULL
          ORDER BY created_at,id`,
        [ownerId],
      );
      return result.rows.map(connectorRow);
    },

    resolve(ownerId, selector) {
      return matching(database, ownerId, selector);
    },

    async claim(ownerId, id, expectedUpdatedAt, expectedRevision, connection) {
      const result = await database.query<ConnectorDatabaseRow>(
        `UPDATE resources
          SET data=jsonb_set(data,'{connection}',$5::jsonb,true),updated_at=clock_timestamp()
          WHERE id=$1 AND owner_id=$2 AND kind='connector' AND deleted_at IS NULL
            AND updated_at=$3 AND data->>'revision'=$4
          RETURNING id,name,data,updated_at::text AS updated_at`,
        [id, ownerId, expectedUpdatedAt, expectedRevision, JSON.stringify(connection)],
      );
      return result.rows[0] ? connectorRow(result.rows[0]) : undefined;
    },

    async fence(ownerId, id, operationRevision, expectedRevision) {
      const result = await database.query<ConnectorDatabaseRow>(
        `SELECT id,name,data,updated_at::text AS updated_at FROM resources
          WHERE id=$1 AND owner_id=$2 AND kind='connector' AND deleted_at IS NULL
            AND data->>'revision'=$3
            AND data->'connection'->>'revision'=$4`,
        [id, ownerId, expectedRevision, operationRevision],
      );
      return result.rows[0] ? connectorRow(result.rows[0]) : undefined;
    },

    async finish(
      ownerId,
      id,
      operationRevision,
      expectedUpdatedAt,
      expectedRevision,
      connection,
    ) {
      const result = await database.query<ConnectorDatabaseRow>(
        `UPDATE resources
          SET data=jsonb_set(data,'{connection}',$7::jsonb,true),updated_at=clock_timestamp()
          WHERE id=$1 AND owner_id=$2 AND kind='connector' AND deleted_at IS NULL
            AND data->>'revision'=$3
            AND data->'connection'->>'revision'=$4
            AND updated_at=$5
            AND data->'connection'->>'status'=$6
          RETURNING id,name,data,updated_at::text AS updated_at`,
        [
          id,
          ownerId,
          expectedRevision,
          operationRevision,
          expectedUpdatedAt,
          "connecting",
          JSON.stringify(connection),
        ],
      );
      return result.rows[0] ? connectorRow(result.rows[0]) : undefined;
    },
  };
}

function selector(value: unknown): ConnectorSelector {
  const body = object(value);
  const hasId = body.id !== undefined && body.id !== null && body.id !== "";
  const hasName = body.name !== undefined && body.name !== null && body.name !== "";
  if (hasId === hasName) {
    fail(400, "INVALID_REQUEST", "Provide exactly one connector id or name");
  }
  if (hasId) {
    if (typeof body.id !== "string" || !UUID.test(body.id)) {
      fail(400, "INVALID_REQUEST", "id must be a UUID");
    }
    return { id: body.id };
  }
  return { name: string(body.name, "name", 1, 200) };
}

function configRevision(row: ConnectorRow): string {
  const revision = row.data.revision;
  if (typeof revision !== "string" || !UUID.test(revision)) {
    fail(409, "CONNECTOR_CHANGED", "Connector configuration changed; reload and retry");
  }
  return revision;
}

function displayName(row: ConnectorRow): string {
  const value = row.data.displayName;
  return typeof value === "string" && value.trim() ? value.trim() : row.name;
}

function safeToolNames(value: unknown): string[] | undefined {
  if (!Array.isArray(value) || value.length > MAX_STORED_TOOLS) return undefined;
  const names = value.filter((name): name is string =>
    typeof name === "string" && name.length > 0 && name.length <= MAX_TOOL_NAME_LENGTH &&
    !/[\u0000-\u001f\u007f]/u.test(name));
  if (names.length !== value.length || new Set(names).size !== names.length) return undefined;
  return names;
}

function connectionInfo(row: ConnectorRow): ConnectorConnectionInfo | undefined {
  const connection = row.data.connection;
  if (!connection || typeof connection !== "object" || Array.isArray(connection)) return undefined;
  const state = connection as Record<string, unknown>;
  const tools = safeToolNames(state.toolNames);
  if (state.status !== "connected" || state.success !== true || !tools) return undefined;
  return {
    id: row.id,
    name: row.name,
    displayName: displayName(row),
    toolCount: tools.length,
    tools,
  };
}

function publicServer(row: ConnectorRow, config: Config): Record<string, unknown> {
  const data = row.data;
  const transport = data.transport;
  const result: Record<string, unknown> = {
    id: row.id,
    displayName: displayName(row),
    type: transport,
    enabled: data.enabled !== false,
    revision: data.revision,
  };
  if (typeof data.description === "string") result.description = data.description;
  if (transport === "stdio") {
    if (typeof data.command === "string") result.command = data.command;
    if (Array.isArray(data.args) && data.args.every((arg) => typeof arg === "string")) {
      result.args = data.args;
    }
  } else if ((transport === "http" || transport === "sse") && typeof data.url === "string") {
    result.url = data.url;
  }
  if (typeof data.exposure === "string" && EXPOSURES.has(data.exposure)) {
    result.exposure = data.exposure;
  }
  if (data.toolExposure && typeof data.toolExposure === "object" && !Array.isArray(data.toolExposure)) {
    const entries = Object.entries(data.toolExposure).filter(([, value]) =>
      typeof value === "string" && EXPOSURES.has(value));
    result.toolExposure = Object.fromEntries(entries);
  }
  if (data.oauth && typeof data.oauth === "object" && !Array.isArray(data.oauth)) {
    const oauth = data.oauth as Record<string, unknown>;
    result.oauth = Object.fromEntries(
      ["enabled", "clientId", "scope"]
        .filter((key) => typeof oauth[key] === "boolean" || typeof oauth[key] === "string")
        .map((key) => [key, oauth[key]]),
    );
  }
  if (row.secret !== undefined) {
    const secret = row.secret ? unseal(row.secret, config.encryptionKey) as Record<string, unknown> : {};
    result.envConfigured = Object.keys(secret.env as object ?? {}).length > 0;
    result.headersConfigured = Object.keys(secret.headers as object ?? {}).length > 0;
    result.authorizationConfigured = Object.keys(secret.headers as object ?? {}).some(key => key.toLowerCase() === 'authorization');
    if (result.oauth) (result.oauth as Record<string, unknown>).clientSecretConfigured = Boolean(secret.oauthClientSecret);
  }
  return result;
}

function validatedDiscoveredTools(tools: DiscoveredConnectorTool[]): string[] {
  const names = safeToolNames(tools.map((tool) => tool?.name));
  if (!names) throw new Error("Connector probe returned invalid tools");
  return names;
}

function secretStrings(value: unknown): Record<string, string> | undefined {
  if (value === undefined) return undefined;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Connector credentials are invalid");
  }
  const entries = Object.entries(value);
  if (entries.some(([key, item]) => !key || typeof item !== "string")) {
    throw new Error("Connector credentials are invalid");
  }
  return Object.fromEntries(entries);
}

/** Basic env/header resolver. OAuth composition should inject its
 * getAuthorizedConnector implementation with the same signature. */
export const getConfiguredConnector: AuthorizedConnectorResolver = async (
  database,
  config,
  ownerId,
  id,
  expectedData,
) => {
  const result = await database.query<ConnectorDatabaseRow & { secret: string | null }>(
    `SELECT id,name,data,secret,updated_at FROM resources
      WHERE id=$1 AND owner_id=$2 AND kind='connector' AND deleted_at IS NULL
        AND data=$3::jsonb`,
    [id, ownerId, JSON.stringify(expectedData ?? {})],
  );
  const row = result.rows[0];
  if (!row) fail(409, "CONNECTOR_CHANGED", "Connector configuration changed; reload and retry");
  if (row.data.enabled === false) fail(409, "CONNECTOR_DISABLED", "Connector is disabled");
  const secret = row.secret ? unseal(row.secret, config.encryptionKey) : {};
  if (!secret || typeof secret !== "object" || Array.isArray(secret)) {
    throw new Error("Connector credentials are invalid");
  }
  const values = secret as Record<string, unknown>;
  if (row.data.transport === "stdio") {
    if (typeof row.data.command !== "string" || !row.data.command) {
      throw new Error("Connector command is invalid");
    }
    return {
      transport: "stdio",
      command: row.data.command,
      args: Array.isArray(row.data.args) && row.data.args.every((arg) => typeof arg === "string")
        ? row.data.args as string[]
        : [],
      env: secretStrings(values.env),
    };
  }
  if (
    (row.data.transport === "http" || row.data.transport === "sse") &&
    typeof row.data.url === "string" && row.data.url
  ) {
    return {
      transport: row.data.transport,
      url: row.data.url,
      headers: secretStrings(values.headers),
    } as McpConnector;
  }
  throw new Error("Connector transport is invalid");
};

export function createConnectorConnectionLimiter(options: {
  maxConcurrent?: number;
  maxPerWindow?: number;
  windowMs?: number;
  now?: () => number;
} = {}): ConnectorOperationLimiter {
  const maxConcurrent = options.maxConcurrent ?? 2;
  const maxPerWindow = options.maxPerWindow ?? 12;
  const windowMs = options.windowMs ?? 60_000;
  const now = options.now ?? Date.now;
  if (
    !Number.isSafeInteger(maxConcurrent) || maxConcurrent <= 0 ||
    !Number.isSafeInteger(maxPerWindow) || maxPerWindow <= 0 ||
    !Number.isSafeInteger(windowMs) || windowMs <= 0
  ) throw new RangeError("Connector limiter values must be positive integers");
  const owners = new Map<string, { active: number; attempts: number[] }>();
  return {
    acquire(ownerId) {
      const current = now();
      const state = owners.get(ownerId) ?? { active: 0, attempts: [] };
      state.attempts = state.attempts.filter((value) => current - value < windowMs);
      if (state.active >= maxConcurrent) {
        fail(429, "MCP_CONNECTION_BUSY", "Too many connector checks are already running");
      }
      if (state.attempts.length >= maxPerWindow) {
        fail(429, "MCP_CONNECTION_RATE_LIMITED", "Too many connector checks; retry later");
      }
      state.active += 1;
      state.attempts.push(current);
      owners.set(ownerId, state);
      let released = false;
      return () => {
        if (released) return;
        released = true;
        state.active -= 1;
        if (state.active === 0 && state.attempts.length === 0) owners.delete(ownerId);
      };
    },
  };
}

const defaultLimiter = createConnectorConnectionLimiter();

export interface ConnectorConnectionDependencies {
  database: Database;
  config: Config;
  ownerId: string;
  getAuthorizedConnector?: AuthorizedConnectorResolver;
  probe?: ConnectorSandboxProbe;
  store?: ConnectorConnectionStore;
  limiter?: ConnectorOperationLimiter;
  uuid?: () => string;
  now?: () => Date;
}

export function createConnectorConnectionService(dependencies: ConnectorConnectionDependencies) {
  const store = dependencies.store ?? createConnectorConnectionStore(dependencies.database);
  const authorize = dependencies.getAuthorizedConnector ?? getConfiguredConnector;
  const probe = dependencies.probe ?? probeConnectorInSandbox;
  const limiter = dependencies.limiter ?? defaultLimiter;
  const uuid = dependencies.uuid ?? randomUUID;
  const now = dependencies.now ?? (() => new Date());

  async function resolveOne(value: unknown): Promise<ConnectorRow> {
    const selected = selector(value);
    const matches = await store.resolve(dependencies.ownerId, selected);
    if (matches.length === 0) fail(404, "NOT_FOUND", "Connector not found");
    if (matches.length > 1) {
      fail(409, "CONNECTOR_NAME_AMBIGUOUS", "Connector name is ambiguous; use its id");
    }
    return matches[0]!;
  }

  async function finishOrChanged(
    row: ConnectorRow,
    operationRevision: string,
    expectedRevision: string,
    connection: StoredConnectorConnection,
  ): Promise<ConnectorRow> {
    const updated = await store.finish(
      dependencies.ownerId,
      row.id,
      operationRevision,
      row.updatedAt,
      expectedRevision,
      connection,
    );
    if (!updated) fail(409, "CONNECTOR_CHANGED", "Connector configuration changed during check");
    return updated;
  }

  return {
    async view() {
      const rows = await store.list(dependencies.ownerId);
      const counts = new Map<string, number>();
      for (const row of rows) counts.set(row.name, (counts.get(row.name) ?? 0) + 1);
      const configured: Record<string, Record<string, unknown>> = Object.create(null);
      const available: Record<string, Record<string, unknown>> = Object.create(null);
      const connected: ConnectorConnectionInfo[] = [];
      for (const row of rows) {
        const key = counts.get(row.name) === 1 ? row.name : row.id;
        const server = publicServer(row, dependencies.config);
        configured[key] = server;
        if (row.data.enabled !== false) {
          available[key] = server;
          const info = connectionInfo(row);
          if (info) connected.push(info);
        }
      }
      return {
        config: { mcpServers: configured },
        availableConfig: { mcpServers: available },
        connected,
      };
    },

    async connect(input: unknown): Promise<ConnectorConnectionInfo> {
      const release = limiter.acquire(dependencies.ownerId);
      try {
        const selected = await resolveOne(input);
        if (selected.data.enabled === false) {
          fail(409, "CONNECTOR_DISABLED", "Connector is disabled");
        }
        const expectedRevision = configRevision(selected);
        const operationRevision = uuid();
        if (!UUID.test(operationRevision)) throw new Error("Connector operation id must be a UUID");
        const startedAt = now().toISOString();
        const connecting: StoredConnectorConnection = {
          revision: operationRevision,
          status: "connecting",
          success: false,
          toolNames: [],
          checkedAt: startedAt,
        };
        const claimed = await store.claim(
          dependencies.ownerId,
          selected.id,
          selected.updatedAt,
          expectedRevision,
          connecting,
        );
        if (!claimed) fail(409, "CONNECTOR_CHANGED", "Connector configuration changed; retry");

        let fenced = claimed;
        try {
          const connector = await authorize(
            dependencies.database,
            dependencies.config,
            dependencies.ownerId,
            claimed.id,
            claimed.data,
          );
          const afterAuthorization = await store.fence(
            dependencies.ownerId,
            claimed.id,
            operationRevision,
            expectedRevision,
          );
          if (!afterAuthorization) {
            fail(409, "CONNECTOR_CHANGED", "Connector configuration changed during authorization");
          }
          fenced = afterAuthorization;
          const toolNames = validatedDiscoveredTools(await probe(
            dependencies.config,
            operationRevision,
            connector,
          ));
          const completed: StoredConnectorConnection = {
            revision: operationRevision,
            status: "connected",
            success: true,
            toolNames,
            checkedAt: now().toISOString(),
          };
          const updated = await finishOrChanged(
            fenced,
            operationRevision,
            expectedRevision,
            completed,
          );
          return connectionInfo(updated)!;
        } catch (error) {
          if (error instanceof HttpError && error.code === "CONNECTOR_CHANGED") throw error;
          const failed: StoredConnectorConnection = {
            revision: operationRevision,
            status: "failed",
            success: false,
            toolNames: [],
            checkedAt: now().toISOString(),
            errorCode: error instanceof HttpError ? error.code : "MCP_CONNECTION_FAILED",
          };
          await finishOrChanged(fenced, operationRevision, expectedRevision, failed);
          if (error instanceof HttpError) throw error;
          fail(502, "MCP_CONNECTION_FAILED", "Unable to connect to the MCP server");
        }
      } finally {
        release();
      }
    },

    async disconnect(input: unknown) {
      const selected = await resolveOne(input);
      const expectedRevision = configRevision(selected);
      const operationRevision = uuid();
      if (!UUID.test(operationRevision)) throw new Error("Connector operation id must be a UUID");
      const disconnected: StoredConnectorConnection = {
        revision: operationRevision,
        status: "disconnected",
        success: false,
        toolNames: [],
        checkedAt: now().toISOString(),
      };
      const updated = await store.claim(
        dependencies.ownerId,
        selected.id,
        selected.updatedAt,
        expectedRevision,
        disconnected,
      );
      if (!updated) fail(409, "CONNECTOR_CHANGED", "Connector configuration changed; retry");
      return { id: updated.id, name: updated.name, disconnected: true as const };
    },

    async tools(input: unknown): Promise<ConnectorConnectionInfo> {
      const selected = await resolveOne(input);
      if (selected.data.enabled === false) fail(409, "CONNECTOR_DISABLED", "Connector is disabled");
      const info = connectionInfo(selected);
      if (!info) fail(409, "CONNECTOR_NOT_CONNECTED", "Connector has no successful recent check");
      return info;
    },
  };
}

export type ConnectorConnectionService = ReturnType<typeof createConnectorConnectionService>;
