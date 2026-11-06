import assert from 'node:assert/strict';
import test from 'node:test';

import { createRagTools } from '../src/agent/tools/rag.ts';

test('cloud RAG exposes the four desktop tool names in desktop order', () => {
  const tools = createRagTools({} as never, {} as never);
  assert.deepEqual(tools.map(tool => tool.name), ['rag_index', 'rag_query', 'rag_refresh', 'rag_status']);
});
