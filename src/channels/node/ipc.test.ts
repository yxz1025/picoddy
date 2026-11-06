import { test } from 'node:test';
import assert from 'node:assert/strict';
import { registerChannelIpc } from './ipc.ts';

// Only the trusted top-level main window may configure credentials; no HTTP fallback exists.
test('IPC rejects untrusted frames before loading credentials and validates configuration', async () => {
  const handlers = new Map<string, (...args: any[]) => any>();
  const frame = {}; const contents = { mainFrame: frame, isDestroyed: () => false };
  let loads = 0; let configured: unknown;
  const service = {
    snapshot: () => ({ channels: [], connections: [] }),
    async configure(connection: unknown, credentials: unknown) { configured = { connection, credentials }; },
    async disconnect() {}, async reconnect() {}, async reconfigure() {},
  };
  registerChannelIpc((name, fn) => handlers.set(name, fn), () => ({ isDestroyed: () => false, webContents: contents }), async () => { loads++; return service; });
  await assert.rejects(() => handlers.get('channels.snapshot')!({ sender: contents, senderFrame: {} }), /不可信/);
  assert.equal(loads, 0);
  const event = { sender: contents, senderFrame: frame };
  await assert.rejects(() => handlers.get('channels.connect')!(event, { channelId: 'other' }), /无效/);
  await handlers.get('channels.connect')!(event, { id: 'bot', channelId: 'dingtalk', clientId: ' id ', clientSecret: ' key ', config: { allowedSenderIds: 'u' } });
  assert.deepEqual(configured, { connection: { id: 'bot', channelId: 'dingtalk', name: '钉钉机器人', config: { allowedConversationIds: '', allowedSenderIds: 'u' } }, credentials: { clientId: 'id', clientSecret: 'key' } });
});

test('Weixin authorization is trusted-window-only and tokens stay out of IPC responses', async () => {
  const { WeixinLogin } = await import('../weixin/auth.ts');
  const { WeixinApi } = await import('../weixin/api.ts');
  const login = new WeixinLogin(new WeixinApi(async url => new Response(JSON.stringify(String(url).includes('get_bot_qrcode')
    ? {qrcode:'q',qrcode_img_content:'https://weixin.qq.com/test'}
    : {status:'confirmed',bot_token:'private-token',ilink_bot_id:'bot',ilink_user_id:'owner',baseurl:'https://ilinkai.weixin.qq.com'}))));
  const handlers = new Map<string, (...args: any[]) => any>(); const frame = {}; const contents = {mainFrame:frame,isDestroyed:()=>false};
  const configured: any[] = []; const reconfigured: any[] = [];
  const service = { snapshot:()=>({channels:[],connections:[]}), async configure(...args: any[]) {configured.push(args);}, async reconfigure(connection: any) {reconfigured.push(connection);}, async disconnect(){},async reconnect(){} };
  registerChannelIpc((name,fn)=>handlers.set(name,fn),()=>({isDestroyed:()=>false,webContents:contents}),async()=>service, login);
  for (const action of ['start','poll','cancel']) await assert.rejects(()=>handlers.get(`channels.weixin.${action}`)!({sender:contents,senderFrame:{}},{}),/不可信/);
  const event = {sender:contents,senderFrame:frame};
  const start = await handlers.get('channels.weixin.start')!(event);
  assert.ok(start.qrImage.startsWith('data:image/png;base64,')); assert.equal(start.qrContent,undefined);
  const poll = await handlers.get('channels.weixin.poll')!(event,{loginId:start.loginId});
  assert.deepEqual(poll,{status:'confirmed'});
  const snapshot = await handlers.get('channels.connect')!(event,{id:'weixin-default',channelId:'weixin',loginId:start.loginId});
  assert.equal(configured[0][1].token,'private-token'); assert.ok(!JSON.stringify(snapshot).includes('private-token'));
  assert.throws(()=>login.credentials(start.loginId));
  await handlers.get('channels.connect')!(event,{id:'weixin-default',channelId:'weixin'});
  assert.equal(reconfigured.length,1);
});
