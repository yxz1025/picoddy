# Pi Web Extension Plugin Host Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** 在 PiCoddy-a 中建立一个可承载 `pi-studio` 及未来 Pi Web Extension 的标准插件宿主，让扩展可以复用命令、工具、会话事件和本地 WebView 能力。

**Architecture:** 增加一个进程内的 Pi Extension 兼容层，把扩展声明、命令、工具和生命周期事件统一映射到 PiCoddy-a 的现有 session/runtime；增加受信任的本地 Web Extension 宿主，负责启动 localhost 服务并在 Electron `WebContentsView` 中承载页面。插件包只提供 manifest 和入口，业务扩展不直接接触 Electron IPC、数据库或应用内部模块。

**Tech Stack:** TypeScript, Electron `WebContentsView`, Node `http`, existing session/provider runtime, existing IPC/preload allowlist, Node test runner, Vite frontend.

---

## 设计边界

- 首版只加载随应用打包或本地审核过的插件，不从远端直接执行任意 npm 包。
- 插件入口兼容 Pi 的 `ExtensionAPI` 子集：`registerCommand`、`registerTool`、`on`、`sendUserMessage`、`getSessionName`、模型/会话只读状态。
- Web 页面只能绑定 `127.0.0.1`，使用一次性随机 token；Renderer 不获得插件进程的任意 Node 权限。
- 插件能力通过 manifest 声明，宿主按能力拒绝未授权调用。
- `pi-studio` 第一阶段只接入 `/studio`、WebView 生命周期、消息/响应流和基础文件/导出工具；REPL、Quarto、Pandoc 等外部能力单独声明并默认关闭。

## 文件结构

- Create: `src/platform/extensions/types.ts` — manifest、能力、命令、工具、事件类型。
- Create: `src/platform/extensions/registry.ts` — 受信任插件注册表和版本校验。
- Create: `src/platform/extensions/host.ts` — ExtensionAPI 兼容层、生命周期和资源清理。
- Create: `src/platform/extensions/bridge.ts` — 插件与应用之间的 RPC 消息协议。
- Create: `src/platform/extensions/web-host.ts` — localhost 服务、token、WebContentsView 管理。
- Create: `src/platform/extensions/builtin/pi-studio.ts` — pi-studio manifest 和适配入口。
- Modify: `src/electron/ipc-handlers.ts` — extension list/open/close/message RPC。
- Modify: `src/electron/preload.cjs` — 暴露最小 extension API。
- Modify: `application.electron.ts` — 注册内置插件、转发 session 事件和创建 WebView。
- Modify: `frontend/src/api/client.ts` — extension API 客户端。
- Create: `frontend/src/components/ExtensionHost.tsx` — WebContentsView/页面容器状态。
- Create: `frontend/src/store/useExtensionStore.ts` — 插件列表、打开页面、关闭和错误状态。
- Create: `src/platform/extensions/*.test.ts` — manifest、RPC、生命周期、安全边界测试。
- Create: `docs/architecture/pi-web-extension-plugin-host.md` — 插件开发者文档和示例。

### Task 1: 定义扩展 manifest 和稳定能力模型

**Files:**
- Create: `src/platform/extensions/types.ts`
- Test: `src/platform/extensions/types.test.ts`

- [ ] **Step 1: 写失败测试**，验证 manifest 必须包含 `id`、`version`、`entry`、`kind`，能力只能来自白名单；命令名和工具名必须唯一。
- [ ] **Step 2: 运行测试确认失败**

```bash
npx tsx --test src/platform/extensions/types.test.ts
```

- [ ] **Step 3: 定义核心类型**

```ts
export type ExtensionCapability =
  | "command.register"
  | "tool.register"
  | "session.events"
  | "webview.localhost"
  | "filesystem.read"
  | "filesystem.write"
  | "process.spawn";

export interface PiWebExtensionManifest {
  id: string;
  version: string;
  kind: "pi-extension";
  entry: string;
  capabilities: readonly ExtensionCapability[];
  web?: { route: string; singleton?: boolean };
}
```

- [ ] **Step 4: 运行测试确认通过**

### Task 2: 建立受信任插件注册表和加载器

**Files:**
- Create: `src/platform/extensions/registry.ts`
- Create: `src/platform/extensions/registry.test.ts`
- Modify: `src/platform/cli/plugins.ts`

- [ ] **Step 1: 测试只允许内置 manifest、拒绝重复 id、拒绝未声明能力和路径逃逸。**
- [ ] **Step 2: 实现 `createExtensionRegistry(manifests)`、`get(id)`、`list()` 和入口绝对路径解析。入口必须位于应用安装目录或已审核插件目录内。**
- [ ] **Step 3: 将 `pi-studio` 注册为 `kind: "pi-extension"`，初始能力只开放 `command.register`、`tool.register`、`session.events`、`webview.localhost`。**
- [ ] **Step 4: 运行注册表测试和 Electron 类型检查。**

### Task 3: 实现最小 Pi ExtensionAPI 兼容层

**Files:**
- Create: `src/platform/extensions/host.ts`
- Create: `src/platform/extensions/host.test.ts`
- Modify: `src/agent/provider.ts`

- [ ] **Step 1: 测试插件可以注册命令、工具和事件，重复注册会失败，插件停止时所有注册项会清理。**
- [ ] **Step 2: 实现 `createExtensionHost(context)`，提供以下受控 API：**

```ts
interface ExtensionAPI {
  registerCommand(name: string, handler: CommandHandler): void;
  registerTool(name: string, schema: ToolSchema, handler: ToolHandler): void;
  on(event: ExtensionEventName, handler: ExtensionEventHandler): () => void;
  sendUserMessage(text: string, options?: { deliverAs?: "user" | "steer" }): Promise<void>;
  getSessionName(): string | undefined;
}
```

- [ ] **Step 3: 将命令接入现有 slash command 列表，将工具接入现有 tool registry；插件工具调用必须经过能力检查、超时和错误归一化。**
- [ ] **Step 4: 将 `session_start`、`message_start`、`message_update`、`message_end`、`tool_execution_*`、`agent_end`、`session_shutdown` 映射给插件。**
- [ ] **Step 5: 运行 host 测试，验证插件异常不会终止主进程。**

### Task 4: 设计插件 RPC 和 Web 页面桥接协议

**Files:**
- Create: `src/platform/extensions/bridge.ts`
- Create: `src/platform/extensions/bridge.test.ts`
- Modify: `src/electron/preload.cjs`
- Modify: `src/electron/ipc-handlers.ts`

- [ ] **Step 1: 测试 request/response、event、错误、超时、未知方法和过期 token。**
- [ ] **Step 2: 定义带 `requestId`、`pluginId`、`method`、`payload` 的消息协议；所有 payload 使用 JSON 可序列化值。**
- [ ] **Step 3: preload 只暴露 `extensions.list/open/close/send`，禁止把 `ipcRenderer` 或 Node API 直接暴露给插件页面。**
- [ ] **Step 4: 对工具和文件能力应用 manifest capability 检查；错误统一为 `{ code, message, requestId }`，不返回 token、环境变量或堆栈。**

### Task 5: 实现 Electron WebContentsView 宿主

**Files:**
- Create: `src/platform/extensions/web-host.ts`
- Create: `src/platform/extensions/web-host.test.ts`
- Modify: `application.electron.ts`

- [ ] **Step 1: 测试服务只监听 loopback、token 不能复用、关闭插件会停止 server/view/child resources。**
- [ ] **Step 2: 实现 `openExtensionWebView(pluginId, bounds)`：启动 localhost 服务，生成随机 token，将 token 作为 URL 查询参数传入 WebContentsView。**
- [ ] **Step 3: 设置安全 WebContents 选项：禁止远程导航、限制新窗口、拦截非白名单协议、关闭 Node integration，所有插件 API 通过 bridge。**
- [ ] **Step 4: 将 view 的 bounds、主题、窗口关闭和应用退出事件接入宿主生命周期。**
- [ ] **Step 5: 运行 WebView 宿主测试；在 Electron 开发模式手工验证打开、刷新、关闭和重开。**

### Task 6: 接入 pi-studio 第一版适配器

**Files:**
- Create: `src/platform/extensions/builtin/pi-studio.ts`
- Create: `src/platform/extensions/builtin/pi-studio.test.ts`
- Create: `frontend/src/components/ExtensionHost.tsx`
- Create: `frontend/src/store/useExtensionStore.ts`
- Modify: `frontend/src/api/client.ts`

- [ ] **Step 1: 使用包 manifest 的 `pi.extensions` 入口加载 `pi-studio/index.ts`，把 Pi ExtensionAPI 映射到 Task 3 的 host。**
- [ ] **Step 2: 支持 `/studio`、`/studio-replace`、`/studio-editor-only`、`/studio-current` 命令，并把打开动作发送给 Web host。**
- [ ] **Step 3: 将当前 session 的 prompt、response、working/tool events 转换为 pi-studio 能消费的事件。**
- [ ] **Step 4: 前端增加插件面板/路由，用 WebContentsView 承载 Studio 页面；加载失败显示可重试状态。**
- [ ] **Step 5: 测试命令注册、打开单例、事件转发、关闭清理和重复打开行为。**

### Task 7: 为未来扩展包提供标准开发包

**Files:**
- Create: `src/platform/extensions/sdk.ts`
- Create: `src/platform/extensions/sdk.test.ts`
- Create: `docs/architecture/pi-web-extension-plugin-host.md`

- [ ] **Step 1: 导出稳定 SDK：manifest 校验、命令/工具注册类型、事件类型、Web bridge client 和 capability 常量。**
- [ ] **Step 2: 编写最小扩展示例：一个 slash command、一个 tool、一个 localhost 页面和一个 session event listener。**
- [ ] **Step 3: 文档明确插件包结构、manifest、入口、版本兼容策略、权限、打包和测试命令。**
- [ ] **Step 4: 约定 API 版本字段，例如 `apiVersion: 1`；宿主只承诺同一 major 版本的兼容性。**

### Task 8: 安全、回归和发布检查

**Files:**
- Modify: `docs/superpowers/specs/2026-08-17-skillhub-catalog-install-design.md`
- Create: `src/platform/extensions/integration.test.ts`

- [ ] **Step 1: 集成测试验证插件无法访问未声明的文件、网络、进程和 Electron IPC 能力。**
- [ ] **Step 2: 验证插件超时、异常退出、WebView 崩溃和应用退出都能清理资源。**
- [ ] **Step 3: 运行完整验证：**

```bash
npx tsx --test src/platform/extensions/**/*.test.ts src/agent/prompt-runtime/*.test.ts
npx tsc --project tsconfig.electron.json --noEmit
npm run build --prefix frontend
git diff --check
```

- [ ] **Step 4: 只在所有测试通过后将 `pi-studio` 加入默认内置插件列表；第三方扩展继续保持审核后注册。**

## 迁移策略

1. 第一阶段只新增宿主和 SDK，不改变现有 SkillHub CLI 插件运行时。
2. 第二阶段接入 pi-studio 的 `/studio` 和基础事件流，默认不启用 tmux、Quarto、Pandoc 等外部进程能力。
3. 第三阶段按插件能力逐项开放文件写入、进程执行、REPL 和导出能力，每项都增加权限提示和测试。
4. 未来第三方包必须经过 manifest 校验、来源白名单、签名/哈希校验和版本兼容检查后才能进入注册表。

