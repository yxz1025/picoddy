import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { lstat, readFile, realpath, readdir } from 'node:fs/promises';
import { isAbsolute, relative, resolve } from 'node:path';
const exec = promisify(execFile);
export const hash = value => createHash('sha256').update(value).digest('hex');
export async function git(root, args) { return (await exec('git', ['-C', root, ...args], { timeout: 15000, maxBuffer: 4 * 1024 * 1024, windowsHide: true })).stdout; }
export async function inside(root, path) {
  const canonical = await realpath(resolve(root, path));
  const rel = relative(await realpath(root), canonical);
  if (rel === '..' || rel.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`) || isAbsolute(rel)) throw new Error('Path is outside the selected repository');
  return canonical;
}
export async function inspect(input) {
  if (!['darwin', 'win32'].includes(process.platform)) throw new Error('Local WeChat runner currently supports macOS and Windows');
  if (!isAbsolute(input.repositoryRoot || '') || !isAbsolute(input.cliPath || '')) throw new Error('Repository and DevTools CLI must be absolute paths');
  const root = await realpath(input.repositoryRoot);
  if (await realpath((await git(root, ['rev-parse', '--show-toplevel'])).trim()) !== root) throw new Error('Select the Git repository root');
  if (!(await lstat(input.cliPath)).isFile()) throw new Error('DevTools CLI not found');
  const project = await inside(root, input.projectPath || '.');
  const config = JSON.parse(await readFile(resolve(project, 'project.config.json'), 'utf8'));
  if (!/^wx[a-fA-F0-9]{16}$/.test(input.appId || '') || config.appid !== input.appId) throw new Error('Configured AppID does not match project.config.json');
  const miniRoot = await inside(project, config.miniprogramRoot || '.');
  await readFile(resolve(miniRoot, 'app.json'), 'utf8');
  const sdkPath = createRequire(resolve(root, 'package.json')).resolve('miniprogram-automator');
  return { root, project, miniRoot, sdkPath, cliPath: input.cliPath, appId: input.appId, message: 'Files and SDK found. Login and CLI/HTTP permission are checked when launching; no test has run.' };
}
export async function fingerprint(root) {
  const digest = createHash('sha256'); let bytes = 0; let files = 0;
  async function visit(dir) {
    for (const name of (await readdir(dir)).sort()) {
      if (['.git', 'node_modules', 'testing-results'].includes(name)) continue;
      const path = resolve(dir, name); const info = await lstat(path);
      if (info.isSymbolicLink()) throw new Error('Mini-program output must not contain symbolic links');
      if (info.isDirectory()) await visit(path);
      else if (info.isFile()) {
        bytes += info.size;
        if (++files > 20000 || bytes > 200 * 1024 * 1024) throw new Error('Mini-program output exceeds fingerprint limits');
        digest.update(JSON.stringify(relative(root, path).replaceAll('\\', '/'))).update('\0').update(await readFile(path)).update('\0');
      }
    }
  }
  await visit(root); return digest.digest('hex');
}
export async function validateRequest(request) {
  if (!request || !/^[A-Za-z0-9_-]{1,100}$/.test(request.id || '')) throw new Error('Invalid request ID');
  if (request.target?.kind !== 'wechat-mini' || !request.target.mini) throw new Error('Not a local mini-program target');
  const config = await inspect({ ...request.target.mini, repositoryRoot: request.repositoryRoot });
  const commit = request.package?.testSha;
  if (!/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(commit || '') || commit !== request.businessSha) throw new Error('Local tests require the same full business and test commit');
  if ((await git(config.root, ['rev-parse', 'HEAD'])).trim() !== commit || (await git(config.root, ['status', '--porcelain'])).trim()) throw new Error('Commit the tests and use a clean worktree at the requested SHA');
  const manifest = request.package?.manifestPath;
  if (typeof manifest !== 'string' || /^[-/]|^[A-Za-z]:|\\/.test(manifest) || manifest.split('/').some(p => !p || p === '..' || p === '.git')) throw new Error('Invalid package path');
  const raw = await git(config.root, ['show', `${commit}:${manifest}`]);
  if (hash(raw) !== request.package.hash) throw new Error('Package hash mismatch');
  const pack = JSON.parse(raw);
  if (pack.schemaVersion !== 1 || !Array.isArray(pack.cases) || !pack.cases.length || pack.cases.length > 5000) throw new Error('Invalid test package');
  const seen = new Set();
  for (const row of pack.cases) {
    if (!/^[A-Za-z0-9_-]{1,100}$/.test(row.id) || seen.has(row.id)) throw new Error('Invalid or duplicate case ID');
    seen.add(row.id);
    if (row.automation === 'automated') {
      if (typeof row.file !== 'string' || !row.file.endsWith('.cjs')) throw new Error('Mini-program cases must be .cjs modules');
      await inside(config.root, row.file);
      if ((await git(config.root, ['cat-file', '-t', `${commit}:${row.file}`])).trim() !== 'blob') throw new Error('Case script is not committed');
    }
  }
  if (!pack.cases.some(c => c.automation === 'automated')) throw new Error('No automated cases');
  return { ...config, cases: pack.cases, projectHash: await fingerprint(config.miniRoot) };
}
