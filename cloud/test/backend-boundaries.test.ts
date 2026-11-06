import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const source = (path: string) => readFile(new URL(`../src/${path}`, import.meta.url), 'utf8');

test('application assembly owns HTTP dependency composition', async () => {
  const server = await source('server.ts');
  assert.match(server, /createApplication/);
  assert.doesNotMatch(server, /createRequestHandler/);
});

test('scheduler submits through run service, not HTTP routes', async () => {
  const scheduler = await source('automation.ts');
  assert.doesNotMatch(scheduler, /from ['"].*routes\.ts/);
  assert.match(scheduler, /cloud\/runs\/service/);
});

test('HTTP delegates session business operations', async () => {
  const routes = await source('transport/http/routes.ts');
  assert.match(routes, /createSessionService/);
  assert.doesNotMatch(routes, /INSERT INTO conversations/);
});

test('resource, skill and attachment HTTP adapters do not own SQL or domain validation', async () => {
  for (const module of ['resources', 'skills', 'files']) {
    const adapter = await source(`transport/http/${module}.ts`);
    assert.doesNotMatch(adapter, /\b(?:SELECT|INSERT INTO|UPDATE resources|DELETE FROM)\b/);
    assert.doesNotMatch(adapter, /parseSkillPackage|createHash|seal\(/);
  }
});

test('worker owns the durable object deletion retry loop', async () => {
  const worker = await source('worker.ts');
  assert.match(worker, /cleanupFileDeletions\(\{ database, storage, batchSize: 10, signal \}\)/);
  assert.match(worker, /Promise\.all\(\[\.\.\.lanes, cleanup\]\)/);
});
