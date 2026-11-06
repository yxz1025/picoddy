import assert from 'node:assert/strict';
import test from 'node:test';

import type { Config } from '../src/config.ts';
import type { CloudSandbox } from '../src/platform/sandbox.ts';
import type { Storage } from '../src/platform/storage.ts';
import {
  liveSmokeFailureMessage,
  runLiveSandboxOssSmoke,
  type LiveSmokeDependencies,
} from '../scripts/live-smoke-core.ts';

const LIVE_ENV = {
  DATABASE_URL: 'postgresql://not-used-by-unit-test',
  ENCRYPTION_KEY: 'not-logged-encryption-secret',
  SANDBOX_DOMAIN: 'https://sandbox.example.test',
  SANDBOX_API_KEY: 'not-logged-sandbox-secret',
  SANDBOX_IMAGE: 'cloud-sandbox:test',
  OSS_REGION: 'oss-cn-hangzhou',
  OSS_BUCKET: 'private-bucket',
  OSS_ACCESS_KEY_ID: 'not-logged-access-key',
  OSS_ACCESS_KEY_SECRET: 'not-logged-access-secret',
  STORAGE_DRIVER: 'oss',
};

test('unknown failure output never includes underlying errors or credentials', () => {
  const message = liveSmokeFailureMessage(new Error('request failed: oss-secret-secret'));
  assert.equal(message, 'LIVE_SANDBOX_OSS_SMOKE_FAILED stage=unknown cleanup=unknown');
  assert.doesNotMatch(message, /secret|request/i);
});

async function failureMessage(promise: Promise<unknown>): Promise<string> {
  let captured: unknown;
  try {
    await promise;
  } catch (error) {
    captured = error;
  }
  assert.ok(captured, 'expected smoke harness to reject');
  return liveSmokeFailureMessage(captured);
}

function config(driver: Config['storageDriver'] = 'oss'): Config {
  return {
    databaseUrl: 'postgresql://unused', host: '127.0.0.1', port: 0,
    publicOrigin: 'https://app.example.test', secureCookies: true,
    encryptionKey: '0123456789abcdef0123456789abcdef',
    casLoginUrl: 'https://sso.example.test/cas/login',
    casExchangeUrl: 'https://gateway.example.test/cas/exchange',
    skillHubBaseUrl: 'https://market.example.test', skillHubSecret: '', skillHubSecretFile: '/unused/skillhub-secret.enc',
    skillHubDownloadHosts: ['downloads.example.test'],
    sandboxDomain: 'https://sandbox.example.test', sandboxApiKey: 'sandbox-secret',
    sandboxImage: 'cloud-sandbox:test', sandboxTimeoutSeconds: 60,
    storageDriver: driver, storageLocalRoot: '/unused', storageEndpoint: '',
    storageRegion: '', storageBucket: '', storageAccessKey: '', storageSecretKey: '',
    ...(driver === 'oss' ? { oss: {
      region: 'oss-cn-hangzhou', bucket: 'private-bucket',
      accessKeyId: 'oss-access-secret', accessKeySecret: 'oss-secret-secret',
    } } : {}),
    maxUploadBytes: 1024, workerConcurrency: 1, modelAllowedHosts: ['api.openai.com'],
  };
}

function fixedUuids() {
  const values = [
    '11111111-1111-4111-8111-111111111111',
    '22222222-2222-4222-8222-222222222222',
    '33333333-3333-4333-8333-333333333333',
    '44444444-4444-4444-8444-444444444444',
    '55555555-5555-4555-8555-555555555555',
  ];
  return () => values.shift() ?? assert.fail('unexpected UUID request');
}

function harness(options: {
  driver?: Config['storageDriver'];
  failConfig?: Error;
  failPut?: Error;
  failCreate?: Error;
  failDestroy?: Error;
  failReconcile?: Error;
  failRemove?: Error;
} = {}) {
  const calls: Array<{ name: string; args: unknown[] }> = [];
  const objects = new Map<string, Uint8Array>();
  const sandboxFiles = new Map<string, Uint8Array>();
  const payload = Buffer.from('live-smoke-payload');
  let storageCreations = 0;
  let sandboxCreations = 0;
  const storage: Storage = {
    async ready() { calls.push({ name: 'ready', args: [] }); },
    async put(key, bytes, mime) {
      calls.push({ name: 'put', args: [key, bytes, mime] });
      if (options.failPut) throw options.failPut;
      objects.set(key, bytes.slice());
    },
    async get(key, maxBytes = Number.MAX_SAFE_INTEGER) {
      calls.push({ name: 'get', args: [key, maxBytes] });
      const bytes = objects.get(key);
      if (!bytes) throw new Error('missing object');
      if (bytes.byteLength > maxBytes) throw new Error('Object exceeds storage read limit');
      return bytes.slice();
    },
    async remove(key) {
      calls.push({ name: 'remove', args: [key] });
      if (options.failRemove) throw options.failRemove;
      objects.delete(key);
    },
  };
  const sandbox: CloudSandbox = {
    id: 'sandbox-id',
    async write(path, bytes) {
      calls.push({ name: 'sandbox.write', args: [path, bytes] });
      sandboxFiles.set(path, bytes.slice());
    },
    async read(path, maxBytes = Number.MAX_SAFE_INTEGER) {
      calls.push({ name: 'sandbox.read', args: [path, maxBytes] });
      const bytes = sandboxFiles.get(path);
      if (!bytes) throw new Error('missing sandbox file');
      if (bytes.byteLength > maxBytes) throw new Error('sandbox read limit');
      return bytes.slice();
    },
    async exec() { throw new Error('exec is not needed by restoreWorkspace'); },
    async destroy() {
      calls.push({ name: 'destroy', args: [] });
      if (options.failDestroy) throw options.failDestroy;
    },
  };
  const dependencies: LiveSmokeDependencies = {
    loadConfig() {
      calls.push({ name: 'loadConfig', args: [] });
      if (options.failConfig) throw options.failConfig;
      return config(options.driver);
    },
    createStorage() {
      storageCreations += 1;
      calls.push({ name: 'createStorage', args: [] });
      return storage;
    },
    async createSandbox(_config, runId, signal?: AbortSignal) {
      sandboxCreations += 1;
      calls.push({ name: 'createSandbox', args: [runId, signal] });
      if (options.failCreate) throw options.failCreate;
      return sandbox;
    },
    async reconcileRunSandboxes(_config, runId) {
      calls.push({ name: 'reconcile', args: [runId] });
      if (options.failReconcile) throw options.failReconcile;
    },
    randomUUID: fixedUuids(),
    randomBytes() { return payload.slice(); },
  };
  return {
    calls, dependencies, payload,
    storageCreations: () => storageCreations,
    sandboxCreations: () => sandboxCreations,
  };
}

test('fails closed before creating storage when configuration is absent', async () => {
  const setup = harness();

  const message = await failureMessage(runLiveSandboxOssSmoke({}, setup.dependencies));

  assert.equal(message,
    'LIVE_SANDBOX_OSS_SMOKE_FAILED stage=preflight cleanup=complete ' +
    'missing=DATABASE_URL,ENCRYPTION_KEY,SANDBOX_DOMAIN,SANDBOX_API_KEY,SANDBOX_IMAGE,OSS_REGION,OSS_BUCKET,' +
    'OSS_ACCESS_KEY_ID,OSS_ACCESS_KEY_SECRET,STORAGE_DRIVER');
  assert.equal(setup.storageCreations(), 0);
  assert.equal(setup.sandboxCreations(), 0);
  assert.equal(setup.calls.some(call => call.name === 'loadConfig'), false);
});

test('rejects non-OSS configuration instead of falling back to local storage', async () => {
  const setup = harness({ driver: 'local' });

  const message = await failureMessage(runLiveSandboxOssSmoke(LIVE_ENV, setup.dependencies));
  assert.match(message, /^LIVE_SANDBOX_OSS_SMOKE_FAILED stage=config cleanup=complete runId=/);
  assert.match(message, / objectKey=users\/[0-9a-f-]+\/workspaces\/[0-9a-f-]+\/[0-9a-f-]+\/[0-9a-f-]+$/);
  assert.equal(setup.storageCreations(), 0);
  assert.equal(setup.sandboxCreations(), 0);
});

test('roundtrips a random OSS object through workspace restore and cleans exact resources', async () => {
  const setup = harness();

  const result = await runLiveSandboxOssSmoke(LIVE_ENV, setup.dependencies);

  const expectedKey = 'users/22222222-2222-4222-8222-222222222222/workspaces/' +
    '33333333-3333-4333-8333-333333333333/44444444-4444-4444-8444-444444444444/' +
    '55555555-5555-4555-8555-555555555555';
  assert.deepEqual(result, { bytes: setup.payload.byteLength, guardChecks: 2 });
  assert.deepEqual(setup.calls.filter(call => call.name === 'remove').map(call => call.args), [[expectedKey]]);
  assert.deepEqual(setup.calls.filter(call => call.name === 'reconcile').map(call => call.args), [
    ['11111111-1111-4111-8111-111111111111'],
  ]);
  assert.equal(setup.calls.filter(call => call.name === 'destroy').length, 1);
  assert.equal(setup.calls.some(call => call.name === 'sandbox.write' && call.args[0] === '/workspace/work/smoke.bin'), true);
  assert.equal(setup.calls.some(call => call.name === 'sandbox.read' && call.args[0] === '/workspace/work/smoke.bin'), true);
  const readLimits = setup.calls.filter(call => call.name === 'get').map(call => call.args[1]);
  assert.deepEqual(readLimits.slice(0, 2), [setup.payload.byteLength, setup.payload.byteLength - 1]);
  assert.equal(readLimits.includes(25 * 1024 * 1024), true);
});

test('reconciles a sandbox and removes the exact object when create response is lost', async () => {
  const setup = harness({ failCreate: new Error('response lost with oss-secret-secret') });

  const message = await failureMessage(runLiveSandboxOssSmoke(LIVE_ENV, setup.dependencies));

  assert.equal(message,
    'LIVE_SANDBOX_OSS_SMOKE_FAILED stage=sandbox_create cleanup=complete ' +
    'runId=11111111-1111-4111-8111-111111111111 ' +
    'objectKey=users/22222222-2222-4222-8222-222222222222/workspaces/' +
    '33333333-3333-4333-8333-333333333333/44444444-4444-4444-8444-444444444444/' +
    '55555555-5555-4555-8555-555555555555');
  assert.doesNotMatch(message, /oss-secret-secret|response lost/);
  assert.equal(setup.calls.filter(call => call.name === 'destroy').length, 0);
  assert.equal(setup.calls.filter(call => call.name === 'reconcile').length, 1);
  assert.equal(setup.calls.filter(call => call.name === 'remove').length, 1);
});

test('attempts object cleanup after an ambiguous put failure', async () => {
  const setup = harness({ failPut: new Error('put response lost') });

  const message = await failureMessage(runLiveSandboxOssSmoke(LIVE_ENV, setup.dependencies));
  assert.match(message, /stage=oss_put cleanup=complete/);
  assert.doesNotMatch(message, /put response lost/);
  assert.equal(setup.sandboxCreations(), 0);
  assert.equal(setup.calls.filter(call => call.name === 'remove').length, 1);
  assert.equal(setup.calls.filter(call => call.name === 'reconcile').length, 0);
});

test('cleanup stages are independent and every failure is retained', async () => {
  const setup = harness({
    failDestroy: new Error('destroy failed'),
    failReconcile: new Error('reconcile failed'),
    failRemove: new Error('remove failed'),
  });

  const message = await failureMessage(runLiveSandboxOssSmoke(LIVE_ENV, setup.dependencies));
  assert.match(message, /stage=cleanup cleanup=incomplete/);
  assert.match(message, /cleanupFailures=destroy,reconcile,remove/);
  assert.doesNotMatch(message, /destroy failed|reconcile failed|remove failed/);
  assert.deepEqual(
    setup.calls.filter(call => ['destroy', 'reconcile', 'remove'].includes(call.name)).map(call => call.name),
    ['destroy', 'reconcile', 'remove'],
  );
});

test('passes cancellation to sandbox work while still reconciling and removing the object', async () => {
  const setup = harness();
  const controller = new AbortController();
  setup.dependencies.createSandbox = async (_config, _runId, signal) => {
    controller.abort(new Error('operator cancellation secret'));
    signal?.throwIfAborted();
    assert.fail('aborted create must not return a sandbox');
  };

  const message = await failureMessage(
    runLiveSandboxOssSmoke(LIVE_ENV, setup.dependencies, controller.signal),
  );

  assert.match(message, /stage=sandbox_create cleanup=complete/);
  assert.doesNotMatch(message, /operator cancellation secret/);
  assert.equal(setup.calls.filter(call => call.name === 'reconcile').length, 1);
  assert.equal(setup.calls.filter(call => call.name === 'remove').length, 1);
});
