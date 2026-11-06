export type ModelCapabilitySource =
  | "configured"
  | "builtin"
  | "fallback";

export interface ModelCapabilities {
  contextWindow: number;
  maxInputTokens: number;
  maxOutputTokens: number;
  source: ModelCapabilitySource;
}

export interface ModelCapabilityOverrides {
  contextWindow?: number;
  maxInputTokens?: number;
  maxOutputTokens?: number;
}

/** Request budget includes provider reasoning as well as visible output. */
export function resolveRequestMaxTokens(configured: string | undefined, capacity: number): number {
  const value = Number(configured);
  const budget = Number.isInteger(value) && value > 0 ? value : 32_768;
  return Math.min(budget, capacity);
}

const DEFAULT_CONTEXT_WINDOW = 32_768;
const DEFAULT_MAX_OUTPUT_TOKENS = 4_096;

const BUILTIN_CAPABILITIES: Readonly<Record<string, ModelCapabilities>> = {
  "qwen/qwen-max": {
    contextWindow: 32_768,
    maxInputTokens: 30_720,
    maxOutputTokens: 8_192,
    source: "builtin",
  },
  "qwen/qwen3.8-flash": {
    contextWindow: 1_000_000,
    maxInputTokens: 991_808,
    maxOutputTokens: 131_072,
    source: "builtin",
  },
};

function positiveInteger(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? Math.floor(value)
    : undefined;
}

/**
 * Resolve the request limits used by both model registration and prompt
 * preflight. Unknown models deliberately use a conservative context window;
 * callers can override it with catalog/user supplied metadata.
 */
export function resolveModelCapabilities(
  providerId: string,
  modelId: string,
  overrides: ModelCapabilityOverrides = {},
): ModelCapabilities {
  const builtin = BUILTIN_CAPABILITIES[`${providerId}/${modelId}`];
  const contextWindow = positiveInteger(overrides.contextWindow) ??
    builtin?.contextWindow ?? DEFAULT_CONTEXT_WINDOW;
  const maxOutputTokens = Math.min(
    positiveInteger(overrides.maxOutputTokens) ?? builtin?.maxOutputTokens ??
      DEFAULT_MAX_OUTPUT_TOKENS,
    contextWindow,
  );
  const maxInputTokens = Math.min(
    positiveInteger(overrides.maxInputTokens) ?? builtin?.maxInputTokens ??
      Math.max(1, contextWindow - maxOutputTokens),
    contextWindow,
  );
  return {
    contextWindow,
    maxInputTokens,
    maxOutputTokens,
    source: positiveInteger(overrides.contextWindow) ||
        positiveInteger(overrides.maxInputTokens) ||
        positiveInteger(overrides.maxOutputTokens)
      ? "configured"
      : builtin?.source ?? "fallback",
  };
}
