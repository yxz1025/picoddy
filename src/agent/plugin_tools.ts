import { existsSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import { isAbsolute, join, relative, sep } from "node:path";

import type { AgentTool } from "@earendil-works/pi-agent-core";
import { createEventBus, discoverAndLoadExtensions, type VirtualModelDefinition } from "@earendil-works/pi-coding-agent";

import { platformPaths } from "../platform/paths.ts";
import { registerReadOnlyToolNames } from "./permissions.ts";
import {
  registerPluginToolNames,
  unregisterPluginToolNames,
} from "./prompt-runtime/capability-catalog.ts";
import { PLUGIN_CATALOG } from "../platform/extensions/plugin-catalog.ts";

/** 插件根：每个已安装插件一个子目录（npm 包 + 自身 node_modules）。 */
export const PLUGINS_ROOT = join(platformPaths.appDataDir, "plugins");
/** 扩展目录（agentDir 约定）：用户手动放置的扩展源码也会被自动发现。 */
export const EXTENSIONS_DIR = join(platformPaths.appDataDir, "extensions");

/** npm 合法包名（含 scoped），防命令注入；args 数组传参不拼 shell。 */
const PKG_NAME_PATTERN =
  /^(@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z0-9-~][a-z0-9-._~]*$/;

export function validatePkgName(pkgName: string): string {
  const name = pkgName.replace(/^npm:/, "").trim();
  if (!PKG_NAME_PATTERN.test(name)) {
    throw new Error(`非法包名："${pkgName}"`);
  }
  return name;
}

export interface PluginEntry {
  /** 插件目录名（无 scope 时为包名，scoped 为 "@scope/name"） */
  id: string;
  name: string;
  version?: string;
  description?: string;
  /** 包内容目录（含 package.json "pi.extensions" 字段） */
  pkgDir: string;
}

function tryReadJson(filePath: string): Record<string, any> | null {
  try {
    return JSON.parse(readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}

/**
 * npm install --prefix <pluginDir> <pkg> 的产物是
 * <pluginDir>/node_modules/<pkg>/（依赖平铺于同一 node_modules）。
 * 从 <pluginDir>/package.json 的 dependencies 取首个包名定位包目录。
 */
export function resolvePluginPkgDir(pluginDir: string): string | null {
  const meta = tryReadJson(join(pluginDir, "package.json"));
  if (!meta) return null;
  const pkgNames = Object.keys(meta.dependencies ?? {});
  if (pkgNames.length === 0) return null;
  const pkgDir = join(pluginDir, "node_modules", ...pkgNames[0].split("/"));
  return existsSync(pkgDir) ? pkgDir : null;
}

/** 枚举插件根下每个已安装插件的目录（支持 scoped 包的嵌套 @scope/name 布局）。 */
export function listPluginDirs(root: string = PLUGINS_ROOT): string[] {
  if (!existsSync(root)) return [];
  const dirs: string[] = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name === "node_modules") continue;
    const dir = join(root, entry.name);
    if (entry.name.startsWith("@")) {
      for (const sub of readdirSync(dir, { withFileTypes: true })) {
        if (sub.isDirectory()) dirs.push(join(dir, sub.name));
      }
    } else {
      dirs.push(dir);
    }
  }
  return dirs;
}

export function listPluginEntries(root: string = PLUGINS_ROOT): PluginEntry[] {
  const entries: PluginEntry[] = [];
  for (const dir of listPluginDirs(root)) {
    const pkgDir = resolvePluginPkgDir(dir);
    if (!pkgDir) continue;
    const meta = tryReadJson(join(pkgDir, "package.json"));
    const id = dir.slice(root.length + 1).replaceAll("\\", "/");
    entries.push({
      id,
      name: meta?.name ?? id,
      version: meta?.version,
      description: meta?.description,
      pkgDir,
    });
  }
  return entries;
}

/** 插件同名工具覆盖内置工具。 */
export function mergePluginTools(
  builtin: AgentTool<any>[],
  plugin: AgentTool<any>[],
): AgentTool<any>[] {
  const pluginNames = new Set(plugin.map((tool) => tool.name));
  return [
    ...builtin.filter((tool) => !pluginNames.has(tool.name)),
    ...plugin,
  ];
}

/** 已加载插件工具缓存（pluginId → 工具列表），tools 装配每 prompt 读取。 */
const loadedPlugins = new Map<string, AgentTool[]>();
const modelPluginIds = new Set<string>();
const virtualModels = new Map<string, { pluginId: string; definition: VirtualModelDefinition }>();
export function getPluginVirtualModels(): VirtualModelDefinition[] { return [...virtualModels.values()].map(entry => entry.definition); }

export function getPluginTools(): AgentTool[] {
  return Array.from(loadedPlugins.values()).flat();
}

export function isPluginLoaded(id: string): boolean {
  return loadedPlugins.has(id);
}

export function unloadPlugin(id: string): void {
  const tools = loadedPlugins.get(id);
  loadedPlugins.delete(id);
  modelPluginIds.delete(id);
  for (const [key, entry] of virtualModels) if (entry.pluginId === id) virtualModels.delete(key);
  if (tools) {
    unregisterPluginToolNames(tools.map((t) => t.name));
  }
}

/** 包声明的只读工具（"pi.readOnlyTools" 约定），缺失时用精选目录兜底。 */
function readOnlyToolsOf(entry: PluginEntry): string[] {
  const meta = tryReadJson(join(entry.pkgDir, "package.json"));
  const declared = meta?.pi?.readOnlyTools;
  if (Array.isArray(declared) && declared.length > 0) return declared;
  const catalogItem = PLUGIN_CATALOG.find((item) => item.pkg === entry.name);
  return catalogItem?.readOnlyTools ?? [];
}

/** The global catalog supplies policy metadata only. Each session loads its own
 * extensions, so Pi binds settings, model registry, history and lifecycle to the
 * real AgentSession instead of sharing fake/no-op contexts between conversations.
 */
export function getPluginSessionResources(toolNames: readonly string[]): { paths: string[]; toolNames: Set<string> } {
  const selected = new Set(toolNames);
  const entries = listPluginEntries();
  const paths: string[] = [];
  const names = new Set<string>();
  for (const [id, tools] of loadedPlugins) {
    const active = tools.filter(tool => selected.has(tool.name));
    const entry = entries.find(candidate => candidate.id === id);
    if (!entry || (active.length === 0 && !modelPluginIds.has(id))) continue;
    paths.push(entry.pkgDir);
    for (const tool of active) names.add(tool.name);
  }
  return { paths, toolNames: names };
}

/**
 * 重新加载所有已安装插件：原生发现 → 策略元数据缓存 + 只读白名单注册。
 * 单个插件加载失败仅告警，不阻塞整体。
 */
export async function loadAllPlugins(): Promise<void> {
  const entries = listPluginEntries();
  if (entries.length === 0) {
    for (const tools of loadedPlugins.values()) {
      unregisterPluginToolNames(tools.map((t) => t.name));
    }
    loadedPlugins.clear();
    virtualModels.clear();
    modelPluginIds.clear();
    return;
  }
  const bus = createEventBus();
  const result = await discoverAndLoadExtensions(
    entries.map((entry) => entry.pkgDir),
    platformPaths.artifactsDir,
    EXTENSIONS_DIR,
    bus,
  );
  for (const err of result.errors) {
    console.warn(`[plugins] 扩展加载失败 ${err.path}: ${err.error}`);
  }
  virtualModels.clear();
  modelPluginIds.clear();
  for (const registration of [...result.runtime.pendingVirtualModelRegistrations, ...result.runtime.pendingNativeProviderRegistrations, ...result.runtime.pendingProviderRegistrations]) {
    const entry = entries.find(candidate => {
      const offset = relative(candidate.pkgDir, registration.extensionPath);
      return offset === "" || (!isAbsolute(offset) && offset !== ".." && !offset.startsWith(`..${sep}`));
    });
    if (entry) modelPluginIds.add(entry.id);
  }
  for (const registration of result.runtime.pendingVirtualModelRegistrations) {
    const entry = entries.find(candidate => {
      const offset = relative(candidate.pkgDir, registration.extensionPath);
      return offset === "" || (!isAbsolute(offset) && offset !== ".." && !offset.startsWith(`..${sep}`));
    });
    if (entry) virtualModels.set(`${registration.definition.provider}/${registration.definition.id}`, { pluginId: entry.id, definition: registration.definition });
  }
  const next = new Map<string, AgentTool[]>();
  for (const ext of result.extensions) {
    const entry = entries.find(
      (e) => { const offset = relative(e.pkgDir, ext.path); return offset === "" || (!isAbsolute(offset) && offset !== ".." && !offset.startsWith(`..${sep}`)); },
    );
    if (!entry) continue;
    next.set(
      entry.id,
      Array.from(ext.tools.values()).map(({ definition }) => ({
        ...definition,
        execute: async () => { throw new Error("插件工具必须通过原生 Pi AgentSession 执行"); },
      })),
    );
  }
  for (const tools of loadedPlugins.values()) {
    unregisterPluginToolNames(tools.map((t) => t.name));
  }
  loadedPlugins.clear();
  for (const [id, tools] of next) {
    loadedPlugins.set(id, tools);
    registerPluginToolNames(tools.map((t) => t.name));
    const entry = entries.find((e) => e.id === id);
    if (entry) {
      const readOnly = readOnlyToolsOf(entry);
      if (readOnly.length > 0) registerReadOnlyToolNames(readOnly);
    }
    console.log(
      `[plugins] 已加载插件 ${id}: ${tools.map((t) => t.name).join(", ")}`,
    );
  }
}

export function ensurePluginsDir(): void {
  mkdirSync(PLUGINS_ROOT, { recursive: true });
}
