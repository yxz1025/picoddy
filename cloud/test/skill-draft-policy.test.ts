import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveCloudToolPolicy } from '../src/agent/tools/contracts.ts';

test('skill creator exposes draft operations but never install or arbitrary shell, and readonly narrows them', () => {
  const selection = { runtimeProfile: { mode: 'craft' as const, category: 'skill_creator' as const }, permission: 'full' as const };
  const tools = resolveCloudToolPolicy(selection);
  assert.ok(tools.includes('skill_draft_write'));
  assert.ok(tools.includes('skill_draft_import_attachment'));
  assert.equal(tools.some(name => ['bash','write','edit','mcp','skill_draft_install'].includes(name)), false);
  assert.deepEqual(resolveCloudToolPolicy({ ...selection, runtimeProfile: { ...selection.runtimeProfile, mode: 'ask' } }), []);
  const readOnly = resolveCloudToolPolicy({ ...selection, permission: 'readonly' });
  assert.ok(readOnly.includes('skill_draft_read'));
  assert.equal(readOnly.includes('skill_draft_write'), false);
  assert.equal(resolveCloudToolPolicy({ ...selection, runtimeProfile: { ...selection.runtimeProfile, category: 'assistant' } }).includes('skill_draft_write'), false);
});
