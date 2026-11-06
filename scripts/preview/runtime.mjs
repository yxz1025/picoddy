import { spawn, execFile } from 'node:child_process';
import { createRequire } from 'node:module';
import { realpath, readFile, stat } from 'node:fs/promises';
import { isAbsolute, relative, resolve, sep, win32 } from 'node:path';
import { connect } from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';

export async function inside(root, input) {
  if (typeof input !== 'string' || isAbsolute(input) || win32.isAbsolute(input) || input.replaceAll('\\', '/').split('/').some(s => s === '..' || s === '.git')) throw new Error('路径必须位于设计工作区');
  const base = await realpath(root), path = await realpath(resolve(base, input));
  const rel = relative(base, path);
  if (rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) throw new Error('路径越出设计工作区');
  return path;
}
export function commandSpec(file, args, platform = process.platform, comspec = process.env.ComSpec || 'cmd.exe') {
  if (platform !== 'win32') return { file, args, windowsVerbatimArguments: false };
  if (['npm', 'npx', 'pnpm', 'yarn', 'corepack'].includes(file.toLowerCase())) file += '.cmd';
  if (!/\.(cmd|bat)$/i.test(file)) return { file, args, windowsVerbatimArguments: false };
  // cmd expands % even inside quotes. For complex arguments use a checked-in script.
  if ([file, ...args].some(v => /["%\r\n\x00]/.test(v))) throw new Error('Windows 批处理参数不能含双引号、百分号或换行，请改用仓库脚本');
  const line = [file, ...args].map(v => `"${v}"`).join(' ');
  return { file: comspec, args: [`/d /v:off /s /c "${line}"`], windowsVerbatimArguments: true };
}
export async function stopTree(child) {
  if (!child?.pid) return;
  if (process.platform === 'win32') {
    if (child.exitCode !== null || child.signalCode !== null) return;
    await new Promise(done => execFile('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true, timeout: 5000 }, () => done()));
  } else {
    try { process.kill(-child.pid, 'SIGTERM'); } catch (e) { if (e.code !== 'ESRCH') throw e; }
    await delay(150);
    try { process.kill(-child.pid, 'SIGKILL'); } catch (e) { if (e.code !== 'ESRCH') throw e; }
  }
}
export function spawnCommand(command, cwd, log, env = process.env) {
  const spec = commandSpec(command.file, command.args);
  const childEnv = { ...env }; delete childEnv.ELECTRON_RUN_AS_NODE;
  const child = spawn(spec.file, spec.args, { cwd, env: childEnv, shell: false, windowsHide: true,
    windowsVerbatimArguments: spec.windowsVerbatimArguments, detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe'] });
  child.stdout.on('data', b => log(b.toString())); child.stderr.on('data', b => log(b.toString()));
  const exited = new Promise((done, reject) => { child.once('error', reject); child.once('exit', (code, signal) => done({ code, signal })); });
  // Attach a rejection listener immediately, even when callers first check a URL.
  exited.catch(() => {});
  return { child, exited };
}
export async function portOccupied(raw) {
  const url = new URL(raw);
  return new Promise(done => {
    const socket = connect({ host: url.hostname.replace(/^\[|\]$/g, ''), port: Number(url.port || (url.protocol === 'https:' ? 443 : 80)) });
    const finish = value => { socket.destroy(); done(value); };
    socket.once('connect', () => finish(true)); socket.once('error', () => finish(false)); socket.setTimeout(1000, () => finish(false));
  });
}
export async function waitForWeb(url, signal, timeout = 60000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    signal.throwIfAborted();
    try {
      const response = await fetch(url, { signal: AbortSignal.any([signal, AbortSignal.timeout(2000)]), redirect: 'error' });
      await response.body?.cancel();
      if (response.ok) return;
    } catch { /* Server may still be compiling; preserve the bounded deadline. */ }
    await delay(300, undefined, { signal });
  }
  throw new Error('预览地址 60 秒内未就绪，请检查启动命令、端口和入口');
}
export async function startPreview(request, options = {}) {
  const { target, scenarioId } = request;
  const root = await realpath(target.workspace.path), cwd = await inside(root, target.projectPath);
  const scenario = scenarioId === 'default' ? undefined : target.scenarios.find(s => s.id === scenarioId);
  if (scenarioId !== 'default' && !scenario) throw new Error('预览场景不存在');
  const require = createRequire(resolve(cwd, 'package.json'));
  const load = options.load || (name => require(name));
  const log = options.log || (() => {});
  const controller = new AbortController(); const signal = controller.signal;
  let closing = false, closePromise, browser, context, page, miniProgram, hooks;
  const processes = [];
  const bounded = async (fn, ms) => {
    let timer;
    try { return await Promise.race([Promise.resolve().then(fn), new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('运行环境清理超时')), ms); })]); }
    finally { clearTimeout(timer); }
  };
  const exitError = new Promise((_, reject) => { signal.addEventListener('abort', () => reject(signal.reason), { once: true }); });
  exitError.catch(() => {});
  async function close() {
    if (closePromise) return closePromise;
    closing = true; controller.abort(new Error('预览已停止'));
    closePromise = (async () => {
      const failures = [];
      for (const fn of [() => hooks?.cleanup?.(), () => context?.close(), () => browser?.close(), () => miniProgram?.close()]) {
        try { await bounded(fn, 2000); }
        catch (e) { failures.push(String(e)); }
      }
      for (const p of processes) { try { await stopTree(p.child); } catch (e) { failures.push(String(e)); } }
      if (failures.length) throw new Error(failures.join('\n'));
    })();
    return closePromise;
  }
  options.onSession?.({ close });
  try {
    signal.throwIfAborted();
    if (target.kind === 'web' && target.start && await portOccupied(target.webUrl)) throw new Error('预览端口已占用，请停止原服务或配置独立端口');
    signal.throwIfAborted();
    if (target.build) {
      log('执行仓库构建命令');
      const p = spawnCommand(target.build, cwd, log); processes.push(p);
      const timer = setTimeout(() => controller.abort(new Error('构建超过 120 秒')), 120000);
      try {
        const result = await Promise.race([p.exited, exitError]);
        if (result.code !== 0) throw new Error(`构建失败（退出码 ${result.code}）`);
      } finally { clearTimeout(timer); await stopTree(p.child); processes.splice(processes.indexOf(p), 1); }
    }
    signal.throwIfAborted();
    if (target.start) {
      const p = spawnCommand(target.start, cwd, log); processes.push(p);
      p.exited.then(r => { if (!closing) controller.abort(new Error(`开发服务已退出（${r.code}）`)); }, e => controller.abort(e));
    }
    if (scenario?.module) {
      hooks = require(await inside(root, scenario.module));
      if (typeof hooks.setup !== 'function') throw new Error('场景模块必须导出 setup 函数');
    }
    const entry = scenario?.entryPath || target.entryPath;
    if (target.kind === 'web') {
      await waitForWeb(target.webUrl, signal);
      let sdk;
      try { sdk = load('playwright'); } catch (e) {
        if (e.code !== 'MODULE_NOT_FOUND') throw e;
        try { sdk = load('@playwright/test'); } catch { throw new Error('工作区缺少 Playwright。请按仓库方式安装 playwright 或 @playwright/test 及浏览器'); }
      }
      // Only the test harness can request headless mode; the product always opens a visible browser.
      const browserEnv = { ...process.env }; delete browserEnv.ELECTRON_RUN_AS_NODE;
      browser = await sdk.chromium.launch({ headless: options.headless === true, env: browserEnv });
      if (closing) { await browser.close(); throw new Error('预览已停止'); }
      context = await browser.newContext({ viewport: target.viewport, serviceWorkers: 'block' });
      page = await context.newPage(); page.on('pageerror', e => log(`页面异常：${e.message}`));
      page.on('close', () => { if (!closing) controller.abort(new Error('预览页面已关闭')); });
      page.on('crash', () => { if (!closing) controller.abort(new Error('预览页面崩溃')); });
      browser.on('disconnected', () => { if (!closing) controller.abort(new Error('预览浏览器已关闭')); });
      const api = { page, context, baseURL: target.webUrl };
      await hooks?.setup?.(api);
      await page.goto(new URL(entry || target.webUrl, target.webUrl).href, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await hooks?.ready?.(api);
    } else {
      const projectPath = await inside(root, target.miniProjectPath);
      if (!(await stat(target.cliPath)).isFile()) throw new Error('微信 CLI 不存在');
      const config = JSON.parse(await readFile(resolve(projectPath, 'project.config.json'), 'utf8'));
      if (!config.appid || !config.projectname) throw new Error('小程序 project.config.json 缺少 appid 或 projectname');
      const miniRoot = await inside(projectPath, config.miniprogramRoot || '.');
      await readFile(resolve(miniRoot, 'app.json'));
      let sdk; try { sdk = load('miniprogram-automator'); } catch { throw new Error('工作区缺少 miniprogram-automator，请按仓库方式安装官方 SDK'); }
      miniProgram = await sdk.launch({ cliPath: target.cliPath, projectPath, timeout: 60000 });
      if (closing) { await miniProgram.close(); throw new Error('预览已停止'); }
      miniProgram.on?.('exception', error => log(`小程序异常：${error.message}`));
      const api = { miniProgram };
      await hooks?.setup?.(api);
      if (entry) await miniProgram.reLaunch(entry);
      await hooks?.ready?.(api);
    }
    signal.throwIfAborted();
    return { close, failure: exitError,
      async screenshot(path) { signal.throwIfAborted(); if (page) await page.screenshot({ path }); else await miniProgram.screenshot({ path }); },
    };
  } catch (e) { try { await close(); } catch (cleanup) { log(`清理异常：${cleanup}`); } throw e; }
}
