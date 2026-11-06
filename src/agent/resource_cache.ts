import { createHash } from 'node:crypto';
import { readdirSync, realpathSync, statSync } from 'node:fs';
import { join } from 'node:path';

/** Check metadata, including nested edits and symlink targets, without rereading bodies. */
function revision(roots: readonly string[]): string {
  const hash = createHash('sha256');
  const visited = new Set<string>();
  const visit = (path: string) => {
    hash.update(path);
    let info;
    try { info = statSync(path, { bigint: true }); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      hash.update('missing'); return;
    }
    hash.update(`${info.ino}:${info.size}:${info.mtimeNs}:${info.ctimeNs}`);
    if (!info.isDirectory()) return;
    const real = realpathSync(path);
    if (visited.has(real)) return;
    visited.add(real);
    for (const name of readdirSync(path).sort()) visit(join(path, name));
  };
  roots.forEach(visit);
  return hash.digest('hex');
}

export class ResourceCache<T> {
  constructor(private readonly maxEntries = 128) {}
  private entries = new Map<string, { revision: string; value: T }>();
  clear(): void { this.entries.clear(); }
  get(roots: readonly string[], load: () => T): T {
    const key = JSON.stringify(roots);
    let current: string;
    try { current = revision(roots); }
    catch { return load(); } // Preserve each loader's own unavailable-resource policy.
    const previous = this.entries.get(key);
    if (previous?.revision === current) return previous.value;
    const value = load();
    const entry = { revision: current, value };
    this.entries.set(key, entry);
    if (this.entries.size > this.maxEntries) this.entries.delete(this.entries.keys().next().value!);
    // Async loaders share in-flight work, but failures must never become sticky.
    if (value instanceof Promise) void value.catch(() => {
      if (this.entries.get(key) === entry) this.entries.delete(key);
    });
    return value;
  }
}
