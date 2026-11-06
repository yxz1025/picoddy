import { createHash } from "node:crypto";
import { lstat, readFile, realpath } from "node:fs/promises";
import { extname, isAbsolute, join, relative, resolve, sep } from "node:path";

import { platformPaths } from "../../platform/paths.ts";
import { loadInstalledExpertSkills } from "./installed_skill.ts";
import type { ExpertManifest, ExpertSummary } from "./types.ts";
import type { ExpertRegistry } from "./registry.ts";

export type InstalledExpertDiagnosticCode =
  | "MARKETPLACE_UNAVAILABLE"
  | "INVALID_MARKETPLACE"
  | "SOURCE_OUTSIDE_PLUGINS"
  | "EXPERT_SCHEMA_VERSION_UNSUPPORTED"
  | "INVALID_PLUGIN";

export interface InstalledExpertDiagnostic {
  code: InstalledExpertDiagnosticCode;
  source?: string;
  message: string;
}

export interface InstalledExpertScanResult {
  manifests: ExpertManifest[];
  summaries: ExpertSummary[];
  diagnostics: InstalledExpertDiagnostic[];
}

export interface InstalledExpertScanOptions {
  marketplaceDir?: string;
}

export type InstalledExpertPackageErrorCode =
  | "INVALID_EXPERT_ID"
  | "MARKETPLACE_UNAVAILABLE"
  | "INVALID_MARKETPLACE"
  | "EXPERT_NOT_REGISTERED"
  | "SOURCE_OUTSIDE_PLUGINS"
  | "EXPERT_NOT_DIRECTORY"
  | "EXPERT_SYMLINK"
  | "EXPERT_PATH_ESCAPE"
  | "PLUGIN_MANIFEST_INVALID"
  | "PLUGIN_NAME_MISMATCH"
  | "EXPERT_SCHEMA_VERSION_UNSUPPORTED"
  | "NOT_AGENT_PACKAGE";

/** Stable, path-free errors used by installed expert management callers. */
export class InstalledExpertPackageError extends Error {
  readonly code: InstalledExpertPackageErrorCode;

  constructor(code: InstalledExpertPackageErrorCode, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "InstalledExpertPackageError";
    this.code = code;
  }
}

export interface ResolvedInstalledExpertPackage {
  id: string;
  marketplaceDir: string;
  marketplacePath: string;
  pluginsDir: string;
  expertDir: string;
  registration: Record<string, unknown>;
  /** Scanner-compatible content revision, when the package is a valid Agent. */
  revision?: string;
}

export interface InstalledExpertRefreshResult extends InstalledExpertScanResult {
  refreshed: boolean;
}

type Localized = { zh?: unknown; en?: unknown };

export function resolveInstalledExpertMarketplaceDir(
  appDataDir: string = platformPaths.appDataDir,
): string {
  return join(appDataDir, "plugins", "marketplaces", "my-experts");
}

function localized(value: unknown, fallback = ""): string {
  if (!value || typeof value !== "object" || Array.isArray(value)) return fallback;
  const record = value as Localized;
  if (typeof record.zh === "string" && record.zh.trim()) return record.zh.trim();
  if (typeof record.en === "string" && record.en.trim()) return record.en.trim();
  return fallback;
}

function localizedList(value: unknown, field: string): string[] {
  if (value == null) return [];
  if (!Array.isArray(value)) throw new Error(`${field} must be an array`);
  return value.map((entry, index) => {
    const text = localized(entry);
    if (!text) throw new Error(`${field}[${index}] must contain non-empty localized text`);
    return text;
  });
}

function summaryOf(manifest: ExpertManifest): ExpertSummary {
  const { prompt: _prompt, guidelines: _guidelines, capabilityHints: _hints,
    installedSkills: _installedSkills, outputPolicy: _outputPolicy, riskNotes: _riskNotes, ...summary } = manifest;
  return {
    ...summary,
    tags: [...summary.tags],
    quickPrompts: [...summary.quickPrompts],
  };
}

function inside(root: string, target: string): boolean {
  const offset = relative(resolve(root), resolve(target));
  return offset !== "" && !isAbsolute(offset) && offset !== ".." &&
    !offset.startsWith(`..${sep}`);
}

function isExpertId(value: string): boolean {
  return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value);
}

async function loadMarketplace(marketplacePath: string): Promise<Record<string, unknown>> {
  let value: unknown;
  try {
    value = JSON.parse(await readFile(marketplacePath, "utf-8"));
  } catch (cause) {
    const code = (cause as { code?: string }).code === "ENOENT"
      ? "MARKETPLACE_UNAVAILABLE"
      : "INVALID_MARKETPLACE";
    throw new InstalledExpertPackageError(
      code,
      code === "MARKETPLACE_UNAVAILABLE"
        ? "my-experts marketplace is unavailable"
        : "my-experts marketplace is invalid",
      { cause },
    );
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new InstalledExpertPackageError("INVALID_MARKETPLACE", "my-experts marketplace is invalid");
  }
  const marketplace = value as Record<string, unknown>;
  if (!Array.isArray(marketplace.plugins) || marketplace.plugins.some(
    (entry) => !entry || typeof entry !== "object" || Array.isArray(entry),
  )) {
    throw new InstalledExpertPackageError("INVALID_MARKETPLACE", "my-experts marketplace is invalid");
  }
  return marketplace;
}

async function resolveRegisteredPackage(
  expertId: string,
  marketplaceDir: string,
  marketplacePath: string,
  pluginsDir: string,
  marketplace: Record<string, unknown>,
): Promise<ResolvedInstalledExpertPackage> {
  const registrations = (marketplace.plugins as unknown[]).filter((entry) => {
    const item = entry as Record<string, unknown>;
    return item.name === expertId;
  });
  if (registrations.length === 0) {
    throw new InstalledExpertPackageError("EXPERT_NOT_REGISTERED", "installed expert is not registered");
  }
  if (registrations.length !== 1) {
    throw new InstalledExpertPackageError("INVALID_MARKETPLACE", "my-experts marketplace contains duplicate expert registrations");
  }
  const registration = registrations[0];
  if (!registration || typeof registration !== "object" || Array.isArray(registration)) {
    throw new InstalledExpertPackageError("INVALID_MARKETPLACE", "my-experts marketplace registration is invalid");
  }
  const entry = registration as Record<string, unknown>;
  const source = typeof entry.source === "string" ? entry.source : "";
  if (source !== `./plugins/${expertId}`) {
    throw new InstalledExpertPackageError(
      "SOURCE_OUTSIDE_PLUGINS",
      "installed expert source is outside the managed plugins directory",
    );
  }
  const expertDir = resolve(marketplaceDir, source);
  if (!inside(pluginsDir, expertDir)) {
    throw new InstalledExpertPackageError(
      "SOURCE_OUTSIDE_PLUGINS",
      "installed expert source is outside the managed plugins directory",
    );
  }
  let rootInfo;
  try {
    rootInfo = await lstat(expertDir);
  } catch (cause) {
    throw new InstalledExpertPackageError("EXPERT_NOT_DIRECTORY", "installed expert package is unavailable", { cause });
  }
  if (rootInfo.isSymbolicLink()) {
    throw new InstalledExpertPackageError("EXPERT_SYMLINK", "installed expert package cannot be a symbolic link");
  }
  if (!rootInfo.isDirectory()) {
    throw new InstalledExpertPackageError("EXPERT_NOT_DIRECTORY", "installed expert package is not a directory");
  }
  let realPlugins: string;
  let realExpert: string;
  try {
    realPlugins = await realpath(pluginsDir);
    realExpert = await realpath(expertDir);
  } catch (cause) {
    throw new InstalledExpertPackageError("EXPERT_PATH_ESCAPE", "installed expert package path is unavailable", { cause });
  }
  if (!inside(realPlugins, realExpert)) {
    throw new InstalledExpertPackageError("EXPERT_PATH_ESCAPE", "installed expert package escapes the managed directory");
  }

  const pluginPath = join(realExpert, ".picoddy-plugin", "plugin.json");
  let plugin: unknown;
  try {
    const pluginInfo = await lstat(pluginPath);
    if (pluginInfo.isSymbolicLink() || !pluginInfo.isFile()) {
      throw new Error("plugin manifest is not a regular file");
    }
    plugin = JSON.parse(await readFile(pluginPath, "utf-8"));
  } catch (cause) {
    throw new InstalledExpertPackageError("PLUGIN_MANIFEST_INVALID", "installed expert package manifest is invalid", { cause });
  }
  if (!plugin || typeof plugin !== "object" || Array.isArray(plugin)) {
    throw new InstalledExpertPackageError("PLUGIN_MANIFEST_INVALID", "installed expert package manifest is invalid");
  }
  const pluginRecord = plugin as Record<string, unknown>;
  if (pluginRecord.schemaVersion !== 2) {
    throw new InstalledExpertPackageError(
      "EXPERT_SCHEMA_VERSION_UNSUPPORTED",
      "installed expert schema version is unsupported; reinstall or recreate the expert",
    );
  }
  if (pluginRecord.name !== expertId) {
    throw new InstalledExpertPackageError("PLUGIN_NAME_MISMATCH", "installed expert package name does not match its registration");
  }
  if (pluginRecord.expertType !== "agent") {
    throw new InstalledExpertPackageError("NOT_AGENT_PACKAGE", "registered package is not an Agent expert");
  }
  let revision: string | undefined;
  try {
    revision = (await readExpertPackageManifest(realExpert, expertId)).revision;
  } catch (cause) {
    throw new InstalledExpertPackageError("PLUGIN_MANIFEST_INVALID", "installed expert package is invalid", { cause });
  }
  return {
    id: expertId,
    marketplaceDir,
    marketplacePath,
    pluginsDir,
    expertDir: realExpert,
    registration: entry,
    revision,
  };
}

/** Resolve one registered Agent package through the managed marketplace only. */
export async function resolveInstalledExpertPackage(
  expertId: string,
  options: InstalledExpertScanOptions = {},
): Promise<ResolvedInstalledExpertPackage> {
  const id = expertId.trim();
  if (!isExpertId(id)) {
    throw new InstalledExpertPackageError("INVALID_EXPERT_ID", "expert id is invalid");
  }
  const marketplaceDir = resolve(options.marketplaceDir ?? resolveInstalledExpertMarketplaceDir());
  const marketplacePath = join(marketplaceDir, ".picoddy-plugin", "marketplace.json");
  const pluginsDir = join(marketplaceDir, "plugins");
  const marketplace = await loadMarketplace(marketplacePath);
  return await resolveRegisteredPackage(id, marketplaceDir, marketplacePath, pluginsDir, marketplace);
}

async function avatarDataUrl(expertDir: string, avatar: unknown): Promise<string> {
  if (typeof avatar !== "string" || !avatar.trim()) return "";
  const target = resolve(expertDir, avatar);
  if (!inside(expertDir, target)) return "";
  try {
    const info = await lstat(target);
    if (!info.isFile() || info.isSymbolicLink() || info.size > 512 * 1024) return "";
    const extension = extname(target).toLowerCase();
    const mime = extension === ".png" ? "image/png"
      : extension === ".jpg" || extension === ".jpeg" ? "image/jpeg"
      : extension === ".webp" ? "image/webp"
      : "";
    if (!mime) return "";
    return `data:${mime};base64,${(await readFile(target)).toString("base64")}`;
  } catch {
    return "";
  }
}

export async function readExpertPackageManifest(
  expertDir: string,
  registeredName: string,
  options: { catalogSource?: "builtin" | "installed" | "catalog"; badge?: string } = {},
): Promise<ExpertManifest> {
  const pluginPath = join(expertDir, ".picoddy-plugin", "plugin.json");
  const pluginInfo = await lstat(pluginPath);
  if (!pluginInfo.isFile() || pluginInfo.isSymbolicLink()) {
    throw new Error("plugin.json must be a regular file");
  }
  const pluginText = await readFile(pluginPath, "utf-8");
  const plugin = JSON.parse(pluginText) as Record<string, unknown>;
  if (plugin.schemaVersion !== 2) {
    throw new InstalledExpertPackageError(
      "EXPERT_SCHEMA_VERSION_UNSUPPORTED",
      "installed expert schema version is unsupported; reinstall or recreate the expert",
    );
  }
  const id = typeof plugin.name === "string" ? plugin.name.trim() : "";
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id) || id !== registeredName) {
    throw new Error("registered name does not match a valid plugin name");
  }
  if (plugin.expertType !== "agent") {
    throw new Error("expertType must be agent");
  }
  const agentName = typeof plugin.agentName === "string" ? plugin.agentName.trim() : "";
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(agentName)) {
    throw new Error("agentName is invalid");
  }
  const agents = Array.isArray(plugin.agents) ? plugin.agents : [];
  const declaredAgent = `./agents/${agentName}.md`;
  if (!agents.includes(declaredAgent)) throw new Error("primary agent is not declared");
  const agentPath = resolve(expertDir, declaredAgent);
  if (!inside(join(expertDir, "agents"), agentPath)) {
    throw new Error("primary agent path is outside agents directory");
  }
  const agentInfo = await lstat(agentPath);
  if (!agentInfo.isFile() || agentInfo.isSymbolicLink()) {
    throw new Error("primary agent must be a regular file");
  }
  const prompt = await readFile(agentPath, "utf-8");
  if (!prompt.trim() || prompt.includes("[TODO")) throw new Error("primary agent is incomplete");
  const installedSkills = await loadInstalledExpertSkills(
    expertDir,
    plugin.skills as readonly unknown[] | undefined,
  );
  const tags = localizedList(plugin.tags, "tags");
  const quickPrompts = localizedList(plugin.quickPrompts, "quickPrompts");
  if (plugin.defaultInitPrompt != null && !localized(plugin.defaultInitPrompt)) {
    throw new Error("defaultInitPrompt must contain non-empty localized text");
  }
  const name = localized(plugin.profession, localized(plugin.displayName, id));
  const nickname = localized(plugin.displayName);
  const description = localized(plugin.displayDescription);
  if (!name || !description) throw new Error("display metadata is incomplete");
  const revision = createHash("sha256")
    .update(pluginText)
    .update("\0")
    .update(prompt)
    .update("\0")
    .update(JSON.stringify(installedSkills.map((skill) => ({
      name: skill.name,
      revision: skill.revision,
    }))))
    .digest("hex")
    .slice(0, 16);
  return {
    id,
    name,
    expertType: "agent",
    ...(nickname && nickname !== name ? { nickname } : {}),
    categoryId: typeof plugin.categoryId === "string" ? plugin.categoryId : "12-IndustryConsultant",
    description,
    icon: await avatarDataUrl(expertDir, plugin.avatar),
    tags,
    quickPrompts,
    badge: options.badge ?? "我的专家",
    catalogSource: options.catalogSource ?? "installed",
    revision,
    available: true,
    prompt: { inline: prompt, maxBytes: 128 * 1024 },
    ...(installedSkills.length > 0 ? { installedSkills } : {}),
    guidelines: [],
    capabilityHints: {
      preferredTools: [],
      bundledSkills: installedSkills.map((skill) => skill.name),
    },
  };
}

export async function scanInstalledExperts(
  options: InstalledExpertScanOptions = {},
): Promise<InstalledExpertScanResult> {
  const marketplaceDir = resolve(
    options.marketplaceDir ?? resolveInstalledExpertMarketplaceDir(),
  );
  const pluginsDir = join(marketplaceDir, "plugins");
  const diagnostics: InstalledExpertDiagnostic[] = [];
  let marketplace: Record<string, unknown>;
  try {
    marketplace = JSON.parse(
      await readFile(join(marketplaceDir, ".picoddy-plugin", "marketplace.json"), "utf-8"),
    ) as Record<string, unknown>;
  } catch (error) {
    const code = (error as { code?: string }).code === "ENOENT"
      ? "MARKETPLACE_UNAVAILABLE"
      : "INVALID_MARKETPLACE";
    return {
      manifests: [],
      summaries: [],
      diagnostics: [{ code, message: "my-experts marketplace is unavailable or invalid" }],
    };
  }
  const registrations = Array.isArray(marketplace.plugins) ? marketplace.plugins : [];
  const manifests: ExpertManifest[] = [];
  for (const registration of registrations) {
    if (!registration || typeof registration !== "object" || Array.isArray(registration)) {
      diagnostics.push({ code: "INVALID_PLUGIN", message: "registration must be an object" });
      continue;
    }
    const entry = registration as Record<string, unknown>;
    const source = typeof entry.source === "string" ? entry.source : "";
    const name = typeof entry.name === "string" ? entry.name.trim() : "";
    try {
      const resolvedPackage = await resolveRegisteredPackage(
        name,
        marketplaceDir,
        join(marketplaceDir, ".picoddy-plugin", "marketplace.json"),
        pluginsDir,
        marketplace,
      );
      manifests.push(await readExpertPackageManifest(resolvedPackage.expertDir, name));
    } catch (error) {
      const packageError = error instanceof InstalledExpertPackageError ? error : undefined;
      diagnostics.push({
        code: packageError?.code === "SOURCE_OUTSIDE_PLUGINS" || packageError?.code === "EXPERT_PATH_ESCAPE"
          ? "SOURCE_OUTSIDE_PLUGINS"
          : packageError?.code === "EXPERT_SCHEMA_VERSION_UNSUPPORTED"
          ? "EXPERT_SCHEMA_VERSION_UNSUPPORTED"
          : "INVALID_PLUGIN",
        ...(packageError?.code === "EXPERT_SCHEMA_VERSION_UNSUPPORTED" ? {} : { source }),
        message: packageError?.message ?? (error instanceof Error ? error.message : "invalid expert package"),
      });
    }
  }
  manifests.sort((left, right) => left.id.localeCompare(right.id));
  return { manifests, summaries: manifests.map(summaryOf), diagnostics };
}

export async function refreshInstalledExpertRegistry(
  registry: Pick<ExpertRegistry, "list" | "replaceInstalled">,
  scan: () => Promise<InstalledExpertScanResult> = () => scanInstalledExperts(),
): Promise<InstalledExpertRefreshResult> {
  const result = await scan();
  const unavailable = result.manifests.length === 0 && result.diagnostics.some(
    (diagnostic) =>
      diagnostic.code === "MARKETPLACE_UNAVAILABLE" ||
      diagnostic.code === "INVALID_MARKETPLACE",
  );
  if (!unavailable) registry.replaceInstalled(result.manifests);
  return {
    ...result,
    refreshed: !unavailable,
    summaries: registry.list("installed"),
  };
}
