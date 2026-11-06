import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildChannelKnowledgeEnvelope, channelKnowledgeMessages } from './channel-knowledge.ts';
import { getEmbeddedBuiltinSkillsBundle } from '../builtin_skills/bundle.ts';

const tool = { name: 'knowledge_read', description: 'read-only', parameters: { type: 'object', properties: {} } } as any;
test('directory knowledge keeps only this turn and tool results, exposes only the directory reader', async () => {
  const permission = { level: 'L1', platform: 'darwin', check: async () => ({ allow: false }) } as any;
  const envelope = buildChannelKnowledgeEnvelope('报销', { name: 'directory-knowledge', instructions: '读取导航与正文', tools: [tool] }, permission);
  const messages = [
    { role: 'user', content: '其他项目秘密', timestamp: 1 },
    { role: 'user', content: envelope.userPrompt, timestamp: 2 },
    { role: 'assistant', content: [], timestamp: 3 },
    { role: 'toolResult', toolCallId: 'call', toolName: 'knowledge_read', content: [{ type: 'text', text: '[1] 制度.md:1 发票' }], details: {}, isError: false, timestamp: 4 },
  ] as any;
  const projected = channelKnowledgeMessages(messages, envelope.systemPrompt, envelope.userPrompt, [tool]);
  assert.equal(projected.length, 4); assert.ok(!JSON.stringify(projected).includes('其他项目秘密'));
  assert.ok(JSON.stringify(projected).includes('制度.md'));
  assert.deepEqual(envelope.activeToolNames, ['knowledge_read']);
  assert.equal((await envelope.permissionPolicy.check('bash', {})).allow, false);
  assert.equal((await envelope.permissionPolicy.check('knowledge_read', {})).allow, true);
  assert.ok(envelope.systemPrompt.includes('读取导航与正文'));
});
test('obsidian-cli is not shipped in the builtin bundle', () => {
  const bundle = getEmbeddedBuiltinSkillsBundle();
  assert.ok(!bundle.manifest.skills.some(skill => skill.name === 'obsidian-cli'));
});
