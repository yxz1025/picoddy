import assert from 'node:assert/strict';
import test from 'node:test';
import {loadConfig} from '../src/config.ts';
import {mkdtemp,writeFile,rm,chmod,symlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {seal} from '../src/infra/crypto.ts';
import {loadSkillHubSecret} from '../src/platform/skillhub-secret.ts';

const env={DATABASE_URL:'postgres://unused/test',PUBLIC_ORIGIN:'http://localhost:8080',ENCRYPTION_KEY:'a'.repeat(64),SANDBOX_DOMAIN:'http://localhost:8090',SANDBOX_API_KEY:'test'};
test('SkillHub server config requires an explicit registry and has no default secret',()=>{
  const config=loadConfig(env) as ReturnType<typeof loadConfig>&{skillHubBaseUrl:string;skillHubSecret:string;skillHubSecretFile:string};
  assert.equal(config.skillHubBaseUrl,'');
  assert.equal(loadConfig({...env,SKILLHUB_BASE_URL:'https://skillhub.example.test/'}).skillHubBaseUrl,'https://skillhub.example.test');
  assert.equal(config.skillHubSecret,'');
  assert.match(config.skillHubSecretFile,/cloud[/\\]data[/\\]skillhub-secret\.enc$/);
});
test('SkillHub loads an encrypted server secret and masks missing or invalid credentials',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'cloud-skillhub-secret-'));
  const file=join(directory,'server.enc');
  const secret=Buffer.alloc(32,7).toString('base64');
  try {
    const config=loadConfig({...env,SKILLHUB_SECRET_FILE:file});
    await assert.rejects(loadSkillHubSecret(config),(error:any)=>error.code==='SKILLHUB_NOT_CONFIGURED'&&!error.message.includes(file));
    await writeFile(file,seal({secret},config.encryptionKey),{mode:0o600});
    assert.equal(await loadSkillHubSecret(config),secret);
    await assert.rejects(loadSkillHubSecret({...config,encryptionKey:'b'.repeat(64)}),(error:any)=>error.code==='SKILLHUB_NOT_CONFIGURED'&&!error.message.includes(secret));
    await assert.rejects(loadSkillHubSecret({...config,skillHubSecret:'bad-secret'}),(error:any)=>error.code==='SKILLHUB_NOT_CONFIGURED'&&!error.message.includes('bad-secret'));
    if(process.platform!=='win32') {
      await chmod(file,0o644);
      await assert.rejects(loadSkillHubSecret(config),(error:any)=>error.code==='SKILLHUB_NOT_CONFIGURED');
      await chmod(file,0o600);
      await symlink(file,join(directory,'link.enc'));
      await assert.rejects(loadSkillHubSecret({...config,skillHubSecretFile:join(directory,'link.enc')}),(error:any)=>error.code==='SKILLHUB_NOT_CONFIGURED');
    }
    await writeFile(file,'x'.repeat(4097));
    await assert.rejects(loadSkillHubSecret(config),(error:any)=>error.code==='SKILLHUB_NOT_CONFIGURED');
  } finally {await rm(directory,{recursive:true,force:true});}
});
test('SkillHub server endpoint rejects credentials, query and fragment',()=>{
  for(const value of ['https://user:pass@market.example.test','https://market.example.test?secret=x','https://market.example.test#x']){
    assert.throws(()=>loadConfig({...env,SKILLHUB_BASE_URL:value}),/SKILLHUB_BASE_URL/);
  }
});
