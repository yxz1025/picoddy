import type { Database } from "../../../infra/db.ts";
import { fail, HttpError } from "../../../shared/errors.ts";
import {
  SKILL_PACKAGE_LIMITS,
  parseSkillPackage,
} from "../../skill/node/package.ts";
import {
  createSkillService,
  type SkillDto,
} from "../../skill/node/service.ts";
import type { SkillHubCredential } from "./auth.ts";
import type { FetchLike } from "./client.ts";

export {
  createSkillHubExpertArchiveInstaller,
  type SkillHubInstalledExpert,
} from "./expert-package.ts";

const DOWNLOAD_TIMEOUT_MS = 15_000;
const MAX_DOWNLOAD_REDIRECTS = 3;
const COORDINATE_PART = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

export interface SkillHubInstallInput {
  namespace: string;
  slug: string;
  version: string;
}

export interface SkillHubPackageSource extends SkillHubInstallInput {}

/**
 * Complete expert-package persistence boundary.
 *
 * Implementations must validate the archive as an Agent expert package and
 * atomically persist its complete manifest/files and cloud catalog version.
 * A plain expert resource CRUD service is deliberately not accepted because
 * it would discard package metadata and files.
 */
export interface SkillHubExpertArchiveInstaller<TExpert = Record<string, unknown>> {
  validateAndInstall(input: {
    ownerId: string;
    source: SkillHubPackageSource;
    archive: Uint8Array;
  }): Promise<TExpert>;
}

export interface SkillHubInstallDependencies<TExpert = Record<string, unknown>> {
  database: Database;
  ownerId: string;
  maxUploadBytes: number;
  baseUrl: string;
  downloadHosts: readonly string[];
  credential: Pick<SkillHubCredential, "token">;
  fetchImpl?: FetchLike;
  signal?: AbortSignal;
  expertCatalog?: SkillHubExpertArchiveInstaller<TExpert>;
}

function coordinatePart(value: unknown, label: string): string {
  if (typeof value !== "string") {
    fail(400, "INVALID_SKILLHUB_INSTALL", `${label} is required`);
  }
  const normalized = value.trim();
  if (
    !COORDINATE_PART.test(normalized) ||
    normalized.endsWith(".") ||
    normalized.endsWith("-")
  ) {
    fail(400, "INVALID_SKILLHUB_INSTALL", `${label} is invalid`);
  }
  return normalized;
}

function installVersion(value: unknown): string {
  if (typeof value !== "string") {
    fail(400, "INVALID_SKILLHUB_INSTALL", "version is required");
  }
  const normalized = value.trim();
  if (
    !normalized || normalized.length > 128 || normalized.startsWith("-") ||
    normalized === "." || normalized === ".." ||
    /[\/\\\u0000-\u001f\u007f]/u.test(normalized)
  ) {
    fail(400, "INVALID_SKILLHUB_INSTALL", "version is invalid");
  }
  return normalized;
}

function installInput(input: SkillHubInstallInput): SkillHubPackageSource {
  return {
    namespace: coordinatePart(input?.namespace, "namespace"),
    slug: coordinatePart(input?.slug, "slug"),
    version: installVersion(input?.version),
  };
}

function registryBase(value: string): URL {
  try {
    const base = new URL(value.trim());
    if (
      (base.protocol !== "http:" && base.protocol !== "https:") ||
      base.username || base.password || base.search || base.hash
    ) {
      throw new Error("invalid registry URL");
    }
    if (!base.pathname.endsWith("/")) base.pathname += "/";
    return base;
  } catch {
    fail(503, "SKILLHUB_UNAVAILABLE", "SkillHub registry configuration is invalid");
  }
}

function downloadUrl(baseUrl: string, source: SkillHubPackageSource): URL {
  const path = [
    "api/v1/skills",
    encodeURIComponent(source.namespace),
    encodeURIComponent(source.slug),
    "versions",
    encodeURIComponent(source.version),
    "download",
  ].join("/");
  return new URL(path, registryBase(baseUrl));
}

function allowedDownloadHosts(values: readonly string[]): Set<string> {
  if (!Array.isArray(values) || values.length > 32) {
    fail(503, "SKILLHUB_UNAVAILABLE", "SkillHub download host configuration is invalid");
  }
  const hosts = new Set<string>();
  for (const value of values) {
    const host = typeof value === "string" ? value.trim().toLowerCase() : "";
    if (
      !host || host.length > 253 || host.startsWith(".") || host.endsWith(".") ||
      !/^[a-z0-9.-]+$/.test(host) || host.includes("..")
    ) {
      fail(503, "SKILLHUB_UNAVAILABLE", "SkillHub download host configuration is invalid");
    }
    hosts.add(host);
  }
  return hosts;
}

function redirectStatus(status: number): boolean {
  return status === 301 || status === 302 || status === 303 || status === 307 || status === 308;
}

function redirectTarget(
  response: Response,
  current: URL,
  registry: URL,
  canonicalPath: string,
  credentialed: boolean,
  downloadHosts: Set<string>,
): { url: URL; credentialed: boolean } {
  const location = response.headers.get("location");
  if (!location) fail(502, "SKILLHUB_REDIRECT_REJECTED", "SkillHub download redirect is invalid");
  let target: URL;
  try { target = new URL(location, current); }
  catch { fail(502, "SKILLHUB_REDIRECT_REJECTED", "SkillHub download redirect is invalid"); }
  if (target.username || target.password || target.hash) {
    fail(502, "SKILLHUB_REDIRECT_REJECTED", "SkillHub download redirect is not permitted");
  }
  if (target.origin === registry.origin) {
    if (!credentialed || target.pathname !== canonicalPath) {
      fail(502, "SKILLHUB_REDIRECT_REJECTED", "SkillHub registry redirect is not permitted");
    }
    return { url: target, credentialed: true };
  }
  if (
    target.protocol !== "https:" || (target.port && target.port !== "443") ||
    !downloadHosts.has(target.hostname.toLowerCase())
  ) {
    fail(502, "SKILLHUB_REDIRECT_REJECTED", "SkillHub download host is not permitted");
  }
  return { url: target, credentialed: false };
}

function archiveLimit(value: number): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    fail(503, "SKILLHUB_UNAVAILABLE", "SkillHub package limit is invalid");
  }
  return Math.min(value, SKILL_PACKAGE_LIMITS.maxArchiveBytes);
}

function bearerToken(value: string): string {
  const token = value.trim();
  if (!/^sk_[A-Za-z0-9_-]+$/.test(token) || token.length > 8192) {
    fail(401, "SKILLHUB_AUTH_FAILED", "SkillHub login has expired");
  }
  return token;
}

async function readBoundedArchive(response: Response, maximum: number): Promise<Uint8Array> {
  const declared = response.headers.get("content-length");
  if (declared && /^\d+$/.test(declared) && Number(declared) > maximum) {
    await response.body?.cancel().catch(() => undefined);
    fail(413, "SKILLHUB_PACKAGE_TOO_LARGE", "SkillHub package exceeds the upload limit");
  }
  const reader = response.body?.getReader();
  if (!reader) fail(502, "SKILLHUB_DOWNLOAD_FAILED", "SkillHub returned an empty package response");
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > maximum) {
        fail(413, "SKILLHUB_PACKAGE_TOO_LARGE", "SkillHub package exceeds the upload limit");
      }
      chunks.push(value.slice());
    }
  } catch (error) {
    if (error instanceof HttpError) throw error;
    fail(502, "SKILLHUB_DOWNLOAD_FAILED", "SkillHub package download was interrupted");
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
  if (length === 0) fail(502, "SKILLHUB_DOWNLOAD_FAILED", "SkillHub returned an empty package");
  const archive = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    archive.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return archive;
}

async function downloadPackage<TExpert>(
  dependencies: SkillHubInstallDependencies<TExpert>,
  source: SkillHubPackageSource,
): Promise<Uint8Array> {
  const fetcher = dependencies.fetchImpl ?? fetch;
  const timeout = AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS);
  const signal = dependencies.signal
    ? AbortSignal.any([dependencies.signal, timeout])
    : timeout;
  const registry = registryBase(dependencies.baseUrl);
  let url = downloadUrl(dependencies.baseUrl, source);
  const canonicalPath = url.pathname;
  const downloadHosts = allowedDownloadHosts(dependencies.downloadHosts);
  const token = bearerToken(dependencies.credential.token);
  let response: Response | undefined;
  let credentialed = true;
  for (let redirects = 0; ; redirects += 1) {
    const headers: Record<string, string> = {
      Accept: "application/zip, application/octet-stream",
      ...(credentialed ? { Authorization: `Bearer ${token}` } : {}),
    };
    try {
      response = await fetcher(url, {
        method: "GET",
        headers,
        redirect: "manual",
        signal,
      });
    } catch {
      if (dependencies.signal?.aborted) {
        fail(499, "REQUEST_ABORTED", "SkillHub installation was cancelled");
      }
      if (timeout.aborted) {
        fail(504, "SKILLHUB_TIMEOUT", "SkillHub package download timed out");
      }
      fail(502, "SKILLHUB_DOWNLOAD_FAILED", "SkillHub package download failed");
    }
    if (!redirectStatus(response.status)) break;
    if (redirects >= MAX_DOWNLOAD_REDIRECTS) {
      await response.body?.cancel().catch(() => undefined);
      fail(502, "SKILLHUB_REDIRECT_REJECTED", "SkillHub download redirected too many times");
    }
    let next: { url: URL; credentialed: boolean };
    try {
      next = redirectTarget(
        response,
        url,
        registry,
        canonicalPath,
        credentialed,
        downloadHosts,
      );
    } finally {
      await response.body?.cancel().catch(() => undefined);
    }
    url = next.url;
    credentialed = next.credentialed;
  }
  if ((response.status === 401 || response.status === 403) && credentialed) {
    await response.body?.cancel().catch(() => undefined);
    fail(401, "SKILLHUB_AUTH_FAILED", "SkillHub login has expired");
  }
  if (response.status === 404) {
    await response.body?.cancel().catch(() => undefined);
    fail(404, "SKILLHUB_PACKAGE_NOT_FOUND", "The requested SkillHub package is unavailable");
  }
  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined);
    fail(502, "SKILLHUB_DOWNLOAD_FAILED", "SkillHub package download failed");
  }
  return readBoundedArchive(response, archiveLimit(dependencies.maxUploadBytes));
}

function packageInput(source: SkillHubPackageSource, archive: Uint8Array) {
  return {
    filename: `${source.slug}.zip`,
    contentBase64: Buffer.from(archive).toString("base64"),
  };
}

async function currentSkill(
  dependencies: SkillHubInstallDependencies,
  name: string,
): Promise<SkillDto | undefined> {
  const service = createSkillService(dependencies);
  return (await service.list(dependencies.ownerId)).find((skill) => skill.name === name);
}

export async function installSkillHubSkill(
  dependencies: SkillHubInstallDependencies,
  input: SkillHubInstallInput,
): Promise<SkillDto> {
  const source = installInput(input);
  const archive = await downloadPackage(dependencies, source);
  let parsed;
  try {
    parsed = await parseSkillPackage(`${source.slug}.zip`, archive);
  } catch {
    fail(400, "INVALID_SKILLHUB_PACKAGE", "Downloaded SkillHub skill package is invalid");
  }

  const service = createSkillService(dependencies);
  let existing = await currentSkill(dependencies, parsed.name);
  if (!existing) {
    try {
      return await service.create(dependencies.ownerId, packageInput(source, archive));
    } catch (error) {
      if (!(error instanceof HttpError) || error.code !== "SKILL_ALREADY_EXISTS") throw error;
      existing = await currentSkill(dependencies, parsed.name);
      if (!existing) throw error;
    }
  }
  if (existing.version === parsed.version) return existing;

  try {
    return await service.addVersion(dependencies.ownerId, existing.id, {
      expectedVersion: existing.version,
      ...packageInput(source, archive),
    });
  } catch (error) {
    if (error instanceof HttpError && error.code === "VERSION_ALREADY_EXISTS") {
      return service.rollback(dependencies.ownerId, existing.id, {
        expectedVersion: existing.version,
        version: parsed.version,
      });
    }
    if (error instanceof HttpError && error.code === "VERSION_CONFLICT") {
      const latest = await currentSkill(dependencies, parsed.name);
      if (latest?.version === parsed.version) return latest;
    }
    throw error;
  }
}

export async function installSkillHubExpert<TExpert = Record<string, unknown>>(
  dependencies: SkillHubInstallDependencies<TExpert>,
  input: SkillHubInstallInput,
): Promise<TExpert> {
  if (!dependencies.expertCatalog) {
    fail(
      503,
      "EXPERT_PACKAGE_STORAGE_UNAVAILABLE",
      "Complete expert package storage is unavailable",
    );
  }
  const source = installInput(input);
  const archive = await downloadPackage(dependencies, source);
  return dependencies.expertCatalog.validateAndInstall({
    ownerId: dependencies.ownerId,
    source,
    archive,
  });
}
