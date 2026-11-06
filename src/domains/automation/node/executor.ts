import { updateGate } from "../../../infra/update-gate.ts";
import { provider } from "../../../agent/provider.ts";
import { getDb } from "../../../infra/db.ts";
import { getMessages } from "../../session/node/store.ts";
import { clearConfirmHandler, setConfirmHandler } from "../../../agent/permissions.ts";
import { acquireAutomationPermit } from "./activity_gate.ts";
import { finishRun, markRunRunning, type Automation } from "./store.ts";

const DEFAULT_TIMEOUT_MS = 30 * 60_000;

function escapeXmlAttribute(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

export async function executeAutomationRun(
  automation: Automation,
  runId: string,
  sessionId: string,
  prompt: string,
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<void> {
  return updateGate.run("automation", () => executeWithPermit(automation, runId, sessionId, prompt, timeoutMs));
}
async function executeWithPermit(automation: Automation, runId: string, sessionId: string, prompt: string, timeoutMs: number): Promise<void> {
  const release = await acquireAutomationPermit();
  try {
    if (!markRunRunning(runId)) return;
    if (!prompt.trim()) {
      finishRun(runId, "failed", "自动化任务没有可执行的提示词");
      return;
    }
    // 后台任务不能占用全局确认弹窗；需要确认的操作一律拒绝。
    setConfirmHandler(sessionId, async () => false);
    const selectedMcpTools = automation.connector
      ? await (await import("../../../agent/mcp.ts")).toolsForMcpServer(automation.connector)
      : [];
    const executionPrompt = automation.connector
      ? `<preferred_connector name="${escapeXmlAttribute(automation.connector)}">本次任务仅加载并使用该连接器提供的 MCP 工具。</preferred_connector>\n${prompt}`
      : prompt;
    let timedOut = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const execution = provider.prompt(sessionId, executionPrompt, {
      mode: "craft",
      permission: automation.permission || "default",
      mcpTools: selectedMcpTools,
      selectedExpertId: automation.expertId ?? undefined,
    });
    const timeout = new Promise<void>((resolve) => {
      timer = setTimeout(async () => {
        timedOut = true;
        try { await provider.abort(sessionId); } catch { /* execution owns final error */ }
        resolve();
      }, timeoutMs);
    });
    try {
      await Promise.race([execution, timeout]);
      if (timedOut) {
        await execution.catch(() => {});
        finishRun(runId, "timedOut", "执行超过 30 分钟，已中止");
        return;
      }
      const messages = getMessages(sessionId);
      const last = messages.filter((message) => message.role === "assistant").pop();
      const requestedInput = messages.some((message) =>
        message.role === "tool" && message.toolName === "ask_user_question"
      );
      const conversation = getDb().prepare("SELECT status FROM conversations WHERE id=?")
        .get(sessionId) as { status: string } | undefined;
      const failed = conversation?.status !== "done" || requestedInput;
      finishRun(
        runId,
        failed ? "failed" : "completed",
        requestedInput || conversation?.status === "pending"
          ? "任务需要用户补充信息，自动化已停止"
          : last?.content?.slice(0, 60) || (failed ? "执行失败" : "已完成"),
      );
    } catch (error) {
      finishRun(runId, "failed", error instanceof Error ? error.message : String(error));
    } finally {
      if (timer) clearTimeout(timer);
    }
  } finally {
    clearConfirmHandler(sessionId);
    release();
  }
}

export function superviseAutomationRun(promise: Promise<void>): void {
  promise.catch((error) => console.error("[automation] 后台执行失败:", error));
}
