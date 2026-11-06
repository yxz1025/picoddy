import test from 'node:test';
import assert from 'node:assert/strict';
import { nextOccurrence } from '../src/automation.ts';

test('cron honors Shanghai timezone and advances once',()=>{
  const next=nextOccurrence('0 9 * * *','Asia/Shanghai',new Date('2026-10-12T00:00:00Z'));
  assert.equal(next.toISOString(),'2026-10-12T01:00:00.000Z');
});
test('invalid timezone and cron are rejected',()=>{
  assert.throws(()=>nextOccurrence('not cron','Asia/Shanghai',new Date()));
  assert.throws(()=>nextOccurrence('0 9 * * *','Not/AZone',new Date()));
});
