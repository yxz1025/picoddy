import { AsyncLocalStorage } from "node:async_hooks";

export class UpdateBusyError extends Error {
  readonly code = "TASK_BUSY";
  constructor() { super("正在准备更新，请稍后重试或取消更新"); }
}

/** A permit covers the complete async lifetime, including nested tool calls. */
export class UpdateGate {
  private context = new AsyncLocalStorage<symbol>();
  private tasks = new Map<symbol, string>();
  private closed = false;
  private waiters = new Set<() => void>();
  get draining() { return this.closed; }
  get blockers() { return [...new Set(this.tasks.values())]; }
  assertOpen() {
    const parent = this.context.getStore();
    if (this.closed && (!parent || !this.tasks.has(parent))) throw new UpdateBusyError();
  }
  async run<T>(kind: string, work: () => T | Promise<T>): Promise<T> {
    this.assertOpen();
    const id = Symbol(kind);
    this.tasks.set(id, kind);
    try { return await this.context.run(id, work); }
    finally {
      this.tasks.delete(id);
      if (!this.tasks.size) for (const wake of this.waiters) wake();
    }
  }
  close() { this.closed = true; }
  reopen() { this.closed = false; }
  async waitForIdle(signal: AbortSignal): Promise<void> {
    signal.throwIfAborted();
    if (!this.tasks.size) return;
    await new Promise<void>((resolve, reject) => {
      const clean = () => { this.waiters.delete(done); signal.removeEventListener("abort", abort); };
      const done = () => { clean(); resolve(); };
      const abort = () => { clean(); reject(signal.reason); };
      this.waiters.add(done);
      signal.addEventListener("abort", abort, { once: true });
    });
  }
}

export const updateGate = new UpdateGate();
