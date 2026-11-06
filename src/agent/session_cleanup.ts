import { lstat, realpath, unlink } from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { getDb } from "../infra/db.ts";
import { listAgentChildrenByParent } from "../domains/connector/node/agent_session_store.ts";
import { getCoreSessionPath } from "../domains/session/node/store.ts";
import { platformPaths } from "../platform/paths.ts";

/** Remove only the mapped history file inside an application-owned session directory. */
export async function removeConversationSessionFile(sessionId: string): Promise<void> {
  const sessionPath = getCoreSessionPath(sessionId);
  if (!sessionPath) return;
  const target = resolve(sessionPath);
  const contains = (root: string, path: string) => {
    const offset = relative(root, path);
    return Boolean(offset) && offset !== ".." && !offset.startsWith(`..${sep}`) && !isAbsolute(offset);
  };
  const root = [
    join(platformPaths.appDataDir, "pi-agent", "sessions"),
    join(platformPaths.appDataDir, "core-sessions"),
  ].map(path => resolve(path)).find(path => contains(path, target));
  if (!root) throw new Error("会话历史文件不在受管目录内，已取消删除。");
  try {
    const info = await lstat(target);
    if (!info.isFile()) throw new Error("会话历史路径不是普通文件，已取消删除。");
    const [canonicalRoot, canonicalTarget] = await Promise.all([realpath(root), realpath(target)]);
    if (!contains(canonicalRoot, canonicalTarget)) {
      throw new Error("会话历史文件指向受管目录外，已取消删除。");
    }
    await unlink(target);
  } catch (error) {
    // Pi creates the history file lazily; empty or previously cleaned sessions have no file.
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}

export interface ConversationCleanupDependencies {
  dispose(sessionId: string): Promise<void>;
  removeCore(sessionId: string): Promise<void>;
  clearWorking(sessionId: string): void;
  removeSqlite(sessionId: string): void;
}

/**
 * Keep external session files removable while the SQLite row still contains
 * their path. Metadata is deleted last so failures remain recoverable.
 */
export async function deleteConversationData(
  sessionId: string,
  dependencies: ConversationCleanupDependencies,
): Promise<void> {
  await dependencies.dispose(sessionId);
  await dependencies.removeCore(sessionId);
  dependencies.clearWorking(sessionId);
  await disposeAgentChildren(sessionId, dependencies);
  dependencies.removeSqlite(sessionId);
}

/** 释放父会话持有的连接器子会话：停止 harness、删除 core 文件、移除 SQLite 行。 */
async function disposeAgentChildren(
  parentId: string,
  dependencies: ConversationCleanupDependencies,
): Promise<void> {
  for (const child of listAgentChildrenByParent(getDb(), parentId)) {
    await dependencies.dispose(child.childConversationId);
    await dependencies.removeCore(child.childConversationId);
    dependencies.removeSqlite(child.childConversationId);
  }
}
