import type { RunEvent } from "../types";

interface ParsedSseEvent {
  id?: string;
  event?: string;
  data: string;
}

export function parseSseChunk(input: string): { events: ParsedSseEvent[]; rest: string } {
  const normalized = input.replace(/\r\n/g, "\n");
  const blocks = normalized.split("\n\n");
  const rest = blocks.pop() ?? "";
  const events = blocks.flatMap((block) => {
    let id: string | undefined;
    let event: string | undefined;
    const data: string[] = [];
    for (const line of block.split("\n")) {
      if (!line || line.startsWith(":")) continue;
      const separator = line.indexOf(":");
      const field = separator === -1 ? line : line.slice(0, separator);
      const rawValue = separator === -1 ? "" : line.slice(separator + 1);
      const value = rawValue.startsWith(" ") ? rawValue.slice(1) : rawValue;
      if (field === "id") id = value;
      else if (field === "event") event = value;
      else if (field === "data") data.push(value);
    }
    return data.length ? [{ id, event, data: data.join("\n") }] : [];
  });
  return { events, rest };
}

interface StreamOptions {
  runId: string;
  after?: number;
  signal: AbortSignal;
  onEvent: (event: RunEvent) => void | Promise<void>;
  onReconnect?: () => void | Promise<void>;
  onError?: (error: Error) => void;
}

const RETRY_DELAYS = [800, 1600, 3000, 5000, 8000];

function abortableDelay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const onAbort = () => {
      window.clearTimeout(timeout);
      reject(new DOMException("Aborted", "AbortError"));
    };
    const timeout = window.setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    if (signal.aborted) onAbort();
    else signal.addEventListener("abort", onAbort, { once: true });
  });
}

export async function streamRunEvents(options: StreamOptions): Promise<void> {
  let lastEventId = options.after ?? 0;
  let failures = 0;

  while (!options.signal.aborted) {
    try {
      const response = await fetch(`/api/runs/${options.runId}/events?after=${lastEventId}`, {
        headers: {
          accept: "text/event-stream",
          ...(lastEventId > 0 ? { "Last-Event-ID": String(lastEventId) } : {}),
        },
        credentials: "same-origin",
        signal: options.signal,
      });
      if (!response.ok || !response.body) throw new Error(`事件流连接失败（${response.status}）`);

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      failures = 0;

      while (!options.signal.aborted) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const parsed = parseSseChunk(buffer);
        buffer = parsed.rest;
        for (const raw of parsed.events) {
          if (raw.event && raw.event !== "update") continue;
          const event = JSON.parse(raw.data) as RunEvent;
          const numericId = Number(raw.id ?? event.id);
          if (Number.isFinite(numericId)) {
            if (numericId <= lastEventId) continue;
            lastEventId = numericId;
          }
          await options.onEvent(event);
        }
      }
      if (!options.signal.aborted) await options.onReconnect?.();
    } catch (error) {
      if (options.signal.aborted || (error instanceof DOMException && error.name === "AbortError")) return;
      const normalized = error instanceof Error ? error : new Error("事件流连接中断");
      options.onError?.(normalized);
      await options.onReconnect?.();
    }

    failures += 1;
    try {
      await abortableDelay(RETRY_DELAYS[Math.min(failures - 1, RETRY_DELAYS.length - 1)], options.signal);
    } catch (error) {
      if (options.signal.aborted || (error instanceof DOMException && error.name === "AbortError")) return;
      throw error;
    }
  }
}
