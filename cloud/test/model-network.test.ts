import assert from 'node:assert/strict';
import test from 'node:test';
import {publicModelAddress,requestModelJson} from '../src/platform/model-request.ts';
import {createModelDiagnosticsService} from '../src/domains/settings/node/diagnostics.ts';
import {loadConfig} from '../src/config.ts';
import {seal} from '../src/infra/crypto.ts';
import type {Database} from '../src/infra/db.ts';

test('socket DNS policy blocks private, metadata, mapped and reserved addresses',()=>{
  for(const address of ['127.0.0.1','10.1.2.3','169.254.169.254','172.16.0.1','192.168.1.1','100.64.0.1','0.0.0.0','224.1.2.3','::1','fc00::1','fe80::1','::ffff:127.0.0.1','2001:db8::1','2002:7f00:1::','invalid'])assert.equal(publicModelAddress(address),false,address);
  assert.equal(publicModelAddress('8.8.8.8'),true);assert.equal(publicModelAddress('2606:4700:4700::1111'),true);
});
test('transport rejects literal IPs and non-HTTPS before issuing a request',async()=>{
  for(const url of ['http://api.openai.com/v1/models','https://127.0.0.1/models','https://[::1]/models','https://user:pass@api.openai.com/models','https://api.openai.com:8443/models']){
    await assert.rejects(requestModelJson(new URL(url),{method:'GET',headers:{}}),/BLOCKED/);
  }
});
const config=loadConfig({DATABASE_URL:'postgres://unused/test',PUBLIC_ORIGIN:'http://localhost:8080',ENCRYPTION_KEY:'a'.repeat(64),SANDBOX_DOMAIN:'http://localhost:8090',SANDBOX_API_KEY:'test'});
const database={query:async()=>({rows:[],rowCount:0})} as unknown as Database;
test('catalog normalizes all supported provider protocols using transient credentials',async()=>{
  const cases=[
    ['openai',{data:[{id:'gpt-test'}]},'/v1/models','authorization','gpt-test'],
    ['anthropic',{data:[{id:'claude-test',display_name:'Claude'}]},'/v1/models','x-api-key','claude-test'],
    ['google',{models:[{name:'models/gemini-test',supportedGenerationMethods:['generateContent']},{name:'models/embedding',supportedGenerationMethods:['embedContent']}]},'/v1beta/models','x-goog-api-key','gemini-test'],
    ['qwen',{output:{models:[{model:'qwen-test'}]}},'/api/v1/models','authorization','qwen-test'],
    ['deepseek',{data:[{id:'deepseek-test'}]},'/models','authorization','deepseek-test'],
    ['moonshot',{data:[{id:'kimi-test'}]},'/v1/models','authorization','kimi-test'],
  ] as const;
  for(const [provider,payload,path,header,id] of cases){
    const service=createModelDiagnosticsService({database,ownerId:'owner',config,request:async(url,init)=>{
      assert.equal(url.pathname,path);assert.ok(init.headers[header]?.includes('transient'));
      return {status:200,body:payload};
    }});
    const r=await service.catalog(provider,{apiKey:'transient'});assert.equal(r.ok,true);assert.equal(r.models?.length,1);assert.equal(r.models?.[0]?.id,id);
  }
});
test('catalog fails closed when an upstream model field reflects the current API key',async()=>{
  const apiKey='sk-sensitive-catalog-key';
  const service=createModelDiagnosticsService({database,ownerId:'owner',config,request:async()=>({
    status:200,
    body:{data:[{id:`model-${apiKey}`,name:'reflected credential'}]},
  })});
  const result=await service.catalog('openai',{apiKey});
  assert.equal(result.ok,false);
  assert.doesNotMatch(JSON.stringify(result),new RegExp(apiKey));
});
test('probe sends minimal inference and distinguishes HTTP200 error bodies from success',async()=>{
  for(const provider of ['openai','anthropic','google']){
    const service=createModelDiagnosticsService({database,ownerId:'owner',config,request:async(url,init)=>{
      assert.equal(init.method,'POST');const payload=JSON.parse(init.body!);
      if(provider==='google'){assert.ok(url.pathname.endsWith(':generateContent'));assert.equal(payload.generationConfig.maxOutputTokens,16);}
      else assert.equal(payload.model,'model-test');
      return {status:200,body:{error:{message:'do not echo transient-secret'}}};
    }});
    const r=await service.test({provider,modelId:'model-test',apiKey:'transient-secret'});assert.equal(r.ok,false);assert.doesNotMatch(JSON.stringify(r),/transient-secret/);
  }
});
test('upstream redirects, credential failures and thrown errors never echo keys',async()=>{
  for(const status of [302,401,403,429,500]){
    const service=createModelDiagnosticsService({database,ownerId:'owner',config,request:async()=>({status,body:{error:'sensitive-key'}})});
    for(const result of [await service.catalog('openai',{apiKey:'sensitive-key'}),await service.test({provider:'openai',modelId:'model',apiKey:'sensitive-key'})]){
      assert.equal(result.ok,false);assert.doesNotMatch(JSON.stringify(result),/sensitive-key/);
    }
  }
});
test('explicit model address validates allowlist and strips no untrusted query or fragment',async()=>{
  let calls=0;const service=createModelDiagnosticsService({database,ownerId:'owner',config,request:async()=>{calls++;return {status:200,body:{data:[]}};}});
  for(const baseUrl of ['http://api.openai.com/v1','https://evil.example/v1','https://api.openai.com/v1?key=x','https://api.openai.com/v1#x'])await assert.rejects(service.catalog('openai',{apiKey:'key',baseUrl}));
  assert.equal(calls,0);
});
test('implicit credential lookup skips retired or invalid endpoints from the same provider',async()=>{
  const rows=[
    {id:'00000000-0000-4000-8000-000000000001',name:'retired',data:{provider:'openai',baseUrl:'https://retired.example.test/v1'},secret:seal({apiKey:'retired-key'},config.encryptionKey)},
    {id:'00000000-0000-4000-8000-000000000002',name:'invalid',data:{provider:'openai',baseUrl:'not a URL'},secret:seal({apiKey:'invalid-key'},config.encryptionKey)},
    {id:'00000000-0000-4000-8000-000000000003',name:'current',data:{provider:'openai',baseUrl:'https://api.openai.com/v1'},secret:seal({apiKey:'current-key'},config.encryptionKey)},
  ];
  const candidateDatabase={query:async()=>({rows,rowCount:rows.length})} as unknown as Database;
  let authorization='';
  const service=createModelDiagnosticsService({database:candidateDatabase,ownerId:'owner',config,request:async(_url,init)=>{
    authorization=init.headers.authorization;
    return {status:200,body:{data:[]}};
  }});
  const result=await service.catalog('openai',{});
  assert.equal(result.ok,true);
  assert.equal(authorization,'Bearer current-key');
});
test('model diagnostics cap concurrent outbound requests across owners at 32',async()=>{
  let started=0;let release!:()=>void;let allStarted!:()=>void;
  const blocked=new Promise<void>(resolve=>{release=resolve;});
  const entered=new Promise<void>(resolve=>{allStarted=resolve;});
  const request=async()=>{
    started++;
    if(started===32)allStarted();
    if(started<=32)await blocked;
    return {status:200,body:{data:[]}};
  };
  const pending=Array.from({length:32},(_,index)=>createModelDiagnosticsService({database,ownerId:`owner-${index}`,config,request}).catalog('openai',{apiKey:'key'}));
  await entered;
  try{
    const overflow=createModelDiagnosticsService({database,ownerId:'owner-overflow',config,request});
    await assert.rejects(overflow.catalog('openai',{apiKey:'key'}),(error:any)=>error?.status===429&&error?.code==='MODEL_PROBE_BUSY');
  }finally{
    release();
    await Promise.all(pending);
  }
  assert.equal(started,32);
});
test('model diagnostics retain the two-request limit for one owner',async()=>{
  let started=0;let release!:()=>void;let bothStarted!:()=>void;
  const blocked=new Promise<void>(resolve=>{release=resolve;});
  const entered=new Promise<void>(resolve=>{bothStarted=resolve;});
  const request=async()=>{
    started++;
    if(started===2)bothStarted();
    if(started<=2)await blocked;
    return {status:200,body:{data:[]}};
  };
  const service=createModelDiagnosticsService({database,ownerId:'same-owner',config,request});
  const pending=[service.catalog('openai',{apiKey:'key'}),service.catalog('openai',{apiKey:'key'})];
  await entered;
  try{
    await assert.rejects(service.catalog('openai',{apiKey:'key'}),(error:any)=>error?.status===429&&error?.code==='MODEL_PROBE_BUSY');
  }finally{
    release();
    await Promise.all(pending);
  }
  assert.equal(started,2);
});
test('arbitrary 200 JSON is not evidence of a successful inference',async()=>{
  for(const [provider,body] of [['openai',{choices:[{}]}],['google',{candidates:[{}]}],['anthropic',{type:'message',content:[]}]]){
    const service=createModelDiagnosticsService({database,ownerId:'owner',config,request:async()=>({status:200,body})});
    assert.equal((await service.test({provider,modelId:'model',apiKey:'key'})).ok,false);
  }
});
test('blank inference text is not evidence of a successful inference',async()=>{
  for(const [provider,body] of [
    ['openai',{choices:[{message:{role:'assistant',content:'  '}}]}],
    ['google',{candidates:[{content:{parts:[{text:'\n\t'}]}}]}],
    ['anthropic',{type:'message',content:[{type:'text',text:''}]}],
  ]){
    const service=createModelDiagnosticsService({database,ownerId:'owner',config,request:async()=>({status:200,body})});
    assert.equal((await service.test({provider,modelId:'model',apiKey:'key'})).ok,false);
  }
});
