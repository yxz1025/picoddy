import assert from 'node:assert/strict';
import test from 'node:test';
import { EventEmitter } from 'node:events';
import { Readable } from 'node:stream';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { createApplication } from '../src/application.ts';
import { loadConfig } from '../src/config.ts';
import type { Database } from '../src/infra/db.ts';
import { SESSION_COOKIE } from '../src/cloud/auth/service.ts';

const config = loadConfig({ DATABASE_URL: 'postgres://unused/unused', PUBLIC_ORIGIN: 'http://localhost:8080', ENCRYPTION_KEY: 'a'.repeat(64), SANDBOX_DOMAIN: 'http://localhost:8090', SANDBOX_API_KEY: 'unused' });

test('SSE delivers the next token promptly after an empty poll, preserving its cursor', async () => {
  let polls = 0;
  let emptyAt = 0;
  let deliveredAt = 0;
  const chunks: string[] = [];
  const query = async (sql: string) => {
    if (sql.includes('FROM sessions s')) return { rows: [{ id: 'owner', sessionId: 'session' }], rowCount: 1 };
    if (sql.includes('FROM events')) {
      if (++polls === 1) { emptyAt = performance.now(); return { rows: [], rowCount: 0 }; }
      return { rows: [{ id: '12', run_id: '11111111-1111-4111-8111-111111111111', type: 'text_delta', payload: { text: '你好' }, created_at: new Date() }], rowCount: 1 };
    }
    return { rows: [{ id: 'run' }], rowCount: 1 };
  };
  const database = { query } as unknown as Database;
  const app = createApplication(config, { database });
  const request = Readable.from([]) as unknown as IncomingMessage;
  Object.assign(request, { method: 'GET', url: '/api/runs/11111111-1111-4111-8111-111111111111/events', headers: { cookie: `${SESSION_COOKIE}=test-session` } });
  let ended!: () => void;
  const finished = new Promise<void>(resolve => { ended = resolve; });
  const emitter = new EventEmitter();
  const response = Object.assign(emitter, {
    destroyed: false, writableEnded: false,
    writeHead() {}, flushHeaders() {},
    write(chunk: string) {
      chunks.push(chunk);
      if (chunk.includes('event: update')) { deliveredAt = performance.now(); this.destroyed = true; emitter.emit('close'); }
      return true;
    },
    end() { this.writableEnded = true; ended(); },
  });
  await app.handleApi(request, response as unknown as ServerResponse);
  await finished;
  assert.ok(deliveredAt > emptyAt);
  assert.ok(deliveredAt - emptyAt < 300, `Token waited ${Math.round(deliveredAt - emptyAt)}ms after an empty poll`);
  assert.match(chunks.join(''), /id: 12\nevent: update/);
  assert.match(chunks.join(''), /你好/);
  assert.equal(polls, 2);
});
