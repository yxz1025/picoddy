import assert from 'node:assert/strict';
import test from 'node:test';
import { parsePreferencePatch, readPromptSettings } from '../src/domains/settings/node/preferences.ts';

test('prompt preferences preserve whitespace and reject unsupported/oversized fields', () => {
  assert.deepEqual(parsePreferencePatch({ agentSystemPrompt: '\n规则\n', language: 'zh-CN' }), { agentSystemPrompt: '\n规则\n', language: 'zh-CN' });
  for (const input of [null, [], { agentSystemPrompt: 42 }, { agentSystemPrompt: 'x'.repeat(8001) }, { apiKey: 'secret' }, { language: '' }]) {
    assert.throws(() => parsePreferencePatch(input));
  }
});

test('prompt snapshot queries only authenticated owner and maps desktop names', async () => {
  const calls: unknown[][] = [];
  const db = { async query(_sql: string, values?: unknown[]) {
    calls.push(values ?? []);
    return { rows: [{ data: { agentSystemPrompt: 'my rules', language: 'en-US', fontSize: '16' } }] };
  } };
  assert.deepEqual(await readPromptSettings(db, 'owner-a'), { customInstructions: 'my rules', language: 'en-US' });
  assert.deepEqual(calls, [['owner-a']]);
});

test('an account with no preferences has deterministic empty instructions', async () => {
  assert.deepEqual(await readPromptSettings({ async query() { return { rows: [] }; } }, 'owner-b'), { customInstructions: '', language: 'zh-CN' });
});
