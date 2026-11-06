import assert from 'node:assert/strict';
import test from 'node:test';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { createServer } from '../src/server.ts';
import { loadConfig } from '../src/config.ts';
import type { Database } from '../src/infra/db.ts';

const config=loadConfig({DATABASE_URL:'postgres://unused/test',PUBLIC_ORIGIN:'http://localhost:8080',ENCRYPTION_KEY:'a'.repeat(64),SANDBOX_DOMAIN:'http://localhost:8090',SANDBOX_API_KEY:'test'});
test('authenticated model catalog request reaches provider transport without persisting input key',async()=>{
  const sqls:string[]=[]; let called=0;
  const database={query:async(sql:string)=>{sqls.push(sql);return {rows:sql.includes('JOIN users')?[{id:'00000000-0000-4000-8000-000000000001',name:'Test',role:'user'}]:[],rowCount:0};}} as unknown as Database;
  const server=createServer(config,{database, modelRequest:async (url:URL,init:any)=>{
    called++;assert.equal(url.toString(),'https://api.openai.com/v1/models');
    assert.equal(init.headers.authorization,'Bearer test-key');
    return {status:200,body:{data:[{id:'model-one'},{id:'model-one'}]}};
  }} as any);
  server.listen(0,'127.0.0.1');await once(server,'listening');
  try{
    const r=await fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}/api/providers/openai/models`,{method:'POST',headers:{Origin:config.publicOrigin,Cookie:'picoddy_session=test','Content-Type':'application/json'},body:JSON.stringify({apiKey:'test-key'})});
    assert.equal(r.status,200);
    const result=await r.json() as any;
    assert.equal(result.data.ok,true);assert.equal(result.data.models.length,1);assert.equal(called,1);
    assert.ok(sqls.every(sql=>!/(INSERT|UPDATE|DELETE)/.test(sql)));
  }finally{server.close();await once(server,'close');}
});
