import assert from 'node:assert/strict';
import test from 'node:test';
import { createModelActivity } from '../src/agent/model-activity.ts';
const event = (type: string, delta = '') => ({ type: 'message_update', assistantMessageEvent: { type, delta } });
test('silent tool argument generation reports increasing progress with bounded event rate', () => {
  let now = 0; const activity = createModelActivity(() => now);
  assert.equal(activity(event('toolcall_start'))?.phase, 'tool_input');
  assert.equal(activity(event('toolcall_delta', 'secret-data')), null);
  now = 1000;
  const result = activity(event('toolcall_delta', 'more'));
  assert.equal(result?.characters, 15);
  assert.match(result!.message, /15/);
  assert.doesNotMatch(JSON.stringify(result), /secret-data/);
  assert.equal(activity({type:'message_end'})?.phase, 'idle');
  now = 2000;
  assert.equal(activity(event('toolcall_start'))?.characters, 0);
});
test('reasoning activity and new provider turn are visible without exposing reasoning text', () => {
  const activity = createModelActivity(() => 0);
  assert.equal(activity({type:'message_start',message:{role:'assistant'}})?.phase, 'waiting');
  const progress = activity(event('thinking_delta', 'private model text'));
  assert.equal(progress?.phase, 'thinking');
  assert.doesNotMatch(JSON.stringify(progress), /private model text/);
  assert.equal(activity(event('text_delta', 'answer'))?.phase, 'idle');
  assert.equal(activity(event('text_delta', 'more')), null);
});
