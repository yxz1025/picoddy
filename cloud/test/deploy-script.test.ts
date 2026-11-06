import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdir, mkdtemp, readFile, writeFile, chmod, stat, rm } from 'node:fs/promises';
import { parseEnv } from 'node:util';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';
const exec = promisify(execFile);
const script = fileURLToPath(new URL('../deploy/deploy.sh', import.meta.url));

async function fixture(work: (run: (command: string, extra?: Record<string, string>) => Promise<{stdout: string; stderr: string}>, envPath: string, log: string) => Promise<void>) {
  const dir = await mkdtemp(join(tmpdir(), 'cloud-deploy-test-'));
  const envPath = join(dir, 'production.env'), log = join(dir, 'calls');
  try {
    await writeFile(join(dir, 'local.env'), `DATABASE_URL=postgresql://local:local-db-password@localhost/db\nPOSTGRES_PASSWORD=local-db-password\nENCRYPTION_KEY=${'a'.repeat(64)}\nSANDBOX_API_KEY='local-$sandbox-secret'\nSANDBOX_IMAGE=picoddy-cloud-sandbox:0.1.0\nOSS_ACCESS_KEY_SECRET='local-$oss-secret'\n`);
    await mkdir(join(dir, 'data'));
    await writeFile(join(dir, 'data', 'skillhub-secret.enc'), 'encrypted-fixture');
    await writeFile(join(dir, 'docker'), `#!/bin/sh
printf '%s\\n' "$*" >> "$MOCK_LOG"
case "$*" in
  *scripts/deploy-preflight.mjs*) exit "\${MOCK_PREFLIGHT_FAIL:-0}";;
  *"ps --status running -q api"*) [ "\${MOCK_ACTIVE:-0}" = 1 ] && printf 'existing-api\\n'; exit 0;;
  *"SELECT count(*)"*) [ "\${MOCK_ACTIVE:-0}" = 1 ] && exit 1;;
esac
exit 0
`);
    await chmod(join(dir, 'docker'), 0o755);
    const run = (command: string, extra: Record<string, string> = {}) => exec('bash', [script, command, envPath], {
      env: { ...process.env, PATH: `${dir}:${process.env.PATH}`, MOCK_LOG: log, LOCAL_ENV_FILE: join(dir, 'local.env'), ...extra },
    });
    await work(run, envPath, log);
  } finally { await rm(dir, { recursive: true, force: true }); }
}

async function configured(envPath: string) {
  const text = (await readFile(envPath, 'utf8')).replaceAll('CHANGE_ME-sandbox.example.com', 'sandbox.example.com')
    .replaceAll('CHANGE_ME.example.com', 'cloud.example.com').replaceAll('SANDBOX_API_KEY=CHANGE_ME', 'SANDBOX_API_KEY=test-secret');
  await writeFile(envPath, text);
}

test('deployment init preserves local secrets and refuses to overwrite them', async () => fixture(async (run, envPath) => {
  const result = await run('init');
  const original = await readFile(envPath, 'utf8');
  const values = parseEnv(original);
  assert.equal(values.ENCRYPTION_KEY, 'a'.repeat(64));
  assert.equal(values.POSTGRES_PASSWORD, 'local-db-password');
  assert.equal(values.SANDBOX_API_KEY, 'local-$sandbox-secret');
  assert.equal(values.OSS_ACCESS_KEY_SECRET, 'local-$oss-secret');
  assert.equal(values.SANDBOX_DOMAIN, 'http://opensandbox-server:8090');
  assert.equal(await readFile(join(envPath, '..', 'secrets', 'skillhub-secret.enc'), 'utf8'), 'encrypted-fixture');
  assert.equal(values.SKILLHUB_SECRET_FILE, '/app/secrets/skillhub-secret.enc');
  assert.equal((await stat(envPath)).mode & 0o777, 0o600);
  assert.ok(!result.stdout.includes(values.ENCRYPTION_KEY));
  await assert.rejects(run('init'));
  assert.equal(await readFile(envPath, 'utf8'), original);
}));

test('deployment validates before initialization and checks readiness after starting services', async () => fixture(async (run, envPath, log) => {
  await run('init'); await configured(envPath); await run('deploy');
  const calls = await readFile(log, 'utf8');
  assert.ok(calls.indexOf('scripts/deploy-preflight.mjs') < calls.indexOf('up -d --wait'));
  assert.ok(calls.indexOf('run --rm --no-deps -T initialize') < calls.indexOf('api worker scheduler'));
  assert.match(calls, /\/api\/ready/);
  assert.ok(calls.indexOf('build sandbox-image') < calls.indexOf('up -d --wait --wait-timeout 180 opensandbox-server'));
  assert.ok(calls.indexOf('deploy-sandbox-smoke.mjs') < calls.indexOf('api worker scheduler'));
  assert.doesNotMatch(calls, /down|--volumes|DROP|TRUNCATE/);
}));

test('bad configuration and active tasks prevent service replacement', async () => fixture(async (run, envPath, log) => {
  await run('init'); await configured(envPath);
  await assert.rejects(run('deploy', { MOCK_PREFLIGHT_FAIL: '1' }));
  assert.doesNotMatch(await readFile(log, 'utf8'), /up -d/);
  await writeFile(log, '');
  await assert.rejects(run('deploy', { MOCK_ACTIVE: '1' }));
  assert.doesNotMatch(await readFile(log, 'utf8'), /up -d/);
}));
