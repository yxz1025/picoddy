// Invoked by local-mcp after explicit user execution. Never builds or deploys the application.
import { spawn } from 'node:child_process';
import { readFile, writeFile, rename } from 'node:fs/promises';
import { resolve } from 'node:path';
import { git, hash } from './mini-runtime.mjs';
const { request, verified, outputDir } = JSON.parse(await readFile(process.env.TEST_REQUEST_PATH, 'utf8'));
const automated = verified.cases.filter(c => c.automation === 'automated');
let child; let stopped = false;
const stop = () => { stopped = true; child?.kill('SIGTERM'); };
process.on('message', message => { if (message?.stop === true) stop(); });
process.once('disconnect', stop); process.once('SIGTERM', stop); process.once('SIGINT', stop);
async function version() {
  if (!request.target.versionUrl) return '';
  const response = await fetch(request.target.versionUrl, { signal: AbortSignal.timeout(15000), redirect: 'error', headers: { 'Cache-Control': 'no-cache' } });
  if (!response.ok) throw new Error(`Version endpoint HTTP ${response.status}`);
  const payload = await response.json();
  const result = request.target.versionField.split('.').reduce((value, key) => value?.[key], payload);
  if (result !== request.businessSha) throw new Error('Deployment version does not match the expected SHA');
  return result;
}
let exitCode = 1; let versionBefore = ''; let versionAfter = ''; let attempts = []; let cleanup = 'failed'; let rawReportHash = ''; let error;
try {
  versionBefore = await version();
  // Load project fixtures/config but force the chosen domain, serial execution and local reports.
  // Resolve config-relative directories because this wrapper lives outside the business repo.
  const configPath = resolve(outputDir, 'playwright.config.ts');
  await writeFile(configPath, `import original from ${JSON.stringify(verified.config.replaceAll('\\', '/'))};\nimport {resolve} from 'node:path';\nconst root=${JSON.stringify(verified.root)};\nconst dir=p=>p?resolve(root,p):undefined;\nconst baseURL=${JSON.stringify(verified.baseUrl)};\nexport default {...original,webServer:undefined,testDir:dir(original.testDir||'.'),snapshotDir:dir(original.snapshotDir),globalSetup:dir(original.globalSetup),globalTeardown:dir(original.globalTeardown),use:{...original.use,baseURL},projects:original.projects?.map(p=>({...p,testDir:dir(p.testDir||original.testDir||'.'),snapshotDir:dir(p.snapshotDir),use:{...original.use,...p.use,baseURL}}))};\n`);
  const grep = automated.map(c => `\\[${c.id}\\]`).join('|');
  const files = [...new Set(automated.map(c => c.file.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))];
  const args = [verified.cli, 'test', ...files, '--config', configPath, '--grep', grep, '--workers=1', '--retries=0', '--forbid-only', '--reporter=json,html,junit', '--global-timeout=1800000', `--output=${resolve(outputDir, 'artifacts')}`];
  if (args.join(' ').length > 24000) throw new Error('Test package exceeds portable command size; split the cases into smaller targets');
  if (stopped) throw new Error('Stopped before execution');
  exitCode = await new Promise((done, reject) => {
    child = spawn(process.execPath, args, { cwd: verified.root, windowsHide: true, stdio: 'inherit', env: { ...process.env,
      BASE_URL: verified.baseUrl, ENTRY_URL: verified.entryUrl, PLAYWRIGHT_JSON_OUTPUT_NAME: resolve(outputDir, 'playwright.json'),
      PLAYWRIGHT_JUNIT_OUTPUT_FILE: resolve(outputDir, 'junit.xml'), PLAYWRIGHT_HTML_OUTPUT_DIR: resolve(outputDir, 'html'), PLAYWRIGHT_HTML_OPEN: 'never' } });
    child.once('error', reject); child.once('exit', code => done(code ?? 1));
  });
  const raw = await readFile(resolve(outputDir, 'playwright.json'), 'utf8'); rawReportHash = hash(raw);
  const report = JSON.parse(raw);
  const visit = suite => {
    for (const spec of suite.specs || []) {
      const ids = [...spec.title.matchAll(/\[([A-Za-z0-9_-]+)\]/g)].map(m => m[1]).filter(id => automated.some(c => c.id === id));
      if (ids.length !== 1) throw new Error('Each test must map to exactly one planned case ID');
      for (const test of spec.tests || []) for (const result of test.results || []) attempts.push({ caseId: ids[0], attempt: result.retry, status: ({ passed: 'passed', failed: 'failed', timedOut: 'timeout', skipped: 'skipped', interrupted: 'error' })[result.status] || 'error', durationMs: result.duration });
    }
    for (const sub of suite.suites || []) visit(sub);
  };
  for (const suite of report.suites || []) visit(suite);
  versionAfter = await version();
  if ((await git(verified.root, ['rev-parse', 'HEAD'])).trim() !== request.package.testSha || (await git(verified.root, ['status', '--porcelain'])).trim()) throw new Error('Test worktree changed during execution');
  cleanup = !stopped && !report.errors?.length ? 'passed' : 'failed';
} catch (e) { error = String(e); }
const summary = { schemaVersion: 1, requestId: request.id, targetId: request.target.id, environment: request.target.environment,
  businessSha: request.businessSha, testSha: request.package.testSha, packageHash: request.package.hash, mode: 'browser',
  baseUrl: verified.baseUrl, entryUrl: verified.entryUrl, versionVerified: Boolean(request.target.versionUrl), versionBefore, versionAfter,
  exitCode: stopped || error ? 1 : exitCode, plannedCaseIds: automated.map(c => c.id), attempts, cleanup, rawReportHash, error };
await writeFile(resolve(outputDir, 'test-summary.json.tmp'), JSON.stringify(summary), { mode: 0o600 });
await rename(resolve(outputDir, 'test-summary.json.tmp'), resolve(outputDir, 'test-summary.json'));
process.exitCode = summary.exitCode;
if (process.connected) process.disconnect();
