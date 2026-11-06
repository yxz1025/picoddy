import { access, mkdir, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import { getExpertSummary, refreshSkillHubExperts, type Expert } from "../../../agent/experts.ts";
import {
  resolveSkillHubExpertCacheDir,
  scanSkillHubExpertCache,
  type SkillHubExpertCacheEntry,
} from "../../../agent/experts/skillhub_cache.ts";
import { readExpertPackageManifest } from "../../../agent/experts/installed_catalog.ts";
import {
  installSkillHubSkillWithCli,
  type SkillHubCliInstallInput,
  type SkillHubCliInstallOptions,
} from "./installer.ts";

type InstallPackage = (input: SkillHubCliInstallInput, options: SkillHubCliInstallOptions) => Promise<void>;

export interface SkillHubExpertInstallOptions extends SkillHubCliInstallOptions {
  cacheDir?: string;
  installPackage?: InstallPackage;
  refresh?: () => Promise<unknown>;
  getSummary?: (id: string) => Expert | undefined;
}

interface CacheIndex { entries: SkillHubExpertCacheEntry[] }
const ID_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

async function exists(path: string): Promise<boolean> {
  try { await access(path); return true; } catch { return false; }
}

async function readIndex(path: string): Promise<{ text: string | null; value: CacheIndex }> {
  try {
    const text = await readFile(path, "utf-8");
    const parsed = JSON.parse(text) as Record<string, unknown>;
    if (!Array.isArray(parsed.entries)) throw new Error();
    const entries = parsed.entries.map((value) => {
      if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error();
      const entry = value as Record<string, unknown>;
      if (
        typeof entry.namespace !== "string" || !ID_RE.test(entry.namespace) ||
        typeof entry.slug !== "string" || !ID_RE.test(entry.slug) ||
        typeof entry.version !== "string" || !entry.version.trim() ||
        entry.path !== `packages/${entry.namespace}--${entry.slug}`
      ) throw new Error();
      return {
        namespace: entry.namespace,
        slug: entry.slug,
        version: entry.version,
        path: entry.path,
      } satisfies SkillHubExpertCacheEntry;
    });
    return { text, value: { entries } };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw new Error("SkillHub expert cache index无效");
    }
    return { text: null, value: { entries: [] } };
  }
}

async function writeAtomically(path: string, text: string): Promise<void> {
  const nonce = `${process.pid}.${Date.now()}`;
  const temporary = `${path}.${nonce}.tmp`;
  const backup = `${path}.${nonce}.bak`;
  let backedUp = false;
  await writeFile(temporary, text, "utf-8");
  try {
    if (await exists(path)) {
      await rename(path, backup);
      backedUp = true;
    }
    await rename(temporary, path);
    if (backedUp) await rm(backup, { force: true });
  } catch (error) {
    await rm(temporary, { force: true }).catch(() => undefined);
    if (backedUp) {
      await rm(path, { force: true }).catch(() => undefined);
      await rename(backup, path).catch(() => undefined);
    }
    throw error;
  }
}

async function normalizeAndValidate(packageDir: string, slug: string): Promise<void> {
  const manifestPath = join(packageDir, ".picoddy-plugin", "plugin.json");
  let plugin: Record<string, unknown>;
  try {
    const parsed = JSON.parse(await readFile(manifestPath, "utf-8")) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error();
    plugin = parsed as Record<string, unknown>;
  } catch {
    throw new Error("下载的专家包清单无效");
  }
  if (plugin.name !== slug || plugin.expertType !== "agent") {
    throw new Error("下载的专家包不是有效的 Agent 专家");
  }
  plugin.schemaVersion = 2;
  await writeAtomically(manifestPath, `${JSON.stringify(plugin, null, 2)}\n`);
  await readExpertPackageManifest(packageDir, slug, { catalogSource: "catalog", badge: "专家市场" });
}

export async function installSkillHubExpert(
  input: SkillHubCliInstallInput,
  options: SkillHubExpertInstallOptions = {},
): Promise<Expert> {
  const namespace = input.namespace.trim();
  const slug = input.slug.trim();
  const version = input.version.trim();
  if (!ID_RE.test(namespace) || !ID_RE.test(slug) || !version) {
    throw new Error("SkillHub 专家安装参数无效");
  }
  const runtimeId = `${namespace}--${slug}`;
  const cacheDir = resolve(options.cacheDir ?? resolveSkillHubExpertCacheDir());
  const packagesDir = join(cacheDir, "packages");
  const indexPath = join(cacheDir, "index.json");
  const cacheKey = `${namespace}--${slug}`;
  const targetDir = join(packagesDir, cacheKey);
  await mkdir(packagesDir, { recursive: true });

  const snapshot = await readIndex(indexPath);
  const cachedEntry = snapshot.value.entries.find((entry) =>
    entry.namespace === namespace && entry.slug === slug && entry.version === version
  );
  if (cachedEntry) {
    const scan = await scanSkillHubExpertCache({ cacheDir });
    if (scan.manifests.some((manifest) => manifest.id === runtimeId)) {
      await (options.refresh ?? refreshSkillHubExperts)();
      const cached = (options.getSummary ?? getExpertSummary)(runtimeId);
      if (cached) return cached;
    }
  }

  const stagingDir = await mkdtemp(join(cacheDir, ".install-"));
  const backupDir = join(cacheDir, `.backup-${slug}-${Date.now()}`);
  const installPackage = options.installPackage ?? installSkillHubSkillWithCli;
  let backedUp = false;
  let moved = false;
  let indexChanged = false;
  try {
    await installPackage(input, { ...options, skillsDir: stagingDir });
    const downloadedDir = join(stagingDir, slug);
    await normalizeAndValidate(downloadedDir, slug);
    if (await exists(targetDir)) {
      await rename(targetDir, backupDir);
      backedUp = true;
    }
    await rename(downloadedDir, targetDir);
    moved = true;

    const entry: SkillHubExpertCacheEntry = { namespace, slug, version, path: `packages/${cacheKey}` };
    const next: CacheIndex = {
      entries: [
        ...snapshot.value.entries.filter((item) => !(item.namespace === namespace && item.slug === slug)),
        entry,
      ],
    };
    await writeAtomically(indexPath, `${JSON.stringify(next, null, 2)}\n`);
    indexChanged = true;
    await (options.refresh ?? refreshSkillHubExperts)();
    const installed = (options.getSummary ?? getExpertSummary)(runtimeId);
    if (!installed?.available) throw new Error("专家缓存完成，但运行时加载失败");
    if (backedUp) await rm(backupDir, { recursive: true, force: true });
    return installed;
  } catch (error) {
    if (indexChanged) {
      if (snapshot.text === null) await rm(indexPath, { force: true }).catch(() => undefined);
      else await writeAtomically(indexPath, snapshot.text).catch(() => undefined);
    }
    if (moved) await rm(targetDir, { recursive: true, force: true }).catch(() => undefined);
    if (backedUp) await rename(backupDir, targetDir).catch(() => undefined);
    await (options.refresh ?? refreshSkillHubExperts)().catch(() => undefined);
    throw error;
  } finally {
    await rm(stagingDir, { recursive: true, force: true }).catch(() => undefined);
  }
}
