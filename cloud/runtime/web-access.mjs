// Runs inside the Linux task sandbox. One daemon owns one official MCP process.
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFile, writeFile, mkdir, lstat, unlink } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

export const WEB_TOOL_NAMES = ['web_search', 'fetch_content', 'get_search_content', 'source_check'];
const REQUEST_LIMIT = 256 * 1024;
const RESPONSE_LIMIT = 512 * 1024;
const TIMEOUT_MS = 60_000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const REQUEST_PATH = /^\/workspace\/\.web-request-[0-9a-f-]{36}\.json$/i;

function validateRequest(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('WEB_INVALID_REQUEST');
  if (!['list', 'call', 'close'].includes(value.action)) throw new Error('WEB_INVALID_REQUEST');
  if (value.action === 'call' && (!WEB_TOOL_NAMES.includes(value.name) ||
      !value.arguments || typeof value.arguments !== 'object' || Array.isArray(value.arguments))) {
    throw new Error('WEB_INVALID_REQUEST');
  }
  return value;
}

/** Exported for bounded protocol tests; production injects the official MCP client. */
export function createWebAccessServer(client, token, closeClient) {
  const active = new Set();
  let closing;
  const close = () => closing ??= (async () => {
    for (const controller of active) controller.abort();
    try { await closeClient(); } finally { server.close(); }
  })();
  const server = createServer(async (request, response) => {
    const controller = new AbortController();
    active.add(controller);
    response.once('close', () => controller.abort());
    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(TIMEOUT_MS)]);
    const send = (status, value) => {
      let body = JSON.stringify(value);
      if (Buffer.byteLength(body) > RESPONSE_LIMIT) {
        status = 413;
        body = JSON.stringify({ error: 'WEB_RESPONSE_TOO_LARGE' });
      }
      if (!response.destroyed) {
        response.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
        response.end(body);
      }
    };
    try {
      if (request.method !== 'POST' || request.url !== '/' || request.headers.authorization !== `Bearer ${token}`) {
        send(403, { error: 'WEB_REQUEST_DENIED' });
        return;
      }
      const chunks = [];
      let size = 0;
      for await (const chunk of request) {
        if ((size += chunk.length) > REQUEST_LIMIT) { send(413, { error: 'WEB_REQUEST_TOO_LARGE' }); return; }
        chunks.push(chunk);
      }
      const input = validateRequest(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      if (closing && input.action !== 'close') { send(410, { error: 'WEB_SESSION_CLOSED' }); return; }
      if (input.action === 'close') {
        await close();
        send(200, { closed: true });
        return;
      }
      const result = input.action === 'list'
        ? await client.listTools({}, { signal, timeout: TIMEOUT_MS })
        : await client.callTool({ name: input.name, arguments: input.arguments }, undefined, { signal, timeout: TIMEOUT_MS });
      send(200, result);
    } catch {
      send(502, { error: signal.aborted ? 'WEB_REQUEST_CANCELLED_OR_TIMEOUT' : 'WEB_ACCESS_FAILED' });
    } finally { active.delete(controller); }
  });
  server.requestTimeout = TIMEOUT_MS;
  server.headersTimeout = 10_000;
  return { server, close };
}

async function serve(id) {
  const directory = `/workspace/.web-access/${id}`;
  const agentDir = `${directory}/config`;
  const temporary = `${directory}/tmp`;
  await mkdir(agentDir, { recursive: true, mode: 0o700 });
  await mkdir(temporary, { recursive: true, mode: 0o700 });
  // No desktop auth, browser cookies, inherited search keys or persistent output.
  await writeFile(`${agentDir}/web-search.json`, JSON.stringify({ searchProvider: 'exa' }), { mode: 0o600 });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ['/opt/picoddy/node_modules/pi-web-access/dist/mcp-cli.js'],
    cwd: directory,
    env: { PATH: process.env.PATH ?? '/usr/bin:/bin', HOME: directory,
      TMPDIR: temporary, TMP: temporary, TEMP: temporary,
      PI_CODING_AGENT_DIR: agentDir, PI_WEB_ACCESS_CACHE_ROOT: `${directory}/cache` },
    stderr: 'ignore',
  });
  const client = new Client({ name: 'picoddy-cloud-web', version: '1.0.0' });
  try {
    await client.connect(transport, { timeout: 10_000 });
    const token = randomUUID();
    const bridge = createWebAccessServer(client, token, async () => {
      try { await client.close(); } finally { await transport.close(); }
      await unlink(`${directory}/state.json`).catch(() => {});
    });
    await new Promise((resolve, reject) => {
      bridge.server.once('error', reject);
      bridge.server.listen(0, '127.0.0.1', resolve);
    });
    await writeFile(`${directory}/state.json`, JSON.stringify({ port: bridge.server.address().port, token }), { mode: 0o600 });
    const shutdown = () => void bridge.close().finally(() => process.exit(0));
    process.once('SIGTERM', shutdown);
    process.once('SIGINT', shutdown);
  } catch {
    await client.close().catch(() => {});
    await transport.close().catch(() => {});
    await writeFile(`${directory}/failed`, 'WEB_START_FAILED', { mode: 0o600 });
    process.exitCode = 1;
  }
}

async function request(path) {
  if (!REQUEST_PATH.test(path)) throw new Error('WEB_INVALID_REQUEST_PATH');
  let input;
  try {
    const info = await lstat(path);
    if (!info.isFile() || info.size > REQUEST_LIMIT) throw new Error('WEB_REQUEST_TOO_LARGE');
    input = JSON.parse(await readFile(path, 'utf8'));
  } finally { await unlink(path).catch(() => {}); }
  if (!UUID.test(input.bridgeId)) throw new Error('WEB_INVALID_REQUEST');
  validateRequest(input);
  const directory = `/workspace/.web-access/${input.bridgeId}`;
  let state;
  try { state = JSON.parse(await readFile(`${directory}/state.json`, 'utf8')); }
  catch {
    if (input.action !== 'list') throw new Error('WEB_SESSION_LOST');
    await mkdir('/workspace/.web-access', { recursive: true, mode: 0o700 });
    try {
      await mkdir(directory, { mode: 0o700 });
      const child = spawn(process.execPath, [fileURLToPath(import.meta.url), 'serve', input.bridgeId],
        { detached: true, stdio: 'ignore' });
      child.on('error', () => {});
      child.unref();
    } catch (error) { if (error.code !== 'EEXIST') throw error; }
    for (let attempt = 0; attempt < 120; attempt++) {
      try { state = JSON.parse(await readFile(`${directory}/state.json`, 'utf8')); break; } catch {}
      try { await lstat(`${directory}/failed`); throw new Error('WEB_START_FAILED'); }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
      await delay(100);
    }
    if (!state) throw new Error('WEB_START_TIMEOUT');
  }
  if (!Number.isInteger(state.port) || state.port < 1 || state.port > 65535 || !UUID.test(state.token)) throw new Error('WEB_SESSION_LOST');
  const stop = new AbortController();
  const abort = () => stop.abort();
  process.once('SIGTERM', abort);
  process.once('SIGINT', abort);
  try {
    const response = await fetch(`http://127.0.0.1:${state.port}/`, {
      method: 'POST', headers: { authorization: `Bearer ${state.token}`, 'content-type': 'application/json' },
      body: JSON.stringify(input), signal: AbortSignal.any([stop.signal, AbortSignal.timeout(TIMEOUT_MS + 5000)]),
    });
    const chunks = [];
    let size = 0;
    for await (const chunk of response.body) {
      if ((size += chunk.length) > RESPONSE_LIMIT) throw new Error('WEB_RESPONSE_TOO_LARGE');
      chunks.push(chunk);
    }
    const body = Buffer.concat(chunks).toString('utf8');
    JSON.parse(body);
    process.stdout.write(body);
    if (!response.ok) process.exitCode = 1;
  } finally {
    process.off('SIGTERM', abort);
    process.off('SIGINT', abort);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [mode, argument] = process.argv.slice(2);
  if (mode === 'serve' && UUID.test(argument)) await serve(argument);
  else if (mode === 'request') await request(argument).catch(() => {
    process.stdout.write(JSON.stringify({ error: 'WEB_ACCESS_FAILED' }));
    process.exitCode = 1;
  });
  else throw new Error('WEB_INVALID_INVOCATION');
}
