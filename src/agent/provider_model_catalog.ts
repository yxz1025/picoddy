export interface ProviderCatalogModel {
  id: string;
  name: string;
  description?: string;
  contextWindow?: number;
  maxOutputTokens?: number;
  features: string[];
}

export const OFFICIAL_MODEL_CATALOG_PROVIDERS = [
  "deepseek",
  "moonshot",
  "minimax",
  "openai",
  "anthropic",
  "google",
  "zai",
  "qwen",
] as const;

type OfficialCatalogProvider = typeof OFFICIAL_MODEL_CATALOG_PROVIDERS[number];

const PROVIDER_NAMES: Record<OfficialCatalogProvider, string> = {
  deepseek: "DeepSeek",
  moonshot: "Kimi",
  minimax: "MiniMax",
  openai: "OpenAI",
  anthropic: "Anthropic",
  google: "Google Gemini",
  zai: "阶跃星辰",
  qwen: "通义千问",
};

function isOfficialQwenHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return host === "dashscope.aliyuncs.com" ||
    host === "dashscope-intl.aliyuncs.com" ||
    host === "cn-hongkong.dashscope.aliyuncs.com" ||
    host === "dashscope-us.aliyuncs.com" ||
    host.endsWith(".maas.aliyuncs.com");
}

function isOfficialOpenAIHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return host === "api.openai.com" || host.endsWith(".api.openai.com");
}

function isOfficialProviderHost(provider: OfficialCatalogProvider, hostname: string): boolean {
  const host = hostname.toLowerCase();
  switch (provider) {
    case "deepseek": return host === "api.deepseek.com";
    case "moonshot": return host === "api.moonshot.cn";
    case "minimax":
      return host === "api.minimax.io" || host === "api.minimaxi.com" ||
        host === "api.minimax.chat";
    case "openai": return isOfficialOpenAIHost(host);
    case "anthropic": return host === "api.anthropic.com";
    case "google": return host === "generativelanguage.googleapis.com";
    case "zai": return host === "api.stepfun.com";
    case "qwen": return isOfficialQwenHost(host);
  }
}

function parseOfficialBaseUrl(provider: OfficialCatalogProvider, baseUrl: string): URL {
  let url: URL;
  try {
    url = new URL(baseUrl);
  } catch {
    throw new Error(`${PROVIDER_NAMES[provider]} Base URL 无效`);
  }
  if (url.protocol !== "https:") {
    throw new Error(`${PROVIDER_NAMES[provider]} 模型目录仅允许使用 HTTPS`);
  }
  if (!isOfficialProviderHost(provider, url.hostname)) {
    throw new Error(`${PROVIDER_NAMES[provider]} 模型目录仅允许访问服务商官方域名`);
  }
  return url;
}

function appendModelsPath(baseUrl: URL): URL {
  const url = new URL(baseUrl);
  const path = url.pathname.replace(/\/+$/, "");
  url.pathname = `${path}/models`.replace(/\/+/g, "/");
  url.search = "";
  url.hash = "";
  return url;
}

/** Resolve an official model-list endpoint from its inference Base URL. */
export function resolveProviderCatalogUrl(providerId: string, baseUrl: string): URL {
  if (!OFFICIAL_MODEL_CATALOG_PROVIDERS.includes(providerId as OfficialCatalogProvider)) {
    if (providerId === "zhipu") {
      throw new Error("智谱 AI 当前未公开官方模型列表 API，请继续手动添加模型 ID");
    }
    if (providerId === "zeroone") {
      throw new Error("零一万物已公告将停止开放平台 API 服务，请迁移渠道或手动维护模型 ID");
    }
    throw new Error("该渠道暂不支持从官方 API 获取模型列表");
  }

  const provider = providerId as OfficialCatalogProvider;
  const inferenceUrl = parseOfficialBaseUrl(provider, baseUrl);
  if (provider === "qwen") {
    const url = new URL("/api/v1/models", inferenceUrl.origin);
    url.searchParams.append("providers", "qwen");
    url.searchParams.append("capabilities", "TG");
    url.searchParams.append("features", "function-calling");
    url.searchParams.set("supports", "inference");
    url.searchParams.set("language", "zh-CN");
    url.searchParams.set("page_no", "1");
    url.searchParams.set("page_size", "100");
    return url;
  }
  if (provider === "anthropic") return new URL("/v1/models?limit=1000", inferenceUrl.origin);
  if (provider === "google") return new URL("/v1beta/models?pageSize=1000", inferenceUrl.origin);
  return appendModelsPath(inferenceUrl);
}

/** Compatibility helper retained for the original Qwen implementation. */
export function resolveQwenCatalogUrl(baseUrl: string): URL {
  return resolveProviderCatalogUrl("qwen", baseUrl);
}

async function readCatalogError(response: Response, providerName: string): Promise<string> {
  const fallback = `${providerName} 模型目录请求失败 (${response.status})`;
  try {
    const body = await response.json() as Record<string, any>;
    const message = typeof body.message === "string"
      ? body.message.trim()
      : typeof body.error?.message === "string"
      ? body.error.message.trim()
      : "";
    return message || fallback;
  } catch {
    return fallback;
  }
}

function optionalPositiveNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : undefined;
}

function normalizeOpenAIModels(payload: any): ProviderCatalogModel[] {
  if (!Array.isArray(payload?.data)) throw new Error("模型目录响应格式不正确");
  return payload.data.map((model: any) => ({
    id: typeof model?.id === "string" ? model.id.trim() : "",
    name: typeof model?.name === "string" && model.name.trim()
      ? model.name.trim()
      : typeof model?.display_name === "string" && model.display_name.trim()
      ? model.display_name.trim()
      : typeof model?.id === "string"
      ? model.id.trim()
      : "",
    ...(optionalPositiveNumber(model?.context_length ?? model?.context_window)
      ? { contextWindow: model.context_length ?? model.context_window }
      : {}),
    features: [],
  }));
}

function normalizeAnthropicModels(payload: any): ProviderCatalogModel[] {
  if (!Array.isArray(payload?.data)) throw new Error("Anthropic 模型目录响应格式不正确");
  return payload.data.map((model: any) => ({
    id: typeof model?.id === "string" ? model.id.trim() : "",
    name: typeof model?.display_name === "string" && model.display_name.trim()
      ? model.display_name.trim()
      : typeof model?.id === "string"
      ? model.id.trim()
      : "",
    features: [],
  }));
}

function normalizeGoogleModels(payload: any): ProviderCatalogModel[] {
  if (!Array.isArray(payload?.models)) throw new Error("Gemini 模型目录响应格式不正确");
  return payload.models
    .filter((model: any) => !Array.isArray(model?.supportedGenerationMethods) ||
      model.supportedGenerationMethods.includes("generateContent"))
    .map((model: any) => {
      const resourceName = typeof model?.name === "string" ? model.name.trim() : "";
      const id = typeof model?.baseModelId === "string" && model.baseModelId.trim()
        ? model.baseModelId.trim()
        : resourceName.replace(/^models\//, "");
      return {
        id,
        name: typeof model?.displayName === "string" && model.displayName.trim()
          ? model.displayName.trim()
          : id,
        ...(typeof model?.description === "string" && model.description.trim()
          ? { description: model.description.trim() }
          : {}),
        ...(optionalPositiveNumber(model?.inputTokenLimit)
          ? { contextWindow: model.inputTokenLimit }
          : {}),
        features: Array.isArray(model?.supportedGenerationMethods)
          ? model.supportedGenerationMethods.filter((item: unknown): item is string =>
            typeof item === "string")
          : [],
      };
    });
}

function normalizeQwenModels(payload: any): ProviderCatalogModel[] {
  if (payload?.success === false) {
    throw new Error(typeof payload.message === "string" && payload.message.trim()
      ? payload.message.trim()
      : "阿里云模型目录返回失败");
  }
  if (!Array.isArray(payload?.output?.models)) {
    throw new Error("阿里云模型目录响应格式不正确");
  }
  return payload.output.models.map((model: any) => ({
    id: typeof model?.model === "string" ? model.model.trim() : "",
    name: typeof model?.name === "string" && model.name.trim()
      ? model.name.trim()
      : typeof model?.model === "string"
      ? model.model.trim()
      : "",
    ...(typeof model?.description === "string" && model.description.trim()
      ? { description: model.description.trim() }
      : {}),
    ...(optionalPositiveNumber(model?.model_info?.context_window)
      ? { contextWindow: model.model_info.context_window }
      : {}),
    features: Array.isArray(model?.features)
      ? model.features.filter((item: unknown): item is string => typeof item === "string")
      : [],
  }));
}

function deduplicateModels(models: ProviderCatalogModel[]): ProviderCatalogModel[] {
  const seen = new Set<string>();
  return models.filter((model) => {
    model.id = model.id.trim();
    if (!model.id || seen.has(model.id)) return false;
    seen.add(model.id);
    return true;
  }).sort((a, b) => a.name.localeCompare(b.name, "zh-CN"));
}

export async function fetchProviderModelCatalog(options: {
  providerId: string;
  baseUrl: string;
  apiKey: string;
  fetchImpl?: typeof fetch;
}): Promise<ProviderCatalogModel[]> {
  const providerId = options.providerId;
  if (!OFFICIAL_MODEL_CATALOG_PROVIDERS.includes(providerId as OfficialCatalogProvider)) {
    resolveProviderCatalogUrl(providerId, options.baseUrl);
  }
  const provider = providerId as OfficialCatalogProvider;
  const apiKey = options.apiKey.trim();
  if (!apiKey) throw new Error(`请先保存 ${PROVIDER_NAMES[provider]} API Key`);

  const headers = new Headers({ accept: "application/json" });
  if (provider === "anthropic") {
    headers.set("x-api-key", apiKey);
    headers.set("anthropic-version", "2023-06-01");
  } else if (provider === "google") {
    headers.set("x-goog-api-key", apiKey);
  } else {
    headers.set("authorization", `Bearer ${apiKey}`);
  }

  const request = options.fetchImpl ?? fetch;
  const response = await request(resolveProviderCatalogUrl(provider, options.baseUrl), {
    method: "GET",
    headers,
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw new Error(await readCatalogError(response, PROVIDER_NAMES[provider]));

  const payload = await response.json();
  const models = provider === "qwen"
    ? normalizeQwenModels(payload)
    : provider === "anthropic"
    ? normalizeAnthropicModels(payload)
    : provider === "google"
    ? normalizeGoogleModels(payload)
    : normalizeOpenAIModels(payload);
  return deduplicateModels(models);
}

export async function fetchQwenModelCatalog(options: {
  baseUrl: string;
  apiKey: string;
  fetchImpl?: typeof fetch;
}): Promise<ProviderCatalogModel[]> {
  return fetchProviderModelCatalog({ ...options, providerId: "qwen" });
}

/**
 * 自定义 OpenAI 兼容渠道的模型列表：请求用户填写的 Base URL 下的 /models。
 * 推理请求本来就会把 Key 发到这个地址，所以不做官方域名限制。
 * 容量字段各网关命名不一，按常见写法依次读取，读不到就留空。
 */
export async function fetchCustomProviderModels(options: {
  baseUrl: string;
  apiKey?: string;
  fetchImpl?: typeof fetch;
}): Promise<ProviderCatalogModel[]> {
  let baseUrl: URL;
  try {
    baseUrl = new URL(options.baseUrl.trim());
  } catch {
    throw new Error("Base URL 无效");
  }
  if (baseUrl.protocol !== "https:" && baseUrl.protocol !== "http:") {
    throw new Error("Base URL 仅支持 http 或 https");
  }
  const headers = new Headers({ accept: "application/json" });
  const apiKey = options.apiKey?.trim();
  if (apiKey) headers.set("authorization", `Bearer ${apiKey}`);

  const request = options.fetchImpl ?? fetch;
  const response = await request(appendModelsPath(baseUrl), {
    method: "GET",
    headers,
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw new Error(await readCatalogError(response, "自定义渠道"));

  const payload = await response.json() as any;
  if (!Array.isArray(payload?.data)) throw new Error("模型列表响应格式不正确，需要 OpenAI 兼容的 /models 接口");
  return deduplicateModels(payload.data.map((model: any) => {
    const id = typeof model?.id === "string" ? model.id.trim() : "";
    const contextWindow = optionalPositiveNumber(
      model?.context_length ?? model?.context_window ?? model?.max_input_tokens ??
        model?.max_model_len,
    );
    const maxOutputTokens = optionalPositiveNumber(
      model?.max_output_tokens ?? model?.max_completion_tokens ??
        model?.top_provider?.max_completion_tokens ?? model?.max_tokens,
    );
    return {
      id,
      name: typeof model?.display_name === "string" && model.display_name.trim()
        ? model.display_name.trim()
        : typeof model?.name === "string" && model.name.trim()
        ? model.name.trim()
        : id,
      ...(contextWindow ? { contextWindow: Math.floor(contextWindow) } : {}),
      ...(maxOutputTokens ? { maxOutputTokens: Math.floor(maxOutputTokens) } : {}),
      features: [],
    };
  }));
}
