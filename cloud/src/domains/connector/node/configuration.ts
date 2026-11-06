import type { Config } from '../../../config.ts';
import type { Database } from '../../../infra/db.ts';
import { fail } from '../../../shared/errors.ts';
import { object, UUID } from '../../../shared/validation.ts';
import { createConnectorResourceService } from './service.ts';

const FIELDS = new Set(['id', 'name', 'revision', 'type', 'command', 'args', 'url', 'env', 'headers', 'staticHeaders',
  'enabled', 'disabled', 'displayName', 'description', 'exposure', 'toolExposure', 'oauth',
  'envConfigured', 'headersConfigured', 'authorizationConfigured']);

/** Save the desktop-shaped config atomically; credentials absent from the DTO remain encrypted. */
export async function saveConnectorConfiguration(database: Database, config: Config, ownerId: string, input: unknown) {
  const body = object(input);
  if (Object.keys(body).some(key => key !== 'mcpServers')) fail(400, 'INVALID_REQUEST', 'Unsupported MCP configuration field');
  const entries = Object.entries(object(body.mcpServers));
  if (entries.length > 100) fail(400, 'INVALID_REQUEST', 'Too many connectors');
  await database.transaction(async client => {
    await client.query('SELECT id FROM users WHERE id=$1 FOR UPDATE', [ownerId]);
    const scoped: Database = { query: (sql, values) => client.query(sql, values ? [...values] : undefined), transaction: work => work(client) };
    const resources = createConnectorResourceService({ database: scoped, config, ownerId });
    const current = await resources.list();
    const retained = new Set<string>();
    for (const [key, raw] of entries) {
      const server = object(raw);
      if (Object.keys(server).some(field => !FIELDS.has(field))) fail(400, 'INVALID_REQUEST', 'Unsupported MCP server configuration field');
      const matches = server.id !== undefined ? current.filter(row => row.id === server.id) : current.filter(row => row.name === key);
      if (server.id !== undefined && (typeof server.id !== 'string' || !UUID.test(server.id))) fail(400, 'INVALID_REQUEST', 'Invalid connector id');
      if (server.id !== undefined && !matches.length) fail(404, 'NOT_FOUND', 'Connector not found');
      if (matches.length > 1) fail(409, 'CONNECTOR_NAME_AMBIGUOUS', 'Connector name is ambiguous; use its id');
      const existing = matches[0];
      if (existing && retained.has(existing.id)) fail(400, 'INVALID_REQUEST', 'Connector id appears more than once');
      const name = existing && key === existing.id ? existing.name : key;
      const payload: Record<string, unknown> = { name, transport: server.type ?? (server.command ? 'stdio' : 'http') };
      for (const field of ['command', 'args', 'url', 'env', 'headers', 'displayName', 'description', 'exposure', 'toolExposure']) {
        if (Object.hasOwn(server, field)) payload[field] = server[field];
      }
      if (!Object.hasOwn(server, 'headers') && Object.hasOwn(server, 'staticHeaders')) payload.headers = server.staticHeaders;
      if (server.enabled !== undefined) payload.enabled = server.enabled;
      if (server.disabled !== undefined) {
        if (typeof server.disabled !== 'boolean') fail(400, 'INVALID_REQUEST', 'disabled must be a boolean');
        if (server.enabled !== undefined && server.enabled !== !server.disabled) fail(400, 'INVALID_REQUEST', 'enabled and disabled conflict');
        payload.enabled = !server.disabled;
      }
      if (Object.hasOwn(server, 'oauth')) {
        if (server.oauth === null) payload.oauth = null;
        else {
          const oauth = { ...object(server.oauth) };
          delete oauth.clientSecretConfigured;
          payload.oauth = oauth;
        }
      }
      if (existing) {
        if (server.revision !== undefined) {
          const locked = await client.query<{ data: Record<string, unknown> }>(
            "SELECT data FROM resources WHERE id=$1 AND owner_id=$2 AND kind='connector' AND deleted_at IS NULL FOR UPDATE", [existing.id, ownerId]);
          if (locked.rows[0]?.data.revision !== server.revision) fail(409, 'CONNECTOR_CHANGED', 'Connector configuration changed; reload and retry');
        }
        await resources.update(existing.id, payload);
        retained.add(existing.id);
      } else retained.add((await resources.create(payload)).id);
    }
    for (const row of current) if (!retained.has(row.id)) await resources.remove(row.id);
  });
}
