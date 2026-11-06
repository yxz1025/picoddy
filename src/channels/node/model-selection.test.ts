import { test } from 'node:test';
import assert from 'node:assert/strict';
import { selectChannelModel } from './model-selection.ts';
test('unconfigured channel never silently chooses a built-in model', () => {
  assert.throws(() => selectChannelModel({ provider: '', modelId: '' }, { provider: '', modelId: '' }), /默认模型/);
});
test('an existing selection wins and blank sessions recover from configured defaults', () => {
  const current = { provider: 'custom', modelId: 'chosen' };
  assert.deepEqual(selectChannelModel(current, { provider: 'other', modelId: 'default' }), current);
  assert.deepEqual(selectChannelModel({ provider: '', modelId: '' }, current), current);
});
