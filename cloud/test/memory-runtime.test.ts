import assert from 'node:assert/strict';
import test from 'node:test';
import { createMemoryRuntimeService } from '../src/domains/memory/node/runtime.ts';
import { createMemoryResourceService } from '../src/domains/memory/node/service.ts';
import type { Database } from '../src/infra/db.ts';
import type { Run } from '../src/cloud/runs/types.ts';
const owner='11111111-1111-4111-8111-111111111111', conversation='22222222-2222-4222-8222-222222222222';
const run={id:'33333333-3333-4333-8333-333333333333',owner_id:owner,conversation_id:conversation,lease_token:'lease',selection:{workspace:{scopeId:conversation}}} as unknown as Run;
test('recall restricts owner, workspace and working conversation and bounds returned content',async()=>{
 let captured:any;
 const db={query:async(sql:string,args:any[])=>{captured={sql,args};return {rows:[]};}} as unknown as Database;
 const memory=createMemoryRuntimeService(db,run);
 assert.deepEqual(await memory.recall('all'),[]);
 assert.deepEqual(captured.args,[owner,null,'all',conversation]);
 assert.match(captured.sql,/owner_id=\$1/);assert.match(captured.sql,/conversationId'\=\$4/);
 await assert.rejects(memory.recall(['working']));
 const large={query:async()=>({rows:[{data:{content:'x'.repeat(100001)}}]})} as unknown as Database;
 await assert.rejects(createMemoryRuntimeService(large,run).recall('all'));
});
test('memory tool write refuses lost lease before storing anything',async()=>{
 let count=0;
 const db={transaction:async(fn:any)=>fn({query:async()=>{count++;return{rows:[],rowCount:0};}})} as unknown as Database;
 await assert.rejects(createMemoryRuntimeService(db,run).write({content:'fixture'}),/RUN_LEASE_LOST/);assert.equal(count,1);
});
test('memory tool write refuses full owner quota without insert',async()=>{
 const calls:string[]=[];
 const db={transaction:async(fn:any)=>fn({query:async(sql:string)=>{calls.push(sql);return{rows:sql.includes('count(*)')?[{count:100,bytes:500}]:[{id:owner}],rowCount:1};}})} as unknown as Database;
 await assert.rejects(createMemoryRuntimeService(db,run).write({content:'fixture'}));assert.ok(calls.every(sql=>!sql.includes('INSERT')));
});
test('working memory management rejects another owners conversation',async()=>{
 const db={transaction:async(fn:any)=>fn({query:async(sql:string)=>({rows:sql.includes('FROM conversations')?[]:[{id:owner}],rowCount:1})})} as unknown as Database;
 await assert.rejects(createMemoryResourceService({database:db,ownerId:owner}).create({title:'fixture',content:'fixture',scope:'working',conversationId:conversation}));
});

test('long-term management does not expose working memories from other conversations',async()=>{
 const db={query:async()=>({rows:[
  {id:'user',name:'user',data:{content:'long-term'},created_at:'2026-01-01',updated_at:'2026-01-01'},
  {id:'working',name:'working',data:{scope:'working',conversationId:conversation},created_at:'2026-01-01',updated_at:'2026-01-01'},
 ]})} as unknown as Database;
 const list=await createMemoryResourceService({database:db,ownerId:owner}).list();assert.deepEqual(list.map(memory=>memory.id),['user']);
});
