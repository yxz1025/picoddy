/** Deployment utility. Prints status only; runtime never accesses desktop storage. */
import {spawnSync} from 'node:child_process';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {dirname} from 'node:path';
import {loadConfig} from '../src/config.ts';
import {seal,unseal} from '../src/infra/crypto.ts';
import {validateSkillHubSharedSecret} from '../src/platform/skillhub-secret.ts';

const config=loadConfig();
let secret=config.skillHubSecret;
if(process.argv.includes('--from-desktop-keychain')) {
  if(process.platform!=='darwin') throw new Error('The desktop keychain import option is only available on macOS; use server environment provisioning on other platforms');
  const result=spawnSync('/usr/bin/security',['find-generic-password','-s','pi-a','-a','skillhub-access-token-secret','-w'],{encoding:'utf8'});
  if(result.status!==0) throw new Error('The existing SkillHub shared secret could not be read');
  secret=result.stdout.trim();
}
validateSkillHubSharedSecret(secret);
let existing:string|undefined;
try {existing=await readFile(config.skillHubSecretFile,'utf8');} catch(error) {
  if((error as NodeJS.ErrnoException).code!=='ENOENT') throw new Error('Cannot read the existing server secret file');
}
if(existing) {
  const value=unseal(existing.trim(),config.encryptionKey) as {secret?:string};
  if(value.secret!==secret) throw new Error('A different server shared secret already exists; refusing to overwrite it');
} else {
  await mkdir(dirname(config.skillHubSecretFile),{recursive:true,mode:0o700});
  await writeFile(config.skillHubSecretFile,seal({secret},config.encryptionKey)+'\n',{mode:0o600,flag:'wx'});
}
console.log('SkillHub server shared secret provisioned (encrypted; value not displayed).');
