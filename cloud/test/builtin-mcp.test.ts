import assert from 'node:assert/strict';
import test from 'node:test';
import { requestDesktopApi } from '../web/desktop/src/api/cloudAdapter.ts';
import { executeBuiltinRequest } from '../sandbox/builtin-runner.mjs';
import { runSandboxMcp } from '../src/platform/sandbox.ts';
import { isMcpToolVisible } from '../src/domains/connector/node/tool-policy.ts';

test('hidden policy uses only explicit own tool overrides including reserved names', () => {
  const data = { exposure: 'hidden', toolExposure: { allowed: 'direct' } };
  for (const name of ['constructor', 'toString', '__proto__', 'unknown']) assert.equal(isMcpToolVisible(data, name), false);
  assert.equal(isMcpToolVisible(data, 'allowed'), true);
  assert.equal(isMcpToolVisible({ ...data, toolExposure: JSON.parse('{"constructor":"direct"}') }, 'constructor'), true);
});

test('MCP execution errors never expose connector stderr or credentials', async () => {
  const sandbox = { write: async () => {}, exec: async () => ({ exitCode: 1, stdout: '', stderr: 'token=private-workload-secret' }) };
  await assert.rejects(runSandboxMcp(sandbox as any, { operation: 'list', connector: { transport: 'stdio', command: 'node' } }),
    (e: any) => !e.message.includes('private-workload-secret'));
});

test('removed enterprise broker operations are rejected without sending credentials', async () => {
  let requested = false;
  const fetcher = async () => { requested = true; throw new Error('Unexpected network call'); };
  await assert.rejects(executeBuiltinRequest({ operation: 'broker', path: '/grants', method: 'GET', secret: 'test-credential' }, { fetch: fetcher }), /Unsupported builtin operation/);
  assert.equal(requested, false);
});

test('every builtin MCP card route reaches cloud instead of adapter 404', async () => {
  const original = globalThis.fetch;
  const requests: string[] = [];
  globalThis.fetch = async input => {
    requests.push(String(input));
    return new Response(JSON.stringify({ data: { ok: true } }), { headers: { 'content-type': 'application/json' } });
  };
  const routes: [string, string][] = [
    ['GET', '/api/mcp/builtin/npm/gitlab'], ['POST', '/api/mcp/builtin/npm/gitlab/install'],
    ['POST', '/api/mcp/builtin/npm/gitlab/configure'], ['GET', '/api/mcp/builtin/npm/jenkins'],
    ['POST', '/api/mcp/builtin/npm/jenkins/install'], ['POST', '/api/mcp/builtin/npm/jenkins/configure'],
    ['GET', '/api/mcp/builtin/tapd'], ['POST', '/api/mcp/builtin/tapd/install'],
    ['POST', '/api/mcp/builtin/tapd/authorize'], ['POST', '/api/mcp/builtin/tapd/authorize/confirm'],
    ['POST', '/api/mcp/builtin/tapd/authorize/cancel'], ['GET', '/api/mcp/builtin/tapd/grants'],
    ['DELETE', '/api/mcp/builtin/tapd/grants/example'],
  ];
  try {
    for (const [method, path] of routes) assert.deepEqual(await requestDesktopApi(method as any, path, {}), { ok: true });
    assert.deepEqual(requests, routes.map(([, path]) => path));
  } finally { globalThis.fetch = original; }
});
