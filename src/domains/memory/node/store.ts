// Session-aware memory storage.
//
// 缓存键设计：
//   recall:user                  → recallMemories()
//   recall:working:{sessionId}   → recallWorkingMemory(sessionId)
//   list:all:{offset}:{limit}    → listAllMemories(opts)
//
// 失效策略（精确失效，仅清除受影响范围）：
//   writeMemory(scope="user")           → recall:user + list:*
//   writeMemory(scope="working", sid)   → recall:working:{sid} + list:*
//   clearWorkingMemory(sid)             → recall:working:{sid} + list:*
//   deleteMemory(id)                    → recall:* + list:* （scope 未知，全清 recall）
//
// 扩展方向：见 src/domains/memory/node/cache.ts 文件头注释。

import type { DatabaseSync } from "node:sqlite";
import { getDb } from "../../../infra/db.ts";
import { MemoryCache } from "./cache.ts";

export interface Memory {
  id: string;
  scope: string;
  kind: string;
  content: string;
  sessionId?: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface MemoryListOptions {
  limit?: number;
  offset?: number;
}

export interface MemoryListResult {
  items: Memory[];
  total: number;
}

const RECALL_USER = "recall:user";
const RECALL_WORKING = "recall:working:";
const LIST_ALL = "list:all:";

export function createMemoryStore(getDatabase: () => DatabaseSync) {
  const cache = new MemoryCache();

  // ── 写操作 ──

  const writeMemory = (
    content: string,
    kind = "fact",
    scope = "user",
    sessionId?: string,
  ): Memory => {
    const id = crypto.randomUUID();
    const now = Date.now();
    const owner = scope === "working" ? sessionId ?? null : null;
    getDatabase().prepare(
      "INSERT INTO memories (id, scope, kind, content, session_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
    ).run(id, scope, kind, content, owner, now, now);

    // 精确失效：仅清除受影响的缓存范围
    if (scope === "user") {
      cache.invalidate(RECALL_USER);
    } else if (scope === "working" && sessionId) {
      cache.invalidate(RECALL_WORKING + sessionId);
    }
    cache.invalidatePrefix(LIST_ALL);

    return {
      id,
      scope,
      kind,
      content,
      sessionId: owner,
      createdAt: now,
      updatedAt: now,
    };
  };

  // ── 读操作（带缓存） ──

  const recallMemories = (): Memory[] =>
    cache.getOrLoad(RECALL_USER, () =>
      getDatabase().prepare(
        "SELECT id, scope, kind, content, session_id as sessionId, created_at as createdAt, updated_at as updatedAt FROM memories WHERE scope = 'user' ORDER BY updated_at DESC",
      ).all() as unknown as Memory[]);

  const recallWorkingMemory = (sessionId: string): Memory[] =>
    cache.getOrLoad(RECALL_WORKING + sessionId, () =>
      getDatabase().prepare(
        "SELECT id, scope, kind, content, session_id as sessionId, created_at as createdAt, updated_at as updatedAt FROM memories WHERE scope = 'working' AND session_id = ? ORDER BY created_at DESC",
      ).all(sessionId) as unknown as Memory[]);

  const recallAllMemories = (sessionId?: string): Memory[] => {
    const working = sessionId ? recallWorkingMemory(sessionId) : [];
    return [...working, ...recallMemories()];
  };

  // ── 清理 ──

  const clearWorkingMemory = (sessionId: string): void => {
    getDatabase().prepare(
      "DELETE FROM memories WHERE scope = 'working' AND session_id = ?",
    ).run(sessionId);
    cache.invalidate(RECALL_WORKING + sessionId);
    cache.invalidatePrefix(LIST_ALL);
  };

  // ── 全量列表（带分页 + 缓存） ──

  const listAllMemories = (opts?: MemoryListOptions): MemoryListResult => {
    const offset = opts?.offset ?? 0;
    const limit = opts?.limit;
    const effectiveLimit = limit ?? (offset > 0 ? 500 : undefined);
    const key = `${LIST_ALL}${offset}:${effectiveLimit ?? "all"}`;

    return cache.getOrLoad(key, () => {
      const db = getDatabase();
      const items = effectiveLimit === undefined
        ? db.prepare(
          "SELECT id, scope, kind, content, session_id as sessionId, created_at as createdAt, updated_at as updatedAt FROM memories ORDER BY updated_at DESC",
        ).all() as unknown as Memory[]
        : db.prepare(
          "SELECT id, scope, kind, content, session_id as sessionId, created_at as createdAt, updated_at as updatedAt FROM memories ORDER BY updated_at DESC LIMIT ? OFFSET ?",
        ).all(effectiveLimit, offset) as unknown as Memory[];
      const total = (db.prepare("SELECT COUNT(*) as c FROM memories").get() as { c: number }).c;
      return { items, total };
    });
  };

  // ── 删除 ──

  const deleteMemory = (id: string): void => {
    getDatabase().prepare("DELETE FROM memories WHERE id = ?").run(id);
    // scope 未知，全清 recall 缓存；list 也因总量变化而失效
    cache.invalidatePrefix("recall:"); // scope 未知，全清 user + working 两级
    cache.invalidatePrefix(LIST_ALL);
  };

  return {
    writeMemory,
    recallMemories,
    recallWorkingMemory,
    recallAllMemories,
    clearWorkingMemory,
    listAllMemories,
    deleteMemory,
    /** 暴露缓存实例供测试使用 */
    _cache: cache,
  };
}

const defaultStore = createMemoryStore(getDb);

export const writeMemory = defaultStore.writeMemory;
export const recallMemories = defaultStore.recallMemories;
export const recallWorkingMemory = defaultStore.recallWorkingMemory;
export const recallAllMemories = defaultStore.recallAllMemories;
export const clearWorkingMemory = defaultStore.clearWorkingMemory;
export const listAllMemories = defaultStore.listAllMemories;
export const deleteMemory = defaultStore.deleteMemory;
