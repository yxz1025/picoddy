import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from '../web/src/lib/uuid.ts';

test('UUID works on HTTP where crypto.randomUUID is unavailable', () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
  let calls = 0;
  Object.defineProperty(globalThis, 'crypto', { configurable: true, value: {
    getRandomValues(bytes: Uint8Array) { calls++; bytes.fill(0xab); return bytes; },
  }});
  try {
    assert.equal(randomUUID(), 'abababab-abab-4bab-abab-abababababab');
    assert.equal(calls, 1);
  } finally { if (original) Object.defineProperty(globalThis, 'crypto', original); else Reflect.deleteProperty(globalThis, 'crypto'); }
});
