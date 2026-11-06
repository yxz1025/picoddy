# Pi Extension 扩展宿主设计

## 目标

在 PiCoddy-a 中增加一个受控的 Pi Extension 宿主，使 `pi-ui-design` 以及后续 Pi Web Extension 可以作为可安装、可启停、可嵌入 Electron 的扩展运行，而不需要把扩展代码直接耦合到 PiCoddy-a 的业务模块。

首个落地扩展为 `pi-ui-design`：它提供浏览器画布、组件拖拽、图层编辑、主题调整、原型保存和 HTML/React/Tailwind 导出。它不是普通 `SKILL.md`，而是通过 Pi `ExtensionAPI` 注册命令和工具。

## 非目标

- 不把所有 Pi 内部 API 暴露给插件。
- 不允许插件直接访问 `ipcRenderer`、数据库、用户 token 或任意 Node.js API。
- 不在首版支持远程任意 npm 包动态执行。
- 不把 `pi-ui-design` 的浏览器画布逻辑重写成 React 原生组件。
- 不用 `modern-web-guidance` 替换 `pi-ui-design`；两者分别负责生产 UI 代码规范和可视化原型。

## 用户流程

```text
新建任务 → 设计创意 → UI 设计
       → 打开 Pi UI Design 画布
       → 拖拽/绘制/调整组件和主题
       → 模型调用 read_ui_design
       → 结合 modern-web-guidance 生成生产级前端
       → build_frontend 预览
```

用户可以只使用画布，也可以让模型通过工具修改画布。关闭任务时，`.ui-design/` 项目数据保留在当前工作区。

## 总体架构

```text
Electron 主进程
 ├─ ExtensionRegistry       受信任插件 manifest
 ├─ PiExtensionHost          ExtensionAPI 兼容层
 ├─ ExtensionBridge          命令/工具/事件 RPC
 ├─ WebExtensionHost         localhost 服务 + WebContentsView
 └─ SessionAdapter            PiCoddy-a session ↔ Pi session 事件

Electron Renderer
 └─ ExtensionPanel            插件页面容器和加载状态

pi-ui-design
 ├─ index.ts                  Pi Extension 入口
 ├─ public/                   画布 HTML/CSS/JS
 └─ .ui-design/               原型、主题、评论、生成结果
```

## 插件 manifest

宿主读取 Pi 包中的 `package.json`，要求存在 `pi.extensions`。PiCoddy-a 为宿主增加一层标准化 manifest：

```ts
interface PiExtensionManifest {
  id: string;
  version: string;
  apiVersion: 1;
  packageName: string;
  entry: string;
  capabilities: readonly ExtensionCapability[];
  web?: {
    route: string;
    singleton: boolean;
  };
}

type ExtensionCapability =
  | "command.register"
  | "tool.register"
  | "session.events"
  | "webview.localhost"
  | "workspace.read"
  | "workspace.write";
```

`pi-ui-design` 初始声明：

```json
{
  "id": "pi-ui-design",
  "version": "2.0.1",
  "apiVersion": 1,
  "packageName": "pi-ui-design",
  "entry": "index.ts",
  "capabilities": [
    "command.register",
    "tool.register",
    "session.events",
    "webview.localhost",
    "workspace.read",
    "workspace.write"
  ],
  "web": {
    "route": "/ui-design",
    "singleton": true
  }
}
```

## ExtensionAPI 兼容层

宿主只实现 `pi-ui-design` 实际需要的最小 API：

```ts
interface ExtensionAPI {
  registerCommand(
    name: string,
    options: { description: string; handler: CommandHandler },
  ): void;

  registerTool(
    name: string,
    schema: JsonSchema,
    handler: ToolHandler,
  ): void;

  on(
    event: "session_start" | "message_end" | "tool_execution_end" | "session_shutdown",
    handler: ExtensionEventHandler,
  ): () => void;

  sendUserMessage(
    text: string,
    options?: { deliverAs?: "user" | "steer" },
  ): Promise<void>;

  getSessionName(): string | undefined;
}
```

所有注册项都归属于 `pluginId`。插件卸载、任务关闭或宿主异常时，宿主必须批量注销命令、工具、事件监听器和 WebView。

## pi-ui-design 命令映射

| Pi 命令 | PiCoddy-a 行为 |
|---|---|
| `/pi: ui-design start` | 打开或聚焦当前任务的 UI Design WebView |
| `/pi: ui-design stop` | 关闭 WebView 和 localhost 服务 |
| `/pi: ui-design status` | 返回 WebView/server 状态 |
| `/pi: ui-design start --blank` | 打开空白画布 |
| `/pi: ui-design start <path>` | 加载指定文件或工作区原型 |

前端“设计创意 → UI 设计”卡片不再发送 `/modern-web-guidance` 作为唯一动作，而是发送一个结构化 extension action：

```ts
{ type: "open-extension", pluginId: "pi-ui-design", command: "start" }
```

生成生产代码时，仍可继续调用 `modern-web-guidance` 或直接调用 `pi-ui-design` 的 `read_ui_design`、`build_frontend` 工具。

## pi-ui-design 工具映射

首版注册以下工具：

- `read_ui_design`
- `ui_list_components`
- `ui_add_component`
- `ui_update_component`
- `ui_remove_component`
- `ui_set_theme`
- `ui_review_component`
- `ui_read_reviews`
- `build_frontend`

工具调用规则：

1. 工具只能读写当前 session 的 workspace。
2. 路径必须经过 workspace path policy 校验。
3. 写操作必须限制在 `.ui-design/` 及其生成目录。
4. 工具执行时间、输出大小和错误格式统一由 ExtensionHost 控制。
5. 工具返回结构化 JSON，不返回原始堆栈和环境变量。

## WebView 与本地服务

`pi-ui-design` 的 Web UI 继续使用包内 `public/` 静态资源。宿主负责：

1. 在 `127.0.0.1` 启动插件 HTTP 服务。
2. 为每个打开实例生成一次性随机 token。
3. 仅允许 token、插件 id 和当前 workspace 参数进入 URL。
4. 使用 Electron `WebContentsView` 嵌入页面。
5. 禁止页面导航到外部协议，限制新窗口和下载行为。
6. 通过 preload bridge 转发工具调用和 session 事件。
7. 关闭 WebView 时停止服务、清理 token 和事件订阅。

WebView 不启用 Node integration；插件页面不能直接使用 Node、Electron 或应用 IPC。

## Session 事件桥接

宿主将 PiCoddy-a 事件转换为 Pi Extension 可理解的事件：

```ts
type ExtensionEvent =
  | { type: "session_start"; sessionId: string; workspaceDir: string }
  | { type: "message_end"; role: string; text: string }
  | { type: "tool_execution_end"; toolName: string; result: unknown }
  | { type: "session_shutdown" };
```

事件必须按 session 隔离，不能把其他窗口或其他用户的内容广播给插件。

## 安全模型

- 首版只注册内置/审核过的包。
- manifest 的 `id`、版本、入口、能力和包完整性必须校验。
- `workspace.read/write` 默认只允许当前 workspace；写入限制为 `.ui-design/`、`generated/` 和用户明确选择的导出目录。
- 插件不能读取 API key、SkillHub token、系统凭据或任意环境变量。
- WebView 请求只接受 loopback、当前 token 和宿主白名单路径。
- 命令、工具和事件执行均有超时、并发上限和统一错误归一化。
- 插件异常不能导致主进程退出；宿主记录插件 id、版本、事件类型和 requestId，不记录敏感 payload。

## 与现有 modern-web 技能的关系

`modern-web-guidance` 保留为生产实现指导：负责 React/CSS/响应式布局、可访问性、交互和视觉质量。`pi-ui-design` 负责结构原型和可视化确认。

最终产品链路是：

```text
pi-ui-design 原型
  → read_ui_design
  → modern-web-guidance 生产实现建议
  → build_frontend / 项目代码生成
```

## 分阶段交付

### Phase 1：宿主基础设施

- manifest/registry
- ExtensionAPI 最小子集
- command/tool/event 生命周期
- WebContentsView 和 localhost token
- 插件启停、崩溃、清理

### Phase 2：pi-ui-design 接入

- `/pi: ui-design start/stop/status`
- 画布 WebView
- `read_ui_design`、`ui_list_components`、`build_frontend`
- 设计创意 UI 任务卡片改为打开扩展

### Phase 3：生产工作流

- 原型完成后自动生成结构化设计上下文
- 调用 modern-web-guidance 生成生产级 UI
- 预览、反馈、重新生成闭环

### Phase 4：第三方扩展

- 包签名/哈希
- 来源白名单
- API major version compatibility
- 权限确认和插件设置页

## 验收标准

- `pi-ui-design` 可以从插件注册表加载，并在 Electron WebView 中打开。
- `/pi: ui-design start` 可以重复执行且只保留一个当前 session 的主画布。
- 画布可以保存 `.ui-design/`，模型可以调用 `read_ui_design` 和 `build_frontend`。
- 关闭任务或插件后，localhost 服务、WebView、工具和事件订阅全部清理。
- 未授权插件无法访问文件、token、任意 IPC 或外部进程。
- 现有 `modern-web-guidance`、SkillHub 技能安装和普通 slash skill 调用不回归。
