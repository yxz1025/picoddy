// src/domains/plugin/node/service.ts
// 插件安装/卸载服务：spawn 系统 npm（Pi 官方 `pi install npm:xxx` 同款），
// 目录即状态（~/.picoddy/plugins/<id>/ 存在 = 已安装），无需单独状态文件。

import { spawn } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";

import {
  PLUGINS_ROOT,
  ensurePluginsDir,
  isPluginLoaded,
  listPluginEntries,
  loadAllPlugins,
  unloadPlugin,
  validatePkgName,
  type PluginEntry,
} from "../../../agent/plugin_tools.ts";
import { managedConnectorAssembly } from "../../connector/node/assembly.ts";
import { buildCliProcessEnv } from "../../../platform/cli/runtime.ts";
import { runWindowsProcessNoWindow } from "../../../platform/windows_process.ts";
import { isWindows } from "../../../platform/runtime.ts";

const NPM_INSTALL_TIMEOUT_MS = 5 * 60 * 1000;
const MAX_OUTPUT_BYTES = 1024 * 1024;

export interface NpmResult {
  code: number;
  stdout: string;
  stderr: string;
  timedOut?: boolean;
}

export type NpmRunner = (args: string[]) => Promise<NpmResult>;

/** 默认 npm 执行器：始终使用 Electron 内嵌 Node + bundled npm CLI，不调用系统 npm。 */
export const runNpm: NpmRunner = async (args) => {
  const runtime = (await managedConnectorAssembly()).runtime;
  const commandArgs = [runtime.npm.cliPath, ...args];
  const env = buildCliProcessEnv({ ELECTRON_RUN_AS_NODE: "1" });
  if (isWindows) {
    const result = await runWindowsProcessNoWindow({
      command: runtime.node.executable,
      args: commandArgs,
      env: Object.fromEntries(Object.entries(env).filter((entry): entry is [string, string] => entry[1] !== undefined)),
      timeoutMs: NPM_INSTALL_TIMEOUT_MS,
      maxOutputBytes: MAX_OUTPUT_BYTES,
    });
    return {
      code: result.code,
      stdout: new TextDecoder().decode(result.stdout),
      stderr: new TextDecoder().decode(result.stderr),
      timedOut: result.timedOut,
    };
  }
  return new Promise((resolve) => {
    const child = spawn(runtime.node.executable, commandArgs, {
      env,
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d: Buffer) => (stdout += d.toString()));
    child.stderr.on("data", (d: Buffer) => (stderr += d.toString()));
    const timer = setTimeout(() => child.kill("SIGKILL"), NPM_INSTALL_TIMEOUT_MS);
    child.on("error", (err: NodeJS.ErrnoException) => {
      clearTimeout(timer);
      resolve({
        code: 127,
        stdout,
        stderr:
          err.code === "ENOENT" ? "PiCoddy 内置 npm 不可用" : err.message,
      });
    });
    child.on("close", (code, signal) => {
      clearTimeout(timer);
      resolve({
        code: code ?? 1,
        stdout,
        stderr,
        timedOut: signal === "SIGKILL",
      });
    });
  });
};

/** npm install 参数拼装（纯函数，供单测）：--prefix 落到插件目录，包名加 @latest。 */
export function buildInstallCommand(
  pkgName: string,
  pluginDir: string,
): string[] {
  return ["install", "--prefix", pluginDir, `${pkgName}@latest`];
}

export interface InstallOptions {
  root?: string;
  refresh?: () => Promise<void>;
}

/**
 * 安装插件：npm install → 刷新加载缓存 → 验证是 Pi 扩展包。
 * 任何失败（含装完发现不是扩展包）清理半成品目录后抛错。
 */
export async function installPlugin(
  pkgName: string,
  runner: NpmRunner = runNpm,
  options: InstallOptions = {},
): Promise<PluginEntry> {
  const name = validatePkgName(pkgName);
  const root = options.root ?? PLUGINS_ROOT;
  const refresh = options.refresh ?? loadAllPlugins;
  const pluginDir = join(root, name);
  if (existsSync(pluginDir)) {
    throw new Error(`插件 ${name} 已安装`);
  }
  ensurePluginsDir();
  const result = await runner(buildInstallCommand(name, pluginDir));
  if (result.code !== 0) {
    rmSync(pluginDir, { recursive: true, force: true });
    const detail = (result.stderr || result.stdout).trim();
    throw new Error(
      `npm install 失败（${result.code}）：${detail || "无输出"}`,
    );
  }
  await refresh();
  if (!isPluginLoaded(name)) {
    rmSync(pluginDir, { recursive: true, force: true });
    throw new Error(`该包不是 Pi 扩展，已清理：${name}`);
  }
  const entry = listPluginEntries(root).find((e) => e.id === name);
  if (!entry) {
    throw new Error(`插件安装完成但未找到目录：${name}`);
  }
  return entry;
}

export async function uninstallPlugin(id: string): Promise<void> {
  const entry = listPluginEntries().find((e) => e.id === id);
  if (!entry) {
    throw new Error(`插件未安装：${id}`);
  }
  unloadPlugin(id);
  rmSync(join(PLUGINS_ROOT, id), { recursive: true, force: true });
}

export interface PluginMeta {
  id: string;
  name: string;
  version?: string;
  description?: string;
  loaded: boolean;
}

export function listPlugins(): PluginMeta[] {
  return listPluginEntries().map((e) => ({
    id: e.id,
    name: e.name,
    version: e.version,
    description: e.description,
    loaded: isPluginLoaded(e.id),
  }));
}

export interface NpmPackageHit {
  name: string;
  version: string;
  description?: string;
  publisher?: string | { username?: string };
}

/** npm registry 搜索（数据源与 Pi 官方一致）。 */
export async function searchPackages(
  query: string,
  signal?: AbortSignal,
): Promise<NpmPackageHit[]> {
  const url =
    `https://registry.npmjs.org/-/v1/search?text=${encodeURIComponent(query)}&size=20`;
  const res = await fetch(url, { signal });
  if (!res.ok) {
    throw new Error(`npm registry 搜索失败（HTTP ${res.status}）`);
  }
  const data = (await res.json()) as {
    objects: Array<{ package: NpmPackageHit }>;
  };
  return data.objects.map((o) => ({
    name: o.package.name,
    version: o.package.version,
    description: o.package.description,
    publisher: o.package.publisher,
  }));
}
