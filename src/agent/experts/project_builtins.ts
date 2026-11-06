import { existsSync } from 'node:fs';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readExpertPackageManifest } from './installed_catalog.ts';
import type { ExpertManifest } from './types.ts';

const resourcesPath = (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath;
const packagedRoot = resourcesPath ? join(resourcesPath, 'builtin-experts') : '';
const root = packagedRoot && existsSync(packagedRoot)
  ? packagedRoot : fileURLToPath(new URL('../../../resources/builtin-experts/', import.meta.url));

/** Full vendored packages: prompts, declared skills, references, scripts and assets. */
export const projectBuiltinExperts: ExpertManifest[] = await Promise.all(
  (await readdir(root)).filter(name => !name.startsWith('.') && !name.includes('.')).sort().map(async id => {
    const expertRoot = join(root, id);
    const manifest = await readExpertPackageManifest(expertRoot, id, { catalogSource: 'builtin', badge: '系统内置' });
    const plugin = JSON.parse(await readFile(join(expertRoot, '.picoddy-plugin/plugin.json'), 'utf8'));
    // Skill and reference links in the original agent are relative to this file.
    manifest.prompt.inline = `专家资源定位（宿主提供）：\nexpertRoot: ${expertRoot}\nagentFile: ${join(expertRoot, 'agents', `${plugin.agentName}.md`)}\n原专家正文中的相对路径以 agentFile 所在目录为基准；包内脚本和资产以 expertRoot 定位。\n\n${manifest.prompt.inline}`;
    return manifest;
  }),
);
