import { detectWechatCli } from './wechat-cli.ts';
import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { createTestingStore } from './store.ts';
import { importTestPackage } from './packages.ts';
import type { TestRun } from '../shared/contracts.ts';
import { checkLocal, collectLocal, localRequest, registerLocalConnector, type ToolLoader } from './local.ts';
import { createRepositoryStore } from '../../requirement/node/repositories.ts';
import { authoringContext, type AuthoringInputs } from './workflow.ts';

const inFlight = new Set<string>();
const tracking = new Map<string, ReturnType<typeof setTimeout>>();
export function testingService(db: DatabaseSync, root: string, account: string, space: string, load: ToolLoader, assertIdentity: () => void, inputs?: AuthoringInputs) {
  assertIdentity();
  const store = createTestingStore(db, account, space);
  function stop(id: string) {
    const timer = tracking.get(id);
    if (timer) clearTimeout(timer);
    tracking.delete(id);
  }
  function track(run: TestRun) {
    if (!run.localRequestHash || !['running', 'unknown'].includes(run.state) || tracking.has(run.id)) return;
    // Lazy tracking only: no startup hooks and no remote writes. Reopening the panel resumes it.
    if (Date.now() - run.createdAt > 24 * 60 * 60 * 1000) return;
    const timer = setTimeout(async () => {
      tracking.delete(run.id);
      try {
        assertIdentity();
        const current = store.run(run.id);
        if (!['running', 'unknown'].includes(current.state)) return;
        await service.action({ action: 'collect', runId: run.id });
      } catch {
        try {
          assertIdentity();
          const current = store.run(run.id);
          if (['running', 'unknown'].includes(current.state)) {
            const next = store.saveRun({ ...current, state: 'unknown', reason: '暂时无法读取执行器，将继续只读查询；不代表测试失败或通过' });
            track(next);
          }
        } catch { /* Sign-out or deleted requirement: cease tracking. */ }
      }
    }, 30000);
    timer.unref();
    tracking.set(run.id, timer);
  }
  const service = {
    snapshot() { assertIdentity(); const snapshot = store.snapshot(); snapshot.runs.forEach(track); return snapshot; },
    async action(body: any) {
      assertIdentity();
      if (body.action === 'detectWechatCli') {
        const result = await detectWechatCli(); assertIdentity(); return result;
      }
      if (body.action === 'authoring') {
        if (!inputs || inputs.discussionOnly) throw new Error('脚本生成需要本轮选中的需求输入，请在测试专家对话中使用');
        const result = await authoringContext(store.snapshot(), inputs, body.targetId);
        assertIdentity(); return result;
      }
      if (body.action === 'registerLocal') return registerLocalConnector(root, account, String(body.connector), assertIdentity);
      if (body.action === 'saveTarget') return store.saveTarget(body.target);
      if (body.action === 'importPackage') {
        const result = await importTestPackage(db, root, account, space, String(body.targetId), String(body.testSha), String(body.manifestPath), assertIdentity);
        assertIdentity(); return result;
      }
      if (body.action === 'validate') {
        const target = store.target(String(body.targetId));
        const repo = createRepositoryStore(db, account, space).list().find(r => r.id === target.repositoryId);
        if (!repo) throw new Error('目标仓库关联已解除');
        const result = await checkLocal(target, repo.root, load); assertIdentity(); return result;
      }
      if (body.action === 'prepareRun') {
        const pack = store.package(String(body.packageId));
        const target = store.target(pack.targetId);
        if (!target.connector) return { mode: 'direct-script', target, package: pack, message: '此目标使用本地脚本执行，不需要 MCP。请通过已有本地执行工具运行测试专家生成的脚本并交付真实报告；不要调用 local_start_test 或 collect，也不要将登记视为已执行。' };
        const run = store.createRun(String(body.packageId), String(body.businessSha || ''), String(body.sourceMessageId || 'user-interface'), String(body.requestId || randomUUID()));
        return { run, connector: run.target.connector, tool: 'local_start_test', request: localRequest(run), message: '已登记本地测试请求，尚未执行。通过本轮选择的本地 MCP 调用 local_start_test，再 collect 跟踪报告。不会构建部署或读取 Jenkins 报告。' };
      }
      if (body.action === 'closeRun') { stop(String(body.runId)); return store.closeRun(String(body.runId)); }
      if (body.action === 'collect') {
        const run = store.run(String(body.runId));
        if (inFlight.has(run.id)) { track(run); return run; }
        inFlight.add(run.id);
        try {
          const next = await collectLocal(run, load);
          assertIdentity();
          // A close operation while the remote read was pending must win.
          if (store.run(run.id).state === 'finished') return store.run(run.id);
          const saved = store.saveRun(next);
          stop(run.id); track(saved);
          return saved;
        } finally { inFlight.delete(run.id); }
      }
      throw new Error('未知测试操作');
    },
  };
  return service;
}
