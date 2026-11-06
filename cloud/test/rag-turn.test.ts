import assert from 'node:assert/strict';
import test from 'node:test';
import { prepareRetrievedTurn } from '../src/agent/retrieval.ts';

test('Ask does not retrieve and successful retrieval stays on user surface', async () => {
  let calls = 0;
  const events: unknown[] = [];
  const input = { query: 'a sufficiently long question', userPrompt: 'encoded user request', activeTools: [] as string[],
    retrieve: async () => { calls++; return { context: '<retrieved_documents encoding="json">{}</retrieved_documents>', citations: [{documentId:'doc'}], mode: 'bm25' }; },
    emit: async (_type: string, value: unknown) => { events.push(value); } };
  assert.equal(await prepareRetrievedTurn(input), input.userPrompt);
  assert.equal(calls, 0);
  const prompt = await prepareRetrievedTurn({ ...input, activeTools: ['rag_query'] });
  assert.match(prompt, /retrieved_documents/);
  assert.equal(calls, 1);
  assert.doesNotMatch(JSON.stringify(events), /encoded user request/);
});

test('optional RAG failure emits visible diagnostic; cancellation is never swallowed', async () => {
  const events: unknown[] = [];
  const base = { query: 'a sufficiently long question', userPrompt: 'original', activeTools: ['rag_query'],
    retrieve: async () => { throw new Error('private database connection details'); },
    emit: async (_type: string, payload: unknown) => { events.push(payload); } };
  assert.equal(await prepareRetrievedTurn(base), 'original');
  assert.match(JSON.stringify(events), /RAG_RETRIEVAL_UNAVAILABLE/);
  assert.doesNotMatch(JSON.stringify(events), /private database/);
  const controller = new AbortController(); controller.abort();
  await assert.rejects(prepareRetrievedTurn({ ...base, signal: controller.signal }), { name: 'AbortError' });
});
