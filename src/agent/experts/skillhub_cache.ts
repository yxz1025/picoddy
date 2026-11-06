import { readFile, realpath } from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";

import { platformPaths } from "../../platform/paths.ts";
import { readExpertPackageManifest } from "./installed_catalog.ts";
import type { ExpertManifest } from "./types.ts";
import type { ExpertRegistry } from "./registry.ts";

const ID_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export interface SkillHubExpertCacheEntry {
  namespace: string;
  slug: string;
  version: string;
  path: string;
}

export interface SkillHubExpertCacheDiagnostic {
  code: "CACHE_UNAVAILABLE" | "INVALID_CACHE_INDEX" | "INVALID_CACHE_PACKAGE";
  slug?: string;
  message: string;
}

export interface SkillHubExpertCacheScanResult {
  manifests: ExpertManifest[];
  entries: SkillHubExpertCacheEntry[];
  diagnostics: SkillHubExpertCacheDiagnostic[];
}

export function resolveSkillHubExpertCacheDir(
  appDataDir: string = platformPaths.appDataDir,
): string {
  return join(appDataDir, "skillhub-experts");
}

function inside(root: string, target: string): boolean {
  const offset = relative(resolve(root), resolve(target));
  return offset !== "" && !isAbsolute(offset) && offset !== ".." && !offset.startsWith(`..${sep}`);
}

function normalizeEntry(value: unknown): SkillHubExpertCacheEntry | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const entry = value as Record<string, unknown>;
  if (
    typeof entry.namespace !== "string" || !ID_RE.test(entry.namespace) ||
    typeof entry.slug !== "string" || !ID_RE.test(entry.slug) ||
    typeof entry.version !== "string" || !entry.version.trim() ||
    entry.path !== `packages/${entry.namespace}--${entry.slug}`
  ) return null;
  return {
    namespace: entry.namespace,
    slug: entry.slug,
    version: entry.version,
    path: entry.path,
  };
}

export async function scanSkillHubExpertCache(
  options: { cacheDir?: string } = {},
): Promise<SkillHubExpertCacheScanResult> {
  const cacheDir = resolve(options.cacheDir ?? resolveSkillHubExpertCacheDir());
  let raw: unknown;
  try {
    raw = JSON.parse(await readFile(join(cacheDir, "index.json"), "utf-8"));
  } catch (error) {
    const missing = (error as NodeJS.ErrnoException).code === "ENOENT";
    return {
      manifests: [],
      entries: [],
      diagnostics: missing ? [] : [{ code: "INVALID_CACHE_INDEX", message: "SkillHub expert cache index is invalid" }],
    };
  }
  const values = raw && typeof raw === "object" && !Array.isArray(raw)
    ? (raw as Record<string, unknown>).entries
    : null;
  if (!Array.isArray(values)) {
    return { manifests: [], entries: [], diagnostics: [{ code: "INVALID_CACHE_INDEX", message: "SkillHub expert cache index is invalid" }] };
  }
  const entries = values.map(normalizeEntry).filter((entry): entry is SkillHubExpertCacheEntry => entry !== null);
  if (entries.length !== values.length) {
    return { manifests: [], entries: [], diagnostics: [{ code: "INVALID_CACHE_INDEX", message: "SkillHub expert cache index is invalid" }] };
  }
  const manifests: ExpertManifest[] = [];
  const diagnostics: SkillHubExpertCacheDiagnostic[] = [];
  const packagesDir = join(cacheDir, "packages");
  for (const entry of entries) {
    try {
      const packageDir = resolve(cacheDir, entry.path);
      if (!inside(packagesDir, packageDir)) throw new Error("package escapes cache");
      const realPackages = await realpath(packagesDir);
      const realPackage = await realpath(packageDir);
      if (!inside(realPackages, realPackage)) throw new Error("package escapes cache");
      const manifest = await readExpertPackageManifest(realPackage, entry.slug, {
        catalogSource: "catalog",
        badge: "专家市场",
      });
      manifest.id = `${entry.namespace}--${entry.slug}`;
      manifests.push(manifest);
    } catch {
      diagnostics.push({
        code: "INVALID_CACHE_PACKAGE",
        slug: entry.slug,
        message: "SkillHub cached expert package is invalid",
      });
    }
  }
  return { manifests, entries, diagnostics };
}

export async function refreshSkillHubExpertCache(
  registry: Pick<ExpertRegistry, "replaceCachedCatalog">,
  options: { cacheDir?: string } = {},
): Promise<SkillHubExpertCacheScanResult> {
  const result = await scanSkillHubExpertCache(options);
  registry.replaceCachedCatalog(result.manifests);
  return result;
}

/** Resolve only a package admitted by the same cache validation used by the registry. */
export async function resolveSkillHubExpertPackage(
  expertId: string,
  options: { cacheDir?: string } = {},
): Promise<{ expertDir: string; manifest: ExpertManifest }> {
  const cacheDir = resolve(options.cacheDir ?? resolveSkillHubExpertCacheDir());
  const scan = await scanSkillHubExpertCache({ cacheDir });
  const manifest = scan.manifests.find(item => item.id === expertId);
  const entry = scan.entries.find(item => `${item.namespace}--${item.slug}` === expertId);
  if (!manifest || !entry) throw new Error('市场专家尚未安装或本地包无效，请重新召唤');
  const expertDir = await realpath(resolve(cacheDir, entry.path));
  const packagesDir = await realpath(join(cacheDir, 'packages'));
  if (!inside(packagesDir, expertDir)) throw new Error('市场专家包路径无效');
  return { expertDir, manifest };
}
