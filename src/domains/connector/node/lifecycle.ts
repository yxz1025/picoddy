import { randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, realpath, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import { buildCliProcessEnv, type ManagedNpmRuntime } from "../../../platform/cli/runtime.ts";
import { authorizeConnector } from "./authorization.ts";
import { ConnectorError, type ConnectorErrorCode } from "./errors.ts";
import {
  resolveInstalledBinPath,
  type ConnectorInstallResult,
  type ConnectorNpmDriver,
} from "./node_npm_driver.ts";
import { connectorPaths, type ConnectorPaths } from "./paths.ts";
import type { ConnectorProcessResult, RunConnectorProcessOptions } from "./process_runner.ts";
import type { ConnectorStateRecord, ConnectorStateStore } from "./state_store.ts";
import type { ConnectorCatalogEntry } from "./types.ts";

const RETRYABLE_ERROR_CODES = new Set<ConnectorErrorCode>([
  "NETWORK_ERROR",
  "CONNECTOR_TIMEOUT",
  "CONNECTOR_CANCELLED",
  "CONNECTOR_BUSY",
]);

export interface ConnectorLifecycleDependencies {
  readonly appDataDir: string;
  readonly registry: { readonly get: (connectorId: string) => ConnectorCatalogEntry | undefined };
  readonly store: ConnectorStateStore;
  readonly driver: Pick<ConnectorNpmDriver, "install">;
  readonly runtime: ManagedNpmRuntime;
  readonly runProcess: (options: RunConnectorProcessOptions) => Promise<ConnectorProcessResult>;
  readonly openExternal: (url: string) => void;
  readonly onStateChange?: (record: ConnectorStateRecord) => void;
}

export interface ConnectorLifecycle {
  readonly get: (connectorId: string) => Promise<ConnectorStateRecord>;
  readonly activate: (connectorId: string) => Promise<ConnectorStateRecord>;
  readonly reauthorize: (connectorId: string) => Promise<ConnectorStateRecord>;
  readonly logout: (connectorId: string) => Promise<ConnectorStateRecord>;
  readonly uninstall: (connectorId: string) => Promise<ConnectorStateRecord>;
  readonly repair: (connectorId: string) => Promise<ConnectorStateRecord>;
  readonly update: (connectorId: string) => Promise<ConnectorStateRecord>;
  readonly cancel: (connectorId: string) => Promise<void>;
  readonly recoverStartup: () => Promise<void>;
}

interface ErrorRecord {
  readonly code: ConnectorErrorCode;
  readonly message: string;
  readonly retryable: boolean;
}

function toErrorRecord(cause: unknown): ErrorRecord {
  if (cause instanceof ConnectorError) {
    return { code: cause.code, message: cause.message, retryable: RETRYABLE_ERROR_CODES.has(cause.code) };
  }
  return {
    code: "CONNECTOR_BROKEN",
    message: cause instanceof Error ? cause.message : "unknown error",
    retryable: false,
  };
}

function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (cause) {
    return (cause as NodeJS.ErrnoException).code === "EPERM";
  }
}

function parseLockPid(text: string | undefined): number | undefined {
  if (text === undefined) return undefined;
  try {
    const parsed = JSON.parse(text) as { readonly pid?: unknown };
    return typeof parsed.pid === "number" && Number.isInteger(parsed.pid) ? parsed.pid : undefined;
  } catch {
    return undefined;
  }
}

async function acquireFileLock(
  lockPath: string,
  info: { readonly pid: number; readonly operationId: string },
): Promise<() => Promise<void>> {
  await mkdir(dirname(lockPath), { recursive: true });
  while (true) {
    try {
      await writeFile(lockPath, `${JSON.stringify(info)}\n`, { flag: "wx" });
      return async () => {
        await rm(lockPath, { force: true }).catch(() => undefined);
      };
    } catch (cause) {
      const code = (cause as NodeJS.ErrnoException).code;
      if (code !== "EEXIST") {
        throw new ConnectorError("CONNECTOR_BROKEN", "Failed to acquire connector operation lock", { cause });
      }
      const text = await readFile(lockPath, "utf8").catch(() => undefined);
      const pid = parseLockPid(text);
      if (pid !== undefined && processAlive(pid)) {
        throw new ConnectorError("CONNECTOR_BUSY", "Connector operation already in progress");
      }
      await rm(lockPath, { force: true }).catch(() => undefined);
    }
  }
}

export function createConnectorLifecycle(dependencies: ConnectorLifecycleDependencies): ConnectorLifecycle {
  const { appDataDir, registry, store, driver, runtime, runProcess, openExternal, onStateChange } = dependencies;
  const operations = new Map<string, AbortController>();

  const pathsFor = (connectorId: string, cliVersion?: string): ConnectorPaths =>
    connectorPaths(appDataDir, connectorId, cliVersion ?? "0.0.0");

  const entryFor = (connectorId: string): ConnectorCatalogEntry => {
    const entry = registry.get(connectorId);
    if (entry === undefined) {
      throw new ConnectorError("CONNECTOR_NOT_FOUND", `Unknown connector: ${connectorId}`);
    }
    return entry;
  };

  const writeState = async (
    connectorId: string,
    patch: Partial<ConnectorStateRecord>,
  ): Promise<ConnectorStateRecord> => {
    const current = await store.read(connectorId);
    const record: ConnectorStateRecord = { ...current, ...patch, connectorId, updatedAt: new Date().toISOString() };
    await store.write(record);
    onStateChange?.(record);
    return record;
  };

  const withOperation = async <T>(
    connectorId: string,
    run: (operationId: string, signal: AbortSignal) => Promise<T>,
  ): Promise<T> => {
    if (operations.has(connectorId)) {
      throw new ConnectorError("CONNECTOR_BUSY", `Connector operation already in progress: ${connectorId}`);
    }
    const controller = new AbortController();
    operations.set(connectorId, controller);
    const operationId = randomUUID();
    try {
      const release = await acquireFileLock(pathsFor(connectorId).lock, { pid: process.pid, operationId });
      try {
        return await run(operationId, controller.signal);
      } finally {
        await release();
      }
    } finally {
      operations.delete(connectorId);
    }
  };

  const authorize = async (
    entry: ConnectorCatalogEntry,
    versionRoot: string,
    binPath: string,
    signal: AbortSignal,
    operationId: string,
  ): Promise<void> => {
    await writeState(entry.id, { state: "authorizing", operationId });
    try {
      await authorizeConnector({ binPath, entry, runtime, runProcess, openExternal, signal });
    } catch (cause) {
      await writeState(entry.id, { state: "auth_failed", error: toErrorRecord(cause) });
      throw cause;
    }
    await writeState(entry.id, { state: "ready", error: undefined });
  };

  const lifecycle: ConnectorLifecycle = {
    async get(connectorId) {
      return store.read(connectorId);
    },

    async activate(connectorId) {
      const entry = entryFor(connectorId);
      return withOperation(connectorId, async (operationId, signal) => {
        await writeState(connectorId, { state: "installing", catalogVersion: entry.version, operationId });
        let install: ConnectorInstallResult;
        try {
          install = await driver.install(entry, { operationId, signal });
        } catch (cause) {
          const error = toErrorRecord(cause);
          const state = error.code === "CLI_VERSION_INVALID" ? "version_invalid" : "install_failed";
          await writeState(connectorId, { state, error });
          throw cause;
        }
        await writeState(connectorId, {
          state: "installed_unauthorized",
          cliVersion: install.cliVersion,
          error: undefined,
        });
        await authorize(entry, install.versionRoot, install.binPath, signal, operationId);
        return store.read(connectorId);
      });
    },

    async reauthorize(connectorId) {
      const entry = entryFor(connectorId);
      return withOperation(connectorId, async (operationId, signal) => {
        const current = await store.read(connectorId);
        if (current.cliVersion === undefined) {
          throw new ConnectorError("CLI_NOT_INSTALLED", `Connector is not installed: ${connectorId}`);
        }
        const paths = pathsFor(connectorId, current.cliVersion);
        const versionRoot = await realpath(paths.current).catch(() => {
          throw new ConnectorError("CLI_NOT_INSTALLED", `Connector is not installed: ${connectorId}`);
        });
        const binPath = await resolveInstalledBinPath(versionRoot, entry);
        await authorize(entry, versionRoot, binPath, signal, operationId);
        return store.read(connectorId);
      });
    },

    async logout(connectorId) {
      const entry = entryFor(connectorId);
      return withOperation(connectorId, async () => {
        const current = await store.read(connectorId);
        if (current.cliVersion !== undefined) {
          try {
            const paths = pathsFor(connectorId, current.cliVersion);
            const versionRoot = await realpath(paths.current).catch(() => undefined);
            if (versionRoot !== undefined) {
              const binPath = await resolveInstalledBinPath(versionRoot, entry);
              await runProcess({
                executable: runtime.node.executable,
                argv: [binPath, ...entry.logout.argv],
                env: buildCliProcessEnv({ ELECTRON_RUN_AS_NODE: "1" }),
              });
            }
          } catch {
            // logout still clears state when the CLI is unusable
          }
        }
        return writeState(connectorId, { state: "installed_unauthorized", error: undefined });
      });
    },

    async uninstall(connectorId) {
      return withOperation(connectorId, async () => {
        const current = await store.read(connectorId);
        const paths = pathsFor(connectorId, current.cliVersion);
        await rm(paths.packageRoot, { recursive: true, force: true });
        await rm(paths.cache, { recursive: true, force: true });
        return writeState(connectorId, {
          state: "not_installed",
          catalogVersion: "",
          cliVersion: undefined,
          operationId: undefined,
          error: undefined,
        });
      });
    },

    async repair(connectorId) {
      return lifecycle.activate(connectorId);
    },

    async update(connectorId) {
      return lifecycle.activate(connectorId);
    },

    async cancel(connectorId) {
      operations.get(connectorId)?.abort();
    },

    async recoverStartup() {
      const root = pathsFor("recovery-placeholder").root;
      const locksDir = join(root, "locks");
      const locks = await readdir(locksDir, { withFileTypes: true }).catch(() => []);
      for (const lock of locks) {
        if (!lock.isFile() || !lock.name.endsWith(".lock")) continue;
        const lockPath = join(locksDir, lock.name);
        const pid = parseLockPid(await readFile(lockPath, "utf8").catch(() => undefined));
        if (pid !== undefined && processAlive(pid)) continue;
        await rm(lockPath, { force: true }).catch(() => undefined);
      }

      const packagesDir = join(root, "packages");
      const connectors = await readdir(packagesDir, { withFileTypes: true }).catch(() => []);
      for (const connector of connectors) {
        if (!connector.isDirectory()) continue;
        const lockPath = join(locksDir, `${connector.name}.lock`);
        const pid = parseLockPid(await readFile(lockPath, "utf8").catch(() => undefined));
        if (pid !== undefined && processAlive(pid)) continue;
        const versionsDir = join(packagesDir, connector.name, "versions");
        const versions = await readdir(versionsDir, { withFileTypes: true }).catch(() => []);
        for (const version of versions) {
          if (!version.isDirectory() || !version.name.startsWith(".staging-")) continue;
          await rm(join(versionsDir, version.name), { recursive: true, force: true }).catch(() => undefined);
        }
      }
    },
  };

  return lifecycle;
}
