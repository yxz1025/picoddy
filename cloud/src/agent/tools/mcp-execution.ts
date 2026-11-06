import type { RunSelection } from '../../cloud/runs/types.ts';
import type { McpConnector, McpRunnerRequest } from '../../platform/sandbox.ts';
import { resolveCloudToolPolicy } from './contracts.ts';

export interface McpToolDefinition { name: string; inputSchema?: Record<string, any>; annotations?: Record<string, unknown> }
export type McpOperation = Omit<McpRunnerRequest, 'connector'>;
export interface McpExecutionDependencies {
  guard(): Promise<void>;
  authorize(request: McpOperation): Promise<McpConnector>;
  invoke(connector: McpConnector, request: McpOperation, tool?: McpToolDefinition): Promise<unknown>;
  /** A trusted local read adapter must recheck owner/config/auth itself. Never supplied by model input. */
  localCall?(request: McpOperation, tool: McpToolDefinition): Promise<unknown>;
}

export async function executeMcpOperation(selection: Pick<RunSelection, 'permission' | 'runtimeProfile' | 'delegation'>,
  request: McpOperation, dependencies: McpExecutionDependencies): Promise<unknown> {
  if (!resolveCloudToolPolicy(selection).includes('mcp')) throw new Error('MCP_PERMISSION_DENIED');
  if (!['list', 'call'].includes(request.operation)) throw new Error('MCP_OPERATION_INVALID');
  if (request.operation === 'call' && (typeof request.name !== 'string' || !request.name)) throw new Error('MCP_TOOL_NOT_AVAILABLE');
  if (request.arguments !== undefined && (!request.arguments || typeof request.arguments !== 'object' || Array.isArray(request.arguments))) throw new Error('MCP_ARGUMENTS_INVALID');
  request = { operation: request.operation, name: request.name, arguments: request.arguments };
  await dependencies.guard();
  const discovery: McpOperation = { operation: 'list' };
  const listing: any = await dependencies.invoke(await dependencies.authorize(discovery), discovery);
  if (!listing || !Array.isArray(listing.tools) || listing.tools.length > 512) throw new Error('MCP_TOOL_LIST_INVALID');
  if (request.operation === 'list') return listing;
  const matches = listing.tools.filter((tool: any) => tool && tool.name === request.name);
  if (matches.length !== 1) throw new Error('MCP_TOOL_NOT_AVAILABLE');
  const tool: McpToolDefinition = matches[0];
  await dependencies.guard();
  if (dependencies.localCall) return dependencies.localCall(request, tool);
  // Recheck current config/token after discovery before every call.
  return dependencies.invoke(await dependencies.authorize(request), request, tool);
}
