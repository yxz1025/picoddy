import { execFile } from "node:child_process";
import { lstatSync, readFileSync, realpathSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

import type { ConnectorRuntimeLock } from "../../domains/connector/node/types.ts";

const CLI_TIMEOUT_MS = 120_000;
const CLI_MAX_BUFFER_BYTES = 1024 * 1024;
const BLOCKED_PREFIXES = ["ELECTRON_", "CODEBUDDY_", "VITE_", "ACC_PRODUCT_CONFIG_"];
const BLOCKED_KEYS = new Set([
  "NODE_OPTIONS",
  "NODE_PATH",
  "NODE_DEBUG",
  "NODE_EXTRA_CA_CERTS",
  "NODE_TLS_REJECT_UNAUTHORIZED",
  "HTTP_PROXY",
  "HTTPS_PROXY",
  "ALL_PROXY",
  "NO_PROXY",
  "http_proxy",
  "https_proxy",
  "all_proxy",
  "no_proxy",
]);

export interface CliPluginManifest {
  id: string;
  version: string;
  packageName: string;
  entry: string;
  capabilities: readonly string[];
}

export interface CliRunnerOptions {
  env: NodeJS.ProcessEnv;
  timeout: number;
  maxBuffer: number;
  shell: false;
  windowsHide: true;
}

export type CliRunner = (
  command: string,
  args: readonly string[],
  options: CliRunnerOptions,
) => Promise<{ stdout: string; stderr: string }>;

export interface RunBundledCliOptions {
  resolveEntry?: (manifest: CliPluginManifest) => string;
  runner?: CliRunner;
  execPath?: string;
  hostEnv?: NodeJS.ProcessEnv;
  managedEnv?: NodeJS.ProcessEnv;
  timeout?: number;
  maxBuffer?: number;
}

export function buildCliProcessEnv(
  managedEnv: NodeJS.ProcessEnv = {},
  hostEnv: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  const passed: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(hostEnv)) {
    if (value === undefined) continue;
    const upper = key.toUpperCase();
    if (BLOCKED_KEYS.has(key) || BLOCKED_KEYS.has(upper)) continue;
    if (BLOCKED_PREFIXES.some((prefix) => upper.startsWith(prefix))) continue;
    if (/(?:TOKEN|API_KEY|PASSWORD|SECRET)$/u.test(upper)) continue;
    passed[key] = value;
  }
  return { ...passed, ...managedEnv };
}

function defaultResolveEntry(manifest: CliPluginManifest): string {
  const require = createRequire(import.meta.url);
  const packageJson = require.resolve(`${manifest.packageName}/package.json`);
  return join(dirname(packageJson), manifest.entry);
}

const defaultRunner: CliRunner = (command, args, options) =>
  new Promise((resolve, reject) => {
    execFile(
      command,
      [...args],
      { ...options, encoding: "utf8" },
      (error, stdout, stderr) => {
        if (error) {
          reject(Object.assign(error, { stdout, stderr }));
          return;
        }
        resolve({ stdout, stderr });
      },
    );
  });

export async function runBundledCli(
  manifest: CliPluginManifest,
  args: readonly string[],
  options: RunBundledCliOptions = {},
): Promise<{ stdout: string; stderr: string }> {
  if (!manifest.id || !manifest.packageName || !manifest.entry) {
    throw new Error("CLI 插件 manifest 无效");
  }
  const env = buildCliProcessEnv(
    { ELECTRON_RUN_AS_NODE: "1", ...(options.managedEnv ?? {}) },
    options.hostEnv ?? process.env,
  );
  return (options.runner ?? defaultRunner)(
    options.execPath ?? process.execPath,
    [
      (options.resolveEntry ?? defaultResolveEntry)(manifest),
      ...args,
    ],
    {
      env,
      timeout: options.timeout ?? CLI_TIMEOUT_MS,
      maxBuffer: options.maxBuffer ?? CLI_MAX_BUFFER_BYTES,
      shell: false,
      windowsHide: true,
    },
  );
}

export interface ManagedNpmRuntime {
  readonly node: { readonly executable: string; readonly version: string };
  readonly npm: { readonly cliPath: string; readonly version: string };
}

const MODULE_PATH = fileURLToPath(import.meta.url);
const ELECTRON_RESOURCES_PATH = (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath ?? "";

function isInside(root: string, target: string): boolean {
  const path = relative(root, target);
  return path !== "" && path !== ".." && !path.startsWith(`..${sep}`) && !isAbsolute(path);
}

function isInsideAsar(modulePath: string): boolean {
  return resolve(modulePath).split(sep).includes("app.asar");
}

export function resolvePackagedNpmPackageJson(
  modulePath: string,
  resourcesPath: string,
  resolvedPackageJson: string,
): string {
  if (!isInsideAsar(modulePath)) return resolvedPackageJson;
  if (typeof resourcesPath !== "string" || resourcesPath.length === 0) {
    throw new Error("managed npm resources path is unavailable");
  }
  const logicalPackageJson = resolve(resourcesPath, "app.asar", "node_modules", "npm", "package.json");
  if (resolve(resolvedPackageJson) !== logicalPackageJson) {
    throw new Error("managed npm package is outside the bundled package location");
  }
  return resolve(resourcesPath, "app.asar.unpacked", "node_modules", "npm", "package.json");
}

/** 按经过校验的 runtime lock（schema v2，唯一事实来源）解析宿主 Node 与 bundled npm；任何不匹配都拒绝，绝不回退系统运行时。 */
export function resolveManagedNpmRuntime(
  lock: ConnectorRuntimeLock,
  options: {
    execPath?: string;
    nodeVersion?: string;
    electronVersion?: string;
    modulePath?: string;
    resourcesPath?: string;
  } = {},
): ManagedNpmRuntime {
  const execPath = options.execPath ?? process.execPath;
  const nodeVersion = options.nodeVersion ?? process.versions.node;
  if (nodeVersion !== lock.host.nodeVersion) {
    throw new Error(`managed node runtime ${lock.host.nodeVersion} is not available (app embeds ${nodeVersion})`);
  }
  const electronVersion = options.electronVersion ?? process.versions.electron;
  if (electronVersion !== lock.host.version) {
    throw new Error(`managed electron runtime ${lock.host.version} is not available (app embeds ${electronVersion ?? "unknown"})`);
  }
  const require = createRequire(import.meta.url);
  let resolvedNpmPackageJson: string;
  try {
    resolvedNpmPackageJson = require.resolve("npm/package.json");
  } catch (cause) {
    throw new Error(`managed npm runtime ${lock.npm.version} is not bundled`, { cause });
  }
  const npmPackageJsonPath = resolvePackagedNpmPackageJson(
    options.modulePath ?? MODULE_PATH,
    options.resourcesPath ?? ELECTRON_RESOURCES_PATH,
    resolvedNpmPackageJson,
  );
  const npmRoot = dirname(npmPackageJsonPath);
  let canonicalNpmRoot: string;
  let canonicalPackageJson: string;
  try {
    canonicalNpmRoot = realpathSync(npmRoot);
    canonicalPackageJson = realpathSync(npmPackageJsonPath);
  } catch (cause) {
    throw new Error(`managed npm runtime ${lock.npm.version} is not available`, { cause });
  }
  if (!lstatSync(npmRoot).isDirectory()
    || !lstatSync(npmPackageJsonPath).isFile()
    || !isInside(canonicalNpmRoot, canonicalPackageJson)) {
    throw new Error(`managed npm runtime ${lock.npm.version} package is invalid`);
  }
  const manifest = JSON.parse(readFileSync(npmPackageJsonPath, "utf8")) as {
    version?: unknown;
    bin?: unknown;
  };
  const npmVersion = typeof manifest.version === "string" ? manifest.version : undefined;
  if (npmVersion !== lock.npm.version) {
    throw new Error(`managed npm runtime ${lock.npm.version} is not available (bundled ${npmVersion ?? "unknown"})`);
  }
  const bin = typeof manifest.bin === "object" && manifest.bin !== null
    ? (manifest.bin as Record<string, unknown>).npm
    : undefined;
  if (typeof bin !== "string" || bin.length === 0) {
    throw new Error(`bundled npm ${npmVersion} does not declare an npm bin`);
  }
  const cliPath = resolve(npmRoot, bin);
  let canonicalCliPath: string;
  try {
    canonicalCliPath = realpathSync(cliPath);
  } catch (cause) {
    throw new Error(`bundled npm ${npmVersion} bin entry is unavailable`, { cause });
  }
  if (!isInside(npmRoot, cliPath)
    || !lstatSync(cliPath).isFile()
    || !isInside(canonicalNpmRoot, canonicalCliPath)) {
    throw new Error(`bundled npm ${npmVersion} bin entry is not inside its package`);
  }
  return Object.freeze({
    node: Object.freeze({ executable: execPath, version: nodeVersion }),
    npm: Object.freeze({ cliPath: canonicalCliPath, version: npmVersion }),
  });
}

export function createCliPluginRegistry(
  manifests: readonly CliPluginManifest[],
): { get(id: string): CliPluginManifest | undefined; list(): CliPluginManifest[] } {
  const byId = new Map(manifests.map((manifest) => [manifest.id, Object.freeze({
    ...manifest,
    capabilities: Object.freeze([...manifest.capabilities]),
  })]));
  return {
    get: (id) => byId.get(id),
    list: () => [...byId.values()],
  };
}
