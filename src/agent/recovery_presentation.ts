import type { AgentEvent } from "@earendil-works/pi-agent-core";

/** UI hint only: never mutate the provider history used for recovery. */
export function recoveryPresentationEvent(event: AgentEvent, controller?: AbortController): AgentEvent {
  if (event.type !== "message_end" || event.message.role !== "assistant" ||
      event.message.stopReason !== "length" || !controller || controller.signal.aborted) return event;
  return { ...event, message: { ...event.message, runtimeRecovery: true } } as AgentEvent;
}
