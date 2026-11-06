import type { Message } from "../store/useStore";

export function hasAnswerText(text?: string): boolean {
  return Boolean(text?.replace(/\s/g, ""));
}

export type AssistantRunItem =
  | { kind: "message"; message: Message }
  | { kind: "tool-group"; id: string; messages: Message[] }
  | { kind: "present-files"; id: string; message: Message }
  | { kind: "widget"; id: string; message: Message };

export type OutputEntry =
  | { kind: "present-files"; id: string; message: Message }
  | { kind: "widget"; id: string; message: Message }
  | { kind: "answer"; id: string; message: Message };

export interface SettledAssistantRun {
  process: AssistantRunItem[];
  outputs: OutputEntry[];
  finalMessageId?: string;
}

export function isSettledRun(options: {
  isLastRun: boolean;
  busy: boolean;
  hasActiveStream: boolean;
  hasRunningTool: boolean;
}): boolean {
  if (!options.isLastRun) return true;
  return (
    !options.busy &&
    !options.hasActiveStream &&
    !options.hasRunningTool
  );
}

function runItemId(item: AssistantRunItem): string {
  if (item.kind === "message") return item.message.id;
  return item.id;
}

export function settleAssistantRun(items: AssistantRunItem[]): SettledAssistantRun {
  let lastResultIndex = -1;
  for (let index = 0; index < items.length; index++) {
    const item = items[index];
    if (
      item.kind === "message" &&
      item.message.role === "assistant" &&
      hasAnswerText(item.message.content)
    ) {
      lastResultIndex = index;
    }
  }

  const process: AssistantRunItem[] = [];
  const outputs: OutputEntry[] = [];
  let finalMessageId: string | undefined;

  items.forEach((item, index) => {
    if (item.kind === "present-files" || item.kind === "widget") {
      outputs.push(item);
      return;
    }
    if (item.kind === "tool-group") {
      process.push(item);
      return;
    }
    if (item.kind !== "message" || item.message.role !== "assistant") return;

    if (!hasAnswerText(item.message.content) && !item.message.thinking?.trim()) return;
    const isFinal = index === lastResultIndex;
    if (!isFinal) {
      process.push(item);
      return;
    }

    finalMessageId = item.message.id;
    if (item.message.thinking?.trim()) {
      process.push({
        kind: "message",
        message: { ...item.message, content: "" },
      });
    }
    outputs.push({
      kind: "answer",
      id: item.message.id,
      message: item.message,
    });
  });

  return { process, outputs, finalMessageId };
}

export function processItemKey(item: AssistantRunItem, index: number): string {
  return `${item.kind}-${runItemId(item)}-${index}`;
}

function itemCreatedAts(item: AssistantRunItem): number[] {
  if (item.kind === "tool-group") {
    return item.messages.map((message) => message.createdAt);
  }
  return [item.message.createdAt];
}

export function runElapsedMs(
  items: AssistantRunItem[],
  startedAt?: number,
): number {
  const times = items.flatMap(itemCreatedAts).filter((time) =>
    Number.isFinite(time) && time > 0
  );
  if (startedAt && Number.isFinite(startedAt) && startedAt > 0) {
    times.push(startedAt);
  }
  if (times.length === 0) return 0;
  return Math.max(0, Math.max(...times) - Math.min(...times));
}

/** 例：8 秒 → （耗时：8s）；65 秒 → （耗时：1m5s） */
export function formatRunDuration(elapsedMs: number): string {
  const elapsedSeconds = Math.max(0, Math.ceil(elapsedMs / 1000));
  const minutes = Math.floor(elapsedSeconds / 60);
  const seconds = elapsedSeconds % 60;
  if (minutes < 1) return `（耗时：${seconds}s）`;
  return `（耗时：${minutes}m${seconds}s）`;
}

export type AssistantTimelineEntry = OutputEntry | { kind: 'process'; id: string; items: AssistantRunItem[] };

/** Keep visible narration in sequence; fold only adjacent thinking and tool records. */
export function buildAssistantTimeline(items: AssistantRunItem[]): AssistantTimelineEntry[] {
  const timeline: AssistantTimelineEntry[] = [];
  let pending: AssistantRunItem[] = [];
  const flush = () => {
    if (!pending.length) return;
    timeline.push({kind:'process',id:`process-${runItemId(pending[0])}`,items:pending});
    pending = [];
  };
  for (const item of items) {
    if (item.kind === 'widget' || item.kind === 'present-files') {
      flush(); timeline.push(item);
    } else if (item.kind === 'tool-group') {
      pending.push(item);
    } else if (item.message.role === 'assistant') {
      if (hasAnswerText(item.message.content)) {
        flush();
        timeline.push({kind:'answer',id:item.message.id,message:item.message});
      }
      if (item.message.thinking?.trim()) pending.push({kind:'message',message:{...item.message,content:''}});
    }
  }
  flush();
  return timeline;
}
