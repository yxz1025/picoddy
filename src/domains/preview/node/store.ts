import { randomUUID } from 'node:crypto';
import { isAbsolute, win32 } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { createRepositoryStore, stageIndex } from '../../requirement/node/repositories.ts';
import { activePreviewStates, type PreviewCommand, type PreviewRun, type PreviewTarget } from '../shared/contracts.ts';

function text(value: unknown, label: string, max = 1000): string {
  if (typeof value !== 'string' || value.length > max || /[\x00-\x1f]/.test(value)) throw new Error(`${label}无效`);
  return value.trim();
}
export function relativePath(value: unknown, label = '项目目录'): string {
  const p = text(value, label).replaceAll('\\', '/');
  if (!p || isAbsolute(p) || win32.isAbsolute(p) || p.includes(':') || p.split('/').some(s => s === '..' || s === '.git')) throw new Error(`${label}必须为工作区内相对路径`);
  return p;
}
function command(value: any): PreviewCommand | undefined {
  if (value === undefined || value === null) return undefined;
  const file = text(value.file, '可执行文件');
  if (!file || !Array.isArray(value.args) || value.args.length > 100) throw new Error('命令必须提供可执行文件与参数数组');
  // Do not trim arguments: whitespace can carry meaning to the repository's command.
  const args = value.args.map((v: unknown) => { text(v, '命令参数', 4000); return v as string; });
  if (JSON.stringify(args).length > 16000) throw new Error('命令参数过长');
  return { file, args };
}
export function localWebUrl(value: string): string {
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol) || !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) || url.username || url.password) throw new Error('Web 预览地址必须为本机 HTTP(S) 地址');
  return url.href;
}
export function validateTarget(input: any): Omit<PreviewTarget, 'id' | 'revision' | 'workspace'> {
  if (!input || stageIndex(input.stageKey || '') < 0) throw new Error('预览阶段无效');
  if (!['web', 'wechat-mini'].includes(input.kind)) throw new Error('预览平台无效');
  const name = text(input.name, '名称', 100); if (!name) throw new Error('请填写预览名称');
  const projectPath = relativePath(input.projectPath);
  const design = { url: text(input.design?.url ?? '', '设计链接', 2000), version: text(input.design?.version ?? '', '设计版本', 500), server: text(input.design?.server ?? '', 'Figma MCP', 100) };
  if (design.url) {
    const u = new URL(design.url);
    if (u.protocol !== 'https:' || !['figma.com', 'www.figma.com'].includes(u.hostname) || u.username || u.password) throw new Error('请填写 Figma HTTPS 设计链接');
  }
  const entryPath = text(input.entryPath || '', '入口');
  function validateEntry(entry: string) {
    if (input.kind === 'web') {
      if (new URL(entry || '.', localWebUrl(input.webUrl)).origin !== new URL(input.webUrl).origin) throw new Error('场景入口必须属于预览地址');
    } else if (entry && (!entry.startsWith('/') || entry.startsWith('//') || entry.includes('://'))) throw new Error('小程序入口应为 /pages/... 路由');
  }
  validateEntry(entryPath);
  if (!Array.isArray(input.scenarios) || input.scenarios.length > 30) throw new Error('场景列表无效，最多 30 个');
  const ids = new Set<string>();
  const scenarios = input.scenarios.map((s: any) => {
    const id = text(s.id, '场景标识', 80), name = text(s.name, '场景名称', 100);
    if (!/^[a-zA-Z0-9_-]+$/.test(id) || ids.has(id) || id === 'default' || !name) throw new Error('场景标识需唯一且不能为 default');
    ids.add(id);
    const entryPath = text(s.entryPath || '', '场景入口'); validateEntry(entryPath);
    const module = s.module ? relativePath(s.module, '场景模块') : '';
    if (module && !module.endsWith('.cjs')) throw new Error('场景模块使用 .cjs 文件');
    return { id, name, entryPath, module };
  });
  const width = input.viewport?.width ?? 1280, height = input.viewport?.height ?? 800;
  if (![width, height].every(n => Number.isInteger(n) && n >= 240 && n <= 3840)) throw new Error('视口尺寸须为 240 至 3840 的整数');
  const cliPath = text(input.cliPath || '', 'CLI 路径');
  if (input.kind === 'wechat-mini' && (!cliPath || !isAbsolute(cliPath))) throw new Error('请填写本机微信 CLI 绝对路径');
  return { stageKey: input.stageKey, name, repositoryId: text(input.repositoryId, '仓库标识'), kind: input.kind,
    projectPath, build: command(input.build), start: command(input.start), webUrl: input.kind === 'web' ? localWebUrl(input.webUrl) : '',
    viewport: { width, height }, cliPath, miniProjectPath: relativePath(input.miniProjectPath || '.', '小程序输出目录'), entryPath, design, scenarios };
}
export function createPreviewStore(db: DatabaseSync, account: string, space: string) {
  const repos = createRepositoryStore(db, account, space);
  db.exec(`CREATE TABLE IF NOT EXISTS requirement_preview_targets(id TEXT PRIMARY KEY, space_id TEXT NOT NULL, data TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS requirement_preview_runs(id TEXT PRIMARY KEY, space_id TEXT NOT NULL, data TEXT NOT NULL);`);
  const targets = (): PreviewTarget[] => db.prepare('SELECT data FROM requirement_preview_targets WHERE space_id=? ORDER BY rowid').all(space).map(r => JSON.parse(String(r.data)));
  // Keep every active run visible even if other targets produce many recent runs.
  const runs = (): PreviewRun[] => db.prepare(`SELECT data FROM requirement_preview_runs WHERE space_id=? AND (
    json_extract(data,'$.state') IN ('starting','ready','stopping') OR id IN (
      SELECT id FROM requirement_preview_runs WHERE space_id=? ORDER BY rowid DESC LIMIT 50)) ORDER BY rowid DESC`).all(space, space).map(r => JSON.parse(String(r.data)));
  const target = (id: string) => { const row = targets().find(r => r.id === id); if (!row) throw new Error('预览目标不属于本需求'); return row; };
  const run = (id: string): PreviewRun => { const row = db.prepare('SELECT data FROM requirement_preview_runs WHERE id=? AND space_id=?').get(id, space); if (!row) throw new Error('预览运行不属于本需求'); return JSON.parse(String(row.data)); };
  function putTarget(value: PreviewTarget) { db.prepare('INSERT INTO requirement_preview_targets VALUES (?,?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data WHERE space_id=excluded.space_id').run(value.id, space, JSON.stringify(value)); return value; }
  return { targets, runs, target, run,
    saveTarget(input: any) {
      const value = validateTarget(input);
      if (!repos.list().some(r => r.id === value.repositoryId)) throw new Error('仓库不属于本需求');
      const previous = input.id ? target(input.id) : undefined;
      if (previous && runs().some(r => r.target.id === previous.id && activePreviewStates.includes(r.state))) throw new Error('请先停止此目标的预览');
      return putTarget({ ...value, id: previous?.id || randomUUID(), revision: (previous?.revision || 0) + 1 });
    },
    setWorkspace(id: string, workspace: PreviewTarget['workspace']) { return putTarget({ ...target(id), workspace }); },
    remove(id: string) {
      target(id);
      if (runs().some(r => r.target.id === id && activePreviewStates.includes(r.state))) throw new Error('请先停止预览');
      db.prepare('DELETE FROM requirement_preview_targets WHERE id=? AND space_id=?').run(id, space);
    },
    saveRun(value: PreviewRun) {
      value = { ...value, updatedAt: Date.now(), logs: value.logs.slice(-100).map(s => s.slice(0, 2000)) };
      db.prepare('INSERT INTO requirement_preview_runs VALUES (?,?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data WHERE space_id=excluded.space_id').run(value.id, space, JSON.stringify(value));
      return value;
    },
  };
}
