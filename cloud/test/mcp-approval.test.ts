import assert from 'node:assert/strict';
import test from 'node:test';
import { executeMcpOperation } from '../src/agent/tools/mcp-execution.ts';

const full = { permission: 'full', runtimeProfile: { mode: 'craft', category: 'assistant' } };
function fixture(tools: any[]) {
  const events: string[] = [];
  return { events, deps: {
    guard: async () => { events.push('guard'); },
    approve: async () => { events.push('approval'); },
    authorize: async () => { events.push('authorize'); return {}; },
    invoke: async (_connector: any, request: any) => { events.push(request.operation); return request.operation === 'list' ? { tools } : { content: [] }; },
  } };
}
test('full selected MCP queries discover metadata and execute without approval', async () => {
  const f = fixture([{ name: 'query', annotations: { readOnlyHint: true } }]);
  await executeMcpOperation(full as any, { operation: 'call', name: 'query', arguments: {} }, f.deps as any);
  assert.equal(f.events.includes('approval'), false);
  assert.deepEqual(f.events.filter(e => ['list','call'].includes(e)), ['list','call']);
});
test('all MCP calls auto execute regardless of risk or missing annotations', async () => {
  for (const [annotations, approval] of [[{ readOnlyHint: false, destructiveHint: false }, false], [{ readOnlyHint: false, destructiveHint: true }, false], [undefined, false], [{ readOnlyHint: true, destructiveHint: true }, false]] as const) {
    const f = fixture([{ name: 'action', annotations }]);
    await executeMcpOperation(full as any, { operation: 'call', name: 'action' }, f.deps as any);
    assert.equal(f.events.includes('approval'), approval);
    if (approval) assert.ok(f.events.indexOf('approval') < f.events.indexOf('call'));
  }
});
test('MCP rejects readonly/plan/ask and missing tools before invocation', async () => {
  for (const selection of [{ ...full, permission: 'readonly' }, { ...full, runtimeProfile: { mode: 'plan', category: 'assistant' } }, { ...full, runtimeProfile: { mode: 'ask', category: 'assistant' } }]) {
    const f = fixture([]);
    await assert.rejects(executeMcpOperation(selection as any, { operation: 'list' }, f.deps as any));
    assert.deepEqual(f.events, []);
  }
  const f = fixture([]);
  await assert.rejects(executeMcpOperation(full as any, { operation: 'call', name: 'missing' }, f.deps as any));
  assert.equal(f.events.includes('call'), false);
});
test('discovery auto starts selected stdio and authorization is rechecked before call', async () => {
  const f = fixture([]);
  await executeMcpOperation(full as any, { operation: 'list' }, f.deps as any);
  assert.equal(f.events.includes('approval'), false);
  const g = fixture([{ name: 'unknown' }]);
  g.deps.authorize = async () => { g.events.push('authorize'); if (g.events.filter(e => e === 'authorize').length === 2) throw new Error('REVOKED'); return {}; };
  await assert.rejects(executeMcpOperation(full as any, { operation: 'call', name: 'unknown' }, g.deps as any), /REVOKED/);
  assert.equal(g.events.includes('call'), false);
});

test('high-risk named tools execute without approval', async () => {
  for (const name of ['sendMessage', 'delete_document', 'payment-transfer', 'publishPage', 'chmodFile', 'uploadFile']) {
    const f = fixture([{ name, annotations: { destructiveHint: true } }]);
    await executeMcpOperation(full as any, { operation: 'call', name }, f.deps as any);
    assert.equal(f.events.includes('approval'), false);
    assert.equal(f.events.includes('call'), true);
  }
});

test('trusted local TAPD read adapter still follows discovery and approval policy', async () => {
  for (const annotations of [undefined, { readOnlyHint: true }, { destructiveHint: true }]) {
    const f = fixture([{ name: 'get_user_participant_projects', annotations }]);
    await executeMcpOperation(full as any, { operation: 'call', name: 'get_user_participant_projects' }, {
      ...f.deps as any, localCall: async () => { f.events.push('local-read'); return {}; },
    });
    assert.equal(f.events.includes('approval'), false);
    assert.equal(f.events.filter(e => e === 'authorize').length, 1);
    assert.ok(f.events.indexOf('list') < f.events.indexOf('local-read'));
  }
});
