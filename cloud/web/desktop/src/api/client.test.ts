import assert from "node:assert/strict";
import test from "node:test";

import {
  ApiError,
  callIPC,
  normalizeIpcError,
  resolveIPCRouteForTest,
} from "./client";

test("callIPC rethrows a returned API error envelope", async () => {
  await assert.rejects(
    callIPC(
      {
        call: async () => ({
          name: "ApiError",
          message: "selectedSkillNames must be an array of strings",
          status: 400,
        }),
      },
      "client-invoke",
    ),
    (error: unknown) => {
      assert.ok(error instanceof ApiError);
      assert.equal(error.status, 400);
      assert.equal(error.message, "selectedSkillNames must be an array of strings");
      return true;
    },
  );
});

test("SkillHub catalog routes use dedicated IPC handlers", () => {
  assert.deepEqual(
    resolveIPCRouteForTest("GET", "/api/skillhub/auth/config"),
    { invoke: "skillhub.authConfig", payload: {} },
  );
  assert.deepEqual(
    resolveIPCRouteForTest("POST", "/api/skillhub/auth/config", { secret: "example", ignored: true }),
    { invoke: "skillhub.saveAuthConfig", payload: { secret: "example" } },
  );
  assert.deepEqual(
    resolveIPCRouteForTest("POST", "/api/skillhub/auth/ensure", {}),
    { invoke: "skillhub.ensureAuth", payload: {} },
  );
  assert.deepEqual(
    resolveIPCRouteForTest("GET", "/api/skillhub/namespaces"),
    { invoke: "skillhub.namespaces", payload: {} },
  );
  assert.deepEqual(
    resolveIPCRouteForTest("GET", "/api/skillhub/skills"),
    { invoke: "skillhub.list", payload: {} },
  );
  assert.deepEqual(
    resolveIPCRouteForTest("GET", "/api/skillhub/experts"),
    { invoke: "skillhub.experts", payload: {} },
  );
  assert.deepEqual(
    resolveIPCRouteForTest(
      "GET",
      "/api/skillhub/experts/team-hr/hr-management-expert",
    ),
    {
      invoke: "skillhub.expertDetail",
      payload: { namespace: "team-hr", slug: "hr-management-expert" },
    },
  );
  assert.deepEqual(
    resolveIPCRouteForTest("POST", "/api/skillhub/install", {
      namespace: "front",
      slug: "api-doc-sync",
      version: "20260529.085330",
    }),
    {
      invoke: "skillhub.install",
      payload: {
        namespace: "front",
        slug: "api-doc-sync",
        version: "20260529.085330",
      },
    },
  );
  assert.deepEqual(
    resolveIPCRouteForTest("POST", "/api/skillhub/experts/install", {
      namespace: "teach-engineer",
      slug: "frontend-developer",
      version: "1.0.2",
    }),
    {
      invoke: "skillhub.expertInstall",
      payload: {
        namespace: "teach-engineer",
        slug: "frontend-developer",
        version: "1.0.2",
      },
    },
  );
});

test("Markdown preview uses the built-in HTML preview IPC handler", () => {
  assert.deepEqual(
    resolveIPCRouteForTest("GET", "/api/preview/markdown?path=%2Fworkspace%2Freport.md"),
    {
      invoke: "file.previewMarkdown",
      payload: { path: "/workspace/report.md" },
    },
  );
});

test("directory picker uses the native Electron dialog IPC handler", () => {
  assert.deepEqual(
    resolveIPCRouteForTest("GET", "/api/pick-dir"),
    { invoke: "dialog.pickDir", payload: {} },
  );
});

test("connector routes use dedicated IPC handlers", () => {
  assert.deepEqual(resolveIPCRouteForTest("GET", "/api/mcp/builtin/tapd"),
    { invoke: "mcp.tapdStatus", payload: {} });
  assert.deepEqual(resolveIPCRouteForTest("POST", "/api/mcp/builtin/tapd/install"),
    { invoke: "mcp.tapdInstall", payload: {} });
  assert.deepEqual(resolveIPCRouteForTest("POST", "/api/mcp/builtin/tapd/authorize", { intent: "connect" }),
    { invoke: "mcp.tapdAuthorize", payload: { intent: "connect" } });
  assert.equal(resolveIPCRouteForTest("POST", "/api/mcp/builtin/tapd/configure", { key: "test-key" }), null);
  assert.deepEqual(
    resolveIPCRouteForTest("GET", "/api/connectors"),
    { invoke: "connector.list", payload: {} },
  );
  assert.deepEqual(
    resolveIPCRouteForTest("POST", "/api/connectors/dingtalk/activate"),
    { invoke: "connector.activate", payload: { id: "dingtalk" } },
  );
  assert.deepEqual(
    resolveIPCRouteForTest("GET", "/api/connectors/dingtalk"),
    { invoke: "connector.get", payload: { id: "dingtalk" } },
  );
  assert.deepEqual(
    resolveIPCRouteForTest("DELETE", "/api/connectors/dingtalk"),
    { invoke: "connector.uninstall", payload: { id: "dingtalk" } },
  );
});

test("normalizeIpcError removes Electron remote method noise", () => {
  const normalized = normalizeIpcError(new Error(
    "Error invoking remote method 'skillhub.install': Error: SkillHub 登录失败",
  ));

  assert.ok(normalized instanceof Error);
  assert.equal(normalized.message, "SkillHub 登录失败");
});

test("returned structured-cloned Error must reject instead of accepting a failed prompt", async () => {
  const original = Object.assign(new Error("仓库超过 32MB，请缩小分析范围"), { name: "ApiError", status: 400 });
  const transferred = structuredClone(original);
  await assert.rejects(callIPC({ call: async () => transferred }, "client-invoke"), /超过 32MB/);
});

test('built-in npm MCP routes preserve connector IDs and configuration fields', () => {
  for (const id of ['gitlab', 'jenkins']) {
    assert.deepEqual(resolveIPCRouteForTest('GET', `/api/mcp/builtin/npm/${id}`), { invoke: 'mcp.npmStatus', payload: { id } });
    assert.deepEqual(resolveIPCRouteForTest('POST', `/api/mcp/builtin/npm/${id}/install`), { invoke: 'mcp.npmInstall', payload: { id } });
    assert.deepEqual(resolveIPCRouteForTest('POST', `/api/mcp/builtin/npm/${id}/configure`, { env: { TOKEN: 'value' } }), { invoke: 'mcp.npmConfigure', payload: { id, env: { TOKEN: 'value' } } });
  }
});

test("standard MCP OAuth uses the same IPC payloads as HTTP, including encoded names", () => {
  assert.deepEqual(resolveIPCRouteForTest("GET", "/api/mcp/oauth?name=docs%20%2F%20team"), { invoke: "mcp.oauthStatus", payload: { name: "docs / team" } });
  assert.deepEqual(resolveIPCRouteForTest("POST", "/api/mcp/oauth", { name: "docs", action: "login" }), { invoke: "mcp.oauth", payload: { name: "docs", action: "login" } });
});

test("OpenAI subscription uses the same login and callback routes for IPC and HTTP", () => {
  assert.deepEqual(resolveIPCRouteForTest("GET", "/api/settings/openai-subscription"), {invoke:"config.openaiSubscriptionStatus",payload:{}});
  for (const action of ["login", "cancel", "logout", "submit"]) {
    const body = {action, ...(action === "submit" ? {value:"callback-url"} : {})};
    assert.deepEqual(resolveIPCRouteForTest("POST", "/api/settings/openai-subscription", body), {invoke:"config.openaiSubscription",payload:body});
  }
});
