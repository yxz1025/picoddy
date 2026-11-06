import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDingTalkFactory } from './adapter.ts';
import type { DingTalkTransport, DingTalkFrame } from './transport.ts';

function fixture(onMessage = async (_m: unknown) => {}) {
  let callback!: (frame: DingTalkFrame) => Promise<void>;
  const acks: string[] = []; const sent: unknown[] = [];
  const transport: DingTalkTransport = {
    async connect() {}, async disconnect() {},
    listen(cb) { callback = cb; }, ack(id) { acks.push(id); },
  };
  const factory = createDingTalkFactory(() => transport, async (_url, init) => {
    sent.push(JSON.parse(String(init?.body)));
    return new Response(JSON.stringify({ errcode: 0 }));
  });
  const adapter = factory.create({ connection: { id: 'a', channelId: 'dingtalk', name: 'Bot', config: {} }, credentials: { clientId: 'id', clientSecret: 'secret' }, onMessage, onStatus() {} });
  const frame = (overrides = {}) => ({ headers: { messageId: 'frame1' }, data: JSON.stringify({ msgId: 'm1', conversationId: 'group1', senderStaffId: 'u1', text: { content: 'hello' }, sessionWebhook: 'https://oapi.dingtalk.com/robot/sendBySession?session=x', ...overrides }) });
  return { adapter, receive: (f = frame()) => callback(f), acks, sent, frame };
}

test('accepts text once, ACKs duplicates, and replies via private webhook', async () => {
  const received: unknown[] = [];
  const f = fixture(async m => { received.push(m); });
  await f.adapter.connect(); await f.receive(); await f.receive();
  assert.equal(received.length, 1); assert.equal(f.acks.length, 2);
  assert.ok(!JSON.stringify(received).includes('sessionWebhook'));
  await f.adapter.send({ conversationId: 'group1', replyTo: 'm1', text: 'reply' });
  assert.deepEqual(f.sent, [{ msgtype: 'text', text: { content: 'reply' } }]);
  await f.adapter.disconnect();
  await assert.rejects(() => f.adapter.send({ conversationId: 'group1', text: 'late' }));
});

test('host rejection is retried without premature ACK or dedup', async () => {
  let count = 0;
  const f = fixture(async () => { if (++count === 1) throw new Error('queue full'); });
  await f.adapter.connect(); await f.receive();
  assert.equal(f.acks.length, 0);
  await f.receive(); assert.equal(count, 2); assert.equal(f.acks.length, 1);
});

test('rejects foreign webhook hosts and ACKs unsupported messages without invoking Agent', async () => {
  let count = 0; const f = fixture(async () => { count++; });
  await f.adapter.connect();
  await f.receive(f.frame({ sessionWebhook: 'https://attacker.example/secret' }));
  await f.receive(f.frame({ text: undefined }));
  assert.equal(count, 0); assert.equal(f.acks.length, 2);
});
