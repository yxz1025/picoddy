// 连接器共享装配：Registry + 运行时解析的单一惰性实例。
// application.electron.ts（HTTP/IPC 服务装配）与 src/agent/tools/index.ts（子代理网关）
// 共用同一实例，避免两套缓存、两套版本；运行时版本只来自校验后的资源锁。
// 目录无效抛 CONNECTOR_CATALOG_INVALID，运行时与宿主不匹配抛 CONNECTOR_RUNTIME_UNAVAILABLE。

import { dirname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { resolveManagedNpmRuntime, type ManagedNpmRuntime } from "../../../platform/cli/runtime.ts";
import { ConnectorError } from "./errors.ts";
import { createConnectorRegistry, type ConnectorRegistry } from "./registry.ts";

export interface ManagedConnectorAssembly {
  readonly registry: ConnectorRegistry;
  readonly runtime: ManagedNpmRuntime;
}

const MODULE_PATH = fileURLToPath(import.meta.url);
const ELECTRON_RESOURCES_PATH = (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath ?? "";

function isInsideAsar(modulePath: string): boolean {
  return resolve(modulePath).split(sep).includes("app.asar");
}

export function resolveConnectorResourcesRoot(
  modulePath: string = MODULE_PATH,
  resourcesPath: string = ELECTRON_RESOURCES_PATH,
): string {
  if (isInsideAsar(modulePath)) {
    if (typeof resourcesPath !== "string" || resourcesPath.length === 0) {
      throw new ConnectorError("CONNECTOR_CATALOG_INVALID", "Connector resources path is unavailable");
    }
    return resolve(resourcesPath, "builtin-connectors");
  }
  return resolve(dirname(modulePath), "../../../../resources/builtin-connectors");
}

let assemblyPromise: Promise<ManagedConnectorAssembly> | undefined;

export function managedConnectorAssembly(): Promise<ManagedConnectorAssembly> {
  assemblyPromise ??= (async () => {
    try {
      const registry = await createConnectorRegistry(resolveConnectorResourcesRoot());
      const runtime = resolveManagedNpmRuntime(registry.runtimeLock());
      return Object.freeze({ registry, runtime });
    } catch (cause) {
      if (cause instanceof ConnectorError) throw cause;
      throw new ConnectorError("CONNECTOR_RUNTIME_UNAVAILABLE", "连接器运行时不匹配或不可用", { cause });
    }
  })();
  return assemblyPromise;
}
