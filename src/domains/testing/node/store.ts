import { randomUUID } from 'node:crypto';
import { isAbsolute } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { targetKinds, type TestPackage, type TestRun, type TestTarget, type TestingSnapshot } from '../shared/contracts.ts';
import { httpUrl, text, sha, relativeFile } from './validation.ts';

export function createTestingStore(db: DatabaseSync, accountId: string, spaceId: string) {
  function owner() {
    if (!accountId || !db.prepare('SELECT id FROM requirement_spaces WHERE id=? AND account_id=?').get(spaceId, accountId)) throw new Error('需求不存在或无权访问');
  }
  owner();
  db.exec(`CREATE TABLE IF NOT EXISTS test_targets(id TEXT PRIMARY KEY, space_id TEXT NOT NULL, data TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS test_packages(id TEXT PRIMARY KEY, space_id TEXT NOT NULL, data TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS test_runs(id TEXT PRIMARY KEY, space_id TEXT NOT NULL, data TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS test_run_events(id TEXT PRIMARY KEY, run_id TEXT NOT NULL, created_at INTEGER NOT NULL, data TEXT NOT NULL);`);
  function list<T>(table: 'test_targets' | 'test_packages' | 'test_runs'): T[] {
    owner();
    return db.prepare(`SELECT data FROM ${table} WHERE space_id=? ORDER BY rowid DESC LIMIT 500`).all(spaceId).map(r => JSON.parse(String(r.data)));
  }
  function get<T>(table: 'test_targets' | 'test_packages' | 'test_runs', id: string): T {
    owner();
    const row = db.prepare(`SELECT data FROM ${table} WHERE id=? AND space_id=?`).get(id, spaceId);
    if (!row) throw new Error('测试记录不存在或不属于当前需求');
    return JSON.parse(String(row.data));
  }
  function saveRun(run: TestRun) {
    owner(); get<TestRun>('test_runs', run.id);
    run.updatedAt = Date.now();
    db.prepare('UPDATE test_runs SET data=? WHERE id=? AND space_id=?').run(JSON.stringify(run), run.id, spaceId);
    db.prepare('INSERT INTO test_run_events VALUES (?,?,?,?)').run(randomUUID(), run.id, Date.now(), JSON.stringify({ state: run.state, verdict: run.verdict, reason: run.reason, reportHash: run.reportHash }));
    return run;
  }
  return {
    snapshot(): TestingSnapshot { return { targets: list<TestTarget>('test_targets'), packages: list<TestPackage>('test_packages'), runs: list<TestRun>('test_runs') }; },
    target: (id: string) => get<TestTarget>('test_targets', id),
    package: (id: string) => get<TestPackage>('test_packages', id),
    run: (id: string) => get<TestRun>('test_runs', id),
    saveTarget(input: Omit<TestTarget, 'revision'>) {
      owner();
      const previous = input.id ? get<TestTarget>('test_targets', input.id) : undefined;
      if (!targetKinds.includes(input.kind)) throw new Error('不支持的目标类型');
      if (!db.prepare('SELECT id FROM requirement_repositories WHERE id=? AND space_id=?').get(input.repositoryId, spaceId)) throw new Error('请先关联本需求代码仓库');
      if (input.kind === 'wechat-mini' && (!input.mini || !isAbsolute(input.mini.cliPath) || !/^wx[a-fA-F0-9]{16}$/.test(input.mini.appId))) throw new Error('请填写开发者工具绝对路径和有效微信 AppID');
      const target: TestTarget = {
        id: previous?.id || randomUUID(), name: text(input.name, '名称'), repositoryId: input.repositoryId, kind: input.kind,
        connector: input.connector?.trim() ? text(input.connector, '本地测试连接器') : '', environment: text(input.environment?.trim() || 'test', '测试环境'),
        baseUrl: input.kind === 'wechat-mini' ? '' : httpUrl(input.baseUrl),
        entryPath: input.kind === 'wechat-mini' ? '' : String(input.entryPath || '').trim(),
        versionUrl: input.kind === 'wechat-mini' || !input.versionUrl?.trim() ? '' : httpUrl(input.versionUrl),
        versionField: input.kind === 'wechat-mini' || !input.versionUrl?.trim() ? '' : text(input.versionField, '版本字段'),
        revision: (previous?.revision || 0) + 1,
        ...(input.kind === 'wechat-mini' ? { mini: { projectPath: input.mini!.projectPath === '.' ? '.' : relativeFile(input.mini!.projectPath), cliPath: text(input.mini!.cliPath, '开发者工具 CLI 路径', 2000), appId: input.mini!.appId } } : {}),
      };
      if (target.kind !== 'wechat-mini') {
        const entry = new URL(target.entryPath || target.baseUrl, target.baseUrl);
        if (entry.origin !== new URL(target.baseUrl).origin || entry.username || entry.password) throw new Error('入口路径必须属于配置的测试域名');
      }
      db.prepare('INSERT INTO test_targets VALUES (?,?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data WHERE space_id=excluded.space_id').run(target.id, spaceId, JSON.stringify(target));
      return target;
    },
    addPackage(value: Omit<TestPackage, 'id' | 'createdAt'>) {
      owner(); get<TestTarget>('test_targets', value.targetId);
      const existing = list<TestPackage>('test_packages').find(p => p.targetId === value.targetId && p.testSha === value.testSha && p.hash === value.hash);
      if (existing) return existing;
      const record: TestPackage = { ...value, id: randomUUID(), createdAt: Date.now() };
      db.prepare('INSERT INTO test_packages VALUES (?,?,?)').run(record.id, spaceId, JSON.stringify(record));
      return record;
    },
    createRun(packageId: string, businessSha: string, messageId: string, requestKey: string) {
      owner(); if (businessSha) sha(businessSha); text(messageId, '授权来源'); text(requestKey, '请求标识');
      const pack = get<TestPackage>('test_packages', packageId);
      const target = get<TestTarget>('test_targets', pack.targetId);
      if (target.repositoryId !== pack.repositoryId) throw new Error('目标仓库已变化，请重新登记测试包');
      if (target.kind === 'wechat-mini' && (!target.mini || pack.testSha !== businessSha)) throw new Error('本地小程序需要完整执行配置，业务代码和测试脚本必须处于同一提交');
      if (target.versionUrl && !businessSha) throw new Error('已配置版本校验，请提供预期部署的完整 SHA');
      const id = `${requestKey}`;
      const previous = db.prepare('SELECT data FROM test_runs WHERE id=?').get(id);
      if (previous) {
        const run = get<TestRun>('test_runs', id);
        if (run.package.id !== packageId || run.businessSha !== businessSha || run.sourceMessageId !== messageId) throw new Error('请求标识已用于其他测试');
        return run;
      }
      const activeRow = db.prepare("SELECT data FROM test_runs WHERE space_id=? AND json_extract(data, '$.target.id')=? AND json_extract(data, '$.state')!='finished' LIMIT 1").get(spaceId, target.id);
      const active = activeRow ? JSON.parse(String(activeRow.data)) as TestRun : undefined;
      if (active) throw new Error(`此目标已有待处理运行 ${active.id}，请先核对结果或结束记录`);
      const run: TestRun = { id, package: pack, target, businessSha, sourceMessageId: messageId, createdAt: Date.now(), updatedAt: Date.now(), state: 'ready' };
      {
        const repo = db.prepare('SELECT data FROM requirement_repositories WHERE id=? AND space_id=?').get(target.repositoryId, spaceId);
        if (!repo) throw new Error('目标仓库关联已解除');
        run.repositoryRoot = JSON.parse(String(repo.data)).root;
      }
      db.prepare('INSERT INTO test_runs VALUES (?,?,?)').run(id, spaceId, JSON.stringify(run));
      return saveRun(run);
    },
    saveRun,
    closeRun(id: string) {
      const run = get<TestRun>('test_runs', id);
      if (run.state === 'finished') return run;
      return saveRun({ ...run, state: 'finished', verdict: 'incomplete', reason: '用户结束本地跟踪；不取消远端构建，不代表测试通过' });
    },
  };
}
