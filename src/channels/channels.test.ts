import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ChannelRegistry, ChannelManager, ChannelSessionRouter } from './index.ts';
import type { ChannelAdapterFactory, ChannelAdapterContext } from './index.ts';

const descriptor = { id: 'test', name: 'Test', configFields: [], credentialFields: [], capabilities: { attachments: false, streaming: false } } as const;

test('registry rejects duplicate channel types and unknown lookups', () => {
  const registry = new ChannelRegistry();
  const factory: ChannelAdapterFactory = { descriptor, create: () => ({ async connect() {}, async disconnect() {}, async send() {} }) };
  registry.register(factory);
  assert.equal(registry.list()[0].id, 'test');
  assert.throws(() => registry.register(factory), /registered/);
  assert.throws(() => registry.get('missing'), /Unknown/);
});

test('manager serializes duplicate connects and disconnect, scopes inbound messages', async () => {
  let connects = 0; let disconnects = 0; let context!: ChannelAdapterContext;
  const received: unknown[] = [];
  const registry = new ChannelRegistry();
  registry.register({ descriptor, create(ctx) { context = ctx; return {
    async connect() { connects++; }, async disconnect() { disconnects++; }, async send() {},
  }; } });
  const manager = new ChannelManager(registry, { async onMessage(message) { received.push(message); } });
  const connection = { id: 'mine', channelId: 'test', name: 'My bot', config: {} };
  await Promise.all([manager.connect(connection, {}), manager.connect(connection, {})]);
  assert.equal(connects, 1);
  await context.onMessage({ id: 'm1', conversationId: 'group', senderId: 'user', text: 'hello', timestamp: 1 });
  assert.deepEqual(received, [{ channelId: 'test', connectionId: 'mine', id: 'm1', conversationId: 'group', senderId: 'user', text: 'hello', timestamp: 1 }]);
  assert.equal(manager.getStatus('mine').state, 'connected');
  await manager.disconnect('mine');
  assert.equal(disconnects, 1);
  await assert.rejects(() => manager.send('mine', { conversationId: 'group', text: 'hi' }), /not connected/);
  await assert.rejects(() => context.onMessage({ id: 'late', conversationId: 'group', senderId: 'user', text: 'late', timestamp: 1 }), /inactive/);
});

test('failed connect cleans up adapter and permits retry without exposing SDK error', async () => {
  let attempts = 0; let cleanups = 0;
  const registry = new ChannelRegistry();
  registry.register({ descriptor, create() { return {
    async connect() { if (++attempts === 1) throw new Error('secret-token'); },
    async disconnect() { cleanups++; }, async send() {},
  }; } });
  const manager = new ChannelManager(registry, { async onMessage() {} });
  const connection = { id: 'mine', channelId: 'test', name: 'Bot', config: {} };
  await assert.rejects(() => manager.connect(connection, {}), /Channel connection failed/);
  assert.equal(cleanups, 1);
  assert.equal(manager.getStatus('mine').state, 'error');
  assert.ok(!JSON.stringify(manager.getStatus('mine')).includes('secret-token'));
  await manager.connect(connection, {});
  assert.equal(manager.getStatus('mine').state, 'connected');
  await manager.dispose();
});

test('session router serializes binding creation and isolates channel, connection and conversation', async () => {
  const bindings = new Map<string, string>(); let created = 0;
  const router = new ChannelSessionRouter({ async get(key) { return bindings.get(key); }, async set(key, id) { bindings.set(key, id); } }, async () => `session-${++created}`);
  const address = { channelId: 'test', connectionId: 'a', conversationId: 'group' };
  const [a, b] = await Promise.all([router.resolve(address), router.resolve(address)]);
  assert.equal(a, b); assert.equal(created, 1);
  assert.notEqual(a, await router.resolve({ ...address, connectionId: 'b' }));
  assert.notEqual(a, await router.resolve({ ...address, channelId: 'other' }));
  assert.notEqual(a, await router.resolve({ ...address, conversationId: 'other' }));
});
