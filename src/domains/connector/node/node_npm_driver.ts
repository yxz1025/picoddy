import { createHash, randomBytes } from "node:crypto";
import { constants, lstat, mkdir, open, rename, rm, symlink } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

import { buildCliProcessEnv, type ManagedNpmRuntime } from "../../../platform/cli/runtime.ts";
import { ConnectorError } from "./errors.ts";
import type { ConnectorPaths } from "./paths.ts";
import type { ConnectorProcessResult, RunConnectorProcessOptions } from "./process_runner.ts";
import { extractConnectorSkill, type ExtractConnectorSkillResult } from "./skill_extractor.ts";
import type { ConnectorCatalogEntry } from "./types.ts";

const MAX_PACKAGE_JSON_BYTES = 1024 * 1024;
const MAX_READ_CHUNK = 64 * 1024;

export interface ConnectorInstallOperation {
  readonly operationId: string;
  readonly signal?: AbortSignal;
}

export interface ConnectorNpmDriverOptions {
  readonly paths: ConnectorPaths;
  readonly runProcess: (options: RunConnectorProcessOptions) => Promise<ConnectorProcessResult>;
  readonly runtime: ManagedNpmRuntime;
}

export interface ConnectorInstallResult {
  readonly cliVersion: string;
  readonly versionRoot: string;
  readonly binPath: string;
  readonly skill: ExtractConnectorSkillResult;
  readonly packageGraphDigest: string;
  readonly installedAt: string;
}

export interface ConnectorNpmDriver {
  install(entry: ConnectorCatalogEntry, operation: ConnectorInstallOperation): Promise<ConnectorInstallResult>;
}

const PLATFORM: "darwin" | "linux" | "win32" =
  process.platform === "darwin" ? "darwin" : process.platform === "win32" ? "win32" : "linux";

function integrity(cause?: unknown): ConnectorError {
  return new ConnectorError("PACKAGE_INTEGRITY_INVALID", "Installed connector package failed verification", {
    cause,
  });
}

function invalidCatalog(): never {
  throw new ConnectorError("CONNECTOR_CATALOG_INVALID", "Connector catalog entry is inconsistent");
}

function isInside(root: string, target: string): boolean {
  const rel = relative(root, target);
  return rel === "" || (rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel));
}

async function writeExclusive(path: string, content: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const handle = await open(path, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY, 0o600);
  try {
    await handle.writeFile(content, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function readBoundedFile(path: string, limit: number): Promise<string> {
  const stat = await lstat(path).catch(() => undefined);
  if (!stat || stat.isSymbolicLink() || !stat.isFile() || stat.size > limit) throw integrity();
  const noFollow = constants.O_NOFOLLOW;
  const flags = typeof noFollow === "number" && noFollow !== 0 ? constants.O_RDONLY | noFollow : constants.O_RDONLY;
  const handle = await open(path, flags);
  try {
    const chunks: Buffer[] = [];
    let total = 0;
    while (true) {
      const capacity = Math.min(MAX_READ_CHUNK, limit + 1 - total);
      if (capacity <= 0) throw integrity();
      const chunk = Buffer.allocUnsafe(capacity);
      const { bytesRead } = await handle.read(chunk, 0, chunk.length, null);
      if (bytesRead === 0) break;
      total += bytesRead;
      if (total > limit) throw integrity();
      chunks.push(chunk.subarray(0, bytesRead));
    }
    return Buffer.concat(chunks, total).toString("utf8");
  } finally {
    await handle.close().catch(() => undefined);
  }
}

function materializeLockFiles(entry: ConnectorCatalogEntry): { readonly packageJsonText: string; readonly lockText: string } {
  const rootCoordinate = `${entry.install.package}@${entry.install.version}`;
  if (entry.packages[rootCoordinate] === undefined) invalidCatalog();
  const name = `connector-install-${entry.id}`;
  const dependencies = { [entry.install.package]: entry.install.version };
  const packages: Record<string, unknown> = {
    "": { name, version: "1.0.0", dependencies },
  };
  for (const [coordinate, lock] of Object.entries(entry.packages)) {
    const separator = coordinate.lastIndexOf("@");
    const packageName = coordinate.slice(0, separator);
    const version = coordinate.slice(separator + 1);
    if (packageName === "" || version === "" || coordinate !== `${packageName}@${version}`) invalidCatalog();
    packages[`node_modules/${packageName}`] = { version, resolved: lock.resolved, integrity: lock.integrity };
  }
  const packageJsonText = `${JSON.stringify({ name, version: "1.0.0", private: true, dependencies }, null, 2)}\n`;
  const lockText = `${JSON.stringify(
    { name, version: "1.0.0", lockfileVersion: 3, requires: true, packages },
    null,
    2,
  )}\n`;
  return { packageJsonText, lockText };
}

function resolveBinPath(packageRoot: string, bin: unknown, entry: ConnectorCatalogEntry): string | undefined {
  let relativePath: string | undefined;
  if (typeof bin === "string" && bin !== "") relativePath = bin;
  else if (typeof bin === "object" && bin !== null) {
    const map = bin as Readonly<Record<string, unknown>>;
    const executableName = entry.executable[PLATFORM];
    if (executableName !== undefined && typeof map[executableName] === "string") {
      relativePath = map[executableName] as string;
    } else {
      const first = Object.values(map).find((value): value is string => typeof value === "string");
      if (first !== undefined) relativePath = first;
    }
  }
  if (relativePath === undefined) return undefined;
  const resolved = resolve(packageRoot, relativePath);
  return isInside(packageRoot, resolved) ? resolved : undefined;
}

// Reads the verified root package.json and resolves the declared CLI entry inside the package.
async function readVerifiedPackage(packageDir: string, entry: ConnectorCatalogEntry): Promise<{ readonly binPath: string }> {
  const text = await readBoundedFile(join(packageDir, "package.json"), MAX_PACKAGE_JSON_BYTES);
  let installed: { readonly name?: unknown; readonly version?: unknown; readonly bin?: unknown };
  try {
    installed = JSON.parse(text) as { readonly name?: unknown; readonly version?: unknown; readonly bin?: unknown };
  } catch (cause) {
    throw integrity(cause);
  }
  if (installed.name !== entry.install.package || installed.version !== entry.install.version) throw integrity();
  const binPath = resolveBinPath(packageDir, installed.bin, entry);
  if (binPath === undefined) throw integrity();
  return { binPath };
}

// Resolves the CLI entry from an already-activated version root (reauthorize/logout paths).
export async function resolveInstalledBinPath(versionRoot: string, entry: ConnectorCatalogEntry): Promise<string> {
  const packageDir = resolve(versionRoot, "node_modules", entry.install.package);
  if (!isInside(versionRoot, packageDir)) invalidCatalog();
  const { binPath } = await readVerifiedPackage(packageDir, entry);
  return binPath;
}

function resolveContained(root: string, relativePath: string): string {
  const candidate = resolve(root, relativePath);
  if (!isInside(root, candidate)) invalidCatalog();
  return candidate;
}

async function syncDirectoryBestEffort(path: string): Promise<void> {
  const handle = await open(path, constants.O_RDONLY).catch(() => undefined);
  if (handle === undefined) return;
  try {
    await handle.sync().catch((cause: unknown) => {
      const code = (cause as NodeJS.ErrnoException).code;
      if (code !== "EINVAL" && code !== "ENOSYS" && code !== "ENOTSUP" && code !== "EBADF") throw cause;
    });
  } finally {
    await handle.close().catch(() => undefined);
  }
}

async function switchCurrent(currentPath: string, versionDir: string): Promise<void> {
  await rm(currentPath, { recursive: true, force: true });
  await symlink(versionDir, currentPath, PLATFORM === "win32" ? "junction" : "dir");
}

// Renames the completed staging dir into place, swapping an existing same-version
// dir aside and restoring it if the swap fails, so the old version is never lost.
async function swapIntoPlace(staging: string, versionDir: string): Promise<void> {
  const exists = await lstat(versionDir).then(() => true, () => false);
  if (!exists) {
    await rename(staging, versionDir);
    return;
  }
  const aside = join(dirname(versionDir), `.staging-${basename(versionDir)}.old-${randomBytes(8).toString("hex")}`);
  await rename(versionDir, aside);
  try {
    await rename(staging, versionDir);
  } catch (cause) {
    await rename(aside, versionDir).catch(() => undefined);
    throw cause;
  }
  await rm(aside, { recursive: true, force: true });
}

export function createConnectorNpmDriver(options: ConnectorNpmDriverOptions): ConnectorNpmDriver {
  const { paths, runProcess, runtime } = options;
  const nodeEnv = () => buildCliProcessEnv({ ELECTRON_RUN_AS_NODE: "1" });
  const npmEnv = (entry: ConnectorCatalogEntry) =>
    buildCliProcessEnv({
      ELECTRON_RUN_AS_NODE: "1",
      npm_config_registry: entry.install.registry,
      npm_config_cache: paths.cache,
      npm_config_update_notifier: "false",
    });

  return {
    async install(entry, operation) {
      const cliVersion = entry.install.version;
      const staging = resolve(paths.staging);
      if (relative(paths.versions, staging) !== `.staging-${cliVersion}`) invalidCatalog();
      await rm(staging, { recursive: true, force: true });
      await mkdir(staging, { recursive: true });
      try {
        const { packageJsonText, lockText } = materializeLockFiles(entry);
        await writeExclusive(join(staging, "package.json"), packageJsonText);
        await writeExclusive(join(staging, "package-lock.json"), lockText);

        await runProcess({
          executable: runtime.node.executable,
          argv: [runtime.npm.cliPath, "ci", "--ignore-scripts", "--no-audit", "--no-fund"],
          cwd: staging,
          env: npmEnv(entry),
          signal: operation.signal,
        });

        const lockAfter = await readBoundedFile(join(staging, "package-lock.json"), MAX_PACKAGE_JSON_BYTES);
        if (lockAfter !== lockText) throw integrity();

        const rootPackageDir = resolve(staging, "node_modules", entry.install.package);
        if (!isInside(staging, rootPackageDir)) invalidCatalog();
        const { binPath: stagingBinPath } = await readVerifiedPackage(rootPackageDir, entry);

        if (entry.install.postInstall !== undefined) {
          const script = resolveContained(rootPackageDir, entry.install.postInstall.path);
          const result = await runProcess({
            executable: runtime.node.executable,
            argv: [script, ...entry.install.postInstall.argv],
            cwd: rootPackageDir,
            env: nodeEnv(),
            signal: operation.signal,
          });
          if (result.exitCode !== 0) {
            throw new ConnectorError("CONNECTOR_BROKEN", "Connector package post-install script failed");
          }
        }

        const versionCheck = await runProcess({
          executable: runtime.node.executable,
          argv: [stagingBinPath, ...entry.versionCheck.argv],
          cwd: rootPackageDir,
          env: nodeEnv(),
          signal: operation.signal,
        });
        const pattern = new RegExp(entry.versionCheck.outputPattern);
        if (!pattern.test(`${versionCheck.stdout}\n${versionCheck.stderr}`)) {
          throw new ConnectorError("CLI_VERSION_INVALID", "Connector CLI version check failed");
        }

        const skill = await extractConnectorSkill({
          packageRoot: rootPackageDir,
          archive: entry.skill.archive,
          entry: entry.skill.entry,
          destination: join(staging, "skill"),
        });

        const installedAt = new Date().toISOString();
        const packageGraphDigest = createHash("sha512").update(lockText).digest("hex");
        const metadata = {
          catalogVersion: entry.version,
          cliVersion,
          packageGraphDigest,
          skillDigest: skill.skillDigest,
          installedAt,
        };
        await writeExclusive(join(staging, "metadata.json"), `${JSON.stringify(metadata, null, 2)}\n`);

        const versionDir = resolve(paths.versions, cliVersion);
        if (!isInside(paths.versions, versionDir)) invalidCatalog();
        await swapIntoPlace(staging, versionDir);
        await switchCurrent(paths.current, versionDir);
        await syncDirectoryBestEffort(paths.versions);
        return {
          cliVersion,
          versionRoot: versionDir,
          binPath: join(versionDir, relative(staging, stagingBinPath)),
          skill: { ...skill, entryPath: join(versionDir, "skill", entry.skill.entry) },
          packageGraphDigest,
          installedAt,
        };
      } catch (cause) {
        await rm(staging, { recursive: true, force: true }).catch(() => undefined);
        if (cause instanceof ConnectorError) throw cause;
        throw new ConnectorError("CONNECTOR_BROKEN", "Connector install failed", { cause });
      }
    },
  };
}
