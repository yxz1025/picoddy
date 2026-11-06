import assert from 'node:assert/strict';
import test from 'node:test';
import { loadConfig } from '../src/config.ts';
import { Readable } from 'node:stream';
import { createOssStorage } from '../src/platform/storage-oss.ts';

const env = {
  DATABASE_URL: 'postgresql://cloud:cloud@localhost/cloud_test', PUBLIC_ORIGIN: 'https://app.example.test',
  ENCRYPTION_KEY: '0123456789abcdef0123456789abcdef', SANDBOX_DOMAIN: 'https://sandbox.example.test', SANDBOX_API_KEY: 'sandbox',
  STORAGE_DRIVER: 'oss', OSS_REGION: 'oss-cn-hangzhou', OSS_BUCKET: 'cloud-files',
  OSS_ACCESS_KEY_ID: 'key', OSS_ACCESS_KEY_SECRET: 'secret',
};

test('OSS config uses independent credentials and requires HTTPS endpoints', () => {
  const config = loadConfig(env);
  assert.equal(config.storageDriver, 'oss');
  assert.equal(config.oss?.accessKeyId, 'key');
  assert.equal(config.storageAccessKey, '');
  for (const key of ['OSS_REGION', 'OSS_BUCKET', 'OSS_ACCESS_KEY_ID', 'OSS_ACCESS_KEY_SECRET']) {
    assert.throws(() => loadConfig({ ...env, [key]: '' }), new RegExp(key));
  }
  for (const endpoint of ['http://oss-cn-hangzhou.aliyuncs.com', 'https://user:pass@oss.example.test', 'https://oss.example.test/path']) {
    assert.throws(() => loadConfig({ ...env, OSS_ENDPOINT: endpoint }), /OSS_ENDPOINT/);
  }
  assert.throws(() => loadConfig({ ...env, OSS_STS_TOKEN: 'temporary' }), /STS/);
});

test('OSS adapter streams within budget, closes overflow, validates keys, and propagates service failures', async () => {
  const calls: unknown[][] = [];
  let stream: Readable;
  let unavailable = false;
  const client = {
    async put(...args: unknown[]) { calls.push(['put', ...args]); },
    async getStream(key: string) {
      calls.push(['get', key]);
      if (unavailable) throw new Error('Unavailable');
      stream = Readable.from([Buffer.from('abc'), Buffer.from('def')]);
      return { stream };
    },
    async delete(key: string) { calls.push(['delete', key]); },
    async getBucketInfo(bucket: string) { calls.push(['ready', bucket]); },
  } as unknown as NonNullable<Parameters<typeof createOssStorage>[1]>;
  const storage = createOssStorage(loadConfig(env), client);
  await storage.ready();
  await storage.put('users/id/files/file', Buffer.from('body'), 'text/plain');
  assert.equal(Buffer.from(await storage.get('users/id/files/file', 6)).toString(), 'abcdef');
  await assert.rejects(storage.get('users/id/files/file', 5), /limit/);
  assert.equal(stream!.destroyed, true);
  await storage.remove('users/id/files/file');
  assert.deepEqual(calls[0], ['ready', 'cloud-files']);
  assert.deepEqual(calls[1], ['put', 'users/id/files/file', Buffer.from('body'), { mime: 'text/plain' }]);
  const before = calls.length;
  for (const key of ['../secret', '/absolute', 'user//file']) {
    await assert.rejects(storage.get(key), /storage key/);
    await assert.rejects(storage.put(key, Buffer.alloc(0), 'text/plain'), /storage key/);
    await assert.rejects(storage.remove(key), /storage key/);
  }
  assert.equal(calls.length, before);
  unavailable = true;
  await assert.rejects(storage.get('users/id/files/file'), /Unavailable/);
});
