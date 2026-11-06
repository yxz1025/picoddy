import assert from 'node:assert/strict';
import test from 'node:test';
import { Readable } from 'node:stream';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { createApplication } from '../src/application.ts';
import { loadConfig } from '../src/config.ts';
import type { Database } from '../src/infra/db.ts';
import { SESSION_COOKIE } from '../src/cloud/auth/service.ts';

const config = loadConfig({ DATABASE_URL: 'postgres://unused/unused', PUBLIC_ORIGIN: 'http://localhost:8080', ENCRYPTION_KEY: 'a'.repeat(64), SANDBOX_DOMAIN: 'http://localhost:8090', SANDBOX_API_KEY: 'unused' });
const row = { id: '11111111-1111-4111-8111-111111111111', name: 'docs', data: { transport: 'http', url: 'https://example.test/mcp', revision: '22222222-2222-4222-8222-222222222222' }, updated_at: new Date() };

test('application routes authenticated MCP view instead of returning 404', async () => {
  const query = async (sql: string) => ({ rows: sql.includes('FROM sessions s') ? [{ id: 'owner', sessionId: 'session' }] : [row], rowCount: 1 });
  const database = { query, transaction: async (work: any) => work({ query }) } as unknown as Database;
  const app = createApplication(config, { database });
  const request = Readable.from([]) as unknown as IncomingMessage;
  Object.assign(request, { method: 'GET', url: '/api/mcp', headers: { cookie: `${SESSION_COOKIE}=test-session` } });
  const result = await new Promise<{ status: number; body: any }>(resolve => {
    let status = 0;
    const response = { writeHead(code: number) { status = code; }, end(body: string) { resolve({ status, body: JSON.parse(body) }); } } as unknown as ServerResponse;
    app.handleApi(request, response);
  });
  assert.equal(result.status, 200);
  assert.equal(result.body.data.config.mcpServers.docs.id, row.id);
});
