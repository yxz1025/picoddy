import assert from 'node:assert/strict';
import test, { before, beforeEach, after } from 'node:test';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { Pool } from 'pg';
import { createServer } from '../src/server.ts';
import { loadConfig } from '../src/config.ts';
import { initializeDatabase, type Database } from '../src/infra/db.ts';
import { unseal } from '../src/infra/crypto.ts';
import { hashSessionToken } from '../src/cloud/auth/service.ts';
import * as auth from '../src/cloud/auth/service.ts';

const databaseUrl = process.env.TEST_DATABASE_URL;
const integration = databaseUrl ? test : test.skip;
const config = loadConfig({DATABASE_URL:databaseUrl || 'postgres://unused/unused_test',PUBLIC_ORIGIN:'http://localhost:8080',ENCRYPTION_KEY:'a'.repeat(64),SANDBOX_DOMAIN:'http://localhost:8090',SANDBOX_API_KEY:'test'});
let pool: Pool; let database: Database; let server: ReturnType<typeof createServer>; let base: string;
let subject = 'employee-001'; let exchanges: URL[] = []; let upstreamFailure = false;
let holdExchange: (() => Promise<void>) | undefined;
before(async () => {
  if (!databaseUrl) return;
  assert.match(new URL(databaseUrl).pathname,/test/);
  pool = new Pool({connectionString:databaseUrl});
  database = {query: (sql, values) => pool.query(sql, values ? [...values] : undefined), transaction:async fn => {
    const c = await pool.connect(); try { await c.query('BEGIN'); const r=await fn(c); await c.query('COMMIT'); return r; }
    catch(e) { await c.query('ROLLBACK'); throw e; } finally {c.release();}
  }};
  await initializeDatabase(pool);
  server = createServer(config,{database,casFetch:async (target, options) => {
    exchanges.push(new URL(String(target)));
    const identity = subject;
    if (holdExchange) await holdExchange();
    assert.equal(options?.redirect,'error'); assert.ok(options?.signal);
    if (upstreamFailure) return new Response('sensitive upstream failure',{status:401});
    return Response.json({success:true,result:{token:'sensitive-enterprise-token',userInfo:{username:identity,realname:'Employee',email:'shared@example.test',avatar:'https://example.test/avatar.png',untrusted:'secret-profile'}}});
  }});
  server.listen(0,'127.0.0.1'); await once(server,'listening');
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
beforeEach(async () => {
  if (!databaseUrl) return;
  await pool.query('TRUNCATE auth_challenges, users CASCADE');
  subject='employee-001'; exchanges=[]; upstreamFailure=false; holdExchange=undefined;
});
after(async () => {if(server){server.close();await once(server,'close');}if(pool)await pool.end();});
async function begin(cookie='') {
  const r = await fetch(base+'/api/auth/login',{method:'POST',headers:{Origin:config.publicOrigin,Cookie:cookie,'Content-Type':'application/json'},body:'{}'});
  assert.equal(r.status,200);
  const json=await r.json() as any;
  const login=new URL(json.data.loginUrl); const service=new URL(login.searchParams.get('service')!);
  const binding=r.headers.getSetCookie()[0].split(';')[0];
  return {service,cookie:binding};
}
async function finish(challenge: Awaited<ReturnType<typeof begin>>, cookie=challenge.cookie) {
  const url = new URL(challenge.service); url.searchParams.set('ticket','ST-test-once');
  return fetch(base+url.pathname+url.search,{headers:{Cookie:cookie},redirect:'manual'});
}
const session = (r: Response) => r.headers.getSetCookie().find(c=>c.startsWith('picoddy_session='))!.split(';')[0];

integration('CAS creates an ordinary owner and encrypted session; logout revokes only that session',async()=>{
  const challenge=await begin(); const r=await finish(challenge);
  assert.equal(r.status,303);assert.equal(r.headers.get('location'),'/');
  assert.equal(exchanges.length,1);assert.equal(exchanges[0].searchParams.get('service'),challenge.service.toString());
  const cookie=session(r);
  const me=await fetch(base+'/api/auth/me',{headers:{Cookie:cookie}});
  const user=(await me.json() as any).data;
  assert.equal(user.subject,subject); assert.equal(user.name,'Employee'); assert.ok(user.sessionId);
  assert.doesNotMatch(JSON.stringify(user),/sensitive|untrusted|gateway_secret/);
  const rows=await pool.query('SELECT u.role,s.gateway_secret,s.token_hash FROM users u JOIN sessions s ON s.owner_id=u.id');
  assert.equal(rows.rows[0].role,'user'); assert.deepEqual(unseal(rows.rows[0].gateway_secret,config.encryptionKey),{accessToken:'sensitive-enterprise-token'});
  assert.equal(rows.rows[0].token_hash,hashSessionToken(cookie.split('=')[1]));
  const other=session(await finish(await begin()));
  const logout=await fetch(base+'/api/auth/logout',{method:'POST',headers:{Origin:config.publicOrigin,Cookie:cookie}});
  assert.equal(logout.status,200);
  assert.equal((await fetch(base+'/api/auth/me',{headers:{Cookie:cookie}})).status,401);
  assert.equal((await fetch(base+'/api/auth/me',{headers:{Cookie:other}})).status,200);
});
integration('wrong browser cannot consume a valid challenge; replay cannot exchange twice',async()=>{
  const a=await begin();const b=await begin();
  const mismatch=await finish(a,b.cookie);
  assert.equal(mismatch.headers.get('location'),'/?auth_error=CAS_LOGIN_EXPIRED'); assert.equal(exchanges.length,0);
  assert.equal((await finish(a)).headers.get('location'),'/');
  assert.equal((await finish(a)).headers.get('location'),'/?auth_error=CAS_LOGIN_EXPIRED');assert.equal(exchanges.length,1);
});
integration('expired challenge and old challenge after retry cannot authenticate',async()=>{
  const a=await begin(); const b=await begin(a.cookie);
  assert.equal((await finish(a)).headers.get('location'),'/?auth_error=CAS_LOGIN_EXPIRED');
  await pool.query('UPDATE auth_challenges SET expires_at=now()-interval \'1 second\'');
  assert.equal((await finish(b)).headers.get('location'),'/?auth_error=CAS_LOGIN_EXPIRED');assert.equal(exchanges.length,0);
});
integration('concurrent callbacks consume once and concurrent first logins map one owner',async()=>{
  const a=await begin(); const both=await Promise.all([finish(a),finish(a)]);
  assert.equal(both.filter(r=>r.headers.get('location')==='/').length,1);assert.equal(exchanges.length,1);
  const b=await begin();const c=await begin();
  const valid=await Promise.all([finish(b),finish(c)]);
  assert.ok(valid.every(r=>r.headers.get('location')==='/'));
  assert.equal((await pool.query('SELECT count(*)::int AS count FROM users')).rows[0].count,1);
});
integration('distinct enterprise subjects never merge on shared email',async()=>{
  const one=session(await finish(await begin()));subject='employee-002';
  const two=session(await finish(await begin()));
  const first=(await (await fetch(base+'/api/auth/me',{headers:{Cookie:one}})).json() as any).data;
  const second=(await (await fetch(base+'/api/auth/me',{headers:{Cookie:two}})).json() as any).data;
  assert.notEqual(first.id,second.id);assert.equal(first.email,second.email);
});
integration('disabled owner cannot sign in or resume an existing session',async()=>{
  const cookie=session(await finish(await begin()));
  await pool.query('UPDATE users SET disabled_at=now()');
  assert.equal((await finish(await begin())).headers.get('location'),'/?auth_error=CAS_LOGIN_FAILED');
  assert.equal((await fetch(base+'/api/auth/me',{headers:{Cookie:cookie}})).status,401);
  assert.equal((await pool.query('SELECT count(*)::int AS count FROM sessions')).rows[0].count,1);
});
integration('upstream failure is sanitized, consumes ticket and allows a fresh retry',async()=>{
  upstreamFailure=true;const a=await begin();const r=await finish(a);
  assert.equal(r.headers.get('location'),'/?auth_error=CAS_LOGIN_FAILED');assert.doesNotMatch(await r.text(),/sensitive/);
  upstreamFailure=false;assert.equal((await finish(a)).headers.get('location'),'/?auth_error=CAS_LOGIN_EXPIRED');
  assert.equal((await finish(await begin())).headers.get('location'),'/');
});

integration('new browser login invalidates an older in-flight exchange before it creates a session',async()=>{
  let release!:()=>void;let entered!:()=>void;
  const waiting=new Promise<void>(r=>{entered=r;});
  const blocked=new Promise<void>(r=>{release=r;});
  holdExchange=async()=>{entered();await blocked;};
  const a=await begin();const older=finish(a);await waiting;
  const b=await begin(a.cookie);
  holdExchange=undefined;subject='employee-002';
  const newer=await finish(b);assert.equal(newer.headers.get('location'),'/');
  release();const stale=await older;
  assert.notEqual(stale.headers.get('location'),'/');
  assert.equal(stale.headers.getSetCookie().length,0);
  const rows=await pool.query('SELECT u.subject FROM sessions s JOIN users u ON u.id=s.owner_id');
  assert.deepEqual(rows.rows.map(r=>r.subject),['employee-002']);
});
integration('auth cleanup removes expired session credentials and challenges but preserves live sessions',async()=>{
  const a=await finish(await begin());const b=await finish(await begin());
  await pool.query('UPDATE sessions SET expires_at=now()-interval \'1 second\' WHERE token_hash=$1',[hashSessionToken(session(a).split('=')[1])]);
  await pool.query('UPDATE auth_challenges SET expires_at=now()-interval \'1 second\'');
  assert.equal(typeof (auth as any).cleanupExpiredAuth,'function');
  await (auth as any).cleanupExpiredAuth(database);
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM sessions')).rows[0].n,1);
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM auth_challenges')).rows[0].n,0);
  assert.equal((await fetch(base+'/api/auth/me',{headers:{Cookie:session(b)}})).status,200);
});
