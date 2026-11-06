import { resolveSkillHubBaseUrl } from "./config.ts";
const REQUEST_TIMEOUT_MS = 15_000;
const CATALOG_PAGE_SIZE = 12;
const MAX_CATALOG_PAGES = 100;

type FetchLike = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

export interface SkillHubVersion {
  id: number;
  version: string;
  status: string;
}

export interface SkillHubSkill {
  registrySource?: "clawhub";
  id: number;
  slug: string;
  displayName: string;
  summary: string;
  status: string;
  downloadCount: number;
  namespace: string;
  updatedAt: string;
  headlineVersion: SkillHubVersion | null;
  publishedVersion: SkillHubVersion | null;
}

export interface SkillHubExpertDetail extends SkillHubSkill {
  ownerDisplayName: string;
  subscriptionCount: number;
  avatarPath: string;
  tags: string[];
  quickPrompts: string[];
}

export type SkillHubCatalogType = "SKILL" | "EXPERT";

export interface SkillHubNamespace {
  id: number;
  slug: string;
  displayName: string;
  status: string;
  description: string | null;
  type: string;
}

export interface SkillHubClientOptions {
  baseUrl?: string;
  fetchImpl?: FetchLike;
  token?: string;
  cookies?: Record<string, string>;
}

function webHeaders(options: SkillHubClientOptions): Record<string, string> {
  const cookie = Object.entries(options.cookies ?? {})
    .filter(([name, value]) => (name === "SESSION" || name === "XSRF-TOKEN") && !!value)
    .map(([name, value]) => `${name}=${value}`).join("; ");
  return { Accept: "application/json", ...(cookie ? { Cookie: cookie } : {}) };
}

interface ResolvedOptions {
  baseUrl: string;
  fetchImpl: FetchLike;
}

function resolveOptions(options: SkillHubClientOptions = {}): ResolvedOptions {
  return {
    baseUrl: (options.baseUrl ?? resolveSkillHubBaseUrl())
      .replace(/\/+$/, ""),
    fetchImpl: options.fetchImpl ?? fetch,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function normalizeVersion(value: unknown): SkillHubVersion | null {
  if (!isRecord(value)) return null;
  if (
    typeof value.id !== "number" ||
    typeof value.version !== "string" ||
    typeof value.status !== "string"
  ) return null;
  return { id: value.id, version: value.version, status: value.status };
}

function normalizeSkill(value: unknown): SkillHubSkill | null {
  if (!isRecord(value)) return null;
  if (
    typeof value.id !== "number" ||
    typeof value.slug !== "string" ||
    typeof value.namespace !== "string"
  ) return null;
  return {
    id: value.id,
    slug: value.slug,
    displayName: typeof value.displayName === "string" ? value.displayName : value.slug,
    summary: typeof value.summary === "string" ? value.summary : "",
    status: typeof value.status === "string" ? value.status : "",
    downloadCount: typeof value.downloadCount === "number" ? value.downloadCount : 0,
    namespace: value.namespace,
    updatedAt: typeof value.updatedAt === "string" ? value.updatedAt : "",
    headlineVersion: normalizeVersion(value.headlineVersion),
    publishedVersion: normalizeVersion(value.publishedVersion),
  };
}

function normalizeLocalizedPrompts(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((prompt) => {
    if (typeof prompt === "string" && prompt.trim()) return [prompt.trim()];
    if (!isRecord(prompt)) return [];
    const localized = typeof prompt.zh === "string" && prompt.zh.trim()
      ? prompt.zh
      : typeof prompt.en === "string"
      ? prompt.en
      : "";
    return localized.trim() ? [localized.trim()] : [];
  });
}

function normalizeExpertDetail(value: unknown): SkillHubExpertDetail | null {
  const skill = normalizeSkill(value);
  if (!skill || !isRecord(value)) return null;
  const expert = isRecord(value.expert) ? value.expert : {};
  const plugin = isRecord(expert.rawPluginJson) ? expert.rawPluginJson : {};
  const tags = Array.isArray(expert.tags)
    ? expert.tags.filter((tag): tag is string => typeof tag === "string" && !!tag.trim())
    : [];
  return {
    ...skill,
    displayName: typeof expert.resolvedDisplayName === "string" && expert.resolvedDisplayName.trim()
      ? expert.resolvedDisplayName
      : skill.displayName,
    summary: typeof expert.resolvedSummary === "string" && expert.resolvedSummary.trim()
      ? expert.resolvedSummary
      : skill.summary,
    ownerDisplayName: typeof value.ownerDisplayName === "string"
      ? value.ownerDisplayName
      : "",
    subscriptionCount: typeof value.subscriptionCount === "number"
      ? value.subscriptionCount
      : 0,
    avatarPath: typeof expert.avatarPath === "string" ? expert.avatarPath : "",
    tags,
    quickPrompts: normalizeLocalizedPrompts(plugin.quickPrompts),
  };
}

function normalizeNamespace(value: unknown): SkillHubNamespace | null {
  if (!isRecord(value)) return null;
  if (
    typeof value.id !== "number" ||
    typeof value.slug !== "string" ||
    typeof value.displayName !== "string"
  ) return null;
  return {
    id: value.id,
    slug: value.slug,
    displayName: value.displayName,
    status: typeof value.status === "string" ? value.status : "",
    description: typeof value.description === "string" ? value.description : null,
    type: typeof value.type === "string" ? value.type : "",
  };
}

async function readJson(response: Response, errorMessage: string): Promise<unknown> {
  if (!response.ok) throw Object.assign(new Error(errorMessage), { status: response.status });
  try {
    return await response.json();
  } catch {
    throw new Error(errorMessage);
  }
}

async function safeFetch(
  fetchImpl: FetchLike,
  input: string,
  init: RequestInit,
  errorMessage: string,
): Promise<Response> {
  try {
    return await fetchImpl(input, {
      ...init,
      signal: init.signal ?? AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch {
    throw new Error(errorMessage);
  }
}

export async function listSkillHubCatalog(
  type: SkillHubCatalogType,
  options: SkillHubClientOptions = {},
): Promise<SkillHubSkill[]> {
  const resolved = resolveOptions(options);
  const skills: SkillHubSkill[] = [];
  for (let page = 0; page < MAX_CATALOG_PAGES; page += 1) {
    const response = await safeFetch(
      resolved.fetchImpl,
      `${resolved.baseUrl}/api/web/skills?type=${type}&sort=newest&page=${page}&size=${CATALOG_PAGE_SIZE}&include=labels`,
      { headers: webHeaders(options) },
      `SkillHub ${type === "EXPERT" ? "专家" : "技能"}列表加载失败`,
    );
    const envelope = await readJson(response, "SkillHub 技能列表加载失败");
    if (!isRecord(envelope) || envelope.code !== 0 || !isRecord(envelope.data)) {
      throw new Error("SkillHub 技能列表加载失败");
    }
    const items = envelope.data.items;
    const total = envelope.data.total;
    if (
      !Array.isArray(items) ||
      typeof total !== "number" ||
      !Number.isInteger(total) ||
      total < 0
    ) {
      throw new Error("SkillHub 技能列表加载失败");
    }
    skills.push(
      ...items.map(normalizeSkill).filter(
        (skill): skill is SkillHubSkill => skill !== null,
      ),
    );
    if (items.length === 0 || skills.length >= total) return skills;
  }
  throw new Error("SkillHub 技能列表分页过多");
}

export const listSkillHubSkills = (options: SkillHubClientOptions = {}) =>
  listSkillHubCatalog("SKILL", options);

export const listSkillHubExperts = (options: SkillHubClientOptions = {}) =>
  listSkillHubCatalog("EXPERT", options);

export async function getSkillHubExpertDetail(
  namespace: string,
  slug: string,
  options: SkillHubClientOptions = {},
): Promise<SkillHubExpertDetail> {
  const resolved = resolveOptions(options);
  const response = await safeFetch(
    resolved.fetchImpl,
    `${resolved.baseUrl}/api/web/skills/${encodeURIComponent(namespace)}/${encodeURIComponent(slug)}`,
    { headers: webHeaders(options) },
    "SkillHub 专家详情加载失败",
  );
  const envelope = await readJson(response, "SkillHub 专家详情加载失败");
  if (!isRecord(envelope) || envelope.code !== 0) {
    throw new Error("SkillHub 专家详情加载失败");
  }
  const detail = normalizeExpertDetail(envelope.data);
  if (!detail) throw new Error("SkillHub 专家详情加载失败");
  return detail;
}

export async function listSkillHubNamespaces(
  options: SkillHubClientOptions = {},
): Promise<SkillHubNamespace[]> {
  const resolved = resolveOptions(options);
  const token = options.token?.trim();
  if (!token) throw new Error("SkillHub 缺少用户 Token，请先进入技能市场登录");
  const response = await safeFetch(
    resolved.fetchImpl,
    `${resolved.baseUrl}/api/v1/namespaces`,
    {
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${token}`,
      },
    },
    "SkillHub namespace列表加载失败",
  );
  const envelope = await readJson(response, "SkillHub namespace列表加载失败");
  if (!isRecord(envelope) || envelope.code !== 0) {
    throw new Error("SkillHub namespace列表加载失败");
  }
  const data = envelope.data;
  const items = Array.isArray(data)
    ? data
    : isRecord(data) && Array.isArray(data.items)
    ? data.items
    : null;
  if (!items) throw new Error("SkillHub namespace列表加载失败");
  return items.map(normalizeNamespace).filter(
    (namespace): namespace is SkillHubNamespace => namespace !== null,
  );
}
