import { realpath } from 'node:fs/promises';
import { join, relative, isAbsolute, sep } from 'node:path';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { Repository } from '../../requirement/node/repositories.ts';
import type { PreviewWorkspace } from '../shared/contracts.ts';
const exec = promisify(execFile);
export const git = async (root: string, args: string[]) => (await exec('git', ['-C', root, ...args], { windowsHide: true, timeout: 20000, maxBuffer: 4 * 1024 * 1024 })).stdout.trim();
export const digest = (v: string) => createHash('sha256').update(v).digest('hex');
export async function contained(root: string, path: string) {
  const base = await realpath(root), target = await realpath(join(base, path));
  const rel = relative(base, target);
  if (rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) throw new Error('路径越出设计工作区');
  return target;
}
export async function revision(root: string) {
  const path = await realpath(root);
  if (await realpath(await git(root, ['rev-parse', '--show-toplevel'])) !== path) throw new Error('设计工作区根目录已变化');
  return { commit: await git(root, ['rev-parse', 'HEAD']), dirty: Boolean(await git(root, ['status', '--porcelain'])) };
}
export async function bindRepository(repo: Repository): Promise<PreviewWorkspace> {
  const code = await revision(repo.root);
  const branch = await git(repo.root, ['branch', '--show-current']);
  if (!branch || branch !== repo.branch) throw new Error('仓库当前分支与关联分支不一致，请在代码仓库中重新确认关联；不会自动切换分支');
  return { path: await realpath(repo.root), branch, baseCommit: code.commit };
}
export async function verifyWorkspace(repo: Repository, workspace?: PreviewWorkspace) {
  const current = await bindRepository(repo);
  if (!workspace || current.path !== workspace.path || current.branch !== workspace.branch) throw new Error('预览目标与当前关联目录/分支不一致，请重新保存目标配置');
  return revision(current.path);
}
