// Local stdio MCP. All stdout belongs to MCP; test processes write only to run files.
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdir, readFile, writeFile, rename, unlink, stat, open } from 'node:fs/promises';
import { isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { hash, inspect, validateRequest } from './mini-runtime.mjs';
import { inspectWeb, validateWebRequest } from './web-runtime.mjs';
const root = process.env.PICODDY_TEST_RESULTS_ROOT;
if (!root || !isAbsolute(root)) throw new Error('PICODDY_TEST_RESULTS_ROOT must be an absolute private data directory');
await mkdir(root, { recursive: true, mode: 0o700 });
const children = new Map(); const lock = resolve(root, 'active.json');
const runDir = id => { if (!/^[A-Za-z0-9_-]{1,100}$/.test(id || '')) throw new Error('Invalid run ID'); return resolve(root, id); };
async function json(path) { if ((await stat(path)).size > 8 * 1024 * 1024) throw new Error('Report exceeds size limit'); return JSON.parse(await readFile(path, 'utf8')); }
async function save(path, value) { await writeFile(`${path}.tmp`, JSON.stringify(value), { mode: 0o600 }); await rename(`${path}.tmp`, path); }
async function unlock(id) { try { if ((await json(lock)).id === id) await unlink(lock); } catch {} }
async function status(id) {
  const dir = runDir(id); const state = await json(resolve(dir, 'state.json'));
  try {
    const summary = await json(resolve(dir, 'test-summary.json'));
    const reportPath = resolve(dir, summary.mode === 'browser' ? 'playwright.json' : 'node-test.json');
    if ((await stat(reportPath)).size > 8 * 1024 * 1024) throw new Error('Report exceeds size limit');
    const raw = await readFile(reportPath, 'utf8');
    // A finished report releases only the matching request's lock.
    if (!children.has(id)) await unlock(id);
    return { state: 'finished', requestHash: state.requestHash, summary, rawReport: JSON.parse(raw), rawHash: hash(raw), canonicalRawHash: hash(JSON.stringify(JSON.parse(raw))), outputDir: dir };
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  return { ...state, state: children.has(id) ? 'running' : state.state === 'stopped' ? 'stopped' : 'unknown', outputDir: dir,
    message: children.has(id) ? 'Local tests are running' : 'No complete report. Do not relaunch this request or assume success; inspect DevTools and the run log.' };
}
async function start(request) {
  const dir = runDir(request?.id); const requestHash = hash(JSON.stringify(request));
  try {
    const previous = await json(resolve(dir, 'state.json'));
    if (previous.requestHash !== requestHash) throw new Error('Request ID already belongs to another immutable test request');
    return status(request.id);
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const mini = request?.target?.kind === 'wechat-mini';
  const verified = mini ? await validateRequest(request) : await validateWebRequest(request);
  // One DevTools project per local connector. Never steal a lock after process loss.
  await writeFile(lock, JSON.stringify({ id: request.id }), { flag: 'wx', mode: 0o600 }).catch(() => { throw new Error('Another local run owns DevTools. Collect its result or stop it first.'); });
  let log;
  try {
    await mkdir(dir, { mode: 0o700 });
    const input = resolve(dir, 'request.json');
    await writeFile(input, JSON.stringify({ request, verified, outputDir: dir }), { flag: 'wx', mode: 0o600 });
    await save(resolve(dir, 'state.json'), { id: request.id, requestHash, state: 'starting' });
    log = await open(resolve(dir, 'runner.log'), 'a', 0o600);
    const child = spawn(process.execPath, [fileURLToPath(new URL(mini ? './mini-worker.mjs' : './web-worker.mjs', import.meta.url))], {
      cwd: verified.root, windowsHide: true, stdio: ['ignore', log.fd, log.fd, 'ipc'],
      env: { ...process.env, NODE_OPTIONS: '', MINI_REQUEST_PATH: input, TEST_REQUEST_PATH: input },
    });
    children.set(request.id, child);
    child.once('exit', () => { children.delete(request.id); void unlock(request.id); });
    child.once('error', () => { children.delete(request.id); void unlock(request.id); });
    await once(child, 'spawn');
    await save(resolve(dir, 'state.json'), { id: request.id, requestHash, state: 'running' });
    return { state: 'running', requestId: request.id, requestHash, outputDir: dir };
  } catch (error) { await unlock(request.id); throw error; }
  finally { await log?.close(); }
}
const server = new Server({ name: 'picoddy-local-testing', version: '1.0.0' }, { capabilities: { tools: {} } });
const string = { type: 'string' };
server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: [
  { name: 'local_check_environment', description: 'Check Playwright or WeChat project dependencies without opening a browser, DevTools or executing tests.', inputSchema: { type: 'object', properties: { repositoryRoot: string, target: { type: 'object' } }, required: ['repositoryRoot', 'target'] }, annotations: { readOnlyHint: true } },
  { name: 'local_start_test', description: 'Execute the immutable request returned by requirement_testing.prepareRun. Web/H5/microfrontend use local Playwright against the configured URL; WeChat uses local DevTools. Only invoke when the user requests testing. Never build or deploy.', inputSchema: { type: 'object', properties: { request: { type: 'object' } }, required: ['request'] } },
  { name: 'local_get_test_run', description: 'Read local run state and original reports. Does not start or restart tests.', inputSchema: { type: 'object', properties: { runId: string }, required: ['runId'] }, annotations: { readOnlyHint: true } },
  { name: 'local_stop_test', description: 'Stop a test worker owned by this MCP process. Inspect browser/DevTools cleanup before another run.', inputSchema: { type: 'object', properties: { runId: string }, required: ['runId'] } },
] }));
server.setRequestHandler(CallToolRequestSchema, async ({ params }) => {
  try {
    const args = params.arguments || {}; let result;
    if (params.name === 'local_check_environment') result = args.target?.kind === 'wechat-mini' ? await inspect({ ...args.target.mini, repositoryRoot: args.repositoryRoot }) : await inspectWeb({ ...args.target, repositoryRoot: args.repositoryRoot });
    else if (params.name === 'local_start_test') result = await start(args.request);
    else if (params.name === 'local_get_test_run') result = await status(args.runId);
    else if (params.name === 'local_stop_test') {
      const child = children.get(args.runId);
      if (!child) throw new Error('No worker owned by this process; refusing to kill an unrelated process');
      if (child.connected) child.send({ stop: true });
      else throw new Error('Worker control channel is unavailable; inspect the run before stopping manually');
      result = { state: 'stopping', runId: args.runId, message: 'Stop requested, inspect DevTools before restarting' };
    } else throw new Error('Unknown tool');
    return { content: [{ type: 'text', text: JSON.stringify(result) }] };
  } catch (error) { return { isError: true, content: [{ type: 'text', text: JSON.stringify({ error: String(error.message || error) }) }] }; }
});
// Closing MCP input must not silently leave an untracked owned worker running.
process.stdin.once('end', () => { for (const child of children.values()) if (child.connected) child.send({ stop: true }); });
await server.connect(new StdioServerTransport());
