import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { afterEach, test } from "node:test";

import { ApiError } from "../web/desktop/src/api/cloudHttp.ts";
import {
  clearCloudAdapterCaches,
  requestDesktopApi,
} from "../web/desktop/src/api/cloudAdapter.ts";
import { useStore } from "../web/desktop/src/store/useStore.ts";

const OFFICIAL_ID = "11111111-1111-4111-8111-111111111111";
const CUSTOM_ID = "22222222-2222-4222-8222-222222222222";
const SECOND_ID = "33333333-3333-4333-8333-333333333333";
const originalFetch = globalThis.fetch;

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify({ data: value }), {
    status,
    headers: { "content-type": "application/json" },
  });
}

afterEach(() => {
  globalThis.fetch = originalFetch;
  clearCloudAdapterCaches();
});

test("preset provider cards exclude models belonging to custom endpoints", async () => {
  globalThis.fetch = async (input) => {
    const path = String(input);
    if (path === "/api/preferences") {
      return json({ agentSystemPrompt: "", language: "zh-CN", fontSize: "14" });
    }
    if (path === "/api/models") {
      return json([
        {
          id: OFFICIAL_ID,
          name: "OpenAI official",
          provider: "openai",
          model: "gpt-shared",
          apiKeyConfigured: true,
        },
        {
          id: CUSTOM_ID,
          name: "Gateway A",
          provider: "openai",
          model: "gpt-shared",
          baseUrl: "https://gateway-a.example.test/v1",
          apiKeyConfigured: true,
        },
        {
          id: SECOND_ID,
          name: "Gateway B",
          provider: "openai",
          model: "gpt-shared",
          baseUrl: "https://gateway-b.example.test/v1",
          apiKeyConfigured: true,
        },
      ]);
    }
    throw new Error(`Unexpected request: ${path}`);
  };

  const settings = await requestDesktopApi<any>("GET", "/api/settings");
  const openai = settings.providers.find((provider: any) => provider.id === "openai");
  assert.deepEqual(openai.models.map((model: any) => model.resourceId), [OFFICIAL_ID]);
  assert.deepEqual(
    settings.customProviders.map((provider: any) => ({
      id: provider.id,
      provider: provider.provider,
      baseUrl: provider.baseUrl,
    })),
    [
      { id: CUSTOM_ID, provider: "openai", baseUrl: "https://gateway-a.example.test/v1" },
      { id: SECOND_ID, provider: "openai", baseUrl: "https://gateway-b.example.test/v1" },
    ],
  );
});

test("first preset model save creates the model and key together without a placeholder", async () => {
  const writes: Array<{ method: string; path: string; body: any }> = [];
  globalThis.fetch = async (input, init) => {
    const path = String(input);
    const method = init?.method ?? "GET";
    if (path === "/api/models" && method === "GET") return json([]);
    if (path === "/api/models" && method === "POST") {
      const body = JSON.parse(String(init?.body));
      writes.push({ method, path, body });
      return json({ id: OFFICIAL_ID, ...body }, 201);
    }
    throw new Error(`Unexpected request: ${method} ${path}`);
  };

  await requestDesktopApi("POST", "/api/settings/keys", {
    provider: "openai",
    key: "sk-first",
    modelId: "gpt-4.1",
    modelName: "GPT 4.1",
  });

  assert.deepEqual(writes, [{
    method: "POST",
    path: "/api/models",
    body: {
      name: "GPT 4.1",
      provider: "openai",
      model: "gpt-4.1",
      apiKey: "sk-first",
    },
  }]);
});

test("preset key updates are fenced to the selected non-custom model resource", async () => {
  const writes: Array<{ path: string; body: any }> = [];
  globalThis.fetch = async (input, init) => {
    const path = String(input);
    if (path === "/api/models" && (init?.method ?? "GET") === "GET") {
      return json([
        { id: OFFICIAL_ID, name: "Official", provider: "openai", model: "gpt-shared", apiKeyConfigured: true },
        {
          id: CUSTOM_ID,
          name: "Custom",
          provider: "openai",
          model: "gpt-shared",
          baseUrl: "https://gateway.example.test/v1",
          apiKeyConfigured: true,
        },
      ]);
    }
    if (path === `/api/models/${OFFICIAL_ID}` && init?.method === "PATCH") {
      writes.push({ path, body: JSON.parse(String(init.body)) });
      return json({ id: OFFICIAL_ID });
    }
    throw new Error(`Unexpected request: ${init?.method} ${path}`);
  };

  await requestDesktopApi("POST", "/api/settings/keys", {
    provider: "openai",
    key: "sk-replacement",
    modelId: "gpt-shared",
    resourceId: OFFICIAL_ID,
  });
  assert.deepEqual(writes, [{
    path: `/api/models/${OFFICIAL_ID}`,
    body: { apiKey: "sk-replacement" },
  }]);
});

test("ambiguous preset model identity fails closed before credentials are written", async () => {
  let wrote = false;
  globalThis.fetch = async (_input, init) => {
    if (init?.method === "PATCH" || init?.method === "POST") wrote = true;
    return json([
      { id: OFFICIAL_ID, name: "One", provider: "openai", model: "gpt-duplicate", apiKeyConfigured: true },
      { id: SECOND_ID, name: "Two", provider: "openai", model: "gpt-duplicate", apiKeyConfigured: true },
    ]);
  };

  await assert.rejects(
    requestDesktopApi("POST", "/api/settings/keys", {
      provider: "openai",
      key: "sk-must-not-write",
      modelId: "gpt-duplicate",
    }),
    (error: unknown) => error instanceof ApiError && error.code === "MODEL_SELECTION_AMBIGUOUS",
  );
  assert.equal(wrote, false);
});

test("custom resource UUID resolves to its provider for catalog and connection diagnostics", async () => {
  const forwarded: Array<{ path: string; body: any }> = [];
  globalThis.fetch = async (input, init) => {
    const path = String(input);
    if (path === "/api/models") {
      return json([{
        id: CUSTOM_ID,
        name: "Private gateway",
        provider: "openai",
        model: "private-model",
        baseUrl: "https://gateway.example.test/v1",
        apiKeyConfigured: true,
      }]);
    }
    if (path === "/api/providers/openai/models" || path === "/api/settings/test-connection") {
      forwarded.push({ path, body: JSON.parse(String(init?.body)) });
      return json(path.includes("test-connection")
        ? { ok: true, latencyMs: 12 }
        : { ok: true, models: [{ id: "private-model", name: "Private model" }] });
    }
    throw new Error(`Unexpected request: ${init?.method} ${path}`);
  };

  await requestDesktopApi("POST", `/api/providers/${CUSTOM_ID}/models`, {
    resourceId: CUSTOM_ID,
    baseUrl: "https://gateway.example.test/v1",
  });
  await requestDesktopApi("POST", "/api/settings/test-connection", {
    provider: CUSTOM_ID,
    resourceId: CUSTOM_ID,
    baseUrl: "https://gateway.example.test/v1",
  });

  assert.deepEqual(forwarded, [
    {
      path: "/api/providers/openai/models",
      body: { resourceId: CUSTOM_ID },
    },
    {
      path: "/api/settings/test-connection",
      body: { provider: "openai", resourceId: CUSTOM_ID, modelId: "private-model" },
    },
  ]);
});

test("a stored custom key cannot be redirected to a changed endpoint", async () => {
  let diagnosed = false;
  globalThis.fetch = async (input) => {
    if (String(input) === "/api/models") {
      return json([{
        id: CUSTOM_ID,
        name: "Private gateway",
        provider: "openai",
        model: "private-model",
        baseUrl: "https://gateway.example.test/v1",
        apiKeyConfigured: true,
      }]);
    }
    diagnosed = true;
    return json({ ok: true });
  };

  await assert.rejects(
    requestDesktopApi("POST", "/api/settings/test-connection", {
      provider: CUSTOM_ID,
      resourceId: CUSTOM_ID,
      baseUrl: "https://attacker.example.test/v1",
    }),
    (error: unknown) => error instanceof ApiError && error.code === "MODEL_ENDPOINT_MISMATCH",
  );
  assert.equal(diagnosed, false);
});

test("a custom model remains selectable as default by resource identity", async () => {
  const patches: Array<{ path: string; body: any }> = [];
  const models = [
    {
      id: OFFICIAL_ID,
      name: "Official",
      provider: "openai",
      model: "gpt-official",
      isDefault: true,
      apiKeyConfigured: true,
    },
    {
      id: CUSTOM_ID,
      name: "Private",
      provider: "openai",
      model: "private-model",
      baseUrl: "https://gateway.example.test/v1",
      isDefault: false,
      apiKeyConfigured: true,
    },
  ];
  globalThis.fetch = async (input, init) => {
    const path = String(input);
    if (path === "/api/preferences") {
      return json({ agentSystemPrompt: "", language: "zh-CN", fontSize: "14" });
    }
    if (path === "/api/models" && (init?.method ?? "GET") === "GET") return json(models);
    if (path === `/api/models/${CUSTOM_ID}` && init?.method === "PATCH") {
      const body = JSON.parse(String(init.body));
      patches.push({ path, body });
      models[0].isDefault = false;
      models[1].isDefault = true;
      return json({ ...models[1] });
    }
    throw new Error(`Unexpected request: ${init?.method} ${path}`);
  };

  const settings = await requestDesktopApi<any>("GET", "/api/settings");
  assert.equal(settings.defaultModelResourceId, OFFICIAL_ID);
  const updated = await requestDesktopApi<any>("POST", "/api/settings", {
    ...settings,
    defaultProvider: "openai",
    defaultModelId: "private-model",
    defaultModelResourceId: CUSTOM_ID,
  });

  assert.deepEqual(patches, [{
    path: `/api/models/${CUSTOM_ID}`,
    body: { isDefault: true },
  }]);
  assert.equal(updated.defaultModelResourceId, CUSTOM_ID);
});

test("custom models sharing an endpoint remain separate credential resources", async () => {
  globalThis.fetch = async (input) => {
    const path = String(input);
    if (path === "/api/preferences") {
      return json({ agentSystemPrompt: "", language: "zh-CN", fontSize: "14" });
    }
    if (path === "/api/models") {
      return json([
        {
          id: CUSTOM_ID,
          name: "Private A",
          provider: "openai",
          model: "private-a",
          baseUrl: "https://gateway.example.test/v1",
          apiKeyConfigured: true,
        },
        {
          id: SECOND_ID,
          name: "Private B",
          provider: "openai",
          model: "private-b",
          baseUrl: "https://gateway.example.test/v1",
          apiKeyConfigured: true,
        },
      ]);
    }
    throw new Error(`Unexpected request: ${path}`);
  };

  const settings = await requestDesktopApi<any>("GET", "/api/settings");
  assert.deepEqual(
    settings.customProviders.map((provider: any) => ({ id: provider.id, models: provider.models })),
    [
      { id: CUSTOM_ID, models: ["private-a"] },
      { id: SECOND_ID, models: ["private-b"] },
    ],
  );
});

test("custom model resource identity survives conversation initialization and prompt creation", async () => {
  const runWrites: any[] = [];
  globalThis.fetch = async (input, init) => {
    const path = String(input);
    const method = init?.method ?? "GET";
    if (path === "/api/conversations" && method === "GET") {
      return json([{
        id: "conversation-1",
        title: "Custom model",
        category: "assistant",
        createdAt: "2026-10-13T00:00:00.000Z",
        updatedAt: "2026-10-13T00:00:00.000Z",
      }]);
    }
    if (path === "/api/models" && method === "GET") {
      return json([{
        id: CUSTOM_ID,
        name: "Private gateway",
        provider: "openai",
        model: "private-model",
        baseUrl: "https://gateway.example.test/v1",
        isDefault: true,
        apiKeyConfigured: true,
      }]);
    }
    if (path === "/api/runs" && method === "GET") return json([]);
    if (path === "/api/skills" && method === "GET") return json([]);
    if (path === "/api/connectors" && method === "GET") return json([]);
    if (path === "/api/conversations/conversation-1/runs" && method === "POST") {
      const body = JSON.parse(String(init?.body));
      runWrites.push(body);
      return json({ id: "run-1", conversationId: "conversation-1", status: "queued" }, 201);
    }
    throw new Error(`Unexpected request: ${method} ${path}`);
  };

  const conversations = await requestDesktopApi<any[]>("GET", "/api/conv");
  assert.equal(conversations[0].modelProvider, "openai");
  assert.equal(conversations[0].modelId, CUSTOM_ID);

  await requestDesktopApi("POST", "/api/prompt", {
    sessionId: "conversation-1",
    text: "hello",
    modelProvider: conversations[0].modelProvider,
    modelId: conversations[0].modelId,
  });
  assert.equal(runWrites.length, 1);
  assert.equal(runWrites[0].modelId, CUSTOM_ID);
});

test("built-in model selection ignores a custom endpoint with the same model name", async () => {
  let createdRun: any;
  globalThis.fetch = async (input, init) => {
    const path = String(input);
    const method = init?.method ?? "GET";
    if (path === "/api/skills" || path === "/api/connectors") return json([]);
    if (path === "/api/models") {
      return json([
        {
          id: OFFICIAL_ID,
          name: "Official",
          provider: "openai",
          model: "gpt-shared",
          apiKeyConfigured: true,
        },
        {
          id: CUSTOM_ID,
          name: "Private",
          provider: "openai",
          model: "gpt-shared",
          baseUrl: "https://gateway.example.test/v1",
          apiKeyConfigured: true,
        },
      ]);
    }
    if (path === "/api/conversations/conversation-1/runs" && method === "POST") {
      createdRun = JSON.parse(String(init?.body));
      return json({ id: "run-1", conversationId: "conversation-1", status: "queued" }, 201);
    }
    throw new Error(`Unexpected request: ${method} ${path}`);
  };

  await requestDesktopApi("POST", "/api/prompt", {
    sessionId: "conversation-1",
    text: "hello",
    modelProvider: "openai",
    modelId: "gpt-shared",
  });
  assert.equal(createdRun.modelId, OFFICIAL_ID);
});

test("settings bootstrap uses the custom default resource UUID in the composer", async () => {
  const originalState = useStore.getState();
  const originalDocument = globalThis.document;
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: { documentElement: { style: { setProperty() {} } } },
  });
  globalThis.fetch = async (input) => {
    const path = String(input);
    if (path === "/api/preferences") {
      return json({ agentSystemPrompt: "", language: "zh-CN", fontSize: "14" });
    }
    if (path === "/api/models") {
      return json([{
        id: CUSTOM_ID,
        name: "Private gateway",
        provider: "openai",
        model: "private-model",
        baseUrl: "https://gateway.example.test/v1",
        isDefault: true,
        apiKeyConfigured: true,
      }]);
    }
    throw new Error(`Unexpected request: ${path}`);
  };
  try {
    useStore.setState({ currentConvId: null, modelProvider: "", modelId: "" });
    await useStore.getState().loadSettings();
    assert.equal(useStore.getState().modelProvider, "openai");
    assert.equal(useStore.getState().modelId, CUSTOM_ID);
  } finally {
    useStore.setState(originalState, true);
    if (originalDocument === undefined) delete (globalThis as any).document;
    else Object.defineProperty(globalThis, "document", { configurable: true, value: originalDocument });
  }
});

test("custom edit patches one resource and preserves its saved key when endpoint is unchanged", async () => {
  const writes: Array<{ method: string; path: string; body?: any }> = [];
  globalThis.fetch = async (input, init) => {
    const path = String(input);
    const method = init?.method ?? "GET";
    if (path === "/api/models" && method === "GET") {
      return json([{
        id: CUSTOM_ID,
        name: "Before",
        provider: "openai",
        model: "private-before",
        baseUrl: "https://gateway.example.test/v1",
        apiKeyConfigured: true,
      }]);
    }
    if (path === `/api/models/${CUSTOM_ID}` && method === "PATCH") {
      const body = JSON.parse(String(init?.body));
      writes.push({ method, path, body });
      return json({ id: CUSTOM_ID, ...body, apiKeyConfigured: true });
    }
    writes.push({ method, path, ...(init?.body ? { body: JSON.parse(String(init.body)) } : {}) });
    throw new Error(`Unexpected request: ${method} ${path}`);
  };

  await requestDesktopApi("POST", "/api/settings/custom-providers", {
    id: CUSTOM_ID,
    name: "After",
    baseUrl: "https://gateway.example.test/v1",
    apiKey: "",
    models: "private-after",
  });

  assert.deepEqual(writes, [{
    method: "PATCH",
    path: `/api/models/${CUSTOM_ID}`,
    body: {
      name: "After",
      provider: "openai",
      model: "private-after",
      baseUrl: "https://gateway.example.test/v1",
    },
  }]);
});

test("custom edit requires a new key before changing the saved endpoint", async () => {
  let wrote = false;
  globalThis.fetch = async (_input, init) => {
    if (init?.method === "PATCH" || init?.method === "POST" || init?.method === "DELETE") wrote = true;
    return json([{
      id: CUSTOM_ID,
      name: "Private",
      provider: "openai",
      model: "private-model",
      baseUrl: "https://gateway.example.test/v1",
      apiKeyConfigured: true,
    }]);
  };

  await assert.rejects(
    requestDesktopApi("POST", "/api/settings/custom-providers", {
      id: CUSTOM_ID,
      name: "Moved",
      baseUrl: "https://other.example.test/v1",
      apiKey: "",
      models: "private-model",
    }),
    (error: unknown) => error instanceof ApiError && error.code === "MODEL_API_KEY_REQUIRED",
  );
  assert.equal(wrote, false);
});

test("custom delete removes only the selected resource", async () => {
  const deletes: string[] = [];
  globalThis.fetch = async (input, init) => {
    const path = String(input);
    if (path === "/api/models") {
      return json([
        {
          id: CUSTOM_ID,
          name: "Private A",
          provider: "openai",
          model: "private-a",
          baseUrl: "https://gateway.example.test/v1",
        },
        {
          id: SECOND_ID,
          name: "Private B",
          provider: "openai",
          model: "private-b",
          baseUrl: "https://gateway.example.test/v1",
        },
      ]);
    }
    if (init?.method === "DELETE") {
      deletes.push(path);
      return new Response(null, { status: 204 });
    }
    throw new Error(`Unexpected request: ${init?.method} ${path}`);
  };

  await requestDesktopApi("DELETE", `/api/settings/custom-providers/${CUSTOM_ID}`);
  assert.deepEqual(deletes, [`/api/models/${CUSTOM_ID}`]);
});

test("first model save adopts the refreshed default only for an empty selected conversation", async () => {
  const originalState = useStore.getState();
  const originalDocument = globalThis.document;
  let models: any[] = [];
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: { documentElement: { style: { setProperty() {} } } },
  });
  globalThis.fetch = async (input, init) => {
    const path = String(input);
    const method = init?.method ?? "GET";
    if (path === "/api/preferences") {
      return json({ agentSystemPrompt: "", language: "zh-CN", fontSize: "14" });
    }
    if (path === "/api/models" && method === "GET") return json(models);
    if (path === "/api/models" && method === "POST") {
      const body = JSON.parse(String(init?.body));
      const created = {
        id: OFFICIAL_ID,
        ...body,
        isDefault: false,
        apiKeyConfigured: true,
        createdAt: "2026-10-13T00:00:00.000Z",
      };
      models = [created];
      return json(created, 201);
    }
    throw new Error(`Unexpected request: ${method} ${path}`);
  };
  try {
    useStore.setState({
      currentConvId: "empty-conversation",
      modelProvider: "",
      modelId: "",
      conversations: [{
        id: "empty-conversation",
        title: "Empty",
        category: "assistant",
        status: "idle",
        modelProvider: "",
        modelId: "",
        createdAt: 0,
        updatedAt: 0,
      }],
    });
    await useStore.getState().saveApiKey("openai", "sk-first", {
      modelId: "gpt-4.1",
      modelName: "GPT 4.1",
    });
    assert.equal(useStore.getState().modelProvider, "openai");
    assert.equal(useStore.getState().modelId, OFFICIAL_ID);
    assert.equal(useStore.getState().conversations[0].modelId, OFFICIAL_ID);
  } finally {
    useStore.setState(originalState, true);
    if (originalDocument === undefined) delete (globalThis as any).document;
    else Object.defineProperty(globalThis, "document", { configurable: true, value: originalDocument });
  }
});

test("model save does not overwrite an explicit selected conversation model", async () => {
  const originalState = useStore.getState();
  const originalDocument = globalThis.document;
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: { documentElement: { style: { setProperty() {} } } },
  });
  const models = [{
    id: OFFICIAL_ID,
    name: "GPT 4.1",
    provider: "openai",
    model: "gpt-4.1",
    isDefault: true,
    apiKeyConfigured: true,
  }];
  globalThis.fetch = async (input, init) => {
    const path = String(input);
    if (path === "/api/preferences") {
      return json({ agentSystemPrompt: "", language: "zh-CN", fontSize: "14" });
    }
    if (path === "/api/models") return json(models);
    if (path === `/api/models/${OFFICIAL_ID}` && init?.method === "PATCH") {
      return json(models[0]);
    }
    throw new Error(`Unexpected request: ${init?.method} ${path}`);
  };
  try {
    useStore.setState({
      currentConvId: "configured-conversation",
      modelProvider: "anthropic",
      modelId: "claude-explicit",
      conversations: [{
        id: "configured-conversation",
        title: "Configured",
        category: "assistant",
        status: "idle",
        modelProvider: "anthropic",
        modelId: "claude-explicit",
        createdAt: 0,
        updatedAt: 0,
      }],
    });
    await useStore.getState().saveApiKey("openai", "sk-update", {
      modelId: "gpt-4.1",
      resourceId: OFFICIAL_ID,
    });
    assert.equal(useStore.getState().modelProvider, "anthropic");
    assert.equal(useStore.getState().modelId, "claude-explicit");
  } finally {
    useStore.setState(originalState, true);
    if (originalDocument === undefined) delete (globalThis as any).document;
    else Object.defineProperty(globalThis, "document", { configurable: true, value: originalDocument });
  }
});

test("model settings UI is API-key only and does not offer unsupported key-only deletion", () => {
  const modal = readFileSync(
    new URL("../web/desktop/src/components/SettingsModal.tsx", import.meta.url),
    "utf8",
  );
  const store = readFileSync(
    new URL("../web/desktop/src/store/useStore.ts", import.meta.url),
    "utf8",
  );
  const composer = readFileSync(
    new URL("../web/desktop/src/components/Composer.tsx", import.meta.url),
    "utf8",
  );

  assert.doesNotMatch(modal, /OpenAISubscriptionControls|openaiSubscription|subscriptionMode|oauth/);
  assert.doesNotMatch(modal, /ChatGPT|订阅/);
  assert.doesNotMatch(modal, /deleteApiKey\(provider\.id\)/);
  assert.doesNotMatch(modal, /deleteModelFromProvider/);
  assert.doesNotMatch(modal, /latencyMs\s*\|\|\s*0/);
  assert.match(modal, /resourceId:\s*configuredModel\?\.resourceId/);
  assert.match(modal, /saveApiKey\(provider\.id,\s*val,/);
  assert.match(store, /resourceId\?:\s*string/);
  assert.match(modal, /defaultModelResourceId/);
  assert.match(modal, /useStore\.getState\(\)\.settings\.providers/);
  assert.match(modal, /freshModel\s*\?\s*modelSelectionValue\(freshModel\)/);
  assert.match(composer, /settings\.customProviders/);
  assert.match(composer, /id:\s*custom\.id/);
  assert.match(composer, /id:\s*m\.resourceId\s*\|\|\s*m\.id/);
});
