import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { afterEach, test } from "node:test";

import { ApiError } from "../web/desktop/src/api/cloudHttp.ts";
import { requestDesktopApi } from "../web/desktop/src/api/cloudAdapter.ts";

const originalFetch = globalThis.fetch;

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify({ data: value }), {
    status,
    headers: { "content-type": "application/json" },
  });
}

afterEach(() => {
  globalThis.fetch = originalFetch;
});

test("SkillHub uses server-managed auth and forwards catalog reads", async () => {
  const calls: Array<{ method: string; path: string }> = [];
  const skill = {
    id: 1,
    slug: "weekly-report",
    displayName: "周报助手",
    summary: "生成结构化周报",
    status: "ACTIVE",
    downloadCount: 8,
    namespace: "office",
    updatedAt: "2026-10-13T00:00:00.000Z",
    headlineVersion: { id: 2, version: "1.0.0", status: "PUBLISHED" },
    publishedVersion: { id: 2, version: "1.0.0", status: "PUBLISHED" },
  };
  globalThis.fetch = async (input, init) => {
    const path = String(input);
    const method = init?.method ?? "GET";
    calls.push({ method, path });
    if (path === "/api/skillhub/auth/ensure") return json({ authenticated: true });
    if (path === "/api/skillhub/auth/config") {
      return json({ configured: true, source: "server-managed", error: null });
    }
    if (path === "/api/skillhub/skills") return json([skill]);
    if (path === "/api/skillhub/experts") return json([{ ...skill, slug: "retail-expert" }]);
    if (path === "/api/skillhub/namespaces") {
      return json([{ id: 1, slug: "office", displayName: "办公", status: "ACTIVE" }]);
    }
    if (path === "/api/skillhub/experts/office/retail-expert") {
      return json({ ...skill, slug: "retail-expert", ownerDisplayName: "PICODDY" });
    }
    throw new Error(`Unexpected request: ${method} ${path}`);
  };

  assert.deepEqual(
    await requestDesktopApi("POST", "/api/skillhub/auth/ensure", {}),
    { authenticated: true },
  );
  assert.deepEqual(
    await requestDesktopApi("GET", "/api/skillhub/auth/config"),
    { configured: true, source: "server-managed", error: null },
  );
  assert.deepEqual(await requestDesktopApi("GET", "/api/skillhub/skills"), [skill]);
  assert.equal((await requestDesktopApi<any[]>("GET", "/api/skillhub/experts"))[0].slug, "retail-expert");
  assert.equal((await requestDesktopApi<any[]>("GET", "/api/skillhub/namespaces"))[0].slug, "office");
  assert.equal(
    (await requestDesktopApi<any>("GET", "/api/skillhub/experts/office/retail-expert")).ownerDisplayName,
    "PICODDY",
  );
  assert.deepEqual(calls.map((call) => call.path), [
    "/api/skillhub/auth/ensure",
    "/api/skillhub/auth/config",
    "/api/skillhub/skills",
    "/api/skillhub/experts",
    "/api/skillhub/namespaces",
    "/api/skillhub/experts/office/retail-expert",
  ]);
});

test("SkillHub installs are converted to desktop skill and expert shapes", async () => {
  const writes: Array<{ path: string; body: unknown }> = [];
  globalThis.fetch = async (input, init) => {
    const path = String(input);
    const body = JSON.parse(String(init?.body));
    writes.push({ path, body });
    if (path === "/api/skillhub/install") {
      return json({
        id: "10000000-0000-4000-8000-000000000001",
        name: "weekly-report",
        description: "生成结构化周报",
        enabled: true,
        version: "1.0.0",
      }, 201);
    }
    if (path === "/api/skillhub/experts/install") {
      return json({
        id: "20000000-0000-4000-8000-000000000002",
        name: "零售分析专家",
        expertType: "agent",
        nickname: "零售分析",
        categoryId: "retail",
        description: "分析零售经营数据",
        icon: "🛍️",
        tags: ["零售"],
        quickPrompts: ["分析本周销售"],
        catalogSource: "installed",
        revision: "sha256:expert-revision",
        available: true,
      }, 201);
    }
    throw new Error(`Unexpected request: ${path}`);
  };

  const installedSkill = await requestDesktopApi<any>("POST", "/api/skillhub/install", {
    namespace: "office", slug: "weekly-report", version: "1.0.0",
  });
  assert.deepEqual(installedSkill, {
    id: "10000000-0000-4000-8000-000000000001",
    name: "weekly-report",
    displayName: "weekly-report",
    description: "生成结构化周报",
    body: "",
    disabled: false,
    builtin: false,
    path: "",
    version: "1.0.0",
  });

  const installedExpert = await requestDesktopApi<any>(
    "POST", "/api/skillhub/experts/install",
    { namespace: "retail", slug: "analyst", version: "2.0.0" },
  );
  assert.deepEqual(installedExpert, {
    id: "20000000-0000-4000-8000-000000000002",
    name: "零售分析专家",
    expertType: "agent",
    nickname: "零售分析",
    categoryId: "retail",
    description: "分析零售经营数据",
    icon: "🛍️",
    tags: ["零售"],
    quickPrompts: ["分析本周销售"],
    catalogSource: "installed",
    revision: "sha256:expert-revision",
    available: true,
  });
  assert.deepEqual(writes, [
    {
      path: "/api/skillhub/install",
      body: { namespace: "office", slug: "weekly-report", version: "1.0.0" },
    },
    {
      path: "/api/skillhub/experts/install",
      body: { namespace: "retail", slug: "analyst", version: "2.0.0" },
    },
  ]);
});

test("browser UI has no manual SkillHub secret control and config writes fail closed", async () => {
  const panel = readFileSync(
    new URL("../web/desktop/src/components/ExpertPanel.tsx", import.meta.url),
    "utf8",
  );
  const adapter = readFileSync(
    new URL("../web/desktop/src/api/cloudAdapter.ts", import.meta.url),
    "utf8",
  );
  assert.doesNotMatch(panel, /SkillHubAuthConfig|共享密钥|配置技能市场/);
  assert.doesNotMatch(adapter, /\["\/api\/skillhub"/);

  let requested = false;
  globalThis.fetch = async () => {
    requested = true;
    return json({});
  };
  await assert.rejects(
    requestDesktopApi("POST", "/api/skillhub/auth/config", { secret: "must-not-send" }),
    (error: unknown) => error instanceof ApiError && error.code === "SKILLHUB_AUTH_SERVER_MANAGED",
  );
  assert.equal(requested, false);
});
