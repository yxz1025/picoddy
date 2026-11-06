import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { TestRun, TestTarget, TestSummary, CaseAttempt } from '../shared/contracts.ts';
import type { AgentTool } from '@earendil-works/pi-agent-core';
import { digest, evaluateReport, verifyRawReport } from './validation.ts';
export type ToolLoader = (connector: string) => Promise<AgentTool<any>[]>;

export async function registerLocalConnector(root: string, account: string, name: string, assertIdentity: () => void) {
  if (!/^[a-zA-Z0-9_-]{1,80}$/.test(name)) throw new Error('连接器名称只允许字母、数字、下划线和短横线');
  const { mcpConfigStore } = await import('../../../agent/mcp_config.ts');
  const entry = { type: 'stdio', command: process.execPath, args: [fileURLToPath(new URL('../../../../scripts/testing/local-mcp.mjs', import.meta.url))],
    env: { ELECTRON_RUN_AS_NODE: '1', PICODDY_TEST_RESULTS_ROOT: join(root, 'testing-local', digest(account)) },
    displayName: '本地自动化测试', description: 'Playwright / 微信开发者工具；只在显式调用时执行测试' };
  await mcpConfigStore.update(config => {
    assertIdentity();
    if (config.mcpServers[name] && JSON.stringify(config.mcpServers[name]) !== JSON.stringify(entry)) throw new Error('已有同名连接器，请换一个名称，避免覆盖原配置');
    config.mcpServers[name] = entry;
  });
  return { message: '已登记本地 MCP。请在聊天中选择此连接器；尚未安装 SDK、打开开发者工具或执行测试。' };
}
export function localRequest(run: TestRun) {
  return { id: run.id, target: run.target, package: run.package, businessSha: run.businessSha, repositoryRoot: run.repositoryRoot };
}
async function readTool(target: TestTarget, load: ToolLoader, toolName: string, args: object) {
  const tools = await load(target.connector);
  const tool = tools.find(t => t.name === `mcp_${target.connector}_${toolName}`);
  if (!tool) throw new Error(`本地 MCP 缺少 ${toolName}，请登记并选择本地测试连接器`);
  const controller = new AbortController(); let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const result: any = await Promise.race([tool.execute(randomUUID(), args, controller.signal), new Promise((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(new Error('本地执行器读取超时')); }, 30000); })]);
    const raw = result.content?.filter((v: any) => v.type === 'text').map((v: any) => v.text).join('\n');
    if (typeof raw !== 'string' || raw.length > 10 * 1024 * 1024 || result.isError) throw new Error('本地执行器返回错误或报告过大');
    const data = JSON.parse(raw);
    if (data.error) throw new Error(String(data.error));
    return data;
  } finally { if (timer) clearTimeout(timer); }
}
export async function checkLocal(target: TestTarget, repositoryRoot: string, load: ToolLoader) {
  return readTool(target, load, 'local_check_environment', { target, repositoryRoot });
}
export async function collectLocal(run: TestRun, load: ToolLoader): Promise<TestRun> {
  if (run.state === 'finished') return run;
  const data = await readTool(run.target, load, 'local_get_test_run', { runId: run.id });
  const requestHash = digest(JSON.stringify(localRequest(run)));
  if (data.requestHash !== requestHash) throw new Error('执行器请求与本地冻结版本不一致');
  if (data.state !== 'finished') return { ...run, localRequestHash: requestHash, state: data.state === 'running' ? 'running' : 'unknown', reason: data.message || '本地执行中', outputDir: data.outputDir };
  const summary = data.summary as TestSummary;
  const deployment = { schemaVersion: 1 as const, requestId: run.id, businessSha: run.businessSha, deployedSha: run.businessSha, targetId: run.target.id, environment: run.target.environment };
  const verdict = evaluateReport(run, deployment, summary);
  const invalid = (reason: string): TestRun => ({ ...run, state: 'blocked', verdict: 'invalid', reason });
  if (verdict.verdict === 'invalid') return invalid(verdict.reason);
  if (data.canonicalRawHash !== digest(JSON.stringify(data.rawReport)) || data.summary.rawReportHash !== data.rawHash) return invalid('原始报告哈希不匹配');
  if (run.target.kind !== 'wechat-mini') {
    if (!verifyRawReport(run, data.rawReport, summary)) return invalid('Playwright 汇总与原始报告不一致');
    return { ...run, state: 'finished', ...verdict, attempts: summary.attempts, localRequestHash: requestHash, reportHash: digest(JSON.stringify(summary)), outputDir: data.outputDir };
  }
  if (data.rawReport?.framework !== 'node:test' || !Array.isArray(data.rawReport.events) || !Array.isArray(data.rawReport.errors)) return invalid('Node 原始报告格式不匹配');
  const ids = new Set(run.package.cases.filter(c => c.automation === 'automated').map(c => c.id));
  const attempts: CaseAttempt[] = data.rawReport.events.filter((e: any) => ids.has(e.name)).map((e: any) => ({ caseId: e.name, attempt: 0, status: e.skip || e.todo ? 'skipped' : e.type === 'test:pass' ? 'passed' : 'failed', durationMs: e.durationMs }));
  const canonical = (rows: CaseAttempt[]) => JSON.stringify(rows.map(r => [r.caseId, r.attempt, r.status, r.durationMs]).sort());
  if (canonical(attempts) !== canonical(summary.attempts) || (data.rawReport.errors.length > 0 && summary.cleanup === 'passed')) return invalid('汇总与 Node 原始报告不一致');
  return { ...run, state: 'finished', ...verdict, attempts: summary.attempts, localRequestHash: requestHash, reportHash: digest(JSON.stringify(summary)), outputDir: data.outputDir };
}
