import { run } from 'node:test';
import { readFile, writeFile, rename } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { git, hash, fingerprint } from './mini-runtime.mjs';
const { request, verified, outputDir } = JSON.parse(await readFile(process.env.MINI_REQUEST_PATH, 'utf8'));
const controller = new AbortController();
process.once('SIGTERM', () => controller.abort());
process.once('SIGINT', () => controller.abort());
process.on('message', message => { if (message?.stop === true) controller.abort(); });
process.once('disconnect', () => controller.abort());
const events = []; const attempts = []; const errors = [];
let clean = false; let versionAfter = ''; let projectHashAfter = '';
try {
  const stream = run({ files: [fileURLToPath(new URL('./mini-harness.cjs', import.meta.url))], concurrency: 1, timeout: 1800000, execArgv: [], signal: controller.signal });
  const planned = new Set(verified.cases.filter(c => c.automation === 'automated').map(c => c.id));
  for await (const event of stream) {
    if (!['test:pass', 'test:fail'].includes(event.type)) continue;
    const d = event.data;
    const row = { type: event.type, name: d.name, skip: Boolean(d.skip), todo: Boolean(d.todo), durationMs: Number(d.details?.duration_ms || 0), error: d.details?.error ? String(d.details.error.stack || d.details.error.message || d.details.error).slice(0, 8000) : undefined };
    if (events.length >= 20000) throw new Error('Too many test events');
    events.push(row);
    if (planned.has(d.name)) attempts.push({ caseId: d.name, attempt: 0, status: row.skip || row.todo ? 'skipped' : event.type === 'test:pass' ? 'passed' : 'failed', durationMs: row.durationMs });
    else if (event.type === 'test:fail' && d.details?.error?.failureType !== 'subtestsFailed') errors.push(row.error || `Framework failure: ${d.name}`);
  }
  versionAfter = (await git(verified.root, ['rev-parse', 'HEAD'])).trim();
  if ((await git(verified.root, ['status', '--porcelain'])).trim()) throw new Error('Worktree changed during execution');
  projectHashAfter = await fingerprint(verified.miniRoot);
  clean = errors.length === 0 && !controller.signal.aborted;
} catch (error) { errors.push(String(error)); }
const raw = JSON.stringify({ schemaVersion: 1, framework: 'node:test', events, errors });
await writeFile(resolve(outputDir, 'node-test.json'), raw, { mode: 0o600 });
const summary = { schemaVersion: 1, requestId: request.id, targetId: request.target.id, environment: request.target.environment,
  businessSha: request.businessSha, testSha: request.package.testSha, packageHash: request.package.hash, mode: 'mini-devtools',
  versionBefore: request.businessSha, versionAfter, projectHashBefore: verified.projectHash, projectHashAfter,
  plannedCaseIds: verified.cases.filter(c => c.automation === 'automated').map(c => c.id), attempts,
  cleanup: clean ? 'passed' : 'failed', exitCode: clean && attempts.every(a => a.status === 'passed') ? 0 : 1, rawReportHash: hash(raw) };
await writeFile(resolve(outputDir, 'test-summary.json.tmp'), JSON.stringify(summary), { mode: 0o600 });
await rename(resolve(outputDir, 'test-summary.json.tmp'), resolve(outputDir, 'test-summary.json'));
process.exitCode = summary.exitCode;
if (process.connected) process.disconnect();
