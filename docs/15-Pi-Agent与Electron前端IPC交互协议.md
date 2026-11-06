# Pi-Agent 与 Electron 前端 IPC 交互协议文档

## 2026-10-14 会话删除修复

Electron 开发版与安装版均在 tsx 注册前设置 `ESBUILD_WORKER_THREADS=0`，避免首次按需加载删除模块时使用不稳定的 esbuild 同步工作线程。该选项只影响主进程 TypeScript 加载，不改变 IPC 协议。

`session.delete` 继续映射到 `DELETE /api/conv/:id`，复用现有 preload call 通道和主进程 API handler。接口使用 `session_cleanup.ts` 的 `removeConversationSessionFile` 清理数据库映射的 Pi 历史文件，不再引用已移除的 `core_session.ts`。父、子会话共用受管路径校验，仅删除 `pi-agent/sessions` 或 `core-sessions` 内的普通文件；无路径和文件不存在允许继续，越界、链接或文件错误阻止删除并保留元数据。

前端共用 `deleteConversation` 捕获请求错误并显示应用内“删除失败”提示；删除成功后立即从列表移除该项，删除当前会话时复用 `resetToWelcome` 清理流、输入区关联及 busy/taskStatus，再通过既有列表加载同步服务端。列表加载失败沿用既有处理，保留本地已删除结果。详细方案见 [删除修复设计](./designs/2026-10-14-conversation-delete-fix-design.md)。

> 参考项目：agent-1.0.24 (DeskWand)
> 核心技术：Electron IPC + Pi Agent SDK (`@earendil-works/pi-ai`) + Zustand
> 文档目的：为 picoddy 项目的前后端 IPC 交互提供完整的协议参考和对接指南

---

## 目录

1. [架构全景](#1-架构全景)
2. [IPC 通道设计](#2-ipc-通道设计)
3. [ClientEvent（渲染进程 → 主进程）](#3-clientevent渲染进程--主进程)
4. [ServerEvent（主进程 → 渲染进程）](#4-serverevent主进程--渲染进程)
5. [Preload 桥接层](#5-preload-桥接层)
6. [领域 API 通道](#6-领域-api-通道)
7. [会话生命周期数据流](#7-会话生命周期数据流)
8. [流式输出数据流](#8-流式输出数据流)
9. [权限/密码交互数据流](#9-权限密码交互数据流)
10. [渲染进程消费（useIPC）](#10-渲染进程消费useipc)
11. [远端通道与扩展桥接](#11-远端通道与扩展桥接)
12. [Zustand Store 状态管理](#12-zustand-store-状态管理)
13. [移植要点](#13-移植要点)

---

## 1. 架构全景

```
┌──────────────────────────────────────────────────────────────────────┐
│                       Electron Main Process                          │
│                                                                      │
│  ┌────────────────────┐          ┌──────────────────────────────┐   │
│  │   SessionManager   │          │       AgentRunner             │   │
│  │                    │          │                              │   │
│  │ - startSession()   │  create  │ - run(session, prompt, ...)  │   │
│  │ - continueSession()│ ───────→ │ - subscribe(stream events)   │   │
│  │ - enqueuePrompt()  │          │   → stream.thinking          │   │
│  │ - processQueue()   │  ◄────── │   → stream.partial           │   │
│  │ - processPrompt()  │  events  │   → stream.message           │   │
│  │ - stopSession()    │          │   → trace.step/update        │   │
│  │                    │          │   → permission.request       │   │
│  │ 权限/密码管理       │          │   → sandbox.sync             │   │
│  │ - requestPermission│          │   → subagent.lifecycle       │   │
│  │ - requestSudoPwd   │          │                              │   │
│  └─────────┬──────────┘          └──────────────────────────────┘   │
│            │                                                         │
│            │  sendToRenderer(event: ServerEvent)                     │
│            │  - 路由远程会话到通道 (Feishu/WeChat)                    │
│            │  - 发送到本地 UI                                        │
│            │                                                         │
│  ┌─────────▼──────────────────────────────────────────────────────┐ │
│  │                   IPC Handlers                                  │ │
│  │  ipcMain.on("client-event")     → handleClientEvent()          │ │
│  │  ipcMain.handle("client-invoke") → handleClientEvent()         │ │
│  │  ipcMain.handle("<domain>.xxx")  → 领域处理器 (config/mcp/...)  │ │
│  └─────────┬──────────────────────────────────────────────────────┘ │
│            │                                                         │
└────────────┼─────────────────────────────────────────────────────────┘
             │  contextBridge (preload/index.ts)
             │
┌────────────▼─────────────────────────────────────────────────────────┐
│                     Renderer (React + Zustand)                        │
│                                                                      │
│  ┌────────────────────┐    ┌────────────────────────────────────┐   │
│  │  window.electronAPI │    │         useIPC Hook                 │   │
│  │  .send(event)       │───→│  - installSharedIpcBridge()        │   │
│  │  .invoke<T>(event)  │    │  - RAF batching (partial/thinking) │   │
│  │  .on(callback)      │    │  - 所有 ServerEvent → store 映射   │   │
│  │  .<domain>.xxx()    │    │  - session auto-restore            │   │
│  └────────────────────┘    └────────────────────────────────────┘   │
│                                                                      │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │              Zustand Store (useAppStore)                       │   │
│  │  - sessions[], activeSessionId, sessionStates{}               │   │
│  │  - 每个 SessionState: messages[], partialMessage,             │   │
│  │    partialThinking, traceSteps[], activeTurn, pendingTurns[]  │   │
│  └──────────────────────────────────────────────────────────────┘   │
└──────────────────────────────────────────────────────────────────────┘
```

---

## 2. IPC 通道设计

### 2.1 通道概览

项目使用 **3 条 IPC 通道** + **40+ 领域 API handle**：

| 通道 | 方向 | 机制 | 说明 |
|------|------|------|------|
| `"client-event"` | Renderer → Main | `ipcRenderer.send`（单向） | 无需返回值的事件 |
| `"client-invoke"` | Renderer → Main | `ipcRenderer.invoke`（请求/响应） | 需要返回值的事件 |
| `"server-event"` | Main → Renderer | `webContents.send`（推送） | 主进程主动推送 |
| `"<domain>.<method>"` | Renderer → Main | `ipcRenderer.invoke`（直接调用） | 领域功能 API |

**关键设计点：**

1. **两条入站通道共用同一处理函数** — `"client-event"` 和 `"client-invoke"` 都走 `handleClientEvent()`，参数和逻辑完全一致，区别仅在于是否需要返回值
2. **事件白名单** — Preload 层维护 `ALLOWED_CLIENT_EVENTS` Set，对 `send` 和 `invoke` 调用的 event.type 进行校验，防止渲染进程伪造任意 IPC 通道
3. **出站通道单点** — 所有主进程向渲染进程的推送都经过 `sendToRenderer(event: ServerEvent)`，该函数同时负责远程会话路由

### 2.2 send 与 invoke 的使用分工

| 场景 | 使用方式 | 示例 |
|------|----------|------|
| 需要返回值 | `electronAPI.invoke(event)` | `session.start` → 返回 `Session` 对象 |
| 无需返回值 | `electronAPI.send(event)` | `session.continue`（流式结果由 push 返回） |
| 权限响应 | `electronAPI.send(event)` | `permission.response`（单向，无需返回值） |

---

## 3. ClientEvent（渲染进程 → 主进程）

**类型定义：** `src/renderer/types/index.ts:450`

### 3.1 会话生命周期事件

```typescript
// 1. 启动新会话 —— 使用 invoke，返回 Session 对象
{ type: "session.start", payload: {
    title: string;           // 会话标题
    prompt: string;          // 初始提示词
    cwd?: string;            // 工作目录
    allowedTools?: string[]; // 允许的工具列表
    content?: ContentBlock[];// 附件内容（图片/文件等）
    memoryEnabled?: boolean; // 是否启用记忆
    thinkingLevel?: ThinkingLevel;
    providerProfileKey?: ProviderProfileKey;
    model?: string;
    turnId?: string;
}}

// 2. 继续会话 —— 使用 send，结果通过 ServerEvent 推送
{ type: "session.continue", payload: {
    sessionId: string;
    prompt: string;
    content?: ContentBlock[];
    providerProfileKey?: ProviderProfileKey;
    model?: string;
    turnId?: string;
}}

// 3. 停止会话
{ type: "session.stop", payload: { sessionId: string } }

// 4. 压缩会话
{ type: "session.compact", payload: { sessionId: string; instructions?: string } }

// 5. 中止压缩
{ type: "session.abortCompaction", payload: { sessionId: string } }

// 6. 干预（steer）
{ type: "session.steer", payload: { sessionId: string; prompt: string } }

// 7. Goal 控制
{ type: "session.command", payload: { sessionId: string; action: "pause" | "resume" | "clear" } }
```

### 3.2 会话管理事件

```typescript
// 删除
{ type: "session.delete", payload: { sessionId: string } }
{ type: "session.batchDelete", payload: { sessionIds: string[] } }

// 归档
{ type: "session.archive", payload: { sessionId: string } }
{ type: "session.unarchive", payload: { sessionId: string } }
{ type: "session.batchArchive", payload: { sessionIds: string[] } }
{ type: "session.batchUnarchive", payload: { sessionIds: string[] } }
{ type: "session.archiveDelete", payload: { sessionId: string } }

// 查询
{ type: "session.list", payload: {} }                     // 获取列表（invoke）
{ type: "session.getMessages", payload: { sessionId } }   // 获取消息（invoke）
{ type: "session.getTraceSteps", payload: { sessionId } } // 获取追踪步骤（invoke）

// 设置
{ type: "session.setThinkingLevel", payload: { sessionId, thinkingLevel } }
{ type: "session.setProviderModel", payload: { sessionId, providerProfileKey, model } }
```

### 3.3 权限与密码

```typescript
// 权限审批：用户点击 allow/deny/allow_always
{ type: "permission.response", payload: {
    toolUseId: string;
    result: "allow" | "deny" | "allow_always";
}}

// Sudo 密码：用户输入密码或取消
{ type: "sudo.password.response", payload: {
    toolUseId: string;
    password: string | null;  // null = 取消
}}
```

### 3.4 设置与工作目录

```typescript
{ type: "settings.update", payload: Record<string, unknown> }   // 主题/预设/telemetry等
{ type: "folder.select", payload: {} }                          // 打开文件夹选择对话框
{ type: "workdir.get", payload: {} }                            // 获取当前工作目录
{ type: "workdir.set", payload: { path: string; sessionId?: string } }
{ type: "workdir.select", payload: { sessionId?; currentPath? } }
{ type: "project.create", payload: { name: string } }           // 创建新项目
{ type: "project.delete", payload: { cwd: string } }
{ type: "update.check", payload: {} }                           // 检查更新
{ type: "update.install", payload: {} }                         // 安装更新
```

---

## 4. ServerEvent（主进程 → 渲染进程）

**类型定义：** `src/renderer/types/index.ts:572`

### 4.1 流式输出事件

以下 `server-event` 类型只用于仍接入 `useIPC` 的兼容领域能力，不是桌面主聊天文本流。桌面主聊天和速唤浮窗的当前协议统一见第 8 节 SSE `stream_text` / `stream_resync_required`；不得新增 `stream.partial` 双轨消费者。

```typescript
// 完整消息（最终态）—— assistant 文本 / tool_result / error
{ type: "stream.message", payload: {
    sessionId: string;
    message: Message;      // 完整的 Message 对象
    turnId?: string;
}}

// 增量文本 —— 高频推送（每帧多次），渲染层 RAF 批处理
{ type: "stream.partial", payload: {
    sessionId: string;
    delta: string;         // 增量文本片段
    turnId?: string;
}}

// 增量思考 —— 高频推送，渲染层 RAF 批处理
{ type: "stream.thinking", payload: {
    sessionId: string;
    delta: string;         // 增量 thinking 片段
    turnId?: string;
}}

// 部分工具结果 —— 工具执行过程中的实时输出
{ type: "stream.toolResultPartial", payload: {
    sessionId: string;
    toolCallId: string;
    content?: string;      // 非空=更新内容，空字符串=清除信号
    isError?: boolean;
    images?: string[];
    diff?: string;
}}
```

**`stream.toolResultPartial` 的特殊协议：**
- 非空 `content`：追加/更新工具的部分执行结果
- **空字符串 `""` 的 `content`**：是 `tool_execution_end` 时发送的"清除"信号，渲染进程收到后清除该工具的部分结果状态

### 4.2 会话状态事件

```typescript
// 会话运行状态变更
{ type: "session.status", payload: {
    sessionId: string;
    status: "idle" | "running" | "completed" | "error";
    error?: string;
}}

// 会话属性更新（标题、cwd、provider/model 等）
{ type: "session.update", payload: {
    sessionId: string;
    updates: Partial<Session>;
}}

// 会话列表（响应 session.list）
{ type: "session.list", payload: {
    sessions: Session[];
    contextWindows?: Record<string, number>;
}}

// 上下文窗口信息
{ type: "session.contextInfo", payload: {
    sessionId: string;
    contextWindow: number;
}}

// 压缩状态
{ type: "session.compaction", payload: {
    sessionId: string;
    status: "running" | "success" | "failed" | "aborted";
    estimatedTokens?: number;
}}

// Steer 干预结果
{ type: "session.steer.result", payload: {
    sessionId: string;
    status: "accepted" | "failed";
    text: string;
}}
```

### 4.3 权限交互事件

```typescript
// 请求权限确认
{ type: "permission.request", payload: {
    toolUseId: string;
    toolName: string;
    input: Record<string, unknown>;
    sessionId: string;
}}

// 权限请求超时取消（60s）
{ type: "permission.dismiss", payload: { toolUseId: string } }

// 请求 sudo 密码
{ type: "sudo.password.request", payload: {
    toolUseId: string;
    command: string;
    sessionId: string;
}}

// sudo 密码请求超时取消（60s）
{ type: "sudo.password.dismiss", payload: { toolUseId: string } }
```

### 4.4 追踪步骤事件 (Trace)

用于 UI 中展示工具调用过程的可视化步骤：

```typescript
// 新增追踪步骤
{ type: "trace.step", payload: {
    sessionId: string;
    step: TraceStep;
}}

// 更新追踪步骤
{ type: "trace.update", payload: {
    sessionId: string;
    stepId: string;
    updates: Partial<TraceStep>;
}}
```

**TraceStep 结构：**
```typescript
interface TraceStep {
  id: string;
  type: "tool_call" | "thinking" | "compaction";
  status: "running" | "completed" | "error";
  toolName?: string;
  toolInput?: Record<string, unknown>;
  toolOutput?: string;     // 截断到 800 字符
  error?: string;
  startTime: number;
  endTime?: number;
}
```

### 4.5 系统事件

```typescript
// 文件夹选择结果
{ type: "folder.selected", payload: { path: string } }

// 配置状态变更
{ type: "config.status", payload: {
    isConfigured: boolean;
    config: AppConfig;
}}

// 沙箱设置进度
{ type: "sandbox.progress", payload: SandboxSetupProgress }

// 沙箱同步状态（per-session）
{ type: "sandbox.sync", payload: SandboxSyncStatus }

// 工作目录变更
{ type: "workdir.changed", payload: { path: string } }

// 导航指令
{ type: "navigate.to", payload: {
    page: "welcome" | "settings" | "session";
    tab?: string;
    sessionId?: string;
}}

// 系统主题变更
{ type: "native-theme.changed", payload: { shouldUseDarkColors: boolean } }

// 全局错误
{ type: "error", payload: {
    message: string;
    code?: "CONFIG_REQUIRED_ACTIVE_SET";
    action?: "open_api_settings";
}}

// 自动更新事件
{ type: "update.available", payload: { version: string } }
{ type: "update.progress", payload: { percent, bytesPerSecond, transferred, total } }
{ type: "update.downloaded", payload: { version: string } }
{ type: "update.error", payload: { message: string } }
{ type: "update.not-available", payload: {} }
```

### 4.6 Goal 状态

```typescript
{ type: "goal.status", payload: {
    sessionId: string;
    status: "active" | "paused" | "complete" | "cleared" | "blocked" | "budget_limited";
    objective?: string;      // 目标描述
    iteration?: number;      // 当前迭代
    tokensUsed?: number;     // 已用 token
    tokenBudget?: number;    // Token 预算
    timeUsedSeconds?: number;
    timeBudgetSeconds?: number;
}}
```

### 4.7 子 Agent 生命周期

```typescript
{ type: "subagent.lifecycle", payload: {
    sessionId: string;
    agentId: string;
    agentType: string;
    description?: string;
    parentToolCallId?: string;
    status: "running" | "completed" | "error";
    toolUses?: number;
    tokens?: unknown;
    durationMs?: number;
    error?: string;
}}
```

### 4.8 Pi 扩展生态事件

```typescript
// 项目信任确认
{ type: "pi.trust-prompt", payload: PiTrustPrompt }

// 扩展 UI 对话框
{ type: "pi.ui-request", payload: PiUiRequest }

// 扩展通知
{ type: "pi.notify", payload: { message: string; type: string } }

// 状态栏定制
{ type: "pi.set-status", payload: { key: string; text: string | undefined } }
{ type: "pi.set-widget", payload: { key: string; lines: string[] | undefined } }

// 包安装进展
{ type: "pi.package-progress", payload: { action, source?, message?, type? } }

// 终端 TUI
{ type: "pi.tui.open", payload: PiTuiOpenEvent }
{ type: "pi.tui.close", payload: {} }
{ type: "pi.tui.frame", payload: PiTuiFrameEvent }

// 命令注册变更
{ type: "commands.changed", payload: { cwd: string } }

// 命令执行通知
{ type: "pi.command-executing", payload: { sessionId: string; command: string } }

// 扩展设置编辑器文本
{ type: "pi.set-editor-text", payload: { text: string } }

// 会话跨窗口激活
{ type: "session.activate", payload: { session: Session } }
{ type: "session.create", payload: { session: Session } }
```

### 4.9 远端通道事件

```typescript
// 通道配对（二维码扫描流程）
{ type: "remote.channelPairing", payload: ChannelPairingEvent }

// 通道实例状态
{ type: "remote.channelStatus", payload: ChannelInstanceStatus }
```

---

## 5. Preload 桥接层

**文件：** `src/preload/index.ts`

### 5.1 API 暴露结构

```typescript
contextBridge.exposeInMainWorld("electronAPI", {
  // === 核心 IPC ===
  send: (event: ClientEvent) => void,            // 白名单校验 + ipcRenderer.send("client-event")
  invoke: <T>(event: ClientEvent) => Promise<T>, // 白名单校验 + ipcRenderer.invoke("client-invoke")
  on: (callback: (e: ServerEvent) => void) => () => void,  // fan-out 订阅

  // 标量 API
  platform: NodeJS.Platform,
  getSystemTheme: () => Promise<{ shouldUseDarkColors }>,
  getVersion: () => Promise<string>,
  openExternal: (url: string) => Promise<boolean>,
  showItemInFolder: (path: string, cwd?: string) => Promise<boolean>,
  selectFiles: () => Promise<string[]>,
  readFile: (path: string) => Promise<ReadFileResult>,
  listDirectory: (path: string) => Promise<FileEntry[]>,
  openPath: (path: string) => Promise<void>,
  getVideoSourceUrl: (path: string) => Promise<string>,

  // === 领域 API 命名空间 ===
  window:   { minimize, maximize, close, onFullScreenChanged },
  config:   { get, getPresets, save, saveProvider, deleteProvider, setActiveProvider,
              isConfigured, test, listModels, fetchOpenRouterModels, diagnose, discoverLocal },
  browser:  { toggle, show, hide, navigate, getStatus, goBack, goForward, reload, stop,
              setBounds, setTheme, enterFullscreen, exitFullscreen, onStateChanged },
  mcp:      { getServers, getServer, saveServer, deleteServer, getTools, getServerStatus, getPresets },
  skills:   { getAll, install, delete, setEnabled, validate, getGlobalSkillsPath, packageToZip,
              fingerprint CRUD, readSkillMd, installedMeta CRUD, getStoragePath, setStoragePath,
              openStoragePath },
  sandbox:  { getStatus, checkWSL, checkLima, installNodeInWSL, installPythonInWSL,
              installNodeInLima, installPythonInLima, startLimaInstance, stopLimaInstance,
              retrySetup, retryLimaSetup },
  logs:     { getPath, getDirectory, getAll, export, open, clear, setEnabled, isEnabled, write },
  remote:   { getConfig, listChannels, createChannel, updateChannel, deleteChannel,
              getChannelStatus, getChannelPairings, getChannelLogs },
  schedule: { list, create, update, delete, toggle, runNow },
  memory:   { getOverview, search, read, rebuildWorkspace, clearWorkspace, clearCoreMemory,
              rebuildAll, listFiles, readFile, inspectSession, setEnabled },
  auth:     { login, logout, status },
  openrouterAuth: { login, logout, status },
  cloudAuth: { googleLogin },
  subagent: { listAgents, setAgentModel, createAgent, deleteAgent },
  piExtensions: { resolveTrust, respondTrust, sdkVersion, listExtensions, listState,
                   installPackage, removePackage, updatePackage },
  piMarket: { search, download, detail },
  piUi:     { respond },
  piTui:    { input, resize },
  piCommands: { list },
  file:     { saveToTemp, extractArchive, removeTemp },
  review:   { getDiffFiles, getFileDiff, pushDiff, clearDiff },
  git:      { hasChanges, revertFiles },
  artifacts: { listRecentFiles },
});
```

### 5.2 白名单机制

```typescript
const ALLOWED_CLIENT_EVENTS = new Set<ClientEvent["type"]>([
  "session.start", "session.continue", "session.setThinkingLevel",
  "session.setProviderModel", "session.stop", "session.compact",
  "session.abortCompaction", "session.steer", "session.delete",
  "session.batchDelete", "session.list", "session.getMessages",
  "session.getTraceSteps", "permission.response", "sudo.password.response",
  "settings.update", "folder.select", "workdir.get", "workdir.set",
  "workdir.select", "project.create", "project.delete",
  "update.check", "update.install",
]);
```

白名单在 `send` 和 `invoke` 中均生效，不在白名单中的 event.type 会被直接拒绝。

### 5.3 Fan-out 订阅模式

```typescript
// 所有渲染进程订阅者共享一个 ipcRenderer 监听器
const registeredCallbacks = new Set<(event: ServerEvent) => void>();

window.electronAPI.on = (callback) => {
  registeredCallbacks.add(callback);
  if (!ipcListener) {
    ipcListener = (_event, data) => {
      registeredCallbacks.forEach((cb) => cb(data));
    };
    ipcRenderer.on("server-event", ipcListener);
  }
  // 返回取消订阅函数
  return () => {
    registeredCallbacks.delete(callback);
    if (registeredCallbacks.size === 0 && ipcListener) {
      ipcRenderer.removeListener("server-event", ipcListener);
      ipcListener = null;
    }
  };
};
```

---

## 6. 领域 API 通道

每个领域 API 通过 `ipcMain.handle("<namespace>.<method>")` 注册，Preload 直接暴露为 `electronAPI.<namespace>.<method>()`。这些通道不使用 `ClientEvent`/`ServerEvent` 联合类型，而是各自独立定义参数和返回类型。

### 6.1 API 通道完整清单

| 命名空间 | 方法示例 | 用途 |
|----------|----------|------|
| `config` | `get`, `save`, `saveProvider`, `deleteProvider`, `test`, `listModels`, `diagnose` | 配置和模型管理 |
| `browser` | `toggle`, `navigate`, `getStatus`, `setBounds`, `setTheme` 等 | 内置浏览器控制 |
| `mcp` | `getServers`, `saveServer`, `deleteServer`, `getTools`, `getServerStatus` | MCP 服务器管理 |
| `skills` | `getAll`, `install`, `delete`, `setEnabled`, `validate`, `fingerprint` CRUD | 技能管理 |
| `sandbox` | `getStatus`, `checkWSL`, `checkLima`, `installNodeInWSL`, `retrySetup` | 沙箱管理 |
| `logs` | `getPath`, `getAll`, `export`, `clear`, `setEnabled`, `write` | 日志管理 |
| `remote` | `getConfig`, `listChannels`, `createChannel`, `deleteChannel`, `getChannelPairings` | 远端通道管理 |
| `schedule` | `list`, `create`, `update`, `delete`, `toggle`, `runNow` | 定时任务 |
| `memory` | `getOverview`, `search`, `read`, `rebuildWorkspace`, `clearWorkspace` | 记忆管理 |
| `auth` / `openrouterAuth` / `cloudAuth` | `login`, `logout`, `status` | 多种认证 |
| `subagent` | `listAgents`, `setAgentModel`, `createAgent`, `deleteAgent` | 子 Agent 管理 |
| `piExtensions` | `resolveTrust`, `listExtensions`, `installPackage`, `removePackage` | Pi 扩展生态 |
| `piMarket` | `search`, `download`, `detail` | 扩展市场 |
| `piUi` | `respond` | 扩展对话框响应 |
| `piTui` | `input`, `resize` | 扩展 TUI 交互 |
| `piCommands` | `list` | 扩展命令列表 |
| `file` | `saveToTemp`, `extractArchive`, `removeTemp` | 临时文件操作 |
| `review` | `getDiffFiles`, `getFileDiff`, `pushDiff`, `clearDiff` | 代码审查 |
| `git` | `hasChanges`, `revertFiles` | Git 操作 |
| `artifacts` | `listRecentFiles` | 产物文件 |

### 6.2 附件上传载荷

Renderer 统一调用 `electronAPI.attachments.upload(file)`。Preload 根据 Web `File` 是否有磁盘路径选择同一 IPC 通道的载荷：

```typescript
type AttachmentUploadPayload =
  | { path: string; mimeType: string }
  | { name: string; mimeType: string; bytes: ArrayBuffer };
```

- 文件选择和拖放产生的磁盘文件通过 `webUtils.getPathForFile()` 获得路径，主进程调用 `saveLocalFiles()`。
- 截图等剪贴板内存文件没有磁盘路径，Preload 读取 `file.arrayBuffer()`，主进程重建 Web `File` 后调用 `saveUploadedFiles()`。
- 两条分支共享领域层的文件名、扩展名、大小校验以及附件文件与数据库记录写入流程，返回相同的 `PublicAttachment` 结构。
- 内存文件使用 `ArrayBuffer` structured clone 传输，不使用 base64。

---

## 7. 会话生命周期数据流

### 7.1 启动新会话 (session.start)

```
[用户输入 + 点击发送]
      │
      ▼
  renderer: electronAPI.invoke({ type: "session.start", payload })
      │
      │  ipcRenderer.invoke("client-invoke", event)
      ▼
  main: handleClientEvent(event)
      │
      ├─ 检查: configStore.hasAnyUsableCredentials() → 否则返回 error
      ├─ 检查: workspace path 是否支持
      ▼
  sessionManager.startSession(title, prompt, cwd, ...)
      │
      ├─ createSession() → Session { id, status:"running", cwd, ... }
      ├─ saveSession(db) → SQLite 持久化
      ├─ enqueuePrompt(session, prompt, content, turnId)
      │     ├─ push { prompt, content, turnId } 到 per-session 队列
      │     └─ 如果 session 不在 activeSessions:
      │         spawn processQueue(session) [异步]
      │
      └─ return session ←─────── invoke 响应返回给 renderer
              │
              ▼
  renderer: const session = await startSession(...)
              store.addSession(session)
              store.setActiveSession(session.id)
```

### 7.2 继续会话 (session.continue)

```
[用户输入后续消息]
      │
      ▼
  renderer: electronAPI.send({ type: "session.continue", payload })
      │
      │  ipcRenderer.send("client-event", event)
      ▼
  main: handleClientEvent(event)
      │
      ▼
  sessionManager.continueSession(sessionId, prompt, content, ...)
      │
      ├─ 解析文件附件 (处理临时文件)
      ├─ 拦截 /goal 命令 → 发出合成 stream.message
      ├─ 保存用户消息到 SQLite (emit stream.message for autoGenerated)
      ├─ enqueuePrompt(session, prompt, ...)
      │     └─ push 到队列 → processQueue
      │
      └─ (无返回值，结果通过 ServerEvent 流式推送)
```

### 7.3 队列处理 (processQueue)

```typescript
async processQueue(session: Session): Promise<void> {
  activeSessions.add(session.id);
  sendToRenderer({ type: "session.status", payload: { sessionId, status: "running" } });

  try {
    while (true) {
      const item = sessionQueue[session.id]?.shift();
      if (!item) break;
      await processPrompt(session, item.prompt, item.content, item.turnId);
      // 检查是否有新任务入队，继续处理
    }
  } finally {
    sendToRenderer({ type: "session.status", payload: { sessionId, status: "idle" } });
    activeSessions.delete(session.id);
  }
}
```

**关键特性：**
- 队列支持同一会话的多个 turn 排队等待
- `processQueue` 在 finally 中总是发出 `session.status` (idle)
- `session.stop` 清空队列并中止当前 prompt

### 7.4 processPrompt 内部流程

```
processPrompt(session, prompt, content, turnId)
      │
      ├─ resolve turnId（如果没有提供则生成）
      ├─ 处理文件附件到 .tmp 目录
      ├─ 拦截 /goal 命令 → emit synthetic user + assistant message + goal.status
      ├─ 保存用户 Message 到 SQLite
      │    └─ if (autoGenerated) sendToRenderer(stream.message)
      ├─ 回填 provider/model（如有）
      │    └─ sendToRenderer(session.update)
      │
      ▼
  agentRunner.run(session, prompt, messagesForContext, turnId, piSessionFile)
      │
      │  [SDK stream 事件 → ServerEvent，详见第8章]
      │
      ├─ 运行完成
      ├─ invoke runtimeExtension.afterSessionRun()
      │    └─ 可能 emit goal.status, summary stream.message, enqueue 续写
      ├─ async 生成标题（后台）
      │    └─ sendToRenderer(session.update) 更新标题
      │
      └─ return
```

---

## 8. 流式输出数据流

这是前后端性能最敏感的路径。当前桌面主聊天和速唤浮窗使用本地 SSE；普通领域 API 仍保持 IPC 优先、HTTP 降级。

### 8.1 单一会话事件中继

`application.electron.ts` 为每个会话创建一个 `SessionEventRelay`。它是该会话唯一的 Provider 监听器，同时负责：

- `message_end`、`tool_execution_end` 的现有持久化；
- 从 `message_update.assistantMessageEvent.delta` 提取新增文本；
- 约 32ms 合并文本 delta；
- 在工具、结束和状态等有序边界事件前强制 flush；
- 为中途连接的 SSE 客户端提供当前 turn snapshot；
- 保存仍在等待的工具确认和用户提问，供重连恢复交互。

旧的每会话 500 条完整事件队列已移除，SSE 客户端不再分别订阅 Provider。

### 8.2 文本事件协议

```typescript
type StreamTextEvent = {
  type: "stream_text";
  sessionId: string;
  relaySequence: number;
  mode: "delta" | "snapshot";
  text: string;
};

type StreamResyncRequiredEvent = {
  type: "stream_resync_required";
  sessionId: string;
  relaySequence: number;
  text?: string;
};
```

- `delta` 只包含新增文本，网络负载随最终文本长度线性增长。
- `snapshot` 仅在连接加入正在运行的 turn 时发送。
- `relaySequence` 对文本、工具、交互和结束事件使用同一会话内单调序列，前端忽略重复或过期事件。
- `message_end` 前必定 flush，并继续携带最终完整消息，作为最终一致性校正和落库边界。
- 每个 SSE 数据帧同时写入 `id: <relaySequence>`；浏览器自动重连使用 `Last-Event-ID`，应用主动重建 EventSource 时使用 `?after=<relaySequence>`。
- 游标超出有界 replay window 时发送 `stream_resync_required`，前端从 SQLite 消息接口重建最终态，不盲目重放或猜测缺失事件。

### 8.3 时序

```
Pi Agent              SessionEventRelay       SSE / Renderer
────────              ─────────────────       ──────────────
text_delta "Hel"  →   pending += "Hel"
text_delta "lo"   →   pending += "lo"
32ms timer         →   flush                  stream_text delta "Hello"
message_end        →   flush remaining        stream_text delta
                    →   persist final          message_end (final snapshot)
agent_end          →                          agent_end
```

工具、权限确认和用户提问事件不做文本合并，但发送前会先 flush 文本，以保持原始事件顺序。

### 8.4 生命周期与背压

- SSE 创建后立即写入 `: connected` 注释帧，Node HTTP 层主动刷新响应头；该帧只用于触发 `EventSource.open`，不会进入业务事件处理。
- `main.mjs` 在输入请求中断或输出响应关闭时触发真实 AbortSignal。
- SSE cleanup 幂等地清除 heartbeat 和中继订阅，并覆盖“连接先关闭、异步订阅后完成”的竞态。
- `ReadableStream` 只在 `desiredSize` 允许时出队；积压的相邻文本 delta 合并为一个字符串。
- `ServerResponse.write()` 返回 `false` 时暂停读取，等待 `drain`；连接关闭则取消 Reader。
- `SessionEventRelay` 的 replay buffer 同时限制事件数和序列化字节数；它仅用于短暂断线续传，SQLite 仍是最终消息事实源。

---

## 9. 权限/密码交互数据流

```
Agent 工具请求权限
      │
      ▼
  AgentRunner 检测到需要审批的工具
      │
      ▼
  SessionManager.requestPermission(toolUseId, toolName, input, sessionId)
      │
      ├─ 存储 resolver 到 pendingPermissions[toolUseId]
      ├─ sendToRenderer({ type: "permission.request", payload })
      │
      ▼
  [渲染进程显示权限对话框]
      │
      ├── 用户点击 allow/deny/allow_always
      │     │
      │     ▼
      │   electronAPI.send({ type: "permission.response", payload: { toolUseId, result } })
      │     │
      │     ▼
      │   SessionManager.handlePermissionResponse(toolUseId, result)
      │     │
      │     └─ resolve pendingPermissions[toolUseId](result) → Agent 继续/中止执行
      │
      └── 60 秒超时
            │
            ▼
          SessionManager 自动 resolve: "deny"
            │
            └─ sendToRenderer({ type: "permission.dismiss", payload: { toolUseId } })
                  (关闭 UI 中的对话框)
```

Sudo 密码流程与此完全对称，只是 payload 包含 `password: string | null`。

---

## 10. 渲染进程消费

**主聊天文件：** `frontend/src/store/useStore.ts`、`frontend/src/components/ChatArea.tsx`

### 10.1 状态边界

```typescript
useStore.messages               // 已完成、稳定的历史消息
useStreamStore.activeStream     // 当前正在生成的 assistant 消息
```

`stream_text` 先进入按 sessionId 隔离的模块级 buffer。渲染进程使用 `requestAnimationFrame`，并设置约 50ms 的最小提交间隔；因此即使网络事件更密集，Zustand 的流式更新通常也不超过约 20 次/秒。高频 `activeStream` 使用独立 Store，旧的整 Store 订阅者不会因此重渲染。所有事件先按 `relaySequence` 去重，再进入具体状态处理。

收到 `message_end` 时，前端同步 flush 缓冲，以后端最终完整文本校正内容，再把 `activeStream` 一次性追加到 `messages`。切换、删除或退出会话时会同时关闭 EventSource、取消调度并清除 sequence/buffer，防止跨会话串流。

### 10.2 渲染隔离

- `App` 和 `ChatArea` 使用窄 Zustand selector，不再订阅完整 Store。
- `ActiveStreamMessage` 独立订阅 `activeStream`；其更新不会令历史消息列表整体重新渲染。
- 已完成 Markdown、工具组、Widget 和交付卡片使用稳定 props 与 `React.memo`。
- 流式阶段以保真纯文本显示，避免对不断增长且可能未闭合的 Markdown 重复构建 AST；`message_end` 后解析一次最终 Markdown。
- 历史消息分组只在 `messages` 引用变化时重新计算。
- 自动滚动跟随流式提交按帧执行，用户离开底部后停止跟随。

### 10.3 连接顺序

主聊天和速唤浮窗均先建立 SSE，再启动 prompt，避免短任务在监听器就绪前完成。后端握手注释帧保证空闲会话也能立即完成这一步，不依赖首个模型事件。连接中途恢复时优先按游标重放；窗口失效则通过 `stream_resync_required` 从数据库重建，并以可选文本 snapshot 校正仍在生成的 turn。

`frontend/src/hooks/useIPC.ts` 仍服务于现有 `server-event` IPC 能力，但不承载主聊天文本流。

---

## 11. 远端通道与扩展桥接

### 11.1 远端通道消息路由

```
主进程 sendToRenderer(event)
  │
  ├─ stream.message + isAgentSession(sessionId)
  │    └─ routeRuntimeAssistantEvent()
  │         ├─ 提取 ContentBlock[] 中的 text
  │         └─ deliverAgentResponse(sessionId, turnId, text)
  │              → 发送到远端通道 (Feishu/WeChat/Discord/QQ/Slack/Telegram)
  │
  └─ 所有事件 → mainWindow.webContents.send("server-event", event)
       (本地 UI 始终接收)
```

### 11.2 扩展 UI 请求回路

```
Pi Extension 调用 dialog({ type: "select", ... })
  │
  ▼
  PiUiRuntime: sendEvent("pi.ui-request", request)
  │
  ▼
  sendToRenderer({ type: "pi.ui-request", payload: request })
  │
  ▼
  [渲染进程] ExtensionDialogs 组件显示对话框
  │
  ├── 用户响应
  │     │
  │     ▼
  │   electronAPI.piUi.respond(id, result)
  │     │
  │     ▼
  │   ipcMain.handle("pi-ui.response", (_, id, result))
  │     │
  │     ▼
  │   PiUiRuntime: resolve pendingDialogs[id] → 返回给扩展
  │
  └── 60 秒超时 → 自动 resolve null
```

---

## 12. Zustand Store 状态管理

**文件：** `src/renderer/store/index.ts`

### 12.1 核心状态结构

```typescript
interface AppState {
  // 会话
  sessions: Session[];
  activeSessionId: string | null;
  sessionStates: Record<string, SessionState>;

  // UI
  rightPanelMode: "files" | "browser" | null;
  sidebarCollapsed: boolean;
  contextPanelWidth: number;

  // 配置
  settings: Settings;
  appConfig: AppConfig | null;
  isConfigured: boolean;

  // 权限
  pendingPermission: PermissionRequest | null;
  pendingSudoPassword: SudoPasswordRequest | null;

  // 浏览器遮挡
  browserOcclusionIds: Set<string>;
  isBrowserFullscreen: boolean;

  // 工作目录
  workingDir: string | null;
}

interface SessionState {
  messages: Message[];
  partialMessage: string;           // 当前正在流式输入的文本
  partialThinking: string;          // 当前正在流式输入的 thinking
  partialByTurn: Record<string, { message: string; thinking: string }>;
  activeTurn: TurnState | null;
  pendingTurns: TurnState[];
  traceSteps: TraceStep[];
  executionClock: { startAt: number | null; endAt: number | null };
  contextWindow: number;
  compaction: CompactionState;
  steerResult: SteerResult | null;
  partialToolResults: Record<string, PartialToolResult>;
  goalStatus?: { ... };
  backgroundAgents: Array<{ id, type, description, status }>;
}
```

### 12.2 IPC 事件 → Store 操作映射

| ServerEvent | Store 操作 |
|-------------|-----------|
| `stream.message` | `deletePartialBuffer`, `addMessage` |
| `stream.partial` | `setPartialMessage` (RAF batched) |
| `stream.thinking` | `setPartialThinking` (RAF batched) |
| `stream.toolResultPartial` | `setPartialToolResult` / `clearPartialToolResult` |
| `session.status` | `updateSession`, `finishExecutionClock`, `clearActiveTurn`, `clearPendingTurns` |
| `session.update` | `updateSession` |
| `session.list` | `setSessions` |
| `session.compaction` | `updateCompactionState` |
| `session.steer.result` | `setSteerResult` |
| `session.activate` | `addSession`, `setMessages`, `setActiveSession` |
| `session.create` | `addSession` |
| `permission.request` | `setPendingPermission` |
| `permission.dismiss` | `setPendingPermission(null)` |
| `sudo.password.request` | `setPendingSudoPassword` |
| `sudo.password.dismiss` | `setPendingSudoPassword(null)` |
| `trace.step` | `addTraceStep` (RAF batched) |
| `trace.update` | `updateTraceStep` (RAF batched) |
| `config.status` | `setIsConfigured`, `setAppConfig`, `setSettings` |
| `workdir.changed` | `setWorkingDir` |
| `folder.selected` | → 导航逻辑 |
| `goal.status` | `setGoalStatus` |
| `subagent.lifecycle` | `addBackgroundAgent` / `updateBackgroundAgentStatus` / `removeBackgroundAgent` |
| `error` | `setGlobalNotice` |
| `pi.set-editor-text` | `setPendingEditorText` |
| `pi.notify` | `setGlobalNotice` |
| `sandbox.sync` | `setSandboxSyncStatus` |

---

## 13. 移植要点

### 13.1 IPC 通道设计建议

1. **保持 3 条通道结构** — `client-event`(send) + `client-invoke`(invoke) + `server-event`(push) 是最小且清晰的协议集合
2. **需要返回值的用 invoke** — 例如 `session.start`、`session.list`。不需要返回值的用 `send`，例如 `session.continue`（流式结果由 push 返回）
3. **事件白名单不可省略** — Preload 层必须校验 ClientEvent type，防止渲染进程伪造任意 IPC 通道
4. **sendToRenderer 作为单点** — 所有主进程推送都经过一个函数，便于统一路由和日志

### 13.2 流式输出核心逻辑

1. **只传 delta** — 使用 SDK 的 `assistantMessageEvent.delta`，禁止按 token 重传完整消息前缀
2. **双层合并** — 后端约 32ms 合并网络事件，前端以 RAF + 约 50ms 最小间隔提交 UI
3. **结束前 flush** — `message_end`、工具事件和 `agent_end` 不得越过尚未发送的文本
4. **最终校正** — `message_end` 的完整文本是最终一致性边界，随后才写入历史消息并解析 Markdown
5. **真实取消** — SSE 必须传播 AbortSignal、释放订阅和 heartbeat，并处理 `ServerResponse` 背压

### 13.3 会话状态管理

1. **队列模型** — `enqueuePrompt` → `processQueue` → `processPrompt` 的队列模式支持同会话多次 turn
2. **状态同步** — SessionManager 在 `processQueue` 的 finally 中总是 emit `session.status(idle)`
3. **权限超时** — 60s 超时自动 deny，并 emit dismiss 事件关闭 UI

### 13.4 需要移植的核心类型

最小移植需要实现的类型定义：

```typescript
// ClientEvent 最小集
type ClientEvent =
  | { type: "session.start"; payload: { title, prompt, cwd?, ... } }
  | { type: "session.continue"; payload: { sessionId, prompt, ... } }
  | { type: "session.stop"; payload: { sessionId } }
  | { type: "session.list"; payload: {} }
  | { type: "permission.response"; payload: { toolUseId, result } }
  | { type: "settings.update"; payload: Record<string, unknown> }
  // ... 按需扩展

// ServerEvent 最小集
type ServerEvent =
  | { type: "stream.message"; payload: { sessionId, message } }
  | { type: "stream.partial"; payload: { sessionId, delta } }
  | { type: "stream.thinking"; payload: { sessionId, delta } }
  | { type: "stream.toolResultPartial"; payload: { sessionId, toolCallId, ... } }
  | { type: "session.status"; payload: { sessionId, status } }
  | { type: "permission.request"; payload: { toolUseId, toolName, input, sessionId } }
  | { type: "trace.step"; payload: { sessionId, step } }
  | { type: "trace.update"; payload: { sessionId, stepId, updates } }
  // ... 按需扩展
```

### 13.5 领域 API 按需移植

领域 API（browser/mcp/skills/sandbox 等）采用渐进式移植策略：
- **Phase 1**：先移植 Core（3 条 IPC 通道 + 会话生命周期 + 流式输出）
- **Phase 2**：按需移植 config、browser、file（文件预览依赖）
- **Phase 3**：按需移植 mcp、skills、sandbox、remote 等

### 13.6 关键数字与超时

| 项目 | 值 |
|------|-----|
| CDP 调试端口（内置浏览器） | `9224` |
| Chrome MCP 端口 | `9222` |
| 权限请求超时 | 60 秒 |
| Sudo 密码请求超时 | 60 秒 |
| 扩展 UI 对话框超时 | 60 秒 |
| 工具输出截断长度 | 800 字符 |
| 代码行高 | 20px |
| 日志最大文件数 | 100 |

### 2026-09-18：测试产物提交与原生测试用例导入

- `GET/POST /api/conversations/:id/testing-delivery` 对应 `tapd.testingGet/testingSubmit`，复用 client.ts 的 IPC 优先、HTTP 降级和统一 API handler；preload 同步暴露 testingDelivery，client-invoke 白名单同步登记。
- GET 无 assetId 返回当前测试会话已提交 Excel 候选；带 assetId 返回不可变版本、用例数及逐行回执。resultsOnly=1 只读回执；destinationsOnly=1 返回当前项目 TestX 用例库/版本/目录组合及完整路径，读取失败以 destinationError 明确说明，保留文件选择及产物提交能力。
- POST action=submit、customField 将最新明确交付的正式产物登记需求资产并同步需求附件，不要求工作流目标；action=import、assetId、hash、target（repoId/versionId/folderId）通过 TestX 导入原生测试协同用例，原生 Issues 关联当前需求。不接受 mapping、任意文件路径、凭证或外部项目；后端重新验证目标属于当前可信 workspace。
- 身份、需求归属、测试阶段和 team-qa--testing-expert 绑定在宿主校验；会话忙时 GET 返回 busy:true，POST 拒绝提交。生成/修改仍通过普通对话交付，testingPublishField 仅用于明确发布需求附件的对话指令，不将附件上传作为原生导入。
- 继续使用 `tapd.completionGet`、`tapd.completionSubmit` 和 preload 现有通用 call/invoke 桥接，不新增 Node.js 渲染进程能力或跨层访问，也不将 TAPD token 传入专家脚本。

### 2026-09-23：测试执行配置与报告采集

- GET/POST `/api/tapd/requirements/:workspaceId/:storyId/testing-execution` 对应 `tapd.testingExecutionGet/testingExecutionSave`，同步前端路由和 preload。只接受可信主窗口主 frame 的直接 IPC；HTTP 降级返回 403，不开放远程连接器操作。
- 宿主按登录会话和需求所属账号校验。POST 支持 saveTarget、importPackage、validate、prepareRun、collect、closeRun；prepareRun 仅登记，collect 仅通过配置的 Jenkins MCP 读取准确构建及制品。
- 不改原有测试产物交付和 TAPD 用例导入协议。固定页面 URL 和部署版本接口由目标配置提供，凭据留在现有连接器及 CI。

### 微信 CLI 路径检测

测试配置通过既有 `tapd.testingExecutionSave` 发送 `action: "detectWechatCli"`，返回 `{ paths: string[], message: string }`。复用前端 API 映射、preload 白名单和 IPC handler；HTTP 端仍要求可信 IPC 标记及登录需求归属。检测只读取本机常见安装路径/PATH，不执行工具。多结果由用户选择，自动回填不自动保存配置。参见 [检测设计](./designs/2026-09-23-wechat-cli-detection-design.md)。

### 发送草稿显示时机

Composer 在发起 sendMessage 前保存草稿快照并立即清空正文与附件显示，请求期间暂禁编辑；返回失败或抛出异常时恢复快照，成功不再延后清空。请求、SSE 与附件在途保护保持不变。需求侧栏导航禁止收缩，内容单独滚动。参见 [交互修复设计](./designs/2026-09-23-composer-clear-and-inspector-tabs-design.md)。

### 需求本地恢复与 TAPD 授权边界

已有需求的 inputs 管理、GET assets 及已有 requestKey 会话恢复按当前登录账号验证本地 requirement_spaces 归属，不再把 TAPD token 作为本地读取前置条件。首次打开需求在远端验证成功后建立空间；新会话创建、远端附件读取及写入沿用实时授权校验。接口路径、preload 和 IPC 映射不变。

前端 ApiError 对 TAPD 授权错误发送本地通知，项目页合并检查并提供原地授权；定期和窗口聚焦检查覆盖长期停留场景。授权恢复只刷新读取，上传和流转不自动重放。

授权确认成功后，主进程补查账号级授权的项目列表，连接器卡片通过回调将确认快照同步项目容器；容器忽略确认前尚未结束的旧快照，恢复时只刷新读取。已有有效授权缺少项目列表时按 grant/revision 每分钟最多补查一次（显式项目发现除外）。

浏览器自动化：GET/POST /api/system/browser-automation 分别映射 system.browserAutomationGet / system.browserAutomationSet，POST 只接收 enabled 布尔值。通过既有 preload call/client-invoke 桥接及命名通道，HTTP 共用安装服务。状态包括平台、版本、安装阶段、进度和错误，前端轮询；状态读取无下载副作用。
