import test, {before,after,beforeEach} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {loadConfig} from '../src/config.ts';

const databaseUrl=process.env.TEST_DATABASE_URL;
const integration=databaseUrl?test:test.skip;
let db:typeof import('../src/infra/db.ts');
let worker:typeof import('../src/worker.ts');
let events:typeof import('../src/cloud/runs/events.ts');
let owner:string;
const config=loadConfig({
  DATABASE_URL:databaseUrl || 'postgres://unused/unused_test',PUBLIC_ORIGIN:'http://localhost:8080',
  ENCRYPTION_KEY:'0123456789abcdef0123456789abcdef',SANDBOX_DOMAIN:'http://unused.invalid',SANDBOX_API_KEY:'unused',
  STORAGE_ENDPOINT:'http://unused.invalid',STORAGE_ACCESS_KEY:'unused',STORAGE_SECRET_KEY:'unused',
});

before(async()=>{
  if (!databaseUrl) return;
  assert.match(new URL(databaseUrl).pathname,/test/i,'Use a disposable test database');
  process.env.DATABASE_URL=databaseUrl;
  db=await import('../src/infra/db.ts'); worker=await import('../src/worker.ts'); events=await import('../src/cloud/runs/events.ts');
  await db.initializeDatabase();
});
beforeEach(async()=>{
  if (!databaseUrl) return;
  await db.query('TRUNCATE users CASCADE');
  const result=await db.query("INSERT INTO users(subject,email,name) VALUES('worker','worker@test.invalid','Worker') RETURNING id");
  owner=result.rows[0].id;
});
after(async()=>{if (databaseUrl) await db.pool.end();});

async function queued() {
  const conversation=randomUUID(),id=randomUUID();
  await db.query("INSERT INTO conversations(id,owner_id,title) VALUES($1,$2,'test')",[conversation,owner]);
  await db.query("INSERT INTO runs(id,owner_id,conversation_id,prompt,selection,idempotency_key) VALUES($1,$2,$3,'test','{}',$4)",[id,owner,conversation,randomUUID()]);
  return id;
}
integration('concurrent worker claims are distinct and fenced',async()=>{
  await queued(); await queued();
  const [first,second]=await Promise.all([worker.claimRun(config),worker.claimRun(config)]);
  assert.ok(first); assert.ok(second); assert.notEqual(first.id,second.id);
  assert.notEqual(first.lease_token,second.lease_token);
  await events.assertLease(first);
  await assert.rejects(()=>events.assertLease({...first,lease_token:randomUUID()}),/LEASE/);
});
integration('cancelled queued work is not claimed',async()=>{
  const id=await queued();
  await db.query('UPDATE runs SET cancel_requested=true WHERE id=$1',[id]);
  assert.equal(await worker.claimRun(config),undefined);
});
integration('child work cannot consume ordinary queue lanes and orphaned children are cancelled',async()=>{
  const parent=await queued(), child=await queued();
  await db.query("UPDATE runs SET parent_run_id=$2,parent_tool_call_id='delegate',child_index=0 WHERE id=$1",[child,parent]);
  const claimed=await worker.claimRun(config);
  assert.equal(claimed?.id,parent);
  assert.equal(await worker.claimRun(config),undefined);
  await db.query("UPDATE runs SET status='failed',lease_until=NULL WHERE id=$1",[parent]);
  await worker.recoverRun(config);
  const row=(await db.query('SELECT status FROM runs WHERE id=$1',[child])).rows[0];
  assert.equal(row.status,'cancelled');
});
integration('expired work is quarantined rather than re-executed',async()=>{
  await queued();
  const run=await worker.claimRun(config);
  assert.ok(run);
  await db.query("UPDATE runs SET lease_until=now()-interval '1 minute',cleanup_after=now()+interval '1 hour' WHERE id=$1",[run.id]);
  assert.equal(await worker.recoverRun(config),true);
  const row=(await db.query('SELECT status,lease_token FROM runs WHERE id=$1',[run.id])).rows[0];
  assert.equal(row.status,'cleanup_pending'); assert.equal(row.lease_token,null);
  assert.equal(await worker.claimRun(config),undefined);
});
