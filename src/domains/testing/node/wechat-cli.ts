import { access, realpath, stat } from 'node:fs/promises';
import { constants } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';

/** Locate files only; never execute a discovered CLI. */
export async function detectWechatCli() {
  const platform = process.platform;
  if (platform !== 'darwin' && platform !== 'win32') return { paths: [], message: '当前系统不支持本地微信开发者工具，请在 macOS 或 Windows 上配置。' };
  const candidates: string[] = [];
  if (platform === 'darwin') {
    for (const root of ['/Applications', path.join(homedir(), 'Applications')]) {
      for (const name of ['wechatwebdevtools.app', '微信开发者工具.app']) candidates.push(path.join(root, name, 'Contents', 'MacOS', 'cli'));
    }
  } else {
    const roots = [process.env.ProgramFiles, process.env['ProgramFiles(x86)'], process.env.LOCALAPPDATA, process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Programs')];
    for (const root of roots) {
      if (!root || !path.isAbsolute(root)) continue;
      for (const name of ['微信web开发者工具', '微信开发者工具', 'wechatwebdevtools']) {
        candidates.push(path.join(root, 'Tencent', name, 'cli.bat'), path.join(root, name, 'cli.bat'));
      }
    }
  }
  for (const entry of (process.env.PATH || '').split(path.delimiter).slice(0, 256)) {
    const directory = entry.replace(/^"|"$/g, '');
    if (path.isAbsolute(directory)) candidates.push(path.join(directory, platform === 'win32' ? 'cli.bat' : 'cli'));
  }
  const found = await Promise.all([...new Set(candidates)].map(async candidate => {
    try {
      if (!(await stat(candidate)).isFile()) return null;
      await access(candidate, platform === 'darwin' ? constants.X_OK : constants.R_OK);
      // Avoid unrelated generic CLI files on PATH: require the adjacent DevTools app.
      const resolved = await realpath(candidate);
      const app = platform === 'darwin' ? path.resolve(resolved, '../../..') : path.dirname(resolved);
      if (platform === 'darwin') {
        if (!(await stat(path.join(app, 'Contents', 'Resources', 'package.nw'))).isDirectory()) return null;
      } else if (!(await stat(path.join(app, 'wechatdevtools.exe'))).isFile()) return null;
      return resolved;
    } catch { return null; }
  }));
  const paths = [...new Set(found.filter((value): value is string => value !== null))];
  return { paths, message: paths.length ? '已找到本地 CLI 文件；登录状态与服务端口需在微信开发者工具中确认。' : '未在常见安装目录或 PATH 中找到微信开发者工具。请确认已安装，或手动填写自定义安装目录中的 CLI 文件路径。' };
}
