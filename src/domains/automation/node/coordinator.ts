import { provider } from "../../../agent/provider.ts";
import { getApiKey } from "../../../infra/keychain.ts";
import { getDb } from "../../../infra/db.ts";
import { appendMessage, createConversation } from "../../session/node/store.ts";
import { getCustomProviders, getProviderModels } from "../../../agent/models.ts";
import { getSetting } from "../../settings/node/store.ts";
import { createRun, finishRun, getActiveRun, getAutomation, updateAutomation, type Automation, type AutomationRun } from "./store.ts";
import { nextCronTime } from "./scheduler.ts";

export class AutomationAlreadyRunningError extends Error {
  readonly code = "AUTOMATION_ALREADY_RUNNING";
  constructor(readonly run: AutomationRun) {
    super("该自动化任务正在运行");
  }
}

export class AutomationModelNotConfiguredError extends Error {
  readonly code = "AUTOMATION_MODEL_NOT_CONFIGURED";
  constructor() {
    super("请先在设置中配置默认模型和对应的 API Key，再运行自动化任务");
  }
}

async function resolveAutomationModel(): Promise<{
  provider: string;
  modelId: string;
}> {
  const providerId = getSetting("default_provider", "").trim();
  const modelId = getSetting("default_model_id", "").trim();
  if (!providerId || !modelId) throw new AutomationModelNotConfiguredError();

  const custom = getCustomProviders().find((item) => item.id === providerId);
  const modelConfigured = custom
    ? custom.models.includes(modelId)
    : (getProviderModels()[providerId] ?? []).some((model) =>
      model.id === modelId
    );
  if (!modelConfigured) {
    throw new AutomationModelNotConfiguredError();
  }
  const hasCredential = providerId === "ollama" || Boolean(custom?.apiKey) ||
    Boolean(await getApiKey(providerId));
  if (!hasCredential) throw new AutomationModelNotConfiguredError();
  return { provider: providerId, modelId };
}

export function automationPrompt(a: Automation): string {
  return a.actionType === "skill"
    ? `【执行技能】${a.actionConfig.skill || ""}`
    : (a.prompt || a.actionConfig.prompt || "");
}

function advanceSchedule(a: Automation, now: number): void {
  if (a.scheduleType === "once") {
    updateAutomation(a.id, { lastRun: now, nextRun: null, enabled: false });
  } else if (a.scheduleType === "interval") {
    const mins = a.triggerConfig.intervalMinutes ?? 30;
    updateAutomation(a.id, { lastRun: now, nextRun: now + mins * 60_000 });
  } else {
    const next = a.triggerConfig.cron
      ? nextCronTime(a.triggerConfig.cron, new Date(now))
      : null;
    updateAutomation(a.id, { lastRun: now, nextRun: next?.getTime() ?? null });
  }
}

export async function claimAutomationRun(
  automationId: string,
  trigger: "manual" | "scheduled",
): Promise<{ automation: Automation; run: AutomationRun; prompt: string }> {
  // Resolve credentials before opening the SQLite write transaction. This
  // prevents the legacy DeepSeek fallback from creating an unusable session.
  const selectedModel = await resolveAutomationModel();
  const db = getDb();
  let automation!: Automation;
  let run!: AutomationRun;
  db.exec("BEGIN IMMEDIATE");
  try {
    automation = getAutomation(automationId)!;
    if (!automation) throw new Error("自动化不存在");
    const active = getActiveRun(automationId);
    if (active) throw new AutomationAlreadyRunningError(active);
    if (trigger === "scheduled") advanceSchedule(automation, Date.now());
    const conversation = createConversation(
      `[自动] ${automation.name}`,
      "automation",
      automation.workspaceId,
      undefined,
      selectedModel,
    );
    run = createRun(automation.id, conversation.id, "queued");
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }

  const prompt = automationPrompt(automation);
  try {
    await provider.attachPersistence(run.sessionId!);
    appendMessage(run.sessionId!, "user", prompt);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    try {
      appendMessage(run.sessionId!, "user", prompt);
      appendMessage(run.sessionId!, "assistant", `自动化初始化失败：${message}`, { isError: true });
    } catch { /* retain the run even if the explanatory message cannot be written */ }
    finishRun(run.id, "failed", message);
    throw error;
  }
  return { automation, run, prompt };
}
