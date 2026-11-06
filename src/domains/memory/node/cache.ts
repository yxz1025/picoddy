/**
 * 通用内存缓存层，零领域依赖。可提升到 src/infra/cache.ts 供其他模块复用。
 *
 * 扩展方向（未来）：
 * - 分层检索：Prompt Runtime MemorySource 条目预算 → retriever（重要度+时效打分取 top-N），
 *   getOrLoadAsync 是异步检索的接缝。
 * - 新 scope（project）：缓存键 recall:project:{pid}，失效仅影响该 scope。
 * - 语义搜索：复用 RAG embedding 模式，在 memories 上建 FTS5 或向量表。
 * - 重要度评分：addColumn("memories", "importance", "REAL") + ORDER BY importance DESC。
 * - 缓存提升：本类保持领域无关，后续提升到 src/infra/cache.ts。
 */

export interface MemoryCacheOptions {
  /** 缓存过期时间（毫秒），默认 5 分钟 */
  ttlMs?: number;
}

interface CacheSlot {
  value: unknown;
  expiresAt: number;
}

const DEFAULT_TTL_MS = 5 * 60 * 1000;

export class MemoryCache {
  readonly #slots = new Map<string, CacheSlot>();
  readonly #inflight = new Map<string, Promise<unknown>>();
  readonly #ttlMs: number;

  constructor(opts?: MemoryCacheOptions) {
    this.#ttlMs = opts?.ttlMs ?? DEFAULT_TTL_MS;
  }

  // ── 底层操作 ──

  get<T>(key: string): T | undefined {
    const slot = this.#slots.get(key);
    if (!slot) return undefined;
    if (Date.now() > slot.expiresAt) {
      this.#slots.delete(key);
      return undefined;
    }
    return slot.value as T;
  }

  set(key: string, value: unknown): void {
    this.#slots.set(key, {
      value,
      expiresAt: Date.now() + this.#ttlMs,
    });
  }

  has(key: string): boolean {
    return this.get(key) !== undefined;
  }

  // ── 失效策略 ──

  invalidate(key: string): void {
    this.#slots.delete(key);
  }

  invalidatePrefix(prefix: string): void {
    for (const key of this.#slots.keys()) {
      if (key.startsWith(prefix)) this.#slots.delete(key);
    }
  }

  clear(): void {
    this.#slots.clear();
    this.#inflight.clear();
  }

  // ── 同步 get-or-load（匹配 DatabaseSync 同步查询） ──

  getOrLoad<T>(key: string, loader: () => T): T {
    const cached = this.get<T>(key);
    if (cached !== undefined) return cached;
    const value = loader();
    this.set(key, value);
    return value;
  }

  // ── 异步 get-or-load + single-flight（未来语义检索 / 异步 embedding 用） ──

  async getOrLoadAsync<T>(
    key: string,
    loader: () => Promise<T>,
  ): Promise<T> {
    const cached = this.get<T>(key);
    if (cached !== undefined) return cached;

    const inflight = this.#inflight.get(key) as Promise<T> | undefined;
    if (inflight) return inflight;

    const promise = loader().then((value) => {
      this.set(key, value);
      this.#inflight.delete(key);
      return value;
    });
    this.#inflight.set(key, promise);
    return promise;
  }

  get size(): number {
    // 惰性清理过期条目
    let count = 0;
    const now = Date.now();
    for (const [key, slot] of this.#slots) {
      if (now > slot.expiresAt) {
        this.#slots.delete(key);
      } else {
        count += 1;
      }
    }
    return count;
  }
}
