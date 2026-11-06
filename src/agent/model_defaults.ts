export const DEFAULT_DEEPSEEK_MODEL_ID = "deepseek-v4-flash";
export const DEFAULT_DEEPSEEK_BASE_URL = "https://api.deepseek.com";
const RETIRED_DEEPSEEK_PROXY_BASE_URL = "http://127.0.0.1:9999/v1";

export function normalizeBaseUrl(provider: string, baseUrl: string): string {
  const normalized = baseUrl.trim().replace(/\/$/, "");
  if (provider === "deepseek" && normalized === RETIRED_DEEPSEEK_PROXY_BASE_URL) {
    return DEFAULT_DEEPSEEK_BASE_URL;
  }
  return normalized;
}

/** Compatibility migration for the removed DeepSeek Chat model name. */
export function normalizeModelId(provider: string, modelId: string): string {
  const normalized = modelId.trim();
  if (provider === "deepseek" && normalized === "deepseek-chat") {
    return DEFAULT_DEEPSEEK_MODEL_ID;
  }
  return normalized;
}
