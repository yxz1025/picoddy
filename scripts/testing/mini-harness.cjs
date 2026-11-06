// Executed only by mini-worker.mjs after request and repository validation.
const { before, after, test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const { createRequire } = require('node:module');
const data = JSON.parse(readFileSync(process.env.MINI_REQUEST_PATH, 'utf8'));
const { request, verified, outputDir } = data;
const load = createRequire(resolve(verified.root, 'package.json'));
const modules = new Map();
let miniProgram;
before(async () => {
  const automator = load(verified.sdkPath);
  miniProgram = await automator.launch({ cliPath: verified.cliPath, projectPath: verified.project, timeout: 60000 });
  for (const row of verified.cases.filter(c => c.automation === 'automated')) {
    if (!modules.has(row.file)) {
      const mod = load(resolve(verified.root, row.file));
      if (!mod.cases || typeof mod.cases !== 'object') throw new Error(`Missing exported cases in ${row.file}`);
      modules.set(row.file, mod);
      if (mod.setup) await mod.setup({ miniProgram, assert, environment: request.target.environment });
    }
  }
}, { timeout: 120000 });
after(async () => {
  let failure;
  for (const mod of [...modules.values()].reverse()) {
    try { if (mod.teardown) await mod.teardown({ miniProgram, assert, environment: request.target.environment }); }
    catch (error) { failure ||= error; }
  }
  try { if (miniProgram) await miniProgram.close(); } catch (error) { failure ||= error; }
  if (failure) throw failure;
}, { timeout: 120000 });
for (const row of verified.cases.filter(c => c.automation === 'automated')) {
  test(row.id, { timeout: 60000, concurrency: false }, async () => {
    const fn = modules.get(row.file)?.cases[row.id];
    assert.equal(typeof fn, 'function', `Missing executable case ${row.id}`);
    try { await fn({ miniProgram, assert, environment: request.target.environment }); }
    catch (error) {
      try { await miniProgram.screenshot({ path: resolve(outputDir, `${row.id}.png`) }); } catch {}
      throw error;
    }
  });
}
