import test from 'node:test';
import assert from 'node:assert/strict';
import { Agent } from '@earendil-works/pi-agent-core';
import { installCompletionBoundary } from '../src/agent/completion.ts';
import { createCloudSession } from '../src/agent/engine.ts';
import { createAssistantMessageEventStream } from '@earendil-works/pi-ai';
import { Type } from 'typebox';

test('completion rejects the entire mixed batch before any sibling can execute', async () => {
  const agent = new Agent({ streamFn: () => { throw new Error('No model calls in hook test'); } });
  let accepted = false;
  installCompletionBoundary(agent, () => accepted);
  const calls = [{ type: 'toolCall', name: 'write', id: 'w', arguments: {} }, { type: 'toolCall', name: 'goal_complete', id: 'g', arguments: {} }];
  for (const toolCall of calls) {
    const result = await agent.beforeToolCall?.({ toolCall, assistantMessage: { content: calls } } as any);
    assert.equal(result?.block, true);
  }
  assert.equal(await agent.beforeToolCall!({ toolCall: calls[0], assistantMessage: { content: [calls[0]] } } as any), undefined);
  accepted = true;
  assert.equal((await agent.beforeToolCall!({ toolCall: calls[0], assistantMessage: { content: [calls[0]] } } as any))?.block, true);
});

test('native goal termination can continue to a final response with no active tools', async () => {
  let accepted=false, requests=0;
  const handle=await createCloudSession({ sessionId:'completion-test',systemPrompt:'Test',messages:[],apiKey:'unused',
    model:{id:'test',name:'test',provider:'test-cloud',api:'openai-completions',baseUrl:'https://example.test',reasoning:false,input:['text'],contextWindow:128000,maxTokens:8192,cost:{input:0,output:0,cacheRead:0,cacheWrite:0}},
    tools:[{name:'goal_complete',label:'Goal',description:'Goal',parameters:Type.Object({}),async execute(){accepted=true;return {terminate:true,content:[{type:'text',text:'accepted'}],details:{}};}}],
  });
  installCompletionBoundary(handle.session.agent,()=>accepted);
  handle.session.agent.streamFunction=(model,context)=>{
    const count=++requests;
    if(count===2) assert.deepEqual(handle.session.agent.state.tools,[]);
    const stream=createAssistantMessageEventStream();
    queueMicrotask(()=>{
      const message={role:'assistant' as const,content: count===1 ? [{type:'toolCall' as const,id:'goal',name:'goal_complete',arguments:{}}] : [{type:'text' as const,text:'Verified result'}],api:model.api,provider:model.provider,model:model.id,
        usage:{input:1,output:1,cacheRead:0,cacheWrite:0,totalTokens:2,cost:{input:0,output:0,cacheRead:0,cacheWrite:0,total:0}},stopReason:count===1?'toolUse' as const:'stop' as const,timestamp:Date.now()};
      stream.push({type:'done',reason:message.stopReason,message});stream.end();
    });
    return stream;
  };
  try {
    await handle.session.prompt('Finish'); await handle.session.waitForIdle();
    assert.equal(accepted,true); assert.equal(requests,1);
    handle.session.setActiveToolsByName([]);
    await handle.session.agent.continue(); await handle.session.waitForIdle();
    assert.equal(requests,2);
    assert.equal(handle.session.agent.state.messages.at(-1)?.role,'assistant');
  } finally {handle.session.dispose();}
});

import { verifyWithCompletionRepair } from '../src/agent/completion.ts';
test('missing declaration gets a bounded repair turn and is verified again', async()=>{
 let declared=false,repairs=0,verified=0;
 await verifyWithCompletionRepair(async()=>{verified++;if(!declared)throw new Error('GOAL_DECLARATION_REQUIRED')},async()=>{repairs++;declared=true},new AbortController().signal);
 assert.equal(repairs,1);assert.equal(verified,2);
});
test('completion repair never bypasses changed files or retries indefinitely',async()=>{
 let repairs=0;
 await assert.rejects(verifyWithCompletionRepair(async()=>{throw new Error('DELIVERY_CHANGED')},async()=>{repairs++},new AbortController().signal),/DELIVERY_CHANGED/);
 assert.equal(repairs,0);
 await assert.rejects(verifyWithCompletionRepair(async()=>{throw new Error('GOAL_DECLARATION_REQUIRED')},async()=>{repairs++},new AbortController().signal),/GOAL_DECLARATION_REQUIRED/);
 assert.equal(repairs,2);
});
test('cancelled completion does not start another model request',async()=>{
 const controller=new AbortController();controller.abort(new Error('cancelled'));
 await assert.rejects(verifyWithCompletionRepair(async()=>{},async()=>assert.fail('must not resume'),controller.signal),/cancelled/);
});

import { COMPLETION_REPAIR_MESSAGE } from '../src/agent/completion.ts';
import { sessionCheckpoint } from '../src/agent/session-checkpoint.ts';
test('stopped model resumes with hidden guidance, declares, then answers without tools',async()=>{
 let declared=false,requests=0;
 const handle=await createCloudSession({sessionId:'missing-goal',systemPrompt:'Test',messages:[],apiKey:'unused',
  model:{id:'test',name:'test',provider:'test-cloud',api:'openai-completions',baseUrl:'https://example.test',reasoning:false,input:['text'],contextWindow:128000,maxTokens:8192,cost:{input:0,output:0,cacheRead:0,cacheWrite:0}},
  tools:[{name:'goal_complete',label:'Goal',description:'Goal',parameters:Type.Object({}),async execute(){declared=true;return {terminate:true,content:[{type:'text',text:'accepted'}],details:{}};}}]});
 installCompletionBoundary(handle.session.agent,()=>declared);
 handle.session.agent.streamFunction=(model,context)=>{
  const count=++requests;
  if(count===2) assert.ok(JSON.stringify(context.messages).includes('no accepted goal_complete declaration'));
  if(count===3) assert.deepEqual(handle.session.agent.state.tools,[]);
  const stream=createAssistantMessageEventStream();
  queueMicrotask(()=>{
   const message={role:'assistant' as const,content:count===2?[{type:'toolCall' as const,id:'goal',name:'goal_complete',arguments:{}}]:[{type:'text' as const,text:count===1?'Files delivered':'Verified result'}],api:model.api,provider:model.provider,model:model.id,
    usage:{input:1,output:1,cacheRead:0,cacheWrite:0,totalTokens:2,cost:{input:0,output:0,cacheRead:0,cacheWrite:0,total:0}},stopReason:count===2?'toolUse' as const:'stop' as const,timestamp:Date.now()};
   stream.push({type:'done',reason:message.stopReason,message});stream.end();
  });return stream;
 };
 try {
  await handle.session.prompt('Deliver files');await handle.session.waitForIdle();
  await verifyWithCompletionRepair(async()=>{if(!declared)throw new Error('GOAL_DECLARATION_REQUIRED')},async()=>{
   await handle.session.sendCustomMessage(COMPLETION_REPAIR_MESSAGE,{triggerTurn:true});await handle.session.waitForIdle();
  },new AbortController().signal);
  assert.equal(declared,true);assert.equal(requests,2);
  assert.ok(sessionCheckpoint(handle.manager).some(entry=>entry.type==='custom_message' && entry.customType==='cloud-completion-repair' && entry.display===false));
  handle.session.setActiveToolsByName([]);await handle.session.agent.continue();await handle.session.waitForIdle();
  assert.equal(requests,3);
 } finally {handle.session.dispose()}
});
