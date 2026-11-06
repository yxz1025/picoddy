import { constants } from "node:fs";
import { lstat, open, realpath } from "node:fs/promises";
import { isIP } from "node:net";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";

import { ConnectorError } from "./errors.ts";
import type {
  ConnectorCatalog,
  ConnectorCatalogEntry,
  ConnectorCatalogErrorMapping,
  ConnectorLockedPackage,
} from "./types.ts";

export type ConnectorDescriptorIoPhase = "beforeOpen" | "afterOpen" | "afterRead";
export type ConnectorDescriptorIoHook = (event: {
  readonly phase: ConnectorDescriptorIoPhase;
  readonly path: string;
}) => void | Promise<void>;

export interface LoadConnectorCatalogOptions {
  readonly ioHook?: ConnectorDescriptorIoHook;
}

const MAX_CATALOG_BYTES = 1024 * 1024;
const MAX_CONNECTORS = 128;
const MAX_STRING = 4096;
const MAX_DESCRIPTION = 16 * 1024;
const MAX_ARGV = 64;
const MAX_ARG = 4096;
const MAX_DOMAINS = 64;
const MAX_PACKAGE_ENTRIES = 2048;
const MAX_ERROR_PATTERNS = 32;
const MAX_PATTERN = 1024;
const MAX_PATTERN_GROUPS = 16;
const MAX_PATTERN_ALTERNATIONS = 32;
const MAX_PATTERN_OPTIONALS = 8;
const MAX_JSON_MATCH_DEPTH = 5;
const MAX_JSON_MATCH_NODES = 256;
const MAX_JSON_MATCH_KEYS = 64;
const REGISTRY = "https://registry.npmjs.org" as const;
const EXACT_SEMVER = /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/u;
const PACKAGE_PART = /^[a-z0-9](?:[a-z0-9._-]{0,212}[a-z0-9])?$/u;
const HOSTNAME = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)(?:\.(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?))*$/u;
const DOS_DEVICE_BASENAME = /^(?:con|prn|aux|nul|clock\$|conin\$|conout\$|com[1-9¹²³]|lpt[1-9¹²³])$/iu;

class CatalogInvalidError extends Error {
  constructor(readonly detail?: unknown) {
    super("Invalid connector catalog");
  }
}

function invalid(detail?: unknown): never {
  throw new CatalogInvalidError(detail);
}

function object(value: unknown, keys?: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid();
  const record = value as Record<string, unknown>;
  if (keys && Object.keys(record).some((key) => !keys.includes(key))) invalid();
  return record;
}

function boundedString(value: unknown, max = MAX_STRING): string {
  if (typeof value !== "string" || value.length === 0 || value.length > max || value.includes("\0")) invalid();
  return value;
}

function literal<T extends string | number | boolean>(value: unknown, expected: T): T {
  if (value !== expected) invalid();
  return expected;
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

function npmPackage(value: unknown): string {
  const result = boundedString(value, 214);
  if (result.startsWith("@")) {
    const parts = result.slice(1).split("/");
    if (parts.length !== 2 || !parts[0] || !parts[1] || !PACKAGE_PART.test(parts[0]) || !PACKAGE_PART.test(parts[1])) invalid();
  } else if (!PACKAGE_PART.test(result)) {
    invalid();
  }
  return result;
}

function npmCoordinate(value: unknown): { readonly coordinate: string; readonly package: string; readonly version: string } {
  const coordinate = boundedString(value, 512);
  const separator = coordinate.lastIndexOf("@");
  if (separator <= 0) invalid();
  const packageName = npmPackage(coordinate.slice(0, separator));
  const version = exactSemver(coordinate.slice(separator + 1));
  if (coordinate !== `${packageName}@${version}`) invalid();
  return { coordinate, package: packageName, version };
}

function registryTarball(value: unknown, packageName: string, version: string): string {
  const result = boundedString(value, 2048);
  let url: URL;
  try {
    url = new URL(result);
  } catch (cause) {
    invalid(cause);
  }
  if (url.protocol !== "https:" || url.hostname !== "registry.npmjs.org" || url.port !== ""
    || url.username !== "" || url.password !== "" || url.search !== "" || url.hash !== "") invalid();
  const unscoped = packageName.startsWith("@") ? packageName.slice(packageName.indexOf("/") + 1) : packageName;
  const expectedPath = `/${packageName}/-/${unscoped}-${version}.tgz`;
  if (url.origin !== REGISTRY || url.pathname !== expectedPath || result !== `${REGISTRY}${expectedPath}`) invalid();
  return result;
}

function safeRelativePath(value: unknown): string {
  const result = boundedString(value, 1024);
  if (isAbsolute(result) || /^[A-Za-z]:/u.test(result) || result.includes("\\")) invalid();
  const segments = result.split("/");
  if (segments.some((segment) => {
    if (segment === "" || segment === "." || segment === ".."
      || /[<>:"|?*]/u.test(segment)
      || /[\u0000-\u001f\u007f]/u.test(segment)
      || /[. ]$/u.test(segment)) return true;
    const basename = segment.split(".", 1)[0]!.replace(/[. ]+$/u, "");
    return DOS_DEVICE_BASENAME.test(basename);
  })) invalid();
  return result;
}

function isIpLiteral(domain: string): boolean {
  if (isIP(domain) !== 0) return true;
  try {
    return isIP(new URL(`https://${domain}`).hostname) !== 0;
  } catch {
    return true;
  }
}

function argv(value: unknown, allowEmpty = false): string[] {
  if (!Array.isArray(value) || value.length > MAX_ARGV || (!allowEmpty && value.length === 0)) invalid();
  return value.map((argument) => boundedString(argument, MAX_ARG));
}

function boundedRegexpSyntax(source: string): void {
  let groups = 0;
  let alternations = 0;
  let optionals = 0;
  let inCharacterClass = false;
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index]!;
    if (character === "\\") {
      const escaped = source[index + 1];
      if (escaped === undefined || /[1-9]/u.test(escaped) || escaped === "k") invalid();
      index += 1;
      continue;
    }
    if (inCharacterClass) {
      if (character === "]") inCharacterClass = false;
      continue;
    }
    if (character === "[") {
      inCharacterClass = true;
      continue;
    }
    if (character === "(") {
      if (source.slice(index, index + 3) !== "(?:") invalid();
      groups += 1;
      if (groups > MAX_PATTERN_GROUPS) invalid();
      index += 2;
      continue;
    }
    if (character === "|") {
      alternations += 1;
      if (alternations > MAX_PATTERN_ALTERNATIONS) invalid();
      continue;
    }
    if (character === "?") {
      optionals += 1;
      if (optionals > MAX_PATTERN_OPTIONALS || source[index - 1] === "?") invalid();
      continue;
    }
    if (character === "*" || character === "+" || character === "{" || character === "}" || character === ".") invalid();
  }
}

function regexp(value: unknown): string {
  const result = boundedString(value, MAX_PATTERN);
  try {
    const compiled = new RegExp(result, "u");
    boundedRegexpSyntax(result);
    if (compiled.test("")) invalid();
  } catch (cause) {
    invalid(cause);
  }
  return result;
}

function jsonMatch(value: unknown): Readonly<Record<string, unknown>> {
  let nodes = 0;
  const visit = (current: unknown, depth: number): unknown => {
    nodes += 1;
    if (nodes > MAX_JSON_MATCH_NODES || depth > MAX_JSON_MATCH_DEPTH) invalid();
    if (current === null || typeof current === "string" || typeof current === "boolean") {
      if (typeof current === "string" && current.length > MAX_STRING) invalid();
      return current;
    }
    if (typeof current === "number") {
      if (!Number.isFinite(current)) invalid();
      return current;
    }
    if (Array.isArray(current)) {
      if (current.length > MAX_JSON_MATCH_KEYS) invalid();
      return current.map((child) => visit(child, depth + 1));
    }
    const record = object(current);
    const entries = Object.entries(record);
    if (entries.length > MAX_JSON_MATCH_KEYS) invalid();
    return Object.fromEntries(entries.map(([key, child]) => [boundedString(key, 256), visit(child, depth + 1)]));
  };
  const result = visit(value, 0);
  if (!result || typeof result !== "object" || Array.isArray(result)) invalid();
  return result as Readonly<Record<string, unknown>>;
}

function errorMapping(value: unknown): ConnectorCatalogErrorMapping {
  const data = object(value, ["AUTH_REQUIRED", "AUTH_FAILED", "CONNECTOR_TIMEOUT", "NETWORK_ERROR", "defaultNonZeroExit"]);
  const patterns = (candidate: unknown): string[] => {
    if (!Array.isArray(candidate) || candidate.length === 0 || candidate.length > MAX_ERROR_PATTERNS) invalid();
    return candidate.map(regexp);
  };
  return {
    AUTH_REQUIRED: patterns(data.AUTH_REQUIRED),
    AUTH_FAILED: patterns(data.AUTH_FAILED),
    CONNECTOR_TIMEOUT: patterns(data.CONNECTOR_TIMEOUT),
    NETWORK_ERROR: patterns(data.NETWORK_ERROR),
    defaultNonZeroExit: literal(data.defaultNonZeroExit, "CONNECTOR_BROKEN"),
  };
}

function parseEntry(value: unknown): ConnectorCatalogEntry {
  const data = object(value, [
    "id", "version", "displayName", "description", "presentation", "delegate", "runtime", "install", "skill",
    "executable", "versionCheck", "auth", "status", "logout", "commandPolicy", "errors", "packages",
  ]);
  const id = boundedString(data.id, 64);
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(id)) invalid();
  const presentation = object(data.presentation, ["icon"]);
  const delegate = object(data.delegate, ["toolName", "description"]);
  const toolName = boundedString(delegate.toolName, 128);
  if (toolName !== `delegate_to_${id.replaceAll("-", "_")}`) invalid();
  const runtime = object(data.runtime, ["type", "profile"]);
  const install = object(data.install, ["package", "version", "registry", "tarball", "integrity", "postInstall"]);
  const installPackage = npmPackage(install.package);
  const installVersion = exactSemver(install.version);
  const installIntegrity = integrity(install.integrity);
  const tarball = registryTarball(install.tarball, installPackage, installVersion);
  let postInstall: { readonly path: string; readonly argv: readonly string[] } | undefined;
  if (install.postInstall !== undefined) {
    const post = object(install.postInstall, ["path", "argv"]);
    postInstall = { path: safeRelativePath(post.path), argv: argv(post.argv, true) };
  }
  const skill = object(data.skill, ["source", "archive", "entry"]);
  const executable = object(data.executable, ["darwin", "linux", "win32"]);
  const platformExecutable = (platform: "darwin" | "linux" | "win32") => executable[platform] === undefined
    ? undefined
    : boundedString(executable[platform], 256);
  const parsedExecutable = {
    ...(platformExecutable("darwin") ? { darwin: platformExecutable("darwin") } : {}),
    ...(platformExecutable("linux") ? { linux: platformExecutable("linux") } : {}),
    ...(platformExecutable("win32") ? { win32: platformExecutable("win32") } : {}),
  };
  if (Object.keys(parsedExecutable).length === 0) invalid();
  const versionCheck = object(data.versionCheck, ["argv", "outputPattern"]);
  const auth = object(data.auth, ["argv", "allowedDomains", "waitForExit"]);
  if (!Array.isArray(auth.allowedDomains) || auth.allowedDomains.length === 0 || auth.allowedDomains.length > MAX_DOMAINS) invalid();
  const allowedDomains = auth.allowedDomains.map((domain) => boundedString(domain, 253).toLowerCase());
  if (allowedDomains.some((domain) => !HOSTNAME.test(domain) || isIpLiteral(domain))
    || new Set(allowedDomains).size !== allowedDomains.length) invalid();
  const status = object(data.status, ["argv", "format", "jsonMatch"]);
  const logout = object(data.logout, ["argv"]);
  const commandPolicy = object(data.commandPolicy, ["schema"]);
  const schema = object(commandPolicy.schema, ["argv"]);
  const packageData = object(data.packages);
  const packageEntries = Object.entries(packageData);
  if (packageEntries.length === 0 || packageEntries.length > MAX_PACKAGE_ENTRIES) invalid();
  const packages: Record<string, ConnectorLockedPackage> = Object.create(null) as Record<string, ConnectorLockedPackage>;
  for (const [key, rawLock] of packageEntries) {
    const coordinate = npmCoordinate(key);
    const lock = object(rawLock, ["resolved", "integrity"]);
    packages[coordinate.coordinate] = {
      resolved: registryTarball(lock.resolved, coordinate.package, coordinate.version),
      integrity: integrity(lock.integrity),
    };
  }
  const rootCoordinate = `${installPackage}@${installVersion}`;
  const rootLock = packages[rootCoordinate];
  if (!rootLock || rootLock.resolved !== tarball || rootLock.integrity !== installIntegrity) invalid();
  return {
    id,
    version: exactSemver(data.version),
    displayName: boundedString(data.displayName, 256),
    description: boundedString(data.description, MAX_DESCRIPTION),
    presentation: { icon: boundedString(presentation.icon, 1024) },
    delegate: { toolName, description: boundedString(delegate.description, MAX_DESCRIPTION) },
    runtime: { type: literal(runtime.type, "managed-node-npm"), profile: literal(runtime.profile, "default") },
    install: {
      package: installPackage,
      version: installVersion,
      registry: literal(install.registry, REGISTRY),
      tarball,
      integrity: installIntegrity,
      ...(postInstall ? { postInstall } : {}),
    },
    skill: {
      source: literal(skill.source, "package-archive"),
      archive: safeRelativePath(skill.archive),
      entry: safeRelativePath(skill.entry),
    },
    executable: parsedExecutable,
    versionCheck: { argv: argv(versionCheck.argv), outputPattern: regexp(versionCheck.outputPattern) },
    auth: { argv: argv(auth.argv), allowedDomains, waitForExit: literal(auth.waitForExit, true) },
    status: { argv: argv(status.argv), format: literal(status.format, "json"), jsonMatch: jsonMatch(status.jsonMatch) },
    logout: { argv: argv(logout.argv) },
    commandPolicy: { schema: { argv: argv(schema.argv) } },
    errors: errorMapping(data.errors),
    packages,
  };
}

function parseCatalog(value: unknown): ConnectorCatalog {
  const data = object(value, ["schemaVersion", "connectors"]);
  if (!Array.isArray(data.connectors) || data.connectors.length > MAX_CONNECTORS) invalid();
  const connectors = data.connectors.map(parseEntry);
  const ids = new Set<string>();
  for (const connector of connectors) {
    if (ids.has(connector.id)) invalid();
    ids.add(connector.id);
  }
  return { schemaVersion: literal(data.schemaVersion, 1), connectors };
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

export async function readConnectorDescriptorText(
  path: string,
  maxBytes: number,
  ioHook?: ConnectorDescriptorIoHook,
): Promise<string> {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 0) invalid();
  const requested = resolve(path);
  const parent = await realpath(dirname(requested)).catch(invalid);
  const before = await pathIdentity(parent, requested, "file");
  await ioHook?.({ phase: "beforeOpen", path: requested });
  const handle = await openReadOnlyNoFollow(requested);
  try {
    const opened = await handle.stat({ bigint: true }).catch(invalid);
    if (!opened.isFile()
      || opened.dev !== before.dev
      || opened.ino !== before.ino
      || opened.size !== before.size
      || opened.mtimeNs !== before.mtimeNs
      || opened.ctimeNs !== before.ctimeNs) invalid();
    if (opened.size > BigInt(maxBytes)) invalid();
    await ioHook?.({ phase: "afterOpen", path: requested });
    const chunks: Buffer[] = [];
    let total = 0;
    while (true) {
      const capacity = Math.min(64 * 1024, maxBytes + 1 - total);
      if (capacity <= 0) invalid();
      const chunk = Buffer.allocUnsafe(capacity);
      const { bytesRead } = await handle.read(chunk, 0, chunk.length, null).catch(invalid);
      if (bytesRead === 0) break;
      total += bytesRead;
      if (total > maxBytes) invalid();
      chunks.push(chunk.subarray(0, bytesRead));
    }
    await ioHook?.({ phase: "afterRead", path: requested });
    const afterFd = await handle.stat({ bigint: true }).catch(invalid);
    if (!afterFd.isFile()
      || afterFd.dev !== before.dev
      || afterFd.ino !== before.ino
      || afterFd.size !== before.size
      || afterFd.mtimeNs !== before.mtimeNs
      || afterFd.ctimeNs !== before.ctimeNs) invalid();
    const afterPath = await pathIdentity(parent, requested, "file");
    if (!sameIdentity(before, afterPath)) invalid();
    return new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks, total));
  } finally {
    await handle.close().catch(() => undefined);
  }
}

export async function loadConnectorCatalog(path: string, options: LoadConnectorCatalogOptions = {}): Promise<ConnectorCatalog> {
  try {
    const text = await readConnectorDescriptorText(path, MAX_CATALOG_BYTES, options.ioHook);
    return deepFreeze(parseCatalog(JSON.parse(text)));
  } catch (cause) {
    const detail = cause instanceof CatalogInvalidError ? cause.detail : cause;
    throw new ConnectorError("CONNECTOR_CATALOG_INVALID", "Connector catalog is invalid", { cause: detail });
  }
}
