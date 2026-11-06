# pi-agent-core Harness 与上下文压缩接入 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将主会话迁移到 `pi-agent-core` 原生 AgentHarness、JSONL Session 和 compaction，同时保持现有 HTTP/SSE、SQLite 投影、权限、自动化、子代理及 Windows/macOS 行为兼容。

**Architecture:** 新增 `CoreSessionManager` 管理 core JSONL Session，并让 `LocalPiProvider` 使用 `AgentHarness` 代替基础 `Agent`。core JSONL 成为完整模型上下文真源，现有 SQLite 继续承载 UI 投影和业务元数据；自动压缩只组合 core 的 `estimateContextTokens`、`shouldCompact` 与 `harness.compact()`。

**Tech Stack:** Deno TypeScript、`@earendil-works/pi-agent-core@0.80.3`、`@earendil-works/pi-ai@0.80.3`、node:sqlite、Deno test、Deno Desktop。

---

## File Structure

- Create `src/agent/core_session.ts`: core JSONL repo、旧历史导入、路径校验、上下文用量和删除。
- Create `src/agent/core_session_test.ts`: JSONL 新建/重开/迁移/损坏/跨平台路径测试。
- Create `src/agent/compaction.ts`: 仅组合 core compaction 判定和 Harness 调用。
- Create `src/agent/compaction_test.ts`: 阈值、前置失败和后置失败策略测试。
- Create `src/agent/harness_factory_test.ts`: Harness 事件、权限 hook、动态系统提示测试。
- Create `src/agent/provider_harness_test.ts`: Provider 会话复用、工具切换、压缩和重启恢复测试。
- Create `src/domains/memory/node/store_test.ts`: working memory 会话隔离和兼容数据测试。
- Modify `src/infra/db.ts`: 增加 `core_session_path` 和 `memories.session_id`。
- Modify `src/domains/session/node/store.ts`: core session path 读写和删除顺序所需 API。
- Modify `src/domains/memory/node/store.ts`: working memory 按 session 读写/清理。
- Modify `src/agent/tools/memory.ts`: 从 `sessionContext` 绑定 working memory。
- Modify `src/agent/engine.ts`: 提取动态提示构建并创建 AgentHarness。
- Modify `src/agent/provider.ts`: 从基础 Agent 迁移到 Harness，接入 Session 与压缩。
- Modify `src/agent/models.ts`: 让 Harness 的 Models auth 保持 Keychain 兼容。
- Modify `application.ts`: 删除会话时先清理 core Session，再清理 SQLite。
- Modify `src/agent/history.ts`: 输出可直接导入 core Session 的历史消息。

### Task 1: 保持 Harness 模型认证兼容

**Files:**
- Modify: `src/agent/models.ts`
- Create: `src/agent/models_auth_test.ts`

- [ ] **Step 1: 写失败测试，证明注册 Provider 的 auth 优先读取现有 Keychain resolver**

在 `models_auth_test.ts` 中用可注入 resolver 构造 auth 包装器：

```ts
import { assertEquals } from "jsr:@std/assert";
import { withApiKeyResolver } from "./models.ts";

Deno.test("withApiKeyResolver lets Models auth read the existing keychain", async () => {
  let originalCalls = 0;
  const provider = {
    id: "deepseek",
    auth: {
      apiKey: {
        name: "DeepSeek API key",
        resolve: async () => {
          originalCalls++;
          return undefined;
        },
      },
    },
  } as any;

  const wrapped = withApiKeyResolver(provider, async () => "secret-from-keychain");
  const result = await wrapped.auth.apiKey.resolve({} as any);

  assertEquals(result.auth.apiKey, "secret-from-keychain");
  assertEquals(originalCalls, 0);
});

Deno.test("withApiKeyResolver preserves original provider auth fallback", async () => {
  const provider = {
    id: "ollama",
    auth: {
      apiKey: {
        name: "Ollama",
        resolve: async () => ({ auth: { apiKey: "ollama" } }),
      },
    },
  } as any;

  const wrapped = withApiKeyResolver(provider, async () => undefined);
  const result = await wrapped.auth.apiKey.resolve({} as any);
  assertEquals(result.auth.apiKey, "ollama");
});
```

- [ ] **Step 2: 运行测试并确认因 `withApiKeyResolver` 不存在而失败**

Run:

```bash
deno test --allow-env --allow-read src/agent/models_auth_test.ts
```

Expected: FAIL，提示 `withApiKeyResolver` 未导出。

- [ ] **Step 3: 实现最小 auth 包装器并接入 `registerProvider`**

在 `models.ts` 中新增：

```ts
export function withApiKeyResolver<T extends {
  auth: {
    apiKey?: {
      resolve: (...args: any[]) => Promise<any>;
      [key: string]: unknown;
    };
    [key: string]: unknown;
  };
}>(provider: T, resolveKey: () => Promise<string | undefined>): T {
  const original = provider.auth.apiKey;
  if (!original) return provider;
  return {
    ...provider,
    auth: {
      ...provider.auth,
      apiKey: {
        ...original,
        resolve: async (...args: any[]) => {
          const key = await resolveKey();
          return key ? { auth: { apiKey: key } } : original.resolve(...args);
        },
      },
    },
  };
}
```

在 `registerProvider` 中包装 `buildProviderInstance` 的返回值：

```ts
const rawProvider = await buildProviderInstance(providerId);
const providerInst = withApiKeyResolver(
  rawProvider,
  () => getApiKey(providerId),
);
models.setProvider(providerInst);
```

- [ ] **Step 4: 运行认证和现有模型测试**

Run:

```bash
deno test --allow-env --allow-read --allow-write src/agent/models_auth_test.ts src/agent/models_test.ts src/agent/models_init_default_test.ts
```

Expected: PASS。

- [ ] **Step 5: 提交认证兼容改动**

```bash
git add src/agent/models.ts src/agent/models_auth_test.ts
git commit -m "fix: preserve keychain auth for agent harness"
```

### Task 2: 建立 core JSONL Session 管理器和旧历史迁移

**Files:**
- Create: `src/agent/core_session.ts`
- Create: `src/agent/core_session_test.ts`
- Modify: `src/infra/db.ts`
- Modify: `src/domains/session/node/store.ts`
- Modify: `src/agent/history.ts`
- Modify: `src/agent/history_test.ts`

- [ ] **Step 1: 写 Session 创建、重开和旧历史迁移失败测试**

测试使用 core `InMemorySessionRepo` 注入 `CoreSessionManager`，避免测试依赖真实用户目录：

```ts
Deno.test("openOrCreate creates a core session with the conversation id", async () => {
  const manager = createTestManager({ path: null, messages: [] });
  const opened = await manager.openOrCreate("conv-1", "deepseek", "deepseek-chat");
  assertEquals((await opened.session.getMetadata()).id, "conv-1");
  assertEquals(opened.migrated, true);
});

Deno.test("openOrCreate imports legacy user and assistant messages once", async () => {
  const manager = createTestManager({
    path: null,
    messages: [
      { role: "user", content: "问题", createdAt: 1 },
      { role: "tool", content: "旧工具输出", createdAt: 2 },
      { role: "assistant", content: "回答", createdAt: 3 },
    ],
  });
  const first = await manager.openOrCreate("conv-2", "qwen", "qwen-plus");
  const second = await manager.openOrCreate("conv-2", "qwen", "qwen-plus");
  assertEquals((await first.session.buildContext()).messages.length, 2);
  assertEquals((await second.session.buildContext()).messages.length, 2);
});

Deno.test("openOrCreate rejects a persisted path whose session id differs", async () => {
  const manager = createTestManager({ path: "wrong-session", messages: [] });
  await assertRejects(
    () => manager.openOrCreate("conv-3", "deepseek", "deepseek-chat"),
    Error,
    "core session id mismatch",
  );
});
```

- [ ] **Step 2: 运行测试并确认缺少 CoreSessionManager**

Run:

```bash
deno test --allow-read --allow-write --allow-env src/agent/core_session_test.ts
```

Expected: FAIL，模块或导出不存在。

- [ ] **Step 3: 增加数据库列和 session store API**

在 `initDb()` 的幂等迁移中增加：

```ts
addColumn("conversations", "core_session_path", "TEXT");
addColumn("memories", "session_id", "TEXT");
```

在 session store 中增加：

```ts
export function getCoreSessionPath(id: string): string | null {
  const row = getDb().prepare(
    "SELECT core_session_path as path FROM conversations WHERE id = ?",
  ).get(id) as { path: string | null } | undefined;
  if (!row) throw new Error(`会话 ${id} 不存在`);
  return row.path;
}

export function setCoreSessionPath(id: string, path: string): void {
  getDb().prepare(
    "UPDATE conversations SET core_session_path = ? WHERE id = ?",
  ).run(path, id);
}
```

- [ ] **Step 4: 让历史转换返回 core AgentMessage**

保留 `toAgentHistoryMessages` 的对外名字，但收紧返回值为 `AgentMessage[]`，继续忽略旧 tool 投影，并保持 assistant 元数据完整。现有 `history_test.ts` 增加 user/assistant 顺序和 tool 被过滤的断言。

- [ ] **Step 5: 实现 CoreSessionManager**

核心构造参数保持可注入：

```ts
export interface CoreSessionDependencies {
  create: (conversationId: string) => Promise<Session>;
  open: (path: string) => Promise<Session>;
  remove: (path: string) => Promise<void>;
  getPath: (conversationId: string) => string | null;
  setPath: (conversationId: string, path: string) => void;
  getHistory: (conversationId: string) => StoredHistoryMessage[];
}
```

生产实现使用：

```ts
const env = new NodeExecutionEnv({ cwd: platformPaths.homeDir });
const repo = new JsonlSessionRepo({
  fs: env,
  sessionsRoot: platformPaths.join(platformPaths.appDataDir, "core-sessions"),
});
```

`openOrCreate` 必须：

- 有路径时打开并校验 metadata.id。
- 无路径时用 conversation ID 创建。
- 顺序 append 旧 user/assistant。
- 导入完成后才保存 metadata.path。
- 用进程内 Promise Map 防止并发重复迁移。

- [ ] **Step 6: 运行 Session 和历史测试**

Run:

```bash
deno test --allow-read --allow-write --allow-env src/agent/core_session_test.ts src/agent/history_test.ts
```

Expected: PASS。

- [ ] **Step 7: 提交 Session 管理改动**

```bash
git add src/agent/core_session.ts src/agent/core_session_test.ts src/infra/db.ts src/domains/session/node/store.ts src/agent/history.ts src/agent/history_test.ts
git commit -m "feat: persist core agent sessions as jsonl"
```

### Task 3: 隔离 working memory 并动态构建系统提示

**Files:**
- Modify: `src/domains/memory/node/store.ts`
- Create: `src/domains/memory/node/store_test.ts`
- Modify: `src/agent/tools/memory.ts`
- Modify: `src/agent/engine.ts`
- Modify: `src/agent/engine_platform_test.ts`

- [ ] **Step 1: 写 working memory 会话隔离失败测试**

先把 SQL 操作收拢到 `createMemoryStore(db: DatabaseSync)`，默认导出继续委托 `createMemoryStore(getDb())`；测试使用 `new DatabaseSync(":memory:")` 创建包含 `memories.session_id` 的临时表，然后验证：

```ts
Deno.test("working memory is recalled only for its session", () => {
  writeMemory("A 的任务", "task", "working", "session-a");
  writeMemory("B 的任务", "task", "working", "session-b");
  assertEquals(recallWorkingMemory("session-a").map((m) => m.content), ["A 的任务"]);
  assertEquals(recallWorkingMemory("session-b").map((m) => m.content), ["B 的任务"]);
});

Deno.test("clearing working memory removes only the target session", () => {
  clearWorkingMemory("session-a");
  assertEquals(recallWorkingMemory("session-a"), []);
  assertEquals(recallWorkingMemory("session-b").length, 1);
});
```

- [ ] **Step 2: 运行并确认当前全局 working memory 语义导致失败**

Run:

```bash
deno test --allow-read --allow-write --allow-env src/domains/memory/node/store_test.ts
```

Expected: FAIL，函数签名或结果不符合会话隔离要求。

- [ ] **Step 3: 实现 session-aware memory API**

修改签名：

```ts
export function writeMemory(
  content: string,
  kind = "fact",
  scope = "user",
  sessionId?: string,
): Memory

export function recallWorkingMemory(sessionId: string): Memory[]
export function recallAllMemories(sessionId?: string): Memory[]
export function clearWorkingMemory(sessionId: string): void
```

`scope=user` 强制写 `session_id=NULL`；`scope=working` 写入传入会话 ID。自动召回只查询 `session_id = ?`，不自动注入旧的 NULL working rows。

- [ ] **Step 4: 让 memory 工具绑定 AsyncLocalStorage session**

```ts
const sessionId = sessionContext.getStore()?.sessionId;
if (scope === "working" && !sessionId) {
  return {
    content: [{ type: "text", text: "写入工作记忆失败：当前没有会话上下文" }],
    details: { id: "", error: true },
  };
}
const mem = writeMemory(p.content, p.kind, scope, sessionId);
```

`memory_recall(scope=working|all)` 同样传入当前 session ID。

- [ ] **Step 5: 提取每轮动态提示构建器**

在 `engine.ts` 导出：

```ts
export function buildSystemPrompt(options: {
  sessionId: string;
  basePrompt?: string;
  modeAddon?: string;
}): string {
  const base = options.basePrompt ??
    systemPromptForPlatform(currentPlatform);
  return base +
    loadCustomPrompt() +
    loadMemoryPrompt(options.sessionId) +
    loadSkillsPrompt() +
    (options.modeAddon ?? "");
}
```

基础提示优先级保持现状：专家/Creator prompt 存在时作为 base，否则使用平台 prompt。

- [ ] **Step 6: 运行 memory 和 engine 测试**

Run:

```bash
deno test --allow-read --allow-write --allow-env src/domains/memory/node/store_test.ts src/agent/engine_platform_test.ts
```

Expected: PASS。

- [ ] **Step 7: 提交记忆隔离改动**

```bash
git add src/domains/memory/node/store.ts src/domains/memory/node/store_test.ts src/agent/tools/memory.ts src/agent/engine.ts src/agent/engine_platform_test.ts
git commit -m "fix: isolate working memory by conversation"
```

### Task 4: 用 AgentHarness 工厂替代基础 Agent 工厂

**Files:**
- Modify: `src/agent/engine.ts`
- Create: `src/agent/harness_factory_test.ts`

- [ ] **Step 1: 写 Harness 工厂事件和 hook 失败测试**

通过注入 fake Models、InMemory Session 和无副作用工具验证：

```ts
Deno.test("createPiHarness forwards AgentEvent without harness-only events", async () => {
  const seen: string[] = [];
  const { harness } = createPiHarness({
    sessionId: "s1",
    session,
    model,
    models,
    env,
    tools: [],
    buildPrompt: () => "system",
    onEvent: (event) => seen.push(event.type),
  });
  await harness.prompt("hello");
  assertEquals(seen.includes("message_end"), true);
  assertEquals(seen.includes("save_point"), false);
});
```

另写测试验证 `tool_call` 被权限检查阻止，以及 `tool_result` 调用审计回调。

- [ ] **Step 2: 运行并确认 `createPiHarness` 不存在**

Run:

```bash
deno test --allow-read --allow-write --allow-env src/agent/harness_factory_test.ts
```

Expected: FAIL，缺少导出。

- [ ] **Step 3: 实现 `createPiHarness`**

使用 core：

```ts
const harness = new AgentHarness({
  env,
  session,
  models,
  model,
  tools,
  activeToolNames: tools.map((tool) => tool.name),
  systemPrompt: async () => options.buildPrompt(),
});
```

注册：

```ts
harness.on("tool_call", async (event) => {
  const decision = await checkToolPermission(
    options.sessionId,
    options.getPermission(),
    event.toolName,
    event.input,
  );
  if (!decision.allow) return { block: true, reason: decision.reason };
  await snapshotBashWritesWhenNeeded(event, options.sessionId);
});

harness.on("tool_result", async (event) => {
  await logToolCall(event.toolName, event.input, event.isError);
});
```

`subscribe` 中只转发 core `AgentEvent` 类型集合，Harness 自有事件不进入现有前端协议。

- [ ] **Step 4: 运行 Harness 工厂测试**

Run:

```bash
deno test --allow-read --allow-write --allow-env --allow-run src/agent/harness_factory_test.ts
```

Expected: PASS。

- [ ] **Step 5: 提交 Harness 工厂**

```bash
git add src/agent/engine.ts src/agent/harness_factory_test.ts
git commit -m "refactor: create sessions with pi agent harness"
```

### Task 5: 使用 core API 接入自动压缩

**Files:**
- Create: `src/agent/compaction.ts`
- Create: `src/agent/compaction_test.ts`

- [ ] **Step 1: 写 core 阈值组合失败测试**

```ts
Deno.test("compactIfNeeded delegates threshold and summary work to core", async () => {
  let calls = 0;
  const result = await compactIfNeeded({
    contextMessages: [assistantWithUsage(120_000)],
    contextWindow: 128_000,
    compact: async () => {
      calls++;
      return { summary: "checkpoint", firstKeptEntryId: "e2", tokensBefore: 120_000 };
    },
  });
  assertEquals(result.compacted, true);
  assertEquals(calls, 1);
});

Deno.test("compactIfNeeded leaves small contexts untouched", async () => {
  let calls = 0;
  const result = await compactIfNeeded({
    contextMessages: [assistantWithUsage(1_000)],
    contextWindow: 128_000,
    compact: async () => {
      calls++;
      throw new Error("must not run");
    },
  });
  assertEquals(result.compacted, false);
  assertEquals(calls, 0);
});
```

- [ ] **Step 2: 运行并确认缺少 `compactIfNeeded`**

Run:

```bash
deno test --allow-read src/agent/compaction_test.ts
```

Expected: FAIL。

- [ ] **Step 3: 实现只组合 core 的压缩函数**

```ts
export async function compactIfNeeded(input: CompactIfNeededInput) {
  const usage = estimateContextTokens(input.contextMessages);
  if (!shouldCompact(
    usage.tokens,
    input.contextWindow,
    DEFAULT_COMPACTION_SETTINGS,
  )) {
    return { compacted: false, tokens: usage.tokens };
  }
  const result = await input.compact();
  return { compacted: true, tokens: usage.tokens, result };
}
```

函数不包含自定义 Token 算法、切割算法或摘要 prompt。

- [ ] **Step 4: 运行压缩测试**

Run:

```bash
deno test --allow-read src/agent/compaction_test.ts
```

Expected: PASS。

- [ ] **Step 5: 提交压缩组合器**

```bash
git add src/agent/compaction.ts src/agent/compaction_test.ts
git commit -m "feat: add core-backed context compaction trigger"
```

### Task 6: 迁移 LocalPiProvider 到 AgentHarness

**Files:**
- Modify: `src/agent/provider.ts`
- Create: `src/agent/provider_harness_test.ts`
- Modify: `src/agent/engine.ts`

- [ ] **Step 1: 写 Provider 行为失败测试**

覆盖：

```ts
Deno.test("provider reuses one harness per session and changes active tools by mode", async () => {
  const provider = createTestProvider();
  await provider.prompt("s1", "ask", { mode: "ask", permission: "readonly" });
  await provider.prompt("s1", "craft", { mode: "craft", permission: "full" });
  assertEquals(provider.createdHarnesses, 1);
  assertEquals(provider.toolModes, ["ask", "craft"]);
});

Deno.test("provider compacts before and after prompt using the core session context", async () => {
  const provider = createTestProvider({ overLimitBefore: true, overLimitAfter: true });
  await provider.prompt("s1", "continue", { mode: "craft", permission: "default" });
  assertEquals(provider.compactionPhases, ["before", "after"]);
});

Deno.test("provider abort waits for harness idle before starting replacement prompt", async () => {
  const provider = createTestProvider({ running: true });
  await provider.prompt("s1", "replacement");
  assertEquals(provider.abortWaited, true);
});
```

- [ ] **Step 2: 运行并确认当前 Provider 仍依赖基础 Agent**

Run:

```bash
deno test --allow-read --allow-write --allow-env src/agent/provider_harness_test.ts
```

Expected: FAIL。

- [ ] **Step 3: 修改 SessionEntry 和 createSession**

`SessionEntry` 改为：

```ts
interface SessionEntry {
  harness: AgentHarness;
  coreSession: Session;
  listeners: Set<(e: AgentEvent) => void>;
  category: string;
  baseSystemPrompt?: string;
  modeAddon: string;
  lastOpts: PromptOptions;
}
```

`createSession`：

- 读取 conversation 配置。
- `coreSessionManager.openOrCreate(...)`。
- 调用 `createPiHarness(...)`。
- 不再赋值 `agent.state.messages`。
- Harness system prompt callback读取 `entry.modeAddon` 和最新记忆。

- [ ] **Step 4: 修改 Prompt、steer、abort 和 dispose**

Prompt 顺序：

```ts
await stopActiveRun(entry.harness);
await entry.harness.setTools(tools, tools.map((tool) => tool.name));
entry.modeAddon = modePrompt + slashSkillAddon;
await compactSessionIfNeeded(entry, "before");
await sessionContext.run({ sessionId }, () => entry.harness.prompt(text));
await compactSessionIfNeeded(entry, "after", { postPrompt: true });
```

后置压缩失败只记录日志，不覆盖已完成回答状态；前置压缩失败进入现有可见错误链。

`steer` 调用 `harness.steer(msg)`；`abort` await `harness.abort()`；`dispose` abort、wait、移除监听器和缓存。

- [ ] **Step 5: 保持事件持久化 API 兼容**

保留 `onEvent`、`emitEvent`、`attachPersistence` 和 `getToolOutputString` 的外部行为。将 `getSessionAgent` 替换为：

```ts
export function getSessionHarness(sessionId: string): AgentHarness | undefined
```

全项目搜索旧 `getSessionAgent`，若没有消费者则删除旧导出；若有消费者则提供明确 Harness 兼容导出，不伪造基础 Agent。

- [ ] **Step 6: 运行 Provider、历史、权限和工具测试**

Run:

```bash
deno test --allow-read --allow-write --allow-env --allow-run src/agent/provider_harness_test.ts src/agent/history_test.ts src/agent/permissions_windows_test.ts src/agent/tools/windows_shell_test.ts
```

Expected: PASS。

- [ ] **Step 7: 提交 Provider 迁移**

```bash
git add src/agent/provider.ts src/agent/provider_harness_test.ts src/agent/engine.ts
git commit -m "feat: run conversations through pi agent harness"
```

### Task 7: 接入删除清理和 memory API 兼容

**Files:**
- Modify: `src/agent/provider.ts`
- Modify: `src/domains/session/node/store.ts`
- Modify: `application.ts`
- Modify: `src/domains/memory/node/store.ts`
- Create: `src/agent/session_cleanup_test.ts`

- [ ] **Step 1: 写删除顺序和隔离清理失败测试**

```ts
Deno.test("deleteConversationData removes core session before sqlite metadata", async () => {
  const order: string[] = [];
  await deleteConversationData("s1", {
    dispose: async () => order.push("dispose"),
    removeCore: async () => order.push("core"),
    clearWorking: () => order.push("memory"),
    removeSqlite: () => order.push("sqlite"),
  });
  assertEquals(order, ["dispose", "core", "memory", "sqlite"]);
});
```

- [ ] **Step 2: 运行并确认删除协调函数不存在**

Run:

```bash
deno test --allow-read --allow-write --allow-env src/agent/session_cleanup_test.ts
```

Expected: FAIL。

- [ ] **Step 3: 实现删除协调和幂等 JSONL 删除**

新增 Provider 方法：

```ts
async deleteSession(sessionId: string): Promise<void> {
  await this.dispose(sessionId);
  await this.coreSessions.delete(sessionId);
  clearWorkingMemory(sessionId);
}
```

将 API 删除路由改为：

```ts
await provider.deleteSession(id);
deleteConversation(id);
clearConfirmHandler(id);
return json({ ok: true });
```

`CoreSessionManager.delete` 对文件不存在视为成功，其他错误抛出。

- [ ] **Step 4: 扩展 `/api/memories` 可选 sessionId**

POST 路由调用：

```ts
writeMemory(
  b.content,
  b.kind || "fact",
  b.scope || "user",
  typeof b.sessionId === "string" ? b.sessionId : undefined,
);
```

不传时保持长期记忆现有行为；未绑定 working memory 允许在面板展示，但不自动注入 Agent。

- [ ] **Step 5: 运行清理和 session store 测试**

Run:

```bash
deno test --allow-read --allow-write --allow-env src/agent/session_cleanup_test.ts src/domains/memory/node/store_test.ts
```

Expected: PASS。

- [ ] **Step 6: 提交删除与 API 兼容改动**

```bash
git add src/agent/provider.ts src/domains/session/node/store.ts application.ts src/domains/memory/node/store.ts src/agent/session_cleanup_test.ts
git commit -m "fix: clean core sessions with conversations"
```

### Task 8: 集成回归和跨平台打包验证

**Files:**
- Modify if required by failures: only files already in Tasks 1–7
- Test: all existing `*_test.ts`

- [ ] **Step 1: 类型检查应用入口**

Run:

```bash
deno check main.ts application.ts
```

Expected: exit 0，无 TypeScript 错误。

- [ ] **Step 2: 运行全部 Deno 测试**

Run:

```bash
deno test --allow-read --allow-write --allow-env --allow-run --allow-sys --allow-net
```

Expected: 所有测试 PASS；任何失败均先定位并用最小修复处理，然后重新运行完整命令。

- [ ] **Step 3: 构建前端并重新生成嵌入资源**

Run:

```bash
deno task build:frontend
deno task gen:frontend
```

Expected: 两条命令 exit 0。

- [ ] **Step 4: 运行 Windows 专项测试**

Run:

```bash
deno test --allow-read --allow-write --allow-env --allow-run --allow-sys deno_windows_bootstrap_test.ts src/platform/paths_test.ts src/platform/shell_test.ts src/agent/engine_platform_test.ts src/agent/tools/windows_shell_test.ts src/infra/keychain_windows_test.ts
```

Expected: PASS。

- [ ] **Step 5: 执行 Windows cross-target 构建**

Run:

```bash
deno task build:windows:portable
```

Expected: exit 0，生成 `dist/windows/Pi-a/`。若受本机网络或 Deno Desktop 工具链限制失败，记录原始错误，并继续执行所有不依赖该外部条件的验证，不能把构建描述为通过。

- [ ] **Step 6: 执行 macOS 桌面构建**

Run:

```bash
deno task build:mac:app:arm64
```

Expected: exit 0，生成 `dist/macos/Pi-a-arm64.app`。

- [ ] **Step 7: 检查 diff、无意外生成物和设计覆盖**

Run:

```bash
git status --short
git diff --check
git diff --stat HEAD~7
```

逐项核对：

- JSONL 完整上下文和 toolResult 重启恢复。
- core compaction entry 和摘要上下文。
- SQLite UI 投影不变。
- Keychain 认证不变。
- working memory 会话隔离。
- 自动化、子代理、权限、Windows/macOS 路径兼容。

- [ ] **Step 8: 提交验证期间的必要修复**

```bash
git add src/agent src/domains/memory/node src/domains/session/node src/infra/db.ts application.ts
git commit -m "test: verify harness compaction integration"
```

如果没有额外修改，则不创建空提交。
