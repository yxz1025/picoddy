import {
  createConnectorConnectionService,
  type AuthorizedConnectorResolver,
  type ConnectorConnectionService,
  type ConnectorOperationLimiter,
} from "../../domains/connector/node/connection.ts";
import { getAuthorizedConnector } from "../../domains/connector/node/oauth.ts";
import { saveConnectorConfiguration } from '../../domains/connector/node/configuration.ts';
import { handleBuiltinMcpRoutes, type BuiltinMcpDependencies } from './mcp-builtin.ts';
import type { ConnectorSandboxProbe } from "../../platform/connector-sandbox.ts";
import type { RequestContext } from "./routes.ts";

export interface McpRouteDependencies {
  builtin?: BuiltinMcpDependencies;
  createService?: (context: RequestContext) => ConnectorConnectionService;
  getAuthorizedConnector?: AuthorizedConnectorResolver;
  probe?: ConnectorSandboxProbe;
  limiter?: ConnectorOperationLimiter;
}

function service(
  context: RequestContext,
  dependencies: McpRouteDependencies,
): ConnectorConnectionService {
  if (dependencies.createService) return dependencies.createService(context);
  return createConnectorConnectionService({
    database: context.database,
    config: context.config,
    ownerId: context.user.id,
    getAuthorizedConnector: dependencies.getAuthorizedConnector ??
      getAuthorizedConnector as AuthorizedConnectorResolver,
    probe: dependencies.probe,
    limiter: dependencies.limiter,
  });
}

export async function handleMcpRoutes(
  context: RequestContext,
  dependencies: McpRouteDependencies = {},
): Promise<boolean> {
  const method = context.request.method || "GET";
  const path = context.url.pathname;
  if (await handleBuiltinMcpRoutes(context, dependencies.builtin)) return true;
  const recognized =
    ((method === "GET" || method === "POST") && path === "/api/mcp") ||
    (method === "GET" && path === "/api/mcp/tools") ||
    (method === "POST" && (path === "/api/mcp/connect" || path === "/api/mcp/disconnect"));
  if (!recognized) return false;

  const connections = service(context, dependencies);
  if (path === "/api/mcp") {
    if (method === 'POST') await saveConnectorConfiguration(context.database, context.config, context.user.id, await context.readJson(1024 * 1024));
    context.json(200, await connections.view());
    return true;
  }
  if (path === "/api/mcp/connect") {
    context.json(200, await connections.connect(await context.readJson(4_096)));
    return true;
  }
  if (path === "/api/mcp/disconnect") {
    context.json(200, await connections.disconnect(await context.readJson(4_096)));
    return true;
  }
  const id = context.url.searchParams.get("id");
  const name = context.url.searchParams.get("name");
  context.json(200, await connections.tools({
    ...(id !== null ? { id } : {}),
    ...(name !== null ? { name } : {}),
  }));
  return true;
}
