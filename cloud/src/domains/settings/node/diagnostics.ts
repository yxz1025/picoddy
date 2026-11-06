import type { Config } from '../../../config.ts';
import type { Database } from '../../../infra/db.ts';
import { unseal } from '../../../infra/crypto.ts';
import { createResourceStore } from '../../resource/node/store.ts';
import { fail } from '../../../shared/errors.ts';
import { object, optionalUuid, string } from '../../../shared/validation.ts';
import { createModelRequest, ModelRequestError, type ModelRequest } from '../../../platform/model-request.ts';
import { isIP } from 'node:net';

const endpoints:Record<string,string>={openai:'https://api.openai.com/v1',anthropic:'https://api.anthropic.com',google:'https://generativelanguage.googleapis.com',deepseek:'https://api.deepseek.com',moonshot:'https://api.moonshot.cn/v1',qwen:'https://dashscope.aliyuncs.com/compatible-mode/v1'};
type ProviderModel={id:string;name:string;features:string[];contextWindow?:number};
const active=new Map<string,number>();
let activeTotal=0;
function normalizedBase(value:string,config:Config):string {
  let url:URL;try{url=new URL(value);}catch{fail(400,'INVALID_MODEL_URL','模型地址无效');}
  if(url.protocol!=='https:'||url.username||url.password||url.search||url.hash||(url.port&&url.port!=='443')||isIP(url.hostname.replace(/^\[|\]$/g,''))||!config.modelAllowedHosts.includes(url.hostname)) {
    fail(400,'MODEL_HOST_NOT_ALLOWED','模型地址必须是管理员允许的 HTTPS 域名，不能使用内网或本机地址');
  }
  return url.toString().replace(/\/+$/,'');
}
function providerId(value:unknown):string {
  const id=string(value,'provider',1,100).toLowerCase();
  if(!Object.hasOwn(endpoints,id))fail(400,'UNSUPPORTED_MODEL_PROVIDER','该模型渠道暂不支持云端 API Key 调用');
  return id;
}
function safeKey(value:unknown):string {
  const key=string(value,'apiKey',1,20000);
  if(/[\r\n\x00-\x1f\x7f]/.test(key))fail(400,'INVALID_API_KEY','API Key 格式不正确');
  return key;
}
function upstreamMessage(status:number):string {
  if(status===401||status===403)return '身份验证失败：请检查 API Key、模型权限或账号状态';
  if(status===429)return '服务商限流或额度不足，请检查账号额度并稍后重试';
  if(status===404)return '服务商未找到该接口或模型，请检查地址和模型 ID';
  if(status>=300&&status<400)return '模型服务返回重定向，已阻止转发凭据，请使用最终 HTTPS 地址';
  return `模型服务请求失败 (HTTP ${status})`;
}
function modelNetworkFailure(error:unknown) {
  const errorCode=error instanceof ModelRequestError?error.code:'MODEL_REQUEST_FAILED';
  const messages:Record<string,string>={
    MODEL_ENDPOINT_BLOCKED:'模型服务地址被阻止，请使用管理员允许的 HTTPS 地址',
    MODEL_DNS_BLOCKED:'模型服务域名解析到受限地址，请检查服务器 DNS 或代理配置',
    MODEL_DNS_FAILED:'模型服务域名解析失败，请检查服务器 DNS 或网络',
    MODEL_REQUEST_TIMEOUT:'模型服务请求超时，请稍后重试',
    MODEL_RESPONSE_TOO_LARGE:'模型服务响应超过大小限制，请检查接口地址',
    MODEL_RESPONSE_INVALID:'模型服务返回了无效 JSON，请检查接口地址',
    MODEL_RESPONSE_FAILED:'模型服务连接中断，请检查服务器网络后重试',
    MODEL_REQUEST_FAILED:'无法连接模型服务，请检查服务器网络或代理配置',
  };
  return {ok:false as const,errorCode,error:messages[errorCode]};
}
function record(value:unknown):Record<string,any> {
  if(!value||typeof value!=='object'||Array.isArray(value))throw Error('Invalid provider response');
  return value as Record<string,any>;
}
function catalogModels(provider:string,payload:unknown):ProviderModel[] {
  const data=record(payload);
  if(data.error || data.success===false)throw Error('Invalid catalog');
  const rows=provider==='qwen'?data.output?.models:provider==='google'?data.models:data.data;
  if(!Array.isArray(rows)||rows.length>10000)throw Error('Invalid catalog');
  const result=new Map<string,ProviderModel>();
  for(const value of rows){
    const row=record(value);
    if(provider==='google'&&Array.isArray(row.supportedGenerationMethods)&&!row.supportedGenerationMethods.includes('generateContent'))continue;
    const raw=provider==='qwen'?row.model:provider==='google'?row.name:row.id;
    if(typeof raw!=='string'||!raw.trim()||raw.length>500)continue;
    const id=raw.trim().replace(provider==='google'?/^models\//:/^$/,'');
    const label=row.display_name||row.displayName||row.name||id;
    const context=row.inputTokenLimit||row.context_length||row.context_window;
    result.set(id,{id,name:typeof label==='string'?label.slice(0,500):id,features:[],...(typeof context==='number'&&context>0&&Number.isFinite(context)?{contextWindow:context}:{})});
  }
  return [...result.values()];
}

export function createModelDiagnosticsService(input:{database:Database;ownerId:string;config:Config;request?:ModelRequest}) {
  async function resolve(providerValue:unknown,bodyValue:unknown){
    const provider=providerId(providerValue);const body=object(bodyValue);
    const resourceId=optionalUuid(body.resourceId,'resourceId');
    const suppliedKey=body.apiKey===undefined||body.apiKey===''?undefined:safeKey(body.apiKey);
    const modelId=body.modelId===undefined?undefined:string(body.modelId,'modelId',1,500);
    const rows=await createResourceStore(input.database).list(input.ownerId,'model');
    const selected=resourceId?rows.find(r=>r.id===resourceId):undefined;
    if(resourceId&&!selected)fail(404,'NOT_FOUND','模型配置不存在');
    if(selected&&selected.data.provider!==provider)fail(400,'MODEL_PROVIDER_MISMATCH','模型配置与渠道不匹配');
    const baseUrl=normalizedBase(body.baseUrl===undefined||body.baseUrl===''?String(selected?.data.baseUrl||endpoints[provider]):string(body.baseUrl,'baseUrl',1,4000),input.config);
    if(selected&&!suppliedKey&&baseUrl!==normalizedBase(String(selected.data.baseUrl||endpoints[provider]),input.config))fail(400,'MODEL_ENDPOINT_MISMATCH','不能将已保存的 Key 发送到其它模型地址；请明确输入新地址的 Key');
    let apiKey=suppliedKey;
    if(!apiKey){
      const candidates=selected?[selected]:rows.filter(r=>{
        if(r.data.provider!==provider||(modelId&&r.data.model!==modelId))return false;
        try{return normalizedBase(String(r.data.baseUrl||endpoints[provider]),input.config)===baseUrl;}catch{return false;}
      });
      const keys=new Set(candidates.map(r=>{
        if(!r.secret)return '';
        const secret=unseal(r.secret,input.config.encryptionKey) as {apiKey?:unknown};
        return typeof secret.apiKey==='string'?secret.apiKey:'';
      }).filter(Boolean));
      if(keys.size>1)fail(409,'MODEL_CREDENTIAL_AMBIGUOUS','该渠道存在不同凭据，请选择具体模型配置或输入本次测试的 Key');
      apiKey=[...keys][0];
    }
    if(!apiKey)fail(400,'API_KEY_REQUIRED','请先输入或保存该渠道的 API Key');
    return {provider,baseUrl,apiKey:safeKey(apiKey),modelId:modelId||String(selected?.data.model||'')};
  }
  async function run<T>(fn:()=>Promise<T>):Promise<T>{
    const count=active.get(input.ownerId)||0;
    if(count>=2||activeTotal>=32)fail(429,'MODEL_PROBE_BUSY','模型检查请求繁忙，请稍后重试');
    active.set(input.ownerId,count+1);
    activeTotal++;
    try{return await fn();}finally{activeTotal--;const left=(active.get(input.ownerId)||1)-1;if(left)active.set(input.ownerId,left);else active.delete(input.ownerId);}
  }
  const request=input.request||createModelRequest({developmentOrigin:input.config.publicOrigin});
  const headers=(provider:string,key:string):Record<string,string>=>provider==='anthropic'?{'x-api-key':key,'anthropic-version':'2023-06-01'}:provider==='google'?{'x-goog-api-key':key}:{authorization:`Bearer ${key}`};
  return {
    catalog: (provider:unknown,body:unknown)=>run(async()=>{
      const c=await resolve(provider,body);let url=new URL(c.baseUrl+'/models');
      if(c.provider==='anthropic')url=new URL('/v1/models?limit=1000',c.baseUrl);
      if(c.provider==='google')url=new URL('/v1beta/models?pageSize=1000',c.baseUrl);
      if(c.provider==='qwen')url=new URL('/api/v1/models?providers=qwen&capabilities=TG&features=function-calling&supports=inference&language=zh-CN&page_no=1&page_size=100',c.baseUrl);
      try{
        const response=await request(url,{method:'GET',headers:{accept:'application/json',...headers(c.provider,c.apiKey)}});
        if(response.status<200||response.status>=300)return {ok:false,error:upstreamMessage(response.status)};
        let models:ProviderModel[];
        try {
          models=catalogModels(c.provider,response.body);
          if(models.some(model=>model.id.includes(c.apiKey)||model.name.includes(c.apiKey)||model.features.some(feature=>feature.includes(c.apiKey))))throw Error('Credential reflected by provider');
        } catch {return {ok:false,errorCode:'MODEL_CATALOG_INVALID',error:'模型目录响应格式不正确，请检查接口地址或手动输入模型 ID'};}
        return {ok:true,models};
      }catch(error){return modelNetworkFailure(error);}
    }),
    test: (bodyValue:unknown)=>run(async()=>{
      const body=object(bodyValue);const c=await resolve(body.provider,body);
      if(!c.modelId)fail(400,'MODEL_ID_REQUIRED','请先选择或输入要测试的模型');
      let url=new URL(c.baseUrl+'/chat/completions');
      let payload:Record<string,unknown>={model:c.modelId,messages:[{role:'user',content:'Reply OK'}],stream:false,...(['openai','moonshot'].includes(c.provider)?{max_completion_tokens:16}:{max_tokens:16})};
      if(c.provider==='anthropic'){
        url=new URL(c.baseUrl.replace(/\/v1$/,'')+'/v1/messages');payload={model:c.modelId,max_tokens:16,messages:[{role:'user',content:'Reply OK'}]};
      }else if(c.provider==='google'){
        url=new URL(`/v1beta/models/${encodeURIComponent(c.modelId)}:generateContent`,c.baseUrl);
        payload={contents:[{parts:[{text:'Reply OK'}]}],generationConfig:{maxOutputTokens:16}};
      }
      const start=Date.now();
      try{
        const response=await request(url,{method:'POST',headers:{'content-type':'application/json',...headers(c.provider,c.apiKey)},body:JSON.stringify(payload)});
        const latencyMs=Date.now()-start;
        if(response.status<200||response.status>=300)return {ok:false,latencyMs,error:upstreamMessage(response.status)};
        const value=record(response.body);
        const valid=!value.error&&(c.provider==='google'
          ? Array.isArray(value.candidates)&&value.candidates.some((candidate:any)=>Array.isArray(candidate?.content?.parts)&&candidate.content.parts.some((part:any)=>typeof part?.text==='string'&&part.text.trim().length>0))
          : c.provider==='anthropic'
          ? value.type==='message'&&Array.isArray(value.content)&&value.content.some((part:any)=>part?.type==='text'&&typeof part.text==='string'&&part.text.trim().length>0)
          : Array.isArray(value.choices)&&value.choices.some((choice:any)=>choice?.message?.role==='assistant'&&typeof choice.message.content==='string'&&choice.message.content.trim().length>0));
        if(!valid)throw Error('Invalid inference response');
        return {ok:true,latencyMs,message:'所选模型调用成功（本次测试可能消耗服务商额度）'};
      }catch(error){return error instanceof ModelRequestError
        ? {...modelNetworkFailure(error),latencyMs:Date.now()-start}
        : {ok:false,latencyMs:Date.now()-start,errorCode:'MODEL_INFERENCE_INVALID',error:'模型服务响应格式不正确或未返回有效内容，请检查模型 ID'};}
    }),
  };
}
