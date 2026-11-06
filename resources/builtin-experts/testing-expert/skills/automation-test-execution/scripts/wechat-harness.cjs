'use strict';
// Internal child of run-wechat.cjs. Uses the public WeChat SDK, with Node's test framework.
const { before, after, test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');
const request = JSON.parse(fs.readFileSync(process.env.WECHAT_TEST_REQUEST, 'utf8'));
const load = createRequire(path.join(request.root, 'package.json'));
const modules = new Map();
let miniProgram; let timedOut = false;
const context = () => ({ miniProgram, assert, environment: request.config.environment || 'test' });
before(async () => {
  const automator = load(request.sdk);
  // Official SDK launch starts/connects DevTools; CLI/HTTP permission must already be enabled.
  miniProgram = await automator.launch({ cliPath: request.config.cliPath, projectPath: request.project, timeout: 60000 });
  for (const [key, source] of Object.entries(request.scripts)) {
    const module = load(source.path);
    assert.ok(module.cases && typeof module.cases === 'object', `Missing cases export: ${key}`);
    modules.set(key, module); // A failed setup still gets its teardown.
    if (module.setup) await module.setup(context());
  }
}, { timeout: 120000 });
after(async () => {
  const errors = [];
  for (const module of [...modules.values()].reverse()) {
    try { if (module.teardown) await module.teardown(context()); } catch (e) { errors.push(String(e)); }
  }
  try { if (miniProgram) await miniProgram.close(); } catch (e) { errors.push(String(e)); }
  const target = path.join(request.output, 'cleanup.json');
  fs.writeFileSync(`${target}.tmp`, JSON.stringify({ status: errors.length || timedOut ? 'failed' : 'passed', errors }), { mode: 0o600 });
  fs.renameSync(`${target}.tmp`, target);
  if (errors.length) throw Error(errors.join('\n'));
}, { timeout: 120000 });
for (const row of request.config.cases.filter(c => c.automation === 'automated')) {
  test(row.id, { timeout: request.timeoutMs, concurrency: false }, async t => {
    assert.equal(timedOut, false, 'Earlier test timed out; remaining cases are blocked to avoid overlapping operations');
    const cases = modules.get(row.file)?.cases;
    assert.ok(cases && Object.hasOwn(cases, row.id), `Missing own case export: ${row.id}`);
    const execute = cases[row.id];
    assert.equal(typeof execute, 'function', `Missing executable case: ${row.id}`);
    const onAbort = () => { timedOut = true; };
    t.signal.addEventListener('abort', onAbort, { once: true });
    try { await execute({ ...context(), signal: t.signal }); }
    catch (error) {
      if (!t.signal.aborted && miniProgram) {
        try { await miniProgram.screenshot({ path: path.join(request.output, `${row.id}.png`) }); } catch {}
      }
      throw error;
    } finally { t.signal.removeEventListener('abort', onAbort); }
  });
}
