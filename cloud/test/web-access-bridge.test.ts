import assert from 'node:assert/strict';
import { once } from 'node:events';
import test from 'node:test';

const { createWebAccessServer } = await import(new URL('../runtime/web-access.mjs', import.meta.url).href);

test('bridge keeps MCP state, refuses unauthorized requests, bounds output and closes the client', async () => {
  const cache = new Map();
  let closed = 0;
  let calls = 0;
  const client = {
    async listTools() { return { tools: [{ name: 'web_search', inputSchema: { type: 'object' } }] }; },
    async callTool(input: any) {
      calls++;
      if (input.name === 'web_search') cache.set('same-id', 'full text');
      if (input.arguments.large) return { content: [{ type: 'text', text: 'x'.repeat(512 * 1024) }] };
      return { content: [{ type: 'text', text: cache.get(input.arguments.responseId ?? 'same-id') }] };
    },
  };
  const bridge = createWebAccessServer(client, 'test-token', async () => { closed++; });
  bridge.server.listen(0, '127.0.0.1'); await once(bridge.server, 'listening');
  const url = `http://127.0.0.1:${bridge.server.address().port}/`;
  const send = (input: unknown, token = 'test-token') => fetch(url, {
    method: 'POST', headers: { authorization: `Bearer ${token}` }, body: JSON.stringify(input),
  });
  try {
    assert.equal((await send({ action: 'list' }, 'wrong')).status, 403);
    assert.equal((await send({ action: 'call', name: 'bash', arguments: {} })).status, 502);
    assert.equal(calls, 0);
    await (await send({ action: 'call', name: 'web_search', arguments: { query: 'news' } })).json();
    const retrieved = await (await send({ action: 'call', name: 'get_search_content', arguments: { responseId: 'same-id' } })).json() as any;
    assert.equal(retrieved.content[0].text, 'full text');
    const large = await send({ action: 'call', name: 'web_search', arguments: { large: true } });
    assert.equal(large.status, 413);
    assert.deepEqual(await large.json(), { error: 'WEB_RESPONSE_TOO_LARGE' });
    assert.equal((await send({ action: 'list', excess: 'x'.repeat(256 * 1024) })).status, 413);
  } finally { await bridge.close(); }
  assert.equal(closed, 1);
});

test('disconnecting a request aborts the upstream MCP operation', async () => {
  let started!: () => void;
  let cancelled!: () => void;
  const began = new Promise<void>(resolve => { started = resolve; });
  const aborted = new Promise<void>(resolve => { cancelled = resolve; });
  const client = {
    async callTool(_args: any, _schema: any, options: any) {
      started();
      return new Promise((_resolve, reject) => options.signal.addEventListener('abort', () => { cancelled(); reject(new Error('cancelled')); }, { once: true }));
    },
  };
  const bridge = createWebAccessServer(client, 'token', async () => {});
  bridge.server.listen(0, '127.0.0.1'); await once(bridge.server, 'listening');
  const controller = new AbortController();
  const pending = fetch(`http://127.0.0.1:${bridge.server.address().port}/`, {
    method: 'POST', headers: { authorization: 'Bearer token' },
    body: JSON.stringify({ action: 'call', name: 'web_search', arguments: {} }), signal: controller.signal,
  }).catch(() => {});
  try {
    await began; controller.abort();
    await Promise.race([aborted, new Promise((_, reject) => setTimeout(() => reject(new Error('upstream not cancelled')), 2000))]);
    await pending;
  } finally { await bridge.close(); }
});
