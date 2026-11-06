# MCP 连接器统一架构设计

> 2026-11-03 更新：凭据保存与部署配置以 [通用部署配置与凭据存储清理](./designs/2026-11-03-neutral-config-and-secret-storage-design.md) 为准。安装包不再携带 SkillHub 密钥；桌面 MCP 配置整体加密保存，旧明文文件拒绝加载。

## 1. 文档定位

本文是 PiCoddy-a 标准 MCP 连接器的长期架构文档，定义 Connector Domain、`pi-mcp-adapter`、MCP Server、Prompt Runtime、凭据和 Electron UI 之间的稳定边界。

配套迭代设计见 [统一 Connector / MCP 运行时设计](./designs/2026-08-31-unified-connector-mcp-runtime-design.md)。受管 CLI 的特殊安装和授权合同继续参考[受管 CLI 连接器框架](./superpowers/specs/2026-08-25-managed-cli-connector-framework-design.md)。

## 2. 核心结论

采用以下职责分层：

```text
Connector Domain（唯一产品与安全边界）
  ├─ Descriptor / Registry / Trust
  ├─ Install / Credential / State / Audit
  ├─ API / IPC / UI DTO
  └─ Runtime Factory
       ├─ MCP Runtime（复用 pi-mcp-adapter SDK）
       └─ Managed CLI Runtime（现有安全网关）
```

`pi-mcp-adapter` 只负责 MCP 协议和连接生命周期，不拥有产品配置、安装来源、凭据表单、用户选择和权限决策。它不能以普通 Pi 插件形态直接接管全部 MCP。

## 3. 设计原则

1. **一个 Connector 事实源。** 前后端只查询 Connector Registry/Service，不再分别维护 MCP 和 CLI 列表。
2. **协议复用，宿主管控。** MCP 的连接、OAuth、缓存和发现优先复用成熟实现；供应链、凭据、权限和 UI 仍由宿主负责。
3. **显式激活。** MCP 连接器只有被用户选入当前轮时才能向 Agent 提供能力。
4. **信任不可提升。** 用户配置 MCP 不能声明自己是内置连接器，也不能获得自动安装和受管运行权限。
5. **密钥不回读。** Renderer、SQLite、日志和普通配置文件均不能读取连接器秘密。
6. **不依赖系统运行时。** 内置 stdio MCP 使用 Electron Node 和随包 npm，不调用系统 `node`、`npm`、`npx` 或 PATH。
7. **平台协议一致。** macOS 与 Windows 共用 Descriptor 和领域服务，差异只在已有 Credential/Process 实现。
8. **失败隔离。** 单个连接器失败不影响应用、模型、技能和其他连接器启动。

## 4. 分层架构

```text
React Connector Center / Composer
                 │ IPC DTO
                 ▼
          ConnectorService
        ┌────────┼─────────┐
        ▼        ▼         ▼
    Registry  Credentials  State Store
        │        │         │
        └────────┼─────────┘
                 ▼
          ConnectorRuntimeFactory
            ┌───────────────┐
            ▼               ▼
     PiMcpRuntime       ManagedCliRuntime
            │               │
     pi-mcp-adapter     CLI Gateway + child agent
            │
      MCP stdio / HTTP / SSE
            │
            ▼
       AgentTool Adapter
            │
       Prompt Runtime
```

### 4.1 Connector Domain

负责：

- 严格解析 Descriptor；
- 合并内置、企业和用户来源；
- 计算可展示状态；
- 安装或卸载受管包；
- 保存、删除和检查凭据；
- 创建和销毁 Runtime；
- 输出脱敏 DTO；
- 记录连接器、Server 和真实 Tool 名称的审计事件。

### 4.2 Pi MCP Runtime

基于 `pi-mcp-adapter` 的 `createMcpAdapter()` SDK入口封装，负责：

- stdio、Streamable HTTP、SSE；
- lazy connect、idle release、keep-alive 和 reconnect；
- 请求超时；
- tools/resources/prompts/instructions 元数据；
- MCP OAuth协议执行；
- outputSchema 和 structuredContent 校验；
- 大输出保护；
- 元数据缓存。

宿主封装必须关闭或绕过：

- Claude/Cursor/Codex 等宿主配置自动发现；
- `.mcp.json`、`.pi/mcp.json` 的自主写入；
- `/mcp setup`、`/mcp-auth` 等 Pi TUI 命令；
- 状态栏和 Pi 专属交互面板；
- 模型自主连接任意已配置 Server；
- 未经 Registry 选择的 direct tools。

### 4.3 Managed CLI Runtime

继续负责钉钉这类具备官方 CLI 合同的平台：

- 精确包和完整性锁；
- install/auth/status/logout/schema；
- CLI Skill；
- 隐藏 connector-agent；
- `connector_cli_execute` 安全网关。

Managed CLI 与 MCP Runtime 共用 Connector Service，但不互相模拟。

## 5. Descriptor V2

```ts
type ConnectorDescriptorV2 =
  | ManagedMcpDescriptor
  | RemoteMcpDescriptor
  | ManagedCliDescriptor;

interface ConnectorBaseDescriptor {
  schemaVersion: 2;
  id: string;
  version: string;
  displayName: string;
  description: string;
  presentation: { icon: string };
  trust: "builtin-reviewed" | "enterprise-managed" | "user-configured";
  capabilities: string[];
  credentials: CredentialField[];
}
```

### 5.1 Managed MCP

```ts
interface ManagedMcpDescriptor extends ConnectorBaseDescriptor {
  transport: "mcp-stdio";
  runtime: { type: "managed-node-npm"; profile: "default" };
  install: {
    package: string;
    version: string;
    tarball: string;
    integrity: string;
    bin: string;
  };
  mcp: {
    args: string[];
    lifecycle: "lazy" | "lazy-keep-alive" | "keep-alive";
    requestTimeoutMs: number;
    idleTimeoutMinutes: number;
  };
}
```

只有内置审核或企业签名 Catalog 可声明自动安装。

### 5.2 Remote MCP

```ts
interface RemoteMcpDescriptor extends ConnectorBaseDescriptor {
  transport: "mcp-http" | "mcp-sse";
  endpoint: string;
  mcp: {
    lifecycle: "lazy" | "lazy-keep-alive" | "keep-alive";
    requestTimeoutMs: number;
  };
}
```

生产只允许 HTTPS。开发模式只对 loopback 地址允许 HTTP。

### 5.3 Managed CLI

沿用现有 install、executable、auth、status、logout、commandPolicy 和 errors 合同，增加 `schemaVersion: 2`、`transport: "managed-cli"` 与共享凭据/展示字段。

## 6. 信任模型

| 来源 | 可使用 Remote MCP | 可执行本地文件 | 可自动安装 npm 包 | 可运行 postinstall | 可显示为内置 |
|---|---:|---:|---:|---:|---:|
| builtin-reviewed | 是 | 是 | 是 | 仅审核声明 | 是 |
| enterprise-managed | 是 | 经签名策略 | 经签名策略 | 默认否 | 企业标识 |
| user-configured | 是 | 显式文件选择 | 否 | 否 | 否 |

Renderer 不能提交 `trust`、package、integrity、bin、allowedDomains 或运行时类型。用户配置只提交允许的 endpoint、显示名称和凭据字段值。

## 7. 凭据模型

```ts
interface CredentialField {
  id: string;
  label: string;
  kind: "secret" | "text" | "url";
  required: boolean;
  injection: {
    target: "env" | "header";
    name: string;
    format?: "raw" | "bearer" | "basic";
  };
}
```

存储合同：

- macOS：Keychain；
- Windows：Credential Manager；
- service：`picoddy-a.connector.<connectorId>`；
- account：`<fieldId>`；
-状态响应仅包含 `configured`，不包含掩码后密钥；
- 更新凭据增加 credential revision，并关闭使用旧 revision 的 Runtime。

OAuth token 若交由 `pi-mcp-adapter` 管理，也必须通过注入的宿主 Credential Store Adapter 落入相同系统凭据边界，不能写到其默认项目目录。

## 8. Runtime 生命周期

```text
select connector
  -> validate descriptor/state/credentials
  -> acquire runtime by connectorId + descriptorRevision + credentialRevision
  -> adapter lazy connect
  -> discover metadata
  -> expose selected tools/proxy
  -> execute with timeout and permission policy
  -> idle release / explicit disconnect / application shutdown
```

缓存键不能只使用 Connector ID，否则凭据或 Descriptor 更新后会复用旧连接。

Runtime 状态：

```ts
type ConnectorRuntimeState =
  | "not_installed"
  | "needs_configuration"
  | "disconnected"
  | "connecting"
  | "ready"
  | "auth_required"
  | "auth_expired"
  | "connection_failed"
  | "runtime_broken";
```

## 9. Agent 暴露协议

### 9.1 显式选择

Composer 当前轮提交：

```ts
interface ConnectorSelection {
  connectorId: string;
  activation: "current-turn";
}
```

后端根据 Registry 解析，不接受 Renderer 提交 endpoint、command、headers 或 tools。

### 9.2 Proxy 与 Direct Tool

默认使用 Adapter 的单一代理工具减少上下文：

```text
mcp({search}) -> mcp({describe}) -> mcp({tool,args})
```

内置 Descriptor 可审核声明少量 `directTools`。Direct Tool 必须满足：

- 名称固定且无冲突；
- Schema 已缓存并校验；
- 保留 MCP annotations；
- 真实调用仍经过 Adapter；
- 权限和审计记录真实 server/toolName。

用户配置不能默认把全部工具提升为 Direct Tool。

### 9.3 权限

- MCP 可见性由显式选择决定；
- Permission Policy 在执行时决定放行、确认或拒绝；
- `readOnlyHint !== true` 不能进入只读工具集；
- 文件路径参数继续经过 MCP Path Guard；
- 子代理只继承父轮已选择连接器，不能执行 connect/install/configure。

## 10. API 与 IPC

```text
GET    /api/connectors
GET    /api/connectors/:id
POST   /api/connectors/:id/install
POST   /api/connectors/:id/configure
POST   /api/connectors/:id/connect
POST   /api/connectors/:id/disconnect
POST   /api/connectors/:id/reauthorize
DELETE /api/connectors/:id
```

`configure` 请求只允许 Descriptor 声明的字段。响应示例：

```json
{
  "id": "tapd",
  "state": "ready",
  "credentials": {
    "apiToken": { "configured": true },
    "workspaceId": { "configured": true }
  },
  "toolCount": 18
}
```

IPC 必须继续通过 `client.ts -> preload.cjs -> ipc-handlers.ts -> handleApi`，业务逻辑只在 Connector Domain。

## 11. UI

连接器中心展示：

- 名称、图标和能力说明；
- 内置、企业或用户配置来源；
- 安装/配置/连接状态；
- 凭据字段表单；
- 工具数量；
- 最近一次脱敏错误；
- 安装、连接、断开、重新授权、删除操作。

Composer “＋ → 连接器”只显示可用于当前轮的 `ready` 连接器，不承担安装或密钥输入。

## 12. TAPD 和企业微信

### TAPD

采用 Managed MCP stdio：审核并锁定第三方 TAPD MCP 包，凭据声明 `API_TOKEN` 或 Basic Auth，并允许 workspace/user 等非秘密配置。进入内置 Catalog 前必须完成许可证、维护活跃度、依赖、工具写能力和 macOS/Windows 启动审查。

### 企业微信

拆成：

- `wecom-webhook`：群机器人发送，最小凭据和权限；
- `wecom-app`：CorpID、Secret、AgentId，自建应用能力；
- 接收消息：企业部署 Remote MCP，负责公网回调、验签、解密和持久化。

桌面客户端不直接开放公网回调端口。

## 13. 失败与错误码

| 错误码 | 含义 |
|---|---|
| `CONNECTOR_DESCRIPTOR_INVALID` | Descriptor 不合法 |
| `CONNECTOR_NOT_CONFIGURED` | 缺少必填凭据 |
| `CONNECTOR_INSTALL_FAILED` | 受管包安装失败 |
| `CONNECTOR_RUNTIME_UNAVAILABLE` | 运行时不匹配或入口缺失 |
| `MCP_CONNECTION_FAILED` | MCP 握手失败 |
| `MCP_AUTH_REQUIRED` | 需要授权 |
| `MCP_AUTH_FAILED` | 授权失败 |
| `MCP_REQUEST_TIMEOUT` | MCP 请求超时 |
| `MCP_TOOL_NOT_ALLOWED` | 工具未被当前轮或权限策略允许 |
| `MCP_PROTOCOL_ERROR` | MCP Schema/响应不符合协议 |

错误日志不能包含 headers、environment、token、webhook key、完整凭据表单或授权 code。

## 14. 删除的旧边界

架构切换完成后删除：

- 独立 `mcp.json` 生产配置链；
- `/api/mcp*` 独立 API；
- 前端独立 MCP Store；
- `src/agent/mcp.ts` 中自建连接池；
- 启动时全局连接 MCP 的任何路径；
- Pi Adapter 的宿主配置自动发现和配置写入能力。

不建立旧实现 fallback 或双写。

## 15. 演进边界

后续允许：企业签名 Catalog、完整 OAuth Provider、MCP Resources/Prompts UI、健康检查、远程策略和连接器 Marketplace。

后续仍禁止：模型自主安装、隐式从 Prompt 推断连接器、Renderer 读取密钥、未审核包自动执行和跨会话全局工具注入。
