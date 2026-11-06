import assert from 'node:assert/strict';
import test from 'node:test';
import { CLOUD_TOOL_NAMES, resolveCloudToolPolicy } from '../src/agent/tools/contracts.ts';
import { createWebTools } from '../src/agent/tools/web.ts';
import type { CloudSandbox } from '../src/platform/sandbox.ts';

const names = ['web_search', 'fetch_content', 'get_search_content', 'source_check'];
test('ordinary and read-only cloud conversations have all four built-in web tools', () => {
  for (const name of names) assert.ok(CLOUD_TOOL_NAMES.includes(name), `Missing ${name}`);
  for (const permission of ['full', 'readonly'] as const) {
    const policy = resolveCloudToolPolicy({ permission, runtimeProfile: { mode: 'craft', category: 'assistant' } });
    for (const name of names) assert.ok(policy.includes(name));
  }
  assert.deepEqual(resolveCloudToolPolicy({ permission: 'full', runtimeProfile: { mode: 'ask', category: 'assistant' } }), []);
});

function sandboxFixture() {
  const files = new Map<string, Uint8Array>();
  const calls: any[] = [];
  const cache = new Map<string, string>();
  const sandbox = {
    async write(path: string, body: Uint8Array) { files.set(path, body); },
    async exec(command: string) {
      if (command.startsWith('rm ')) { files.delete(command.split(' ').at(-1)!); return { exitCode: 0, stdout: '', stderr: '' }; }
      const path = command.split(' ').at(-1)!;
      const input = JSON.parse(Buffer.from(files.get(path)!).toString('utf8'));
      calls.push(input);
      if (input.action === 'list') return { exitCode: 0, stdout: JSON.stringify({ tools: names.map(name => ({ name, inputSchema: { type: 'object' } })) }), stderr: '' };
      if (input.action === 'close') return { exitCode: 0, stdout: '{"closed":true}', stderr: '' };
      if (input.name === 'web_search') cache.set(input.bridgeId, 'article-body');
      const value = cache.get(input.bridgeId);
      return { exitCode: 0, stdout: JSON.stringify({ content: [{ type: 'text', text: value ?? 'missing' }] }), stderr: '' };
    },
  } as unknown as CloudSandbox;
  return { sandbox, calls, files };
}

test('web tools discover real schemas and keep one bridge through search, cache retrieval and close', async () => {
  const f = sandboxFixture();
  let guards = 0;
  const runtime = await createWebTools(f.sandbox, async () => { guards++; });
  await runtime.tools[0].execute('one', { query: 'latest', malicious: '$(no-shell-evaluation)' });
  const result = await runtime.tools[2].execute('two', { responseId: 'response' });
  assert.equal(result.content[0].type, 'text');
  assert.equal((result.content[0] as { text: string }).text, 'article-body');
  await runtime.dispose();
  await runtime.dispose();
  assert.equal(new Set(f.calls.map(call => call.bridgeId)).size, 1);
  assert.deepEqual(f.calls.map(call => call.action), ['list', 'call', 'call', 'close']);
  assert.equal(guards, 3);
  assert.equal(f.files.size, 0);
  const second = await createWebTools(f.sandbox, async () => {});
  assert.notEqual(f.calls.at(-1).bridgeId, f.calls[0].bridgeId);
  await second.dispose();
});

test('aborted calls never write requests and revoked lease checks precede execution', async () => {
  const f = sandboxFixture();
  let revoked = false;
  const runtime = await createWebTools(f.sandbox, async () => { if (revoked) throw new Error('RUN_LEASE_LOST'); });
  const stop = new AbortController(); stop.abort(new Error('cancelled'));
  await assert.rejects(runtime.tools[0].execute('one', {}, stop.signal), /cancelled/);
  revoked = true;
  await assert.rejects(runtime.tools[0].execute('two', {}), /RUN_LEASE_LOST/);
  assert.equal(f.calls.length, 1);
  await runtime.dispose();
});

test('ordinary browser reading creates no screenshot or output directory; explicit screenshot does', async () => {
  const { browse } = await import(new URL('../runtime/browser.mjs', import.meta.url).href);
  const operations: string[] = [];
  const page = { goto: async () => {}, title: async () => 'article', url: () => 'https://example.test',
    locator: () => ({ innerText: async () => 'body', evaluateAll: async () => [] }),
    screenshot: async () => { operations.push('screenshot'); } };
  const dependencies = { mkdir: async () => { operations.push('mkdir'); },
    chromium: { launch: async () => ({ newContext: async () => ({ newPage: async () => page }), close: async () => { operations.push('close'); } }) } };
  const plain = await browse({ url: 'https://example.test' }, dependencies);
  assert.equal(plain.screenshot, undefined);
  assert.deepEqual(operations, ['close']);
  operations.length = 0;
  const image = await browse({ url: 'https://example.test', screenshot: true }, dependencies);
  assert.equal(image.screenshot, '/workspace/output/browser.png');
  assert.deepEqual(operations, ['mkdir', 'screenshot', 'close']);
});

import { createWebFetchTool } from '../src/agent/tools/web-fetch.ts';
test('desktop web_fetch alias uses the guarded task pi-web-access fetch_content',async()=>{
 const fixture=sandboxFixture();const runtime=await createWebTools(fixture.sandbox,async()=>{});
 try {
  const alias=createWebFetchTool(runtime.tools.find(tool=>tool.name==='fetch_content'));
  await alias.execute('alias',{url:'https://example.com',prompt:'extract title'});
  assert.equal(fixture.calls.at(-1).name,'fetch_content');assert.deepEqual(fixture.calls.at(-1).arguments,{url:'https://example.com/'});
  await assert.rejects(alias.execute('alias',{url:'file:///etc/passwd'}));
 }finally {await runtime.dispose();}
});
