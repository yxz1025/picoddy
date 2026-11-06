import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ResourceCache } from '../src/agent/resource-cache.ts';
test('resource cache reuses unchanged trees and invalidates edits, additions and removals', () => {
 const root = mkdtempSync(join(tmpdir(), 'resource-cache-'));
 try {
  const cache = new ResourceCache<number>(); let loads = 0;
  const get = () => cache.get([root], () => ++loads);
  assert.equal(get(), 1); assert.equal(get(), 1);
  mkdirSync(join(root, 'nested')); writeFileSync(join(root, 'nested', 'SKILL.md'), 'one');
  assert.equal(get(), 2); assert.equal(get(), 2);
  writeFileSync(join(root, 'nested', 'SKILL.md'), 'changed content'); assert.equal(get(), 3);
  rmSync(join(root, 'nested'), { recursive: true }); assert.equal(get(), 4);
  cache.clear(); assert.equal(get(), 5);
 } finally { rmSync(root, { recursive: true, force: true }); }
});
test('failed loads are retried rather than cached', () => {
 const cache = new ResourceCache<number>();
 assert.throws(() => cache.get([], () => { throw new Error('failed'); }));
 assert.equal(cache.get([], () => 2), 2);
});
test('async cache shares pending work and retries rejected loads', async () => {
 const cache = new ResourceCache<Promise<number>>(); let loads = 0;
 let reject!: (reason: Error) => void;
 const first = cache.get([], () => { loads++; return new Promise<number>((_, fail) => { reject = fail; }); });
 assert.equal(cache.get([], () => { loads++; return Promise.resolve(99); }), first);
 reject(new Error('unavailable')); await assert.rejects(first);
 assert.equal(await cache.get([], async () => { loads++; return 3; }), 3);
 assert.equal(loads, 2);
});
test('missing resource roots invalidate when created and deleted', () => {
 const parent = mkdtempSync(join(tmpdir(), 'resource-missing-')); const root = join(parent, 'skills');
 try {
  const cache = new ResourceCache<number>(); let loads = 0;
  const get = () => cache.get([root], () => ++loads);
  assert.equal(get(), 1); assert.equal(get(), 1);
  mkdirSync(root); assert.equal(get(), 2);
  rmSync(root, { recursive: true }); assert.equal(get(), 3);
 } finally { rmSync(parent, { recursive: true, force: true }); }
});
