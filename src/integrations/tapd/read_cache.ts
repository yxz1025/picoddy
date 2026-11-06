/** Successful parsed reads only. No credentials or business data are persisted. */
export function createTapdReadCache(options: { now?: () => number; maxEntries?: number } = {}) {
  const now = options.now ?? Date.now;
  const entries = new Map<string, { until: number; value?: unknown; pending?: Promise<unknown> }>();
  const maxEntries = options.maxEntries ?? 512;
  async function read<T>(key: string, ttl: number, load: () => Promise<T>, fresh = false): Promise<T> {
    const existing = entries.get(key);
    if (!fresh && existing) {
      if (existing.pending) return structuredClone(await existing.pending) as T;
      if (existing.until > now()) return structuredClone(existing.value) as T;
    }
    for (const [id, entry] of entries) if (!entry.pending && entry.until <= now()) entries.delete(id);
    if (entries.size >= maxEntries) entries.delete(entries.keys().next().value!);
    const entry: { until: number; value?: unknown; pending?: Promise<unknown> } = { until: 0 };
    entries.set(key, entry);
    const pending = Promise.resolve().then(load);
    entry.pending = pending;
    try {
      const result = await pending;
      if (entries.get(key) === entry) {
        entry.value = structuredClone(result); entry.until = now() + ttl; entry.pending = undefined;
      }
      return structuredClone(result);
    } catch (error) {
      if (entries.get(key) === entry) entries.delete(key);
      throw error;
    }
  }
  return { read, clear: () => entries.clear() };
}

export const tapdReadCache = createTapdReadCache();
