import test from 'node:test';
import assert from 'node:assert/strict';
import { parseDelegation, delegatedTools } from '../src/domains/delegation/node/policy.ts';

test('delegation preserves role boundaries and never delegates recursive, question or completion tools', () => {
  const parent = ['read','write','bash','mcp','subagent','goal_complete','ask_user_question','skill_draft_write'];
  assert.deepEqual(delegatedTools('worker', parent), ['read','write','bash','mcp']);
  assert.deepEqual(delegatedTools('reviewer', parent), ['read']);
  assert.deepEqual(delegatedTools('verifier', ['read']), ['read']);
});
test('delegation validates desktop single/batch shape and refuses concurrent writers', () => {
  assert.equal(parseDelegation({ role: 'worker', task: 'create report' })[0].role, 'worker');
  assert.throws(() => parseDelegation({ tasks: [{ role: 'worker', task: 'a' }, { role: 'reviewer', task: 'b' }] }));
  assert.throws(() => parseDelegation({ role: 'worker', task: 'a', tasks: [{ role: 'reviewer', task: 'b' }] }));
  assert.throws(() => parseDelegation({ role: 'unknown', task: 'a' }));
  assert.throws(() => parseDelegation({ role: 'worker', task: '' }));
});
