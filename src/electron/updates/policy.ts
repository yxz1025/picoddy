import { createHash } from "node:crypto";
import { parse } from "yaml";
import semver from "semver";
import type { UpdateConfig, Release } from "./types.ts";

export function trustedUrl(input: string, base?: string): URL {
  const url = new URL(input, base);
  if (url.protocol !== "https:" || url.username || url.password || url.hash) throw new Error("MANIFEST_INVALID");
  if (base && url.origin !== new URL(base).origin) throw new Error("MANIFEST_INVALID");
  return url;
}
export function validateConfig(value: unknown, platform: string, arch: string): UpdateConfig {
  const c = value as UpdateConfig;
  if (!c || c.schemaVersion !== 1 || c.unsigned !== true || c.platform !== platform || c.arch !== arch ||
      !["user", "machine"].includes(c.scope) || !["stable", "beta", "manual-managed"].includes(c.channel)) throw new Error("ARCH_MISMATCH");
  trustedUrl(c.feedUrl);
  if (!c.feedUrl.endsWith("/")) throw new Error("MANIFEST_INVALID");
  if (c.eventsUrl) trustedUrl(c.eventsUrl);
  return c;
}
export function rolloutEligible(id: string, percentage: number): boolean {
  return createHash("sha256").update(id).digest().readUInt32BE(0) / 0x100000000 * 100 < percentage;
}
export function parseRelease(source: string, config: UpdateConfig, current: string, id: string): Release | null {
  if (Buffer.byteLength(source) > 1024 * 1024) throw new Error("MANIFEST_INVALID");
  const info = parse(source, { maxAliasCount: 0 });
  if (!info || !semver.valid(info.version) || !Array.isArray(info.files)) throw new Error("MANIFEST_INVALID");
  if (info.platform !== config.platform || info.arch !== config.arch || info.scope !== config.scope) throw new Error("ARCH_MISMATCH");
  if (info.channel !== config.channel) throw new Error("MANIFEST_INVALID");
  if (!semver.gt(info.version, current) || (config.channel === "stable" && semver.prerelease(info.version))) return null;
  const percentage = info.stagingPercentage ?? 100;
  if (!Number.isFinite(percentage) || percentage < 0 || percentage > 100) throw new Error("MANIFEST_INVALID");
  if (info.revoked === true || !rolloutEligible(id, percentage)) return null;
  const extension = config.platform === "win32" ? ".exe" : ".dmg";
  const file = info.files.find((item: any) => typeof item?.url === "string" && new URL(item.url, config.feedUrl).pathname.endsWith(extension));
  if (!file || typeof file.sha512 !== "string" || !/^[A-Za-z0-9+/]{86}==$/.test(file.sha512) ||
      !Number.isSafeInteger(file.size) || file.size <= 0 || !Number.isSafeInteger(info.unpackedSize) || info.unpackedSize <= 0 ||
      typeof info.releaseId !== "string" || !/^[A-Za-z0-9._-]{1,160}$/.test(info.releaseId)) throw new Error("MANIFEST_INVALID");
  return { version: info.version, releaseId: info.releaseId, url: trustedUrl(file.url, config.feedUrl).href,
    sha512: file.sha512, size: file.size, unpackedSize: info.unpackedSize, stagingPercentage: percentage,
    notes: typeof info.releaseNotes === "string" ? info.releaseNotes.slice(0, 20000) : "",
    ...(info.releaseNotesUrl ? { notesUrl: trustedUrl(info.releaseNotesUrl, config.feedUrl).href } : {}) };
}
export function sameRelease(a: Release, b: Release | null): boolean {
  return !!b && a.releaseId === b.releaseId && a.version === b.version && a.sha512 === b.sha512 && a.url === b.url && a.size === b.size;
}
