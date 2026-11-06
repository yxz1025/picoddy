import { createHash, randomUUID } from "node:crypto";
import {
  mkdir,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { platformPaths } from "../../platform/paths.ts";
import { isValidExpertId } from "./registry.ts";
import type { ExpertManifest, ExpertPromptSource } from "./types.ts";
import { logExpertEvent, type ExpertEventField } from "./observability.ts";

export const DEFAULT_PROMPT_MAX_BYTES = 128 * 1024;
export const EXPERT_PROMPT_TIMEOUT_MS = 10_000;
export const TRUSTED_PROMPT_BASE_URL =
  process.env.PI_A_EXPERT_PROMPT_BASE_URL?.replace(/\/$/u, "") ?? "";

export interface ExpertPromptIo {
  readVerifiedCache(expertId: string, revision: string): Promise<string | null>;
  fetchTrusted(
    path: string,
    options: { timeoutMs: number; maxBytes: number },
  ): Promise<{ text: string; contentType: string }>;
  writeVerifiedCache(
    expertId: string,
    revision: string,
    value: { text: string; sha256: string; fetchedAt: string; maxBytes?: number },
  ): Promise<void>;
}

export interface ResolvedExpertPrompt {
  text: string;
  revision: string;
  promptSource: ExpertPromptSource;
}

export interface ExpertCacheFs {
  mkdir(path: string, options: { recursive: true }): Promise<string | undefined>;
  writeFile(path: string, data: string, encoding: "utf8"): Promise<void>;
  rename(oldPath: string, newPath: string): Promise<void>;
  rm(path: string, options: { recursive: true; force: true }): Promise<void>;
}

const nodeCacheFs: ExpertCacheFs = { mkdir, writeFile, rename, rm };

export class ExpertPromptError extends Error {
  readonly code: string;

  constructor(code: string, message = code) {
    super(`${code}: ${message}`);
    this.name = "ExpertPromptError";
    this.code = code;
  }
}

/** Convert a logical revision (including an ISO timestamp) to a safe path segment. */
export function normalizeRevision(revision: string): string {
  if (typeof revision !== "string"
    || revision.length === 0
    || revision.length > 128
    || revision.includes("/")
    || revision.includes("\\")
    || /[\u0000-\u001f\u007f]/.test(revision)) {
    throw new ExpertPromptError("EXPERT_PROMPT_INVALID_REVISION", revision);
  }
  // Every revision gets a digest-only directory name. This prevents
  // collisions between revisions that normalize to the same Windows-safe
  // spelling (for example `a:b` and `a_b`). Metadata retains the original.
  return `rev-${createHash("sha256").update(revision, "utf8").digest("hex")}`;
}

function safeRevision(revision: string): boolean {
  try {
    normalizeRevision(revision);
    return true;
  } catch {
    return false;
  }
}

export function validatePromptIdentity(expertId: string, revision: string): void {
  if (!isValidExpertId(expertId)) {
    throw new ExpertPromptError("EXPERT_PROMPT_INVALID_ID", expertId);
  }
  if (!safeRevision(revision)) {
    throw new ExpertPromptError("EXPERT_PROMPT_INVALID_REVISION", revision);
  }
}

export function validateRemotePath(path: string): void {
  // The catalog format intentionally uses a leading slash, but it is still a
  // relative path within our fixed catalog namespace, never an arbitrary URL.
  if (!path.startsWith("/plugins/")
    || path.includes("%")
    || path.includes("\\")
    || path.includes("?")
    || path.includes("#")
    || path.split("/").some((segment) => segment === ".." || segment === ".")
    || !/^\/plugins\/[A-Za-z0-9._~!$&'()*+,;=:@/-]+$/.test(path)) {
    throw new ExpertPromptError("EXPERT_PROMPT_INVALID_PATH", path);
  }
}

function maxBytesFor(manifest: ExpertManifest): number {
  const maxBytes = manifest.prompt.maxBytes;
  return Number.isFinite(maxBytes) && maxBytes > 0
    ? Math.floor(maxBytes)
    : DEFAULT_PROMPT_MAX_BYTES;
}

function byteLength(text: string): number {
  return Buffer.byteLength(text, "utf8");
}

function digest(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

function verifyText(text: string, maxBytes: number, expectedHash?: string): string {
  if (byteLength(text) > maxBytes) {
    throw new ExpertPromptError("EXPERT_PROMPT_TOO_LARGE");
  }
  const actualHash = digest(text);
  if (expectedHash && actualHash !== expectedHash.toLowerCase()) {
    throw new ExpertPromptError("EXPERT_PROMPT_HASH_MISMATCH");
  }
  return actualHash;
}

function acceptedContentType(contentType: string): boolean {
  const mediaType = contentType.split(";", 1)[0]?.trim().toLowerCase();
  return mediaType === "text/plain" || mediaType === "text/markdown";
}

/** Keep compatibility with the previous loader's frontmatter behavior. */
export function parsePromptText(text: string): string {
  const frontmatter = text.match(/^---\r?\n[\s\S]*?\r?\n---[ \t]*(?:\r?\n|$)/);
  return frontmatter ? text.slice(frontmatter[0].length).trim() : text.trim();
}

export async function resolveExpertPrompt(
  manifest: ExpertManifest,
  io: ExpertPromptIo,
  logger: (event: string, fields: Record<string, ExpertEventField>) => void = logExpertEvent,
): Promise<ResolvedExpertPrompt> {
  const startedAt = Date.now();
  validatePromptIdentity(manifest.id, manifest.revision);
  const maxBytes = maxBytesFor(manifest);
  const expectedHash = manifest.prompt.sha256?.toLowerCase();

  let lastError: ExpertPromptError | undefined;
  try {
    const cached = await io.readVerifiedCache(manifest.id, manifest.revision);
    if (cached !== null) {
      verifyText(cached, maxBytes, expectedHash);
      logger("expert.prompt.cache_hit", {
        expertId: manifest.id,
        revision: manifest.revision,
        promptSource: "cache",
        durationMs: Date.now() - startedAt,
        result: "success",
      });
      return {
        text: parsePromptText(cached),
        revision: manifest.revision,
        promptSource: "cache",
      };
    }
  } catch (error) {
    lastError = toPromptError(error, "EXPERT_PROMPT_CACHE_INVALID");
  }

  if (manifest.prompt.remotePath) {
    try {
      validateRemotePath(manifest.prompt.remotePath);
      const remote = await io.fetchTrusted(manifest.prompt.remotePath, {
        timeoutMs: EXPERT_PROMPT_TIMEOUT_MS,
        maxBytes,
      });
      if (!acceptedContentType(remote.contentType)) {
        throw new ExpertPromptError("EXPERT_PROMPT_INVALID_CONTENT_TYPE");
      }
      const sha256 = verifyText(remote.text, maxBytes, expectedHash);
      await io.writeVerifiedCache(manifest.id, manifest.revision, {
        text: remote.text,
        sha256,
        fetchedAt: new Date().toISOString(),
        maxBytes,
      });
      logger("expert.prompt.remote_loaded", {
        expertId: manifest.id,
        revision: manifest.revision,
        promptSource: "remote",
        durationMs: Date.now() - startedAt,
        result: "success",
      });
      return {
        text: parsePromptText(remote.text),
        revision: manifest.revision,
        promptSource: "remote",
      };
    } catch (error) {
      lastError = toPromptError(error, "EXPERT_PROMPT_REMOTE_FAILED");
    }
  }

  if (typeof manifest.prompt.inline === "string" && manifest.prompt.inline.trim()) {
    try {
      const sha256 = verifyText(manifest.prompt.inline, maxBytes, expectedHash);
      await io.writeVerifiedCache(manifest.id, manifest.revision, {
        text: manifest.prompt.inline,
        sha256,
        fetchedAt: new Date().toISOString(),
        maxBytes,
      });
      logger("expert.prompt.fallback", {
        expertId: manifest.id,
        revision: manifest.revision,
        promptSource: "inline",
        durationMs: Date.now() - startedAt,
        result: "success",
        errorCode: lastError?.code,
      });
      return {
        text: parsePromptText(manifest.prompt.inline),
        revision: manifest.revision,
        promptSource: "inline",
      };
    } catch (error) {
      lastError = toPromptError(error, "EXPERT_PROMPT_INLINE_INVALID");
    }
  }

  logger("expert.prompt.fallback", {
    expertId: manifest.id,
    revision: manifest.revision,
    promptSource: "inline",
    durationMs: Date.now() - startedAt,
    result: "error",
    errorCode: lastError?.code || "EXPERT_PROMPT_UNAVAILABLE",
  });
  throw lastError || new ExpertPromptError("EXPERT_PROMPT_UNAVAILABLE");
}

/**
 * Resolve only a previously verified cache entry for an exact revision.
 * Older session bindings must never silently use the current catalog prompt.
 */
export async function resolveCachedExpertPrompt(
  expertId: string,
  revision: string,
  options: {
    maxBytes?: number;
    io?: Pick<ExpertPromptIo, "readVerifiedCache">;
    logger?: (event: string, fields: Record<string, ExpertEventField>) => void;
  } = {},
): Promise<ResolvedExpertPrompt | null> {
  const startedAt = Date.now();
  validatePromptIdentity(expertId, revision);
  const maxBytes = Number.isFinite(options.maxBytes) && (options.maxBytes || 0) > 0
    ? Math.floor(options.maxBytes as number)
    : DEFAULT_PROMPT_MAX_BYTES;
  const cached = await (options.io?.readVerifiedCache ?? readVerifiedCache)(
    expertId,
    revision,
  );
  if (cached === null) return null;
  verifyText(cached, maxBytes);
  (options.logger ?? logExpertEvent)("expert.prompt.cache_hit", {
    expertId,
    revision,
    promptSource: "cache",
    durationMs: Date.now() - startedAt,
    result: "success",
  });
  return {
    text: parsePromptText(cached),
    revision,
    promptSource: "cache",
  };
}

function toPromptError(error: unknown, fallbackCode: string): ExpertPromptError {
  if (error instanceof ExpertPromptError) return error;
  return new ExpertPromptError(fallbackCode, error instanceof Error ? error.message : String(error));
}

async function readVerifiedCache(
  expertId: string,
  revision: string,
): Promise<string | null> {
  validatePromptIdentity(expertId, revision);
  const cacheRoot = platformPaths.join(
    platformPaths.appDataDir,
    "expert_prompts",
    expertId,
    normalizeRevision(revision),
  );
  return readVerifiedCacheAt(cacheRoot, expertId, revision);
}

export async function readVerifiedCacheAt(
  cacheRoot: string,
  expertId: string,
  revision: string,
): Promise<string | null> {
  validatePromptIdentity(expertId, revision);
  try {
    const [text, metadataText] = await Promise.all([
      readFile(platformPaths.join(cacheRoot, "prompt.md"), "utf8"),
      readFile(platformPaths.join(cacheRoot, "metadata.json"), "utf8"),
    ]);
    const metadata = JSON.parse(metadataText) as Record<string, unknown>;
    if (metadata.expertId !== expertId
      || metadata.revision !== revision
      || typeof metadata.sha256 !== "string"
      || digest(text) !== metadata.sha256.toLowerCase()) {
      return null;
    }
    return text;
  } catch {
    return null;
  }
}

async function fetchTrusted(
  path: string,
  options: { timeoutMs: number; maxBytes: number },
): Promise<{ text: string; contentType: string }> {
  validateRemotePath(path);
  if (!TRUSTED_PROMPT_BASE_URL) {
    throw new ExpertPromptError("EXPERT_PROMPT_SOURCE_NOT_CONFIGURED");
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs);
  try {
    let response: Response;
    try {
      response = await fetch(`${TRUSTED_PROMPT_BASE_URL}${path}`, {
        signal: controller.signal,
      });
    } catch (error) {
      if (controller.signal.aborted) {
        throw new ExpertPromptError("EXPERT_PROMPT_TIMEOUT");
      }
      throw error;
    }
    if (!response.ok) {
      throw new ExpertPromptError("EXPERT_PROMPT_HTTP_ERROR", String(response.status));
    }
    const contentLength = Number(response.headers.get("content-length") || "0");
    if (contentLength > options.maxBytes) {
      throw new ExpertPromptError("EXPERT_PROMPT_TOO_LARGE");
    }
    if (!response.body) {
      const text = await response.text();
      verifyText(text, options.maxBytes);
      return { text, contentType: response.headers.get("content-type") || "" };
    }
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    try {
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        total += chunk.value.byteLength;
        if (total > options.maxBytes) {
          await reader.cancel();
          throw new ExpertPromptError("EXPERT_PROMPT_TOO_LARGE");
        }
        chunks.push(chunk.value);
      }
    } finally {
      reader.releaseLock();
    }
    const bytes = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.length;
    }
    const text = new TextDecoder().decode(bytes);
    return { text, contentType: response.headers.get("content-type") || "" };
  } catch (error) {
    if (controller.signal.aborted) {
      throw new ExpertPromptError("EXPERT_PROMPT_TIMEOUT");
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

async function writeVerifiedCache(
  expertId: string,
  revision: string,
  value: { text: string; sha256: string; fetchedAt: string; maxBytes?: number },
): Promise<void> {
  validatePromptIdentity(expertId, revision);
  const cacheRoot = platformPaths.join(
    platformPaths.appDataDir,
    "expert_prompts",
    expertId,
    normalizeRevision(revision),
  );
  const parentDir = platformPaths.dirname(cacheRoot);
  await writeVerifiedCacheAtomically(parentDir, revision, expertId, revision, value);
}

/** Write both cache files by swapping one complete temporary directory. */
export async function writeVerifiedCacheAtomically(
  parentDir: string,
  cacheName: string,
  expertId: string,
  revision: string,
  value: { text: string; sha256: string; fetchedAt: string; maxBytes?: number },
  fs: ExpertCacheFs = nodeCacheFs,
): Promise<void> {
  validatePromptIdentity(expertId, revision);
  const expectedHash = digest(value.text);
  if (expectedHash !== value.sha256.toLowerCase()) {
    throw new ExpertPromptError("EXPERT_PROMPT_HASH_MISMATCH");
  }
  const maxBytes = Number.isFinite(value.maxBytes) && (value.maxBytes || 0) > 0
    ? Math.floor(value.maxBytes as number)
    : DEFAULT_PROMPT_MAX_BYTES;
  if (byteLength(value.text) > maxBytes) {
    throw new ExpertPromptError("EXPERT_PROMPT_TOO_LARGE");
  }
  const safeCacheName = normalizeRevision(cacheName);
  await fs.mkdir(parentDir, { recursive: true });
  const cacheRoot = platformPaths.join(parentDir, safeCacheName);
  const suffix = `${process.pid}-${randomUUID()}`;
  const tempRoot = platformPaths.join(parentDir, `.${safeCacheName}.${suffix}.tmp`);
  const backupRoot = platformPaths.join(parentDir, `.${safeCacheName}.${suffix}.bak`);
  const promptTmp = platformPaths.join(tempRoot, "prompt.md");
  const metadataTmp = platformPaths.join(tempRoot, "metadata.json");
  let oldMoved = false;
  try {
    await fs.mkdir(tempRoot, { recursive: true });
    await fs.writeFile(promptTmp, value.text, "utf8");
    await fs.writeFile(metadataTmp, JSON.stringify({
      expertId,
      revision,
      sha256: expectedHash,
      fetchedAt: value.fetchedAt,
    }), "utf8");
    try {
      await fs.rename(cacheRoot, backupRoot);
      oldMoved = true;
    } catch (error) {
      if (!isMissingPathError(error)) throw error;
    }
    await fs.rename(tempRoot, cacheRoot);
    if (oldMoved) await fs.rm(backupRoot, { recursive: true, force: true });
  } catch (error) {
    if (oldMoved) {
      await fs.rm(cacheRoot, { recursive: true, force: true }).catch(() => undefined);
      await fs.rename(backupRoot, cacheRoot).catch(() => undefined);
    }
    await fs.rm(tempRoot, { recursive: true, force: true }).catch(() => undefined);
    throw error;
  } finally {
    await fs.rm(tempRoot, { recursive: true, force: true }).catch(() => undefined);
    if (!oldMoved) await fs.rm(backupRoot, { recursive: true, force: true }).catch(() => undefined);
  }
}

function isMissingPathError(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === "ENOENT");
}

export function createDefaultExpertPromptIo(): ExpertPromptIo {
  return { readVerifiedCache, fetchTrusted, writeVerifiedCache };
}
