import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";

import {
  buildManagedNodeEnv,
  buildManagedPythonEnv,
  buildManagedShellEnv,
} from "./managed-environment.ts";
import {
  ensurePythonRuntime,
  type PackagedPythonManifest,
  type ResolvedPythonRuntime,
} from "./python-installer.ts";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { parseRuntimeLock } from "./runtime-lock.ts";
import { ensureRuntimeWrappers } from "./wrappers.ts";

export interface RuntimeServiceDependencies {
  platform: "darwin" | "win32";
  arch: string;
  isPackaged: boolean;
  resourcesPath: string;
  projectRoot: string;
  appDataDir: string;
  hostExecutable: string;
  hostNodeVersion: string;
  hostElectronVersion?: string;
  readHostEnv?: () => NodeJS.ProcessEnv;
}

export interface ManagedRuntimeService {
  resolveNode(): Promise<{ executable: string; version: string; env: NodeJS.ProcessEnv }>;
  resolvePython(): Promise<{ executable: string; version: string; root: string; env: NodeJS.ProcessEnv }>;
  buildShellEnv(base?: NodeJS.ProcessEnv): Promise<NodeJS.ProcessEnv>;
}

interface RuntimeManifest {
  schemaVersion: 1;
  platform: "darwin" | "win32";
  arch: string;
  key: string;
  python: PackagedPythonManifest;
}

function resolveNpmCliPath(dependencies: RuntimeServiceDependencies): string {
  const require = createRequire(import.meta.url);
  const packageJson = require.resolve("npm/package.json");
  if (packageJson.includes("app.asar")) {
    return join(dependencies.resourcesPath, "app.asar.unpacked", "node_modules", "npm", "bin", "npm-cli.js");
  }
  return join(resolve(packageJson, ".."), "bin", "npm-cli.js");
}

function assertManifest(value: unknown, dependencies: RuntimeServiceDependencies): RuntimeManifest {
  if (typeof value !== "object" || value === null) throw new Error("RUNTIME_MANIFEST_INVALID: manifest must be an object");
  const manifest = value as Partial<RuntimeManifest>;
  if (manifest.schemaVersion !== 1 || manifest.platform !== dependencies.platform || manifest.arch !== dependencies.arch) {
    throw new Error("RUNTIME_MANIFEST_INVALID: manifest does not match host platform");
  }
  if (manifest.key !== `${dependencies.platform}-${dependencies.arch}` || typeof manifest.python !== "object" || manifest.python === null) {
    throw new Error("RUNTIME_MANIFEST_INVALID: manifest key or Python entry is invalid");
  }
  return manifest as RuntimeManifest;
}

export function createManagedRuntimeService(dependencies: RuntimeServiceDependencies): ManagedRuntimeService {
  let manifestPromise: Promise<RuntimeManifest> | undefined;
  let pythonPromise: Promise<ResolvedPythonRuntime> | undefined;
  const hostEnv = () => dependencies.readHostEnv?.() ?? process.env;
  const vendorRoot = dependencies.isPackaged
    ? join(dependencies.resourcesPath, "vendor")
    : resolve(dependencies.projectRoot, "build", "runtime-staging");

  const loadManifest = (): Promise<RuntimeManifest> => {
    if (!manifestPromise) {
      manifestPromise = readFile(join(vendorRoot, "runtime-manifest.json"), "utf8")
        .then((raw) => assertManifest(JSON.parse(raw), dependencies))
        .catch((error) => { manifestPromise = undefined; throw error; });
    }
    return manifestPromise;
  };

  const resolvePython = async () => {
    await validateNode();
    if (!pythonPromise) {
      pythonPromise = loadManifest().then((manifest) => ensurePythonRuntime({
        platform: dependencies.platform,
        arch: dependencies.arch,
        pythonRoot: join(dependencies.appDataDir, "binaries", "python"),
        archivePath: join(vendorRoot, manifest.python.archiveFile),
        manifest: manifest.python,
      })).catch((error) => { pythonPromise = undefined; throw error; });
    }
    const runtime = await pythonPromise;
    return {
      ...runtime,
      env: buildManagedPythonEnv(hostEnv()),
    };
  };

  const validateNode = async () => {
    // Development may run under the developer's Node; packaged apps must match the lock.
    if (!dependencies.isPackaged) return;
    const require = createRequire(import.meta.url);
    const lock = parseRuntimeLock(JSON.parse(await readFile(
      new URL("../../../resources/runtimes/runtime-lock.json", import.meta.url), "utf8",
    )));
    const npm = require("npm/package.json") as { version: string };
    if (dependencies.hostNodeVersion !== lock.node.nodeVersion ||
        (dependencies.hostElectronVersion ?? process.versions.electron) !== lock.node.electronVersion ||
        npm.version !== lock.node.npmVersion) {
      throw new Error("RUNTIME_VERSION_MISMATCH: packaged Electron, Node or npm differs from runtime-lock.json");
    }
  };
  // Different installations must not rewrite each other's command launchers.
  const identity = createHash("sha256").update(dependencies.hostExecutable).update(dependencies.projectRoot).digest("hex").slice(0, 16);
  const wrapperDir = join(dependencies.appDataDir, "binaries", "wrappers", identity);
  return {
    async resolveNode() {
      await validateNode();
      return {
        executable: dependencies.hostExecutable,
        version: dependencies.hostNodeVersion,
        env: buildManagedNodeEnv(hostEnv()),
      };
    },
    resolvePython,
    async buildShellEnv(base = hostEnv()) {
      await validateNode();
      await ensureRuntimeWrappers({
        platform: dependencies.platform,
        wrapperDir,
        hostExecutable: dependencies.hostExecutable,
        npmCliPath: resolveNpmCliPath(dependencies),
        pythonLauncher: {
          bootstrap: fileURLToPath(new URL("./python-launcher.cjs", import.meta.url)),
          config: {
            platform: dependencies.platform, arch: dependencies.arch,
            isPackaged: dependencies.isPackaged, resourcesPath: dependencies.resourcesPath,
            projectRoot: dependencies.projectRoot, appDataDir: dependencies.appDataDir,
            hostExecutable: dependencies.hostExecutable, hostNodeVersion: dependencies.hostNodeVersion,
            hostElectronVersion: dependencies.hostElectronVersion,
          },
        },
      });
      return buildManagedShellEnv({
        platform: dependencies.platform,
        wrapperDir,
        hostEnv: base,
      });
    },
  };
}

export function createDefaultManagedRuntimeService(): ManagedRuntimeService {
  const platform = process.platform === "win32"
    ? "win32"
    : process.platform === "darwin"
      ? "darwin"
      : undefined;
  if (!platform) throw new Error("RUNTIME_PLATFORM_UNSUPPORTED: only macOS and Windows are supported");
  const resourcesPath = (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath ?? "";
  const defaultApp = (process as NodeJS.Process & { defaultApp?: boolean }).defaultApp === true;
  return createManagedRuntimeService({
    platform,
    arch: process.arch,
    isPackaged: resourcesPath.length > 0 && !defaultApp && process.env.NODE_ENV !== "development",
    resourcesPath,
    projectRoot: fileURLToPath(new URL("../../../", import.meta.url)),
    appDataDir: platform === "win32"
      ? join(process.env.LOCALAPPDATA ?? process.env.USERPROFILE ?? process.cwd(), "PiCoddy")
      : join(process.env.HOME ?? process.cwd(), ".picoddy"),
    hostExecutable: process.execPath,
    hostNodeVersion: process.versions.node,
    hostElectronVersion: process.versions.electron,
  });
}
