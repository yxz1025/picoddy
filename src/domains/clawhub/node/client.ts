import type { SkillHubSkill } from '../../skillhub/node/client.ts';

export const CLAWHUB_REGISTRY = 'https://clawhub.ai';
export interface ClawHubPage { items: SkillHubSkill[]; nextCursor: string | null }

async function getJson(path: string): Promise<any> {
  let response: Response;
  try {
    response = await fetch(`${CLAWHUB_REGISTRY}${path}`, {
      headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(15_000),
    });
  } catch { throw new Error('ClawHub 暂时无法连接，请稍后重试'); }
  if (response.status === 429) throw new Error('ClawHub 请求频繁，请稍后重试');
  if (!response.ok) throw new Error(`ClawHub 请求失败（${response.status}）`);
  return response.json();
}

function normalize(item: any): SkillHubSkill | null {
  if (!item || typeof item.slug !== 'string' || !/^[a-z0-9][a-z0-9-]{0,127}$/.test(item.slug)) return null;
  // Search may contain external skills.sh results; install only native ClawHub skills.
  if (item.source && item.source !== 'clawhub') return null;
  const version = typeof item.latestVersion?.version === 'string' ? item.latestVersion.version : typeof item.version === 'string' ? item.version : null;
  const owner = item.ownerHandle || item.owner?.handle;
  return {
    registrySource: 'clawhub', id: 0, slug: item.slug, namespace: typeof owner === 'string' ? owner : 'global',
    displayName: typeof item.displayName === 'string' ? item.displayName : item.slug,
    summary: typeof item.summary === 'string' ? item.summary : '', status: 'PUBLISHED',
    downloadCount: Number(item.stats?.downloads ?? item.downloads) || 0,
    updatedAt: Number.isFinite(item.updatedAt) ? new Date(item.updatedAt).toISOString() : '',
    headlineVersion: null,
    publishedVersion: version ? { id: 0, version, status: 'PUBLISHED' } : null,
  };
}

export async function listClawHubSkills(query = '', cursor = ''): Promise<ClawHubPage> {
  const q = query.trim().slice(0, 256);
  const params = new URLSearchParams({ limit: '48' });
  if (q) params.set('q', q);
  else { params.set('sort', 'updated'); if (cursor) params.set('cursor', cursor.slice(0, 4096)); }
  const data = await getJson(`/api/v1/${q ? 'search' : 'skills'}?${params}`);
  const entries = q ? data.results : data.items;
  if (!Array.isArray(entries)) throw new Error('ClawHub 返回的技能列表格式无效');
  return { items: entries.map(normalize).filter((item): item is SkillHubSkill => item !== null), nextCursor: !q && typeof data.nextCursor === 'string' ? data.nextCursor : null };
}
