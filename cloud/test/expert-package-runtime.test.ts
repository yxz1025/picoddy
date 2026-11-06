import assert from 'node:assert/strict';
import test from 'node:test';
import {parseSkillFiles} from '../src/domains/skill/node/package.ts';
import {expertPackageFiles,expertPackageSkills,freezeExpertForRun,assertRunSnapshotBudget} from '../src/agent/expert-package.ts';
import {expertRevision} from '../src/domains/expert/node/binding.ts';
const id='11111111-1111-4111-8111-111111111111';
const files=[{path:'SKILL.md',contentBase64:Buffer.from('---\nname: report\ndescription: Report\n---\nWrite report.').toString('base64')}];
test('market expert includes frozen bundled skills and its complete package files',()=>{
  const parsed=parseSkillFiles(files);
  const expert={id,name:'Expert',data:{bundledSkills:[{id,name:parsed.name,version:parsed.version,files:parsed.files}],skillhubPackage:{files:[{path:'agents/expert.md',contentBase64:Buffer.from('Instructions').toString('base64')}]}}};
  assert.deepEqual(expertPackageSkills(expert),[{id,name:parsed.name,version:parsed.version,files:parsed.files}]);
  assert.equal(expertPackageFiles(expert)[0].path,'agents/expert.md');
  assert.deepEqual(expertPackageSkills({id,name:'Old expert',data:{prompt:'Hi'}}),[]);
  const frozen=freezeExpertForRun(expert)!;
  assert.equal(frozen.data.bundledSkills,undefined);
  assert.deepEqual(frozen.data.skillhubPackage,expert.data.skillhubPackage);
  assert.ok(expert.data.bundledSkills);
});
test('whole run snapshot rejects oversized aggregate data',()=>{
  assert.doesNotThrow(()=>assertRunSnapshotBudget({prompt:'small'}));
  assert.throws(()=>assertRunSnapshotBudget({data:'x'.repeat(64*1024*1024)}),(error:any)=>error.code==='RUN_SNAPSHOT_TOO_LARGE'&&error.status===413);
});
test('expert revision changes when bundled package content changes without prompt edits',()=>{
  const before={name:'Expert',data:{prompt:'Same prompt',skillIds:[],skillhubPackage:{version:'before'}}};
  const after={name:'Expert',data:{prompt:'Same prompt',skillIds:[],skillhubPackage:{version:'after'}}};
  assert.notEqual(expertRevision(before),expertRevision(after));
});
test('expert package runtime rejects unsafe paths and mismatched bundled skill identity',()=>{
  assert.throws(()=>expertPackageFiles({id,name:'Expert',data:{skillhubPackage:{files:[{path:'../../host',contentBase64:'eA=='}]}}}));
  assert.throws(()=>expertPackageSkills({id,name:'Expert',data:{bundledSkills:[{id,name:'wrong',version:'wrong',files}]}}));
  assert.throws(()=>expertPackageFiles({id,name:'Expert',data:{skillhubPackage:{files:[{path:'file',contentBase64:'not base64'}]}}}));
});
