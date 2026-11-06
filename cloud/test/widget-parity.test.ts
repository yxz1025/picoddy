import assert from 'node:assert/strict';
import test from 'node:test';
import { showWidgetTool as cloud } from '../src/agent/tools/show_widget.ts';
import { readMeTool as cloudGuides } from '../src/agent/tools/read_me.ts';

const cases = [
  {title:'季度 对比', module:'chart', widget_code:'<canvas id="chart"></canvas><script src="https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.js"></script>', loading_messages:'["准备数据","绘制图表"]'},
  {title:'大型-SVG', widget_code:`<svg viewBox="0 0 680 200"><path fill="#378ADD" d="M0 0L10 10"/><desc>${'说明'.repeat(5000)}</desc></svg>`,loading_messages:['绘制图形']},
  {title:'交互组件',widget_code:'<button onclick="sendPrompt(\'继续\')">继续</button>',loading_messages:'准备界面,加载交互'},
];
for (const args of cases) test(`cloud widget matches desktop: ${args.title}`, async () => {
  const result = await cloud.execute('id',args as never);
  const widget = result.details.widget;
  assert.equal(widget.success,true);
  assert.equal(widget.type,'visualizer_show_widget_result');
  assert.equal(widget.widget_code,args.widget_code);
  assert.equal(widget.render_mode,args.widget_code.startsWith('<svg') ? 'svg' : 'html');
  assert.deepEqual(widget.loading_messages,args.title==='季度 对比' ? ['准备数据','绘制图表'] : args.title==='大型-SVG' ? ['绘制图形'] : ['准备界面','加载交互']);
  if (result.content[0].type==='text') {
    const {module: _module,...payload}=widget;
    assert.deepEqual(JSON.parse(result.content[0].text),payload);
  }

});
test('cloud schema requires desktop loading messages contract',()=>assert.deepEqual(cloud.parameters.required,['title','widget_code','loading_messages']));
for (const widget_code of ['<form></form>','<div style="position:fixed">x</div>','<script>localStorage.getItem("x")</script>','<svg viewBox="0 0 400 100"></svg>']) {
  test(`cloud rejects unsupported sandbox content: ${widget_code}`,async()=>{
    await assert.rejects(cloud.execute('id',{title:'bad',widget_code,loading_messages:['加载']} as never));
  });
}
test('cloud guidance matches desktop for comma-separated modules',async()=>{
  const args={modules:'diagram,chart,interactive'};
  const result=await cloudGuides.execute('id',args as never);
  const text=result.content.filter(c=>c.type==='text').map(c=>c.text).join('');
  assert.match(text,/Chart\.js/);
  assert.match(text,/Illustrative diagram/);
  assert.match(text,/sendPrompt/);
});

import { cloudWidgetImageUrl } from '../web/desktop/src/components/widgetImageSource.ts';
import { CLOUD_TOOL_NAMES, resolveCloudToolPolicy } from '../src/agent/tools/contracts.ts';
test('widget guidelines are registered for both craft and plan modes',()=>{
  assert.ok(CLOUD_TOOL_NAMES.includes('widget_guidelines'));
  for (const mode of ['craft','plan'] as const) assert.ok(resolveCloudToolPolicy({permission:'full',runtimeProfile:{mode,category:'assistant'}}).includes('widget_guidelines'));
});
test('cloud images resolve only authenticated platform file handles',()=>{
  const id='12345678-1234-4123-8123-123456789abc';
  const expected=`https://cloud.example/api/files/${id}/content`;
  assert.equal(cloudWidgetImageUrl(`/cloud-files/${id}/图.png`,'https://cloud.example'),expected);
  assert.equal(cloudWidgetImageUrl(`/api/files/${id}/content`,'https://cloud.example'),expected);
  for (const source of ['/Users/me/secret.png','C:\\private.png','/api/auth/me','https://other.example/api/files/'+id+'/content']) assert.equal(cloudWidgetImageUrl(source,'https://cloud.example'),null);
});
