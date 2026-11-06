import {setTimeout as delay} from 'node:timers/promises';
import {TapdRateLimitError} from './rate_limit.ts';

/** Read-only requests share pacing/cooldown per origin and OAuth credential. */
export function createTapdReadScheduler(options: { now?: () => number; wait?: (ms: number) => Promise<unknown>; intervalMs?: number } = {}) {
  const now = options.now ?? Date.now;
  const wait = options.wait ?? delay;
  // Leave headroom below the documented general default of 60 requests/minute.
  const interval = options.intervalMs ?? 1_100;
  const lanes = new Map<string, { tail: Promise<unknown>; next: number; blockedUntil: number; pending: number; touched: number }>();
  const inFlight = new Map<string, Promise<unknown>>();
  function run<T>(scope: string, request: string, action: () => Promise<T>): Promise<T> {
    const key = JSON.stringify([scope, request]);
    const existing = inFlight.get(key);
    if (existing) return existing as Promise<T>;
    for (const [id,lane] of lanes) if (!lane.pending && lane.blockedUntil <= now() && lane.touched + 300_000 < now()) lanes.delete(id);
    let lane = lanes.get(scope);
    if (!lane) { lane = {tail: Promise.resolve(), next:0, blockedUntil:0, pending:0, touched:now()}; lanes.set(scope,lane); }
    const state = lane;
    state.pending++;
    const checkCooldown = () => { if (state.blockedUntil > now()) throw new TapdRateLimitError(Math.ceil((state.blockedUntil-now())/1000)); };
    const result = state.tail.then(async () => {
      checkCooldown();
      if (state.next > now()) await wait(state.next-now());
      checkCooldown();
      state.next = now()+interval;
      try { return await action(); }
      catch (error) {
        if (error instanceof TapdRateLimitError) state.blockedUntil = now()+error.retryAfterSeconds*1000;
        throw error;
      }
    }).finally(() => { state.pending--; state.touched=now(); inFlight.delete(key); });
    state.tail=result.catch(()=>{});
    inFlight.set(key,result);
    return result;
  }
  return {run};
}
