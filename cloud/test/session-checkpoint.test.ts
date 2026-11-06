import assert from 'node:assert/strict';
import test from 'node:test';
import { SessionManager } from '@earendil-works/pi-coding-agent';
import { sessionCheckpoint } from '../src/agent/session-checkpoint.ts';

test('rebased checkpoint preserves model context without obsolete messages', () => {
  const manager = SessionManager.inMemory('/workspace', { id: 'test' });
  manager.appendModelChange('test-provider', 'test-model');
  manager.appendThinkingLevelChange('off');
  manager.appendMessage({ role: 'user', content: 'old context', timestamp: 1 });
  const kept = manager.appendMessage({ role: 'user', content: 'kept context', timestamp: 2 });
  manager.appendCompaction('old context summary', kept, 100);
  manager.appendMessage({ role: 'user', content: 'new context', timestamp: 3 });
  const checkpoint = sessionCheckpoint(manager);
  const restored = SessionManager.inMemory('/workspace', undefined, checkpoint);
  assert.deepEqual(restored.buildSessionContext(), manager.buildSessionContext());
  assert.equal(JSON.stringify(checkpoint).includes('"old context"'), false);
  assert.ok(checkpoint.length < manager.getEntries().length + 1);
});

test('fully summarized prefix needs no retained original message', () => {
  const manager = SessionManager.inMemory('/workspace');
  manager.appendMessage({ role: 'user', content: 'old context', timestamp: 1 });
  manager.appendCompaction('summary', null, 100);
  const restored = SessionManager.inMemory('/workspace', undefined, sessionCheckpoint(manager));
  assert.deepEqual(restored.buildSessionContext(), manager.buildSessionContext());
});
