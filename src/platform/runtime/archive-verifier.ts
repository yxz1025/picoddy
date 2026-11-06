import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { lstat, mkdir, open, readFile, rename, rm, stat } from "node:fs/promises";
import { dirname, isAbsolute, posix, win32 } from "node:path";

export const MAX_ARCHIVE_BYTES = 512 * 1024 * 1024;
export const MAX_EXTRACTED_BYTES = 512 * 1024 * 1024;
export const MAX_FILE_BYTES = 128 * 1024 * 1024;
export const MAX_ARCHIVE_ENTRIES = 20_000;

export type ArchiveEntryKind = "file" | "directory";

export function validateArchiveEntry(name: string, kind: ArchiveEntryKind): string {
  if (!name || name.includes("\0") || name.includes("//") || name.includes("\\\\")) {
    throw new Error("RUNTIME_ARCHIVE_ENTRY_INVALID: empty or malformed path");
  }
  if (isAbsolute(name) || win32.isAbsolute(name)) {
    throw new Error("RUNTIME_ARCHIVE_ENTRY_INVALID: absolute path");
  }
  const normalized = name.replaceAll("\\", "/").replace(/\/+$/u, "");
  if (!normalized) throw new Error("RUNTIME_ARCHIVE_ENTRY_INVALID: empty path");
  const parts = normalized.split("/");
  if (parts.some((part) => part === "" || part === "." || part === "..")) {
    throw new Error("RUNTIME_ARCHIVE_ENTRY_INVALID: path traversal");
  }
  if (posix.normalize(normalized) !== normalized) {
    throw new Error("RUNTIME_ARCHIVE_ENTRY_INVALID: non-normalized path");
  }
  if (kind !== "file" && kind !== "directory") {
    throw new Error("RUNTIME_ARCHIVE_ENTRY_INVALID: unsupported entry type");
  }
  return normalized;
}

export async function assertOrdinaryFileWithoutSymlink(path: string): Promise<void> {
  const info = await lstat(path).catch(() => undefined);
  if (!info || !info.isFile() || info.isSymbolicLink()) {
    throw new Error("RUNTIME_ARCHIVE_MISSING: archive must be an ordinary file");
  }
}

export async function verifyArchiveFile(
  archivePath: string,
  expected: { size: number; sha256: string },
): Promise<void> {
  await assertOrdinaryFileWithoutSymlink(archivePath);
  if (!Number.isSafeInteger(expected.size) || expected.size <= 0 || expected.size > MAX_ARCHIVE_BYTES) {
    throw new Error("RUNTIME_ARCHIVE_INVALID: archive size is outside limits");
  }
  const info = await stat(archivePath);
  if (info.size !== expected.size) throw new Error("RUNTIME_ARCHIVE_DIGEST_MISMATCH: archive size differs");
  const digest = createHash("sha256");
  await new Promise<void>((resolve, reject) => {
    const stream = createReadStream(archivePath);
    stream.on("data", (chunk: string | Buffer) => digest.update(chunk));
    stream.on("error", reject);
    stream.on("end", resolve);
  });
  if (digest.digest("hex") !== expected.sha256) {
    throw new Error("RUNTIME_ARCHIVE_DIGEST_MISMATCH: archive SHA-256 differs");
  }
}

export interface ArchiveLimits {
  entries?: number;
  extractedBytes?: number;
  fileBytes?: number;
}

export function createArchiveBudget(limits: ArchiveLimits = {}) {
  let entries = 0;
  let extractedBytes = 0;
  const maxEntries = limits.entries ?? MAX_ARCHIVE_ENTRIES;
  const maxExtractedBytes = limits.extractedBytes ?? MAX_EXTRACTED_BYTES;
  const maxFileBytes = limits.fileBytes ?? MAX_FILE_BYTES;
  return {
    accept(kind: ArchiveEntryKind, size = 0): void {
      entries += 1;
      if (entries > maxEntries) throw new Error("RUNTIME_ARCHIVE_LIMIT: too many entries");
      if (!Number.isSafeInteger(size) || size < 0 || size > maxFileBytes) {
        throw new Error("RUNTIME_ARCHIVE_LIMIT: file is too large");
      }
      if (kind === "file") {
        extractedBytes += size;
        if (extractedBytes > maxExtractedBytes) {
          throw new Error("RUNTIME_ARCHIVE_LIMIT: extracted data is too large");
        }
      }
    },
    get entries() { return entries; },
    get extractedBytes() { return extractedBytes; },
  };
}

export async function writeJsonAtomically(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.${Date.now()}.tmp`;
  const handle = await open(temporary, "wx", 0o600);
  try {
    await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
  try {
    const existing = await lstat(path).catch(() => undefined);
    if (existing?.isSymbolicLink()) throw new Error("RUNTIME_PATH_INVALID: target is a symlink");
    if (!existing) {
      await rename(temporary, path);
    } else if (process.platform !== "win32") {
      await rename(temporary, path);
    } else {
      const backup = `${path}.${process.pid}.${Date.now()}.backup`;
      await rename(path, backup);
      try {
        await rename(temporary, path);
      } catch (error) {
        await rename(backup, path).catch(() => undefined);
        throw error;
      }
      await rm(backup, { force: true });
    }
  } catch (error) {
    await rm(temporary, { force: true }).catch(() => undefined);
    throw error;
  }
}

export async function readJsonFile<T>(path: string): Promise<T | undefined> {
  try {
    const info = await lstat(path);
    if (!info.isFile() || info.isSymbolicLink()) return undefined;
    return JSON.parse(await readFile(path, "utf8")) as T;
  } catch {
    return undefined;
  }
}
