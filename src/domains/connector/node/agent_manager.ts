// 主会话到隐藏 connector child 的委托管理器。
// 每个 (parent, connector) 复用同一 child 会话；首次创建按 key 序列化；
// 登出/卸载/目录版本变化/已安装版本替换使旧关联失效并安全销毁重建。

import { realpath } from "node:fs/promises";

import type { ConnectorSessionContext } from "../../../infra/context.ts";
import { getDb } from "../../../infra/db.ts";
import { getConversation } from "../../session/node/store.ts";
import { ConnectorError } from "./errors.ts";
import { resolveInstalledBinPath } from "./node_npm_driver.ts";
import { connectorPaths } from "./paths.ts";
import type { ConnectorStateStore } from "./state_store.ts";
import type { ConnectorCatalogEntry } from "./types.ts";
import {
  createAgentChild,
  deleteAgentChild,
  findAgentChild,
} from "./agent_session_store.ts";

export interface AgentDelegateResult {
  readonly childConversationId: string;
  readonly connector: ConnectorSessionContext;
  readonly catalogVersion: string;
  readonly reused: boolean;
}

export interface AgentManagerDependencies {
  readonly appDataDir: string;
  readonly registry: { readonly get: (connectorId: string) => ConnectorCatalogEntry | undefined };
  readonly store: ConnectorStateStore;
  /** 创建隐藏 child 会话（connector-agent 类别），返回会话 id。 */
  readonly createChild: (parentConversationId: string) => string;
  /** 删除 child 会话（SQLite 全量数据）。 */
  readonly deleteChild: (childConversationId: string) => void;
  /** 清理 child 会话运行时（provider 级销毁）。 */
  readonly disposeChild: (childConversationId: string) => Promise<void>;
  readonly resolveVersionRoot?: (connectorId: string, cliVersion: string) => Promise<string>;
  readonly resolveBinPath?: (versionRoot: string, entry: ConnectorCatalogEntry) => Promise<string>;
}

export interface AgentManager {
  delegate(
    parentConversationId: string,
    connectorId: string,
    task: string,
  ): Promise<AgentDelegateResult>;
  destroy(parentConversationId: string, connectorId: string): Promise<void>;
}

export function createAgentManager(dependencies: AgentManagerDependencies): AgentManager {
  const { appDataDir, registry, store, createChild, deleteChild, disposeChild } = dependencies;
  const resolveVersionRoot = dependencies.resolveVersionRoot ?? (async (connectorId, cliVersion) => {
    return realpath(connectorPaths(appDataDir, connectorId, cliVersion).current);
  });
  const resolveBinPath = dependencies.resolveBinPath ?? resolveInstalledBinPath;

  async function destroyNow(
    parentConversationId: string,
    connectorId: string,
  ): Promise<void> {
    const db = getDb();
    const existing = findAgentChild(db, parentConversationId, connectorId);
    if (existing === undefined) return;
    deleteAgentChild(db, parentConversationId, connectorId);
    await disposeChild(existing.childConversationId);
    deleteChild(existing.childConversationId);
  }

  async function delegateNow(
    parentConversationId: string,
    connectorId: string,
    _task: string,
  ): Promise<AgentDelegateResult> {
    const entry = registry.get(connectorId);
    if (entry === undefined) {
      throw new ConnectorError("CONNECTOR_NOT_FOUND", `Unknown connector: ${connectorId}`);
    }
    const record = await store.read(connectorId);
    if (record.state !== "ready") {
      throw new ConnectorError(
        record.state === "not_installed" ? "CLI_NOT_INSTALLED" : "AUTH_REQUIRED",
        `Connector ${connectorId} is not ready (state: ${record.state})`,
      );
    }
    const cliVersion = record.cliVersion;
    if (cliVersion === undefined) {
      throw new ConnectorError("CLI_NOT_INSTALLED", `Connector ${connectorId} has no installed CLI`);
    }
    const versionRoot = await resolveVersionRoot(connectorId, cliVersion);
    const binPath = await resolveBinPath(versionRoot, entry);

    const db = getDb();
    const existing = findAgentChild(db, parentConversationId, connectorId);
    if (existing !== undefined) {
      const valid = existing.catalogVersion === record.catalogVersion
        && existing.installedVersion === cliVersion
        && getConversation(existing.childConversationId) !== null;
      if (valid) {
        return {
          childConversationId: existing.childConversationId,
          connector: { connectorId, cliVersion, binPath, versionRoot },
          catalogVersion: record.catalogVersion,
          reused: true,
        };
      }
      await destroyNow(parentConversationId, connectorId);
    }
    const childConversationId = createChild(parentConversationId);
    createAgentChild(db, {
      parentConversationId,
      connectorId,
      childConversationId,
      catalogVersion: record.catalogVersion,
      installedVersion: cliVersion,
    });
    return {
      childConversationId,
      connector: { connectorId, cliVersion, binPath, versionRoot },
      catalogVersion: record.catalogVersion,
      reused: false,
    };
  }

  const inFlight = new Map<string, Promise<AgentDelegateResult>>();
  return {
    delegate(parentConversationId, connectorId, task) {
      const key = `${parentConversationId}:${connectorId}`;
      const pending = inFlight.get(key);
      if (pending) return pending;
      const promise = delegateNow(parentConversationId, connectorId, task).finally(() => {
        if (inFlight.get(key) === promise) inFlight.delete(key);
      });
      inFlight.set(key, promise);
      return promise;
    },
    destroy: destroyNow,
  };
}
