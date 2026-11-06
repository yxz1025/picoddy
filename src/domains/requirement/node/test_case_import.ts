import { ensureRequirementCaseFolder } from './test_case_folder.ts';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import type { DatabaseSync } from 'node:sqlite';
import type { RequirementAsset } from './assets.ts';
import { readTestCaseWorkbook, type TestCase } from './test_case_workbook.ts';
import { tapdTestXRequest, type TapdRequirement } from '../../../integrations/tapd/requirements.ts';

export type CaseTarget = { repoId: string; versionId: string; folderId: string };
export type CaseDestination = CaseTarget & { label: string };
type Step = { Content: string; ExpectedResult: string };
type Issue = { IssueUid: string; IssueName: string; IssueUrl: string; WorkspaceUid: string; Type: 'STORY'; Source: 'TAPD' };
export type NativeTestCase = {
  Name: string; FolderUid: string; Priority: string; PreConditions: string; StepType: 'STEP' | 'TEXT';
  Steps: Step[]; StepText?: Step; Labels: Array<{ Name: string; Value: string; DisplayName: string }>;
  Issues: Issue[]; ManHourEstimated: string; RunTimes: string;
};
type RemoteCase = NativeTestCase & { Uid: string };
type Folder = { Uid: string; Name: string; FolderUid?: string; FullPath?: string; Folders?: Folder[] };
type Repo = { Uid: string; Name: string; Type?: string; Versions: Array<{ Uid: string; Name: string }> };
export type ImportReceipt = { row: number; name: string; state: 'creating' | 'created' | 'linked' | 'failed' | 'unknown'; id?: string; error?: string; reused?: boolean; target: CaseTarget; payload: NativeTestCase; key: string };
const locks = new Set<string>();
const pageSize = 20;
// Client-selected write size; TestX does not document a batch-create maximum.
const createBatchSize = 200;
const caseSearchPageSize = 200;
const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const repoPath = (workspaceId: string) => `api/testx/case/v1/namespaces/${encodeURIComponent(workspaceId)}/repos`;
const casesPath = (workspaceId: string, target: CaseTarget) => `${repoPath(workspaceId)}/${encodeURIComponent(target.repoId)}/versions/${encodeURIComponent(target.versionId)}/cases`;

async function listCaseRepos(workspaceId: string, request = tapdTestXRequest, fresh = false): Promise<Repo[]> {
  const repos: Repo[] = [];
  for (let offset = 0; ; offset += pageSize) {
    const batch = await request<Repo[]>('GET', repoPath(workspaceId), { 'PageInfo.Offset': offset, 'PageInfo.Limit': pageSize }, { cacheDirectory: true, fresh });
    if (!Array.isArray(batch)) throw new Error('TAPD 测试协调用例库返回格式无效');
    if (batch.some(repo => repos.some(previous => previous.Uid === repo.Uid))) throw new Error('用例库分页重复，无法完整读取上传目录');
    repos.push(...batch);
    if (batch.length < pageSize) break;
    if (offset >= 10000) throw new Error('用例库过多，无法完整读取');
  }
  return repos;
}

/** Resolve a root using repository metadata only; never enumerate folder trees. */
export async function resolveCaseRoot(workspaceId: string, request = tapdTestXRequest, previous?: CaseTarget): Promise<CaseTarget> {
  const repos = await listCaseRepos(workspaceId, request, true);
  if (previous) {
    if (!repos.some(repo => String(repo.Uid) === previous.repoId && repo.Versions?.some(version => String(version.Uid) === previous.versionId))) throw new Error('原上传用例库或版本已不可用，无法安全续传');
    return previous;
  }
  const defaults = repos.filter(repo => repo.Type === 'SYSTEM');
  const repo = defaults.length === 1 ? defaults[0] : !defaults.length && repos.length === 1 ? repos[0] : undefined;
  if (!repo) throw new Error('无法确定默认用例库，请在 TAPD 检查项目的默认用例库配置');
  const versions = repo.Versions || [];
  const masters = versions.filter(version => version.Name === 'master');
  const version = masters.length === 1 ? masters[0] : versions.length === 1 ? versions[0] : undefined;
  if (!version || !/^\d+$/.test(String(repo.Uid)) || !/^\d+$/.test(String(version.Uid))) throw new Error('默认用例库没有唯一可用的默认版本，请在 TAPD 检查版本配置');
  return { repoId: String(repo.Uid), versionId: String(version.Uid), folderId: '0' };
}

export async function listCaseDestinations(workspaceId: string, request = tapdTestXRequest, fresh = false): Promise<CaseDestination[]> {
  const repos = await listCaseRepos(workspaceId, request, fresh);
  const result: CaseDestination[] = [];
  for (const repo of repos) for (const version of repo.Versions || []) {
    const target = { repoId: String(repo.Uid), versionId: String(version.Uid), folderId: '0' };
    const prefix = `${repo.Name} / ${version.Name}`;
    result.push({ ...target, label: `${prefix} / 根目录` });
    const folders = new Map<string, Folder>();
    for (let offset = 0; ; offset += pageSize) {
      const batch = await request<{ Folders?: Folder[] }>('POST', `${casesPath(workspaceId, target)}/search`, {
        PageInfo: { Offset: offset, Limit: pageSize }, Filter: { ItemType: 'FOLDER' }, ShowMode: 'FLAT', IncludeDescendants: true,
      }, { cacheDirectory: true, fresh });
      if (!Array.isArray(batch.Folders)) throw new Error('TAPD 测试协同目录返回格式无效');
      const before = folders.size;
      function add(items: Folder[]) { for (const folder of items) { folders.set(String(folder.Uid), folder); if (folder.Folders) add(folder.Folders); } }
      add(batch.Folders);
      if (batch.Folders.length < pageSize) break;
      if (before === folders.size || offset >= 100000) throw new Error('目录分页未完整返回，无法安全选择上传目录');
    }
    function fullPath(folder: Folder, seen = new Set<string>()): string {
      if (seen.has(folder.Uid)) throw new Error('TAPD 目录存在循环引用');
      seen.add(folder.Uid);
      const parent = String(folder.FolderUid || '0');
      if (parent === '0') return folder.Name;
      const ancestor = folders.get(parent);
      if (!ancestor) {
        if (folder.FullPath) return `${folder.FullPath.replace(/^\/+|\/+$/g, '')}/${folder.Name}`;
        throw new Error(`TAPD 目录父级未返回：${folder.Name}`);
      }
      return `${fullPath(ancestor, seen)}/${folder.Name}`;
    }
    result.push(...[...folders.values()].map(folder => ({ ...target, folderId: String(folder.Uid), label: `${prefix} / ${fullPath(folder)}` })));
  }
  return result.sort((a, b) => a.label.localeCompare(b.label, 'zh-CN'));
}

export function nativeTestCase(record: TestCase, target: CaseTarget, requirement: TapdRequirement): NativeTestCase {
  if (String(record['关联需求']).split(';').filter(Boolean).some(url => url !== requirement.url)) throw new Error('Excel 关联了其他需求，请修改为当前需求后再上传');
  const text = record['步骤描述类型'] === '文本';
  const numbered = (value: string | number) => String(value).split(/\r?\n/).map(line => line.trim()).filter(Boolean).map(line => line.replace(/^\d+、\s*/, ''));
  const steps = numbered(record['步骤描述']), expected = numbered(record['预期结果']);
  return {
    Name: String(record['用例标题']), FolderUid: target.folderId, Priority: String(record['等级']), PreConditions: String(record['前置条件']), StepType: text ? 'TEXT' : 'STEP',
    Steps: text ? [] : steps.map((Content, index) => ({ Content, ExpectedResult: expected[index] })),
    ...(text ? { StepText: { Content: String(record['步骤描述']), ExpectedResult: String(record['预期结果']) } } : {}),
    Labels: String(record['标签']).split('，').map(label => label.trim()).filter(Boolean).map(label => ({ Name: label, Value: '', DisplayName: label })),
    Issues: [{ IssueUid: requirement.id, IssueName: requirement.name, IssueUrl: requirement.url, WorkspaceUid: requirement.workspaceId, Type: 'STORY', Source: 'TAPD' }],
    ManHourEstimated: String(record['评估工时'] ?? ''), RunTimes: String(record['执行次数'] ?? ''),
  };
}
const hasIssue = (remote: RemoteCase, requirement: TapdRequirement) => remote.Issues?.some(issue => String(issue.IssueUid) === requirement.id && String(issue.WorkspaceUid) === requirement.workspaceId && issue.Type === 'STORY' && issue.Source === 'TAPD');
function matches(remote: RemoteCase, payload: NativeTestCase) {
  const step = (value?: Step) => value ? [value.Content, value.ExpectedResult] : null;
  return remote.Name === payload.Name && String(remote.FolderUid) === payload.FolderUid && remote.Priority === payload.Priority
    && remote.PreConditions === payload.PreConditions && remote.StepType === payload.StepType
    && digest(remote.Steps?.map(step) || []) === digest(payload.Steps.map(step)) && digest(step(remote.StepText)) === digest(step(payload.StepText))
    && String(remote.ManHourEstimated ?? '') === payload.ManHourEstimated && (String(remote.RunTimes ?? '') === payload.RunTimes || (payload.RunTimes === '' && String(remote.RunTimes) === '0'))
    && digest((remote.Labels || []).map(label => label.DisplayName || label.Name).sort()) === digest(payload.Labels.map(label => label.DisplayName).sort());
}

function verifyContent(remote: RemoteCase, payload: NativeTestCase) {
  if (digest((remote.Labels || []).map(label => label.DisplayName || label.Name).sort()) !== digest(payload.Labels.map(label => label.DisplayName).sort())) {
    throw new Error('用例已创建，但 TAPD 未完整保存 Excel 标签，请在 TAPD 核对标签；不会重复创建');
  }
  if (!matches(remote, payload)) throw new Error('用例已创建，但远端内容或目录与 Excel 不一致，请在 TAPD 核对；不会重复创建');
}

export function createTestCaseImporter(db: DatabaseSync, scope: { accountId: string; workspaceId: string; storyId: string; conversationId: string }, checkIdentity: () => void, request = tapdTestXRequest) {
  db.exec('CREATE TABLE IF NOT EXISTS requirement_testx_imports (scope TEXT NOT NULL, asset_id TEXT NOT NULL, version TEXT NOT NULL, row_key TEXT NOT NULL, content_hash TEXT NOT NULL, receipt TEXT NOT NULL, PRIMARY KEY(scope,asset_id,version,row_key))');
  const scopeKey = digest([scope.accountId, scope.workspaceId, scope.storyId]);
  async function workbook(asset: RequirementAsset, hash: string, url: string) {
    if (asset.stage !== 7 || asset.sourceConversationId !== scope.conversationId || asset.confirmed === false || asset.hash !== hash || !/测试用例\.xlsx$/i.test(asset.name)) throw new Error('请选择当前测试会话已提交的 Excel 版本');
    const bytes = await readFile(asset.versionPath);
    if (createHash('sha256').update(bytes).digest('hex') !== hash) throw new Error('Excel 版本校验失败');
    return readTestCaseWorkbook(bytes, url);
  }
  function results(asset: RequirementAsset): ImportReceipt[] {
    return db.prepare('SELECT receipt FROM requirement_testx_imports WHERE scope=? AND asset_id=? AND version=? ORDER BY rowid').all(scopeKey, asset.id, asset.hash).map(row => JSON.parse(String(row.receipt)));
  }
  function save(asset: RequirementAsset, hash: string, receipt: ImportReceipt) {
    db.prepare('INSERT OR REPLACE INTO requirement_testx_imports VALUES (?,?,?,?,?,?)').run(scopeKey, asset.id, asset.hash, receipt.key, hash, JSON.stringify(receipt));
  }
  return { workbook, results,
    async import(asset: RequirementAsset, hash: string, requirement: TapdRequirement, target?: CaseTarget) {
      if (locks.has(scopeKey)) throw new Error('当前需求正在上传用例，请稍候');
      locks.add(scopeKey);
      try {
        checkIdentity();
        if (requirement.id !== scope.storyId || requirement.workspaceId !== scope.workspaceId) throw new Error('需求身份与上传会话不一致');
        const records = await workbook(asset, hash, requirement.url);
        const automatic = !target;
        if (!target) {
          const previous = results(asset).filter(receipt => receipt.id || receipt.state === 'unknown' || receipt.state === 'creating');
          const targets = new Map(previous.map(receipt => [JSON.stringify(receipt.target), receipt.target]));
          if (targets.size > 1) throw new Error('历史上传包含多个目标，请先核对上传记录');
          const previousTarget = targets.values().next().value;
          const root = await resolveCaseRoot(scope.workspaceId, request, previousTarget);
          target = previousTarget ? root : await ensureRequirementCaseFolder(requirement, root, request, checkIdentity);
        }
        const resolvedTarget = target;
        if (!['repoId', 'versionId', 'folderId'].every(key => typeof resolvedTarget[key as keyof CaseTarget] === 'string' && /^\d+$/.test(resolvedTarget[key as keyof CaseTarget]))) throw new Error('上传目标无效');
        checkIdentity();
        const payloads = records.map(record => nativeTestCase(record, resolvedTarget, requirement));
        const keys = records.map(record => String(record['用例标题']).trim());
        if (new Set(keys).size !== keys.length) throw new Error('用例标题须唯一，建议包含稳定 TC 编号');
        const prior = keys.map((key, index) => {
          const rows = db.prepare('SELECT content_hash,receipt FROM requirement_testx_imports WHERE scope=? AND row_key=?').all(scopeKey, key);
          const contentHash = digest([records[index], resolvedTarget, payloads[index]]);
          if (rows.some(row => {
            const receipt = JSON.parse(String(row.receipt)) as ImportReceipt;
            return row.content_hash !== contentHash && (receipt.id || receipt.state === 'unknown' || receipt.state === 'creating');
          })) throw new Error(`用例“${key}”已有上传或结果未知记录，目录或内容发生变化。请恢复原目录续传；内容修改请使用新的用例版本编号`);
          const receipts = rows.filter(row => row.content_hash === contentHash).map(row => JSON.parse(String(row.receipt)) as ImportReceipt);
          return { contentHash, receipt: receipts.find(row => row.state === 'linked') || receipts.find(row => row.id) || receipts.find(row => row.state === 'unknown' || row.state === 'creating') || receipts.at(-1) };
        });
        if (!automatic) {
          const destinations = await listCaseDestinations(scope.workspaceId, request, true);
          if (!destinations.some(item => item.repoId === resolvedTarget.repoId && item.versionId === resolvedTarget.versionId && item.folderId === resolvedTarget.folderId)) throw new Error('上传目录不存在或不属于当前项目，请刷新目录重新选择');
        }
        const entries = payloads.map((payload, index) => ({
          contentHash: prior[index].contentHash,
          receipt: prior[index].receipt ? { ...prior[index].receipt!, row: index + 2 } : {
            row: index + 2, name: payload.Name, key: keys[index], state: 'failed', target: resolvedTarget, payload,
          } as ImportReceipt,
        }));
        type Entry = (typeof entries)[number];
        const persist = (entry: Entry) => save(asset, entry.contentHash, entry.receipt);
        const errorText = (error: unknown) => error instanceof Error ? error.message : String(error);
        // One fresh folder listing per reconciliation group. Never infer IDs from
        // batch response order: the public API does not define that response shape.
        async function reconcile(group: Entry[]): Promise<boolean> {
          const byName = new Map<string, Array<{ Uid: string; Name: string; FolderUid: string }>>();
          if (group.some(entry => !entry.receipt.id)) {
            const seen = new Set<string>();
            try {
              for (let offset = 0; ; offset += caseSearchPageSize) {
                checkIdentity();
                const page = await request<{ Cases?: Array<{ Uid: string; Name: string; FolderUid: string }> }>('POST', `${casesPath(scope.workspaceId, resolvedTarget)}/search`, {
                  PageInfo: { Offset: offset, Limit: caseSearchPageSize }, FolderUid: resolvedTarget.folderId,
                  ShowMode: 'FLAT', IncludeDescendants: false, Filter: { ItemType: 'CASE' },
                }, { fresh: true });
                if (!Array.isArray(page.Cases)) throw new Error('无法核对远端批量创建结果');
                for (const item of page.Cases) {
                  if (!item || !/^\d+$/.test(String(item.Uid)) || seen.has(String(item.Uid))) throw new Error('远端用例分页无效，无法安全核对');
                  seen.add(String(item.Uid));
                  if (String(item.FolderUid) !== resolvedTarget.folderId) continue;
                  const list = byName.get(item.Name) || [];
                  list.push(item); byName.set(item.Name, list);
                }
                if (page.Cases.length < caseSearchPageSize) break;
                if (offset >= 100000) throw new Error('远端查询结果过多，无法安全核对');
              }
            } catch (error) {
              for (const entry of group) { entry.receipt.error = errorText(error); persist(entry); }
              return false;
            }
          }
          let complete = true;
          for (const entry of group) {
            checkIdentity();
            const receipt = entry.receipt;
            let detail: RemoteCase;
            if (!receipt.id) {
              const found = byName.get(receipt.payload.Name) || [];
              const matched: RemoteCase[] = [];
              let mismatch: string | undefined;
              try {
                for (const candidate of found) {
                  checkIdentity();
                  const value = await request<RemoteCase>('GET', `${casesPath(scope.workspaceId, resolvedTarget)}/${encodeURIComponent(String(candidate.Uid))}`, {}, { fresh: true });
                  checkIdentity();
                  if (!value || String(value.Uid) !== String(candidate.Uid)) throw new Error('远端用例身份不一致');
                  try {
                    verifyContent(value, receipt.payload);
                    if (!hasIssue(value, requirement)) throw new Error('远端未确认需求关联，请在 TAPD 核对；不会重复创建');
                    matched.push(value);
                  } catch (error) { mismatch = errorText(error); }
                }
              } catch (error) {
                receipt.error = errorText(error); persist(entry);
                return false;
              }
              if (matched.length !== 1) {
                receipt.state = 'unknown';
                receipt.error = !matched.length && mismatch ? mismatch : '未找到唯一匹配用例，请在 TAPD 核对；不会重复创建';
                persist(entry); complete = false; continue;
              }
              // Persist an ID only after both content and requirement match.
              // A same-title manual case must never pin a receipt to the wrong ID.
              detail = matched[0];
              receipt.id = String(detail.Uid);
              receipt.state = 'created';
              persist(entry);
            } else {
              try {
                detail = await request<RemoteCase>('GET', `${casesPath(scope.workspaceId, resolvedTarget)}/${encodeURIComponent(receipt.id)}`, {}, { fresh: true });
              } catch (error) {
                receipt.error = errorText(error); persist(entry);
                // Stop on transport/auth/rate-limit errors, retaining all unverified rows.
                return false;
              }
            }
            checkIdentity();
            try {
              if (!detail || String(detail.Uid) !== receipt.id) throw new Error('远端用例身份不一致');
              verifyContent(detail, receipt.payload);
              if (!hasIssue(detail, requirement)) throw new Error('用例已创建，但远端未确认需求关联，请在 TAPD 核对；续传不会重新创建用例');
              receipt.state = 'linked'; receipt.error = undefined;
            } catch (error) { receipt.error = errorText(error); complete = false; }
            persist(entry);
          }
          return complete;
        }
        const pending: Entry[] = [], uncertain: Entry[] = [];
        for (const entry of entries) {
          const receipt = entry.receipt;
          if (receipt.state === 'linked') { receipt.reused = true; persist(entry); }
          else if (receipt.id || receipt.state === 'unknown' || receipt.state === 'creating') {
            if (!receipt.id) receipt.state = 'unknown';
            persist(entry); uncertain.push(entry);
          } else pending.push(entry);
        }
        // Reconcile every previously sent row before starting any new writes.
        if (uncertain.length && !await reconcile(uncertain)) return results(asset);
        for (let offset = 0; offset < pending.length; offset += createBatchSize) {
          checkIdentity();
          const batch = pending.slice(offset, offset + createBatchSize);
          for (const entry of batch) {
            entry.receipt.state = 'creating'; entry.receipt.error = undefined; persist(entry);
          }
          try {
            checkIdentity();
            await request<unknown>('POST', `${casesPath(scope.workspaceId, resolvedTarget)}/batch-create`, {
              TargetFolderUid: resolvedTarget.folderId,
              Cases: batch.map(({ receipt }) => ({
                ...receipt.payload,
                // TAPD uses the workspace ID as IssueUrl on the wire.
                Issues: receipt.payload.Issues.map(issue => ({ ...issue, IssueUrl: issue.WorkspaceUid })),
              })),
            });
          } catch (error) {
            // Even a batch-level rejection may follow partial writes. Never
            // mark the entire batch safe to resend based on the error class.
            for (const entry of batch) {
              entry.receipt.state = 'unknown'; entry.receipt.error = errorText(error); persist(entry);
            }
            break;
          }
          for (const entry of batch) { entry.receipt.state = 'unknown'; persist(entry); }
          if (!await reconcile(batch)) break;
        }
        return results(asset);
      } finally { locks.delete(scopeKey); }
    },
  };
}
