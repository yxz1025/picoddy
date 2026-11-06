// src/agent/mcp.ts
// MCP Host：连接外部 MCP server，把工具注册进 agent
// 极简方案（对照 参考设计 三层代理的减法）：
//   1. 读 ~/.picoddy/mcp.json 配置
//   2. 每个 server 用 SDK Client 连接（stdio / SSE / streamable HTTP）
//   3. listTools → 包装成 pi AgentTool → 注册进 getFullTools()
//   4. 工具调用时转发给对应 MCP server

import type { CallToolResult } from "@earendil-works/pi-mcp";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import { mcpConfigStore } from "./mcp_config.ts";
import { platformPaths } from "../platform/paths.ts";
import { join } from "node:path";
import { convertMcpResult, createMcpResultSchema, McpServerConnection, createDefaultTransport, FileAuthStorageBackend, validateMcpServerConfig, getMcpToolExposure, type McpOAuthConfig, type McpExposure } from "../vendor/pi_native_extensions.ts";
import { getApiKey } from "../infra/keychain.ts";

import { startOperation } from "../infra/operation_log.ts";
import { McpOAuthCredentialStore } from "../vendor/pi_native_extensions.ts";

export interface McpServerConfig {
  command?: string; // stdio: 可执行命令
  args?: string[]; // stdio: 命令参数
  env?: Record<string, string>;
  staticEnv?: Record<string, string>;
  url?: string; // SSE/HTTP: server URL
  type?: string; // 默认根据 command/url 自动判断
  disabled?: boolean;
  enabled?: boolean;
  cwd?: string;
  exposure?: McpExposure;
  toolExposure?: Record<string, McpExposure>;
  oauth?: McpOAuthConfig;
  auth?: { provider: string };
  headers?: Record<string, string>;
  staticHeaders?: Record<string, string>;
  timeout?: number;
  provider?: string;
  authProvider?: "tapd-oauth";
  managedBy?: "builtin";
  cli?: { connectorId: string; package: string; version: string; executable: string };
  displayName?: string;
  description?: string;
}

export interface McpConfig {
  mcpServers: Record<string, McpServerConfig>;
}

export interface McpConnectionInfo {
  name: string;
  displayName?: string;
  toolCount: number;
  tools: string[];
}

export class McpConnectionError extends Error {
  constructor(
    public readonly code: string,
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "McpConnectionError";
  }
}

/** Runtime reads the merged configuration; manual saves preserve managed entries. */
export const ensureMcpConfig = mcpConfigStore.ensure;
export async function loadMcpConfig(): Promise<McpConfig> {
  const stored = await mcpConfigStore.load();
  return { mcpServers: Object.fromEntries(Object.entries(stored.mcpServers).filter(([, entry]) => {
    if (entry.authProvider === 'tapd-oauth' || entry.provider || (entry.managedBy && entry.managedBy !== 'builtin')) return false;
    if (entry.url) {
      try { new URL(entry.url); }
      catch { return false; }
    }
    return true;
  })) };
}
export const saveMcpConfig = mcpConfigStore.saveCustom;

// ===== MCP 连接管理 =====

interface McpConnection {
  client: any;
  tools: AgentTool<any>[];
  serverName: string;
  displayName?: string;
}

const connections = new Map<string, McpConnection>();
const pendingConnections = new Map<
  string,
  Promise<AgentTool<any>[]>
>();
export function nativeMcpCredentials() {
  const root = platformPaths.appDataDir;
  return new McpOAuthCredentialStore(new FileAuthStorageBackend(join(root, "mcp-auth.json")), join(root, "mcp-auth-locks"));
}
const nativeConnections = new Map<string, McpServerConnection>();
export function getNativeMcpConnection(name: string) { return nativeConnections.get(name); }
const connectingClients = new Map<string, { close(): Promise<void> }>();
let connectionGeneration = 0;
function connectionInfo(connection: McpConnection): McpConnectionInfo {
  return {
    name: connection.serverName,
    displayName: connection.displayName,
    toolCount: connection.tools.length,
    tools: connection.tools.map((tool) => tool.name),
  };
}

async function connectConfiguredServer(
  name: string,
  config: McpServerConfig,
): Promise<AgentTool<any>[]> {
  const existing = connections.get(name);
  if (existing && !(existing.client instanceof McpServerConnection && existing.client.state === "closed")) {
    if (existing.client instanceof McpServerConnection) {
      try { await existing.client.getClient(); }
      catch (error) {
        if (existing.client.state === "needs-auth") throw new McpConnectionError("MCP_AUTH_REQUIRED", 401, `连接器 ${name} 需要重新授权`);
        throw error;
      }
    } else await existing.client.validate?.();
    return existing.tools;
  }
  const pending = pendingConnections.get(name);
  if (pending) return await pending;

  const generation = connectionGeneration;
  const trace = startOperation("mcp.connect", {
    name,
    transport: config.command ? "stdio" : config.url ? (config.type || "http") : "unknown",
    provider: config.provider,
  });
  const operation = connectMcpServer(name, config, generation);
  pendingConnections.set(name, operation);
  try {
    const tools = await operation;
    trace.success({ toolCount: tools.length });
    return tools;
  } catch (error) {
    trace.error(error);
    throw error;
  } finally {
    if (pendingConnections.get(name) === operation) {
      pendingConnections.delete(name);
    }
  }
}

/** 用户选择连接器后，按名称连接单个 MCP server。 */
export async function connectMcpServerByName(
  name: string,
): Promise<McpConnectionInfo> {
  const config = await loadMcpConfig();
  if (!Object.hasOwn(config.mcpServers, name)) {
    throw new McpConnectionError(
      "MCP_NOT_CONFIGURED",
      404,
      `MCP 连接器不存在: ${name}`,
    );
  }
  const serverConfig = config.mcpServers[name];
  if (serverConfig.type === "managed-cli") {
    throw new McpConnectionError("MCP_CLI_CONNECTOR", 409, "CLI 连接器请通过内置连接器入口使用");
  }
  if ((serverConfig.disabled || serverConfig.enabled === false)) {
    throw new McpConnectionError(
      "MCP_DISABLED",
      409,
      `MCP 连接器已停用: ${name}`,
    );
  }
  await connectConfiguredServer(name, serverConfig);
  const connection = connections.get(name);
  if (!connection) {
    throw new McpConnectionError(
      "MCP_CONNECTION_FAILED",
      502,
      `MCP 连接器连接失败: ${name}`,
    );
  }
  return connectionInfo(connection);
}

/** 返回已连接 MCP 的工具；未连接时按需建立连接。 */
export async function toolsForMcpServer(
  name: string,
): Promise<AgentTool<any>[]> {
  await connectMcpServerByName(name);
  return [...connections.get(name)!.tools];
}

/**
 * 替换第三方 MCP 配置中的 ${VAR_NAME}。
 *
 * 这里只读取该 MCP 自己显式引用的环境变量。桌面登录令牌绝不能作为
 * TOKEN/KEY/AUTH 等变量的隐式兜底，避免把企业门户凭据发送给无关 MCP。
 */
export function resolveMcpTemplate(
  str: string,
  lookup: (name: string) => string | undefined = (name) =>
    process.env[name],
): string {
  return str.replace(/\${([^}]+)}/g, (match, name) => {
    const envVal = lookup(name);
    return envVal === undefined ? match : envVal;
  });
}

/** 连接所有已配置且未禁用的 MCP server，返回所有工具 */
export async function connectAllMcpServers(): Promise<AgentTool<any>[]> {
  const config = await loadMcpConfig();
  const allTools: AgentTool<any>[] = [];

  for (const [name, serverConfig] of Object.entries(config.mcpServers)) {
    if ((serverConfig.disabled || serverConfig.enabled === false) || serverConfig.type === "managed-cli") continue;

    // 已连接则复用
    if (connections.has(name)) {
      allTools.push(...connections.get(name)!.tools);
      continue;
    }

    try {
      const tools = await connectConfiguredServer(name, serverConfig);
      if (tools.length > 0) {
        allTools.push(...tools);
        console.log(`[mcp] ${name}: ${tools.length} 个工具已注册`);
      }
    } catch (e) {
      console.warn(
        `[mcp] ${name} 连接失败:`,
        e instanceof Error ? e.message : e,
      );
    }
  }

  return allTools;
}

/** 连接单个 MCP server */
async function connectMcpServer(
  name: string,
  config: McpServerConfig,
  generation: number,
): Promise<AgentTool<any>[]> {
  const native = Boolean(config.command) || config.type?.toLowerCase() !== "sse";
  let client: any;
  let mcpTools: any[];
  let refreshTools: (() => AgentTool<any>[]) | undefined;
  let nativeConfig: import("../vendor/pi_native_extensions.ts").NativeMcpServerConfig | undefined;
  if (native) {
    const managedNode = config.managedBy === "builtin" && (name === "gitlab" || name === "jenkins")
      ? await (await import("../platform/runtime/index.ts")).createDefaultManagedRuntimeService().resolveNode()
      : undefined;
    const env = Object.fromEntries(Object.entries({ ...(managedNode?.env ?? {}), ...config.env, ...config.staticEnv }).map(([key, value]) => [key, resolveMcpTemplate(String(value))]));
    const headers = Object.fromEntries(Object.entries({ ...config.staticHeaders, ...config.headers }).map(([key, value]) => [key, resolveMcpTemplate(value)]));
    const validated = validateMcpServerConfig(name, {
      ...config, exposure: config.exposure ?? "direct",
      ...(config.command ? { type: "stdio", command: managedNode?.executable ?? config.command, args: config.args?.map(arg => resolveMcpTemplate(arg)), env } : { type: "http", url: config.url && resolveMcpTemplate(config.url), headers }),
    });
    if (typeof validated === "string") throw new McpConnectionError("MCP_CONFIG_INVALID", 400, validated);
    nativeConfig = validated;
    await nativeConnections.get(name)?.close();
    const connection = new McpServerConnection({
      entry: { name, config: validated, source: join(platformPaths.appDataDir, "mcp.json"), scope: "global" },
      cwd: process.cwd(), // Preserve the existing global stdio working directory; config.cwd is resolved by Pi.
      createTransport: createDefaultTransport,
      credentials: nativeMcpCredentials(),
      providerToken: provider => getApiKey(provider),
      onTools: () => { const current = connections.get(name); if (current && refreshTools) current.tools = refreshTools(); },
    });
    nativeConnections.set(name, connection);
    client = connection;
    connectingClients.set(name, client);
    try {
      if (generation !== connectionGeneration) throw new Error("MCP connection superseded");
      await connection.getClient();
      mcpTools = connection.tools;
    } catch (error) {
      if (connection.state === "needs-auth") throw new McpConnectionError("MCP_AUTH_REQUIRED", 401, `连接器 ${name} 需要授权，请在连接器设置中登录`);
      await connection.close();
      if (nativeConnections.get(name) === connection) nativeConnections.delete(name);
      throw error;
    } finally { if (connectingClients.get(name) === client) connectingClients.delete(name); }
  } else {
    // Pi has no legacy SSE transport; keep the existing supported protocol.
    const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
    const { SSEClientTransport } = await import("@modelcontextprotocol/sdk/client/sse.js");
    const headers = Object.fromEntries(Object.entries({ ...config.staticHeaders, ...config.headers }).map(([key, value]) => [key, resolveMcpTemplate(value)]));
    client = new Client({ name: "pi-a", version: "1.0.4" }, { capabilities: {} });
    connectingClients.set(name, client);
    try {
      if (generation !== connectionGeneration) throw new Error("MCP connection superseded");
      await client.connect(new SSEClientTransport(new URL(resolveMcpTemplate(config.url!)), { eventSourceInit: { headers } } as any));
      mcpTools = (await client.listTools()).tools;
    } catch (error) { await client.close().catch(() => {}); throw error; }
    finally { if (connectingClients.get(name) === client) connectingClients.delete(name); }
  }

  // 包装成 pi AgentTool
  refreshTools = () => (client instanceof McpServerConnection ? client.tools : mcpTools).filter(tool => !nativeConfig || getMcpToolExposure(nativeConfig, tool.name) !== "hidden").map((mcpTool: any) => {
    const prefixedName = `mcp_${name}_${mcpTool.name}`;
    return {
      name: prefixedName,
      label: `MCP: ${mcpTool.name}`,
      description: `[${name}] ${mcpTool.description || mcpTool.name}`,
      parameters: mcpTool.inputSchema || { type: "object", properties: {} },
      // Preserve MCP safety metadata. Protected workspaces fail closed unless
      // the server explicitly declares readOnlyHint=true.
      annotations: mcpTool.annotations,
      outputSchema: createMcpResultSchema(mcpTool.outputSchema),
      ...(nativeConfig ? { exposure: getMcpToolExposure(nativeConfig, mcpTool.name), namespace: { name: `mcp_${name}`, description: config.description ?? config.displayName ?? name } } : {}),
      execute: async (_id: string, params: any, signal?: AbortSignal) => {
        const result = client instanceof McpServerConnection
          ? await client.callTool(mcpTool.name, params, { signal })
          : await client.callTool({ name: mcpTool.name, arguments: params }, undefined, { signal });
        const converted = await convertMcpResult(name, mcpTool.name, result as CallToolResult);
        const content = converted.content;
        if (result.isError) {
          throw new Error(content.filter(part => part.type === "text").map(part => part.text).join("\n") || "MCP tool failed");
        }
        return {
          ...converted,
          content: content.length ? content : [{ type: "text" as const, text: "(无输出)" }],
          details: { server: name, tool: mcpTool.name, structuredContent: result.structuredContent },
        };
      },
    };
  });

  const tools = refreshTools();
  if (generation !== connectionGeneration) {
    await client.close().catch(() => {});
    throw new McpConnectionError(
      "MCP_CONNECTION_SUPERSEDED",
      409,
      `MCP 连接已被新的配置替代: ${name}`,
    );
  }
  connections.set(name, {
    client,
    tools,
    serverName: name,
    displayName: config.displayName,
  });
  return tools;
}

/** 断开所有 MCP 连接 */
export async function disconnectAllMcpServers(): Promise<void> {
  connectionGeneration += 1;
  pendingConnections.clear();
  const opening = new Set([...connectingClients.values(), ...nativeConnections.values()]);
  nativeConnections.clear();
  connectingClients.clear();
  await Promise.all([...opening].map(client => client.close().catch(() => {})));
  for (const [name, conn] of connections) {
    try {
      await conn.client.close();
      console.log(`[mcp] ${name} 已断开`);
    } catch { /* 忽略 */ }
  }
  connections.clear();
}

/** 列出已连接的 MCP server 及其工具（供 UI 展示） */
export function listMcpConnections(): McpConnectionInfo[] {
  return [...connections.values()].filter(connection => (connection.client instanceof McpServerConnection ? connection.client.state === "connected" : connection.client.isConnected?.() !== false)).map(connectionInfo);
}
