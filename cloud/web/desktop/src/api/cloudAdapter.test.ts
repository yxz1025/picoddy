import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import { ApiError } from "./cloudHttp.ts";
import { clearCloudAdapterCaches, requestDesktopApi } from "./cloudAdapter.ts";

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
  clearCloudAdapterCaches();
});

test("Ask and Plan cannot silently run with write-capable tools", async () => {
  const submitted: Record<string, unknown>[] = [];
  globalThis.fetch = async (input, init) => {
    if (String(input).endsWith('/runs')) {
      submitted.push(JSON.parse(String(init?.body)));
      return json({ id: 'run', conversationId: 'conversation' });
    }
    return json([]);
  };
  for (const mode of ["ask", "plan"]) {
    await requestDesktopApi("POST", "/api/prompt", {
      sessionId: "88888888-8888-4888-8888-888888888888", mode, permission: "full", text: "hello",
    });
  }
  assert.deepEqual(submitted.map(body => body.mode), ['ask', 'plan']);
  assert.ok(submitted.every(body => body.permission === 'full' && !Object.hasOwn(body, 'category')), 'server derives category from the owned conversation');
});

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });
}

test('stale composer expert cannot override the persisted conversation binding', async () => {
  let submitted: Record<string, unknown> = {};
  globalThis.fetch = async (input, init) => {
    if (String(input).endsWith('/runs')) {
      submitted = JSON.parse(String(init?.body));
      return json({ id: 'run', conversationId: 'conversation' });
    }
    return json([]);
  };
  await requestDesktopApi('POST', '/api/prompt', {
    sessionId: '88888888-8888-4888-8888-888888888888', text: 'hello', selectedExpertId: 'stale-expert',
  });
  assert.equal(Object.hasOwn(submitted, 'expertId'), false);
});

test('approval confirmation targets the supplied child run instead of the parent conversation run', async () => {
  const childRunId = '11111111-1111-4111-8111-111111111111';
  const approvalId = '22222222-2222-4222-8222-222222222222';
  const requests: Array<{ path: string; method: string; body?: unknown }> = [];
  globalThis.fetch = async (input, init) => {
    requests.push({
      path: String(input),
      method: init?.method ?? 'GET',
      ...(init?.body ? { body: JSON.parse(String(init.body)) } : {}),
    });
    return json({ id: approvalId, status: 'approved' });
  };

  await requestDesktopApi('POST', '/api/confirm', {
    sessionId: '33333333-3333-4333-8333-333333333333',
    runId: childRunId,
    requestId: approvalId,
    approved: true,
  });

  assert.deepEqual(requests, [{
    path: `/api/runs/${childRunId}/approvals/${approvalId}`,
    method: 'POST',
    body: { approved: true },
  }]);
});

test('approval confirmation rejects a malformed explicit run id before any request', async () => {
  let requested = false;
  globalThis.fetch = async () => {
    requested = true;
    return json({});
  };
  await assert.rejects(
    requestDesktopApi('POST', '/api/confirm', {
      sessionId: '33333333-3333-4333-8333-333333333333',
      runId: '../parent',
      requestId: '22222222-2222-4222-8222-222222222222',
      approved: true,
    }),
    (error: unknown) => error instanceof ApiError && error.code === 'INVALID_RUN_ID',
  );
  assert.equal(requested, false);
});

test('custom system instructions are persisted through the authenticated preferences API', async () => {
  let preferences = { agentSystemPrompt: 'before', language: 'zh-CN', fontSize: '14' };
  const writes: unknown[] = [];
  globalThis.fetch = async (input, init) => {
    if (String(input) === '/api/models') return json([]);
    if (String(input) === '/api/preferences') {
      if (init?.method === 'PATCH') {
        const patch = JSON.parse(String(init.body));
        writes.push(patch);
        preferences = { ...preferences, ...patch };
      }
      return json(preferences);
    }
    throw new Error(`Unexpected ${String(input)}`);
  };
  const result = await requestDesktopApi<{agentSystemPrompt:string}>('POST', '/api/settings', { agentSystemPrompt: '  my rules  ' });
  assert.equal(result.agentSystemPrompt, '  my rules  ');
  assert.deepEqual(writes, [{ agentSystemPrompt: '  my rules  ' }]);
});

test('single-file editing cannot discard extra frontmatter metadata', async () => {
  let writes = 0;
  globalThis.fetch = async (input, init) => {
    if (init?.method && init.method !== 'GET') writes += 1;
    if (String(input) === '/api/skills') return json([{ id: 'skill', name: 'reports', version: 'v1', enabled: true }]);
    return json({ version: 'v1', description: 'Reports', body: 'Old', hasExtraFrontmatter: true, files: [{ path: 'SKILL.md' }] });
  };
  await assert.rejects(requestDesktopApi('PUT', '/api/skills/reports', { version: 'v1', body: 'Changed' }),
    (error: unknown) => error instanceof ApiError && error.code === 'SKILL_METADATA_EDIT_UNSAFE');
  assert.equal(writes, 0);
});

test("settings snapshots never delete an omitted cloud model", async () => {
  const calls: Array<{ method: string; path: string }> = [];
  globalThis.fetch = async (input, init) => {
    const path = String(input);
    calls.push({ method: init?.method ?? "GET", path });
    if (path === '/api/preferences') return json({ agentSystemPrompt: '', language: 'zh-CN', fontSize: '14' });
    if (path === "/api/models") {
      return json([{
        id: "11111111-1111-4111-8111-111111111111",
        name: "GPT", provider: "openai", model: "gpt-4o",
        isDefault: true, apiKeyConfigured: true,
      }]);
    }
    throw new Error(`Unexpected request: ${init?.method} ${path}`);
  };

  await assert.rejects(
    requestDesktopApi("POST", "/api/settings", { providers: [] }),
    (error: unknown) =>
      error instanceof ApiError && error.code === "MODEL_DELETE_REQUIRES_EXPLICIT_ACTION",
  );
  assert.equal(calls.some((call) => call.method === "DELETE"), false);
});

test("desktop-only route guards do not capture neighboring API prefixes", async () => {
  const requested: string[] = [];
  globalThis.fetch = async (input) => {
    const path = String(input);
    requested.push(path);
    return json([]);
  };

  await requestDesktopApi("GET", "/api/files");
  await requestDesktopApi("GET", "/api/openapi");

  assert.deepEqual(requested, ["/api/files", "/api/openapi"]);
});

test("connector saves preserve omitted env and headers for the cloud service", async () => {
  const writes: Record<string, unknown>[] = [];
  globalThis.fetch = async (input, init) => {
    const path = String(input);
    if (path === "/api/mcp" && init?.method === "POST") {
      writes.push(JSON.parse(String(init.body)));
      return json({ config: writes[0], availableConfig: writes[0], connected: [] });
    }
    throw new Error(`Unexpected request: ${init?.method} ${path}`);
  };

  await requestDesktopApi("POST", "/api/mcp", {
    mcpServers: { local: { type: "stdio", command: "node", args: ["server.mjs"], envConfigured: true } },
  });
  assert.deepEqual(writes, [{
    mcpServers: {
      local: { type: "stdio", command: "node", args: ["server.mjs"], envConfigured: true },
    },
  }]);
  const local = (writes[0].mcpServers as Record<string, Record<string, unknown>>).local;
  assert.equal(Object.hasOwn(local, "env"), false);
  assert.equal(Object.hasOwn(local, "headers"), false);
});

test("editing a multi-file skill rejects before creating a truncating version", async () => {
  let wroteVersion = false;
  globalThis.fetch = async (input, init) => {
    const path = String(input);
    if (path === "/api/skills" && (init?.method ?? "GET") === "GET") {
      return json([{
        id: "33333333-3333-4333-8333-333333333333",
        name: "reports", description: "", version: "v1", enabled: true,
      }]);
    }
    if (path.endsWith("/content") && (init?.method ?? "GET") === "GET") {
      return json({
        version: "v1", description: "Original", body: "# Original\n",
        files: [{ path: "SKILL.md" }, { path: "scripts/run.py" }],
      });
    }
    if (path.endsWith("/versions") && init?.method === "POST") {
      wroteVersion = true;
      return json({}, 201);
    }
    throw new Error(`Unexpected request: ${init?.method} ${path}`);
  };

  await requestDesktopApi("GET", "/api/skills");
  await assert.rejects(
    requestDesktopApi("PUT", "/api/skills/reports", {
      name: "reports", description: "", body: "# Changed", disabled: false, version: "v1",
    }),
    (error: unknown) =>
      error instanceof ApiError && error.code === "MULTI_FILE_SKILL_EDIT_UNSAFE",
  );
  assert.equal(wroteVersion, false);
});

test("skill listing hydrates the editor body from the current immutable version", async () => {
  globalThis.fetch = async (input, init) => {
    const path = String(input);
    if (path === "/api/skills" && (init?.method ?? "GET") === "GET") {
      return json([{
        id: "33333333-3333-4333-8333-333333333333",
        name: "reports", description: "Stored metadata", version: "v1", enabled: true,
      }]);
    }
    if (path.endsWith("/content") && (init?.method ?? "GET") === "GET") {
      return json({
        version: "v1", description: "Current description", body: "# Real instructions\n",
        files: [{ path: "SKILL.md" }],
      });
    }
    throw new Error(`Unexpected request: ${init?.method} ${path}`);
  };

  const [skill] = await requestDesktopApi<any[]>("GET", "/api/skills");

  assert.equal(skill.description, "Current description");
  assert.equal(skill.body, "# Real instructions\n");
  assert.equal(skill.version, "v1");
});

test("skill description and body edits create one complete immutable version", async () => {
  const skillId = "33333333-3333-4333-8333-333333333333";
  let current = {
    version: "v1", description: "Original", body: "# Original\n",
    files: [{ path: "SKILL.md" }],
  };
  let uploadedMarkdown = "";
  let versionWrites = 0;
  globalThis.fetch = async (input, init) => {
    const path = String(input);
    const method = init?.method ?? "GET";
    if (path === "/api/skills" && method === "GET") {
      return json([{ id: skillId, name: "reports", description: current.description, version: current.version, enabled: true }]);
    }
    if (path === `/api/skills/${skillId}/content` && method === "GET") return json(current);
    if (path === `/api/skills/${skillId}/versions` && method === "POST") {
      versionWrites += 1;
      const request = JSON.parse(String(init?.body));
      uploadedMarkdown = Buffer.from(request.contentBase64, "base64").toString("utf8");
      current = {
        version: "v2", description: "Changed description", body: "# Changed\n",
        files: [{ path: "SKILL.md" }],
      };
      return json({ id: skillId, name: "reports", description: current.description, version: current.version, enabled: true }, 201);
    }
    throw new Error(`Unexpected request: ${method} ${path}`);
  };

  await requestDesktopApi("GET", "/api/skills");
  const result = await requestDesktopApi<any>("PUT", "/api/skills/reports", {
    description: "Changed description", body: "# Changed", disabled: false, version: "v1",
  });

  assert.equal(versionWrites, 1);
  assert.match(uploadedMarkdown, /description: ["']Changed description["']/);
  assert.match(uploadedMarkdown, /\n# Changed\n$/);
  assert.equal(result.description, "Changed description");
  assert.equal(result.body, "# Changed\n");
});

test("skill enablement changes do not create a content version", async () => {
  const skillId = "33333333-3333-4333-8333-333333333333";
  let versionWrites = 0;
  let patches = 0;
  globalThis.fetch = async (input, init) => {
    const path = String(input);
    const method = init?.method ?? "GET";
    if (path === "/api/skills" && method === "GET") {
      return json([{ id: skillId, name: "reports", description: "Original", version: "v1", enabled: true }]);
    }
    if (path === `/api/skills/${skillId}/content` && method === "GET") {
      return json({
        version: "v1", description: "Original", body: "# Original\n",
        files: [{ path: "SKILL.md" }],
      });
    }
    if (path.endsWith("/versions") && method === "POST") {
      versionWrites += 1;
      return json({}, 201);
    }
    if (path === `/api/skills/${skillId}` && method === "PATCH") {
      patches += 1;
      return json({ id: skillId, name: "reports", description: "Original", version: "v1", enabled: false });
    }
    throw new Error(`Unexpected request: ${method} ${path}`);
  };

  await requestDesktopApi("GET", "/api/skills");
  const result = await requestDesktopApi<any>("PUT", "/api/skills/reports", {
    description: "Original", body: "# Original\n", disabled: true, version: "v1",
  });

  assert.equal(versionWrites, 0);
  assert.equal(patches, 1);
  assert.equal(result.disabled, true);
  assert.equal(result.body, "# Original\n");
});

test("skill create and update reject an unsupported independent display name", async () => {
  let wrote = false;
  globalThis.fetch = async (input, init) => {
    const path = String(input);
    const method = init?.method ?? "GET";
    if (path === "/api/skills" && method === "GET") {
      return json([{
        id: "33333333-3333-4333-8333-333333333333",
        name: "reports", description: "Original", version: "v1", enabled: true,
      }]);
    }
    wrote = true;
    throw new Error(`Unexpected request: ${method} ${path}`);
  };

  for (const operation of [
    () => requestDesktopApi("POST", "/api/skills", {
      name: "reports", displayName: "report-builder", description: "Original", body: "# Original",
    }),
    () => requestDesktopApi("PUT", "/api/skills/reports", {
      displayName: "report-builder", description: "Original", body: "# Original", version: "v1",
    }),
  ]) {
    await assert.rejects(
      operation(),
      (error: unknown) =>
        error instanceof ApiError && error.code === "SKILL_DISPLAY_NAME_UNSUPPORTED",
    );
  }
  assert.equal(wrote, false);
});

test("skill editing rejects when the displayed immutable version has become stale", async () => {
  const skillId = "33333333-3333-4333-8333-333333333333";
  let currentVersion = "v1";
  let wrote = false;
  globalThis.fetch = async (input, init) => {
    const path = String(input);
    const method = init?.method ?? "GET";
    if (path === "/api/skills" && method === "GET") {
      return json([{
        id: skillId, name: "reports", description: "Original",
        version: currentVersion, enabled: true,
      }]);
    }
    if (path === `/api/skills/${skillId}/content` && method === "GET") {
      return json({
        version: currentVersion, description: "Original", body: "# Original\n",
        files: [{ path: "SKILL.md" }],
      });
    }
    if (method === "POST" || method === "PATCH") {
      wrote = true;
      return json({});
    }
    throw new Error(`Unexpected request: ${method} ${path}`);
  };

  await requestDesktopApi("GET", "/api/skills");
  currentVersion = "v2";

  await assert.rejects(
    requestDesktopApi("PUT", "/api/skills/reports", {
      description: "Changed", body: "# Changed\n", disabled: false, version: "v1",
    }),
    (error: unknown) =>
      error instanceof ApiError && error.status === 409 && error.code === "VERSION_CONFLICT",
  );
  assert.equal(wrote, false);
});

test("conversation compatibility rows retain the configured default model", async () => {
  globalThis.fetch = async (input) => {
    const path = String(input);
    if (path === "/api/conversations") {
      return json([{
        id: "44444444-4444-4444-8444-444444444444",
        title: "History", workspaceId: null,
        createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z",
      }]);
    }
    if (path === "/api/models") {
      return json([{
        id: "55555555-5555-4555-8555-555555555555",
        name: "Claude", provider: "anthropic", model: "claude-sonnet",
        isDefault: true, apiKeyConfigured: true,
      }]);
    }
    if (path === "/api/runs") return json([]);
    throw new Error(`Unexpected request: ${path}`);
  };

  const [conversation] = await requestDesktopApi<any[]>("GET", "/api/conv");
  assert.equal(conversation.modelProvider, "anthropic");
  assert.equal(conversation.modelId, "55555555-5555-4555-8555-555555555555");
});

test("run selection requires a resource UUID for custom endpoints", async () => {
  let createdRun: any = null;
  globalThis.fetch = async (input, init) => {
    const path = String(input);
    if (path === "/api/skills" || path === "/api/connectors") return json([]);
    if (path === "/api/models") {
      return json([
        {
          id: "66666666-6666-4666-8666-666666666666",
          name: "Public", provider: "openai", model: "gpt-compatible",
          baseUrl: "https://one.example/v1", apiKeyConfigured: true,
        },
        {
          id: "77777777-7777-4777-8777-777777777777",
          name: "Private", provider: "openai", model: "gpt-compatible",
          baseUrl: "https://two.example/v1", apiKeyConfigured: true,
        },
      ]);
    }
    if (path.includes("/runs") && init?.method === "POST") {
      createdRun = JSON.parse(String(init.body));
      return json({
        id: "99999999-9999-4999-8999-999999999999",
        conversationId: "88888888-8888-4888-8888-888888888888",
      });
    }
    throw new Error(`Unexpected request: ${init?.method} ${path}`);
  };

  await assert.rejects(
    requestDesktopApi("POST", "/api/prompt", {
      sessionId: "88888888-8888-4888-8888-888888888888",
      text: "hello",
      mode: "craft",
      permission: "full",
      modelProvider: "openai",
      modelId: "gpt-compatible",
      selectedSkillNames: [],
      preferredConnectors: [],
      attachmentIds: [],
    }),
    (error: unknown) =>
      error instanceof ApiError && error.code === "MODEL_NOT_FOUND",
  );
  assert.equal(createdRun, null);

  await requestDesktopApi("POST", "/api/prompt", {
    sessionId: "88888888-8888-4888-8888-888888888888",
    text: "hello",
    mode: "craft",
    permission: "full",
    modelProvider: "openai",
    modelId: "77777777-7777-4777-8777-777777777777",
    selectedSkillNames: [],
    preferredConnectors: [],
    attachmentIds: [],
  });
  assert.ok(createdRun);
  assert.equal((createdRun as Record<string, unknown>).modelId, "77777777-7777-4777-8777-777777777777");
});

test("run selection keeps duplicate preset model IDs fail-closed", async () => {
  let createdRun = false;
  globalThis.fetch = async (input, init) => {
    const path = String(input);
    if (path === "/api/skills" || path === "/api/connectors") return json([]);
    if (path === "/api/models") {
      return json([
        {
          id: "66666666-6666-4666-8666-666666666666",
          name: "Official one", provider: "openai", model: "gpt-compatible",
          apiKeyConfigured: true,
        },
        {
          id: "77777777-7777-4777-8777-777777777777",
          name: "Official two", provider: "openai", model: "gpt-compatible",
          apiKeyConfigured: true,
        },
      ]);
    }
    if (path.includes("/runs") && init?.method === "POST") {
      createdRun = true;
      return json({});
    }
    throw new Error(`Unexpected request: ${init?.method} ${path}`);
  };

  await assert.rejects(
    requestDesktopApi("POST", "/api/prompt", {
      sessionId: "88888888-8888-4888-8888-888888888888",
      text: "hello",
      mode: "craft",
      permission: "full",
      modelProvider: "openai",
      modelId: "gpt-compatible",
      selectedSkillNames: [],
      preferredConnectors: [],
      attachmentIds: [],
    }),
    (error: unknown) =>
      error instanceof ApiError && error.code === "MODEL_SELECTION_AMBIGUOUS",
  );
  assert.equal(createdRun, false);
});
