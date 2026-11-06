import {open} from 'node:fs/promises';
import {constants} from 'node:fs';
import type {Config} from '../config.ts';
import {unseal} from '../infra/crypto.ts';
import {fail} from '../shared/errors.ts';

export function validateSkillHubSharedSecret(value: unknown): string {
  if(typeof value!=='string'||!/^[A-Za-z0-9+/]{43}=$/.test(value)||Buffer.from(value,'base64').length!==32||Buffer.from(value,'base64').toString('base64')!==value) {
    fail(503,'SKILLHUB_NOT_CONFIGURED','技能市场服务端认证配置无效，请联系管理员');
  }
  return value;
}

export async function loadSkillHubSecret(config: Config): Promise<string> {
  if(config.skillHubSecret) return validateSkillHubSharedSecret(config.skillHubSecret);
  try {
    const file=await open(config.skillHubSecretFile,constants.O_RDONLY|(process.platform==='win32'?0:constants.O_NOFOLLOW));
    try {
      const info=await file.stat();
      if(!info.isFile()||info.size>4096||(process.platform!=='win32'&&(info.mode&0o077)!==0)) throw new Error('Invalid secret file');
      const buffer=Buffer.alloc(4097);let size=0;
      while(size<buffer.length) {
        const result=await file.read(buffer,size,buffer.length-size,size);
        if(result.bytesRead===0) break;
        size+=result.bytesRead;
      }
      if(size>4096) throw new Error('Invalid secret file');
      const value=unseal(buffer.subarray(0,size).toString('utf8').trim(),config.encryptionKey) as {secret?:unknown};
      return validateSkillHubSharedSecret(value?.secret);
    } finally {await file.close();}
  } catch {
    fail(503,'SKILLHUB_NOT_CONFIGURED','技能市场服务端认证配置尚未就绪，请联系管理员');
  }
}
