import { hasOpenAISubscription, hasProviderCredential } from "./openai_subscription.ts";
// src/agent/models.ts
// 全局 Models 集合管理
// 支持主流模型（DeepSeek、智谱 GLM、Kimi Moonshot、MiniMax、OpenAI、Claude、Gemini、阶跃星辰 ZAI、零一万物、通义千问 Qwen）
// 支持本地 Ollama 侦测与配置
// 支持自定义 OpenAI 规范 endpoint 动态注册

import { getPluginVirtualModels } from "./plugin_tools.ts";
import { createModels, createProvider } from "@earendil-works/pi-ai";
import { openAICompletionsApi } from "@earendil-works/pi-ai/api/openai-completions.lazy";
import { getApiKey } from "../infra/keychain.ts";
import { getSetting, setSetting } from "../domains/settings/node/store.ts";
import {
  DEFAULT_DEEPSEEK_BASE_URL,
  DEFAULT_DEEPSEEK_MODEL_ID,
  normalizeBaseUrl,
  normalizeModelId,
} from "./model_defaults.ts";
import { resolveModelCapabilities, resolveRequestMaxTokens } from "./model_capabilities.ts";
import { resolveModelReasoning } from "./model_reasoning.ts";

const models = createModels();

export interface CustomProviderConfig {
  id: string;
  name: string;
  baseUrl: string;
  apiKey?: string;
  models: string[];
  /** 按模型覆盖的容量上限；未配置的模型使用默认能力解析。 */
  modelLimits?: Record<string, CustomModelLimits>;
}

export interface CustomModelLimits {
  contextWindow?: number;
  maxOutputTokens?: number;
}

export interface ConfiguredProviderModel {
  id: string;
  name: string;
  contextWindow?: number;
  maxInputTokens?: number;
  maxOutputTokens?: number;
}

export type ProviderModelsConfig = Record<string, ConfiguredProviderModel[]>;

// 预设 Provider 的显示标签
export const PROVIDER_LABELS: Record<string, string> = {
  deepseek: "DeepSeek",
  zhipu: "智谱 AI (GLM)",
  moonshot: "Kimi (月之暗面)",
  minimax: "MiniMax",
  openai: "OpenAI",
  openrouter: "OpenRouter",
  anthropic: "Anthropic (Claude)",
  google: "Google (Gemini)",
  zai: "阶跃星辰 (ZAI)",
  zeroone: "零一万物 (01.AI)",
  qwen: "通义千问 (Qwen)",
  ollama: "Ollama (本地大模型)",
};

// 预设 Provider 的 Base URL 默认值
export const PROVIDER_BASE_URLS: Record<string, string> = {
  deepseek: DEFAULT_DEEPSEEK_BASE_URL,
  zhipu: "https://open.bigmodel.cn/api/paas/v4",
  moonshot: "https://api.moonshot.cn/v1",
  minimax: "https://api.minimax.chat/v1",
  openai: "https://api.openai.com/v1",
  openrouter: "https://openrouter.ai/api/v1",
  anthropic: "https://api.anthropic.com",
  google: "https://generativelanguage.googleapis.com",
  zai: "https://api.stepfun.com/v1",
  zeroone: "https://api.lingyiwanwu.com/v1",
  qwen: "https://dashscope.aliyuncs.com/compatible-mode/v1",
  ollama: "http://127.0.0.1:11434/v1",
};

// 预设 Provider 的默认模型列表（清空预设，由用户自由输入指定）
export const PRESET_MODELS: Record<string, Array<{ id: string; name: string }>> = {
  deepseek: [],
  zhipu: [],
  moonshot: [],
  minimax: [],
  openai: [],
  openrouter: [],
  anthropic: [],
  google: [],
  zai: [],
  zeroone: [],
  qwen: [],
  ollama: [],
};

// 已注册的 providers 集合
const registered = new Set<string>();
let initialized = false;
let initializationPromise: Promise<void> | null = null;

function createModelItem(
  id: string,
  name: string,
  providerId: string,
  baseUrl: string,
  contextWindow?: number,
  maxInputTokens?: number,
  maxOutputTokens?: number,
) {
  const capabilities = resolveModelCapabilities(providerId, id, {
    contextWindow,
    maxInputTokens,
    maxOutputTokens,
  });
  const requestMaxTokens = resolveRequestMaxTokens(
    getSetting("agent_max_tokens", "32768"), capabilities.maxOutputTokens,
  );
  return {
    id,
    name: name || id,
    provider: providerId,
    api: "openai-completions" as const,
    baseUrl,
    ...resolveModelReasoning(providerId, id, baseUrl),
    input: ["text" as const, "image" as const],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: capabilities.contextWindow,
    maxTokens: requestMaxTokens,
  };
}

function createApiKeyAuth(key: string, name = "API Key") {
  return {
    apiKey: {
      type: "api-key" as const,
      name,
      resolve: async () => ({
        auth: { apiKey: key },
      }),
    },
  };
}

export function withApiKeyResolver<T extends {
  auth: {
    apiKey?: {
      resolve: (...args: any[]) => Promise<any>;
      [key: string]: unknown;
    };
    [key: string]: unknown;
  };
}>(
  provider: T,
  resolveKey: () => Promise<string | undefined>,
): T {
  const original = provider.auth.apiKey;
  if (!original) return provider;
  return {
    ...provider,
    auth: {
      ...provider.auth,
      apiKey: {
        ...original,
        resolve: async (...args: any[]) => {
          const key = await resolveKey();
          return key
            ? { auth: { apiKey: key } }
            : await original.resolve(...args);
        },
      },
    },
  };
}

/** 获取全部自定义 Provider 配置列表 */
export function getCustomProviders(): CustomProviderConfig[] {
  try {
    const raw = getSetting("custom_providers", "[]");
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

/** 获取预设 Provider 的用户模型配置。 */
export function getProviderModels(): ProviderModelsConfig {
  try {
    const raw = getSetting("provider_models", "");
    if (!raw) return {};

    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};

    const result: ProviderModelsConfig = {};
    for (const [providerId, configuredModels] of Object.entries(parsed)) {
      if (!Array.isArray(configuredModels)) continue;
      const normalized: ConfiguredProviderModel[] = [];
      const seen = new Set<string>();
      for (const value of configuredModels) {
        const rawId = typeof value === "string"
          ? value
          : value && typeof value === "object" &&
              typeof (value as { id?: unknown }).id === "string"
          ? (value as { id: string }).id
          : "";
        const id = normalizeModelId(providerId, rawId);
        if (!id || seen.has(id)) continue;
        seen.add(id);
        const rawName = value && typeof value === "object"
          ? (value as { name?: unknown }).name
          : undefined;
        const rawContextWindow = value && typeof value === "object"
          ? (value as { contextWindow?: unknown }).contextWindow
          : undefined;
        const rawMaxInputTokens = value && typeof value === "object"
          ? (value as { maxInputTokens?: unknown }).maxInputTokens
          : undefined;
        const rawMaxOutputTokens = value && typeof value === "object"
          ? (value as { maxOutputTokens?: unknown }).maxOutputTokens
          : undefined;
        normalized.push({
          id,
          name: typeof rawName === "string" && rawName.trim()
            ? rawName.trim()
            : id,
          ...(typeof rawContextWindow === "number" &&
              Number.isFinite(rawContextWindow) && rawContextWindow > 0
            ? { contextWindow: Math.floor(rawContextWindow) }
            : {}),
          ...(typeof rawMaxInputTokens === "number" &&
              Number.isFinite(rawMaxInputTokens) && rawMaxInputTokens > 0
            ? { maxInputTokens: Math.floor(rawMaxInputTokens) }
            : {}),
          ...(typeof rawMaxOutputTokens === "number" &&
              Number.isFinite(rawMaxOutputTokens) && rawMaxOutputTokens > 0
            ? { maxOutputTokens: Math.floor(rawMaxOutputTokens) }
            : {}),
        });
      }
      result[providerId] = normalized;
    }
    return result;
  } catch {
    return {};
  }
}

export function resolveConfiguredDefault(
  providerId: unknown,
  modelId: unknown,
  providers: readonly { id: string; models?: readonly { id: string }[] }[],
): { providerId: string; modelId: string } {
  const provider = typeof providerId === "string" ? providerId.trim() : "";
  const model = typeof modelId === "string"
    ? normalizeModelId(provider, modelId)
    : "";
  const configuredProvider = providers.find((item) => item.id === provider);
  const configured = configuredProvider?.models?.some((item) =>
    normalizeModelId(provider, item.id) === model
  );
  return configured
    ? { providerId: provider, modelId: model }
    : { providerId: "", modelId: "" };
}

/** Resolve the persisted provider selection, treating blank values as unset. */
export function resolveSelectedProvider(value: unknown): string {
  const providerId = typeof value === "string" ? value.trim() : "";
  return providerId || "deepseek";
}

/** 持久化页面配置的预设 Provider 模型，并刷新对应运行时 Provider。 */
export async function saveProviderModels(providers: unknown[]): Promise<void> {
  const configured: ProviderModelsConfig = {};

  for (const value of providers) {
    if (!value || typeof value !== "object") continue;
    const provider = value as {
      id?: unknown;
      isCustom?: unknown;
      models?: unknown;
    };
    if (
      typeof provider.id !== "string" ||
      !(provider.id in PROVIDER_LABELS) ||
      provider.isCustom === true ||
      !Array.isArray(provider.models)
    ) {
      continue;
    }
    const providerId = provider.id;

    const providerModels = provider.models
      .filter(model => !(model && typeof model === "object" && (model as { isVirtual?: boolean }).isVirtual))
      .map((model) => {
        const rawId = typeof model === "string"
          ? model
          : model && typeof model === "object" &&
              typeof (model as { id?: unknown }).id === "string"
          ? (model as { id: string }).id
          : "";
        const id = normalizeModelId(providerId, rawId);
        if (!id) return undefined;
        const rawName = model && typeof model === "object"
          ? (model as { name?: unknown }).name
          : undefined;
        const rawContextWindow = model && typeof model === "object"
          ? (model as { contextWindow?: unknown }).contextWindow
          : undefined;
        const rawMaxInputTokens = model && typeof model === "object"
          ? (model as { maxInputTokens?: unknown }).maxInputTokens
          : undefined;
        const rawMaxOutputTokens = model && typeof model === "object"
          ? (model as { maxOutputTokens?: unknown }).maxOutputTokens
          : undefined;
        return {
          id,
          name: typeof rawName === "string" && rawName.trim()
            ? rawName.trim()
            : id,
          ...(typeof rawContextWindow === "number" &&
              Number.isFinite(rawContextWindow) && rawContextWindow > 0
            ? { contextWindow: Math.floor(rawContextWindow) }
            : {}),
          ...(typeof rawMaxInputTokens === "number" &&
              Number.isFinite(rawMaxInputTokens) && rawMaxInputTokens > 0
            ? { maxInputTokens: Math.floor(rawMaxInputTokens) }
            : {}),
          ...(typeof rawMaxOutputTokens === "number" &&
              Number.isFinite(rawMaxOutputTokens) && rawMaxOutputTokens > 0
            ? { maxOutputTokens: Math.floor(rawMaxOutputTokens) }
            : {}),
        } satisfies ConfiguredProviderModel;
      })
      .filter((model): model is ConfiguredProviderModel => Boolean(model));
    configured[providerId] = [
      ...new Map(providerModels.map((model) => [model.id, model])).values(),
    ];
  }

  setSetting("provider_models", JSON.stringify(configured));
  for (const [providerId, modelIds] of Object.entries(configured)) {
    if (
      providerId === "ollama" ||
      (modelIds.length === 0 && !registered.has(providerId))
    ) {
      continue;
    }
    await registerProvider(providerId);
  }
}

/** 动态构造并注册 Provider 实例 */
async function buildProviderInstance(providerId: string): Promise<any> {
  // 1. 自定义 OpenAI Provider
  const customList = getCustomProviders();
  const customConfig = customList.find((c) => c.id === providerId);
  if (customConfig) {
    const key = customConfig.apiKey || (await getApiKey(providerId)) || "unused";
    // 直接用用户填写的 Base URL，不再补 /v1：补上会让
    // https://open.bigmodel.cn/api/coding/paas/v4 这类非 /v1 结尾的渠道拼出 404 路径，
    // 且与连通性测试实际请求的地址不一致。
    const baseUrl = customConfig.baseUrl.trim().replace(/\/$/, "");
    const modelNames = customConfig.models.length > 0 ? customConfig.models : ["default-model"];
    return createProvider({
      id: customConfig.id,
      name: customConfig.name || customConfig.id,
      baseUrl,
      auth: createApiKeyAuth(key),
      models: modelNames.map((m) => {
        const limits = customConfig.modelLimits?.[m];
        const item = createModelItem(
          m,
          m,
          customConfig.id,
          baseUrl,
          limits?.contextWindow,
          undefined,
          limits?.maxOutputTokens,
        );
        // 用户为该模型显式配置的最大输出优先于全局 agent_max_tokens。
        return limits?.maxOutputTokens
          ? { ...item, maxTokens: Math.min(limits.maxOutputTokens, item.contextWindow) }
          : item;
      }),
      api: openAICompletionsApi(),
    });
  }

  // 2. 本地 Ollama Provider
  if (providerId === "ollama") {
    const rawOllamaUrl = getSetting("ollama_base_url", "http://127.0.0.1:11434");
    const baseUrl = rawOllamaUrl.endsWith("/v1")
      ? rawOllamaUrl
      : `${rawOllamaUrl.replace(/\/$/, "")}/v1`;

    let modelItems = PRESET_MODELS.ollama.map((m) => m.id);

    // 尝试向 Ollama 服务自动侦测本地已被 pull 的模型
    try {
      const rootUrl = rawOllamaUrl.replace(/\/v1\/?$/, "").replace(/\/$/, "");
      const res = await fetch(`${rootUrl}/api/tags`, { signal: AbortSignal.timeout(3000) });
      if (res.ok) {
        const data = (await res.json()) as { models?: unknown[] };
        if (Array.isArray(data.models) && data.models.length > 0) {
          modelItems = data.models.map((m: any) => m.name || m.model);
        }
      }
    } catch (e) {
      console.warn("[ollama] 本地模型连通检测:", (e as Error).message);
    }

    return createProvider({
      id: "ollama",
      name: "Ollama (本地大模型)",
      baseUrl,
      auth: createApiKeyAuth("ollama"),
      models: modelItems.map((m) => createModelItem(m, m, "ollama", baseUrl)),
      api: openAICompletionsApi(),
    });
  }

  // 3. 原生 pi-ai 官方 SDK 提供商 (DeepSeek, Kimi, MiniMax, OpenAI, Anthropic, Google, ZAI)
  if (providerId === "deepseek") {
    // 自定义模型或 baseUrl 时改走通用 OpenAI 兼容分支；内置 DeepSeek
    // 模型继续使用官方 Provider，避免丢失其专用兼容参数。
    const configuredModels = getProviderModels()[providerId] ?? [];
    const builtInDeepSeekModels = new Set([
      DEFAULT_DEEPSEEK_MODEL_ID,
      "deepseek-v4-pro",
    ]);
    const hasCustomModels = configuredModels.some(
      (model) => !builtInDeepSeekModels.has(model.id),
    );
    const configuredBaseUrl = normalizeBaseUrl(
      providerId,
      getSetting(`provider_base_url_${providerId}`, ""),
    );
    const hasCustomBaseUrl = Boolean(configuredBaseUrl);
    if (!hasCustomModels && !hasCustomBaseUrl) {
      return (await import("@earendil-works/pi-ai/providers/deepseek")).deepseekProvider();
    }
  }
  if (providerId === "moonshot") {
    return (await import("@earendil-works/pi-ai/providers/moonshotai-cn")).moonshotaiCnProvider();
  }
  if (providerId === "minimax") {
    return (await import("@earendil-works/pi-ai/providers/minimax-cn")).minimaxCnProvider();
  }
  if (providerId === "openrouter") {
    return (await import("@earendil-works/pi-ai/providers/openrouter")).openrouterProvider();
  }
  if (providerId === "openai") {
    return (await import("@earendil-works/pi-ai/providers/openai")).openaiProvider();
  }
  if (providerId === "anthropic") {
    return (await import("@earendil-works/pi-ai/providers/anthropic")).anthropicProvider();
  }
  if (providerId === "google") {
    return (await import("@earendil-works/pi-ai/providers/google")).googleProvider();
  }
  if (providerId === "zai") {
    return (await import("@earendil-works/pi-ai/providers/zai")).zaiProvider();
  }

  // 4. 通用 OpenAI 规范兼容提供商（智谱 GLM、零一万物 01.AI、通义千问 Qwen 等）
  const customBaseUrl = normalizeBaseUrl(
    providerId,
    getSetting(`provider_base_url_${providerId}`, ""),
  );
  const baseUrl = customBaseUrl || PROVIDER_BASE_URLS[providerId] || "https://api.openai.com/v1";
  const apiKey = (await getApiKey(providerId)) || "unused";
  const configuredModels = getProviderModels()[providerId];
  const presets: ConfiguredProviderModel[] = configuredModels ??
    (PRESET_MODELS[providerId] ||
      [{ id: `${providerId}-default`, name: `${providerId}-default` }])
      .map((model) => ({ ...model }));

  return createProvider({
    id: providerId,
    name: PROVIDER_LABELS[providerId] || providerId,
    baseUrl,
    auth: createApiKeyAuth(apiKey),
    models: presets.map((m) =>
      createModelItem(
        m.id,
        m.name,
        providerId,
        baseUrl,
        m.contextWindow,
        m.maxInputTokens,
        m.maxOutputTokens,
      )
    ),
    api: openAICompletionsApi(),
  });
}

/** 初始化：加载并注册默认与已有 API Key 的 Provider */
export function initModels(): Promise<void> {
  if (initialized) return Promise.resolve();
  if (initializationPromise) return initializationPromise;

  initializationPromise = (async () => {
    // 默认注册 DeepSeek 和 Ollama
    await registerProvider("deepseek");
    await registerProvider("ollama");

    // 数据库选中的 Provider 必须可用；API Key 在真正请求时再校验。
    const selectedProvider = resolveSelectedProvider(
      getSetting("default_provider", "deepseek"),
    );
    if (!registered.has(selectedProvider)) {
      await registerProvider(selectedProvider);
    }

    // 注册预设 Provider 中有 API key 的那些
    for (const pId of Object.keys(PROVIDER_LABELS)) {
      if (registered.has(pId)) continue;
      if (await hasProviderCredential(pId)) {
        await registerProvider(pId);
      }
    }

    // 注册自定义 Provider
    const customList = getCustomProviders();
    for (const c of customList) {
      await registerProvider(c.id);
    }

    initialized = true;
    console.log("[models] 全局模型模块初始化完成，已注册:", [...registered]);
  })().catch((error) => {
    initializationPromise = null;
    throw error;
  });

  return initializationPromise;
}

/** 动态注册/刷新指定 Provider */
export async function registerProvider(providerId: string): Promise<boolean> {
  if (!providerId.trim()) {
    console.warn("[models] 跳过空 provider 注册");
    return false;
  }
  try {
    const rawProvider = await buildProviderInstance(providerId);
    const providerInst = withApiKeyResolver(
      rawProvider,
      () => getApiKey(providerId),
    );
    models.setProvider(providerInst);
    registered.add(providerId);
    console.log(`[models] 已注册/重载 provider: ${providerId}`);
    return true;
  } catch (e) {
    console.warn(`[models] 注册 ${providerId} 失败:`, (e as Error).message);
    return false;
  }
}

/** 获取 model 对象 */
export function getModel(provider: string, modelId: string) {
  return models.getModel(provider, modelId);
}

/** 列出某 provider 的所有可用 model */
export function listModels(provider: string) {
  return models.getModels(provider);
}

/** 列出所有可用的 provider 及其模型结构（供前端 UI） */
export function listAllProviders(): Array<{
  id: string;
  provider: string;
  name: string;
  label: string;
  baseUrl?: string;
  isCustom?: boolean;
  models: Array<{ id: string; name: string; contextWindow?: number; isVirtual?: boolean }>;
}> {
  const result: Array<{
    id: string;
    provider: string;
    name: string;
    label: string;
    baseUrl?: string;
    isCustom?: boolean;
    models: Array<{ id: string; name: string; contextWindow?: number; isVirtual?: boolean }>;
  }> = [];

  // 1. 预设服务商（DeepSeek, 智谱, Kimi, MiniMax, OpenAI, Claude, Gemini, ZAI, 零一万物, 通义千问, Ollama）
  for (const pId of Object.keys(PROVIDER_LABELS)) {
    const configuredModels = getProviderModels()[pId] || [];
    // 预设 provider 以用户配置为准（避免把运行时内置模型回写进配置）；
    // ollama 例外：展示本地自动侦测到的模型。
    const registeredModels = models.getModels(pId);
    const modelList = (pId === "ollama" || (pId === "openai" && hasOpenAISubscription() && configuredModels.length === 0)) && registeredModels && registeredModels.length > 0
      ? registeredModels.map((m) => ({ id: m.id, name: m.name || m.id }))
      : configuredModels.map((model) => ({ ...model }));

    const customBaseUrl = getSetting(`provider_base_url_${pId}`, "");

    result.push({
      id: pId,
      provider: pId,
      name: PROVIDER_LABELS[pId],
      label: PROVIDER_LABELS[pId],
      baseUrl: customBaseUrl || PROVIDER_BASE_URLS[pId],
      isCustom: false,
      models: modelList,
    });
  }

  // 2. 自定义 OpenAI 服务商
  const customList = getCustomProviders();
  for (const c of customList) {
    const registeredModels = models.getModels(c.id);
    const modelList = registeredModels && registeredModels.length > 0
      ? registeredModels.map((m) => ({ id: m.id, name: m.name || m.id }))
      : c.models.map((m) => ({ id: m, name: m }));

    result.push({
      id: c.id,
      provider: c.id,
      name: c.name,
      label: c.name,
      baseUrl: c.baseUrl,
      isCustom: true,
      models: modelList,
    });
  }

  for (const virtual of getPluginVirtualModels()) {
    let provider = result.find(item => item.id === virtual.provider);
    if (!provider) {
      provider = { id: virtual.provider, provider: virtual.provider, name: virtual.provider, label: virtual.provider, models: [] };
      result.push(provider);
    }
    provider.models = [...provider.models.filter(model => model.id !== virtual.id), { id: virtual.id, name: virtual.name, contextWindow: virtual.contextWindow, isVirtual: true }];
  }
  return result;
}

/** 列出所有可注册的预设 provider ID */
export function listAvailableProviders(): string[] {
  const customIds = getCustomProviders().map((c) => c.id);
  return [...Object.keys(PROVIDER_LABELS), ...customIds];
}

/** 暴露 models 容器实例 */
export function getModels() {
  return models;
}
