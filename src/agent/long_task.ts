import { createHash } from "node:crypto";
import type { AssistantMessage } from "@earendil-works/pi-ai";
import type { AgentEvent } from "@earendil-works/pi-agent-core";
import type { NativeAgentSession } from "./engine.ts";
import type { TaskCompletionDeclaration } from "../infra/context.ts";
import {
  type ArtifactRequirement,
  checkArtifactRequirement,
  type VerifiedArtifact,
  verifyArtifact,
} from "./artifact_verification.ts";

export type TaskPhase = "running" | "compacting" | "recovering" | "verifying";
export interface CompletionCheck {
  ok: boolean;
  problems: string[];
}

const MAX_LENGTH_RECOVERIES = 2;
const MAX_DELIVERY_REPAIRS = 2;
const REPEATABLE_TOOLS = new Set([
  "read",
  "ls",
  "find",
  "grep",
  "read_doc",
  "rag_query",
  "rag_status",
  "web_search",
  "web_fetch",
  "screenshot",
  "present_files",
  "goal_complete",
  "ask_user_question",
]);
function argumentKey(name: string, args: unknown): string {
  const canonical = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(canonical);
    if (value && typeof value === "object") {
      return Object.fromEntries(
        Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map((
          [key, item],
        ) => [key, canonical(item)]),
      );
    }
    return value;
  };
  return createHash("sha256").update(JSON.stringify([name, canonical(args)]))
    .digest("hex");
}

/** One user request, possibly spanning several model runs. AgentSession owns
 * every model/tool loop, retry and compaction. Recovery never replays tools.
 */
export class TaskRunCoordinator {
  private recoveryCount = 0;
  private repairCount = 0;
  private readonly progress = new Set<string>();
  private previousRecoveryProgress?: number;
  private previousRepairFingerprint?: string;
  private previousRepairProgress?: number;
  private readonly deliveries = new Map<string, VerifiedArtifact>();
  private readonly toolCalls = new Map<string, string>();
  private readonly priorEffects = new Map<string, boolean>();
  private readonly notExecutedToolCalls = new Set<string>();
  private deliveryAttempted = false;
  private deliveryFailed = false;
  private waitingReason?: string;
  private goalFailed?: string;
  private declaration?: TaskCompletionDeclaration;
  private executionTools?: string[];
  private lastAssistantMessage?: AssistantMessage;
  private detach: Array<() => void> = [];

  constructor(
    private readonly options: {
      session: NativeAgentSession;
      controller: AbortController;
      requirement?: ArtifactRequirement;
      onStatus: (phase: TaskPhase, message: string) => void;
      onCheckpoint: () => Promise<void>;
    },
  ) {}

  get waitingForUser(): boolean {
    return Boolean(this.waitingReason);
  }

  async declareCompletion(declaration: TaskCompletionDeclaration): Promise<void> {
    this.options.controller.signal.throwIfAborted();
    if (this.declaration) throw new Error("本轮已提交完成声明，正在收尾。");
    if (!declaration.summary.trim()) throw new Error("完成声明必须包含成果摘要或待补充信息。");
    if (declaration.status === "waiting_for_user" && declaration.success) {
      throw new Error("等待用户的声明不能同时成功。");
    }
    if (declaration.success) {
      if (!declaration.proof.trim()) throw new Error("完成任务必须提供具体的验证依据。");
      const check = await this.verifyCompletion();
      if (!check.ok) throw new Error(`产物验收未通过：${check.problems.join("；")}`);
    }
    this.options.controller.signal.throwIfAborted();
    this.declaration = { ...declaration };
    this.waitingReason = declaration.status === "waiting_for_user" ? declaration.summary : undefined;
    this.goalFailed = !declaration.success && !this.waitingReason ? declaration.summary : undefined;
    this.options.session.setActiveToolsByName([]);
  }

  /** After native settlement, produce one tool-free final answer. Never reopen
   * business execution to repair the wording of a completion summary.
   */
  private async finalize(): Promise<AssistantMessage> {
    const { session, controller } = this.options;
    this.status("running", "正在整理最终答复…");
    const tools = session.getActiveToolNames();
    session.setActiveToolsByName([]);
    try {
      controller.signal.throwIfAborted();
      this.lastAssistantMessage = undefined;
      const beforeMessageCount = session.messages.length;
      await session.prompt(
        "[运行时收尾] 业务工具执行已结束。根据已有工具结果和完成声明，直接向用户给出简短最终答复。" +
        "不要再次检查、修改、交付或调用工具；等待用户时只说明必须补充的信息，不宣称完成。",
        { expandPromptTemplates: false },
      );
      await session.waitForIdle();
      await this.options.onCheckpoint();
      controller.signal.throwIfAborted();
      const response = this.lastAssistantMessage ??
        [...session.messages].slice(beforeMessageCount).reverse().find(
        (message): message is AssistantMessage => message.role === "assistant",
      );
      if (!response) throw new Error("收尾未返回答复，已保留成果。");
      if (response.stopReason === "stop" && !response.content.some(part => part.type === "text" && part.text.trim())) {
        throw new Error("收尾答复为空，已保留成果。");
      }
      return response;
    } finally {
      session.setActiveToolsByName(tools);
    }
  }

  private status(phase: TaskPhase, message: string): void {
    this.options.onStatus(phase, message);
  }

  private observe(event: AgentEvent): void {
    if (event.type === "message_end" && event.message.role === "assistant") {
      this.lastAssistantMessage = event.message as AssistantMessage;
    }
    if (
      event.type === "message_end" && event.message.role === "assistant" &&
      event.message.stopReason === "length"
    ) {
      for (const part of event.message.content) {
        if (part.type === "toolCall") this.notExecutedToolCalls.add(part.id);
      }
      return;
    }
    if (event.type === "tool_execution_start") {
      this.toolCalls.set(
        event.toolCallId,
        argumentKey(event.toolName, event.args),
      );
      return;
    }
    if (event.type !== "tool_execution_end") return;
    const key = this.toolCalls.get(event.toolCallId);
    this.toolCalls.delete(event.toolCallId);
    const notExecuted = this.notExecutedToolCalls.delete(event.toolCallId);
    if (key && !notExecuted && !REPEATABLE_TOOLS.has(event.toolName)) {
      this.priorEffects.set(
        key,
        this.priorEffects.get(key) === true || !event.isError,
      );
    }
    const result = event.result as {
      content?: unknown;
      details?: Record<string, unknown>;
    } | undefined;
    if (!event.isError && event.toolName !== "goal_complete") {
      // Identical reads/results don't count as new progress on another retry.
      this.progress.add(
        createHash("sha256").update(JSON.stringify({
          tool: event.toolName,
          arguments: key,
          content: result?.content,
          details: result?.details,
        })).digest("hex"),
      );
    }
    if (event.toolName === "present_files") {
      this.deliveryAttempted = true;
      this.deliveryFailed = Boolean(event.isError || result?.details?.error);
      if (!this.deliveryFailed && Array.isArray(result?.details?.files)) {
        for (
          const item of result.details.files as Array<Record<string, unknown>>
        ) {
          if (
            typeof item.path === "string" && typeof item.digest === "string" &&
            typeof item.bytes === "number" && typeof item.type === "string"
          ) {
            this.deliveries.set(item.path, {
              path: item.path,
              extension: item.type,
              digest: item.digest,
              bytes: item.bytes,
            });
          }
        }
      }
    }
  }

  guardToolCall(
    toolName: string,
    input: unknown,
  ): { block: true; reason: string } | undefined {
    if (this.declaration) {
      return { block: true, reason: "完成声明已接收，当前仅允许最终答复。" };
    }
    if (
      !(this.recoveryCount || this.repairCount) ||
      REPEATABLE_TOOLS.has(toolName)
    ) {
      return undefined;
    }
    const previous = this.priorEffects.get(argumentKey(toolName, input));
    if (previous === undefined) return undefined;
    return {
      block: true,
      reason: previous
        ? "恢复保护：本轮已成功执行相同操作，请复用原结果；需要核查时使用只读工具。"
        : "恢复保护：相同操作已有失败或不明确结果，请先只读核查实际状态。",
    };
  }

  verifyDelivery(
    path: string,
    signal?: AbortSignal,
  ): Promise<VerifiedArtifact> {
    return verifyArtifact(
      path,
      signal
        ? AbortSignal.any([signal, this.options.controller.signal])
        : this.options.controller.signal,
      this.options.requirement,
    );
  }

  async verifyCompletion(): Promise<CompletionCheck> {
    const problems: string[] = [];
    if (this.deliveryFailed) {
      problems.push("最近一次 present_files 交付失败，请修复后重新交付。");
    }
    const accepted: VerifiedArtifact[] = [];
    for (const delivered of this.deliveries.values()) {
      this.options.controller.signal.throwIfAborted();
      try {
        const current = await this.verifyDelivery(delivered.path);
        if (current.digest !== delivered.digest) {
          problems.push(
            `${delivered.path} 在交付后发生变化，请重新调用 present_files。`,
          );
        } else {
          accepted.push(current);
        }
      } catch (error) {
        this.options.controller.signal.throwIfAborted();
        problems.push(
          `${delivered.path}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }
    if (this.options.requirement) {
      problems.push(
        ...checkArtifactRequirement(this.options.requirement, accepted),
      );
    }
    return { ok: problems.length === 0, problems };
  }

  async execute(start: () => Promise<void>): Promise<AssistantMessage> {
    const { session, controller } = this.options;
    this.executionTools = session.getActiveToolNames();
    // AgentSession owns persistence, retries and compaction. This coordinator
    // only decides whether the user goal needs another complete prompt.
    this.detach = [
      session.subscribe((event: unknown) => this.observe(event as AgentEvent)),
    ];
    let next = start;
    try {
      while (true) {
        controller.signal.throwIfAborted();
        this.lastAssistantMessage = undefined;
        const beforeMessageCount = session.messages.length;
        await next();
        await session.waitForIdle();
        const response = this.lastAssistantMessage ??
          [...session.messages].slice(beforeMessageCount).reverse().find(
          (message): message is AssistantMessage =>
            message.role === "assistant",
        );
        if (!response) throw new Error("PI 会话未返回 assistant 消息");
        await this.options.onCheckpoint();
        controller.signal.throwIfAborted();
        const text = response.content.filter((part) => part.type === "text")
          .map((part) => part.text).join("");
        if (response.stopReason === "length" && text.trim()) {
          this.progress.add(
            createHash("sha256").update(`partial-answer:${text}`).digest("hex"),
          );
        }
        if (
          response.stopReason === "error" || response.stopReason === "aborted"
        ) return response;
        if (response.stopReason === "length") {
          if (
            this.recoveryCount >= MAX_LENGTH_RECOVERIES ||
            (this.previousRecoveryProgress !== undefined &&
              this.progress.size === this.previousRecoveryProgress)
          ) {
            throw new Error(
              "回复连续被截断或恢复后没有新进展，已停止自动恢复。当前文件与工具结果已保留，请缩小任务范围后继续。",
            );
          }
          this.previousRecoveryProgress = this.progress.size;
          this.recoveryCount++;
          this.status(
            "recovering",
            `回复被截断，正在从已保存的进度恢复（${this.recoveryCount}/${MAX_LENGTH_RECOVERIES}）…`,
          );
          session.sessionManager.appendCustomEntry("task_recovery", {
            reason: "length",
            attempt: this.recoveryCount,
          });
          next = () =>
            session.prompt(
              "[运行时恢复] 上轮因长度限制中断。继续尚未完成的用户目标，先核对已保存的文件与工具结果，保留已完成工作。" +
                "不要重放已经成功的外部写入、发送或提交操作；对结果不明确的副作用先核查，无法确认就向用户说明。" +
                "缩短推理和单次输出，文件任务分段写入；按原任务要求交付成果。需要展示文件或链接时使用 present_files，其他任务无需额外生成文件。",
            );
          continue;
        }
        if (this.waitingReason) return await this.finalize();
        if (this.goalFailed) throw new Error(this.goalFailed);
        if (!this.options.requirement && !this.deliveryAttempted) {
          return this.declaration ? await this.finalize() : response;
        }
        this.status("verifying", "正在检查交付文件是否完整、可读取并符合要求…");
        const verification = await this.verifyCompletion();
        if (verification.ok) {
          if (!this.declaration) return response;
          const final = await this.finalize();
          if (final.stopReason === "error" || final.stopReason === "aborted" || final.stopReason === "length") return final;
          const finalCheck = await this.verifyCompletion();
          if (!finalCheck.ok) throw new Error(`收尾期间交付物发生变化：${finalCheck.problems.join("；")}`);
          return final;
        }
        const fingerprint = JSON.stringify(verification.problems);
        if (
          this.repairCount >= MAX_DELIVERY_REPAIRS ||
          (this.previousRepairFingerprint === fingerprint &&
            this.previousRepairProgress === this.progress.size)
        ) {
          throw new Error(
            `产物验收未通过，已停止自动补齐：${
              verification.problems.join("；")
            }`,
          );
        }
        this.previousRepairFingerprint = fingerprint;
        this.previousRepairProgress = this.progress.size;
        this.repairCount++;
        this.declaration = undefined;
        this.goalFailed = undefined;
        this.waitingReason = undefined;
        session.setActiveToolsByName(this.executionTools);
        this.status(
          "recovering",
          `产物尚未满足交付要求，正在补齐（${this.repairCount}/${MAX_DELIVERY_REPAIRS}）…`,
        );
        session.sessionManager.appendCustomEntry("task_recovery", {
          reason: "delivery",
          attempt: this.repairCount,
          problems: verification.problems,
        });
        next = () =>
          session.prompt(
            `[运行时验收未通过]\n${verification.problems.join("\n")}\n` +
              "只补齐缺少或不完整的交付物，保留已完成工作。完成写入和检查后调用 present_files。" +
              (session.getActiveToolNames().includes("goal_complete")
                ? "若确实缺少用户必须提供的信息，请用 goal_complete 的 waiting_for_user 状态说明具体问题。"
                : "若确实缺少必要信息，请明确说明缺口，不要声称已完成。") +
              "不要猜测授权或重做外部操作。",
          );
      }
    } finally {
      for (const detach of this.detach) detach();
      this.detach = [];
      session.setActiveToolsByName(this.executionTools);
    }
  }
}
