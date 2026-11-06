import type { AgentEvent } from "@earendil-works/pi-agent-core";

export type StreamChannel = "answer" | "thinking";

export interface StreamTextEvent {
  type: "stream_text";
  sessionId: string;
  relaySequence: number;
  mode: "delta" | "snapshot";
  channel: StreamChannel;
  text: string;
}

export interface ToolPreparingEvent {
  type: "tool_preparing";
  sessionId: string;
  toolName: string;
  toolCallId?: string;
  generatedCharacters?: number;
}

export interface StreamResyncRequiredEvent {
  type: "stream_resync_required";
  sessionId: string;
  relaySequence: number;
  text?: string;
  thinking?: string;
}

export type RelayedAgentEvent =
  | (AgentEvent & { sessionId: string; relaySequence: number })
  | StreamTextEvent
  | (ToolPreparingEvent & { relaySequence: number })
  | StreamResyncRequiredEvent;
export type RelaySubscriber = (event: RelayedAgentEvent) => void;

const DEFAULT_FLUSH_INTERVAL_MS = 32;
const DEFAULT_REPLAY_EVENT_LIMIT = 256;
const DEFAULT_REPLAY_BYTE_LIMIT = 2 * 1024 * 1024;
const CHANNELS: StreamChannel[] = ["thinking", "answer"];

function streamDelta(
  event: AgentEvent,
): { channel: StreamChannel; text: string } | null {
  if (event.type !== "message_update") return null;
  const update = (event as any).assistantMessageEvent;
  const delta = typeof update?.delta === "string" ? update.delta : "";
  if (!delta) return null;
  if (update?.type === "text_delta") return { channel: "answer", text: delta };
  if (update?.type === "thinking_delta") {
    return { channel: "thinking", text: delta };
  }
  return null;
}

function toolCallHint(
  event: AgentEvent,
): { key: string; name: string; id?: string } | null {
  if (event.type !== "message_update") return null;
  const update = (event as any).assistantMessageEvent;
  const kind = update?.type;
  if (kind !== "toolcall_start" && kind !== "toolcall_delta") return null;
  const index = typeof update.contentIndex === "number" ? update.contentIndex : -1;
  const blocks = (event as any).message?.content;
  const block = Array.isArray(blocks)
    ? (index >= 0 ? blocks[index] : undefined) ??
      blocks.find((item: { type?: string }) =>
        item?.type === "toolCall" || item?.type === "tool_use"
      )
    : undefined;
  const name = typeof block?.name === "string" ? block.name : "";
  const id = typeof block?.id === "string" ? block.id : undefined;
  return {
    key: id || `idx:${index}`,
    name: name || "tool",
    id,
  };
}

/**
 * One relay is shared by every consumer of a provider session. It converts
 * growing message snapshots into bounded, batched text deltas while keeping
 * non-text events strictly ordered around those deltas.
 */
export class SessionEventRelay {
  private readonly subscribers = new Set<RelaySubscriber>();
  private readonly pendingText: Record<StreamChannel, string> = {
    thinking: "",
    answer: "",
  };
  private readonly snapshotText: Record<StreamChannel, string> = {
    thinking: "",
    answer: "",
  };
  private sequence = 0;
  private replayFloor = 0;
  private replayBytes = 0;
  private readonly replayEvents: Array<{
    event: RelayedAgentEvent;
    bytes: number;
  }> = [];
  private streamActive = false;
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private closed = false;
  private readonly announcedToolCalls = new Map<string, { characters: number; emittedAt: number }>();

  constructor(
    readonly sessionId: string,
    private readonly flushIntervalMs = DEFAULT_FLUSH_INTERVAL_MS,
    private readonly replayEventLimit = DEFAULT_REPLAY_EVENT_LIMIT,
    private readonly replayByteLimit = DEFAULT_REPLAY_BYTE_LIMIT,
  ) {}

  accept(event: AgentEvent): void {
    if (this.closed) return;

    const delta = streamDelta(event);
    if (delta) {
      if (!this.streamActive) {
        this.streamActive = true;
        this.pendingText.thinking = "";
        this.pendingText.answer = "";
        this.snapshotText.thinking = "";
        this.snapshotText.answer = "";
      }
      this.snapshotText[delta.channel] += delta.text;
      this.pendingText[delta.channel] += delta.text;
      this.scheduleFlush();
      return;
    }

    const toolCall = toolCallHint(event);
    if (toolCall) {
      const previous = this.announcedToolCalls.get(toolCall.key);
      const update = (event as any).assistantMessageEvent;
      const characters = (previous?.characters ?? 0) +
        (update?.type === 'toolcall_delta' && typeof update.delta === 'string' ? update.delta.length : 0);
      const now = Date.now();
      const publish = !previous || now - previous.emittedAt >= 1000;
      this.announcedToolCalls.set(toolCall.key, { characters, emittedAt: publish ? now : previous.emittedAt });
      if (publish) {
        this.flush();
        this.emit({
          type: "tool_preparing",
          sessionId: this.sessionId,
          relaySequence: 0,
          toolName: toolCall.name,
          toolCallId: toolCall.id,
          generatedCharacters: characters,
        });
      }
      return;
    }

    // Other unused growing snapshots stay off the wire.
    if (event.type === "message_update") return;

    this.flush();
    this.emit(event);
    if (event.type === "message_end" || event.type === "agent_end") {
      this.streamActive = false;
      this.announcedToolCalls.clear();
    }
  }

  subscribe(
    subscriber: RelaySubscriber,
    afterSequence?: number,
  ): () => void {
    if (this.closed) return () => {};
    this.flush();
    this.subscribers.add(subscriber);
    if (afterSequence !== undefined) {
      if (
        !Number.isSafeInteger(afterSequence) ||
        afterSequence < this.replayFloor ||
        afterSequence > this.sequence
      ) {
        subscriber({
          type: "stream_resync_required",
          sessionId: this.sessionId,
          relaySequence: this.sequence,
          ...(this.streamActive && this.snapshotText.answer
            ? { text: this.snapshotText.answer }
            : {}),
          ...(this.streamActive && this.snapshotText.thinking
            ? { thinking: this.snapshotText.thinking }
            : {}),
        });
      } else {
        for (const item of this.replayEvents) {
          if (item.event.relaySequence > afterSequence) {
            subscriber(item.event);
          }
        }
      }
    } else if (this.streamActive) {
      for (const channel of CHANNELS) {
        const text = this.snapshotText[channel];
        if (!text) continue;
        subscriber({
          type: "stream_text",
          sessionId: this.sessionId,
          relaySequence: this.sequence,
          mode: "snapshot",
          channel,
          text,
        });
      }
    }
    return () => this.subscribers.delete(subscriber);
  }

  flush(): void {
    this.clearFlushTimer();
    if (this.closed) return;
    for (const channel of CHANNELS) {
      const text = this.pendingText[channel];
      if (!text) continue;
      this.pendingText[channel] = "";
      this.emit({
        type: "stream_text",
        sessionId: this.sessionId,
        relaySequence: 0,
        mode: "delta",
        channel,
        text,
      });
    }
  }

  close(): void {
    if (this.closed) return;
    this.flush();
    this.closed = true;
    this.clearFlushTimer();
    this.subscribers.clear();
    this.pendingText.thinking = "";
    this.pendingText.answer = "";
    this.snapshotText.thinking = "";
    this.snapshotText.answer = "";
    this.announcedToolCalls.clear();
    this.replayEvents.length = 0;
    this.replayBytes = 0;
  }

  private scheduleFlush(): void {
    if (this.flushTimer !== null) return;
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      this.flush();
    }, this.flushIntervalMs);
  }

  private clearFlushTimer(): void {
    if (this.flushTimer === null) return;
    clearTimeout(this.flushTimer);
    this.flushTimer = null;
  }

  private emit(event: AgentEvent | RelayedAgentEvent): void {
    this.sequence += 1;
    const delivered = {
      ...event,
      sessionId: this.sessionId,
      relaySequence: this.sequence,
    } as RelayedAgentEvent;
    this.retain(delivered);
    for (const subscriber of this.subscribers) {
      try {
        subscriber(delivered);
      } catch (error) {
        console.error("[event-relay] 订阅者处理事件失败:", error);
      }
    }
  }

  private retain(event: RelayedAgentEvent): void {
    const bytes = Buffer.byteLength(JSON.stringify(event), "utf8");
    if (bytes > this.replayByteLimit) {
      this.replayEvents.length = 0;
      this.replayBytes = 0;
      this.replayFloor = event.relaySequence;
      return;
    }
    this.replayEvents.push({ event, bytes });
    this.replayBytes += bytes;
    while (
      this.replayEvents.length > this.replayEventLimit ||
      this.replayBytes > this.replayByteLimit
    ) {
      const removed = this.replayEvents.shift();
      if (!removed) break;
      this.replayBytes -= removed.bytes;
      this.replayFloor = removed.event.relaySequence;
    }
  }
}
