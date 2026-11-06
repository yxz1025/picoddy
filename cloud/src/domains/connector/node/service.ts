import type { Config } from "../../../config.ts";
import { randomUUID } from 'node:crypto';
import { seal, unseal } from "../../../infra/crypto.ts";
import type { ResourceTransactionStore } from "../../resource/node/store.ts";
import {
  createResourceCrudService,
  type ResourceServiceDependencies,
} from "../../resource/node/service.ts";
import {
  basePublicResource,
  type PublicResource,
  type ResourceDraft,
  type ResourceRow,
} from "../../resource/node/types.ts";
import { bodyObject, optionalText, stringRecord, text } from "../../resource/node/validation.ts";
import { fail } from "../../../shared/errors.ts";

type ConnectorResourceConfig = Pick<Config, "encryptionKey">;

export interface ConnectorResourceDependencies extends ResourceServiceDependencies {
  config: ConnectorResourceConfig;
}

function secretRecord(row: ResourceRow, config: ConnectorResourceConfig): Record<string, unknown> {
  if (!row.secret) return {};
  const value = unseal(row.secret, config.encryptionKey);
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function validateRemoteUrl(value: string): void {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    fail(400, "INVALID_CONNECTOR_URL", "url must be a valid URL");
  }
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) {
    fail(
      400,
      "INVALID_CONNECTOR_URL",
      "Connector URL must use HTTP(S) without embedded credentials",
    );
  }
}

function connectorDraft(
  body: Record<string, unknown>,
  config: ConnectorResourceConfig,
  existingSecret: Record<string, unknown> = {},
): ResourceDraft {
  const name = text(body.name, "name", 200);
  if (!['stdio', 'http', 'sse'].includes(body.transport as string)) {
    fail(400, "INVALID_REQUEST", "transport must be stdio, http or sse");
  }
  const data: Record<string, unknown> = { transport: body.transport, revision: randomUUID() };
  if (body.enabled !== undefined && typeof body.enabled !== 'boolean') fail(400, 'INVALID_REQUEST', 'enabled must be a boolean');
  data.enabled = body.enabled ?? true;
  for (const field of ['displayName', 'description']) {
    const value = optionalText(body[field], field, field === 'description' ? 4000 : 200);
    if (value !== undefined) data[field] = value;
  }
  const exposures = ['direct', 'deferred', 'codemode', 'hidden'];
  if (body.exposure !== undefined) {
    if (!exposures.includes(body.exposure as string)) fail(400, 'INVALID_REQUEST', 'Invalid exposure');
    data.exposure = body.exposure;
  }
  if (body.toolExposure !== undefined) {
    const map = stringRecord(body.toolExposure, 'toolExposure')!;
    if (Object.values(map).some(value => !exposures.includes(value))) fail(400, 'INVALID_REQUEST', 'Invalid toolExposure');
    data.toolExposure = map;
  }
  const secrets: Record<string, unknown> = { ...existingSecret };
  if (body.oauth !== undefined) {
    if (body.oauth === null) { delete secrets.oauthClientSecret; delete secrets.oauthState; }
    else {
      const oauth = bodyObject(body.oauth);
      if (Object.keys(oauth).some(key => !['enabled', 'clientId', 'clientSecret', 'scope'].includes(key))) fail(400, 'INVALID_REQUEST', 'Unsupported OAuth configuration field');
      const publicOauth: Record<string, unknown> = {};
      if (oauth.enabled !== undefined) {
        if (typeof oauth.enabled !== 'boolean') fail(400, 'INVALID_REQUEST', 'oauth.enabled must be a boolean');
        publicOauth.enabled = oauth.enabled;
      }
      for (const field of ['clientId', 'scope']) {
        const value = optionalText(oauth[field], `oauth.${field}`, 2000);
        if (value !== undefined) publicOauth[field] = value;
      }
      if (oauth.clientSecret !== undefined) secrets.oauthClientSecret = optionalText(oauth.clientSecret, 'oauth.clientSecret', 20_000);
      data.oauth = publicOauth;
    }
  }
  if (body.transport === "stdio") {
    data.command = text(body.command, "command", 2_000);
    if (body.args !== undefined) {
      if (
        !Array.isArray(body.args) || body.args.length > 100 ||
        body.args.some((arg) => typeof arg !== "string" || arg.length > 10_000)
      ) {
        fail(400, "INVALID_REQUEST", "args must be an array of strings");
      }
      data.args = body.args;
    } else {
      data.args = [];
    }
  } else {
    const url = text(body.url, "url", 4_000);
    validateRemoteUrl(url);
    data.url = url;
  }
  secrets.env = stringRecord(body.env, "env") ?? {};
  secrets.headers = stringRecord(body.headers, "headers") ?? {};
  const secret = seal(secrets, config.encryptionKey);
  return { name, data, secret };
}

export function createConnectorResourceService(dependencies: ConnectorResourceDependencies) {
  function validateInput(body: Record<string, unknown>) {
    const fields = ['name', 'transport', 'command', 'args', 'url', 'env', 'headers', 'enabled', 'displayName', 'description', 'exposure', 'toolExposure', 'oauth'];
    if (Object.keys(body).some(key => !fields.includes(key))) fail(400, 'INVALID_REQUEST', 'Unsupported connector configuration field');
  }
  return createResourceCrudService(dependencies, {
    kind: "connector",
    async create(body: Record<string, unknown>, _transaction: ResourceTransactionStore) {
      validateInput(body);
      return connectorDraft(body, dependencies.config);
    },
    async update(existing: ResourceRow, patch) {
      validateInput(patch);
      const currentSecret = secretRecord(existing, dependencies.config);
      const merged: Record<string, unknown> = { name: existing.name, ...existing.data, ...patch };
      delete merged.envConfigured;
      delete merged.headersConfigured;
      merged.env = patch.env === undefined ? currentSecret.env ?? {} : patch.env;
      merged.headers = patch.headers === undefined ? currentSecret.headers ?? {} : patch.headers;
      const draft = connectorDraft(merged, dependencies.config, currentSecret);
      // Changing transport, endpoint, command or credentials invalidates the old
      // authorization. Display metadata changes keep tokens, never old probes.
      const changed = ['transport', 'url', 'command', 'args', 'env', 'headers', 'oauth'].some(field =>
        patch[field] !== undefined && JSON.stringify(patch[field]) !== JSON.stringify(
          ['env', 'headers'].includes(field) ? currentSecret[field] : existing.data[field]));
      if (changed) {
        const nextSecret = unseal(draft.secret!, dependencies.config.encryptionKey) as Record<string, unknown>;
        delete nextSecret.oauthState;
        draft.secret = seal(nextSecret, dependencies.config.encryptionKey);
      }
      return draft;
    },
    present(row): PublicResource {
      const result = basePublicResource(row);
      delete result.revision;
      // State is managed only by domain operations, never by browser config.
      const secret = secretRecord(row, dependencies.config);
      result.envConfigured = Object.keys((secret.env as object | undefined) ?? {}).length > 0;
      result.headersConfigured = Object.keys((secret.headers as object | undefined) ?? {}).length > 0;
      result.authorizationConfigured = Object.keys((secret.headers as object | undefined) ?? {}).some(key => key.toLowerCase() === 'authorization');
      return result;
    },
  });
}
