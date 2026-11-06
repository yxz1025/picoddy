import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { pool, transaction } from '../src/infra/db.ts';
import { parseSkillPackage } from '../src/domains/skill/node/package.ts';

const index=process.argv.indexOf('--subject');
const subject=index>=0?process.argv[index+1]?.trim():undefined;
try {
  if (!subject) throw new Error('Usage: npm run seed-skills -- --subject username');
  const packages=await Promise.all(['data-analysis','weekly-report','polish-writing'].map(async name =>
    parseSkillPackage('SKILL.md',await readFile(new URL(`../resources/skills/${name}/SKILL.md`,import.meta.url)))));
  const count=await transaction(async client=>{
    const users=await client.query("SELECT id FROM users WHERE provider='cas' AND subject=$1 AND disabled_at IS NULL FOR UPDATE",[subject]);
    const owner=users.rows[0]?.id;
    if (!owner) throw new Error('User not found');
    let installed=0;
    for (const skill of packages) {
      const existing=await client.query("SELECT id FROM resources WHERE owner_id=$1 AND kind='skill' AND name=$2 AND deleted_at IS NULL",[owner,skill.name]);
      if (existing.rowCount) continue;
      const id=randomUUID();
      await client.query("INSERT INTO resources(id,owner_id,kind,name,data) VALUES($1,$2,'skill',$3,$4)",
        [id,owner,skill.name,JSON.stringify({description:skill.description,currentVersion:skill.version,enabled:true})]);
      await client.query('INSERT INTO skill_versions(skill_id,owner_id,version,description,files) VALUES($1,$2,$3,$4,$5)',
        [id,owner,skill.version,skill.description,JSON.stringify(skill.files)]);
      installed++;
    }
    return installed;
  });
  console.log(`Installed ${count} cloud skills; existing skills were preserved.`);
} finally { await pool.end(); }
