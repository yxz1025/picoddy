// Explicit live smoke: temporary sandbox only; no model calls or business DB writes.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { loadConfig } from '../src/config.ts';
import { createSandbox, reconcileRunSandboxes, withSandboxCreateTimeout, type CloudSandbox } from '../src/platform/sandbox.ts';
import { createWebTools } from '../src/agent/tools/web.ts';

const config = loadConfig();
const operationId = randomUUID();
const stop = AbortSignal.timeout(150_000);
let sandbox: CloudSandbox | undefined;
let runtime: Awaited<ReturnType<typeof createWebTools>> | undefined;
let stage = 'sandbox_create';
try {
  sandbox = await withSandboxCreateTimeout(30_000, () => createSandbox(config, operationId, stop));
  stage = 'tools_list';
  runtime = await createWebTools(sandbox, async () => stop.throwIfAborted(), stop);
  assert.equal(runtime.tools.length, 4);
  console.log(JSON.stringify({ stage, ok: true }));
  const call = async (name: string, args: unknown) => {
    stage = name;
    const tool = runtime!.tools.find(tool => tool.name === name)!;
    const result = await tool.execute(randomUUID(), args, stop);
    const text = result.content.filter(item => item.type === 'text').map(item => item.text).join('\n');
    if ('isError' in result && result.isError) console.error(JSON.stringify({ stage, toolError: text.slice(0,1000) }));
    assert.equal('isError' in result && result.isError, false);
    assert.ok(text.length > 0);
    console.log(JSON.stringify({ stage, ok: true, responseBytes: Buffer.byteLength(text) }));
    return text;
  };
  let failures = 0;
  for (const operation of [
    async () => {
      const searched = await call('web_search', { query: 'OpenAI', numResults: 2 });
      const searchId = searched.match(/responseId\s+"([^"]+)"/)?.[1];
      assert.ok(searchId, 'search response must expose a cache ID');
      await call('get_search_content', { responseId: searchId, queryIndex: 0, limit: 1000 });
    },
    () => call('fetch_content', { url: 'https://example.com' }),
    () => call('source_check', { claim: 'Example Domain is for documentation examples', queries: ['Example Domain documentation examples'], numResults: 1 }),
  ]) {
    try { await operation(); } catch { failures++; }
  }
  stage = 'output_inventory';
  const inventory = await sandbox.exec('find /workspace/output -type f 2>/dev/null || true', stop);
  assert.equal(inventory.stdout.trim(), '', 'research must not create output files');
  console.log(JSON.stringify({ stage, ok: true }));
  assert.equal(failures, 0, 'One or more live web operations failed');
} catch (error) {
  console.error(JSON.stringify({ stage, ok: false, errorType: error instanceof Error ? error.name : 'Error' }));
  process.exitCode = 1;
} finally {
  await runtime?.dispose().catch(() => {});
  await sandbox?.destroy();
  await reconcileRunSandboxes(config, operationId);
}
