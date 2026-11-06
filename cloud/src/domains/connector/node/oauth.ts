import {
  createHash,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";

import type { QueryResultRow } from "pg";

import type { Config } from "../../../config.ts";
import type { Database } from "../../../infra/db.ts";
import { seal, unseal } from "../../../infra/crypto.ts";
import { createSandbox, reconcileRunSandboxes } from "../../../platform/sandbox.ts";
import { fail } from "../../../shared/errors.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CHALLENGE_TTL_MS = 10 * 60_000;
const REFRESH_SKEW_MS = 60_000;
const MAX_OAUTH_REQUEST_BYTES = 1024 * 1024;
const OAUTH_RUNNER = "/opt/picoddy/oauth-runner.mjs";

type OAuthConfig = Pick<Config, "encryptionKey" | "publicOrigin"> & Partial<Config>;
type Queryable = Pick<Database, "query">;

interface ConnectorRow extends QueryResultRow {
  id: string;
  owner_id: string;
  name: string;
  data: Record<string, unknown>;
  secret: string | null;
}

interface OAuthChallenge {
  status: "preparing" | "pending" | "exchanging";
  ownerId: string;
  sessionId: string;
  connectorId: string;
  connectorRevision: string;
  stateHash: string;
  expiresAt: number;
  authorizationUrl?: string;
}

export interface StoredOAuthState {
  version: 1;
  generation: string;
  clientInformation?: Record<string, unknown>;
  tokens?: Record<string, unknown>;
  tokenExpiresAt?: number;
  codeVerifier?: string;
  discovery?: Record<string, unknown>;
  challenge?: OAuthChallenge;
}

interface ConnectorSecret {
  env?: Record<string, string>;
  headers?: Record<string, string>;
  oauthClientSecret?: string;
  oauthState?: StoredOAuthState;
  [key: string]: unknown;
}

export interface OAuthRunnerRequest {
  operation: "begin" | "exchange" | "refresh" | "revoke";
  serverUrl: string;
  redirectUrl: string;
  scope?: string;
  state?: string;
  authorizationCode?: string;
  clientId?: string;
  clientSecret?: string;
  providerState?: Omit<StoredOAuthState, "version" | "generation" | "challenge">;
  allowInsecureLoopback: boolean;
}

export interface OAuthRunnerResult {
  authorizationUrl?: string;
  state?: Omit<StoredOAuthState, "version" | "generation" | "challenge">;
  revoked?: boolean;
}

export type OAuthRunner = (
  request: OAuthRunnerRequest,
  signal?: AbortSignal,
) => Promise<OAuthRunnerResult>;

export type AuthorizedConnector =
  | { transport: "stdio"; command: string; args?: string[]; env?: Record<string, string> }
  | { transport: "http" | "sse"; url: string; headers?: Record<string, string> };

export interface OAuthStatus {
  state: "idle" | "connecting" | "authorizing" | "authorized" | "cancelled" | "error";
  url?: string;
  error?: string;
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function stringRecord(value: unknown): Record<string, string> {
  const input = record(value);
  if (!input) return {};
  const output: Record<string, string> = {};
  for (const [key, item] of Object.entries(input)) {
    if (key && typeof item === "string" && !key.includes("\0") && !item.includes("\0")) {
      output[key] = item;
    }
  }
  return output;
}

function revision(data: Record<string, unknown>): string {
  if (typeof data.revision !== "string" || !UUID.test(data.revision)) {
    fail(409, "MCP_CONNECTOR_CHANGED", "连接器配置已更改，请重新运行");
  }
  return data.revision;
}

function oauthConfig(data: Record<string, unknown>): {
  enabled: boolean;
  clientId?: string;
  scope?: string;
} {
  const value = record(data.oauth) ?? {};
  return {
    enabled: value.enabled === true,
    clientId: typeof value.clientId === "string" && value.clientId.trim() ? value.clientId : undefined,
    scope: typeof value.scope === "string" && value.scope.trim() ? value.scope : undefined,
  };
}

function remoteUrl(data: Record<string, unknown>, config: OAuthConfig): string {
  if (data.transport !== "http" && data.transport !== "sse") {
    fail(400, "MCP_OAUTH_UNSUPPORTED", "OAuth 仅适用于远程连接器");
  }
  if (typeof data.url !== "string") fail(400, "MCP_OAUTH_UNSUPPORTED", "连接器地址无效");
  let parsed: URL;
  try {
    parsed = new URL(data.url);
  } catch {
    fail(400, "MCP_OAUTH_UNSUPPORTED", "连接器地址无效");
  }
  if (parsed.username || parsed.password || !["http:", "https:"].includes(parsed.protocol)) {
    fail(400, "MCP_OAUTH_UNSUPPORTED", "连接器地址无效");
  }
  if (parsed.protocol !== "https:" && !isLoopback(parsed.hostname)) {
    fail(400, "MCP_OAUTH_UNSUPPORTED", "远程 OAuth 连接器必须使用 HTTPS");
  }
  if (parsed.protocol !== "https:" && new URL(config.publicOrigin).protocol === "https:") {
    fail(400, "MCP_OAUTH_UNSUPPORTED", "生产环境 OAuth 连接器必须使用 HTTPS");
  }
  return parsed.toString();
}

function isLoopback(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";
}

function callbackUrl(config: OAuthConfig): string {
  return new URL("/api/mcp/oauth/callback", config.publicOrigin).toString();
}

function openSecret(row: ConnectorRow, config: OAuthConfig): ConnectorSecret {
  if (!row.secret) return {};
  const value = unseal(row.secret, config.encryptionKey);
  const output = record(value);
  if (!output) fail(500, "MCP_OAUTH_STATE_INVALID", "连接器授权状态无效");
  return output as ConnectorSecret;
}

function stateHash(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("base64url");
}

function equalHash(a: string, b: string): boolean {
  const left = Buffer.from(a, "utf8");
  const right = Buffer.from(b, "utf8");
  return left.length === right.length && timingSafeEqual(left, right);
}

function challengeState(connectorId: string): string {
  return `${connectorId}.${randomBytes(32).toString("base64url")}`;
}

function connectorFromState(state: string): string {
  if (typeof state !== "string" || state.length > 1024) {
    fail(400, "MCP_OAUTH_STATE_INVALID", "授权状态无效或已过期");
  }
  const separator = state.indexOf(".");
  const id = separator > 0 ? state.slice(0, separator) : "";
  if (!UUID.test(id) || separator === state.length - 1) {
    fail(400, "MCP_OAUTH_STATE_INVALID", "授权状态无效或已过期");
  }
  return id;
}

function publicOriginAllowsInsecure(config: OAuthConfig): boolean {
  const origin = new URL(config.publicOrigin);
  return origin.protocol === "http:" && isLoopback(origin.hostname);
}

function providerState(value: StoredOAuthState | undefined): OAuthRunnerRequest["providerState"] {
  if (!value) return undefined;
  return {
    clientInformation: value.clientInformation,
    tokens: value.tokens,
    tokenExpiresAt: value.tokenExpiresAt,
    codeVerifier: value.codeVerifier,
    discovery: value.discovery,
  };
}

function nextOAuthState(
  generation: string,
  result: OAuthRunnerResult,
  challenge?: OAuthChallenge,
): StoredOAuthState {
  const state = record(result.state) ?? {};
  return {
    version: 1,
    generation,
    ...(record(state.clientInformation) ? { clientInformation: state.clientInformation as Record<string, unknown> } : {}),
    ...(record(state.tokens) ? { tokens: state.tokens as Record<string, unknown> } : {}),
    ...(Number.isFinite(state.tokenExpiresAt) ? { tokenExpiresAt: state.tokenExpiresAt as number } : {}),
    ...(typeof state.codeVerifier === "string" ? { codeVerifier: state.codeVerifier } : {}),
    ...(record(state.discovery) ? { discovery: state.discovery as Record<string, unknown> } : {}),
    ...(challenge ? { challenge } : {}),
  };
}

function hasAccessToken(result: OAuthRunnerResult): boolean {
  const state = record(result.state);
  const tokens = record(state?.tokens);
  return typeof tokens?.access_token === "string" && tokens.access_token.length > 0;
}

function oauthRequest(
  row: ConnectorRow,
  secret: ConnectorSecret,
  config: OAuthConfig,
  operation: OAuthRunnerRequest["operation"],
  extra: Partial<OAuthRunnerRequest> = {},
): OAuthRunnerRequest {
  const oauth = oauthConfig(row.data);
  if (!oauth.enabled) fail(409, "MCP_OAUTH_NOT_ENABLED", "该连接器未启用 OAuth");
  return {
    operation,
    serverUrl: remoteUrl(row.data, config),
    redirectUrl: callbackUrl(config),
    clientId: oauth.clientId,
    clientSecret: typeof secret.oauthClientSecret === "string" ? secret.oauthClientSecret : undefined,
    scope: oauth.scope,
    allowInsecureLoopback: publicOriginAllowsInsecure(config),
    ...extra,
  };
}

async function interactiveRow(
  queryable: Queryable,
  ownerId: string,
  sessionId: string,
  identifier: string,
  lock = true,
): Promise<ConnectorRow> {
  const byId = UUID.test(identifier);
  const result = await queryable.query<ConnectorRow>(
    `SELECT r.id,r.owner_id,r.name,r.data,r.secret,true AS session_valid
       FROM resources r
       JOIN users u ON u.id=r.owner_id AND u.disabled_at IS NULL
       JOIN sessions s ON s.owner_id=r.owner_id AND s.id=$3 AND s.expires_at>now()
      WHERE r.owner_id=$2 AND r.kind='connector' AND r.deleted_at IS NULL
        AND ${byId ? "r.id=$1" : "lower(r.name)=lower($1)"}
      ${lock ? "FOR UPDATE OF r" : ""}`,
    [identifier, ownerId, sessionId],
  );
  if (result.rows.length !== 1) fail(404, "MCP_CONNECTOR_NOT_FOUND", "连接器不存在或会话已失效");
  return result.rows[0];
}

async function runtimeRow(queryable: Queryable, ownerId: string, id: string, lock = false): Promise<ConnectorRow> {
  if (!UUID.test(id)) fail(404, "MCP_CONNECTOR_NOT_FOUND", "连接器不存在");
  const result = await queryable.query<ConnectorRow>(
    `SELECT r.id,r.owner_id,r.name,r.data,r.secret
       FROM resources r JOIN users u ON u.id=r.owner_id AND u.disabled_at IS NULL
      WHERE r.id=$1 AND r.owner_id=$2 AND r.kind='connector' AND r.deleted_at IS NULL
      ${lock ? "FOR UPDATE OF r" : ""}`,
    [id, ownerId],
  );
  if (!result.rows[0]) fail(404, "MCP_CONNECTOR_NOT_FOUND", "连接器不存在");
  return result.rows[0];
}

async function saveSecret(queryable: Queryable, row: ConnectorRow, secret: ConnectorSecret, config: OAuthConfig): Promise<void> {
  const result = await queryable.query(
    "UPDATE resources SET secret=$1,updated_at=now() WHERE id=$2 AND owner_id=$3 AND deleted_at IS NULL RETURNING id",
    [seal(secret, config.encryptionKey), row.id, row.owner_id],
  );
  if (result.rowCount !== 1) fail(409, "MCP_CONNECTOR_CHANGED", "连接器配置已更改，请重试");
}

function assertChallenge(
  state: StoredOAuthState | undefined,
  expected: { generation?: string; ownerId: string; sessionId: string; connectorId: string; revision: string; state?: string; status?: OAuthChallenge["status"] },
  now: number,
): OAuthChallenge {
  const challenge = state?.challenge;
  if (
    !state ||
    (expected.generation && state.generation !== expected.generation) ||
    !challenge ||
    challenge.ownerId !== expected.ownerId ||
    challenge.sessionId !== expected.sessionId ||
    challenge.connectorId !== expected.connectorId ||
    challenge.connectorRevision !== expected.revision ||
    challenge.expiresAt <= now ||
    (expected.status && challenge.status !== expected.status) ||
    (expected.state && !equalHash(challenge.stateHash, stateHash(expected.state)))
  ) {
    fail(400, "MCP_OAUTH_STATE_INVALID", "授权状态无效或已过期");
  }
  return challenge;
}

export interface McpOAuthService {
  begin(identifier: string, signal?: AbortSignal): Promise<OAuthStatus>;
  callback(input: { state: string; code?: string; error?: string }, signal?: AbortSignal): Promise<void>;
  cancel(identifier: string): Promise<OAuthStatus>;
  logout(identifier: string, signal?: AbortSignal): Promise<OAuthStatus>;
  status(identifier: string): Promise<OAuthStatus>;
}

export function createMcpOAuthService(dependencies: {
  database: Database;
  config: OAuthConfig;
  ownerId: string;
  sessionId: string;
  runOAuth?: OAuthRunner;
  now?: () => number;
}): McpOAuthService {
  const { database, config, ownerId, sessionId } = dependencies;
  const runOAuth = dependencies.runOAuth ?? ((request, signal) => runOAuthInSandbox(config as Config, request, signal));
  const now = dependencies.now ?? Date.now;

  return {
    async begin(identifier, signal) {
      const prepared = await database.transaction(async (client) => {
        const row = await interactiveRow(client, ownerId, sessionId, identifier);
        const secret = openSecret(row, config);
        if (!oauthConfig(row.data).enabled) {
          if (record(row.data.oauth)?.enabled === false) fail(409, 'MCP_OAUTH_NOT_ENABLED', '该连接器已禁用 OAuth');
          // Clicking authorization enables standard OAuth explicitly. Rotate
          // config revision to fence older probes and running task snapshots.
          row.data = { ...row.data, oauth: { ...record(row.data.oauth), enabled: true }, revision: randomUUID() };
          delete row.data.connection;
          await client.query('UPDATE resources SET data=$1::jsonb,updated_at=now() WHERE id=$2 AND owner_id=$3 AND deleted_at IS NULL', [JSON.stringify(row.data), row.id, ownerId]);
        }
        const connectorRevision = revision(row.data);
        oauthRequest(row, secret, config, "begin");
        const state = challengeState(row.id);
        const generation = randomUUID();
        secret.oauthState = {
          version: 1,
          generation,
          ...providerState(secret.oauthState),
          challenge: {
            status: "preparing",
            ownerId,
            sessionId,
            connectorId: row.id,
            connectorRevision,
            stateHash: stateHash(state),
            expiresAt: now() + CHALLENGE_TTL_MS,
          },
        };
        await saveSecret(client, row, secret, config);
        return { row, secret, state, generation, connectorRevision };
      });

      let result: OAuthRunnerResult;
      try {
        result = await runOAuth(oauthRequest(prepared.row, prepared.secret, config, "begin", {
          state: prepared.state,
          providerState: providerState(prepared.secret.oauthState),
        }), signal);
      } catch {
        await clearMatchingChallenge(database, config, prepared.row.id, ownerId, sessionId, prepared.generation).catch(() => undefined);
        fail(502, "MCP_OAUTH_UNAVAILABLE", "OAuth 服务暂时不可用，请稍后重试");
      }
      const authorizationUrl = validateAuthorizationUrl(result.authorizationUrl, prepared.state, config);
      await database.transaction(async (client) => {
        const row = await interactiveRow(client, ownerId, sessionId, prepared.row.id);
        if (revision(row.data) !== prepared.connectorRevision) fail(409, "MCP_CONNECTOR_CHANGED", "连接器配置已更改，请重试");
        const secret = openSecret(row, config);
        const challenge = assertChallenge(secret.oauthState, {
          generation: prepared.generation,
          ownerId,
          sessionId,
          connectorId: row.id,
          revision: prepared.connectorRevision,
          status: "preparing",
        }, now());
        secret.oauthState = nextOAuthState(prepared.generation, result, {
          ...challenge,
          status: "pending",
          authorizationUrl,
        });
        await saveSecret(client, row, secret, config);
      });
      return { state: "authorizing", url: authorizationUrl };
    },

    async callback(input, signal) {
      const connectorId = connectorFromState(input.state);
      if (input.error) {
        await database.transaction(async (client) => {
          const row = await interactiveRow(client, ownerId, sessionId, connectorId);
          const connectorRevision = revision(row.data);
          const secret = openSecret(row, config);
          assertChallenge(secret.oauthState, {
            ownerId,
            sessionId,
            connectorId,
            revision: connectorRevision,
            state: input.state,
            status: "pending",
          }, now());
          secret.oauthState = {
            ...secret.oauthState!,
            generation: randomUUID(),
            challenge: undefined,
            codeVerifier: undefined,
          };
          await saveSecret(client, row, secret, config);
        });
        fail(400, "MCP_OAUTH_DENIED", "OAuth 授权未完成");
      }
      if (typeof input.code !== "string" || !input.code || input.code.length > 20_000) {
        fail(400, "MCP_OAUTH_DENIED", "OAuth 授权未完成");
      }
      const consumed = await database.transaction(async (client) => {
        const row = await interactiveRow(client, ownerId, sessionId, connectorId);
        const connectorRevision = revision(row.data);
        const secret = openSecret(row, config);
        const challenge = assertChallenge(secret.oauthState, {
          ownerId,
          sessionId,
          connectorId,
          revision: connectorRevision,
          state: input.state,
          status: "pending",
        }, now());
        const generation = secret.oauthState!.generation;
        secret.oauthState = { ...secret.oauthState!, challenge: { ...challenge, status: "exchanging", authorizationUrl: undefined } };
        await saveSecret(client, row, secret, config);
        return { row, secret, generation, connectorRevision };
      });

      let result: OAuthRunnerResult;
      try {
        result = await runOAuth(oauthRequest(consumed.row, consumed.secret, config, "exchange", {
          state: input.state,
          authorizationCode: input.code,
          providerState: providerState(consumed.secret.oauthState),
        }), signal);
      } catch {
        await clearMatchingChallenge(database, config, connectorId, ownerId, sessionId, consumed.generation).catch(() => undefined);
        fail(502, "MCP_OAUTH_UNAVAILABLE", "OAuth 服务暂时不可用，请重新授权");
      }
      if (!hasAccessToken(result)) fail(502, "MCP_OAUTH_UNAVAILABLE", "OAuth 服务未返回有效凭据");
      await database.transaction(async (client) => {
        const row = await interactiveRow(client, ownerId, sessionId, connectorId);
        if (revision(row.data) !== consumed.connectorRevision) fail(409, "MCP_CONNECTOR_CHANGED", "连接器配置已更改，请重新授权");
        const secret = openSecret(row, config);
        assertChallenge(secret.oauthState, {
          generation: consumed.generation,
          ownerId,
          sessionId,
          connectorId,
          revision: consumed.connectorRevision,
          state: input.state,
          status: "exchanging",
        }, now());
        secret.oauthState = nextOAuthState(consumed.generation, result);
        await saveSecret(client, row, secret, config);
      });
    },

    async cancel(identifier) {
      await database.transaction(async (client) => {
        const row = await interactiveRow(client, ownerId, sessionId, identifier);
        const secret = openSecret(row, config);
        const previous = secret.oauthState;
        secret.oauthState = {
          version: 1,
          generation: randomUUID(),
          ...providerState(previous),
          challenge: undefined,
          codeVerifier: undefined,
        };
        await saveSecret(client, row, secret, config);
      });
      return { state: "cancelled" };
    },

    async logout(identifier, signal) {
      const revoked = await database.transaction(async (client) => {
        const row = await interactiveRow(client, ownerId, sessionId, identifier);
        const secret = openSecret(row, config);
        const oldState = secret.oauthState;
        secret.oauthState = { version: 1, generation: randomUUID() };
        await saveSecret(client, row, secret, config);
        await client.query("UPDATE resources SET data=data-'connection',updated_at=now() WHERE id=$1 AND owner_id=$2 AND deleted_at IS NULL", [row.id, ownerId]);
        return { row, secret, oldState };
      });
      if (revoked.oldState?.tokens) {
        await runOAuth(oauthRequest(revoked.row, revoked.secret, config, "revoke", {
          providerState: providerState(revoked.oldState),
        }), signal).catch(() => undefined);
      }
      return { state: "idle" };
    },

    async status(identifier) {
      return database.transaction(async (client) => {
        const row = await interactiveRow(client, ownerId, sessionId, identifier, false);
        const state = openSecret(row, config).oauthState;
        const challenge = state?.challenge;
        if (challenge && challenge.ownerId === ownerId && challenge.sessionId === sessionId && challenge.expiresAt > now()) {
          return challenge.status === "preparing"
            ? { state: "connecting" }
            : { state: "authorizing", ...(challenge.authorizationUrl ? { url: challenge.authorizationUrl } : {}) };
        }
        if (state?.tokens && typeof state.tokens.access_token === "string") return { state: "authorized" };
        return { state: "idle" };
      });
    },
  };
}

async function clearMatchingChallenge(
  database: Database,
  config: OAuthConfig,
  connectorId: string,
  ownerId: string,
  sessionId: string,
  generation: string,
): Promise<void> {
  await database.transaction(async (client) => {
    const row = await interactiveRow(client, ownerId, sessionId, connectorId);
    const secret = openSecret(row, config);
    if (secret.oauthState?.generation !== generation) return;
    secret.oauthState = { ...secret.oauthState, generation: randomUUID(), challenge: undefined, codeVerifier: undefined };
    await saveSecret(client, row, secret, config);
  });
}

function validateAuthorizationUrl(value: unknown, expectedState: string, config: OAuthConfig): string {
  if (typeof value !== "string" || value.length > 20_000) fail(502, "MCP_OAUTH_UNAVAILABLE", "OAuth 服务返回了无效授权地址");
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    fail(502, "MCP_OAUTH_UNAVAILABLE", "OAuth 服务返回了无效授权地址");
  }
  if (parsed.username || parsed.password || !["http:", "https:"].includes(parsed.protocol)) {
    fail(502, "MCP_OAUTH_UNAVAILABLE", "OAuth 服务返回了无效授权地址");
  }
  if (parsed.protocol !== "https:" && !(publicOriginAllowsInsecure(config) && isLoopback(parsed.hostname))) {
    fail(502, "MCP_OAUTH_UNAVAILABLE", "OAuth 服务返回了不安全的授权地址");
  }
  if (parsed.searchParams.get("state") !== expectedState) fail(502, "MCP_OAUTH_UNAVAILABLE", "OAuth 服务返回的授权状态不匹配");
  return parsed.toString();
}

function tokenAuthorizedConnector(row: ConnectorRow, secret: ConnectorSecret): AuthorizedConnector {
  if (row.data.transport === "stdio") {
    if (typeof row.data.command !== "string") fail(409, "MCP_CONNECTOR_INVALID", "连接器配置无效");
    return {
      transport: "stdio",
      command: row.data.command,
      args: Array.isArray(row.data.args) ? row.data.args.filter((item): item is string => typeof item === "string") : [],
      env: stringRecord(secret.env),
    };
  }
  if ((row.data.transport !== "http" && row.data.transport !== "sse") || typeof row.data.url !== "string") {
    fail(409, "MCP_CONNECTOR_INVALID", "连接器配置无效");
  }
  const headers = stringRecord(secret.headers);
  const oauth = oauthConfig(row.data);
  if (oauth.enabled || (record(row.data.oauth)?.enabled !== false && secret.oauthState?.tokens)) {
    const tokens = secret.oauthState?.tokens;
    const accessToken = tokens?.access_token;
    if (typeof accessToken !== "string" || !accessToken || accessToken.includes("\r") || accessToken.includes("\n")) {
      fail(409, "MCP_OAUTH_REQUIRED", "连接器需要重新授权");
    }
    const tokenType = typeof tokens?.token_type === "string" && /^[A-Za-z][A-Za-z0-9._~-]{0,31}$/.test(tokens.token_type)
      ? tokens.token_type
      : "Bearer";
    for (const key of Object.keys(headers)) if (key.toLowerCase() === "authorization") delete headers[key];
    headers.Authorization = `${tokenType} ${accessToken}`;
  }
  return { transport: row.data.transport, url: row.data.url, headers };
}

export async function getAuthorizedConnector(
  database: Database,
  config: Config,
  ownerId: string,
  id: string,
  expectedData?: Record<string, unknown>,
  runtimeArguments?: Record<string, unknown>,
): Promise<AuthorizedConnector> {
  let row = await runtimeRow(database, ownerId, id);
  if (row.data.enabled === false) fail(409, "MCP_CONNECTOR_DISABLED", "连接器已停用");
  const currentRevision = revision(row.data);
  if (expectedData && revision(expectedData) !== currentRevision) {
    fail(409, "MCP_CONNECTOR_CHANGED", "连接器配置已更改，请重新运行");
  }
  let secret = openSecret(row, config);

  const oauth = oauthConfig(row.data);
  const authorizedOAuth = oauth.enabled || (record(row.data.oauth)?.enabled !== false && Boolean(secret.oauthState?.tokens));
  if (authorizedOAuth) remoteUrl(row.data, config);
  const expiresAt = secret.oauthState?.tokenExpiresAt;
  if (authorizedOAuth && typeof expiresAt === "number" && expiresAt <= Date.now() + REFRESH_SKEW_MS) {
    const generation = secret.oauthState?.generation;
    const refreshToken = secret.oauthState?.tokens?.refresh_token;
    if (!generation || typeof refreshToken !== "string" || !refreshToken) {
      fail(409, "MCP_OAUTH_REQUIRED", "连接器授权已过期，请重新授权");
    }
    let refreshed: OAuthRunnerResult;
    try {
      refreshed = await runOAuthInSandbox(config, oauthRequest(row, secret, config, "refresh", {
        providerState: providerState(secret.oauthState),
      }));
    } catch {
      fail(409, "MCP_OAUTH_REQUIRED", "连接器授权已过期，请重新授权");
    }
    if (!hasAccessToken(refreshed)) fail(409, "MCP_OAUTH_REQUIRED", "连接器需要重新授权");
    await database.transaction(async (client) => {
      const locked = await runtimeRow(client, ownerId, id, true);
      if (revision(locked.data) !== currentRevision) fail(409, "MCP_CONNECTOR_CHANGED", "连接器配置已更改，请重新运行");
      const lockedSecret = openSecret(locked, config);
      if (lockedSecret.oauthState?.generation !== generation) fail(409, "MCP_OAUTH_REQUIRED", "连接器授权已变更，请重试");
      lockedSecret.oauthState = nextOAuthState(randomUUID(), refreshed);
      await saveSecret(client, locked, lockedSecret, config);
      row = locked;
      secret = lockedSecret;
    });
  }
  return tokenAuthorizedConnector(row, secret);
}

export async function runOAuthInSandbox(
  config: Config,
  request: OAuthRunnerRequest,
  signal?: AbortSignal,
): Promise<OAuthRunnerResult> {
  const serialized = Buffer.from(JSON.stringify(request), "utf8");
  if (serialized.byteLength > MAX_OAUTH_REQUEST_BYTES) throw new Error("OAuth request is too large");
  const timeoutSeconds = Number.isSafeInteger(config.sandboxTimeoutSeconds) && config.sandboxTimeoutSeconds > 0
    ? Math.min(config.sandboxTimeoutSeconds, 120)
    : 60;
  const timeout = AbortSignal.timeout(timeoutSeconds * 1000);
  const operationSignal = signal ? AbortSignal.any([signal, timeout]) : timeout;
  const operationId = randomUUID();
  const path = `/workspace/.oauth-request-${operationId}.json`;
  let sandbox: Awaited<ReturnType<typeof createSandbox>> | undefined;
  let result: OAuthRunnerResult | undefined;
  let operationError: unknown;
  try {
    sandbox = await createSandbox(config, operationId, operationSignal);
    await sandbox.write(path, serialized);
    const execution = await sandbox.exec(`node ${OAUTH_RUNNER} ${path}`, operationSignal);
    if (execution.exitCode !== 0) throw new Error("OAuth sandbox operation failed");
    const parsed = JSON.parse(execution.stdout) as unknown;
    if (!record(parsed)) throw new Error("OAuth sandbox returned an invalid response");
    result = parsed as OAuthRunnerResult;
  } catch (error) {
    operationError = error;
  } finally {
    if (sandbox) {
      await sandbox.destroy().catch((error) => { operationError ??= error; });
    }
    await reconcileRunSandboxes(config, operationId).catch((error) => { operationError ??= error; });
  }
  if (operationError) throw new Error("OAuth sandbox operation failed", { cause: operationError });
  if (!result) throw new Error("OAuth sandbox returned no response");
  return result;
}
