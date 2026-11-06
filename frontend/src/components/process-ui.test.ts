import assert from 'node:assert/strict';
import test from 'node:test';
import * as React from 'react';
const { createElement } = React;
// The desktop tsconfig preserves JSX; tsx's test transform uses the classic runtime.
Object.assign(globalThis,{React});
import { renderToStaticMarkup } from 'react-dom/server';
import AssistantProcessBundle from './AssistantProcessBundle.tsx';
import { settleAssistantRun } from './assistantRunModel.ts';

test('running process exposes its contents above the current status by default',()=>{
 const html=renderToStaticMarkup(createElement(AssistantProcessBundle,{durationLabel:'（耗时：3s）',active:true,statusLabel:'正在生成',children:'过程详情'}));
 assert.match(html,/正在生成/);
 assert.doesNotMatch(html,/已完成/);
 assert.equal((html.match(/<button/g)||[]).length,1);
 assert.match(html,/aria-expanded="true"/);
 assert.match(html,/过程详情/);
 assert.ok(html.indexOf('过程详情') < html.indexOf('正在生成'));
});
test('completed process retains a clear collapsed duration summary',()=>{
 const html=renderToStaticMarkup(createElement(AssistantProcessBundle,{durationLabel:'（耗时：3s）',children:'过程详情'}));
 assert.match(html,/已完成.*耗时：3s/);
});
test('empty assistant placeholders do not create blank process rows',()=>{
 const run=settleAssistantRun([{kind:'message',message:{id:'empty',role:'assistant',content:'  ',thinking:' ',createdAt:1}}]);
 assert.equal(run.process.length,0);
 assert.equal(run.outputs.length,0);
});

import { buildAssistantTimeline } from './assistantRunModel.ts';
test('timeline keeps introductory text above later operations and preserves interleaved updates',()=>{
 const message=(id:string,content:string,thinking='')=>({kind:'message' as const,message:{id,role:'assistant' as const,content,thinking,createdAt:1}});
 const tools=(id:string)=>({kind:'tool-group' as const,id,messages:[{id,role:'tool' as const,content:'',status:'success' as const,createdAt:1}]});
 const timeline=buildAssistantTimeline([message('intro','明白，我把方案落成交付物','准备设计'),tools('one'),message('update','架构图已完成'),tools('two'),message('final','交付完成')]);
 assert.deepEqual(timeline.map(e=>e.kind),['answer','process','answer','process','answer']);
 assert.equal(timeline[0].kind==='answer' && timeline[0].message.content,'明白，我把方案落成交付物');
 assert.equal(timeline[1].kind==='process' && timeline[1].items.length,2);
});


test('earlier process stays collapsed while the live tail remains expanded', () => {
 const html=renderToStaticMarkup(createElement(React.Fragment,null,
  createElement(AssistantProcessBundle,{durationLabel:'',active:false,children:'earlier detail'}),
  createElement('p',null,'阶段正文'),
  createElement(AssistantProcessBundle,{durationLabel:'',active:true,children:'current detail'}),
 ));
 assert.doesNotMatch(html,/earlier detail/);
 assert.match(html,/current detail/);
 assert.ok(html.indexOf('阶段正文') < html.indexOf('current detail'));
});
