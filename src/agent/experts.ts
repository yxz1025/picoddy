import { projectBuiltinExperts } from "./experts/project_builtins.ts";
import { ResourceCache } from "./resource_cache.ts";
// src/agent/experts.ts
// 兼容 facade：保留旧专家模块的导出，同时由 canonical registry 提供目录。

import { readFile } from "node:fs/promises";
import type { ExpertManifest, ExpertSummary } from "./experts/types.ts";
import { createExpertRegistry } from "./experts/registry.ts";
import {
  refreshInstalledExpertRegistry,
  type InstalledExpertRefreshResult,
} from "./experts/installed_catalog.ts";
import {
  refreshSkillHubExpertCache as refreshSkillHubExpertCacheRegistry,
  type SkillHubExpertCacheScanResult,
} from "./experts/skillhub_cache.ts";
import {
  createInstalledExpertManagement,
  type CreateEditDraftResult,
  type InstalledExpertManagement,
  type PublishEditInput,
  type UninstallDependencies,
} from "./experts/installed_management.ts";
import {
  createDefaultExpertPromptIo,
  ExpertPromptError,
  resolveCachedExpertPrompt,
  resolveExpertPrompt,
  type ResolvedExpertPrompt,
} from "./experts/prompt_resolver.ts";

/** @deprecated 新代码应使用 ExpertSummary/ExpertManifest。 */
export type Expert = ExpertSummary;

interface LegacyExpert {
  id: string;
  name: string;
  nickname?: string;
  icon: string;
  description: string;
  systemPrompt: string;
  promptFile?: string;
  tags?: string[];
  quickPrompts?: string[];
  badge?: string;
  categoryId?: string;
  revision?: string;
  capabilityHints?: {
    preferredTools?: string[];
    bundledSkills?: string[];
  };
  guidelines?: string[];
  outputPolicy?: string[];
  riskNotes?: string[];
  expertType?: "agent";
}

/** 内置原始 6 个 mock 专家，作为离线降级与首选展示 */
const MOCK_EXPERTS: LegacyExpert[] = [
  {
    id: "product-manager",
    name: "产品经理",
    nickname: "许清楚",
    icon: "",
    description: "需求分析、PRD 撰写、产品规划",
    systemPrompt: `你是一位资深产品经理。擅长需求分析、用户故事拆解、PRD 撰写、产品路线图规划。
回答时优先使用产品思维框架（用户价值、商业价值、技术可行性），输出结构化的产品文档。
当用户要求生成文档时，用 write_docx 生成标准 PRD 格式。`,
    tags: ["需求分析", "PRD撰写", "产品规划"],
    badge: "官方专家",
  },
  {
    id: "data-analyst",
    name: "数据分析师",
    nickname: "舒明析",
    icon: "",
    description: "数据分析、可视化、报表",
    systemPrompt: `你是一位数据分析师。擅长从表格数据中提取洞察、趋势分析、统计建模。
回答时先理解数据结构，再给出分析结论 and 可执行建议。
当用户要求分析数据时，先用 read_doc 读取 xlsx/csv，用 write_xlsx 生成分析结果表。`,
    tags: ["数据分析", "数据诊断", "报表设计"],
    badge: "官方专家",
  },
  {
    id: "copywriter",
    name: "文案专家",
    nickname: "文博凯",
    icon: "",
    description: "营销文案、内容创作、品牌策略",
    systemPrompt: `你是一位资深文案专家。擅长营销文案、品牌故事、社交媒体内容、SEO 文章。
回答时注重文字的感染力和传播性，提供多个文案选项供用户选择。`,
    tags: ["内容策略", "品牌故事", "社媒创作"],
    badge: "官方专家",
  },
  {
    id: "translator",
    name: "翻译专家",
    nickname: "何执舟",
    icon: "",
    description: "中英互译、多语言翻译、本地化",
    systemPrompt: `你是一位专业翻译。精通中英互译，熟悉技术文档、商务文件、文学作品的不同翻译风格。
翻译时保持原文语义，适应目标语言的表达习惯，必要时提供翻译注释。`,
    tags: ["中英互译", "本地化", "技术翻译"],
    badge: "官方专家",
  },
  {
    id: "coder",
    name: "编程助手",
    nickname: "寇豆码",
    icon: "",
    description: "代码编写、调试、架构设计",
    systemPrompt: `你是一位资深全栈工程师。精通多种编程语言，擅长代码编写、调试、架构设计、性能优化。
回答时给出可直接运行的代码，附带简要说明。用 bash 工具可以执行 and 测试代码。`,
    tags: ["代码编写", "架构设计", "性能优化"],
    badge: "官方专家",
  },
  {
    id: "legal-advisor",
    name: "法务顾问",
    nickname: "严过关",
    icon: "",
    description: "合同审查、法律咨询、合规",
    systemPrompt: `你是一位法务顾问。擅长合同审查、法律风险评估、合规建议。
回答时引用相关法律条文，提供专业但不构成正式法律意见的参考建议。
重要：始终提醒用户复杂法律问题应咨询执业律师。`,
    tags: ["合同审查", "合规审查", "风险评估"],
    badge: "官方专家",
  },
];

// 加载本地的 expert_center.json 并组合出 300+ 专家
const localText = await readFile(new URL("./expert_center.json", import.meta.url), "utf-8").catch(() => "");
let cosExperts: any[] = [];
if (localText) {
  try {
    const data = JSON.parse(localText);
    cosExperts = data.experts || [];
  } catch {}
}

const mappedCosExperts: LegacyExpert[] = cosExperts
  .filter((item: any) => item?.expertType === "agent")
  .map((item: any) => {
    const name = item.profession?.zh || item.displayName?.zh || item.id;
    const nickname = item.profession?.zh !== item.displayName?.zh
      ? (item.displayName?.zh || "")
      : "";
    return {
      id: item.id,
      name,
      nickname,
      icon: "",
      description: item.description?.zh || item.description?.en || "",
      promptFile: item.promptFile,
      tags: (item.tags || []).map((t: any) => t.zh || t.en),
      quickPrompts: (item.quickPrompts || []).map((qp: any) => qp.zh || qp.en),
      systemPrompt: item.defaultInitPrompt?.zh || "",
      badge: item.isOPC ? "特邀专家" : undefined,
      categoryId: item.categoryId,
      revision: item.updatedAt,
      guidelines: item.guidelines,
      outputPolicy: item.outputPolicy,
      riskNotes: item.riskNotes,
      expertType: "agent",
      capabilityHints: {
        preferredTools: item.preferred_tools || item.preferredTools,
        bundledSkills: item.skills || item.bundledSkills,
      },
    };
  });

function legacyToManifest(
  expert: LegacyExpert,
  catalogSource: "builtin" | "catalog",
): ExpertManifest {
  return {
    id: expert.id,
    name: expert.name,
    expertType: expert.expertType ?? "agent",
    ...(expert.nickname ? { nickname: expert.nickname } : {}),
    categoryId: expert.categoryId || "uncategorized",
    description: expert.description,
    icon: expert.icon,
    tags: expert.tags || [],
    quickPrompts: expert.quickPrompts || [],
    ...(expert.badge ? { badge: expert.badge } : {}),
    catalogSource,
    revision: expert.revision || "",
    available: Boolean(expert.systemPrompt || expert.promptFile),
    prompt: {
      ...(expert.systemPrompt ? { inline: expert.systemPrompt } : {}),
      ...(expert.promptFile ? { remotePath: expert.promptFile } : {}),
      maxBytes: 128 * 1024,
    },
    guidelines: expert.guidelines || [],
    capabilityHints: {
      preferredTools: expert.capabilityHints?.preferredTools || [],
      bundledSkills: expert.capabilityHints?.bundledSkills || [],
    },
    ...(expert.outputPolicy ? { outputPolicy: expert.outputPolicy } : {}),
    ...(expert.riskNotes ? { riskNotes: expert.riskNotes } : {}),
  };
}

const normalizedBuiltins = MOCK_EXPERTS.map((expert) =>
  legacyToManifest(expert, "builtin")
);
const normalizedCatalog = mappedCosExperts.map((expert) =>
  legacyToManifest(expert, "catalog")
);

export const expertRegistry = createExpertRegistry({
  builtins: [...projectBuiltinExperts, ...normalizedBuiltins],
  catalog: normalizedCatalog,
});

/** 专家列表的安全摘要；提示词只通过 getExpert/getExpertSystemPrompt 获取。 */
export const BUILTIN_EXPERTS: Expert[] = expertRegistry.list();

/** Current combined catalog. Unlike BUILTIN_EXPERTS, this includes runtime-installed packages. */
export function listExperts(): Expert[] {
  return expertRegistry.list();
}

export function listInstalledExperts(): Expert[] {
  return expertRegistry.list("installed");
}

export function getExpertSummary(id: string): Expert | undefined {
  return expertRegistry.list().find((expert) => expert.id === id);
}

const installedRefreshCache = new ResourceCache<Promise<InstalledExpertRefreshResult>>();
const hubRefreshCache = new ResourceCache<Promise<SkillHubExpertCacheScanResult>>();

/** Refresh the user marketplace atomically; an unavailable marketplace keeps the last valid snapshot. */
export async function refreshInstalledExperts(): Promise<InstalledExpertRefreshResult> {
  const { resolveInstalledExpertMarketplaceDir } = await import("./experts/installed_catalog.ts");
  return await installedRefreshCache.get([resolveInstalledExpertMarketplaceDir()], () =>
    refreshInstalledExpertRegistry(expertRegistry));
}

export async function refreshSkillHubExperts(): Promise<SkillHubExpertCacheScanResult> {
  const { resolveSkillHubExpertCacheDir } = await import("./experts/skillhub_cache.ts");
  return await hubRefreshCache.get([resolveSkillHubExpertCacheDir()], () =>
    refreshSkillHubExpertCacheRegistry(expertRegistry));
}

/** Trusted operations over the user-owned my-experts marketplace. */
export const installedExpertManagement: InstalledExpertManagement =
  createInstalledExpertManagement({ refresh: refreshInstalledExperts });

export async function resolveInstalledExpertFolder(expertId: string): Promise<string> {
  return await installedExpertManagement.resolveFolder(expertId);
}

export async function createInstalledExpertEditDraft(
  expertId: string,
  targetRevision: string,
  conversationId: string,
): Promise<CreateEditDraftResult> {
  return await installedExpertManagement.createEditDraft(
    expertId,
    targetRevision,
    conversationId,
  );
}

export async function publishInstalledExpertEdit(
  expertId: string,
  input: PublishEditInput,
): Promise<{ expertId: string; revision: string }> {
  return await installedExpertManagement.publishEdit(expertId, input);
}

export async function uninstallInstalledExpert(
  expertId: string,
  dependencies: UninstallDependencies,
): Promise<{ expertId: string; affectedConversationIds: string[] }> {
  // Registry refresh is owned by the facade so every caller receives the same
  // installed snapshot after a successful uninstall.
  return await installedExpertManagement.uninstall(expertId, {
    ...dependencies,
    refresh: refreshInstalledExperts,
  });
}

/** 按 id 获取专家清单（内部使用，返回副本）。 */
export function getExpert(id: string): ExpertManifest | undefined {
  return expertRegistry.get(id);
}

// ===== 系统提示词解析、可信下载与版本化缓存 facade =====

const defaultPromptIo = createDefaultExpertPromptIo();

/** Resolve the richer profile used by provider/runtime code. */
export async function resolveExpertPromptById(
  expertId: string,
  requestedRevision?: string,
  io = defaultPromptIo,
): Promise<ResolvedExpertPrompt | null> {
  const expert = getExpert(expertId);
  const revision = requestedRevision?.trim();
  if (requestedRevision !== undefined && !revision) {
    throw new ExpertPromptError(
      "EXPERT_REVISION_UNAVAILABLE",
      `Missing requested revision for ${expertId}`,
    );
  }

  // A persisted revision that no longer matches the catalog is recoverable
  // only from its exact verified cache entry. Never silently use the current
  // catalog prompt for an older session binding.
  if (revision && (!expert || revision !== expert.revision)) {
    try {
      const cached = await resolveCachedExpertPrompt(
        expertId,
        revision,
        { maxBytes: expert?.prompt.maxBytes, io },
      );
      if (cached) return cached;
    } catch {
      // Normalize malformed, oversized, or otherwise invalid cache state to a
      // stable recovery error below; callers must not fall through to latest.
    }
    throw new ExpertPromptError(
      "EXPERT_REVISION_UNAVAILABLE",
      `No verified cache for ${expertId}@${revision}`,
    );
  }

  if (!expert) return null;
  return resolveExpertPrompt(expert, io);
}

/** Backward-compatible prompt-only facade. */
export async function getExpertSystemPrompt(expertId: string): Promise<string> {
  const profile = await resolveExpertPromptById(expertId);
  return profile?.text ?? "";
}
