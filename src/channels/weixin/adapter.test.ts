import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createWeixinFactory } from './adapter.ts';
const tick = () => new Promise(resolve => setImmediate(resolve));
test('owner-only private text is deduplicated, reply contexts stay scoped and disconnect aborts polling', async () => {
  const received: any[] = []; const sends: any[] = []; let cursor = ''; let polls = 0; let signal: AbortSignal | undefined;
  const message = { message_id: 'm1', from_user_id: 'owner', message_type: 1, message_state: 2, context_token: 'context', item_list: [{ type: 1, text_item: { text: '查库存' } }] };
  const api = { async post(endpoint: string, body: any, opts: any) {
    if (endpoint === 'sendmessage') { sends.push(body); return {}; }
    polls++; signal = opts.signal;
    if (polls === 1) return { msgs: [message, message, { ...message, message_id: 'foreign', from_user_id: 'other' }, { ...message, message_id: 'group', group_id: 'g' }, { ...message, message_id: 'image', item_list: [{type: 2}] }, { ...message, message_id:'mixed', item_list:[{type:1,text_item:{text:'不完整'}},{type:2}] }], get_updates_buf: 'next' };
    return new Promise((_resolve, reject) => opts.signal.addEventListener('abort', () => reject(opts.signal.reason), { once: true }));
  } };
  const factory = createWeixinFactory({ api: api as any, load: async () => ({ cursor, seen: [] }), save: async (_id, state) => { cursor = state.cursor; } });
  const adapter = factory.create({ connection: { id: 'wx', channelId: 'weixin', name: '微信', config: {} }, credentials: {botId:'bot', ownerId:'owner',token:'secret',baseUrl:'https://ilinkai.weixin.qq.com'}, async onMessage(message) { received.push(message); }, onStatus() {} });
  await adapter.connect(); await tick();
  assert.equal(received.length, 1); assert.equal(received[0].text, '查库存'); assert.equal(cursor, 'next');
  await assert.rejects(() => adapter.send({ conversationId: 'other', replyTo: 'm1', text: 'wrong' }));
  await adapter.send({ conversationId: 'owner', replyTo: 'm1', text: '答案' });
  assert.equal(sends[0].msg.context_token, 'context'); assert.equal(sends[0].msg.to_user_id, 'owner');
  await adapter.disconnect(); assert.equal(signal?.aborted, true);
  assert.ok(!JSON.stringify(factory.publicIdentity!({ token:'secret',botId:'bot',ownerId:'owner'})).includes('secret'));
});

test('full poll-to-checkpoint pipeline accepts adjacent uint64 IDs without collision', async () => {
  const { WeixinApi } = await import('./api.ts');
  const ids: string[] = []; let saved: any;
  const raw = '{"msgs":[{"message_id":18446744073709551615,"from_user_id":"owner","message_type":1,"message_state":2,"context_token":"c","item_list":[{"type":1,"text_item":{"text":"one"}}]},{"message_id":18446744073709551614,"from_user_id":"owner","message_type":1,"message_state":2,"context_token":"c","item_list":[{"type":1,"text_item":{"text":"two"}}]}],"get_updates_buf":"next"}';
  const factory = createWeixinFactory({api:new WeixinApi(async()=>new Response(raw)),load:async()=>({cursor:'',seen:[]}),save:async(_account,state)=>{saved=state;}});
  const adapter = factory.create({connection:{id:'wx',channelId:'weixin',name:'微信',config:{}},credentials:{botId:'bot',ownerId:'owner',token:'token',baseUrl:'https://ilinkai.weixin.qq.com'},async onMessage(message){ids.push(message.id);},onStatus(){}});
  await adapter.connect(); await tick(); await adapter.disconnect();
  assert.deepEqual(ids,['18446744073709551615','18446744073709551614']);
  assert.deepEqual(saved.seen,ids); assert.equal(saved.cursor,'next');
});
