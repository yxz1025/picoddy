import { execFile } from 'node:child_process';
import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join, dirname, posix, win32 } from 'node:path';
import { promisify } from 'node:util';
import { platformPaths } from '../platform/paths.ts';
import { createDefaultManagedRuntimeService } from '../platform/runtime/index.ts';
import { mcpConfigStore } from './mcp_config.ts';

export const builtinNpmCatalog = {
  gitlab: { name: 'GitLab', description: '管理 GitLab 代码仓库、合并请求和议题', package: '@masuratech/gitlab-mcp-server', version: '1.0.0', fields: [
    { key: 'GITLAB_API_URL', label: 'GitLab API 地址', placeholder: 'https://gitlab.example.com/api/v4', secret: false, url: true },
    { key: 'GITLAB_PERSONAL_ACCESS_TOKEN', label: 'Personal Access Token', placeholder: '填写具有 api 权限的 Token', secret: true, url: false },
  ] },
  jenkins: { name: 'Jenkins', description: '管理 Jenkins 构建任务、流水线和构建日志', package: '@kud/mcp-jenkins', version: '2.3.0', fields: [
    { key: 'MCP_JENKINS_URL', label: 'Jenkins 服务地址', placeholder: 'http://jenkins.example.com:8081', secret: false, url: true },
    { key: 'MCP_JENKINS_USER', label: '用户名', placeholder: '填写 Jenkins 用户名', secret: false, url: false },
    { key: 'MCP_JENKINS_API_TOKEN', label: 'API Token', placeholder: '填写 Jenkins API Token', secret: true, url: false },
  ] },
} as const;
export type BuiltinNpmId = keyof typeof builtinNpmCatalog;
function definition(id: BuiltinNpmId) {
  if (!Object.hasOwn(builtinNpmCatalog, id)) throw new Error('未知的内置连接器');
  return builtinNpmCatalog[id];
}
export function builtinNpmPaths(root: string, id: BuiltinNpmId, platform: string = process.platform) {
  const entry = definition(id);
  const p = platform === 'win32' ? win32 : posix;
  const directory = p.join(root, 'mcp-packages', id, entry.version);
  return { directory, entry: p.join(directory, 'node_modules', ...entry.package.split('/'), 'dist', 'index.js'), marker: p.join(directory, '.installed') };
}
const run = promisify(execFile);
class NpmInstallStageError extends Error {
  constructor(readonly stage: string) { super(stage); }
}
export async function installBuiltinNpmPackage(id: BuiltinNpmId, paths: ReturnType<typeof builtinNpmPaths>) {
  let stage = '准备内置运行时';
  try {
  const entry = definition(id);
  const runtime = createDefaultManagedRuntimeService();
  const node = await runtime.resolveNode();
  const shellEnv = await runtime.buildShellEnv();
  // Keep the managed wrappers first in PATH for npm subprocesses.
  const env = { ...node.env, PATH: shellEnv.PATH };
  const npm = join(dirname(createRequire(import.meta.url).resolve('npm/package.json')), 'bin', 'npm-cli.js').replace(/app\.asar([/\\])/, 'app.asar.unpacked$1');
  stage = '检查内置 npm 完整性';
  await run(node.executable, [npm, '--version'], {
    env, timeout: 30_000, maxBuffer: 256 * 1024, windowsHide: true,
  });
  stage = '创建安装目录';
  await mkdir(paths.directory, { recursive: true });
  stage = '下载并安装依赖';
  await run(node.executable, [npm, 'install', '--prefix', paths.directory, '--no-audit', '--no-fund', '--ignore-scripts', '--registry=https://registry.npmjs.org', `${entry.package}@${entry.version}`], {
    env, timeout: 300_000, maxBuffer: 2 * 1024 * 1024, windowsHide: true,
  });
  stage = '校验入口文件和软件包版本';
  await access(paths.entry);
  const manifest = JSON.parse(await readFile(join(dirname(dirname(paths.entry)), 'package.json'), 'utf8'));
  if (manifest.name !== entry.package || manifest.version !== entry.version) throw new Error('软件包版本校验失败');
  } catch {
    throw new NpmInstallStageError(stage);
  }
}

export function createBuiltinNpmMcpService(deps: {
  root: string; store: typeof mcpConfigStore;
  install: (id: BuiltinNpmId, paths: ReturnType<typeof builtinNpmPaths>) => Promise<void>;
}) {
  const pending = new Map<BuiltinNpmId, Promise<void>>();
  const errors = new Map<BuiltinNpmId, string>();
  const isInstalled = async (id: BuiltinNpmId) => {
    const paths = builtinNpmPaths(deps.root, id);
    return Promise.all([access(paths.entry), access(paths.marker)]).then(() => true, () => false);
  };
  const status = async (id: BuiltinNpmId) => {
    const entry = definition(id);
    const config = (await deps.store.load()).mcpServers[id];
    const managed = config?.managedBy === 'builtin';
    return { id, name: entry.name, description: entry.description, fields: entry.fields,
      installed: await isInstalled(id), installing: pending.has(id), configured: managed && !config.disabled,
      values: Object.fromEntries(entry.fields.filter(f => !f.secret).map(f => [f.key, managed ? config.env?.[f.key] ?? '' : ''])),
      hasToken: managed && entry.fields.some(f => f.secret && !!config.env?.[f.key]),
      error: errors.get(id), conflict: !!config && !managed,
    };
  };
  return { status,
    install(id: BuiltinNpmId): Promise<void> {
      definition(id);
      const existing = pending.get(id);
      if (existing) return existing;
      errors.delete(id);
      const task = (async () => {
        if (await isInstalled(id)) return;
        const paths = builtinNpmPaths(deps.root, id);
        await deps.install(id, paths);
        await access(paths.entry);
        await writeFile(paths.marker, definition(id).version).catch(() => {
          throw new NpmInstallStageError('写入安装标记');
        });
      })().catch((error) => {
        const message = error instanceof NpmInstallStageError
          ? `${definition(id).name} 安装失败：${error.stage}。${error.stage === '检查内置 npm 完整性' ? '应用内置 npm 不完整或无法启动，请修复应用安装。' : '请检查运行时、目录权限和网络后重试。'}`
          : `${definition(id).name} 安装失败，请检查网络和应用运行时后重试`;
        errors.set(id, message);
        throw new Error(message);
      }).finally(() => pending.delete(id));
      pending.set(id, task);
      return task;
    },
    async configure(id: BuiltinNpmId, input: unknown) {
      const entry = definition(id);
      if (pending.has(id) || !await isInstalled(id)) throw new Error('请先完成依赖安装');
      if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('参数格式错误');
      await deps.store.update(config => {
        const old = config.mcpServers[id];
        if (old && old.managedBy !== 'builtin') throw new Error('存在同名手动配置，请先在手动配置中重命名');
        const env: Record<string, string> = {};
        for (const field of entry.fields) {
          const raw = (input as Record<string, unknown>)[field.key];
          let value = typeof raw === 'string' ? raw.trim() : '';
          if (!value && field.secret) value = old?.env?.[field.key] ?? '';
          if (!value) throw new Error(`请填写 ${field.label}`);
          if (field.url) {
            let url: URL;
            try { url = new URL(value); } catch { throw new Error(`${field.label} 必须为 HTTP(S) 地址`); }
            if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error(`${field.label} 必须为不含账号、查询参数或片段的 HTTP(S) 地址`);
          }
          env[field.key] = value;
        }
        config.mcpServers[id] = { managedBy: 'builtin', type: 'stdio', command: process.execPath,
          args: [builtinNpmPaths(deps.root, id).entry], env, disabled: false,
          displayName: entry.name, description: entry.description };
      });
    },
  };
}
export const builtinNpmMcpService = createBuiltinNpmMcpService({ root: platformPaths.appDataDir, store: mcpConfigStore, install: installBuiltinNpmPackage });
