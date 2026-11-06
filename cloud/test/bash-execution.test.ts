import assert from 'node:assert/strict';
import test from 'node:test';
import { executeBash } from '../src/agent/tools/bash-execution.ts';
import type { RunSelection } from '../src/cloud/runs/types.ts';
const full = { permission: 'full', runtimeProfile: { mode: 'craft', category: 'assistant' } } as RunSelection;
function fixture() {
  const events: string[] = [];
  return { events, deps: {
    guard: async () => { events.push('guard'); },
    exec: async (command: string, signal?: AbortSignal) => { signal?.throwIfAborted(); events.push(command); return { stdout: 'ok', stderr: '', exitCode: 0 }; },
  } };
}
test('full access executes successive sandbox commands without approvals', async () => {
  const f = fixture();
  for (const command of ['go version', 'python3 --version']) {
    assert.equal((await executeBash(full, command, f.deps)).stdout, 'ok');
  }
  assert.deepEqual(f.events, ['guard', 'go version', 'guard', 'python3 --version']);
});
test('readonly, plan, ask, and delegation restrictions reject shell before execution', async () => {
  for (const selection of [
    { ...full, permission: 'readonly' },
    { ...full, runtimeProfile: { mode: 'plan', category: 'assistant' } },
    { ...full, runtimeProfile: { mode: 'ask', category: 'assistant' } },
    { ...full, delegation: { allowedToolNames: ['read'] } },
  ]) {
    const f = fixture();
    await assert.rejects(executeBash(selection as RunSelection, 'go version', f.deps), /BASH_PERMISSION_DENIED/);
    assert.deepEqual(f.events, []);
  }
});
test('lost lease and cancellation prevent sandbox execution', async () => {
  const f = fixture();
  await assert.rejects(executeBash(full, 'go version', { ...f.deps, guard: async () => { throw new Error('RUN_LEASE_LOST'); } }), /RUN_LEASE_LOST/);
  const controller = new AbortController(); controller.abort();
  await assert.rejects(executeBash(full, 'go version', f.deps, controller.signal), /abort/i);
  assert.deepEqual(f.events, []);
  const during = new AbortController();
  await assert.rejects(executeBash(full, 'go version', { ...f.deps, guard: async () => { during.abort(); } }, during.signal), /abort/i);
  assert.deepEqual(f.events, []);
});
