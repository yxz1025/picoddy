import test from 'node:test';
import assert from 'node:assert/strict';
import { useStore, type Conversation } from '../web/desktop/src/store/useStore.ts';
import { useSkillStore } from '../web/desktop/src/store/useSkillStore.ts';
import { clearCloudAdapterCaches } from '../web/desktop/src/api/cloudAdapter.ts';

test('expert picker persists assignment and clearing, and preserves state on server rejection', async () => {
  const fetch = globalThis.fetch, app = useStore.getState();
  const conversation = { id: 'conversation', category: 'assistant' } as Conversation;
  const writes: string[] = [];
  let reject = false;
  globalThis.fetch = async (input, init) => {
    const path = String(input);
    if (path === '/api/experts') return Response.json({ data: [{ id: 'expert', name: 'Expert' }] });
    assert.equal(path, '/api/conversations/conversation/expert');
    writes.push(init?.method ?? 'GET');
    if (reject) return Response.json({ error: { code: 'CONVERSATION_BUSY', message: 'active run' } }, { status: 409 });
    return Response.json({ data: { ok: true, binding: { expertId: 'expert', revision: 'v1', catalogSource: 'installed' } } });
  };
  try {
    useStore.setState({ conversations: [conversation] });
    await useSkillStore.getState().assignConversationExpert('conversation', 'expert');
    assert.equal(useStore.getState().conversations[0].expertId, 'expert');
    reject = true;
    await assert.rejects(useSkillStore.getState().clearConversationExpert('conversation'));
    assert.equal(useStore.getState().conversations[0].expertId, 'expert');
    reject = false;
    await useSkillStore.getState().clearConversationExpert('conversation');
    assert.equal(useStore.getState().conversations[0].expertId, null);
    assert.deepEqual(writes, ['PUT', 'DELETE', 'DELETE']);
  } finally { globalThis.fetch = fetch; useStore.setState(app, true); clearCloudAdapterCaches(); }
});
