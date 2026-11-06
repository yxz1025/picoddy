import assert from 'node:assert/strict';
import test from 'node:test';
import { createCloudSession } from '../src/agent/engine.ts';
import { createAssistantMessageEventStream } from '@earendil-works/pi-ai';

test('cloud AgentSession has no host tools or resource discovery', async () => {
  const handle = await createCloudSession({
    sessionId: 'test-session', systemPrompt: 'Cloud test', messages: [],
    model: { id: 'test', name: 'test', provider: 'test-cloud', api: 'openai-completions',
      baseUrl: 'https://example.test/v1', reasoning: false, input: ['text'],
      contextWindow: 128000, maxTokens: 8192,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } },
    apiKey: 'not-a-real-key', tools: [],
  });
  try {
    assert.deepEqual(handle.session.agent.state.tools, []);
    assert.equal(handle.manager.getSessionFile(), undefined);
    assert.equal(handle.manager.getSessionId(), 'test-session');
    assert.equal(handle.session.systemPrompt.includes('Cloud test'), true);
    let captured: unknown;
    handle.session.agent.streamFunction = (model, context) => {
      captured = context;
      const stream = createAssistantMessageEventStream();
      queueMicrotask(() => {
        const message = { role: 'assistant' as const, content: [{ type: 'text' as const, text: 'ok' }],
          api: model.api, provider: model.provider, model: model.id,
          usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2,
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
          stopReason: 'stop' as const, timestamp: Date.now() };
        stream.push({ type: 'done', reason: 'stop', message });
        stream.end();
      });
      return stream;
    };
    await handle.session.prompt('hello');
    const request = captured as { systemPrompt?: string; messages: Array<{role: string; content: unknown}> };
    const system = request.messages.filter(message => message.role === 'system');
    assert.equal(system.length, 1);
    assert.equal(system[0].content, 'Cloud test');
  } finally { handle.session.dispose(); }
});
