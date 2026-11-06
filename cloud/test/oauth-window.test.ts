import assert from 'node:assert/strict';
import test from 'node:test';
import { openOAuthWindow } from '../web/desktop/src/components/McpOAuthControls.tsx';
import { sendCallbackHtml } from '../src/transport/http/mcp-oauth.ts';

test('reserved OAuth window disconnects opener and handles blocked popups', () => {
  const previous = globalThis.window;
  const popup = { opener: {}, document: { title: '', body: { textContent: '' } } };
  try {
    globalThis.window = { open: (url: string, target: string) => { assert.equal(url, 'about:blank'); assert.equal(target, '_blank'); return popup; } } as any;
    assert.equal(openOAuthWindow(), popup);
    assert.equal(popup.opener, null);
    assert.match(popup.document.body.textContent, /正在准备授权/);
    globalThis.window = { open: () => null } as any;
    assert.equal(openOAuthWindow(), null);
  } finally { globalThis.window = previous; }
});

test('successful callback closes authorization window with nonce-only script and fixed same-origin return', () => {
  let headers: Record<string, string> = {}, body = '';
  sendCallbackHtml({ response: { writeHead(code: number, value: any) { assert.equal(code, 200); headers = value; }, end(value: string) { body = value; } }, url: new URL('https://cloud.test/callback?code=secret&state=secret&returnUrl=https://evil.test') } as any, true);
  const nonce = body.match(/<script nonce="([^"]+)"/)!;
  assert.ok(nonce);
  assert.ok(headers['Content-Security-Policy'].includes(`script-src 'nonce-${nonce[1]}'`));
  assert.match(body, /window.close\(\)/);
  assert.match(body, /window.location.replace\('\/'\)/);
  assert.doesNotMatch(body, /secret|evil|unsafe-inline/);
});
