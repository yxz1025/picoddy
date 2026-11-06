export const CLOUD_RUN_START_EVENT = "cloud-run-start";

export interface CloudRunStartDetail {
  conversationId: string;
  runId: string;
}

export type CloudRunStatus =
  | "queued"
  | "provisioning"
  | "running"
  | "waiting_approval"
  | "cancelling"
  | "cleanup_pending"
  | "succeeded"
  | "failed"
  | "cancelled"
  | "interrupted";

export interface CloudRun {
  id: string;
  conversationId: string;
  status: CloudRunStatus;
  error?: string | null;
  createdAt?: string;
  updatedAt?: string;
}

export interface CloudRunEvent {
  id: string;
  runId: string;
  type: string;
  payload: Record<string, unknown>;
  createdAt?: string;
}

interface ParsedSseEvent {
  id?: string;
  event?: string;
  data: string;
}

export interface RunStreamOptions {
  runId: string;
  after?: string;
  signal: AbortSignal;
  onEvent: (event: CloudRunEvent) => void | Promise<void>;
  onReconnect?: () => void | Promise<void>;
  onError?: (error: Error) => void;
}

const RETRY_DELAYS = [800, 1600, 3000, 5000, 8000] as const;

function parseSseChunk(input: string): { events: ParsedSseEvent[]; rest: string } {
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
      const field = separator < 0 ? line : line.slice(0, separator);
      const rawValue = separator < 0 ? "" : line.slice(separator + 1);
      const value = rawValue.startsWith(" ") ? rawValue.slice(1) : rawValue;
      if (field === "id") id = value;
      else if (field === "event") event = value;
      else if (field === "data") data.push(value);
    }
    return data.length ? [{ id, event, data: data.join("\n") }] : [];
  });
  return { events, rest };
}

function eventId(value: string | undefined): bigint | null {
  if (!value || !/^\d+$/.test(value)) return null;
  return BigInt(value);
}

function abortableDelay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    let timeout: number | undefined;
    const cleanup = () => signal.removeEventListener("abort", onAbort);
    const onAbort = () => {
      if (timeout !== undefined) window.clearTimeout(timeout);
      cleanup();
      reject(new DOMException("Aborted", "AbortError"));
    };
    timeout = window.setTimeout(() => {
      cleanup();
      resolve();
    }, ms);
    if (signal.aborted) onAbort();
    else signal.addEventListener("abort", onAbort, { once: true });
  });
}

function isAbort(error: unknown, signal: AbortSignal): boolean {
  return signal.aborted || (error instanceof DOMException && error.name === "AbortError");
}

export function dispatchCloudRunStart(detail: CloudRunStartDetail): void {
  window.dispatchEvent(new CustomEvent<CloudRunStartDetail>(CLOUD_RUN_START_EVENT, { detail }));
}

/** Durable same-origin SSE reader. It owns reconnects until its signal is aborted. */
export async function streamRunEvents(options: RunStreamOptions): Promise<void> {
  let cursor = eventId(options.after) ?? 0n;
  let failures = 0;

  while (!options.signal.aborted) {
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    try {
      const response = await fetch(
        `/api/runs/${encodeURIComponent(options.runId)}/events?after=${cursor}`,
        {
          credentials: "same-origin",
          headers: {
            Accept: "text/event-stream",
            ...(cursor > 0n ? { "Last-Event-ID": cursor.toString() } : {}),
          },
          signal: options.signal,
        },
      );
      if (!response.ok || !response.body) {
        throw new Error(`事件流连接失败（${response.status}）`);
      }

      reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      while (!options.signal.aborted) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const parsed = parseSseChunk(buffer);
        buffer = parsed.rest;
        for (const raw of parsed.events) {
          if (raw.event && raw.event !== "update") continue;
          const parsedEvent = JSON.parse(raw.data) as Omit<CloudRunEvent, "id"> & { id?: string | number };
          const rawId = raw.id ?? String(parsedEvent.id ?? "");
          const nextId = eventId(rawId);
          if (nextId !== null && nextId <= cursor) continue;
          await options.onEvent({ ...parsedEvent, id: rawId } as CloudRunEvent);
          // A callback can fail while reloading durable messages. Acknowledge
          // only completed handlers so the terminal event remains retryable.
          if (nextId !== null) cursor = nextId;
          failures = 0;
        }
      }
      if (!options.signal.aborted) await options.onReconnect?.();
    } catch (error) {
      if (isAbort(error, options.signal)) return;
      options.onError?.(error instanceof Error ? error : new Error("事件流连接中断"));
      try { await options.onReconnect?.(); }
      catch (recoveryError) {
        if (isAbort(recoveryError, options.signal)) return;
        options.onError?.(recoveryError instanceof Error ? recoveryError : new Error('消息恢复失败'));
      }
    } finally {
      if (reader) {
        try { await reader.cancel(); } catch { /* already closed */ }
        reader.releaseLock();
      }
    }

    failures += 1;
    try {
      await abortableDelay(
        RETRY_DELAYS[Math.min(failures - 1, RETRY_DELAYS.length - 1)],
        options.signal,
      );
    } catch (error) {
      if (isAbort(error, options.signal)) return;
      throw error;
    }
  }
}
