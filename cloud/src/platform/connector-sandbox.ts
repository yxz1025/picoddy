import type { Config } from "../config.ts";
import {
  createSandbox,
  reconcileRunSandboxes,
  runSandboxMcp,
  type CloudSandbox,
  type McpConnector,
  type McpRunnerRequest,
} from "./sandbox.ts";

const CONNECTOR_SANDBOX_SECONDS = 60;
const MAX_DISCOVERED_TOOLS = 512;
const MAX_TOOL_NAME_LENGTH = 256;

export interface DiscoveredConnectorTool {
  name: string;
}

export interface ConnectorSandboxDependencies {
  createSandbox(
    config: Config,
    operationId: string,
    signal?: AbortSignal,
  ): Promise<CloudSandbox>;
  runSandboxMcp(
    sandbox: CloudSandbox,
    request: McpRunnerRequest,
    signal?: AbortSignal,
  ): Promise<unknown>;
  reconcileRunSandboxes(config: Config, operationId: string): Promise<void>;
}

export type ConnectorSandboxProbe = (
  config: Config,
  operationId: string,
  connector: McpConnector,
  signal?: AbortSignal,
) => Promise<DiscoveredConnectorTool[]>;

function operationSignal(parent?: AbortSignal): AbortSignal {
  const timeout = AbortSignal.timeout(CONNECTOR_SANDBOX_SECONDS * 1_000);
  return parent ? AbortSignal.any([parent, timeout]) : timeout;
}

function discoveredTools(value: unknown): DiscoveredConnectorTool[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("MCP runner returned an invalid tool result");
  }
  const tools = (value as { tools?: unknown }).tools;
  if (!Array.isArray(tools) || tools.length > MAX_DISCOVERED_TOOLS) {
    throw new Error("MCP runner returned an invalid tool list");
  }
  const names = new Set<string>();
  const result = tools.map((tool) => {
    const name = tool && typeof tool === "object" && !Array.isArray(tool)
      ? (tool as { name?: unknown }).name
      : undefined;
    if (
      typeof name !== "string" || !name || name.length > MAX_TOOL_NAME_LENGTH ||
      /[\u0000-\u001f\u007f]/u.test(name) || names.has(name)
    ) {
      throw new Error("MCP runner returned an invalid tool name");
    }
    names.add(name);
    return { name };
  });
  return result;
}

export function createConnectorSandboxProbe(
  dependencies: ConnectorSandboxDependencies = {
    createSandbox,
    runSandboxMcp,
    reconcileRunSandboxes,
  },
): ConnectorSandboxProbe {
  return async (config, operationId, connector, parentSignal) => {
    const sandboxConfig = {
      ...config,
      sandboxTimeoutSeconds: Math.min(
        config.sandboxTimeoutSeconds,
        CONNECTOR_SANDBOX_SECONDS,
      ),
    };
    const signal = operationSignal(parentSignal);
    let sandbox: CloudSandbox | undefined;
    let output: DiscoveredConnectorTool[] | undefined;
    let operationError: unknown;
    try {
      sandbox = await dependencies.createSandbox(sandboxConfig, operationId, signal);
      output = discoveredTools(await dependencies.runSandboxMcp(
        sandbox,
        { connector, operation: "list" },
        signal,
      ));
    } catch (error) {
      operationError = error;
    }

    const cleanupErrors: unknown[] = [];
    if (sandbox) {
      try { await sandbox.destroy(); }
      catch (error) { cleanupErrors.push(error); }
    }
    try { await dependencies.reconcileRunSandboxes(sandboxConfig, operationId); }
    catch (error) { cleanupErrors.push(error); }

    if (operationError && cleanupErrors.length > 0) {
      throw new AggregateError(
        [operationError, ...cleanupErrors],
        "Connector probe and sandbox cleanup failed",
      );
    }
    if (operationError) throw operationError;
    if (cleanupErrors.length === 1) throw cleanupErrors[0];
    if (cleanupErrors.length > 1) {
      throw new AggregateError(cleanupErrors, "Connector sandbox cleanup failed");
    }
    return output!;
  };
}

export const probeConnectorInSandbox = createConnectorSandboxProbe();
