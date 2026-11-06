import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ChannelService } from './service.ts';
import { ChannelRegistry } from '../registry.ts';
import type { ChannelAdapterContext } from '../types.ts';
import type { ChannelLocalData } from './store.ts';

const descriptor = { id: 'dingtalk', name: '钉钉', configFields: [], credentialFields: [], capabilities: { attachments: false, streaming: false } } as const;
test('service persists secrets privately, isolates senders, filters groups and stops on disconnect', async () => {
  let saved: ChannelLocalData = { version: 1, connections: [], sessions: {} };
  let ctx!: ChannelAdapterContext; let turns = 0; const replies: unknown[] = [];
  const registry = new ChannelRegistry();
  registry.register({ descriptor, create(context) { ctx = context; return { async connect() {}, async disconnect() {}, async send(m) { replies.push(m); } }; } });
  const service = new ChannelService(registry, { async load() { return structuredClone(saved); }, async save(data) { saved = structuredClone(data); } }, async () => `session-${Math.random()}`, { async handle(input) { turns++; await input.reply({ conversationId: input.message.conversationId, text: 'done' }); } });
  await service.initialize();
  await service.configure({ id: 'dingtalk-default', channelId: 'dingtalk', name: 'Bot', config: { allowedConversationIds: 'group' } }, { clientId: 'id', clientSecret: 'secret' });
  assert.ok(!JSON.stringify(service.snapshot()).includes('secret'));
  const message = { id: '1', conversationId: 'group', senderId: 'u1', text: 'hi', timestamp: 1 };
  await ctx.onMessage(message);
  await service.idle();
  assert.equal(turns, 1); assert.equal(replies.length, 1);
  await ctx.onMessage({ ...message, id: '2', senderId: 'u2' }); await service.idle();
  assert.equal(Object.keys(saved.sessions).length, 2);
  await ctx.onMessage({ ...message, id: '3', conversationId: 'forbidden' }); await service.idle();
  assert.equal(turns, 2);
  await service.disconnect('dingtalk-default');
  assert.equal(saved.connections[0].enabled, false);
  await service.dispose();
});

test('other channels declare their own credential fields instead of DingTalk keys', async () => {
  const registry = new ChannelRegistry();
  registry.register({ descriptor: { ...descriptor, id: 'other', credentialFields: [{ key: 'token', label: 'Token', type: 'password', required: true }] }, create() { return { async connect() {}, async disconnect() {}, async send() {} }; } });
  const service = new ChannelService(registry, { async load() { return { version: 1, connections: [], sessions: {} }; }, async save() {} }, async () => 's', { async handle() {} });
  await service.initialize();
  await service.configure({ id: 'other-one', channelId: 'other', name: 'Other', config: {} }, { token: 'private' });
  assert.equal(service.snapshot().connections[0].status.state, 'connected');
  assert.ok(!('clientId' in service.snapshot().connections[0]));
  await service.dispose();
});

test('disconnect aborts active task and discards queued tasks before reconnect', async () => {
  let ctx!: ChannelAdapterContext; let began!: () => void;
  const started = new Promise<void>(resolve => { began = resolve; });
  let turns = 0;
  const registry = new ChannelRegistry();
  registry.register({ descriptor, create(context) { ctx = context; return { async connect() {}, async disconnect() {}, async send() {} }; } });
  const service = new ChannelService(registry, { async load() { return { version: 1, connections: [], sessions: {} }; }, async save() {} }, async () => 's', { async handle({ signal }) { turns++; began(); await new Promise<void>(resolve => signal.addEventListener('abort', () => resolve(), { once: true })); } });
  await service.initialize();
  await service.configure({ id: 'bot', channelId: 'dingtalk', name: 'Bot', config: {} }, { clientId: 'id', clientSecret: 'key' });
  const m = { id: 'one', conversationId: 'g', senderId: 'u', text: 'hello', timestamp: 1 };
  await ctx.onMessage(m); await started;
  await ctx.onMessage({ ...m, id: 'two' });
  await service.disconnect('bot'); await service.idle();
  assert.equal(turns, 1);
  await service.dispose();
});

test('disconnect stops transport even when persisting disabled state fails', async () => {
  let failSave = false; let stopped = 0;
  const registry = new ChannelRegistry();
  registry.register({ descriptor, create() { return { async connect() {}, async disconnect() { stopped++; }, async send() {} }; } });
  const service = new ChannelService(registry, { async load() { return { version: 1, connections: [], sessions: {} }; }, async save() { if (failSave) throw new Error('disk full'); } }, async () => 's', { async handle() {} });
  await service.initialize();
  await service.configure({ id: 'bot', channelId: 'dingtalk', name: 'Bot', config: {} }, { clientId: 'id', clientSecret: 'key' });
  failSave = true;
  await assert.rejects(() => service.disconnect('bot'), /disk full/);
  assert.equal(stopped, 1);
  assert.equal(service.snapshot().connections[0].status.state, 'disconnected');
});

test('knowledge binding reaches bridge and changing the vault starts an isolated conversation', async () => {
  let ctx!: ChannelAdapterContext; let sequence = 0;
  const sessions: string[] = []; const roots: string[] = [];
  const registry = new ChannelRegistry();
  registry.register({ descriptor, create(context) { ctx = context; return { async connect() {}, async disconnect() {}, async send() {} }; } });
  const service = new ChannelService(registry, { async load() { return { version: 1, connections: [], sessions: {} }; }, async save() {} }, async () => `s${++sequence}`, { async handle(input) { sessions.push(input.sessionId); roots.push(input.knowledge?.directory ?? ''); } });
  await service.initialize();
  const base = { id: 'bot', channelId: 'dingtalk', name: 'Bot', config: {} };
  const credentials = { clientId: 'id', clientSecret: 'key' };
  const message = { id: 'one', conversationId: 'g', senderId: 'u', text: '报销', timestamp: 1 };
  await service.configure({ ...base, knowledge: { kind: 'obsidian', directory: '/vault/a' } }, credentials);
  await ctx.onMessage(message); await service.idle();
  await service.configure({ ...base, knowledge: { kind: 'obsidian', directory: '/vault/b' } }, credentials);
  await ctx.onMessage({ ...message, id: 'two' }); await service.idle();
  assert.deepEqual(roots, ['/vault/a', '/vault/b']);
  assert.notEqual(sessions[0], sessions[1]);
  await service.dispose();
});

test('updating knowledge binding keeps a stored secret only for the same account', async () => {
  let data: ChannelLocalData = { version: 1, connections: [], sessions: {} };
  const registry = new ChannelRegistry();
  registry.register({ descriptor: { ...descriptor, credentialFields: [{ key: 'clientSecret', label: 'Secret', type: 'password', required: true }] }, accountId: c => c.clientId, create() { return { async connect() {}, async disconnect() {}, async send() {} }; } });
  const service = new ChannelService(registry, { async load() { return data; }, async save(next) { data = structuredClone(next); } }, async () => 's', { async handle() {} });
  await service.initialize();
  const base = { id: 'bot', channelId: 'dingtalk', name: 'Bot', config: {} };
  await service.configure(base, { clientId: 'id', clientSecret: 'saved-secret' });
  await service.configure({ ...base, knowledge: { kind: 'obsidian', directory: '/vault' } }, { clientId: 'id', clientSecret: '' });
  assert.equal(data.connections[0].credentials.clientSecret, 'saved-secret');
  await assert.rejects(() => service.configure(base, { clientId: 'different', clientSecret: '' }), /Secret/);
  await service.dispose();
});
