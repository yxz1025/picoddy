import type { ProtectedPathPolicy } from "../../platform/path_policy.ts";
import { mkdir, lstat, open, type FileHandle } from "node:fs/promises";

import { platformPaths } from "../../platform/paths.ts";

interface GlobalMutationQueue {
  tail: Promise<void>;
}

const queueKey = Symbol.for("pi-a.agent-mutation-queue");
const globalState = globalThis as typeof globalThis & {
  [queueKey]?: GlobalMutationQueue;
};
const queue = globalState[queueKey] ?? { tail: Promise.resolve() };
globalState[queueKey] = queue;

/**
 * Serializes all agent-originated filesystem mutations across policies and
 * sessions in this runtime. This closes races between file/document/shell
 * tools even when equivalent policies are reconstructed independently.
 * Every operation still performs its final path check immediately before
 * delegation.
 */
export async function withMutationLock<T>(
  policy: ProtectedPathPolicy,
  run: () => Promise<T>,
  options: { lockPath?: string } = {},
): Promise<T> {
  void policy;
  const previous = queue.tail;
  let release!: () => void;
  const current = new Promise<void>((resolve) => {
    release = resolve;
  });
  const tail = previous.catch(() => {}).then(() => current);
  queue.tail = tail;
  await previous.catch(() => {});
  try {
    return await withAdvisoryLock(
      options.lockPath ??
        platformPaths.join(
          platformPaths.systemDir,
          ".agent-mutation.lock",
        ),
      run,
    );
  } finally {
    release();
    if (queue.tail === tail) queue.tail = Promise.resolve();
  }
}

async function withAdvisoryLock<T>(
  lockPath: string,
  run: () => Promise<T>,
): Promise<T> {
  const parent = platformPaths.dirname(lockPath);
  await mkdir(parent, { recursive: true });
  const parentInfo = await lstat(parent);
  if (!parentInfo.isDirectory() || parentInfo.isSymbolicLink()) {
    throw new Error("Mutation lock parent must be a real directory");
  }
  let file: FileHandle | undefined;
  try {
    const existing = await lstat(lockPath).catch((error) => {
      if ((error as { code?: string }).code === "ENOENT") return undefined;
      throw error;
    });
    if (existing?.isSymbolicLink() || (existing && !existing.isFile())) {
      throw new Error("Mutation lock must be a regular non-symlink file");
    }
    if (existing && existing.nlink !== null && existing.nlink !== 1) {
      throw new Error("Mutation lock hard links are not allowed");
    }
    file = await open(lockPath, "a+", 0o600);
    const [pathInfo, fileInfo] = await Promise.all([
      lstat(lockPath),
      file.stat(),
    ]);
    if (
      pathInfo.isSymbolicLink() || !pathInfo.isFile() || !fileInfo.isFile() ||
      (pathInfo.nlink !== null && pathInfo.nlink !== 1) ||
      (fileInfo.nlink !== null && fileInfo.nlink !== 1) ||
      (pathInfo.dev !== null && fileInfo.dev !== null &&
        pathInfo.dev !== fileInfo.dev) ||
      (pathInfo.ino !== null && fileInfo.ino !== null &&
        pathInfo.ino !== fileInfo.ino)
    ) {
      throw new Error("Mutation lock identity changed while opening");
    }
    return await run();
  } finally {
    if (file) {
      try {
        file.close();
      } catch {}
    }
  }
}
