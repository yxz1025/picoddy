import assert from 'node:assert/strict';
import test from 'node:test';
import { requestDesktopApi } from '../web/desktop/src/api/cloudAdapter.ts';

test('persisted tool results recover message-level delivery batches and tool role', async () => {
  const previous = globalThis.fetch;
  const files = [{ path: '/cloud-files/id/report.md', title: 'Report', type: 'md' }];
  globalThis.fetch = async () => new Response(JSON.stringify({ data: [{
    id: 'message', role: 'toolResult', toolCallId: 'call', toolName: 'present_files',
    content: [{ type: 'text', text: 'Delivered' }], isError: false,
    details: { files, explanation: 'Report', problems: [] }, createdAt: '2026-01-01T00:00:00.000Z',
  }] }), { headers: { 'content-type': 'application/json' } });
  try {
    const [message] = await requestDesktopApi<any[]>('GET', '/api/msgs/conversation');
    assert.equal(message.role, 'tool');
    assert.equal(message.id, 'call');
    assert.equal(message.toolName, 'present_files');
    assert.deepEqual(message.deliveryBatch.files, files);
    assert.equal(message.status, 'success');
  } finally { globalThis.fetch = previous; }
});

 test('persisted successful visualization recovers widget after reload', async () => {
  const previous = globalThis.fetch;
  const widget = { title: 'Counter', module: 'interactive', widget_code: '<button>0</button>' };
  globalThis.fetch = async () => new Response(JSON.stringify({data:[{role:'toolResult',toolName:'show_widget',toolCallId:'widget-call',content:[],details:{widget},isError:false}]}), {headers:{'content-type':'application/json'}});
  try { const [message] = await requestDesktopApi<any[]>('GET','/api/msgs/conversation'); assert.deepEqual(message.widget,widget); }
  finally { globalThis.fetch = previous; }
 });
