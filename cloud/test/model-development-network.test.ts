import assert from 'node:assert/strict';
import test from 'node:test';
import * as transport from '../src/platform/model-request.ts';
import {createModelDiagnosticsService} from '../src/domains/settings/node/diagnostics.ts';
import {loadConfig} from '../src/config.ts';
import type {Database} from '../src/infra/db.ts';
import dns from 'node:dns';
import https from 'node:https';
import {EventEmitter} from 'node:events';
import {syncBuiltinESMExports} from 'node:module';
import {mock} from 'node:test';

test('loopback development permits proxy fake IP only for exact official provider domains',()=>{
  const allowed=(transport as any).modelLookupAddressAllowed;
  assert.equal(typeof allowed,'function');
  assert.equal(allowed('198.18.2.180','dashscope.aliyuncs.com','http://localhost:8080'),true);
  assert.equal(allowed('198.19.1.2','api.openai.com','http://127.0.0.1:8080'),true);
  assert.equal(allowed('198.18.2.180','dashscope.aliyuncs.com','https://cloud.example.test'),false);
  assert.equal(allowed('198.18.2.180','dashscope.aliyuncs.com'),false);
  assert.equal(allowed('198.18.2.180','custom.example.test','http://localhost:8080'),false);
  assert.equal(allowed('198.18.2.180','dashscope.aliyuncs.com.attacker.test','http://localhost:8080'),false);
  for(const address of ['127.0.0.1','10.0.0.1','169.254.169.254','192.168.1.1','198.51.100.1','::ffff:198.18.2.180']) {
    assert.equal(allowed(address,'dashscope.aliyuncs.com','http://localhost:8080'),false,address);
  }
  assert.equal(allowed('8.8.8.8','dashscope.aliyuncs.com','https://cloud.example.test'),true);
});

test('actual socket lookup receives server development policy and rejects mixed private DNS answers',async()=>{
  let addresses=[{address:'198.18.2.180',family:4}];
  mock.method(dns,'lookup',(_host:unknown,_options:unknown,callback:any)=>callback(null,addresses));
  mock.method(https,'request',(url:URL,options:any,respond:any)=>{
    const req:any=new EventEmitter();
    req.end=()=>options.lookup(url.hostname,{all:true},(error:unknown)=>{
      if(error){req.emit('error',error);req.emit('close');return;}
      const response:any=new EventEmitter();response.statusCode=401;
      response.destroy=()=>req.emit('close');
      respond(response);
    });
    req.destroy=(error?:unknown)=>{if(error)req.emit('error',error);req.emit('close');return req;};
    return req;
  });
  syncBuiltinESMExports();
  try {
    const url=new URL('https://dashscope.aliyuncs.com/api/v1/models');
    const local=transport.createModelRequest({developmentOrigin:'http://localhost:8080'});
    assert.equal((await local(url,{method:'GET',headers:{}})).status,401);
    await assert.rejects(transport.requestModelJson(url,{method:'GET',headers:{}}),(error:any)=>error.code==='MODEL_DNS_BLOCKED');
    await assert.rejects(local(new URL('https://custom.example.test/models'),{method:'GET',headers:{}}),(error:any)=>error.code==='MODEL_DNS_BLOCKED');
    addresses=[...addresses,{address:'127.0.0.1',family:4}];
    await assert.rejects(local(url,{method:'GET',headers:{}}),(error:any)=>error.code==='MODEL_DNS_BLOCKED');
  } finally {mock.restoreAll();syncBuiltinESMExports();}
});

test('catalog network failures have distinct safe messages and never echo credentials',async()=>{
  const config=loadConfig({DATABASE_URL:'postgres://unused/test',PUBLIC_ORIGIN:'http://localhost:8080',ENCRYPTION_KEY:'a'.repeat(64),SANDBOX_DOMAIN:'http://localhost:8090',SANDBOX_API_KEY:'test'});
  const database={query:async()=>({rows:[],rowCount:0})} as unknown as Database;
  for(const code of ['MODEL_DNS_BLOCKED','MODEL_DNS_FAILED','MODEL_REQUEST_TIMEOUT','MODEL_RESPONSE_TOO_LARGE','MODEL_RESPONSE_INVALID'] as const) {
    const service=createModelDiagnosticsService({config,database,ownerId:'test-owner',request:async(url)=>{
      assert.equal(url.searchParams.get('language'),'zh-CN');
      throw new transport.ModelRequestError(code);
    }});
    const result=await service.catalog('qwen',{apiKey:'never-echo-this-key'});
    assert.equal((result as any).errorCode,code);
    assert.equal(result.ok,false);
    assert.doesNotMatch(JSON.stringify(result),/never-echo-this-key/);
  }
});
