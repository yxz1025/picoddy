import assert from 'node:assert/strict';
import test from 'node:test';
import { taskIdFromUrl, syncTaskUrl } from '../web/desktop/src/taskNavigation.ts';
const a = '11111111-1111-4111-8111-111111111111';
const b = '22222222-2222-4222-8222-222222222222';

test('task addresses round-trip and preserve other URL components without duplicate history', () => {
  const location = { href: 'http://localhost:5174/?view=chat#section' };
  const entries: string[] = [];
  const history = { state: { keep: true }, pushState(state: unknown, _title: string, url: string) {
    assert.deepEqual(state, { keep: true }); entries.push(url); location.href = url;
  }, replaceState(_state: unknown, _title: string, url: string) { location.href = url; } };
  syncTaskUrl(a, { location, history });
  assert.equal(taskIdFromUrl(location.href), a);
  assert.match(location.href, /view=chat/);
  assert.match(location.href, /#section$/);
  syncTaskUrl(a, { location, history });
  assert.equal(entries.length, 1);
  syncTaskUrl(b, { location, history });
  assert.equal(taskIdFromUrl(location.href), b);
  syncTaskUrl(null, { location, history });
  assert.equal(location.href, 'http://localhost:5174/?view=chat#section');
  assert.equal(taskIdFromUrl(entries[0]), a);
});

test('invalid task IDs are not used as conversation paths', () => {
  for (const id of ['', '../secret', 'bad', 'http://foreign']) {
    assert.equal(taskIdFromUrl(`http://localhost/?taskId=${encodeURIComponent(id)}`), null);
  }
});
