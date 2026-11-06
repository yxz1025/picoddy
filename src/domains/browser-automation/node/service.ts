import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { release } from 'node:os';
import { join } from 'node:path';
import { access, cp, mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { platformPaths } from '../../../platform/paths.ts';
import { createDefaultManagedRuntimeService } from '../../../platform/runtime/index.ts';
import type { BrowserAutomationStatus } from '../shared/contracts.ts';

const VERSION = '1.63.0';
const key = `${process.platform}-${process.arch}`;
const root = join(platformPaths.appDataDir, 'browser-automation');
const runtimeRoot = join(root, `${VERSION}-${key}`);
const stateFile = join(root, 'state.json');
let job: Promise<void> | undefined;
let controller: AbortController | undefined;
let phase: BrowserAutomationStatus['phase'] = 'idle';
let message = '';
let progress: number | undefined;

function unsupported(): string {
  if (process.platform === 'darwin' && ['arm64', 'x64'].includes(process.arch)) {
    return Number(release().split('.')[0]) >= 23 ? '' : '需要 macOS 14 或更高版本';
  }
  if (process.platform === 'win32' && process.arch === 'x64') {
    return Number(release().split('.')[2]) >= 22000 ? '' : '此安装入口支持 Windows 11 或更高版本';
  }
  return `暂不支持 ${key}，支持 macOS Intel / Apple Silicon 和 Windows x64 客户端`;
}
async function enabled() {
  try { return JSON.parse(await readFile(stateFile, 'utf8')).enabled === true; } catch { return false; }
}
async function setEnabled(value: boolean) {
  await mkdir(root, { recursive: true });
  const temp = `${stateFile}.${randomUUID()}.tmp`;
  await writeFile(temp, JSON.stringify({ enabled: value }));
  await rename(temp, stateFile);
}
async function installed() {
  try {
    const marker = JSON.parse(await readFile(join(runtimeRoot, 'ready.json'), 'utf8'));
    if (marker.version !== VERSION || marker.platform !== key) return false;
    const pkg = JSON.parse(await readFile(join(runtimeRoot, 'node_modules/@playwright/test/package.json'), 'utf8'));
    if (pkg.version !== VERSION) return false;
    await access(join(runtimeRoot, marker.browser));
    await access(join(runtimeRoot, 'node_modules/playwright/cli.js'));
    return true;
  } catch { return false; }
}
export async function browserAutomationStatus(): Promise<BrowserAutomationStatus> {
  const reason = unsupported();
  const ready = !reason && await installed();
  const on = await enabled();
  return { supported: !reason, platform: key, version: VERSION, enabled: on && ready,
    installed: ready, phase: job ? phase : phase === 'error' ? 'error' : ready ? 'ready' : 'idle',
    progress: job ? progress : undefined,
    message: reason || message || (ready ? (on ? '已就绪' : '已安装，当前关闭') : '开启后自动下载安装 Playwright 和 Chromium') };
}
async function run(executable: string, args: string[], cwd: string, env: NodeJS.ProcessEnv, signal: AbortSignal): Promise<string> {
  signal.throwIfAborted();
  return new Promise((resolveRun, reject) => {
    let output = ''; let timedOut = false;
    const child = spawn(executable, args, { cwd, env, shell: false, windowsHide: true, detached: process.platform !== 'win32' });
    const stop = () => {
      if (!child.pid) return;
      if (process.platform === 'win32') {
        const killer = spawn(join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'taskkill.exe'), ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
        killer.on('error', () => child.kill());
      } else { try { process.kill(-child.pid, 'SIGTERM'); } catch { child.kill(); } }
    };
    signal.addEventListener('abort', stop, { once: true });
    if (signal.aborted) stop();
    const timer = setTimeout(() => { timedOut = true; stop(); }, 20 * 60 * 1000);
    const cleanup = () => { clearTimeout(timer); signal.removeEventListener('abort', stop); };
    const collect = (chunk: Buffer) => {
      const text = chunk.toString(); output = (output + text).slice(-12000);
      const matches = [...text.matchAll(/(\d{1,3})%/g)];
      if (matches.length) progress = Math.min(100, Number(matches.at(-1)![1]));
    };
    child.stdout.on('data', collect); child.stderr.on('data', collect);
    child.on('error', error => { cleanup(); reject(error); });
    child.on('close', code => {
      cleanup();
      if (signal.aborted) reject(new Error('已取消安装'));
      else if (timedOut) reject(new Error('安装超时，请检查网络后重试'));
      else if (code === 0) resolveRun(output);
      else reject(new Error(`安装命令失败 (${code})：${output.slice(-1600)}`));
    });
  });
}
async function install(signal: AbortSignal) {
  await mkdir(root, { recursive: true });
  const lock = join(root, 'install.lock');
  try { await mkdir(lock); } catch {
    let pid = 0;
    try { pid = Number(await readFile(join(lock, 'pid'), 'utf8')); } catch { /* Another process may be acquiring the lock. */ }
    let alive = true;
    if (!pid) { try { alive = Date.now() - (await stat(lock)).mtimeMs < 60000; } catch { alive = false; } }
    if (pid) { try { process.kill(pid, 0); } catch (e) { alive = (e as NodeJS.ErrnoException).code !== 'ESRCH'; } }
    if (alive) throw new Error('另一个客户端正在安装，请稍后重试');
    await rm(lock, { recursive: true, force: true });
    await mkdir(lock);
  }
  await writeFile(join(lock, 'pid'), String(process.pid));
  const staging = join(root, `.install-${randomUUID()}`);
  try {
    signal.throwIfAborted();
    if (await installed()) { await setEnabled(true); return; }
    await mkdir(staging);
    const runtime = await createDefaultManagedRuntimeService().resolveNode();
    const require = createRequire(import.meta.url);
    const npmManifest = require.resolve('npm/package.json').replace('app.asar/', 'app.asar.unpacked/').replace('app.asar\\', 'app.asar.unpacked\\');
    const npmCli = join(npmManifest, '..', 'bin', 'npm-cli.js');
    const env = { ...runtime.env, PLAYWRIGHT_BROWSERS_PATH: join(staging, 'browsers'), PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD: '1', CI: '1', npm_config_update_notifier: 'false' };
    // Only the platform selected by the running client may be downloaded.
    delete (env as NodeJS.ProcessEnv).PLAYWRIGHT_HOST_PLATFORM_OVERRIDE;
    await writeFile(join(staging, 'package.json'), JSON.stringify({ private: true, dependencies: { '@playwright/test': VERSION } }));
    phase = 'packages'; message = '正在安装 Playwright 测试依赖'; progress = undefined;
    await run(runtime.executable, [npmCli, 'install', '--ignore-scripts', '--no-audit', '--no-fund', '--registry=https://registry.npmjs.org'], staging, env, signal);
    phase = 'browser'; message = `正在下载 ${key} 对应的 Chromium`; progress = undefined;
    const browserEnv = { ...env, PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD: '0' };
    // Do not use --with-deps: no privileged system package changes.
    await run(runtime.executable, [join(staging, 'node_modules/playwright/cli.js'), 'install', 'chromium'], staging, browserEnv, signal);
    phase = 'checking'; message = '正在检查安装文件'; progress = undefined;
    const probe = "const p=require('playwright');const fs=require('fs');const path=require('path');const e=p.chromium.executablePath();fs.accessSync(e);console.log(JSON.stringify({version:require('@playwright/test/package.json').version,browser:path.relative(process.cwd(),e)}));";
    const output = await run(runtime.executable, ['-e', probe], staging, browserEnv, signal);
    const marker = JSON.parse(output.trim().split('\n').at(-1)!);
    if (marker.version !== VERSION || !marker.browser.startsWith(`browsers${process.platform === 'win32' ? '\\' : '/'}`)) throw new Error('安装内容与目标版本不匹配');
    await writeFile(join(staging, 'ready.json'), JSON.stringify({ ...marker, platform: key }));
    signal.throwIfAborted();
    // Only replace an incomplete installation; ready environments are reused above.
    // Retain session scripts when repairing an incomplete installation.
    const projects = join(runtimeRoot, 'projects');
    try { await access(projects); await cp(projects, join(staging, 'projects'), { recursive: true }); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    try { await rename(runtimeRoot, `${runtimeRoot}.replaced-${randomUUID()}`); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    await rename(staging, runtimeRoot);
    signal.throwIfAborted();
    await setEnabled(true);
  } finally {
    await rm(staging, { recursive: true, force: true });
    await rm(lock, { recursive: true, force: true });
  }
}
export async function updateBrowserAutomation(on: boolean) {
  if (!on) {
    controller?.abort();
    if (job) await job;
    await setEnabled(false); message = ''; phase = 'idle';
    return browserAutomationStatus();
  }
  const reason = unsupported(); if (reason) throw new Error(reason);
  if (!job) {
    controller = new AbortController(); phase = 'checking'; message = '正在准备安装'; progress = undefined;
    job = install(controller.signal).then(() => { phase = 'ready'; message = '已就绪'; }).catch(error => {
      phase = 'error'; message = error instanceof Error ? error.message : String(error);
    }).finally(() => { job = undefined; controller = undefined; });
  }
  return browserAutomationStatus();
}

export async function browserAutomationContext(sessionId: string, artifactDir: string): Promise<string> {
  const status = await browserAutomationStatus();
  if (!status.enabled) return '受管 Web 自动化环境未开启或尚未就绪。如业务仓库也没有 Playwright，请提示用户在设置 → 电脑操控开启浏览器自动化，不要自行下载安装。';
  const workspace = join(runtimeRoot, 'projects', createHash('sha256').update(sessionId).digest('hex').slice(0, 24));
  await mkdir(workspace, { recursive: true });
  const config = join(workspace, 'playwright.config.cjs');
  const reportDir = join(artifactDir, 'web-automation');
  const configBody = `const {defineConfig}=require('@playwright/test');module.exports=defineConfig(${JSON.stringify({ testDir: './tests', outputDir: join(reportDir, 'results'), reporter: [['json', { outputFile: join(reportDir, 'results.json') }], ['html', { outputFolder: join(reportDir, 'html'), open: 'never' }]], use: { browserName: 'chromium', trace: 'retain-on-failure', screenshot: 'only-on-failure' } })});\n`;
  await writeFile(config, configBody, { flag: 'wx' }).catch(e => { if (e.code !== 'EEXIST') throw e; });
  const launcher = fileURLToPath(new URL('../../../../scripts/testing/run-managed-playwright.cjs', import.meta.url));
  return `可用受管 Playwright ${VERSION}（${key}），无需业务仓库安装依赖。优先复用仓库已有测试；仓库没有环境时，将真实 .spec.cjs 用例写入 ${JSON.stringify(join(workspace, 'tests'))}，可 require('@playwright/test')。配置 ${JSON.stringify(config)}，报告目录 ${JSON.stringify(reportDir)}。通过现有命令工具执行 node ${JSON.stringify(launcher)} ${JSON.stringify(runtimeRoot)} ${JSON.stringify(stateFile)} ${JSON.stringify(workspace)}。Windows 使用参数数组或 PowerShell 的正确参数引用，不使用 POSIX 环境变量语法。该入口检查开关、设置匹配浏览器路径并执行 playwright test；无需 MCP/Jenkins。不运行 npm install，不使用空断言或跳过用例代替通过。多端角色使用独立 browser context。只有用户授权测试后才执行，完成后交付原始报告和证据。关闭开关禁止新的受管执行，已运行任务继续完成。`;
}
