import assert from "node:assert/strict";
import { test } from "node:test";

import type { ConnectorConnectionService } from "../src/domains/connector/node/connection.ts";
import { handleMcpRoutes } from "../src/transport/http/mcp.ts";
import type { RequestContext } from "../src/transport/http/routes.ts";

function requestContext(method: string, path: string, body?: unknown) {
  const responses: Array<{ status: number; data: unknown }> = [];
  const context = {
    request: { method },
    url: new URL(path, "https://cloud.example.test"),
    user: { id: "10000000-0000-4000-8000-000000000001" },
    async readJson() { return body; },
    json(status: number, data: unknown) { responses.push({ status, data }); },
  } as unknown as RequestContext;
  return { context, responses };
}

test("MCP HTTP routes expose view, connect, disconnect and stored tools", async () => {
  const calls: Array<[string, unknown?]> = [];
  const service = {
    async view() { calls.push(["view"]); return { config: {}, availableConfig: {}, connected: [] }; },
    async connect(input: unknown) { calls.push(["connect", input]); return { id: "id", tools: [] }; },
    async disconnect(input: unknown) { calls.push(["disconnect", input]); return { disconnected: true }; },
    async tools(input: unknown) { calls.push(["tools", input]); return { id: "id", tools: ["search"] }; },
  } as unknown as ConnectorConnectionService;
  const dependencies = { createService: () => service };

  const listing = requestContext("GET", "/api/mcp");
  assert.equal(await handleMcpRoutes(listing.context, dependencies), true);
  assert.deepEqual(listing.responses, [{
    status: 200,
    data: { config: {}, availableConfig: {}, connected: [] },
  }]);

  const connect = requestContext("POST", "/api/mcp/connect", { name: "knowledge" });
  assert.equal(await handleMcpRoutes(connect.context, dependencies), true);
  assert.deepEqual(connect.responses, [{ status: 200, data: { id: "id", tools: [] } }]);

  const disconnect = requestContext("POST", "/api/mcp/disconnect", { id: "connector-id" });
  assert.equal(await handleMcpRoutes(disconnect.context, dependencies), true);
  assert.deepEqual(disconnect.responses, [{ status: 200, data: { disconnected: true } }]);

  const tools = requestContext("GET", "/api/mcp/tools?id=connector-id");
  assert.equal(await handleMcpRoutes(tools.context, dependencies), true);
  assert.deepEqual(tools.responses, [{ status: 200, data: { id: "id", tools: ["search"] } }]);
  assert.deepEqual(calls, [
    ["view"],
    ["connect", { name: "knowledge" }],
    ["disconnect", { id: "connector-id" }],
    ["tools", { id: "connector-id" }],
  ]);
});

test("MCP HTTP handler leaves unrelated paths and methods to other routers", async () => {
  const dependencies = {
    createService: () => { throw new Error("service must not be created"); },
  };
  assert.equal(await handleMcpRoutes(
    requestContext("DELETE", "/api/mcp/connect").context,
    dependencies,
  ), false);
  assert.equal(await handleMcpRoutes(
    requestContext("GET", "/api/mcp/oauth").context,
    dependencies,
  ), false);
});
