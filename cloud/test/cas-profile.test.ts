import assert from 'node:assert/strict';
import test from 'node:test';
import { exchangeEnterpriseTicket, parseEnterpriseProfile } from '../src/cloud/auth/cas.ts';
import { loadConfig } from '../src/config.ts';

const profile = (info: unknown, token: unknown='token') => ({success:true,result:{token,userInfo:info}});
test('enterprise identity requires username and never falls back to email or ID',()=>{
  for(const info of [{email:'person@example.test'},{id:'123'},{username:''},{username:123},{username:'a\nb'}]) {
    assert.throws(()=>parseEnterpriseProfile(profile(info)));
  }
  assert.deepEqual(parseEnterpriseProfile(profile({username:'employee',realname:'Name',email:'person@example.test',avatar:'javascript:alert(1)',password:'secret'})),
    {subject:'employee',name:'Name',email:'person@example.test',avatar:'',accessToken:'token'});
  assert.throws(()=>parseEnterpriseProfile({success:false,result:{token:'token',userInfo:{username:'employee'}}}));
  assert.throws(()=>parseEnterpriseProfile(profile({username:'employee'},'')));
});
test('ticket exchange rejects failed, invalid and oversized upstream bodies without echoing secrets',async()=>{
  const config = loadConfig({DATABASE_URL:'postgres://unused/test',PUBLIC_ORIGIN:'http://localhost:8080',ENCRYPTION_KEY:'a'.repeat(64),SANDBOX_DOMAIN:'http://localhost:8090',SANDBOX_API_KEY:'test'});
  for(const response of [new Response('secret',{status:401}),new Response('invalid-json'),new Response('x'.repeat(128*1024+1)),Response.json({success:false,message:'secret'})]) {
    await assert.rejects(exchangeEnterpriseTicket(config,'ST-secret','http://localhost:8080/api/auth/callback',async()=>response));
  }
  let called=0;
  const value=await exchangeEnterpriseTicket(config,'ST-secret','http://localhost:8080/api/auth/callback?state=exact',async(url,opts)=>{
    called++;const target=new URL(String(url));assert.equal(target.searchParams.get('ticket'),'ST-secret');
    assert.equal(target.searchParams.get('service'),'http://localhost:8080/api/auth/callback?state=exact');
    assert.equal(opts?.redirect,'error');assert.ok(opts?.signal);
    return Response.json(profile({username:'employee'}));
  });
  assert.equal(called,1);assert.equal(value.subject,'employee');
});
