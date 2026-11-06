import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createChannelAgentBridge } from './bridge.ts';
import { ChannelModelConfigurationError } from './model-selection.ts';
function fixture(options: { missingModel?: boolean; stall?: boolean } = {}) {
  const messages: { id: string; role: string; content: string }[] = [];
  const prompts: { text: string; options: any }[] = [];
  const replies: string[] = []; let aborted = false;
  const bridge = createChannelAgentBridge({
    timeoutMs: options.stall ? 5 : undefined,
    provider: {
      async attachPersistence() { if (options.missingModel) throw new ChannelModelConfigurationError('请设置默认模型'); },
      async abort() { aborted = true; },
      async prompt(_id, text, opts) { prompts.push({ text, options: opts }); if (options.stall) return new Promise(() => {}); messages.push({ id: 'answer', role: 'assistant', content: '处理完成。\n\n引用来源：\n资料.md' }); },
    },
    getMessages: () => messages, appendMessage(_id, role, content) { messages.push({ id: `m${messages.length}`, role, content }); },
    setConfirmHandler() {}, clearConfirmHandler() {}, setStatus() {}, async run(work) { await work(); },
  });
  const input = { sessionId: 's', message: { channelId: 'dingtalk', connectionId: 'bot', id: 'm', conversationId: 'g', senderId: 'u', text: '查库存并回答', timestamp: 1 }, signal: new AbortController().signal, knowledge: { kind: 'directory' as const, directory: '/arbitrary vault' }, async reply(message: {text: string}) { replies.push(message.text); } };
  return { bridge, input, prompts, messages, replies, get aborted() { return aborted; } };
}
test('bound directory is optional context in the normal agent, without an exclusive reader policy', async () => {
  const f = fixture(); await f.bridge.handle(f.input);
  assert.deepEqual(f.prompts[0].options, { mode: 'craft', permission: 'default', userRequest: f.input.message.text });
  assert.ok(f.prompts[0].text.includes('/arbitrary vault'));
  assert.ok(f.prompts[0].text.includes('先使用现有工具查看该目录的导航索引'));
  assert.ok(f.prompts[0].text.includes('继续使用适用的现有技能和工具'));
  assert.ok(f.prompts[0].text.includes(f.input.message.text));
  assert.equal(f.messages[0].content, f.input.message.text);
  assert.equal(f.replies[0], '处理完成。');
});
test('unbound messages use the same normal agent without directory context', async () => {
  const f = fixture(); await f.bridge.handle({ ...f.input, knowledge: undefined });
  assert.equal(f.prompts[0].text, f.input.message.text);
  assert.equal(f.prompts[0].options.contextPolicy, undefined);
});
test('missing channel model returns guidance and persists the failed turn', async () => {
  const f = fixture({ missingModel: true }); await f.bridge.handle(f.input);
  assert.equal(f.prompts.length, 0); assert.match(f.replies[0], /默认模型/);
  assert.deepEqual(f.messages.map(message => message.role), ['user', 'assistant']);
});
test('normal channel tasks remain cancellable on timeout', async () => {
  const f = fixture({ stall: true }); await assert.rejects(() => f.bridge.handle(f.input), /超时/);
  assert.equal(f.aborted, true);
});
