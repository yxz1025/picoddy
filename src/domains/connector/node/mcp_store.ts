import { mcpConfigStore } from "../../../agent/mcp_config.ts";
import type { McpServerConfig } from "../../../agent/mcp.ts";
import { createConnectorStateStore, type ConnectorStateRecord, type ConnectorStateStore } from "./state_store.ts";
import type { ConnectorRegistry } from "./registry.ts";
import type { ConnectorCatalogEntry } from "./types.ts";

export function cliMcpConfig(entry: ConnectorCatalogEntry, record: ConnectorStateRecord): McpServerConfig | undefined {
  if (record.state === "not_installed" || !record.cliVersion) return undefined;
  return {
    managedBy: "builtin",
    type: "managed-cli",
    displayName: entry.displayName,
    description: entry.description,
    disabled: record.state !== "ready",
    cli: {
      connectorId: entry.id,
      package: entry.install.package,
      version: record.cliVersion,
      executable: entry.executable[process.platform as "darwin" | "win32" | "linux"] ?? entry.id,
    },
  };
}

/** Lifecycle journals remain operational state; all runnable registrations live in mcp.json. */
export function createMcpManagedConnectorStore(
  root: string,
  registry: ConnectorRegistry,
  enforceConfig = false,
  config = mcpConfigStore,
): ConnectorStateStore & { synchronize(): Promise<void> } {
  const states = createConnectorStateStore(root);
  const synchronizeRecord = async (record: ConnectorStateRecord) => {
    const entry = registry.get(record.connectorId);
    if (!entry) throw new Error(`Unknown connector: ${record.connectorId}`);
    await config.setBuiltin(entry.id, cliMcpConfig(entry, record));
  };
  return {
    async read(id) {
      const record = await states.read(id);
      if (!enforceConfig || record.state !== "ready") return record;
      const entry = (await config.load()).mcpServers[id];
      if (!entry || entry.disabled || entry.type !== "managed-cli" || entry.cli?.connectorId !== id) {
        return { ...record, state: "installed_unauthorized" };
      }
      return record;
    },
    async write(record, options) {
      await states.write(record, options);
      await synchronizeRecord(record);
    },
    async synchronize() {
      for (const entry of registry.list()) await synchronizeRecord(await states.read(entry.id));
    },
  };
}
