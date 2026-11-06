import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ChannelLocalStore } from './store.ts';

const storage = { isEncryptionAvailable: () => true, encryptString: (s: string) => Buffer.from(s).map(v => v ^ 42), decryptString: (b: Buffer) => Buffer.from(b).map(v => v ^ 42).toString() };
test('stores credentials encrypted, reloads bindings, and fails closed on corruption', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'channels-'));
  try {
    const path = join(dir, 'channels.enc'); const store = new ChannelLocalStore(path, storage);
    await store.save({ version: 1, connections: [{ connection: { id: 'a', channelId: 'dingtalk', name: 'Bot', config: {} }, credentials: { clientId: 'id', clientSecret: 'secret' }, enabled: true }], sessions: { group: 'session' } });
    assert.ok(!(await readFile(path)).includes(Buffer.from('secret')));
    assert.equal((await store.load()).sessions.group, 'session');
    await writeFile(path, 'invalid');
    await assert.rejects(() => store.load(), /无法读取/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
test('refuses plaintext storage backend', async () => {
  const store = new ChannelLocalStore('/tmp/unused-channel-test', { ...storage, getSelectedStorageBackend: () => 'basic_text' });
  await assert.rejects(() => store.save({ version: 1, connections: [], sessions: {} }), /安全存储/);
});
