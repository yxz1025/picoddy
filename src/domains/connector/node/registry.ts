import { lstat, realpath } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";

import {
  loadConnectorCatalog,
  readConnectorDescriptorText,
} from "./catalog.ts";
import type { ConnectorDescriptorIoHook } from "./catalog.ts";
import { ConnectorError } from "./errors.ts";
import type { ConnectorCatalogEntry, ConnectorRuntimeLock } from "./types.ts";

export interface ConnectorRegistry {
  list(): readonly ConnectorCatalogEntry[];
  get(id: string): ConnectorCatalogEntry;
  // 唯一运行时事实来源：严格解析后的不可变 runtime lock（schema v2）。
  runtimeLock(): ConnectorRuntimeLock;
}

export interface CreateConnectorRegistryOptions {
  readonly limits?: Partial<ConnectorRegistryLimits>;
  readonly ioHook?: ConnectorDescriptorIoHook;
}

export interface ConnectorRegistryLimits {
  readonly maxRuntimeLockBytes: number;
}

const MAX_RUNTIME_LOCK_BYTES = 1024 * 1024;
const DEFAULT_LIMITS: ConnectorRegistryLimits = { maxRuntimeLockBytes: MAX_RUNTIME_LOCK_BYTES };
const EXACT_SEMVER = /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/u;

class RegistryInvalidError extends Error {
  constructor(readonly detail?: unknown) {
    super("Invalid connector registry");
  }
}

function invalid(detail?: unknown): never {
  throw new RegistryInvalidError(detail);
}

function object(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid();
  const record = value as Record<string, unknown>;
  if (Object.keys(record).some((key) => !keys.includes(key))) invalid();
  return record;
}

function boundedString(value: unknown, max = 4096): string {
  if (typeof value !== "string" || value.length === 0 || value.length > max || value.includes("\0")) invalid();
  return value;
}

function exactSemver(value: unknown): string {
  const result = boundedString(value, 256);
  if (!EXACT_SEMVER.test(result)) invalid();
  return result;
}

function integrity(value: unknown): string {
  const result = boundedString(value, 256);
  if (!/^sha512-[A-Za-z0-9+/]{86}==$/u.test(result)) invalid();
  const encoded = result.slice("sha512-".length);
  const decoded = Buffer.from(encoded, "base64");
  if (decoded.length !== 64 || decoded.toString("base64") !== encoded) invalid();
  return result;
}

function parseRuntime(value: unknown): ConnectorRuntimeLock {
  const data = object(value, ["schemaVersion", "host", "npm"]);
  if (data.schemaVersion !== 2) invalid();
  const host = object(data.host, ["source", "package", "version", "integrity", "nodeVersion"]);
  const npm = object(data.npm, ["package", "version", "integrity"]);
  if (host.source !== "electron" || host.package !== "electron" || npm.package !== "npm") invalid();
  return Object.freeze({
    schemaVersion: 2,
    host: Object.freeze({
      source: "electron",
      package: "electron",
      version: exactSemver(host.version),
      integrity: integrity(host.integrity),
      nodeVersion: exactSemver(host.nodeVersion),
    }),
    npm: Object.freeze({ package: "npm", version: exactSemver(npm.version), integrity: integrity(npm.integrity) }),
  });
}

function isInside(root: string, target: string): boolean {
  const path = relative(root, target);
  return path === "" || (path !== ".." && !path.startsWith(`..${sep}`) && !isAbsolute(path));
}

interface DirectoryIdentity {
  readonly canonical: string;
  readonly dev: bigint;
  readonly ino: bigint;
}

async function directoryIdentity(root: string, path: string): Promise<DirectoryIdentity> {
  const stat = await lstat(path, { bigint: true }).catch(invalid);
  if (stat.isSymbolicLink() || !stat.isDirectory()) invalid();
  const canonical = await realpath(path).catch(invalid);
  if (!isInside(root, canonical)) invalid();
  const canonicalStat = await lstat(canonical, { bigint: true }).catch(invalid);
  if (canonicalStat.isSymbolicLink() || !canonicalStat.isDirectory()
    || canonicalStat.dev !== stat.dev || canonicalStat.ino !== stat.ino) invalid();
  return { canonical, dev: stat.dev, ino: stat.ino };
}

function sameDirectory(left: DirectoryIdentity, right: DirectoryIdentity): boolean {
  return left.canonical === right.canonical && left.dev === right.dev && left.ino === right.ino;
}

export async function createConnectorRegistry(
  root: string,
  options: CreateConnectorRegistryOptions = {},
): Promise<ConnectorRegistry> {
  try {
    const limits = { ...DEFAULT_LIMITS, ...options.limits };
    if (!Number.isSafeInteger(limits.maxRuntimeLockBytes)
      || limits.maxRuntimeLockBytes < 0
      || limits.maxRuntimeLockBytes > MAX_RUNTIME_LOCK_BYTES) invalid();
    const requestedRoot = resolve(root);
    const rootStat = await lstat(requestedRoot, { bigint: true }).catch(invalid);
    if (rootStat.isSymbolicLink() || !rootStat.isDirectory()) invalid();
    const canonicalRoot = await realpath(requestedRoot).catch(invalid);
    const before = await directoryIdentity(canonicalRoot, canonicalRoot);
    if (rootStat.dev !== before.dev || rootStat.ino !== before.ino) invalid();

    const catalogPath = resolve(canonicalRoot, "connector-catalog.json");
    const runtimeLockPath = resolve(canonicalRoot, "connector-runtime-lock.json");
    const catalog = await loadConnectorCatalog(catalogPath, { ioHook: options.ioHook });
    const runtimeText = await readConnectorDescriptorText(runtimeLockPath, limits.maxRuntimeLockBytes, options.ioHook);
    const runtimeLock = parseRuntime(JSON.parse(runtimeText));
    // 目录条目只允许引用已注册的 managed-node-npm/default（catalog.ts 解析时已强制字面量），
    // 不再在 Registry 复制任何具体运行时版本。

    const after = await directoryIdentity(canonicalRoot, canonicalRoot);
    if (!sameDirectory(before, after)) invalid();
    const entries = Object.freeze([...catalog.connectors]);
    const byId = new Map(entries.map((entry) => [entry.id, entry]));
    const registry: ConnectorRegistry = {
      list: () => entries,
      get: (id) => {
        const connector = byId.get(id);
        if (!connector) throw new ConnectorError("CONNECTOR_NOT_FOUND", "Connector was not found");
        return connector;
      },
      runtimeLock: () => runtimeLock,
    };
    return Object.freeze(registry);
  } catch (cause) {
    if (cause instanceof ConnectorError && cause.code === "CONNECTOR_CATALOG_INVALID") throw cause;
    const detail = cause instanceof RegistryInvalidError ? cause.detail : cause;
    throw new ConnectorError("CONNECTOR_CATALOG_INVALID", "Connector registry is invalid", { cause: detail });
  }
}
