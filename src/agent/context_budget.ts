import type { AgentTool } from "@earendil-works/pi-agent-core";
import { estimateTokens as estimatePiMessageTokens } from "../vendor/pi_coding_agent.ts";

import type { ModelCapabilities } from "./model_capabilities.ts";

const TOKEN_CHARACTERS = 4;
const REQUEST_SAFETY_TOKENS = 2_048;
const MIN_COMPACTABLE_HISTORY_TOKENS = 2_048;
// Compact long-running project conversations early enough to avoid repeatedly
// sending a large transcript. Pi retains a useful recent-history tail.
const PRE_TURN_COMPACTION_THRESHOLD = 0.3;

export interface ContextBudgetEstimate {
  systemTokens: number;
  userTokens: number;
  historyTokens: number;
  toolTokens: number;
  inputTokens: number;
  safeInputTokens: number;
  overflowTokens: number;
}

export type HistoryCompactionOutcome =
  | "skipped"
  | "compacted"
  | "unavailable";

function json(value: unknown): string {
  try {
    return JSON.stringify(value) ?? "";
  } catch {
    return String(value);
  }
}

export function estimateTokens(value: unknown): number {
  if (typeof value === "string") {
    return Math.ceil(value.length / TOKEN_CHARACTERS);
  }
  if (value && typeof value === "object" &&
      typeof (value as { role?: unknown }).role === "string") {
    return estimatePiMessageTokens(
      value as Parameters<typeof estimatePiMessageTokens>[0],
    );
  }
  return Math.ceil(json(value).length / TOKEN_CHARACTERS);
}

export function estimateToolTokens(tool: AgentTool): number {
  return estimateTokens({
    name: tool.name,
    description: tool.description,
    parameters: tool.parameters,
  }) + 24;
}

export function estimateContextBudget(input: {
  capabilities: ModelCapabilities;
  maxOutputTokens: number;
  systemPrompt: string;
  userPrompt: string;
  imageCount?: number;
  history: readonly unknown[];
  tools: readonly AgentTool[];
}): ContextBudgetEstimate {
  const systemTokens = estimateTokens(input.systemPrompt);
  const userTokens = estimateTokens(input.userPrompt) +
    Math.max(0, Math.floor(input.imageCount ?? 0)) * 1_200;
  // Pi's compaction estimator treats the active system prompt separately from
  // conversation history. Avoid counting its system message twice.
  const historyTokens = input.history.reduce((total, message) => {
    if (message && typeof message === "object" &&
        (message as { role?: unknown }).role === "system") return total;
    return total + estimateTokens(message);
  }, 0);
  const toolTokens = input.tools.reduce(
    (total, tool) => total + estimateToolTokens(tool),
    0,
  );
  const inputTokens = systemTokens + userTokens + historyTokens + toolTokens;
  const outputReserve = Math.min(
    Math.max(1, input.maxOutputTokens),
    input.capabilities.maxOutputTokens,
  );
  const safeInputTokens = Math.max(
    1,
    Math.min(
      input.capabilities.maxInputTokens,
      input.capabilities.contextWindow - outputReserve,
    ) - REQUEST_SAFETY_TOKENS,
  );
  return {
    systemTokens,
    userTokens,
    historyTokens,
    toolTokens,
    inputTokens,
    safeInputTokens,
    overflowTokens: Math.max(0, inputTokens - safeInputTokens),
  };
}

export function fixedInputTokens(budget: ContextBudgetEstimate): number {
  return budget.inputTokens - budget.historyTokens;
}

/**
 * Budget checks only decide whether compaction would be useful. The caller
 * must pass Pi Agent's own prepareCompaction() result as canCompact; message
 * counts are not a valid proxy for native compaction cut points.
 */
export function shouldAttemptHistoryCompaction(
  budget: ContextBudgetEstimate,
  canCompact: boolean,
): boolean {
  return canCompact &&
    budget.inputTokens >= budget.safeInputTokens * PRE_TURN_COMPACTION_THRESHOLD &&
    budget.historyTokens > MIN_COMPACTABLE_HISTORY_TOKENS &&
    fixedInputTokens(budget) <= budget.safeInputTokens;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function isNoopHistoryCompactionError(error: unknown): boolean {
  const message = errorMessage(error);
  return message.includes("Nothing to compact") ||
    message.includes("Already compacted");
}

export async function compactHistoryForBudget(input: {
  budget: ContextBudgetEstimate;
  canCompact: boolean;
  compact: () => Promise<unknown>;
}): Promise<HistoryCompactionOutcome> {
  if (!shouldAttemptHistoryCompaction(input.budget, input.canCompact)) {
    return input.canCompact ? "skipped" : "unavailable";
  }
  try {
    await input.compact();
    return "compacted";
  } catch (error) {
    if (isNoopHistoryCompactionError(error)) return "unavailable";
    throw error;
  }
}

export function formatContextCapacityMessage(
  modelName: string,
  budget: ContextBudgetEstimate,
): string {
  const usage =
    `当前请求预计需要 ${budget.inputTokens} Token，超过 ${modelName} 的安全输入容量 ` +
    `${budget.safeInputTokens} Token。`;
  if (
    budget.userTokens >= budget.systemTokens &&
    budget.userTokens >= budget.toolTokens &&
    budget.userTokens >= budget.historyTokens
  ) {
    return `${usage}当前输入或附件占用较多，请减少附件、缩小内容范围或分段提交。`;
  }
  if (fixedInputTokens(budget) > budget.safeInputTokens) {
    return `${usage}系统提示和已启用工具占用较多，请减少工具或技能，或切换到更大上下文模型。`;
  }
  return `${usage}当前会话的近期内容需要完整保留，请新建会话或切换到更大上下文模型。`;
}
