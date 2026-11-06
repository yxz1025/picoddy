import { lstat, mkdir, mkdtemp, rename, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { platformPaths } from '../../../platform/paths.ts';
import { createCliPluginRegistry, runBundledCli } from '../../../platform/cli/runtime.ts';
import { BUILTIN_CLI_PLUGINS } from '../../../platform/cli/plugins.ts';
import { listSkills } from '../../skill/node/store.ts';
import { CLAWHUB_REGISTRY } from './client.ts';

const pending = new Set<string>();
/** Anonymous public installation through the shipped official CLI; no enterprise credentials. */
export async function installClawHubSkill(input: { namespace?: string; slug: string; version: string }) {
  const { slug, version } = input;
  const owner = input.namespace && input.namespace !== 'global' ? input.namespace : '';
  if (!/^[a-z0-9][a-z0-9-]{0,127}$/.test(slug) || (owner && !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/.test(owner)) || !/^[0-9]+\.[0-9]+\.[0-9]+(?:-[A-Za-z0-9.-]+)?(?:\+[A-Za-z0-9.-]+)?$/.test(version)) throw new Error('ClawHub 安装参数无效');
  if (pending.has(slug)) throw new Error('该技能正在安装');
  pending.add(slug);
  let staging: string | undefined;
  try {
    const existing = await listSkills();
    if (existing.some(skill => skill.name.toLowerCase() === slug.toLowerCase())) throw new Error('已有同名技能，请先在“我安装的”中管理，不能直接覆盖');
    const target = join(platformPaths.skillsDir, slug);
    try { await lstat(target); throw new Error('同名技能目录已存在，不能直接覆盖'); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    await mkdir(platformPaths.skillsDir, { recursive: true });
    // Stage on the same filesystem for an atomic move into the user skill root.
    staging = await mkdtemp(join(platformPaths.skillsDir, '.clawhub-'));
    const output = join(staging, 'skills');
    const plugin = createCliPluginRegistry(BUILTIN_CLI_PLUGINS).get('skillhub');
    if (!plugin) throw new Error('ClawHub CLI 未注册');
    await runBundledCli(plugin, ['--registry', CLAWHUB_REGISTRY, '--workdir', staging, '--dir', output, '--no-input', 'install', owner ? `@${owner}/${slug}` : slug, '--version', version], {
      managedEnv: { CLAWHUB_REGISTRY, CLAWHUB_CONFIG_PATH: join(staging, 'config.json'), CLAWHUB_DISABLE_TELEMETRY: '1' },
    }).catch(() => { throw new Error('ClawHub 安装失败，可能是网络、限流或技能未通过平台安装检查；未覆盖本地技能'); });
    const installedRoot = owner ? join(output, `@${owner}`) : output;
    const packageRoot = join(installedRoot, slug);
    const parsed = await listSkills({ builtinDir: '', userDir: installedRoot });
    const installed = parsed.find(skill => skill.path === join(packageRoot, 'SKILL.md'));
    if (!installed || installed.name !== slug) throw new Error('ClawHub 技能的 SKILL.md 无效或名称不匹配');
    if (existing.some(skill => skill.builtin && [skill.name, skill.displayName].filter(Boolean).some(name => name!.toLowerCase() === (installed.displayName || installed.name).toLowerCase()))) throw new Error('技能触发名与系统基础技能冲突，未安装');
    await rename(packageRoot, target);
    return { ...installed, version, path: join(target, 'SKILL.md') };
  } finally {
    pending.delete(slug);
    if (staging) await rm(staging, { recursive: true, force: true }).catch(() => {});
  }
}
