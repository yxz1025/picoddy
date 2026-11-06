const IDLE_WINDOW_MS = 3_000;

let foregroundCount = 0;
let lastForegroundChange = Date.now();
let automationTail: Promise<void> = Promise.resolve();
const waiters = new Set<() => void>();

function wakeWaiters(): void {
  for (const wake of waiters) wake();
  waiters.clear();
}

export function beginForegroundActivity(): () => void {
  foregroundCount += 1;
  lastForegroundChange = Date.now();
  wakeWaiters();
  let released = false;
  return () => {
    if (released) return;
    released = true;
    foregroundCount = Math.max(0, foregroundCount - 1);
    lastForegroundChange = Date.now();
    wakeWaiters();
  };
}

async function waitForForegroundIdle(idleWindowMs: number): Promise<void> {
  while (true) {
    const remaining = idleWindowMs - (Date.now() - lastForegroundChange);
    if (foregroundCount === 0 && remaining <= 0) return;
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        waiters.delete(wake);
        resolve();
      }, foregroundCount === 0 ? Math.max(1, remaining) : idleWindowMs);
      const wake = () => {
        clearTimeout(timer);
        resolve();
      };
      waiters.add(wake);
    });
  }
}

/** Wait for foreground idle and hold the process-wide automation permit. */
export async function acquireAutomationPermit(
  idleWindowMs = IDLE_WINDOW_MS,
): Promise<() => void> {
  let releaseQueue!: () => void;
  const previous = automationTail;
  automationTail = new Promise<void>((resolve) => {
    releaseQueue = resolve;
  });
  await previous;
  try {
    await waitForForegroundIdle(idleWindowMs);
  } catch (error) {
    releaseQueue();
    throw error;
  }
  let released = false;
  return () => {
    if (released) return;
    released = true;
    releaseQueue();
  };
}

export function foregroundActivityCount(): number {
  return foregroundCount;
}
