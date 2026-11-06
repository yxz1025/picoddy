import assert from "node:assert/strict";
import { test } from "node:test";

import type { Config } from "../src/config.ts";
import type { CloudSandbox, McpRunnerRequest } from "../src/platform/sandbox.ts";
import { createConnectorSandboxProbe } from "../src/platform/connector-sandbox.ts";

function config(): Config {
  return { sandboxTimeoutSeconds: 900 } as Config;
}

test("connector probe uses a 60-second sandbox and destroys then reconciles it", async () => {
  const events: string[] = [];
  const sandbox = {
    id: "sandbox-id",
    async destroy() { events.push("destroy"); },
  } as CloudSandbox;
  const probe = createConnectorSandboxProbe({
    async createSandbox(received, operationId, signal) {
      assert.equal(received.sandboxTimeoutSeconds, 60);
      assert.equal(operationId, "operation-id");
      assert.ok(signal);
      events.push("create");
      return sandbox;
    },
    async runSandboxMcp(received, request: McpRunnerRequest, signal) {
      assert.equal(received, sandbox);
      assert.equal(request.operation, "list");
      assert.equal(request.connector.transport, "http");
      assert.ok(signal);
      events.push("probe");
      return {
        tools: [
          { name: "search", description: "Search", inputSchema: { type: "object" } },
          { name: "fetch", description: "Fetch", inputSchema: { type: "object" } },
        ],
      };
    },
    async reconcileRunSandboxes(_config, operationId) {
      assert.equal(operationId, "operation-id");
      events.push("reconcile");
    },
  });

  assert.deepEqual(await probe(
    config(),
    "operation-id",
    { transport: "http", url: "https://mcp.example.test/server" },
  ), [{ name: "search" }, { name: "fetch" }]);
  assert.deepEqual(events, ["create", "probe", "destroy", "reconcile"]);
});

test("connector probe reconciles an unknown create and rejects malformed runner output", async () => {
  let reconciled = 0;
  const creationFailure = createConnectorSandboxProbe({
    async createSandbox() { throw new Error("create response lost"); },
    async runSandboxMcp() { throw new Error("unreachable"); },
    async reconcileRunSandboxes() { reconciled += 1; },
  });
  await assert.rejects(creationFailure(
    config(),
    "operation-id",
    { transport: "http", url: "https://mcp.example.test/server" },
  ));
  assert.equal(reconciled, 1);

  const sandbox = { id: "sandbox-id", async destroy() {} } as CloudSandbox;
  const malformed = createConnectorSandboxProbe({
    async createSandbox() { return sandbox; },
    async runSandboxMcp() { return { tools: [{ name: "valid" }, { name: "bad\nname" }] }; },
    async reconcileRunSandboxes() {},
  });
  await assert.rejects(
    malformed(config(), "operation-id", { transport: "http", url: "https://mcp.example.test" }),
    /invalid tool/i,
  );
});
