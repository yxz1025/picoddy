export interface MarketExpertIdentity { namespace: string; slug: string }
interface StageExpert { id: string; name: string; available: boolean }
interface MarketVersion { status: string; version: string }
interface MarketDetail extends MarketExpertIdentity {
  publishedVersion: MarketVersion | null;
  headlineVersion: MarketVersion | null;
}

const product = { namespace: 'product-design', slug: 'product-management' };
const uiFrontend = { namespace: 'team-ui', slug: 'ui-frontend-expert' };
const architect = { namespace: 'teach-engineer', slug: 'software-architect' };
const developer = { namespace: 'teach-engineer', slug: 'senior-developer' };
const testing = { namespace: 'team-qa', slug: 'testing-expert' };
const stageExperts: readonly (MarketExpertIdentity | undefined)[] = [
  product, product, uiFrontend, architect, undefined, undefined, developer, testing, developer, product,
];

export function stageExpertIdentity(stageIndex: number): MarketExpertIdentity | undefined {
  return stageExperts[stageIndex];
}

const statusGroups: readonly (readonly string[])[] = [
  ['新', '新建', '待处理', '待分析', '需求分析', '设计分析', '规划中', '待规划', '规划', 'new', 'planning'],
  ['产品 PRD', '产品PRD', 'PRD', '需求设计', '设计中'],
  ['评审', '评审中', '待评审', '设计评审', '需求评审', '待审核', '审核中'],
  ['待开发', '架构', '架构设计', '架构设计中', '研发设计', '研发设计中', '已立项', '已评审', '评审通过', '研发计划', '开发计划', '待排期', '已排期', '重新打开', 'reopened'],
  [],
  [],
  ['代码审核', '代码评审', '待代码评审', '代码评审中'],
  ['开发中', '实现中', '编码中', 'developing', 'in_progress', '开发完成', '已开发', 'developed', '测试', '待测试', '测试中', '验收', '待验收', '验收中', '自动测试', 'testing', 'resolved'],
  ['构建验证', '待构建', '构建中', '待发布', '发布中'],
  ['交付归档', '已交付', '已完成', '已发布', '已关闭', '完成', '关闭', 'done', 'closed'],
];

export function stageForTapdStatus(status: string): number | undefined {
  const value = status.trim().toLowerCase();
  const stage = statusGroups.findIndex(group => group.some(label => label.toLowerCase() === value));
  return stage < 0 ? undefined : stage;
}

export function createStageExpertSummoner<T extends StageExpert>(dependencies: {
  list: () => Promise<readonly T[]>;
  detail: (identity: MarketExpertIdentity) => Promise<MarketDetail>;
  install: (input: MarketExpertIdentity & { version: string }) => Promise<T>;
}) {
  const pending = new Map<string, Promise<T>>();
  return function summon(identity: MarketExpertIdentity): Promise<T> {
    const id = `${identity.namespace}--${identity.slug}`;
    const existing = pending.get(id);
    if (existing) return existing;
    const operation = (async () => {
      const local = (await dependencies.list()).find(expert => expert.id === id && expert.available);
      if (local) return local;
      const detail = await dependencies.detail(identity);
      if (detail.namespace !== identity.namespace || detail.slug !== identity.slug) throw new Error('市场专家身份不匹配');
      const version = detail.publishedVersion?.status === 'PUBLISHED' ? detail.publishedVersion.version
        : detail.headlineVersion?.status === 'PUBLISHED' ? detail.headlineVersion.version : undefined;
      if (!version) throw new Error('该阶段专家暂无可下载版本，请稍后重试');
      const installed = await dependencies.install({ ...identity, version });
      if (installed.id !== id || !installed.available) throw new Error('下载后的阶段专家不可用，请重试');
      return installed;
    })();
    pending.set(id, operation);
    void operation.finally(() => pending.delete(id)).catch(() => undefined);
    return operation;
  };
}
