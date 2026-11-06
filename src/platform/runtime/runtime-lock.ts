import { isAbsolute, posix, win32 } from "node:path";

export type RuntimePlatformKey = "darwin-arm64" | "darwin-x64" | "win32-ia32" | "win32-x64";
export type PythonArchiveFormat = "tar.gz" | "zip";

export interface PythonRuntimeLockEntry {
  readonly archive: string;
  readonly url: string;
  readonly archiveRoot?: string;
  readonly format: PythonArchiveFormat;
  readonly sha256: string;
  readonly size: number;
  readonly executable: "bin/python3" | "python.exe";
}

export interface RuntimeLock {
  readonly schemaVersion: 1;
  readonly node: {
    readonly source: "electron";
    readonly electronVersion: string;
    readonly nodeVersion: string;
    readonly npmVersion: string;
  };
  readonly python: {
    readonly version: string;
    readonly platforms: Partial<Record<RuntimePlatformKey, PythonRuntimeLockEntry>>;
  };
}

function invalid(message: string): never {
  throw new Error(`RUNTIME_LOCK_INVALID: ${message}`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringField(value: Record<string, unknown>, key: string): string {
  if (typeof value[key] !== "string" || value[key].length === 0) {
    return invalid(`${key} must be a non-empty string`);
  }
  return value[key];
}

function safeRelativePath(value: string, key: string): string {
  if (value.includes("\0") || value.includes("\\") || isAbsolute(value) || win32.isAbsolute(value)) {
    return invalid(`${key} must be a relative POSIX path`);
  }
  const normalized = posix.normalize(value);
  if (normalized === "." || normalized.startsWith("../") || normalized.includes("/../") || normalized !== value) {
    return invalid(`${key} contains an unsafe path`);
  }
  return value;
}

function parsePythonEntry(value: unknown, key: string): PythonRuntimeLockEntry {
  if (!isRecord(value)) return invalid(`${key} must be an object`);
  const archive = safeRelativePath(stringField(value, "archive"), `${key}.archive`);
  const url = stringField(value, "url");
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(url);
  } catch {
    return invalid(`${key}.url must be a valid URL`);
  }
  if (parsedUrl.protocol !== "https:" || parsedUrl.hostname !== "github.com") {
    return invalid(`${key}.url must use the approved HTTPS host`);
  }
  const archiveRoot = value.archiveRoot === undefined
    ? undefined
    : safeRelativePath(stringField(value, "archiveRoot"), `${key}.archiveRoot`);
  const format = stringField(value, "format");
  if (format !== "tar.gz" && format !== "zip") return invalid(`${key}.format is unsupported`);
  const sha256 = stringField(value, "sha256");
  if (!/^[a-f0-9]{64}$/u.test(sha256)) return invalid(`${key}.sha256 must be lowercase SHA-256`);
  const size = value.size;
  if (typeof size !== "number" || !Number.isSafeInteger(size) || size <= 0) {
    return invalid(`${key}.size must be a positive safe integer`);
  }
  const executable = stringField(value, "executable");
  if (executable !== "bin/python3" && executable !== "python.exe") {
    return invalid(`${key}.executable is unsupported`);
  }
  if (format === "tar.gz" && executable !== "bin/python3" && executable !== "python.exe") return invalid(`${key}.executable does not match format`);
  if (format === "zip" && executable !== "python.exe") return invalid(`${key}.executable does not match format`);
  return Object.freeze({ archive, archiveRoot, url, format, sha256, size, executable });
}

export function runtimePlatformKey(platform: string, arch: string): RuntimePlatformKey | undefined {
  const key = `${platform}-${arch}`;
  return key === "darwin-arm64" || key === "darwin-x64" || key === "win32-ia32" || key === "win32-x64"
    ? key
    : undefined;
}

export function parseRuntimeLock(value: unknown): RuntimeLock {
  if (!isRecord(value) || value.schemaVersion !== 1) invalid("schemaVersion must be 1");
  if (!isRecord(value.node) || value.node.source !== "electron") invalid("node.source must be electron");
  if (!isRecord(value.python) || !isRecord(value.python.platforms)) invalid("python.platforms must be an object");

  const node = Object.freeze({
    source: "electron" as const,
    electronVersion: stringField(value.node, "electronVersion"),
    nodeVersion: stringField(value.node, "nodeVersion"),
    npmVersion: stringField(value.node, "npmVersion"),
  });
  const version = stringField(value.python, "version");
  const platforms: Partial<Record<RuntimePlatformKey, PythonRuntimeLockEntry>> = {};
  for (const [key, entry] of Object.entries(value.python.platforms)) {
    if (key !== "darwin-arm64" && key !== "darwin-x64" && key !== "win32-ia32" && key !== "win32-x64") {
      invalid(`unsupported platform key ${key}`);
    }
    platforms[key] = parsePythonEntry(entry, `python.platforms.${key}`);
  }
  if (Object.keys(platforms).length === 0) {
    throw new Error("RUNTIME_PLATFORM_UNSUPPORTED: no supported Python platform entry");
  }
  return Object.freeze({
    schemaVersion: 1 as const,
    node,
    python: Object.freeze({ version, platforms: Object.freeze(platforms) }),
  });
}
