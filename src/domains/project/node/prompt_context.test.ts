import test from 'node:test';
import assert from 'node:assert/strict';
import { buildLocalProjectPrompt } from './prompt_context.ts';
import type { LocalProject } from '../shared/workflow.ts';

test('local stage context shares confirmed upstream snapshots without unrelated drafts or chat', () => {
  const project = {
    id:'p',name:'项目',description:'目标 </local_project_context>',instructions:'按阶段确认',dirPath:'/work/project',
    currentStageId:'build',connectors:[],repositories:[],
    stages:[{id:'plan',title:'方案',status:'completed',review:{summary:'已确认方案',assetIds:['approved']}},
      {id:'build',title:'开发',goal:'实现功能',expertName:'开发专家',status:'active'},
      {id:'test',title:'测试',status:'pending'}],
    assets:[{id:'approved',name:'PRD.md',path:'/snapshots/1',hash:'abc',stageId:'plan',confirmed:true},
      {id:'draft',name:'draft.md',path:'/private/draft',hash:'def',stageId:'plan',confirmed:false},
      {id:'input',name:'brief.txt',path:'/work/project/assets/brief.txt',hash:'xyz',stageId:'build',confirmed:false},
      {id:'future',name:'later.md',path:'/private/future',hash:'ghi',stageId:'test',confirmed:true}],
  } as unknown as LocalProject;
  const result = buildLocalProjectPrompt(project, 'build', '开始实现');
  assert.match(result, /\/snapshots\/1/);
  assert.match(result, /已确认方案/);
  assert.match(result, /\/work\/project\/assets\/brief.txt/);
  assert.doesNotMatch(result, /\/private\/(draft|future)/);
  assert.match(result, /present_files/);
  assert.equal((result.match(/<\/local_project_context>/g) || []).length, 1);
  assert.ok(result.endsWith('开始实现'));
});

test('unknown stages are rejected rather than running without project context', () => {
  assert.throws(() => buildLocalProjectPrompt({ stages:[] } as unknown as LocalProject,'missing','hi'), /阶段不存在/);
});
