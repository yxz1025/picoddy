import { randomUUID } from "../../../src/lib/uuid";
import { ApiError, requestCloudJson, unsupported } from "./cloudHttp";
import { requestCloudAutomation } from "./cloudAutomations";
import { deliveryBatchFromOutput } from '../utils/artifactPresentation';

type JsonObject = Record<string, any>;

interface CloudModel extends JsonObject {
  id: string;
  name: string;
  provider: string;
  model: string;
  baseUrl?: string;
  isDefault?: boolean;
  apiKeyConfigured?: boolean;
}

function fallbackModel(models: CloudModel[]): CloudModel | undefined {
  const configured = models.find((model) => model.isDefault);
  if (configured) return configured;
  return [...models].sort((left, right) => {
    const time = epoch(left.createdAt) - epoch(right.createdAt);
    return time || left.id.localeCompare(right.id);
  })[0];
}

interface CloudSkill extends JsonObject {
  id: string;
  name: string;
  description: string;
  version?: string;
  enabled: boolean;
}

interface CloudSkillContent extends JsonObject {
  version: string;
  description: string;
  body: string;
  files: Array<{ path: string }>;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ACTIVE_RUNS = new Set([
  "queued", "provisioning", "running", "waiting_approval", "cancelling", "cleanup_pending",
]);
const PROVIDER_NAMES: Record<string, string> = {
  openai: "OpenAI",
  anthropic: "Anthropic",
  google: "Google",
  deepseek: "DeepSeek",
  moonshot: "Moonshot",
  qwen: "通义千问",
};
const PREFS_KEY = "picoddy-cloud-desktop-preferences-v1";

let adapterUserId: string | null = null;

export function clearCloudAdapterCaches(): void {
  // The adapter deliberately keeps no resource/credential cache; clear the
  // only in-memory identity used to scope display preferences.
  adapterUserId = null;
}

export function setCloudAdapterUser(userId: string | null): void {
  adapterUserId = userId;
}

function pathOnly(path: string): string {
  const origin = typeof window === "undefined" ? "http://localhost" : window.location.origin;
  return new URL(path, origin).pathname;
}

function epoch(value: unknown): number {
  const result = typeof value === "number" ? value : Date.parse(String(value ?? ""));
  return Number.isFinite(result) ? result : Date.now();
}

function b64Utf8(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  const chunk = 0x8000;
  for (let index = 0; index < bytes.length; index += chunk) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunk));
  }
  return btoa(binary);
}

function desktopConversation(value: JsonObject, model?: CloudModel, run?: JsonObject): JsonObject {
  return {
    id: value.id,
    parentId: value.parentId,
    title: value.title,
    category: value.category,
    expertId: value.expertId,
    expertRevision: value.expertRevision,
    expertCatalogSource: value.expertId ? 'installed' : undefined,
    status: run && ACTIVE_RUNS.has(run.status) ? run.status : "idle",
    modelProvider: model?.provider ?? "",
    // Persisted models are credential resources, not provider/model pairs.
    // Keep the resource UUID in the composer so /api/prompt cannot resolve a
    // same-named model against the wrong record or endpoint.
    modelId: model?.id ?? "",
    workspaceId: value.workspaceId ?? undefined,
    ...(value.expertOperation === "create" || value.expertOperation === "edit"
      ? { expertOperation: value.expertOperation }
      : {}),
    ...(typeof value.expertTargetId === "string" ? { expertTargetId: value.expertTargetId } : {}),
    ...(typeof value.expertTargetRevision === "string"
      ? { expertTargetRevision: value.expertTargetRevision }
      : {}),
    createdAt: epoch(value.createdAt),
    updatedAt: epoch(value.updatedAt),
  };
}

function messageParts(content: unknown): Array<{ type: "text" | "thinking"; contentIndex: number; content: string }> {
  if (typeof content === "string") return [{ type: "text", contentIndex: 0, content }];
  if (!Array.isArray(content)) return [];
  const parts: Array<{ type: "text" | "thinking"; contentIndex: number; content: string }> = [];
  content.forEach((part, index) => {
    if (!part || typeof part !== "object") return;
    const item = part as JsonObject;
    if (item.type === "text" && typeof item.text === "string") {
      parts.push({ type: "text", contentIndex: index, content: item.text });
    } else if (item.type === "thinking") {
      const text = typeof item.thinking === "string" ? item.thinking : item.text;
      if (typeof text === "string") parts.push({ type: "thinking", contentIndex: index, content: text });
    }
  });
  return parts;
}

function desktopMessage(value: JsonObject): JsonObject {
  const parts = messageParts(value.content);
  const isTool = value.role === 'toolResult';
  const deliveryBatch = isTool && !value.isError && value.toolName === 'present_files'
    ? deliveryBatchFromOutput({ details: value.details }) : null;
  return {
    id: isTool && typeof value.toolCallId === 'string' ? value.toolCallId : value.id,
    role: isTool ? 'tool' : typeof value.role === "string" ? value.role : "assistant",
    content: parts.filter((part) => part.type === "text").map((part) => part.content).join(""),
    thinking: parts.filter((part) => part.type === "thinking").map((part) => part.content).join(""),
    contentParts: parts,
    ...(isTool ? {
      toolName: value.toolName, isError: value.isError === true,
      status: value.isError ? 'error' : 'success',
      ...(deliveryBatch ? { deliveryBatch } : {}),
      ...(!value.isError && value.toolName === 'show_widget' && value.details && typeof value.details === 'object' && (value.details as JsonObject).widget ? { widget: (value.details as JsonObject).widget } : {}),
    } : {}),
    createdAt: epoch(value.createdAt),
  };
}

function desktopWorkspace(value: JsonObject): JsonObject {
  return {
    id: value.id,
    name: value.name,
    dirPath: "",
    icon: "folder",
    lastOpenedAt: epoch(value.updatedAt),
    createdAt: epoch(value.createdAt),
  };
}

function desktopSkill(value: CloudSkill, content: CloudSkillContent): JsonObject {
  return {
    id: value.id,
    name: value.name,
    displayName: value.name,
    description: content.description,
    body: content.body,
    disabled: value.enabled === false,
    builtin: false,
    path: "",
    version: content.version,
  };
}

function desktopExpert(value: JsonObject): JsonObject {
  return {
    id: value.id,
    name: value.name,
    expertType: "agent",
    nickname: typeof value.nickname === 'string' ? value.nickname : value.name,
    categoryId: typeof value.categoryId === 'string' ? value.categoryId : "cloud",
    description: typeof value.description === "string"
      ? value.description
      : typeof value.prompt === "string" ? value.prompt.slice(0, 160) : "云端专家",
    prompt: value.prompt,
    systemPrompt: value.prompt,
    skillIds: Array.isArray(value.skillIds) ? value.skillIds : [],
    skills: Array.isArray(value.skillIds) ? value.skillIds : [],
    icon: typeof value.icon === 'string' ? value.icon : "🤖",
    tags: Array.isArray(value.tags) ? value.tags : [],
    quickPrompts: Array.isArray(value.quickPrompts) ? value.quickPrompts : [],
    catalogSource: "installed",
    revision: typeof value.revision === 'string' && /^[a-f0-9]{64}$/.test(value.revision)
      ? value.revision : String(value.updatedAt ?? value.id),
    available: true,
  };
}

function readPreferences(): JsonObject {
  if (!adapterUserId) return {};
  try {
    const parsed = JSON.parse(localStorage.getItem(`${PREFS_KEY}:${adapterUserId}`) ?? "{}");
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const value = parsed as JsonObject;
    return {
      ...(typeof value.language === "string" ? { language: value.language } : {}),
      ...(typeof value.fontSize === "string" ? { fontSize: value.fontSize } : {}),
    };
  } catch {
    return {};
  }
}

function writePreferences(settings: JsonObject): void {
  if (!adapterUserId) return;
  const localFields = ["language", "fontSize"];
  const current = readPreferences();
  for (const key of localFields) if (settings[key] !== undefined) current[key] = settings[key];
  try {
    localStorage.setItem(`${PREFS_KEY}:${adapterUserId}`, JSON.stringify(current));
  } catch { /* best effort */ }
}

async function cloudSettings(): Promise<JsonObject> {
  const models = await requestCloudJson<CloudModel[]>("GET", "/api/models");
  const preferences = await requestCloudJson<JsonObject>('GET', '/api/preferences');
  const grouped = new Map<string, JsonObject>();
  for (const provider of Object.keys(PROVIDER_NAMES)) {
    grouped.set(provider, { id: provider, name: PROVIDER_NAMES[provider], models: [], isCustom: false });
  }
  for (const model of models) {
    // A custom endpoint may use the same provider/model identifiers as the
    // official endpoint. Keep it out of preset cards so credentials and
    // endpoint identity cannot be conflated by the desktop-shaped UI.
    if (model.baseUrl) continue;
    const provider = grouped.get(model.provider) ?? {
      id: model.provider,
      name: model.provider,
      models: [],
      isCustom: Boolean(model.baseUrl),
    };
    provider.models.push({
      id: model.model,
      name: model.name,
      resourceId: model.id,
      apiKeyConfigured: model.apiKeyConfigured === true,
    });
    grouped.set(model.provider, provider);
  }
  const selected = fallbackModel(models);
  const customProviders = models
    .filter((item) => Boolean(item.baseUrl))
    .map((model) => ({
      id: model.id,
      name: model.name,
      provider: model.provider,
      baseUrl: model.baseUrl,
      models: [model.model],
      apiKeyConfigured: model.apiKeyConfigured === true,
    }));
  return {
    defaultProvider: selected?.provider ?? "",
    defaultModelId: selected?.model ?? "",
    defaultModelResourceId: selected?.id ?? "",
    docsDir: "",
    language: "zh-CN",
    fontSize: "14",
    autoInstallSkills: false,
    keepAwake: false,
    defaultWorkspaceDir: "",
    experienceOpt: true,
    agentSystemPrompt: "",
    agentTemperature: "0.7",
    agentMaxTokens: "4096",
    searchEngine: "google",
    sandboxSecurity: true,
    deletionProtection: true,
    bulkDeletionLimit: "50",
    builtinRuntime: true,
    runtimePython: true,
    runtimeNodejs: true,
    securityFileRules: "[]",
    securityCommandRules: "[]",
    securityNetworkRules: "[]",
    ollamaBaseUrl: "",
    customProviders,
    providers: [...grouped.values()],
    availableProviders: Object.entries(PROVIDER_NAMES).map(([id, name]) => ({ id, name })),
    ...readPreferences(),
    ...preferences,
  };
}

async function defaultModel(): Promise<CloudModel | undefined> {
  const models = await requestCloudJson<CloudModel[]>("GET", "/api/models");
  return fallbackModel(models);
}

async function saveSettings(body: JsonObject): Promise<JsonObject> {
  const before = await cloudSettings();
  const unsupportedFields = [
    "docsDir", "autoInstallSkills", "keepAwake", "defaultWorkspaceDir",
    "experienceOpt", "agentTemperature", "agentMaxTokens",
    "searchEngine", "sandboxSecurity", "deletionProtection", "bulkDeletionLimit",
    "builtinRuntime", "runtimePython", "runtimeNodejs", "securityFileRules",
    "securityCommandRules", "securityNetworkRules", "ollamaBaseUrl",
  ];
  const changed = unsupportedFields.find((key) =>
    body[key] !== undefined && JSON.stringify(body[key]) !== JSON.stringify(before[key])
  );
  if (changed) {
    unsupported(`“${changed}”是桌面设置，云端后端当前不支持该配置`, "SETTING_UNSUPPORTED");
  }
  const preferencePatch = Object.fromEntries(
    ['agentSystemPrompt', 'language', 'fontSize']
      .filter(key => body[key] !== undefined && body[key] !== before[key])
      .map(key => [key, body[key]]),
  );
  const savePreferences = async () => {
    if (Object.keys(preferencePatch).length) await requestCloudJson('PATCH', '/api/preferences', preferencePatch);
    writePreferences(body);
  };
  if (!Array.isArray(body.providers)) {
    await savePreferences();
    return cloudSettings();
  }

  let models = await requestCloudJson<CloudModel[]>("GET", "/api/models");
  const desired = new Map<string, { provider: string; model: string; name: string }>();
  for (const provider of body.providers) {
    if (!provider || typeof provider.id !== "string" || !Array.isArray(provider.models)) continue;
    for (const model of provider.models) {
      if (!model || typeof model.id !== "string" || !model.id.trim() || model.isVirtual) continue;
      desired.set(`${provider.id}\u0000${model.id}`, {
        provider: provider.id,
        model: model.id,
        name: typeof model.name === "string" && model.name.trim() ? model.name : model.id,
      });
    }
  }

  const omitted = models.find((model) =>
    !model.baseUrl && !desired.has(`${model.provider}\u0000${model.model}`)
  );
  if (omitted) {
    throw new ApiError(
      400,
      "删除模型必须使用显式云端模型删除操作，设置快照不会批量删除资源",
      "MODEL_DELETE_REQUIRES_EXPLICIT_ACTION",
    );
  }

  for (const wanted of desired.values()) {
    if (models.some((model) =>
      !model.baseUrl && model.provider === wanted.provider && model.model === wanted.model
    )) continue;
    throw new ApiError(
      400,
      `新增 ${wanted.provider}/${wanted.model} 必须一次提交模型 ID 与 API Key；请使用云端模型创建表单`,
      "MODEL_CREATE_REQUIRES_CREDENTIALS",
    );
  }

  models = await requestCloudJson<CloudModel[]>("GET", "/api/models");
  if (models.length > 0 && (!body.defaultProvider || !body.defaultModelId)) {
    throw new ApiError(
      400,
      "云端运行必须保留一个默认模型；请先选择其他模型再删除当前模型",
      "DEFAULT_MODEL_REQUIRED",
    );
  }
  if (body.defaultProvider && body.defaultModelId) {
    const resourceId = typeof body.defaultModelResourceId === "string"
      ? body.defaultModelResourceId.trim()
      : "";
    let selected: CloudModel | undefined;
    if (resourceId) {
      if (!UUID.test(resourceId)) {
        throw new ApiError(400, "defaultModelResourceId 必须是 UUID", "INVALID_MODEL_RESOURCE");
      }
      selected = models.find((model) => model.id === resourceId);
      if (
        selected &&
        (selected.provider !== body.defaultProvider || selected.model !== body.defaultModelId)
      ) {
        throw new ApiError(409, "默认模型资源与渠道或模型 ID 不一致", "MODEL_RESOURCE_MISMATCH");
      }
    } else {
      const candidates = models.filter((model) =>
        !model.baseUrl &&
        model.provider === body.defaultProvider && model.model === body.defaultModelId
      );
      if (candidates.length > 1) {
        throw new ApiError(
          409,
          "同一渠道和模型 ID 对应多个云端记录；请选择明确的模型资源",
          "MODEL_SELECTION_AMBIGUOUS",
        );
      }
      selected = candidates[0];
    }
    if (!selected) throw new ApiError(400, "所选默认模型尚未保存", "MODEL_NOT_FOUND");
    if (!selected.isDefault) {
      await requestCloudJson("PATCH", `/api/models/${encodeURIComponent(selected.id)}`, { isDefault: true });
    }
  }
  await savePreferences();
  return cloudSettings();
}

async function modelKeys(): Promise<Record<string, boolean>> {
  const models = await requestCloudJson<CloudModel[]>("GET", "/api/models");
  const result: Record<string, boolean> = {};
  for (const model of models) {
    if (!model.baseUrl) result[model.provider] ||= model.apiKeyConfigured === true;
  }
  return result;
}

async function saveModelKey(body: JsonObject): Promise<JsonObject> {
  const provider = typeof body.provider === "string" ? body.provider.trim().toLowerCase() : "";
  const key = typeof body.key === "string" ? body.key.trim() : "";
  const modelId = typeof body.modelId === "string" ? body.modelId.trim() : "";
  const modelName = typeof body.modelName === "string" && body.modelName.trim()
    ? body.modelName.trim()
    : modelId;
  const resourceId = typeof body.resourceId === "string" ? body.resourceId : undefined;
  if (!provider || !modelId) {
    throw new ApiError(400, "provider 和 modelId 必填", "INVALID_REQUEST");
  }
  if (resourceId && !UUID.test(resourceId)) {
    throw new ApiError(400, "resourceId 必须是 UUID", "INVALID_MODEL_RESOURCE");
  }
  const models = await requestCloudJson<CloudModel[]>("GET", "/api/models");
  let target: CloudModel | undefined;
  if (resourceId) {
    target = models.find((model) => model.id === resourceId);
    if (!target) throw new ApiError(404, "云端模型不存在", "MODEL_NOT_FOUND");
    if (target.baseUrl || target.provider !== provider || target.model !== modelId) {
      throw new ApiError(409, "所选模型不属于该预设渠道", "MODEL_RESOURCE_MISMATCH");
    }
  } else {
    const candidates = models.filter((model) =>
      !model.baseUrl && model.provider === provider && model.model === modelId
    );
    if (candidates.length > 1) {
      throw new ApiError(
        409,
        "同一预设渠道存在多个同名模型，请重新加载后选择明确记录",
        "MODEL_SELECTION_AMBIGUOUS",
      );
    }
    target = candidates[0];
  }

  if (target) {
    if (key) {
      await requestCloudJson("PATCH", `/api/models/${encodeURIComponent(target.id)}`, { apiKey: key });
    } else if (target.apiKeyConfigured !== true) {
      throw new ApiError(400, "该模型尚未配置 API Key", "MODEL_API_KEY_REQUIRED");
    }
    return { ok: true, model: target };
  }
  if (!key) {
    throw new ApiError(
      400,
      "新增模型时必须同时输入 API Key",
      "MODEL_API_KEY_REQUIRED",
    );
  }
  const created = await requestCloudJson<JsonObject>("POST", "/api/models", {
    name: modelName,
    provider,
    model: modelId,
    apiKey: key,
  });
  return { ok: true, model: created };
}

async function readModelResource(resourceId: string): Promise<CloudModel> {
  if (!UUID.test(resourceId)) {
    throw new ApiError(400, "resourceId 必须是 UUID", "INVALID_MODEL_RESOURCE");
  }
  const models = await requestCloudJson<CloudModel[]>("GET", "/api/models");
  const model = models.find((item) => item.id === resourceId);
  if (!model) throw new ApiError(404, "云端模型不存在", "MODEL_NOT_FOUND");
  return model;
}

function assertModelEndpoint(model: CloudModel, requestedBaseUrl: unknown): void {
  if (
    requestedBaseUrl !== undefined &&
    requestedBaseUrl !== "" &&
    requestedBaseUrl !== model.baseUrl
  ) {
    throw new ApiError(
      409,
      "请求端点与已保存模型不一致；不会向新地址发送已保存凭据",
      "MODEL_ENDPOINT_MISMATCH",
    );
  }
}

async function providerModels(providerValue: string, body: JsonObject): Promise<JsonObject> {
  const provider = providerValue.trim().toLowerCase();
  const explicitResourceId = typeof body.resourceId === "string" ? body.resourceId : undefined;
  const resourceId = explicitResourceId ?? (UUID.test(provider) ? provider : undefined);
  const apiKey = typeof body.apiKey === "string" && body.apiKey.trim() ? body.apiKey.trim() : undefined;
  if (resourceId) {
    const model = await readModelResource(resourceId);
    if (!UUID.test(provider) && provider !== model.provider) {
      throw new ApiError(409, "模型资源与渠道不一致", "MODEL_RESOURCE_MISMATCH");
    }
    assertModelEndpoint(model, body.baseUrl);
    return requestCloudJson<JsonObject>(
      "POST",
      `/api/providers/${encodeURIComponent(model.provider)}/models`,
      { ...(apiKey ? { apiKey } : {}), resourceId: model.id },
    );
  }
  const baseUrl = typeof body.baseUrl === "string" && body.baseUrl.trim()
    ? body.baseUrl.trim()
    : undefined;
  if (baseUrl && !apiKey) {
    throw new ApiError(
      400,
      "新端点必须提供本次请求使用的 API Key",
      "MODEL_API_KEY_REQUIRED",
    );
  }
  return requestCloudJson<JsonObject>(
    "POST",
    `/api/providers/${encodeURIComponent(provider)}/models`,
    { ...(apiKey ? { apiKey } : {}), ...(baseUrl ? { baseUrl } : {}) },
  );
}

async function testModelConnection(body: JsonObject): Promise<JsonObject> {
  const providerValue = typeof body.provider === "string" ? body.provider.trim().toLowerCase() : "";
  if (!providerValue) throw new ApiError(400, "provider 必填", "INVALID_REQUEST");
  const explicitResourceId = typeof body.resourceId === "string" ? body.resourceId : undefined;
  const resourceId = explicitResourceId ?? (UUID.test(providerValue) ? providerValue : undefined);
  const apiKey = typeof body.apiKey === "string" && body.apiKey.trim() ? body.apiKey.trim() : undefined;
  if (resourceId) {
    const model = await readModelResource(resourceId);
    if (!UUID.test(providerValue) && providerValue !== model.provider) {
      throw new ApiError(409, "模型资源与渠道不一致", "MODEL_RESOURCE_MISMATCH");
    }
    assertModelEndpoint(model, body.baseUrl);
    return requestCloudJson<JsonObject>("POST", "/api/settings/test-connection", {
      provider: model.provider,
      ...(apiKey ? { apiKey } : {}),
      resourceId: model.id,
      modelId: typeof body.modelId === "string" && body.modelId.trim()
        ? body.modelId.trim()
        : model.model,
    });
  }
  const baseUrl = typeof body.baseUrl === "string" && body.baseUrl.trim()
    ? body.baseUrl.trim()
    : undefined;
  if (baseUrl && !apiKey) {
    throw new ApiError(
      400,
      "新端点必须提供本次请求使用的 API Key",
      "MODEL_API_KEY_REQUIRED",
    );
  }
  return requestCloudJson<JsonObject>("POST", "/api/settings/test-connection", {
    provider: providerValue,
    ...(apiKey ? { apiKey } : {}),
    ...(baseUrl ? { baseUrl } : {}),
    ...(typeof body.modelId === "string" && body.modelId.trim()
      ? { modelId: body.modelId.trim() }
      : {}),
  });
}

async function saveCustomProvider(body: JsonObject): Promise<JsonObject> {
  const values = Array.isArray(body.models)
    ? body.models
    : String(body.models ?? "").split(/[\s,]+/);
  const models = [...new Set(values.map((item) => String(item).trim()).filter(Boolean))];
  const name = typeof body.name === "string" ? body.name.trim() : "";
  const baseUrl = typeof body.baseUrl === "string" ? body.baseUrl.trim() : "";
  const apiKey = typeof body.apiKey === "string" ? body.apiKey.trim() : "";
  if (!name || !baseUrl || models.length === 0) {
    throw new ApiError(400, "名称、端点和至少一个模型 ID 必填", "INVALID_REQUEST");
  }
  if (body.id !== undefined) {
    if (typeof body.id !== "string" || !UUID.test(body.id)) {
      throw new ApiError(400, "id 必须是 UUID", "INVALID_MODEL_RESOURCE");
    }
    if (models.length !== 1) {
      throw new ApiError(400, "编辑时一次只能修改一个云端模型资源", "INVALID_REQUEST");
    }
    const existingModels = await requestCloudJson<CloudModel[]>("GET", "/api/models");
    const selected = existingModels.find((model) => model.id === body.id && model.baseUrl);
    if (!selected) throw new ApiError(404, "自定义模型不存在", "MODEL_NOT_FOUND");
    if (baseUrl !== selected.baseUrl && !apiKey) {
      throw new ApiError(
        400,
        "更换自定义端点时必须重新输入 API Key",
        "MODEL_API_KEY_REQUIRED",
      );
    }
    const updated = await requestCloudJson<JsonObject>(
      "PATCH",
      `/api/models/${encodeURIComponent(selected.id)}`,
      {
        name,
        provider: selected.provider,
        model: models[0],
        baseUrl,
        ...(apiKey ? { apiKey } : {}),
      },
    );
    return { ok: true, models: [updated] };
  }
  if (!apiKey) {
    throw new ApiError(400, "新增自定义模型时 API Key 必填", "MODEL_API_KEY_REQUIRED");
  }
  const created = [];
  for (const model of models) {
    created.push(await requestCloudJson("POST", "/api/models", {
      name: models.length === 1 ? name : `${name} / ${model}`,
      provider: "openai",
      model,
      baseUrl,
      apiKey,
    }));
  }
  return { ok: true, models: created };
}

async function deleteCustomProvider(id: string): Promise<void> {
  const models = await requestCloudJson<CloudModel[]>("GET", "/api/models");
  const selected = models.find((model) => model.id === id && model.baseUrl);
  if (!selected) throw new ApiError(404, "自定义模型渠道不存在", "NOT_FOUND");
  await requestCloudJson("DELETE", `/api/models/${encodeURIComponent(selected.id)}`);
}

function validateSkillDisplayName(body: JsonObject, name: string): void {
  if (
    body.displayName !== undefined &&
    (!name || String(body.displayName).trim() !== name)
  ) {
    throw new ApiError(
      400,
      "云端技能暂不支持与技能标识名不同的独立触发名称",
      "SKILL_DISPLAY_NAME_UNSUPPORTED",
    );
  }
}

function skillMarkdown(body: JsonObject): string {
  const content = typeof body.body === "string" ? body.body : "";
  const name = String(body.name ?? "").trim();
  const description = String(body.description ?? "").trim();
  if (!name) throw new ApiError(400, "技能名称必填", "INVALID_REQUEST");
  validateSkillDisplayName(body, name);
  const trailingNewline = content.endsWith("\n") ? "" : "\n";
  return `---\nname: ${JSON.stringify(name)}\ndescription: ${JSON.stringify(description)}\n---\n\n${content}${trailingNewline}`;
}

async function findSkill(nameOrId: string): Promise<CloudSkill> {
  const skills = await requestCloudJson<CloudSkill[]>("GET", "/api/skills");
  const decoded = decodeURIComponent(nameOrId);
  const skill = skills.find((item) => item.id === decoded || item.name === decoded);
  if (!skill) throw new ApiError(404, "技能不存在", "NOT_FOUND");
  return skill;
}

async function getSkillContent(skill: CloudSkill): Promise<CloudSkillContent> {
  return requestCloudJson<CloudSkillContent>("GET", `/api/skills/${skill.id}/content`);
}

async function hydratedDesktopSkill(skill: CloudSkill): Promise<JsonObject> {
  return desktopSkill(skill, await getSkillContent(skill));
}

async function createSkill(body: JsonObject): Promise<JsonObject> {
  if (body.displayName !== undefined) {
    validateSkillDisplayName(body, String(body.name ?? "").trim());
  }
  if (typeof body.filename === "string" && typeof body.contentBase64 === "string") {
    const result = await requestCloudJson<CloudSkill>("POST", "/api/skills", body);
    return hydratedDesktopSkill(result);
  }
  const markdown = skillMarkdown(body);
  const result = await requestCloudJson<CloudSkill>("POST", "/api/skills", {
    filename: "SKILL.md",
    contentBase64: b64Utf8(markdown),
  });
  if (body.disabled === true) {
    const disabled = await requestCloudJson<CloudSkill>("PATCH", `/api/skills/${result.id}`, {
      enabled: false,
      expectedVersion: result.version,
    });
    return hydratedDesktopSkill(disabled);
  }
  return hydratedDesktopSkill(result);
}

async function updateSkill(nameOrId: string, body: JsonObject): Promise<JsonObject> {
  const skill = await findSkill(nameOrId);
  validateSkillDisplayName(body, skill.name);
  const current = await getSkillContent(skill);
  const expectedVersion = typeof body.version === "string" && body.version
    ? body.version
    : undefined;
  if (!expectedVersion) {
    throw new ApiError(400, "保存技能前需要重新加载当前版本", "EXPECTED_VERSION_REQUIRED");
  }
  if (expectedVersion !== current.version) {
    throw new ApiError(409, "技能已被更新，请重新加载后再保存", "VERSION_CONFLICT");
  }
  const enabled = typeof body.disabled === "boolean" ? !body.disabled : skill.enabled;
  const description = typeof body.description === "string"
    ? body.description.trim()
    : current.description;
  const skillBody = typeof body.body === "string" ? body.body : current.body;
  const contentChanged = description !== current.description || skillBody !== current.body;

  if (!contentChanged) {
    if (skill.enabled === enabled) return desktopSkill(skill, current);
    const updated = await requestCloudJson<CloudSkill>("PATCH", `/api/skills/${skill.id}`, {
      enabled,
      expectedVersion,
    });
    return desktopSkill(updated, current);
  }
  if (current.files.length !== 1 || current.files[0]?.path !== "SKILL.md") {
    throw new ApiError(
      409,
      "该技能包含脚本或资源文件；文本编辑会破坏包内容，请上传包含全部文件的新 ZIP 版本",
      "MULTI_FILE_SKILL_EDIT_UNSAFE",
    );
  }
  if (current.hasExtraFrontmatter) {
    throw new ApiError(409, '该技能包含额外元数据；请上传完整 SKILL.md 或 ZIP 更新，避免丢失元数据', 'SKILL_METADATA_EDIT_UNSAFE');
  }
  const markdown = skillMarkdown({ name: skill.name, description, body: skillBody });
  let updated = await requestCloudJson<CloudSkill>("POST", `/api/skills/${skill.id}/versions`, {
    filename: "SKILL.md",
    contentBase64: b64Utf8(markdown),
    expectedVersion,
  });
  if (updated.enabled !== enabled) {
    updated = await requestCloudJson<CloudSkill>("PATCH", `/api/skills/${skill.id}`, {
      enabled,
      expectedVersion: updated.version,
    });
  }
  return hydratedDesktopSkill(updated);
}

async function selectedIds(body: JsonObject): Promise<JsonObject> {
  const skills = await requestCloudJson<CloudSkill[]>("GET", "/api/skills");
  const requestedSkills = Array.isArray(body.selectedSkillNames) ? body.selectedSkillNames : [];
  const skillIds = requestedSkills.map((name: unknown) => {
    const skill = skills.find((item) => item.name === name && item.enabled !== false);
    if (!skill) throw new ApiError(400, `技能 ${String(name)} 不存在或已停用`, "INVALID_SELECTION");
    return skill.id;
  });

  const preferred = Array.isArray(body.preferredConnectors) ? body.preferredConnectors : [];
  if (
    body.preferredConnectorKind === "managed-cli" ||
    preferred.some((item: JsonObject) => item?.kind === "managed-cli")
  ) {
    unsupported("云端任务不支持桌面受管 CLI 连接器；请改用 MCP 连接器");
  }
  const connectors = await requestCloudJson<JsonObject[]>("GET", "/api/connectors");
  const connectorIds: string[] = [];
  for (const item of preferred) {
    const id = item?.id;
    const found = connectors.find((connector) => connector.id === id || connector.name === id);
    if (!found) throw new ApiError(400, `连接器 ${String(id)} 不存在`, "INVALID_SELECTION");
    connectorIds.push(found.id);
  }
  if (body.preferredConnector) {
    const found = connectors.find((connector) =>
      connector.id === body.preferredConnector || connector.name === body.preferredConnector
    );
    if (!found) throw new ApiError(400, `连接器 ${body.preferredConnector} 不存在`, "INVALID_SELECTION");
    connectorIds.push(found.id);
  }

  let modelId = typeof body.modelId === "string" ? body.modelId : undefined;
  if (modelId && !UUID.test(modelId)) {
    const models = await requestCloudJson<CloudModel[]>("GET", "/api/models");
    const candidates = models.filter((model) =>
      !model.baseUrl &&
      model.model === body.modelId &&
      (!body.modelProvider || model.provider === body.modelProvider)
    );
    if (candidates.length > 1) {
      throw new ApiError(
        409,
        "所选渠道和模型 ID 对应多个云端端点；请删除重复配置后再运行",
        "MODEL_SELECTION_AMBIGUOUS",
      );
    }
    modelId = candidates[0]?.id;
    if (!modelId) throw new ApiError(400, "所选模型尚未保存到云端", "MODEL_NOT_FOUND");
  }
  return {
    skillIds,
    connectorIds: [...new Set(connectorIds)],
    fileIds: Array.isArray(body.attachmentIds) ? body.attachmentIds : [],
    ...(modelId ? { modelId } : {}),
  };
}

async function createRun(body: JsonObject): Promise<JsonObject> {
  const conversationId = body.sessionId;
  if (typeof conversationId !== "string") throw new ApiError(400, "sessionId 必填", "INVALID_REQUEST");
  const selection = await selectedIds(body);
  let referenceExpertId: string | undefined;
  if (typeof body.selectedExpertId === 'string' && body.selectedExpertId.trim()) {
    const conversation = await requestCloudJson<JsonObject>(
      'GET',
      `/api/conversations/${encodeURIComponent(conversationId)}`,
    );
    if (conversation.category === 'expert_creator') {
      referenceExpertId = body.selectedExpertId.trim();
      if (!UUID.test(referenceExpertId)) {
        throw new ApiError(400, '参考专家不存在', 'INVALID_REFERENCE_EXPERT');
      }
    }
  }
  const run = await requestCloudJson<JsonObject>("POST", `/api/conversations/${conversationId}/runs`, {
    prompt: body.text,
    mode: body.mode ?? 'craft',
    permission: body.permission === 'L1' ? 'readonly' : body.permission ?? 'default',
    ...(body.category ? { category: body.category } : {}),
    ...(referenceExpertId ? { referenceExpertId } : {}),
    ...selection,
    idempotencyKey: randomUUID(),
  });
  return { ...run, ok: true, runId: run.id, sessionId: run.conversationId };
}

async function activeRun(conversationId: string): Promise<JsonObject | undefined> {
  const runs = await requestCloudJson<JsonObject[]>(
    "GET", `/api/runs?conversationId=${encodeURIComponent(conversationId)}`,
  );
  return runs.find((run) => ACTIVE_RUNS.has(run.status));
}

async function abortRun(body: JsonObject): Promise<JsonObject> {
  if (typeof body.sessionId !== "string") throw new ApiError(400, "sessionId 必填", "INVALID_REQUEST");
  const run = await activeRun(body.sessionId);
  if (!run) return { ok: true, alreadyStopped: true };
  const cancelled = await requestCloudJson<JsonObject>("POST", `/api/runs/${run.id}/cancel`, {});
  return { ...cancelled, ok: true, runId: cancelled.id };
}

function rejectKnownDesktopOnly(path: string): void {
  const capability = [
    ["/api/plugins", "云端版本未接入桌面插件管理"],
    ["/api/tapd", "云端版本未接入 TAPD 企业工作台"],
    ["/api/microapp", "云端版本不支持本地微应用脚手架"],
    ["/api/system", "浏览器不能管理桌面系统权限"],
    ["/api/preview", "本地路径预览不可用于云端；请使用云文件预览"],
    ["/api/file", "浏览器不能读取客户端本地路径"],
    ["/api/open", "浏览器不能调用桌面文件打开器"],
    ["/api/pick-dir", "云端工作区不支持选择客户端本地目录"],
  ].find(([prefix]) => path === prefix || path.startsWith(`${prefix}/`));
  if (capability) unsupported(capability[1]);
}

export async function requestDesktopApi<T = any>(method: string, path: string, body?: any): Promise<T> {
  const pathname = pathOnly(path);
  rejectKnownDesktopOnly(pathname);

  if (pathname === "/api/skillhub/auth/ensure" && method === "POST") {
    return requestCloudJson<T>("POST", pathname, body ?? {});
  }
  if (pathname === "/api/skillhub/auth/config" && method === "GET") {
    return requestCloudJson<T>("GET", pathname);
  }
  if (pathname === "/api/skillhub/auth/config" && method === "POST") {
    throw new ApiError(
      405,
      "SkillHub 认证由云端服务统一管理",
      "SKILLHUB_AUTH_SERVER_MANAGED",
    );
  }
  if (
    method === "GET" &&
    (pathname === "/api/skillhub/skills" ||
      pathname === "/api/skillhub/experts" ||
      pathname === "/api/skillhub/namespaces" ||
      /^\/api\/skillhub\/experts\/[^/]+\/[^/]+$/.test(pathname))
  ) {
    return requestCloudJson<T>("GET", path);
  }
  if (pathname === "/api/skillhub/install" && method === "POST") {
    const installed = await requestCloudJson<CloudSkill>("POST", pathname, body ?? {});
    return desktopSkill(installed, {
      version: installed.version ?? "",
      description: installed.description ?? "",
      body: "",
      files: [],
    }) as T;
  }
  if (pathname === "/api/skillhub/experts/install" && method === "POST") {
    return requestCloudJson<T>("POST", pathname, body ?? {});
  }
  if (pathname === "/api/skillhub" || pathname.startsWith("/api/skillhub/")) {
    throw new ApiError(404, "SkillHub 接口不存在", "NOT_FOUND");
  }

  if (method === "GET" && pathname === "/api/conv") {
    const [listed, models, runs] = await Promise.all([
      requestCloudJson<JsonObject[]>("GET", "/api/conversations"),
      requestCloudJson<CloudModel[]>("GET", "/api/models"),
      requestCloudJson<JsonObject[]>("GET", "/api/runs"),
    ]);
    let values = listed;
    const origin = typeof window === "undefined" ? "http://localhost" : window.location.origin;
    const search = new URL(path, origin).searchParams.get("search")?.trim().toLowerCase();
    if (search) values = values.filter((item) => String(item.title).toLowerCase().includes(search));
    const fallback = fallbackModel(models);
    return values.map((value) => {
      const run = runs.find((item) => item.conversationId === value.id);
      const modelId = run?.selection?.model?.id;
      const selected = models.find((model) => model.id === modelId) ?? fallback;
      return desktopConversation(value, selected, run);
    }) as T;
  }
  if (method === "POST" && pathname === "/api/conv") {
    if (
      (body?.category && !['assistant', 'skill_creator', 'expert_creator'].includes(body.category)) ||
      (body?.expertOperation && !(body.category === 'expert_creator' && body.expertOperation === 'create')) ||
      body?.expertTargetId
    ) {
      unsupported("云端会话不支持桌面技能/专家编辑会话类型");
    }
    const model = await defaultModel();
    const value = await requestCloudJson<JsonObject>("POST", "/api/conversations", {
      title: body?.title ?? "新对话",
      category: body?.category ?? 'assistant',
      ...(body?.workspaceId ? { workspaceId: body.workspaceId } : {}),
    });
    return desktopConversation(value, model) as T;
  }
  const legacyConversation = pathname.match(/^\/api\/conv\/([^/]+)$/);
  if (legacyConversation && method === "DELETE") {
    await requestCloudJson("DELETE", `/api/conversations/${legacyConversation[1]}`);
    return undefined as T;
  }
  if (pathname.match(/^\/api\/conv\/[^/]+\/(fork|export)$/)) {
    unsupported("云端会话暂不支持桌面分叉或本地导出接口");
  }
  const messages = pathname.match(/^\/api\/msgs\/([^/]+)$/);
  if (messages && method === "GET") {
    const values = await requestCloudJson<JsonObject[]>("GET", `/api/conversations/${messages[1]}/messages`);
    return values.map(desktopMessage) as T;
  }
  if (method === "POST" && pathname === "/api/prompt") return createRun(body ?? {}) as Promise<T>;
  if (method === "POST" && pathname === "/api/abort") return abortRun(body ?? {}) as Promise<T>;

  if (method === "GET" && pathname === "/api/settings") return cloudSettings() as Promise<T>;
  if (method === "POST" && pathname === "/api/settings") return saveSettings(body ?? {}) as Promise<T>;
  if (method === "GET" && pathname === "/api/settings/keys") return modelKeys() as Promise<T>;
  if (method === "POST" && pathname === "/api/settings/keys") return saveModelKey(body ?? {}) as Promise<T>;
  if (pathname.startsWith("/api/settings/keys/") && method === "DELETE") {
    unsupported("云端 API 不支持仅清除密钥；请删除对应模型配置", "MODEL_KEY_DELETE_UNSUPPORTED");
  }
  const providerCatalog = pathname.match(/^\/api\/providers\/([^/]+)\/models$/);
  if (providerCatalog && method === "POST") {
    return providerModels(decodeURIComponent(providerCatalog[1]), body ?? {}) as Promise<T>;
  }
  if (method === "POST" && pathname === "/api/settings/test-connection") {
    return testModelConnection(body ?? {}) as Promise<T>;
  }
  if (method === "POST" && pathname === "/api/settings/custom-providers") {
    return saveCustomProvider(body ?? {}) as Promise<T>;
  }
  const customProvider = pathname.match(/^\/api\/settings\/custom-providers\/([^/]+)$/);
  if (customProvider && method === "DELETE") {
    await deleteCustomProvider(customProvider[1]);
    return undefined as T;
  }
  if (pathname.startsWith("/api/settings/") || pathname.startsWith("/api/providers/") || pathname.startsWith("/api/ollama/")) {
    unsupported("云端不提供桌面订阅或本机模型设置");
  }

  if (method === "GET" && pathname === "/api/workspaces") {
    const values = await requestCloudJson<JsonObject[]>("GET", "/api/workspaces");
    return values.map(desktopWorkspace) as T;
  }
  if (method === "POST" && pathname === "/api/workspaces") {
    if (body?.dirPath) unsupported("云端空间不能绑定客户端本地目录");
    if (body?.icon && body.icon !== "folder") unsupported("云端空间当前不支持自定义工作区图标");
    const value = await requestCloudJson<JsonObject>("POST", "/api/workspaces", { name: body?.name, description: "" });
    return desktopWorkspace(value) as T;
  }
  const workspace = pathname.match(/^\/api\/workspaces\/([^/]+)$/);
  if (workspace && method === "PUT") {
    if (body?.dirPath) unsupported("云端空间不能绑定客户端本地目录");
    if (body?.icon && body.icon !== "folder") unsupported("云端空间当前不支持自定义工作区图标");
    if (body?.name === undefined) unsupported("云端空间当前只能修改名称");
    const value = await requestCloudJson<JsonObject>("PATCH", `/api/workspaces/${workspace[1]}`, {
      ...(body?.name !== undefined ? { name: body.name } : {}),
    });
    return desktopWorkspace(value) as T;
  }
  if (workspace && method === "DELETE") {
    await requestCloudJson("DELETE", `/api/workspaces/${workspace[1]}`);
    return undefined as T;
  }
  const conversationWorkspace = pathname.match(/^\/api\/conversations\/([^/]+)\/workspace$/);
  if (conversationWorkspace && method === "POST") {
    return requestCloudJson("PATCH", `/api/conversations/${conversationWorkspace[1]}`, {
      workspaceId: body?.workspaceId ?? null,
    }) as Promise<T>;
  }

  if (pathname === "/api/skills" && method === "GET") {
    const values = await requestCloudJson<CloudSkill[]>("GET", "/api/skills");
    return Promise.all(values.map(hydratedDesktopSkill)) as Promise<T>;
  }
  if (pathname === "/api/skills" && method === "POST") return createSkill(body ?? {}) as Promise<T>;
  const skill = pathname.match(/^\/api\/skills\/([^/]+)$/);
  if (skill && method === "PUT") return updateSkill(skill[1], body ?? {}) as Promise<T>;
  if (skill && method === "DELETE") {
    const found = await findSkill(skill[1]);
    await requestCloudJson("DELETE", `/api/skills/${found.id}`);
    return undefined as T;
  }
  const skillEdit = pathname.match(/^\/api\/skills\/([^/]+)\/edit-session$/);
  if (skillEdit && method === 'POST') {
    const found = await findSkill(decodeURIComponent(skillEdit[1]));
    const value = await requestCloudJson<JsonObject>('POST', `/api/skills/${found.id}/edit-session`, { workspaceId: body?.workspaceId });
    return desktopConversation(value, await defaultModel()) as T;
  }
  const expertEdit = pathname.match(/^\/api\/experts\/([^/]+)\/edit-session$/);
  if (expertEdit && method === 'POST') {
    const value = await requestCloudJson<JsonObject>(
      'POST',
      `/api/experts/${expertEdit[1]}/edit-session`,
      { ...(body?.workspaceId ? { workspaceId: body.workspaceId } : {}) },
    );
    return desktopConversation(value, await defaultModel()) as T;
  }
  if (pathname.includes("/edit-session")) unsupported("云端专家包编辑会话尚未接入");
  if (pathname.match(/^\/api\/experts\/[^/]+\/open-folder$/)) {
    unsupported("浏览器不能打开云端专家的服务器目录");
  }

  if (pathname === "/api/experts" && method === "GET") {
    const values = await requestCloudJson<JsonObject[]>("GET", "/api/experts");
    return values.map(desktopExpert) as T;
  }
  if (pathname === "/api/experts/installed" && method === "GET") {
    const values = await requestCloudJson<JsonObject[]>("GET", "/api/experts");
    return { experts: values.map(desktopExpert), diagnostics: [], refreshed: true } as T;
  }
  const expert = pathname.match(/^\/api\/experts\/([^/]+)$/);
  if (expert && method === "GET") {
    const values = await requestCloudJson<JsonObject[]>("GET", "/api/experts");
    const value = values.find((item) => item.id === expert[1]);
    if (!value) throw new ApiError(404, "专家不存在", "NOT_FOUND");
    return desktopExpert(value) as T;
  }
  if (expert && method === "DELETE") {
    return requestCloudJson('DELETE', `/api/experts/${expert[1]}`) as Promise<T>;
  }
  if (pathname.match(/^\/api\/conversations\/[^/]+\/expert$/)) {
    return requestCloudJson(method, path, body) as Promise<T>;
  }

  if (pathname === "/api/mcp" && (method === "GET" || method === "POST")) {
    return requestCloudJson<T>(method, path, method === "POST" ? body ?? {} : undefined);
  }
  if (
    method === "POST" &&
    (pathname === "/api/mcp/connect" || pathname === "/api/mcp/disconnect")
  ) {
    return requestCloudJson<T>("POST", pathname, body ?? {});
  }
  if (pathname === "/api/mcp/tools" && method === "GET") {
    return requestCloudJson<T>("GET", path);
  }
  if (pathname === "/api/mcp/oauth" && (method === "GET" || method === "POST")) {
    return requestCloudJson<T>(method, path, method === "POST" ? body ?? {} : undefined);
  }
  if (pathname === "/api/mcp/oauth/callback" && method === "GET") {
    return requestCloudJson<T>("GET", path);
  }
  if (pathname === '/api/mcp/presets/knowledge' && method === 'POST') {
    return requestCloudJson<T>('POST', pathname, body ?? {});
  }
  if (pathname === "/api/mcp" || pathname.startsWith("/api/mcp/")) {
    return requestCloudJson<T>(method, path, method === 'GET' || method === 'DELETE' ? undefined : body ?? {});
  }
  if (pathname === "/api/connectors" || pathname.startsWith("/api/connectors/")) {
    unsupported("此面板管理的是桌面受管 CLI；云端 MCP 连接器请使用连接器配置面板");
  }

  if (pathname === "/api/memories" && method === "GET") {
    const values = await requestCloudJson<JsonObject[]>("GET", path.replace("/api/memories", "/api/memories"));
    return { items: values.map((item) => ({
      ...item,
      scope: item.scope ?? "user",
      kind: "memory",
      createdAt: epoch(item.createdAt),
    })) } as T;
  }

  if (pathname === "/api/confirm" && method === "POST") {
    let run: JsonObject | undefined;
    if (body?.runId !== undefined) {
      if (typeof body.runId !== 'string' || !UUID.test(body.runId)) {
        throw new ApiError(400, 'runId 必须是 UUID', 'INVALID_RUN_ID');
      }
      run = { id: body.runId };
    } else if (typeof body?.sessionId === "string") {
      run = await activeRun(body.sessionId);
    }
    if (!run && typeof body?.requestId === "string") {
      const runs = await requestCloudJson<JsonObject[]>("GET", "/api/runs");
      for (const candidate of runs.filter((item) => ACTIVE_RUNS.has(item.status))) {
        const approvals = await requestCloudJson<JsonObject[]>("GET", `/api/runs/${candidate.id}/approvals`);
        if (approvals.some((approval) => approval.id === body.requestId && approval.status === "pending")) {
          run = candidate;
          break;
        }
      }
    }
    if (!run) throw new ApiError(409, "没有等待审批的运行", "RUN_NOT_ACTIVE");
    return requestCloudJson("POST", `/api/runs/${run.id}/approvals/${body.requestId}`, {
      approved: body.approved === true,
    }) as Promise<T>;
  }
  if (pathname === '/api/ask-answer') return requestCloudJson(method, path, body) as Promise<T>;

  if (pathname.startsWith("/api/automations/") && (pathname.endsWith("/run") || pathname.endsWith("/runs"))) {
    unsupported("云端自动化支持配置，但不提供桌面端的即时执行/历史接口");
  }
  if (pathname === "/api/automations" || /^\/api\/automations\/[^/]+$/.test(pathname)) {
    return requestCloudAutomation(method, pathname, body ?? {}) as Promise<T>;
  }

  return requestCloudJson<T>(method === "PUT" ? "PATCH" : method, path, body);
}
