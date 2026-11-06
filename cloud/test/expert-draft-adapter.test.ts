import assert from 'node:assert/strict';
import test, { afterEach } from 'node:test';

import {
  clearCloudAdapterCaches,
  requestDesktopApi,
} from '../web/desktop/src/api/cloudAdapter.ts';

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  clearCloudAdapterCaches();
});

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

test('desktop expert creator conversation maps to the cloud creator category', async () => {
  let submitted: Record<string, unknown> | undefined;
  globalThis.fetch = async (input, init) => {
    const path = String(input);
    if (path === '/api/models') return json([]);
    if (path === '/api/conversations' && init?.method === 'POST') {
      submitted = JSON.parse(String(init.body));
      return json({
        id: '11111111-1111-4111-8111-111111111111',
        parentId: '55555555-5555-4555-8555-555555555555',
        title: '创建专家',
        category: 'expert_creator',
        createdAt: '2026-10-12T00:00:00.000Z',
        updatedAt: '2026-10-12T00:00:00.000Z',
      }, 201);
    }
    throw new Error(`Unexpected request: ${init?.method} ${path}`);
  };

  const conversation = await requestDesktopApi<Record<string, unknown>>('POST', '/api/conv', {
    title: '创建专家',
    category: 'expert_creator',
    expertOperation: 'create',
  });
  assert.deepEqual(submitted, { title: '创建专家', category: 'expert_creator' });
  assert.equal(conversation.category, 'expert_creator');
  assert.equal(conversation.parentId, '55555555-5555-4555-8555-555555555555');
});

test('desktop expert edit session calls the cloud draft endpoint and preserves edit metadata', async () => {
  const requests: Array<{ path: string; method: string; body?: unknown }> = [];
  globalThis.fetch = async (input, init) => {
    const path = String(input);
    requests.push({
      path,
      method: init?.method ?? 'GET',
      ...(init?.body ? { body: JSON.parse(String(init.body)) } : {}),
    });
    if (path === '/api/models') return json([]);
    if (path === '/api/experts/22222222-2222-4222-8222-222222222222/edit-session') {
      return json({
        id: '33333333-3333-4333-8333-333333333333',
        title: '修改专家：Existing',
        category: 'expert_creator',
        workspaceId: '44444444-4444-4444-8444-444444444444',
        expertOperation: 'edit',
        expertTargetId: '22222222-2222-4222-8222-222222222222',
        expertTargetRevision: 'base-revision',
        createdAt: '2026-10-12T00:00:00.000Z',
        updatedAt: '2026-10-12T00:00:00.000Z',
      }, 201);
    }
    throw new Error(`Unexpected request: ${init?.method} ${path}`);
  };

  const conversation = await requestDesktopApi<Record<string, unknown>>(
    'POST',
    '/api/experts/22222222-2222-4222-8222-222222222222/edit-session',
    { workspaceId: '44444444-4444-4444-8444-444444444444' },
  );
  assert.deepEqual(requests.find(request => request.path.includes('/edit-session'))?.body, {
    workspaceId: '44444444-4444-4444-8444-444444444444',
  });
  assert.equal(conversation.category, 'expert_creator');
  assert.equal(conversation.expertOperation, 'edit');
  assert.equal(conversation.expertTargetId, '22222222-2222-4222-8222-222222222222');
  assert.equal(conversation.expertTargetRevision, 'base-revision');
});

test('prompt maps selected expert to a creator-only reference without changing assistant binding', async () => {
  const creatorId = '33333333-3333-4333-8333-333333333333';
  const assistantId = '44444444-4444-4444-8444-444444444444';
  const referenceExpertId = '22222222-2222-4222-8222-222222222222';
  const submitted: Array<Record<string, unknown>> = [];
  globalThis.fetch = async (input, init) => {
    const path = String(input);
    if (path === '/api/skills' || path === '/api/connectors') return json([]);
    if (path === `/api/conversations/${creatorId}`) return json({ id: creatorId, category: 'expert_creator' });
    if (path === `/api/conversations/${assistantId}`) return json({ id: assistantId, category: 'assistant' });
    if (path === `/api/conversations/${creatorId}/runs` || path === `/api/conversations/${assistantId}/runs`) {
      submitted.push(JSON.parse(String(init?.body)));
      return json({ id: crypto.randomUUID(), conversationId: path.includes(creatorId) ? creatorId : assistantId }, 201);
    }
    throw new Error(`Unexpected request: ${init?.method} ${path}`);
  };

  await requestDesktopApi('POST', '/api/prompt', {
    sessionId: creatorId,
    text: '参考这个专家',
    selectedExpertId: referenceExpertId,
  });
  await requestDesktopApi('POST', '/api/prompt', {
    sessionId: assistantId,
    text: '普通对话',
    selectedExpertId: referenceExpertId,
  });

  assert.equal(submitted[0].referenceExpertId, referenceExpertId);
  assert.equal('expertId' in submitted[0], false);
  assert.equal('referenceExpertId' in submitted[1], false);
  assert.equal('expertId' in submitted[1], false);
});

test('installed expert mapping preserves editable profile metadata', async () => {
  globalThis.fetch = async (input, init) => {
    const path = String(input);
    if (path === '/api/experts' && init?.method === 'GET') {
      return json([{
        id: '22222222-2222-4222-8222-222222222222',
        name: 'Retail Expert',
        prompt: 'Retail rules',
        skillIds: [],
        description: 'Retail operations specialist',
        tags: ['retail', 'operations', 'analysis'],
        quickPrompts: ['Review sales', 'Check inventory', 'Draft a plan'],
        icon: '🛍️',
        categoryId: 'retail',
      }]);
    }
    throw new Error(`Unexpected request: ${init?.method} ${path}`);
  };

  const experts = await requestDesktopApi<Array<Record<string, unknown>>>('GET', '/api/experts');
  assert.deepEqual(experts[0].tags, ['retail', 'operations', 'analysis']);
  assert.deepEqual(experts[0].quickPrompts, ['Review sales', 'Check inventory', 'Draft a plan']);
  assert.equal(experts[0].description, 'Retail operations specialist');
  assert.equal(experts[0].icon, '🛍️');
  assert.equal(experts[0].categoryId, 'retail');
});

