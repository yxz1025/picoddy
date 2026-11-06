import { randomBytes } from "node:crypto";
import { constants } from "node:fs";
import { lstat, mkdir, open, realpath, rename, rm } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

import { CONNECTOR_ERROR_HTTP_STATUS, ConnectorError } from "./errors.ts";
import type { ConnectorErrorCode } from "./errors.ts";
import { validateConnectorId } from "./paths.ts";
import type { ConnectorLifecycleState } from "./types.ts";

export interface ConnectorStateRecord {
  connectorId: string;
  state: ConnectorLifecycleState;
  catalogVersion: string;
  cliVersion?: string;
  operationId?: string;
  updatedAt: string;
  error?: { code: ConnectorErrorCode; message: string; retryable: boolean };
}

export interface ConnectorStateWriteOptions {
  readonly failBeforeRename?: boolean;
}

export interface ConnectorStateStore {
  read(connectorId: string): Promise<ConnectorStateRecord>;
  write(record: ConnectorStateRecord, options?: ConnectorStateWriteOptions): Promise<void>;
}

const MAX_STATE_BYTES = 256 * 1024;
const MAX_STRING = 4096;
const EXACT_SEMVER = /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/u;
const ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/u;
const LIFECYCLE_STATES: readonly ConnectorLifecycleState[] = [
  "not_installed",
  "installing",
  "installed_unauthorized",
  "authorizing",
  "ready",
  "auth_expired",
  "install_failed",
  "version_invalid",
  "auth_failed",
  "runtime_broken",
  "connector_broken",
];
const ERROR_CODES = new Set<string>(Object.keys(CONNECTOR_ERROR_HTTP_STATUS));

class StateInvalidError extends Error {
  constructor(readonly detail?: unknown) {
    super("Invalid connector state");
  }
}

function invalid(detail?: unknown): never {
  throw new StateInvalidError(detail);
}

function isEnoent(cause: unknown): boolean {
  return (cause as NodeJS.ErrnoException)?.code === "ENOENT";
}

function object(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid();
  const record = value as Record<string, unknown>;
  if (Object.keys(record).some((key) => !keys.includes(key))) invalid();
  return record;
}

function boundedString(value: unknown, max = MAX_STRING): string {
  if (typeof value !== "string" || value.length === 0 || value.length > max || value.includes("\0")) invalid();
  return value;
}

function exactSemver(value: unknown): string {
  const result = boundedString(value, 256);
  if (!EXACT_SEMVER.test(result)) invalid();
  return result;
}

function stateError(value: unknown): { code: ConnectorErrorCode; message: string; retryable: boolean } {
  const data = object(value, ["code", "message", "retryable"]);
  const code = boundedString(data.code, 64);
  if (!ERROR_CODES.has(code)) invalid();
  const message = boundedString(data.message, 2048);
  if (typeof data.retryable !== "boolean") invalid();
  return { code: code as ConnectorErrorCode, message, retryable: data.retryable };
}

function parseRecord(value: unknown): ConnectorStateRecord {
  const data = object(value, ["connectorId", "state", "catalogVersion", "cliVersion", "operationId", "updatedAt", "error"]);
  const connectorId = boundedString(data.connectorId, 64);
  try {
    validateConnectorId(connectorId);
  } catch {
    invalid();
  }
  const state = boundedString(data.state, 64);
  if (!LIFECYCLE_STATES.includes(state as ConnectorLifecycleState)) invalid();
  const cliVersion = data.cliVersion === undefined ? undefined : exactSemver(data.cliVersion);
  const operationId = data.operationId === undefined ? undefined : boundedString(data.operationId, 128);
  const updatedAt = boundedString(data.updatedAt, 64);
  if (!ISO_TIMESTAMP.test(updatedAt)) invalid();
  const error = data.error === undefined ? undefined : stateError(data.error);
  return {
    connectorId,
    state: state as ConnectorLifecycleState,
    // not_installed 允许空 catalogVersion，与读取缺失状态文件的默认记录保持往返一致
    catalogVersion: state === "not_installed" && data.catalogVersion === ""
      ? ""
      : exactSemver(data.catalogVersion),
    ...(cliVersion !== undefined ? { cliVersion } : {}),
    ...(operationId !== undefined ? { operationId } : {}),
    updatedAt,
    ...(error !== undefined ? { error } : {}),
  };
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  }
  return value;
}

function isInside(root: string, target: string): boolean {
  const path = relative(root, target);
  return path === "" || (path !== ".." && !path.startsWith(`..${sep}`) && !isAbsolute(path));
}

interface PathIdentity {
  readonly canonical: string;
  readonly dev: bigint;
  readonly ino: bigint;
  readonly size: bigint;
  readonly mtimeNs: bigint;
  readonly ctimeNs: bigint;
}

function sameIdentity(left: PathIdentity, right: PathIdentity): boolean {
  return left.canonical === right.canonical
    && left.dev === right.dev
    && left.ino === right.ino
    && left.size === right.size
    && left.mtimeNs === right.mtimeNs
    && left.ctimeNs === right.ctimeNs;
}

async function pathIdentity(root: string, path: string, kind: "file" | "directory"): Promise<PathIdentity> {
  const stat = await lstat(path, { bigint: true }).catch(invalid);
  if (stat.isSymbolicLink() || (kind === "file" ? !stat.isFile() : !stat.isDirectory())) invalid();
  const canonical = await realpath(path).catch(invalid);
  if (!isInside(root, canonical)) invalid();
  const canonicalStat = await lstat(canonical, { bigint: true }).catch(invalid);
  if (canonicalStat.isSymbolicLink()
    || (kind === "file" ? !canonicalStat.isFile() : !canonicalStat.isDirectory())
    || canonicalStat.dev !== stat.dev || canonicalStat.ino !== stat.ino) invalid();
  return {
    canonical,
    dev: stat.dev,
    ino: stat.ino,
    size: stat.size,
    mtimeNs: stat.mtimeNs,
    ctimeNs: stat.ctimeNs,
  };
}

async function openReadOnlyNoFollow(path: string) {
  const noFollow = constants.O_NOFOLLOW;
  if (typeof noFollow !== "number" || noFollow === 0) return open(path, constants.O_RDONLY).catch(invalid);
  try {
    return await open(path, constants.O_RDONLY | noFollow);
  } catch (cause) {
    const code = (cause as NodeJS.ErrnoException).code;
    if (code === "EINVAL" || code === "ENOSYS" || code === "ENOTSUP") {
      return open(path, constants.O_RDONLY).catch(invalid);
    }
    invalid(cause);
  }
}

// Returns undefined only when the state file is absent; any other failure is invalid.
async function readStateText(statePath: string): Promise<string | undefined> {
  const requested = resolve(statePath);
  const parentCanonical = await realpath(dirname(requested)).catch((cause: unknown) => {
    if (isEnoent(cause)) return undefined;
    invalid(cause);
  });
  if (parentCanonical === undefined) return undefined;
  const before = await pathIdentity(parentCanonical, requested, "file").catch((cause: unknown) => {
    if (cause instanceof StateInvalidError && isEnoent(cause.detail)) return undefined;
    if (cause instanceof StateInvalidError) throw cause;
    invalid(cause);
  });
  if (before === undefined) return undefined;
  const handle = await openReadOnlyNoFollow(requested);
  try {
    const opened = await handle.stat({ bigint: true }).catch(invalid);
    if (!opened.isFile()
      || opened.dev !== before.dev
      || opened.ino !== before.ino
      || opened.size !== before.size
      || opened.mtimeNs !== before.mtimeNs
      || opened.ctimeNs !== before.ctimeNs) invalid();
    if (opened.size > BigInt(MAX_STATE_BYTES)) invalid();
    const chunks: Buffer[] = [];
    let total = 0;
    while (true) {
      const capacity = Math.min(64 * 1024, MAX_STATE_BYTES + 1 - total);
      if (capacity <= 0) invalid();
      const chunk = Buffer.allocUnsafe(capacity);
      const { bytesRead } = await handle.read(chunk, 0, chunk.length, null).catch(invalid);
      if (bytesRead === 0) break;
      total += bytesRead;
      if (total > MAX_STATE_BYTES) invalid();
      chunks.push(chunk.subarray(0, bytesRead));
    }
    const afterFd = await handle.stat({ bigint: true }).catch(invalid);
    if (!afterFd.isFile()
      || afterFd.dev !== before.dev
      || afterFd.ino !== before.ino
      || afterFd.size !== before.size
      || afterFd.mtimeNs !== before.mtimeNs
      || afterFd.ctimeNs !== before.ctimeNs) invalid();
    const afterPath = await pathIdentity(parentCanonical, requested, "file").catch(invalid);
    if (!sameIdentity(before, afterPath)) invalid();
    return new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks, total));
  } finally {
    await handle.close().catch(() => undefined);
  }
}

export function createConnectorStateStore(root: string): ConnectorStateStore {
  const statesDir = resolve(root, "states");
  const statePath = (connectorId: string) => join(statesDir, `${connectorId}.json`);
  const store: ConnectorStateStore = {
    async read(connectorId) {
      validateConnectorId(connectorId);
      try {
        const text = await readStateText(statePath(connectorId));
        if (text === undefined) {
          return Object.freeze({
            connectorId,
            state: "not_installed" as const,
            catalogVersion: "",
            updatedAt: "",
          });
        }
        return deepFreeze(parseRecord(JSON.parse(text)));
      } catch (cause) {
        if (cause instanceof ConnectorError) throw cause;
        const detail = cause instanceof StateInvalidError ? cause.detail : cause;
        throw new ConnectorError("CONNECTOR_BROKEN", "Connector state is invalid", { cause: detail });
      }
    },
    async write(record, options = {}) {
      try {
        const validated = parseRecord(record);
        await mkdir(statesDir, { recursive: true }).catch(invalid);
        const dirStat = await lstat(statesDir).catch(invalid);
        if (dirStat.isSymbolicLink() || !dirStat.isDirectory()) invalid();
        const tempPath = join(statesDir, `${validated.connectorId}.json.${randomBytes(8).toString("hex")}.tmp`);
        try {
          const handle = await open(
            tempPath,
            constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY,
            0o600,
          ).catch(invalid);
          try {
            await handle.writeFile(`${JSON.stringify(validated)}\n`, "utf8").catch(invalid);
            await handle.sync().catch(invalid);
          } finally {
            await handle.close().catch(() => undefined);
          }
          if (options.failBeforeRename) throw new Error("Simulated state write failure");
          await rename(tempPath, statePath(validated.connectorId)).catch(invalid);
          const dirHandle = await open(statesDir, constants.O_RDONLY).catch(invalid);
          try {
            await dirHandle.sync().catch((cause: unknown) => {
              const code = (cause as NodeJS.ErrnoException).code;
              if (code === "EINVAL" || code === "ENOSYS" || code === "ENOTSUP" || code === "EBADF") return;
              invalid(cause);
            });
          } finally {
            await dirHandle.close().catch(() => undefined);
          }
        } finally {
          await rm(tempPath, { force: true }).catch(() => undefined);
        }
      } catch (cause) {
        const detail = cause instanceof StateInvalidError ? cause.detail : cause;
        throw new ConnectorError("CONNECTOR_BROKEN", "Failed to persist connector state", { cause: detail });
      }
    },
  };
  return Object.freeze(store);
}
