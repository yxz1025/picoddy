import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { DatabaseSync } from 'node:sqlite';
import type { TestCase } from '../shared/contracts.ts';
import { createRepositoryStore } from '../../requirement/node/repositories.ts';
import { createRequirementAssets } from '../../requirement/node/assets.ts';
import { createTestingStore } from './store.ts';
import { digest, relativeFile, sha, text } from './validation.ts';
const exec = promisify(execFile);

/** Read committed bytes, not the mutable worktree; CI can reproduce this package. */
export async function importTestPackage(db: DatabaseSync, root: string, account: string, space: string, targetId: string, commit: string, manifestPath: string, assertIdentity: () => void) {
  sha(commit); relativeFile(manifestPath);
  const store = createTestingStore(db, account, space);
  const target = store.target(targetId);
  const repo = createRepositoryStore(db, account, space).list().find(r => r.id === target.repositoryId);
  if (!repo) throw new Error('仓库关联已解除');
  const git = async (args: string[]) => (await exec('git', ['-C', repo.root, ...args], { timeout: 15000, maxBuffer: 4 * 1024 * 1024, windowsHide: true })).stdout;
  if ((await git(['rev-parse', `${commit}^{commit}`])).trim() !== commit) throw new Error('测试版本不匹配');
  const raw = await git(['show', `${commit}:${manifestPath}`]);
  const data = JSON.parse(raw);
  if (data.schemaVersion !== 1 || !Array.isArray(data.cases) || !data.cases.length || data.cases.length > 5000 || !Array.isArray(data.inputAssets) || !data.inputAssets.length) throw new Error('测试包需要 schemaVersion=1、cases 和 SDD inputAssets');
  const seen = new Set<string>();
  const cases: TestCase[] = [];
  for (const item of data.cases) {
    const id = text(item.id, 'TC ID', 100);
    if (!/^[A-Za-z0-9_-]+$/.test(id) || seen.has(id)) throw new Error('TC ID 格式无效或重复');
    seen.add(id);
    if (!Array.isArray(item.acceptanceIds) || !item.acceptanceIds.length || typeof item.required !== 'boolean' || !['automated', 'manual', 'blocked'].includes(item.automation)) throw new Error(`用例 ${id} 缺少验收映射或自动化状态`);
    const file = item.automation === 'automated' ? relativeFile(item.file) : undefined;
    if (file && target.kind === 'wechat-mini' && !file.endsWith('.cjs')) throw new Error('微信本地用例需要导出 cases 的 .cjs 文件');
    if (file && (await git(['cat-file', '-t', `${commit}:${file}`])).trim() !== 'blob') throw new Error('测试脚本必须是已提交文件');
    cases.push({ id, title: text(item.title, '标题'), acceptanceIds: item.acceptanceIds.map((v: unknown) => text(v, '验收编号', 100)), required: item.required, automation: item.automation, ...(file ? { file } : {}) });
  }
  const available = await createRequirementAssets(root, account, space).context(7, data.inputAssets);
  const inputAssets = data.inputAssets.map((ref: { id: string; hash: string }) => {
    if (!ref || !available.some(a => a.id === ref.id && a.hash === ref.hash)) throw new Error('SDD 输入版本未提交或不属于当前需求');
    return { id: ref.id, hash: ref.hash };
  });
  assertIdentity();
  if (store.target(targetId).revision !== target.revision) throw new Error('测试目标已变化，请重新登记测试包');
  return store.addPackage({ targetId, repositoryId: repo.id, testSha: commit, hash: digest(raw), manifestPath, cases, inputAssets });
}
