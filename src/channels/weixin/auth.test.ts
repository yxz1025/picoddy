import { test } from 'node:test';
import assert from 'node:assert/strict';
import { WeixinLogin } from './auth.ts';
import { WeixinApi } from './api.ts';
test('QR confirmation keeps credentials in main process and rejects unconfirmed use', async () => {
  const api = new WeixinApi(async url => new Response(JSON.stringify(String(url).includes('get_bot_qrcode')
    ? { qrcode: 'opaque', qrcode_img_content: 'https://weixin.qq.com/scan' }
    : { status: 'confirmed', bot_token: 'private-token', ilink_bot_id: 'bot', ilink_user_id: 'owner', baseurl: 'https://ilinkai.weixin.qq.com' })));
  const login = new WeixinLogin(api); const start = await login.start();
  assert.throws(() => login.credentials(start.loginId), /扫码/);
  assert.equal((await login.poll(start.loginId)).status, 'confirmed');
  assert.equal(JSON.stringify(await login.poll(start.loginId)).includes('private-token'), false);
  assert.equal(login.credentials(start.loginId).token, 'private-token');
  login.cancel(start.loginId); assert.throws(() => login.credentials(start.loginId));
});
test('redirect targets outside official origins never receive QR identifiers', async () => {
  let calls = 0;
  const login = new WeixinLogin(new WeixinApi(async url => {
    calls++; return new Response(JSON.stringify(String(url).includes('get_bot_qrcode') ? { qrcode: 'opaque', qrcode_img_content: 'qr' } : { status: 'scaned_but_redirect', redirect_host: 'evil.org' }));
  }));
  const start = await login.start(); await assert.rejects(() => login.poll(start.loginId), /官方/); assert.equal(calls, 2);
});

test('a temporary QR gateway failure retries the same authorization without losing confirmation', async () => {
  let polls = 0;
  const login = new WeixinLogin(new WeixinApi(async url => {
    if (String(url).includes('get_bot_qrcode')) return new Response(JSON.stringify({qrcode:'q',qrcode_img_content:'qr'}));
    if (++polls === 1) return new Response('gateway', {status:524});
    return new Response(JSON.stringify({status:'confirmed',bot_token:'token',ilink_bot_id:'bot',ilink_user_id:'owner'}));
  }));
  const start = await login.start();
  assert.equal((await login.poll(start.loginId)).status,'wait');
  assert.equal((await login.poll(start.loginId)).status,'confirmed');
  login.dispose();
});

test('closing authorization cancels an active QR long poll', async () => {
  let waiting: AbortSignal | undefined;
  const login = new WeixinLogin(new WeixinApi(async (url, init) => {
    if (String(url).includes('get_bot_qrcode')) return new Response(JSON.stringify({qrcode:'q',qrcode_img_content:'qr'}));
    waiting = init!.signal as AbortSignal;
    return new Promise((_resolve,reject)=>waiting!.addEventListener('abort',()=>reject(new Error('aborted')),{once:true}));
  }));
  const start = await login.start(); const poll = login.poll(start.loginId);
  login.cancel(start.loginId);
  await assert.rejects(()=>poll); assert.equal(waiting?.aborted,true);
  assert.throws(()=>login.credentials(start.loginId));
});
