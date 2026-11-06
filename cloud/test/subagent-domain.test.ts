import test, { before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { Run } from '../src/cloud/runs/types.ts';
import { createDelegationService } from '../src/domains/delegation/node/service.ts';
const url = process.env.TEST_DATABASE_URL;
const integration = url ? test : test.skip;
let db: typeof import('../src/infra/db.ts');
let parent: Run;
before(async () => { if (!url) return; assert.match(new URL(url).pathname,/test/i); process.env.DATABASE_URL=url;
  db=await import('../src/infra/db.ts'); await db.initializeDatabase(); });
beforeEach(async () => {
  if (!url) return; await db.query('TRUNCATE users CASCADE');
  const owner=randomUUID(), conversation=randomUUID(), id=randomUUID(), token=randomUUID();
  await db.query("INSERT INTO users(id,subject,email,name) VALUES($1,'delegate','delegate@test.invalid','Delegate')",[owner]);
  await db.query("INSERT INTO conversations(id,owner_id,title) VALUES($1,$2,'Parent')",[conversation,owner]);
  parent={ id,owner_id:owner,conversation_id:conversation,lease_token:token,prompt:'test',status:'running',sandbox_id:null,selection:{
    runtimeProfile:{mode:'craft',category:'assistant'}, permission:'full', skills:[],connectors:[],files:[],
    workspace:{scopeId:conversation,ownerId:owner,revision:0,files:[]},settings:{customInstructions:'',language:'zh-CN'}, model:{id:randomUUID(),name:'Test',data:{}} } } as Run;
  await db.query("INSERT INTO runs(id,owner_id,conversation_id,prompt,selection,idempotency_key,status,lease_token,lease_until) VALUES($1,$2,$3,'test',$4::jsonb,'test','running',$5,now()+interval '1 hour')",[id,owner,conversation,JSON.stringify(parent.selection),token]);
});
after(async()=>{if(url)await db.pool.end();});
integration('child runs are durable, owner-scoped, idempotent, and cannot recursively delegate',async()=>{
  const service=createDelegationService(db.database,parent);
  const children=await service.create('call',{tasks:[{role:'reviewer',task:'Check correctness'},{role:'scout',task:'Inspect files'}]});
  assert.equal(children.length,2);
  assert.equal(children[0].parent_run_id,parent.id);
  assert.equal(children[0].owner_id,parent.owner_id);
  assert.ok(!children[0].selection.delegation!.allowedToolNames.includes('subagent'));
  assert.deepEqual(children[0].selection.files,[]);
  assert.deepEqual((await service.create('call',{tasks:[{role:'reviewer',task:'Check correctness'},{role:'scout',task:'Inspect files'}]})).map(run=>run.id),children.map(run=>run.id));
  await assert.rejects(service.create('call',{role:'reviewer',task:'Different'}),/CONFLICT/);
  await assert.rejects(createDelegationService(db.database,children[0]).create('nested',{role:'scout',task:'More'}),/RECURSION/);
  const foreign={...parent,owner_id:randomUUID()};
  await assert.rejects(createDelegationService(db.database,foreign).create('other',{role:'scout',task:'More'}),/LEASE/);
});
integration('parent cancellation prevents new work and cancels queued children',async()=>{
  const service=createDelegationService(db.database,parent);
  const children=await service.create('call',{role:'worker',task:'Produce report'});
  await service.cancelChildren();
  assert.equal((await db.query('SELECT status FROM runs WHERE id=$1',[children[0].id])).rows[0].status,'cancelled');
  await db.query('UPDATE runs SET cancel_requested=true WHERE id=$1',[parent.id]);
  await assert.rejects(service.create('later',{role:'scout',task:'More'}),/LEASE/);
});
integration('disabled owners cannot create delegated work',async()=>{
  const service=createDelegationService(db.database,parent);
  await db.query('UPDATE users SET disabled_at=now() WHERE id=$1',[parent.owner_id]);
  await assert.rejects(service.create('disabled-owner',{role:'scout',task:'Inspect files'}),/LEASE/);
  const children=await db.query('SELECT id FROM runs WHERE parent_run_id=$1',[parent.id]);
  assert.equal(children.rowCount,0);
});
