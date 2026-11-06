import assert from 'node:assert/strict';
import test from 'node:test';
import { APP_CSP, WIDGET_HOST_CSP } from '../src/transport/http/web-policy.ts';
function directive(policy: string, name: string) {
  return policy.split(';').map(x => x.trim()).find(x => x.startsWith(`${name} `))?.split(/\s+/).slice(1);
}
test('main app blocks inline scripts; widget scripts stay in an opaque sandbox', () => {
  assert.deepEqual(directive(APP_CSP, 'script-src'), ["'self'"]);
  assert.deepEqual(directive(WIDGET_HOST_CSP, 'sandbox'), ['allow-scripts']);
  assert.deepEqual(directive(WIDGET_HOST_CSP, 'frame-ancestors'), ["'self'"]);
  assert.deepEqual(directive(WIDGET_HOST_CSP, 'frame-src'), ["'none'"]);
  assert.ok(directive(WIDGET_HOST_CSP, 'script-src')?.includes("'unsafe-inline'"));
  assert.ok(!directive(WIDGET_HOST_CSP, 'connect-src')?.includes("'self'"));
});
