#!/usr/bin/env node
'use strict';
// Official miniprogram-automator performs all DevTools operations. No MCP or client API.
const fs = require('node:fs/promises');
const syncFs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { createRequire } = require('node:module');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { run } = require('node:test');
const exec = promisify(execFile);
const digest = data => crypto.createHash('sha256').update(data).digest('hex');
const inside = (root, file) => { const rel = path.relative(root, file); return !path.isAbsolute(rel) && rel !== '..' && !rel.startsWith(`..${path.sep}`); };
async function json(file) { const info = await fs.stat(file); if (info.size > 4 * 1024 * 1024) throw Error('JSON input too large'); return JSON.parse(await fs.readFile(file, 'utf8')); }
async function writeJson(file, value) { await fs.writeFile(`${file}.tmp`, JSON.stringify(value, null, 2), { mode: 0o600 }); await fs.rename(`${file}.tmp`, file); }
async function fingerprint(dir) {
  const hash = crypto.createHash('sha256'); let bytes = 0; let count = 0;
  async function walk(current) {
    for (const name of (await fs.readdir(current)).sort()) {
      if (['.git', 'node_modules'].includes(name)) continue;
      const file = path.join(current, name); const stat = await fs.lstat(file);
      if (stat.isSymbolicLink()) throw Error(`Mini-program output contains a symlink: ${file}`);
      if (stat.isDirectory()) await walk(file);
      else if (stat.isFile()) {
        bytes += stat.size;
        if (++count > 20000 || bytes > 200 * 1024 * 1024) throw Error('Mini-program exceeds fingerprint size limit');
        hash.update(JSON.stringify(path.relative(dir, file).replaceAll('\\', '/'))).update('\0').update(await fs.readFile(file)).update('\0');
      }
    }
  }
  await walk(dir); return hash.digest('hex');
}
async function revision(root) {
  try {
    const git = args => exec('git', ['-C', root, ...args], { timeout: 15000, windowsHide: true, maxBuffer: 4 * 1024 * 1024 });
    return { commit: (await git(['rev-parse', 'HEAD'])).stdout.trim(), dirty: Boolean((await git(['status', '--porcelain'])).stdout.trim()) };
  } catch { return { commit: null, dirty: null }; }
}
async function prepare(configFile) {
  if (Number(process.versions.node.split('.')[0]) < 22) throw Error('This test runner requires Node.js 22 or later (runner requirement, not the SDK minimum)');
  if (!['darwin', 'win32'].includes(process.platform)) throw Error('Local WeChat DevTools execution supports macOS/Windows');
  const config = await json(configFile);
  if (config.schemaVersion !== 1 || config.kind !== 'wechat-mini') throw Error('Expected schemaVersion=1, kind=wechat-mini');
  if (typeof config.repositoryRoot !== 'string' || typeof config.projectPath !== 'string') throw Error('repositoryRoot and projectPath are required');
  const root = await fs.realpath(path.resolve(path.dirname(configFile), config.repositoryRoot));
  const project = await fs.realpath(path.resolve(root, config.projectPath));
  if (!inside(root, project)) throw Error('Project must be inside the associated repository');
  if (!path.isAbsolute(config.cliPath || '') || !(await fs.stat(config.cliPath)).isFile()) throw Error('Configure the actual absolute DevTools CLI path (cli or cli.bat)');
  const projectConfigPath = path.join(project, 'project.config.json');
  const projectConfig = await json(projectConfigPath);
  if (!/^wx[a-f0-9]{16}$/i.test(config.appId || '') || config.appId !== projectConfig.appid) throw Error('AppID must match project.config.json');
  const miniRoot = await fs.realpath(path.resolve(project, projectConfig.miniprogramRoot || '.'));
  if (!inside(root, miniRoot)) throw Error('miniprogramRoot escapes the associated repository');
  await json(path.join(miniRoot, 'app.json'));
  const sdk = createRequire(path.join(root, 'package.json')).resolve('miniprogram-automator'); // Resolve only; --check never loads SDK or cases.
  if (!Array.isArray(config.cases) || !config.cases.length || config.cases.length > 5000) throw Error('Provide actual generated cases, not an empty example');
  const ids = new Set(); const scripts = {};
  for (const row of config.cases) {
    if (!row || !/^[A-Za-z0-9_-]{1,100}$/.test(row.id || '') || ids.has(row.id)) throw Error('Case IDs must be unique');
    ids.add(row.id);
    if (typeof row.required !== 'boolean' || !['automated', 'manual', 'blocked'].includes(row.automation) || !Array.isArray(row.acceptanceIds) || !row.acceptanceIds.length) throw Error(`Incomplete case metadata: ${row.id}`);
    if (row.automation === 'automated') {
      if (typeof row.file !== 'string' || !row.file.endsWith('.cjs')) throw Error(`Case module must be a .cjs file: ${row.id}`);
      const file = await fs.realpath(path.resolve(root, row.file));
      if (!inside(root, file) || !(await fs.stat(file)).isFile()) throw Error('Case module escapes the associated repository');
      scripts[row.file] = { path: file, hash: digest(await fs.readFile(file)) };
    }
  }
  if (!Object.keys(scripts).length) throw Error('No automated cases to execute');
  const timeoutMs = config.timeoutMs ?? 60000;
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1000 || timeoutMs > 300000) throw Error('timeoutMs must be between 1000 and 300000');
  return { config, configFile, root, project, miniRoot, sdk, scripts, timeoutMs, configHash: digest(await fs.readFile(configFile)), projectConfigPath,
    projectConfigHash: digest(await fs.readFile(projectConfigPath)), projectHash: await fingerprint(miniRoot), revision: await revision(root) };
}
async function main() {
  const args = process.argv.slice(2); const options = {};
  while (args.length) {
    const flag = args.shift();
    if (flag === '--check') options.check = true;
    else if (['--config', '--output'].includes(flag) && args.length && !args[0].startsWith('--')) options[flag.slice(2)] = args.shift();
    else throw Error('Usage: node run-wechat.cjs --config <project-json> [--check | --output <new-run-directory>]');
  }
  if (!options.config) throw Error('--config is required');
  const prepared = await prepare(path.resolve(options.config));
  if (options.check) {
    console.log(JSON.stringify({ status: 'files-ready', projectPath: prepared.project, appId: prepared.config.appId, automatedCases: prepared.config.cases.filter(c => c.automation === 'automated').length,
      message: 'Only files/configuration checked. SDK and case code were not loaded; login, CLI/HTTP permission and execution are not verified.' }, null, 2));
    return;
  }
  if (!options.output) throw Error('--output must name a NEW directory; existing reports are never overwritten');
  const wanted = path.resolve(options.output);
  // Parent must already exist. Canonicalize it so a symlink cannot place reports in the project tree.
  const parent = await fs.realpath(path.dirname(wanted));
  const output = path.join(parent, path.basename(wanted));
  if (inside(prepared.miniRoot, output)) throw Error('Report directory must be outside the actual mini-program output tree');
  await fs.mkdir(output, { mode: 0o700 });
  const request = { ...prepared, output, runId: crypto.randomUUID(), startedAt: new Date().toISOString() };
  const requestFile = path.join(output, 'request.json');
  await writeJson(requestFile, request);
  await writeJson(path.join(output, 'status.json'), { state: 'prepared', runId: request.runId, startedAt: request.startedAt });
  const lock = path.join(os.tmpdir(), `wechat-automation-${digest(prepared.project)}.lock`);
  await fs.writeFile(lock, JSON.stringify({ runId: request.runId, output, pid: process.pid }), { flag: 'wx', mode: 0o600 }).catch(() => { throw Error(`Project has an active or interrupted run. Inspect its status before manually removing the lock: ${lock}`); });
  let releaseLock = false;
  process.once('exit', () => {
    if (!releaseLock) return;
    try { if (JSON.parse(syncFs.readFileSync(lock, 'utf8')).runId === request.runId) syncFs.unlinkSync(lock); } catch {}
  });
  await writeJson(path.join(output, 'status.json'), { state: 'running', runId: request.runId, startedAt: request.startedAt });
  const controller = new AbortController(); const cancel = () => controller.abort();
  process.once('SIGINT', cancel); process.once('SIGTERM', cancel);
  const originalEvents = []; const results = []; const errors = [];
  const expected = new Set(prepared.config.cases.filter(c => c.automation === 'automated').map(c => c.id));
  let cleanup = { status: 'unknown' }; let unchanged = false;
  // node:test child inherits this invocation's environment; no SDK runs in the parent.
  process.env.WECHAT_TEST_REQUEST = requestFile;
  try {
    const stream = run({ files: [path.join(__dirname, 'wechat-harness.cjs')], concurrency: 1, timeout: 1800000, execArgv: [], signal: controller.signal });
    for await (const event of stream) {
      if (!['test:pass', 'test:fail'].includes(event.type)) continue;
      const data = event.data;
      const entry = { type: event.type, name: data.name, skip: Boolean(data.skip), todo: Boolean(data.todo), durationMs: Number(data.details?.duration_ms || 0),
        failureType: data.details?.error?.failureType, error: data.details?.error ? String(data.details.error.stack || data.details.error.message || data.details.error).slice(0, 12000) : undefined };
      if (originalEvents.length >= 20000) throw Error('Too many framework events');
      originalEvents.push(entry);
      if (expected.has(entry.name)) results.push({ id: entry.name, status: entry.skip || entry.todo ? 'skipped' : event.type === 'test:pass' ? 'passed' : 'failed', durationMs: entry.durationMs, error: entry.error });
      else if (event.type === 'test:fail' && entry.failureType !== 'subtestsFailed') errors.push(entry.error || 'Framework failure');
      if (entry.failureType === 'hookFailed') errors.push(entry.error || 'Setup/teardown failure');
    }
    cleanup = await json(path.join(output, 'cleanup.json')).catch(() => ({ status: 'unknown' }));
    unchanged = prepared.configHash === digest(await fs.readFile(prepared.configFile)) && prepared.projectConfigHash === digest(await fs.readFile(prepared.projectConfigPath)) && prepared.projectHash === await fingerprint(prepared.miniRoot);
    for (const source of Object.values(prepared.scripts)) if (source.hash !== digest(await fs.readFile(source.path))) unchanged = false;
    if (!unchanged) errors.push('Test inputs or compiled mini-program changed during execution');
  } catch (error) { errors.push(String(error)); }
  finally { process.removeListener('SIGINT', cancel); process.removeListener('SIGTERM', cancel); }
  let verdict = 'passed';
  if (controller.signal.aborted) verdict = 'interrupted';
  else if (errors.length || cleanup.status !== 'passed' || !unchanged) verdict = 'incomplete';
  else if (results.some(row => row.status === 'failed')) verdict = 'failed';
  else if (results.length !== expected.size || new Set(results.map(r => r.id)).size !== results.length || !results.some(r => r.status === 'passed') || prepared.config.cases.some(row => row.required && (row.automation !== 'automated' || !results.some(r => r.id === row.id && r.status === 'passed')))) verdict = 'incomplete';
  await writeJson(path.join(output, 'node-test.json'), { framework: 'node:test', events: originalEvents, errors });
  await writeJson(path.join(output, 'summary.json'), { runId: request.runId, mode: 'mini-devtools', verdict, startedAt: request.startedAt, finishedAt: new Date().toISOString(),
    appId: prepared.config.appId, projectPath: prepared.project, revision: prepared.revision, configHash: prepared.configHash, projectHash: prepared.projectHash, inputsUnchanged: unchanged,
    deploymentVersionVerified: false, cleanup, results, errors, note: 'Local compiled output tested; source/production deployment provenance is not inferred. Not a real-device result.' });
  releaseLock = cleanup.status === 'passed';
  await writeJson(path.join(output, 'status.json'), { state: 'finished', runId: request.runId, verdict });
  console.log(JSON.stringify({ runId: request.runId, verdict, report: path.join(output, 'summary.json') }));
  process.exitCode = verdict === 'passed' ? 0 : 1;
}
main().catch(error => { console.error(String(error.message || error)); process.exitCode = 1; });
