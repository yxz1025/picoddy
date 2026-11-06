#!/usr/bin/env node
// Runs a session's standalone test project against the managed dependencies.
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const [runtimeArg, stateArg, workspaceArg] = process.argv.slice(2);
try {
  if (!runtimeArg || !stateArg || !workspaceArg) throw new Error('Missing managed runtime or test project');
  const root = fs.realpathSync(runtimeArg);
  const statePath = path.resolve(stateArg);
  if (statePath !== path.join(path.dirname(root), 'state.json')) throw new Error('Invalid managed state path');
  if (JSON.parse(fs.readFileSync(statePath, 'utf8')).enabled !== true) throw new Error('浏览器自动化已关闭，请在设置 → 电脑操控开启');
  const workspace = fs.realpathSync(workspaceArg);
  const relative = path.relative(path.join(root, 'projects'), workspace);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('Invalid test workspace');
  const marker = JSON.parse(fs.readFileSync(path.join(root, 'ready.json'), 'utf8'));
  if (marker.platform !== `${process.platform}-${process.arch}`) throw new Error('浏览器运行环境与当前平台不匹配');
  fs.accessSync(path.join(root, marker.browser));
  const env = { ...process.env, PLAYWRIGHT_BROWSERS_PATH: path.join(root, 'browsers'), PLAYWRIGHT_HTML_OPEN: 'never' };
  delete env.PLAYWRIGHT_HOST_PLATFORM_OVERRIDE;
  const child = spawn(process.execPath, [path.join(root, 'node_modules/playwright/cli.js'), 'test', '--config', path.join(workspace, 'playwright.config.cjs')], { cwd: workspace, env, shell: false, stdio: 'inherit', windowsHide: true });
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
  child.on('error', error => { console.error(error.message); process.exitCode = 1; });
  child.on('exit', (code, signal) => { process.exitCode = code ?? (signal ? 130 : 1); });
} catch (error) { console.error(error.message); process.exitCode = 1; }
