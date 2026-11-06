import assert from 'node:assert/strict';
import test from 'node:test';
import { CLOUD_TOOL_NAMES, resolveCloudToolPolicy } from '../src/agent/tools/contracts.ts';

test('portable desktop visualization, memory, office editing and fetch tools are classified and allowed in full mode', () => {
  const allowed = resolveCloudToolPolicy({ permission: 'full', runtimeProfile: { mode: 'craft', category: 'assistant' } });
  for (const name of ['read_me', 'widget_guidelines', 'show_widget', 'memory_recall', 'memory_write', 'edit_docx', 'edit_docx_free', 'edit_xlsx', 'edit_pptx', 'web_fetch']) {
    assert.ok((CLOUD_TOOL_NAMES as readonly string[]).includes(name), `${name} missing from runtime contract`);
    assert.ok(allowed.includes(name), `${name} not allowed`);
  }
});

test('cloud excludes computer-dependent and lianxiang netdisk tools', () => {
  assert.ok(CLOUD_TOOL_NAMES.every(name => !name.startsWith('lianxiang_')));
  for (const name of ['computer','screenshot','mouse_click','mouse_move','key_type','app_focus','cursor_pos','connect_cloud_service']) assert.ok(!(CLOUD_TOOL_NAMES as readonly string[]).includes(name));
});

import { showWidgetTool } from '../src/agent/tools/show_widget.ts';
test('widget returns the desktop visualization payload', async () => {
 const result = await showWidgetTool.execute('id',{title:'流程',module:'diagram',widget_code:'<svg viewBox="0 0 680 100"><text x="5" y="20">云端</text></svg>',loading_messages:['绘制流程']});
 assert.equal(result.details.widget.title,'流程');
 assert.equal(result.details.widget.render_mode,'svg');
 assert.equal(result.content[0].type,'text');
 if (result.content[0].type === 'text') assert.equal(JSON.parse(result.content[0].text).success,true);
});
