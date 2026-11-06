import assert from 'node:assert/strict';
import test from 'node:test';
import * as sync from '../src/domains/workspace/node/sync.ts';
import { createHash } from 'node:crypto';
import type { Storage } from '../src/platform/storage.ts';
import type { CloudSandbox } from '../src/platform/sandbox.ts';

test('workspace manifests persist only canonical work/output paths with bounded unique files', () => {
  const file = { path: 'work/report.txt', size: 4, sha256: 'a'.repeat(64) };
  assert.deepEqual(sync.validateManifest([file]), [file]);
  for (const path of ['../secret', 'skills/tool.py', 'input/a.txt', '/workspace/work/a', 'work/../a', 'work/a\\b', 'work//a', 'work/CON']) {
    assert.throws(() => sync.validateManifest([{ ...file, path }]), /path/i);
  }
  assert.throws(() => sync.validateManifest([file, file]), /duplicate/i);
  assert.throws(() => sync.validateManifest([file, { ...file, path: 'work/report.txt/child' }]), /path/i);
  assert.throws(() => sync.validateManifest([{ ...file, size: 26 * 1024 * 1024 }]), /limit/i);
  assert.throws(() => sync.validateManifest([{ ...file, sha256: 'bad' }]), /hash/i);
});

test('restore refuses a foreign owner or scope before storage or sandbox access', async () => {
  let touched = false;
  const storage = { get: async () => { touched = true; return Buffer.from('safe'); } } as unknown as Storage;
  const sandbox = { write: async () => { touched = true; } } as unknown as CloudSandbox;
  const snapshot: sync.WorkspaceSnapshot = { ownerId: 'alice', scopeId: 'space-a', revision: 1,
    files: [{ path: 'work/a.txt', size: 4, sha256: createHash('sha256').update('safe').digest('hex'), objectKey: 'users/alice/workspaces/space-a/v/f' }] };
  await assert.rejects(sync.restoreWorkspace(snapshot, 'bob', storage, sandbox, async () => {}), /OWNER/);
  await assert.rejects(sync.restoreWorkspace({ ...snapshot, files: [{ ...snapshot.files[0], objectKey: 'users/alice/workspaces/space-b/v/f' }] }, 'alice', storage, sandbox, async () => {}), /SCOPE/);
  assert.equal(touched, false);
});

test('restore validates hash and lease before writing only the frozen files', async () => {
  const writes: string[] = [];
  let guards = 0;
  const snapshot: sync.WorkspaceSnapshot = { ownerId: 'alice', scopeId: 'space-a', revision: 1,
    files: [{ path: 'work/a.txt', size: 4, sha256: createHash('sha256').update('safe').digest('hex'), objectKey: 'users/alice/workspaces/space-a/v/f' }] };
  const storage = { get: async () => Buffer.from('safe') } as unknown as Storage;
  const sandbox = { write: async (path: string) => { writes.push(path); } } as unknown as CloudSandbox;
  await sync.restoreWorkspace(snapshot, 'alice', storage, sandbox, async () => { guards++; });
  assert.deepEqual(writes, ['/workspace/work/a.txt']);
  assert.equal(guards, 2);
  assert.throws(() => sync.verifyWorkspaceBytes(snapshot.files[0], Buffer.from('evil')), /CHANGED/);
});
