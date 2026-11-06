import { request as httpsRequest } from 'node:https';
import { lookup } from 'node:dns';
import { BlockList, isIP } from 'node:net';

export interface ModelRequestInit { method: 'GET' | 'POST'; headers: Record<string,string>; body?: string }
export type ModelRequest = (url: URL, init: ModelRequestInit) => Promise<{status:number;body:unknown}>;

export type ModelRequestErrorCode='MODEL_ENDPOINT_BLOCKED'|'MODEL_DNS_BLOCKED'|'MODEL_DNS_FAILED'|'MODEL_RESPONSE_TOO_LARGE'|'MODEL_RESPONSE_FAILED'|'MODEL_RESPONSE_INVALID'|'MODEL_REQUEST_TIMEOUT'|'MODEL_REQUEST_FAILED';
export class ModelRequestError extends Error {
  constructor(readonly code:ModelRequestErrorCode){super(code);this.name='ModelRequestError';}
}

const blocked = new BlockList();
for (const [address,prefix] of [['0.0.0.0',8],['10.0.0.0',8],['100.64.0.0',10],['127.0.0.0',8],['169.254.0.0',16],['172.16.0.0',12],['192.0.0.0',24],['192.0.2.0',24],['192.168.0.0',16],['198.18.0.0',15],['198.51.100.0',24],['203.0.113.0',24],['224.0.0.0',4],['240.0.0.0',4]] as const) blocked.addSubnet(address,prefix,'ipv4');
const globalV6 = new BlockList(); globalV6.addSubnet('2000::',3,'ipv6');
const blockedV6 = new BlockList(); blockedV6.addSubnet('2001::',23,'ipv6'); blockedV6.addSubnet('2001:db8::',32,'ipv6'); blockedV6.addSubnet('2002::',16,'ipv6');
export function publicModelAddress(address: string): boolean {
  return isIP(address) === 4 ? !blocked.check(address,'ipv4')
    : isIP(address) === 6 && globalV6.check(address,'ipv6') && !blockedV6.check(address,'ipv6');
}

const proxyFakeIps=new BlockList();proxyFakeIps.addSubnet('198.18.0.0',15,'ipv4');
const officialProviderHosts=new Set(['dashscope.aliyuncs.com','api.openai.com','api.anthropic.com','generativelanguage.googleapis.com','api.deepseek.com','api.moonshot.cn']);
export function modelLookupAddressAllowed(address:string,hostname:string,developmentOrigin?:string):boolean {
  if(publicModelAddress(address)) return true;
  let local=false;
  try {local=Boolean(developmentOrigin&&['localhost','127.0.0.1','[::1]'].includes(new URL(developmentOrigin).hostname));} catch {}
  return local&&officialProviderHosts.has(hostname.toLowerCase())&&isIP(address)===4&&proxyFakeIps.check(address,'ipv4');
}

/** DNS policy is enforced at the actual socket lookup, not via a racy preflight. */
export function createModelRequest(configuration:{developmentOrigin?:string}={}):ModelRequest {
  return async (url, init) => new Promise((resolve,reject) => {
  if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443') || isIP(url.hostname.replace(/^\[|\]$/g,''))) {
    reject(new ModelRequestError('MODEL_ENDPOINT_BLOCKED')); return;
  }
  const req = httpsRequest(url, {
    method:init.method,headers:init.headers,agent:false,
    lookup(host, options, callback) {
      lookup(host,{all:true,verbatim:true},(error,addresses)=>{
        if (error || !addresses?.length) {
          (callback as any)(new ModelRequestError('MODEL_DNS_FAILED')); return;
        }
        if (addresses.some(a=>!modelLookupAddressAllowed(a.address,host,configuration.developmentOrigin))) {
          (callback as any)(new ModelRequestError('MODEL_DNS_BLOCKED')); return;
        }
        // Return only checked addresses; preserve SNI/certificate verification of original hostname.
        if ((options as any).all) (callback as any)(null,addresses);
        else (callback as any)(null,addresses[0].address,addresses[0].family);
      });
    },
  },res=>{
    const status=res.statusCode || 502;
    if (status < 200 || status >= 300) {res.destroy(); resolve({status,body:null});return;}
    let size=0; const chunks:Buffer[]=[];
    res.on('data',(chunk:Buffer)=>{
      size+=chunk.length;
      if(size>2*1024*1024){const error=new ModelRequestError('MODEL_RESPONSE_TOO_LARGE');reject(error);req.destroy(error);res.destroy();return;}
      chunks.push(chunk);
    });
    res.on('error',()=>reject(new ModelRequestError('MODEL_RESPONSE_FAILED')));
    res.on('end',()=>{try{resolve({status,body:JSON.parse(Buffer.concat(chunks).toString('utf8'))});}catch{reject(new ModelRequestError('MODEL_RESPONSE_INVALID'));}});
  });
  const timeout=setTimeout(()=>req.destroy(new ModelRequestError('MODEL_REQUEST_TIMEOUT')),20_000);
  timeout.unref();req.once('close',()=>clearTimeout(timeout));
  req.once('error',error=>reject(error instanceof ModelRequestError?error:new ModelRequestError('MODEL_REQUEST_FAILED')));
  req.end(init.body);
  });
}
export const requestModelJson:ModelRequest=createModelRequest();
