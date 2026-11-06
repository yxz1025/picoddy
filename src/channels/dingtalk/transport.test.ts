import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDingTalkTransport, type StreamClient } from './transport.ts';

function fakeClient() {
  let callback: unknown;
  let disconnects = 0;
  const client: StreamClient = {
    config: { autoReconnect: true }, connected: false,
    async getEndpoint() {}, async _connect() { client.connected = true; },
    disconnect() { disconnects++; client.connected = false; },
    registerCallbackListener(_topic, cb) { callback = cb; }, socketCallBackResponse() {},
  };
  return { client, get disconnects() { return disconnects; }, get callback() { return callback; } };
}

test('reconnect uses a fresh SDK client and cannot reopen after disconnect', async () => {
  const clients: ReturnType<typeof fakeClient>[] = [];
  const states: string[] = [];
  const transport = createDingTalkTransport('id', 'key', s => states.push(s), { createClient: () => { const f = fakeClient(); clients.push(f); return f.client; }, monitorIntervalMs: 5 });
  transport.listen(async () => {});
  await transport.connect();
  clients[0].client.connected = false;
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(clients.length, 2);
  assert.notEqual(clients[0].client, clients[1].client);
  await transport.disconnect();
  await new Promise(resolve => setTimeout(resolve, 15));
  assert.equal(clients.length, 2);
  assert.ok(states.includes('reconnecting')); assert.ok(states.includes('connected'));
});
