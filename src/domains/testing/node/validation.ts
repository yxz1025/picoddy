import { createHash } from 'node:crypto';
import type { CaseAttempt, DeploymentManifest, TestRun, TestSummary, Verdict } from '../shared/contracts.ts';
export const digest = (data: string | Uint8Array) => createHash('sha256').update(data).digest('hex');
export function text(value: unknown, label: string, max = 250): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max || /[\x00-\x1f]/.test(value)) throw new Error(`${label}无效`);
  return value.trim();
}
export function sha(value: unknown): string {
  if (typeof value !== 'string' || !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(value)) throw new Error('需要完整 Git SHA');
  return value;
}
export function relativeFile(value: unknown): string {
  const path = text(value, '仓库相对路径', 500);
  if (/^[-\\/]|^[A-Za-z]:|\\/.test(path) || path.split('/').some(p => !p || p === '..' || p === '.' || p === '.git')) throw new Error('路径必须是仓库内相对文件路径');
  return path;
}
export function httpUrl(value: unknown): string {
  const url = new URL(text(value, 'URL', 2000));
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.hash) throw new Error('需要不包含凭据的 HTTP(S) URL');
  return url.href;
}
/** Reconstruct results from the framework report, independently of the summary writer. */
export function verifyRawReport(run: TestRun, report: any, summary: TestSummary): boolean {
  const attempts: CaseAttempt[] = [];
  const ids = new Set(run.package.cases.filter(c => c.automation === 'automated').map(c => c.id));
  const statuses: Record<string, CaseAttempt['status']> = { passed: 'passed', failed: 'failed', timedOut: 'timeout', skipped: 'skipped', interrupted: 'error' };
  let count = 0;
  function visit(suite: any, depth: number) {
    if (++count > 20000 || depth > 100 || !suite || !Array.isArray(suite.specs || []) || !Array.isArray(suite.suites || [])) throw new Error('无效报告');
    for (const spec of suite.specs || []) {
      const matched = [...String(spec.title).matchAll(/\[([A-Za-z0-9_-]+)\]/g)].map(m => m[1]).filter(id => ids.has(id));
      if (matched.length !== 1 || !Array.isArray(spec.tests)) throw new Error('用例映射不唯一');
      for (const test of spec.tests) {
        if (!Array.isArray(test.results)) throw new Error('缺少执行结果');
        for (const result of test.results) {
          if (!statuses[result.status] || attempts.length >= 20000) throw new Error('无效执行状态');
          attempts.push({ caseId: matched[0], attempt: result.retry, status: statuses[result.status], durationMs: result.duration });
        }
      }
    }
    for (const child of suite.suites || []) visit(child, depth + 1);
  }
  try {
    if (!report?.stats || !Array.isArray(report.suites) || !Array.isArray(report.errors || [])) return false;
    for (const suite of report.suites) visit(suite, 0);
    const canonical = (rows: CaseAttempt[]) => JSON.stringify(rows.map(r => [r.caseId, r.attempt, r.status, r.durationMs]).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))));
    return canonical(attempts) === canonical(summary.attempts) && summary.cleanup === (report.errors?.length ? 'failed' : 'passed');
  } catch { return false; }
}
/** Validate remote evidence against the frozen request, never model prose. */
export function evaluateReport(run: TestRun, deployment: DeploymentManifest, summary: TestSummary): { verdict: Verdict; reason: string } {
  const invalid = (reason: string) => ({ verdict: 'invalid' as const, reason });
  if (deployment?.schemaVersion !== 1 || summary?.schemaVersion !== 1) return invalid('报告协议版本不支持');
  for (const evidence of [deployment, summary]) {
    if (evidence.requestId !== run.id || evidence.businessSha !== run.businessSha || evidence.targetId !== run.target.id || evidence.environment !== run.target.environment) return invalid('报告不属于本次请求、目标或代码版本');
  }
  const needsVersion = run.target.kind === 'wechat-mini' || Boolean(run.target.versionUrl);
  if (needsVersion && (deployment.deployedSha !== run.businessSha || summary.versionBefore !== run.businessSha || summary.versionAfter !== run.businessSha)) return invalid('版本不匹配或测试期间被替换');
  if (run.target.kind !== 'wechat-mini') {
    if (summary.baseUrl !== run.target.baseUrl || summary.entryUrl !== new URL(run.target.entryPath || run.target.baseUrl, run.target.baseUrl).href) return invalid('报告测试地址与配置不一致');
    if (summary.versionVerified !== Boolean(run.target.versionUrl)) return invalid('部署版本核验标记不匹配');
  }
  const expectedMode = run.target.kind === 'wechat-mini' ? 'mini-devtools' : 'browser';
  if (summary.packageHash !== run.package.hash || summary.testSha !== run.package.testSha || summary.mode !== expectedMode) return invalid('测试包、脚本版本或执行模式不匹配');
  if (expectedMode === 'mini-devtools' && (!/^[a-f0-9]{64}$/.test(summary.projectHashBefore || '') || summary.projectHashBefore !== summary.projectHashAfter)) return invalid('本地小程序构建在执行中发生变化或缺少构建指纹');
  const cases = run.package.cases;
  const planned = cases.filter(c => c.automation === 'automated').map(c => c.id).sort();
  if (!Array.isArray(summary.plannedCaseIds) || new Set(summary.plannedCaseIds).size !== summary.plannedCaseIds.length || JSON.stringify([...summary.plannedCaseIds].sort()) !== JSON.stringify(planned)) return invalid('计划用例集合不匹配');
  if (!Array.isArray(summary.attempts) || summary.attempts.length > 20000 || !Number.isInteger(summary.exitCode)) return invalid('执行报告格式无效');
  const groups = new Map<string, typeof summary.attempts>();
  for (const row of summary.attempts) {
    if (!row || !planned.includes(row.caseId) || !Number.isInteger(row.attempt) || row.attempt < 0 || row.attempt > 1 || !['passed', 'failed', 'error', 'timeout', 'skipped', 'blocked', 'not_run'].includes(row.status) || !Number.isFinite(row.durationMs) || row.durationMs < 0) return invalid('存在未知用例或无效执行记录');
    const rows = groups.get(row.caseId) || [];
    if (rows.some(r => r.attempt === row.attempt)) return invalid('执行记录重复');
    groups.set(row.caseId, [...rows, row]);
  }
  if (summary.cleanup !== 'passed') return { verdict: 'incomplete', reason: '测试数据清理未完成' };
  let flaky = false;
  for (const [id, rows] of groups) {
    rows.sort((a, b) => a.attempt - b.attempt);
    if (rows.some((r, i) => r.attempt !== i)) return invalid('尝试序号不连续');
    const last = rows.at(-1)!;
    if (['failed', 'error', 'timeout'].includes(last.status)) return { verdict: 'failed', reason: `用例 ${id} 执行失败` };
    if (last.status === 'passed' && rows.some(r => r.status !== 'passed')) flaky = true;
  }
  if (!planned.length || !summary.attempts.some(a => a.status === 'passed') || cases.some(c => c.required && (c.automation !== 'automated' || groups.get(c.id)?.at(-1)?.status !== 'passed')) || planned.some(id => !groups.has(id))) return { verdict: 'incomplete', reason: '必测项未通过、用例未执行或自动化覆盖不足' };
  if (summary.exitCode !== 0) return { verdict: 'failed', reason: '测试进程异常退出' };
  if (flaky) return { verdict: 'flaky', reason: '存在重试后通过的用例，需要处理不稳定性' };
  return { verdict: 'passed', reason: needsVersion ? '本次必测用例通过，版本与报告核验一致' : '本次页面必测用例通过；未核验部署版本' };
}
