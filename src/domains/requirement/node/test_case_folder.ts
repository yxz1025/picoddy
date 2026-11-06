import { tapdTestXRequest } from '../../../integrations/tapd/requirements.ts';
import type { CaseTarget } from './test_case_import.ts';

type Folder = { Uid: string; Name: string; FolderUid?: string };
const queues = new Map<string, Promise<unknown>>();

/** Only inspect matching direct children in the current requirement's project/repository. */
export async function ensureRequirementCaseFolder(
  requirement: { workspaceId: string; id: string; name: string }, root: CaseTarget,
  request = tapdTestXRequest, checkIdentity: () => void = () => {},
): Promise<CaseTarget> {
  if (!/^\d+$/.test(requirement.id)) throw new Error('需求 ID 无效');
  const base = `api/testx/case/v1/namespaces/${encodeURIComponent(requirement.workspaceId)}/repos/${encodeURIComponent(root.repoId)}/versions/${encodeURIComponent(root.versionId)}`;
  const key = base;
  const previous = queues.get(key) || Promise.resolve();
  const work = previous.catch(() => {}).then(async () => {
    async function find(parent: string, query: string, matches: (folder: Folder) => boolean) {
      const found = new Map<string, Folder>();
      const seen = new Set<string>();
      for (let offset = 0; ; offset += 200) {
        checkIdentity();
        const result = await request<{ Folders?: Folder[] }>('POST', `${base}/cases/search`, {
          FolderUid: parent, Filter: { ItemType: 'FOLDER', Name: query }, ShowMode: 'FLAT',
          IncludeDescendants: false, IncludeAncestors: false, PageInfo: { Offset: offset, Limit: 200 },
        }, { fresh: true });
        if (!Array.isArray(result.Folders)) throw new Error('TAPD 目录查询返回格式无效');
        for (const folder of result.Folders) {
          if (seen.has(String(folder.Uid))) throw new Error('TAPD 目录分页重复，无法安全确定目标');
          seen.add(String(folder.Uid));
          if (String(folder.FolderUid || '0') === parent && matches(folder)) found.set(String(folder.Uid), folder);
        }
        if (result.Folders.length < 200) break;
        if (offset >= 10000) throw new Error('匹配目录过多，无法安全确定目标');
      }
      if (found.size > 1) throw new Error('存在多个匹配的测试目录，请在 TAPD 合并重复目录后重试');
      return [...found.values()][0];
    }
    async function ensure(parent: string, name: string, query: string, matches: (folder: Folder) => boolean) {
      const existing = await find(parent, query, matches);
      if (existing) return existing;
      checkIdentity();
      try {
        const created = await request<Folder>('POST', `${base}/folders`, { Name: name, FolderUid: parent, Owners: [], CopyCaseUids: [] });
        if (!created?.Uid || !/^\d+$/.test(String(created.Uid)) || created.Name !== name) throw new Error('TAPD 未确认目录创建结果');
        // Some creation responses omit parent metadata; verify those with a scoped read.
        if (String(created.FolderUid || '0') !== parent) {
          const verified = await find(parent, query, matches);
          if (!verified || String(verified.Uid) !== String(created.Uid)) throw new Error('TAPD 未确认目录所属位置');
          return verified;
        }
        return created;
      } catch (cause) {
        // A timeout/conflict may follow a successful remote write. Read once; never replay it here.
        const recovered = await find(parent, query, matches).catch(() => undefined);
        if (recovered) return recovered;
        throw cause;
      }
    }
    const parent = await ensure('0', '自动测试用例', '自动测试用例', f => f.Name === '自动测试用例');
    const prefix = `${requirement.id}-`;
    const title = Array.from(requirement.name.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').trim() || '未命名需求').slice(0, 150).join('');
    const folder = await ensure(String(parent.Uid), prefix + title, prefix, f => f.Name.startsWith(prefix));
    return { ...root, folderId: String(folder.Uid) };
  });
  queues.set(key, work);
  try { return await work; } finally { if (queues.get(key) === work) queues.delete(key); }
}
