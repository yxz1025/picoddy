import {parseSkillFiles,validatePackagePath,SKILL_PACKAGE_LIMITS,type ParsedSkillFile} from '../domains/skill/node/package.ts';
import type {RunSelection} from '../cloud/runs/types.ts';
import {UUID} from '../shared/validation.ts';
import {fail} from '../shared/errors.ts';

type Expert={id:string;name:string;data:Record<string,any>}|undefined;

export function freezeExpertForRun(expert:Expert):Expert {
  if(!expert) return undefined;
  const {bundledSkills:_bundled,...data}=expert.data;
  return {id:expert.id,name:expert.name,data};
}

export function assertRunSnapshotBudget(selection:unknown):void {
  if(Buffer.byteLength(JSON.stringify(selection))>64*1024*1024) {
    fail(413,'RUN_SNAPSHOT_TOO_LARGE','The complete run snapshot exceeds the 64 MiB limit');
  }
}

/** Revalidate frozen package data before any sandbox write. */
export function expertPackageFiles(expert:Expert):ParsedSkillFile[] {
  if(!expert?.data.skillhubPackage) return [];
  const files=expert.data.skillhubPackage.files;
  if(!Array.isArray(files)||files.length>SKILL_PACKAGE_LIMITS.maxFiles) throw new Error('INVALID_EXPERT_PACKAGE_FILES');
  const paths=new Set<string>();let total=0;
  return files.map((file:any)=>{
    if(!file||typeof file.path!=='string'||typeof file.contentBase64!=='string') throw new Error('INVALID_EXPERT_PACKAGE_FILE');
    const path=validatePackagePath(file.path);
    if(paths.has(path)||[...paths].some(other=>path.startsWith(other+'/')||other.startsWith(path+'/'))) throw new Error('INVALID_EXPERT_PACKAGE_PATH');
    paths.add(path);
    if(file.contentBase64.length>Math.ceil(SKILL_PACKAGE_LIMITS.maxFileBytes/3)*4) throw new Error('EXPERT_PACKAGE_TOO_LARGE');
    const bytes=Buffer.from(file.contentBase64,'base64');total+=bytes.length;
    if(bytes.toString('base64')!==file.contentBase64||bytes.length>SKILL_PACKAGE_LIMITS.maxFileBytes||total>SKILL_PACKAGE_LIMITS.maxTotalUncompressedBytes) throw new Error('INVALID_EXPERT_PACKAGE_CONTENT');
    return {path,contentBase64:file.contentBase64};
  });
}

export function expertPackageSkills(expert:Expert):RunSelection['skills'] {
  const bundles=expert?.data.bundledSkills;
  if(bundles===undefined) return [];
  if(!Array.isArray(bundles)||bundles.length>64) throw new Error('INVALID_EXPERT_BUNDLED_SKILLS');
  const ids=new Set<string>();let total=0;
  return bundles.map((bundle:any)=>{
    if(!bundle||typeof bundle.id!=='string'||!UUID.test(bundle.id)||ids.has(bundle.id)) throw new Error('INVALID_EXPERT_BUNDLED_SKILL_ID');
    ids.add(bundle.id);
    const parsed=parseSkillFiles(bundle.files);
    if(bundle.name!==parsed.name||bundle.version!==parsed.version) throw new Error('INVALID_EXPERT_BUNDLED_SKILL_VERSION');
    total+=Buffer.byteLength(JSON.stringify(parsed.files));
    if(total>64*1024*1024) throw new Error('EXPERT_SKILLS_TOO_LARGE');
    return {id:bundle.id,name:parsed.name,version:parsed.version,files:parsed.files};
  });
}
