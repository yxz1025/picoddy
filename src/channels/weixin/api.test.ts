import { test } from 'node:test';
import assert from 'node:assert/strict';
import { WeixinApi, officialBaseUrl } from './api.ts';
test('only official HTTPS API origins are accepted', () => {
  assert.equal(officialBaseUrl('https://ilinkai.weixin.qq.com/'), 'https://ilinkai.weixin.qq.com');
  for (const value of ['http://ilinkai.weixin.qq.com', 'https://weixin.qq.com.evil.org', 'https://user@ilinkai.weixin.qq.com', 'https://ilinkai.weixin.qq.com/private']) assert.throws(() => officialBaseUrl(value));
});
test('authenticated calls use bounded requests, reject API errors and never follow redirects', async () => {
  let init: RequestInit | undefined;
  const api = new WeixinApi(async (_url, opts) => { init = opts; return new Response(JSON.stringify({ ret: -14, errmsg: 'secret server detail' })); });
  await assert.rejects(() => api.post('getupdates', {}, { token: 'private', baseUrl: 'https://ilinkai.weixin.qq.com' }), /登录已失效/);
  assert.equal(init?.redirect, 'error'); assert.equal((init?.headers as any).Authorization, 'Bearer private');
});

test('uint64 message IDs remain distinct and message text is never rewritten', async () => {
  const raw = '{"msgs":[{"message_id":18446744073709551615},{"message_id":18446744073709551614}],"text":"\\\"message_id\\\":123","get_updates_buf":"next"}';
  const api = new WeixinApi(async () => new Response(raw));
  const result = await api.post('getupdates', {});
  assert.deepEqual(result.msgs.map((message: any) => message.message_id), ['18446744073709551615','18446744073709551614']);
  assert.equal(result.text, '"message_id":123');
});

test('body disconnects and body timeouts are retryable, caller cancellation is not converted', async () => {
  const { WeixinTransientError } = await import('./api.ts');
  const broken = new WeixinApi(async()=>new Response(new ReadableStream({start(controller){controller.error(new TypeError('socket reset'));}})));
  await assert.rejects(()=>broken.post('getupdates',{}), WeixinTransientError);
  const stalled = new WeixinApi(async()=>new Response(new ReadableStream()));
  // Keep a referenced timer: AbortSignal.timeout alone does not keep node alive.
  const keepAlive = setTimeout(()=>{},1000);
  try { await assert.rejects(()=>stalled.post('getupdates',{}, {timeoutMs:5}), WeixinTransientError); }
  finally { clearTimeout(keepAlive); }
  const cancellation = new AbortController(); const stopped = stalled.post('getupdates',{}, {signal:cancellation.signal});
  cancellation.abort(new Error('caller cancelled'));
  await assert.rejects(()=>stopped,/caller cancelled/);
});
