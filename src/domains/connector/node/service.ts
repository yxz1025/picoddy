// 受管连接器服务：目录元数据 + 真实生命周期状态的统一出口。
// HTTP（handleApi）与 IPC（connector.*）共享同一单例，DTO 完全一致。

import type { ConnectorLifecycle } from "./lifecycle.ts";
import type { ConnectorRegistry } from "./registry.ts";
import type { ConnectorStateStore } from "./state_store.ts";
import type { ConnectorLifecycleState } from "./types.ts";
import { startOperation } from "../../../infra/operation_log.ts";

export interface ConnectorServiceItem {
  readonly id: string;
  readonly displayName: string;
  readonly description: string;
  readonly icon: string;
  readonly toolName: string;
  readonly catalogVersion: string;
  // 状态存储中已安装的目录版本；"" 表示未安装（update-needed 判定：catalogVersion !== installedCatalogVersion）。
  readonly installedCatalogVersion: string;
  readonly state: ConnectorLifecycleState;
  readonly cliVersion?: string;
  readonly updatedAt: string;
  readonly error?: { readonly code: string; readonly message: string; readonly retryable: boolean };
}

export interface ConnectorService {
  list(): Promise<ConnectorServiceItem[]>;
  get(connectorId: string): Promise<ConnectorServiceItem>;
  activate(connectorId: string): Promise<ConnectorServiceItem>;
  cancel(connectorId: string): Promise<void>;
  reauthorize(connectorId: string): Promise<ConnectorServiceItem>;
  logout(connectorId: string): Promise<ConnectorServiceItem>;
  repair(connectorId: string): Promise<ConnectorServiceItem>;
  update(connectorId: string): Promise<ConnectorServiceItem>;
  uninstall(connectorId: string): Promise<ConnectorServiceItem>;
  // 启动恢复：只清理过期锁与残留 staging，不联网、不安装、不开授权。
  recoverStartup(): Promise<void>;
}

export interface ConnectorServiceDependencies {
  readonly registry: ConnectorRegistry;
  readonly store: ConnectorStateStore;
  readonly lifecycle: ConnectorLifecycle;
}

export function createConnectorService(dependencies: ConnectorServiceDependencies): ConnectorService {
  const { registry, store, lifecycle } = dependencies;

  const runLifecycleOperation = async <T>(
    operationName: string,
    connectorId: string,
    action: () => Promise<T>,
  ): Promise<T> => {
    const operation = startOperation(operationName, { connectorId });
    try {
      const result = await action();
      operation.success();
      return result;
    } catch (error) {
      operation.error(error);
      throw error;
    }
  };

  const toItem = async (connectorId: string): Promise<ConnectorServiceItem> => {
    const entry = registry.get(connectorId);
    const record = await store.read(connectorId);
    return {
      id: entry.id,
      displayName: entry.displayName,
      description: entry.description,
      icon: entry.presentation.icon,
      toolName: entry.delegate.toolName,
      catalogVersion: entry.version,
      installedCatalogVersion: record.catalogVersion,
      state: record.state,
      ...(record.cliVersion !== undefined ? { cliVersion: record.cliVersion } : {}),
      updatedAt: record.updatedAt,
      ...(record.error !== undefined ? { error: record.error } : {}),
    };
  };

  return {
    async list() {
      return Promise.all(registry.list().map((entry) => toItem(entry.id)));
    },
    async get(connectorId) {
      return toItem(connectorId);
    },
    async activate(connectorId) {
      return runLifecycleOperation("connector.activate", connectorId, async () => {
        await lifecycle.activate(connectorId);
        return toItem(connectorId);
      });
    },
    async cancel(connectorId) {
      await runLifecycleOperation("connector.cancel", connectorId, () => lifecycle.cancel(connectorId));
    },
    async reauthorize(connectorId) {
      return runLifecycleOperation("connector.reauthorize", connectorId, async () => {
        await lifecycle.reauthorize(connectorId);
        return toItem(connectorId);
      });
    },
    async logout(connectorId) {
      return runLifecycleOperation("connector.logout", connectorId, async () => {
        await lifecycle.logout(connectorId);
        return toItem(connectorId);
      });
    },
    async repair(connectorId) {
      return runLifecycleOperation("connector.repair", connectorId, async () => {
        await lifecycle.repair(connectorId);
        return toItem(connectorId);
      });
    },
    async update(connectorId) {
      return runLifecycleOperation("connector.update", connectorId, async () => {
        await lifecycle.update(connectorId);
        return toItem(connectorId);
      });
    },
    async uninstall(connectorId) {
      return runLifecycleOperation("connector.uninstall", connectorId, async () => {
        await lifecycle.uninstall(connectorId);
        return toItem(connectorId);
      });
    },
    async recoverStartup() {
      await runLifecycleOperation("connector.recover-startup", "startup", () => lifecycle.recoverStartup());
    },
  };
}
