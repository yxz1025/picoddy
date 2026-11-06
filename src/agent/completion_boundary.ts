import type { Agent } from "@earendil-works/pi-agent-core";

/** A completion declaration must be the only operation in its native batch.
 * Pi's terminate hint is unanimous across the batch, so a mixed batch cannot
 * safely act as a completion boundary. Preserve the SDK's extension hooks.
 */
export function installCompletionBoundary(agent: Agent): void {
  const before = agent.beforeToolCall;
  agent.beforeToolCall = async (context, signal) => {
    if (
      context.toolCall.name === "goal_complete" &&
      context.assistantMessage.content.filter((part) => part.type === "toolCall").length !== 1
    ) {
      return {
        block: true,
        reason: "goal_complete 必须单独调用。请先完成其他操作，再单独提交完成声明。",
      };
    }
    return before?.(context, signal);
  };
}
