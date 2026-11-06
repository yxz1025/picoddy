# 统一 Connector / MCP 运行时设计

## 背景

项目当前存在两套外部能力入口：

- `src/agent/mcp.ts` 读取用户 `mcp.json`，支持 stdio、SSE 和 Streamable HTTP，按当前任务显式注入 MCP Tools；它接入快，但依赖系统命令/PATH，凭据主要来自配置或环境变量，缺少安装、凭据和更新生命周期。
- `src/domains/connector/node/*` 管理应用审核的 CLI 连接器，提供精确版本、完整性锁、授权域名、状态机、隐藏子会话和命令网关；它安全完整，但目录协议只接受具备特定安装、授权和 Schema 命令的 npm CLI，不能直接承载标准 MCP Server。

这两个机制的安全等级不同，但在产品上都叫“连接器”。继续为 TAPD、企业微信分别增加专项 API 或第三条适配链，会重复凭据、状态、前端和工具装配逻辑。

## 目标

- 建立一个统一的 Connector 领域模型和前端管理入口。
- 标准 MCP 成为首选工具传输协议，支持 stdio、Streamable HTTP 和 SSE。
- 保留受管 CLI 作为一种运行时类型，而不是独立产品体系。
- 审核过的本地 MCP 包使用应用现有受管 Node/npm 运行时安装和启动，不依赖系统 Node、npm、npx 或 PATH。
- 凭据只保存引用，真实值进入系统 Keychain/Credential Manager。
- 保持 MCP 工具“当前任务显式选择、下一轮不继承”的既有隔离规则。
- TAPD 能通过受管 stdio MCP 或用户自定义 MCP 快速接入。
- 企业微信能覆盖群机器人 Webhook和企业自建应用凭据场景。
- 保持 macOS 与 Windows 使用同一领域协议，仅在既有平台凭据和进程层处理差异。

## 非目标

- 第一期不自行实现 TAPD 或企业微信完整 OpenAPI SDK。
- 第一期不实现通用浏览器 OAuth/OIDC 授权服务器、回调监听和 token 刷新。
- 不允许模型安装连接器、填写密钥、选择任意包或修改运行时参数。
- 不允许未审核 MCP 包进入内置目录或使用“官方连接器”标识。
- 不实现 MCP Apps、独立 WebView 或远程 Connector Marketplace。
- 不改变 Prompt Runtime 的显式 MCP 选择和权限执行策略。
- 不保留旧 `mcp.json` 与新 Registry 两条生产链；切换后旧配置不继续参与工具装配。

## 现状

### 通用 MCP Host

`src/agent/mcp.ts` 已具备：

- stdio、SSE、Streamable HTTP transport；
- `listTools()` 与 `callTool()`；
- 按服务名连接、并发连接合并、generation 防止旧连接回写；
- 工具名前缀、MCP annotations 保留；
- 单轮 `PromptOptions.mcpTools` 显式注入。

缺口包括：连接超时尚未生效、无 idle disposal、凭据仍可进入 JSON、stdio 依赖外部命令、只消费 Tools。

### 受管 CLI Connector

`src/domains/connector/node/*` 已具备：

- 严格 Catalog、npm package lock 与 integrity；
- Electron Node + bundled npm 单一运行时；
- staging、原子安装、状态恢复、授权域名和进程网关；
- Keychain 之外不保存 CLI token；
- 隐藏 connector-agent 和主 Agent delegate 工具。

当前 Catalog 只有钉钉，且合同要求 CLI 提供 auth/status/logout/schema，不能描述普通 MCP Server。

## 方案

### 1. 统一领域模型，不混淆信任等级

新增 `ConnectorDescriptorV2` 判别联合：

```ts
type ConnectorDescriptorV2 =
  | ManagedMcpConnectorDescriptor
  | RemoteMcpConnectorDescriptor
  | ManagedCliConnectorDescriptor;

type ConnectorTrust = "builtin-reviewed" | "enterprise-managed" | "user-configured";
type ConnectorTransport = "mcp-stdio" | "mcp-http" | "mcp-sse" | "managed-cli";
```

所有类型共享：

```ts
interface ConnectorBase {
  id: string;
  version: string;
  displayName: string;
  description: string;
  icon: string;
  trust: ConnectorTrust;
  transport: ConnectorTransport;
  credentials: CredentialField[];
  capabilities: string[];
}
```

统一意味着共用 Registry、状态、凭据、API、UI 和审计；不意味着把用户配置提升为内置受信代码。`trust` 决定安装来源、展示提示和执行限制，不能由 Renderer 或模型提交。

### 2. 三种运行时

#### Managed MCP stdio

用于审核过的 npm MCP 包，例如通过审核后的 TAPD MCP：

- Catalog 固定 npm 包、精确版本、tarball、integrity、bin 和允许的环境变量名；
- 复用现有 `ManagedNpmRuntime`、Downloader、staging、锁和私有 prefix；
- 使用 Electron `process.execPath + ELECTRON_RUN_AS_NODE=1` 启动已安装 bin；
- 禁止 `npx -y`、PATH 查找和运行时下载 latest；
- 通过 SDK `StdioClientTransport` 接入。

#### Remote MCP

用于企业部署或用户提供的 Streamable HTTP/SSE 地址：

- 只允许 HTTPS；开发模式可显式允许 loopback HTTP；
- URL、transport 和 credential header 模板来自 Descriptor；
- Header 值在连接时从 CredentialStore 解析，日志与 DTO 永不返回真实值；
- 第一期不自动执行 OAuth discovery。

#### Managed CLI

保留现有钉钉实现和安全边界：

- 仍通过私有 CLI Gateway 与隐藏 connector-agent 执行；
- Catalog 升级到 V2 后作为 `transport: managed-cli` 的一个分支；
- 不把 CLI 命令伪装成 MCP，也不改变其授权/Schema 合同。

### 3. Registry 与状态

新增统一 `ConnectorRegistryV2`：

```text
builtin catalog + enterprise catalog + user descriptors
                         ↓ 严格校验
                  ConnectorRegistryV2
                         ↓
        ConnectorService / CredentialService / RuntimeFactory
```

来源规则：

- builtin：随应用发布，完整性锁定；
- enterprise：管理员受控文件或未来签名源，第一期只预留类型，不实现远程下发；
- user：只允许 remote MCP，或显式本地可执行文件；不能声明自动 npm 安装、postinstall、授权域名或受管 CLI。

状态统一为：

```ts
type ConnectorState =
  | "not_installed"
  | "needs_configuration"
  | "connecting"
  | "ready"
  | "auth_expired"
  | "connection_failed"
  | "runtime_broken";
```

Managed CLI 现有细粒度内部状态保留在 runtime projection 中，UI 映射为统一状态，不再让前端分别理解 MCP 与 CLI 状态机。

### 4. 凭据协议

Descriptor 只声明字段，不包含值：

```ts
interface CredentialField {
  id: string;
  label: string;
  kind: "secret" | "text" | "url";
  required: boolean;
  injectAs: { kind: "env" | "header"; name: string };
}
```

真实值使用现有系统凭据层保存，键采用：

```text
service = picoddy-a.connector.<connectorId>
account = <credentialFieldId>
```

- SQLite/JSON 只保存 `configured: true/false`；
- IPC 只接受写入、删除和状态查询，不提供读取明文接口；
- MCP 子进程环境只注入 Descriptor 白名单中的字段；
- 停止连接时释放进程和内存中的解析值。

第一期支持 API key、Basic Auth 字段、Webhook URL 和 client credentials 的安全存储。交互式 OAuth 在后续增加独立 `CredentialProvider`，不能塞进通用字符串模板。

### 5. MCP Session Manager

不继续扩展自研连接池。MCP Runtime 复用 `pi-mcp-adapter` 提供的 `createMcpAdapter()` SDK入口，并由 Connector Domain 包装：

```text
ConnectorService.connect(id)
  -> Registry descriptor
  -> CredentialStore resolve
  -> RuntimeFactory create transport
  -> PiMcpRuntimeFactory.create(filteredConfig)
  -> pi-mcp-adapter lazy connect
  -> listTools
  -> wrapped AgentTools
```

Adapter 负责：

- 同连接器并发连接合并；
- descriptor/credential revision 改变时关闭旧连接；
- 连接和工具调用超时；
- 应用退出时关闭全部 client/子进程；
- 可配置 idle timeout；
- 工具名冲突检查；
- 保留 `readOnlyHint` 等 annotations；
- 返回脱敏的连接错误。

Connector Domain 负责 Adapter 不应拥有的部分：

- 只向 Adapter 传入本轮显式选择的一个 Connector 配置；
- 禁用宿主配置发现和 `.mcp.json` / `.pi/mcp.json` 写入；
- 不注册 `/mcp`、`/mcp setup`、`/mcp-auth` 和状态栏 UI；
- 将 Keychain Credential Store 适配给 OAuth/请求头/环境变量解析；
- 管理 Descriptor revision、credential revision 与 Runtime cache key；
- 把 Adapter 的真实 server/toolName 投影到项目权限和审计；
- 在配置更新、断开、卸载和应用退出时销毁 Runtime。

首期默认使用 Adapter 的单 `mcp` proxy tool，内置 Descriptor 可审核声明少量 `directTools`。用户配置不能默认提升全部工具为 Direct Tool。无论暴露方式如何，审计必须记录真实 Connector、Server 和 Tool，而不是只记录 `mcp`。

第一期继续只消费 MCP Tools；Resources/Prompts 放到后续独立设计，避免扩大 Prompt Runtime 范围。

### 5.1 为什么不作为普通 Pi 插件安装

项目的 Pi 插件宿主只提供最小 ExtensionRunner 环境，而 `pi-mcp-adapter` 完整扩展会自动发现多个宿主配置、提供交互命令并允许连接任意已配置 Server。直接安装会与“当前轮显式选择”冲突，也会形成第二个配置和凭据事实源。因此采用 SDK集成，复用协议实现但由宿主限制配置、生命周期和工具暴露。

### 5.2 版本与依赖策略

- 根 `package.json` 固定通过兼容性验证的 `pi-mcp-adapter` 精确版本，不使用 caret、tilde 或 latest；当前项目 Pi `0.83.x` 与提供程序化配置入口的 Adapter 版本存在 API 差异，而 Pi `0.84.4` 的 Durable AgentHarness v2 尚未 migration-ready。现阶段暂缓 Adapter 生产接入，等待上游可迁移版本，不以深层导入、私有补丁或双版本 Pi Runtime 绕过；
- 锁文件固定所有传递依赖；
- 升级前审查配置格式、OAuth Credential Store、transport、tool wrapper 和 Extension API 变化；
- 通过宿主适配接口隔离包升级，不让业务代码直接依赖 Adapter 内部模块；
- 若公开 SDK缺少所需关闭开关，优先向上游贡献最小 API；不能复制整个 Adapter 源码形成私有 fork。

### 5.3 宿主适配接口

```ts
interface PiMcpRuntime {
  connect(): Promise<McpRuntimeMetadata>;
  proxyTool(): AgentTool;
  directTools(names: readonly string[]): Promise<AgentTool[]>;
  disconnect(): Promise<void>;
}

interface PiMcpRuntimeFactory {
  create(input: {
    connectorId: string;
    descriptorRevision: string;
    credentialRevision: string;
    server: ResolvedMcpServerConfig;
    policy: ResolvedMcpHostPolicy;
  }): Promise<PiMcpRuntime>;
}
```

Connector Service 和 Prompt Runtime 只依赖上述宿主接口，不导入 Adapter 的命令、UI 或配置文件模块。

### 6. Agent 工具暴露

- 普通 MCP：用户在 Composer 显式选择后，只把该连接器 tools 注入当前轮；发送后清除选择。
- Managed CLI：继续使用 `delegate_to_<connector>` 和隐藏 connector-agent。
- Subagent：只能继承父轮已经显式选择的 MCP 工具，不能自行连接新 Connector。
- Ask、Plan、Skill Creator 是否开放 MCP 继续服从现有 Prompt Runtime，不在本次改变。
- 所有 MCP 工具继续经过 path guard、permission policy 和审计；只读性由服务器 annotations 决定，缺失时 fail closed。

### 7. API、IPC 与 UI

统一 API：

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

`configure` 只接收 Descriptor 声明字段，写入后返回掩码状态，不返回值。IPC 继续通过 `client.ts -> preload -> ipc-handlers -> handleApi` 的既有统一链路，不增加 Renderer Node 能力。

连接器中心统一展示：来源、信任等级、安装/配置/连接状态、工具数量和最近错误。Composer “＋ → 连接器”只列出 `ready` 的 Connector；选择仍为单轮状态。

### 8. TAPD 接入

首选 `Managed MCP stdio`：

- 选定一个经过代码、许可证、发布者和依赖审查的 TAPD MCP npm 包；
- 固定精确版本和 integrity，不使用 latest；
- 凭据字段支持 `TAPD_API_TOKEN`，并可选 `TAPD_WORKSPACE_ID`、`TAPD_CURRENT_USER`；
- 若企业仍使用 Basic Auth，则增加 `TAPD_API_USER/TAPD_API_PASSWORD` 字段组；
- Descriptor 只在包审计和 macOS/Windows 实机验证后进入 builtin catalog。

用户也可在正式内置前通过 Remote MCP 或显式本地 MCP 配置接入，但 UI 必须标记“用户配置”。

### 9. 企业微信接入

拆为两个 Descriptor，避免把权限模型混在一起：

1. `wecom-webhook`：只发送群机器人消息，凭据为 Webhook URL，能力和风险最小；
2. `wecom-app`：自建应用能力，凭据为 CorpID、Secret、AgentId，可提供通讯录、应用消息、文档、日程等工具。

两者均优先复用经过审核的 MCP Server。接收消息、回调验签和 EncodingAESKey 需要常驻公网 HTTPS 回调，不属于桌面 stdio MCP 的快速接入范围，后续采用企业部署 Remote MCP 服务解决，不在桌面客户端直接开放监听端口。

### 10. 迁移与删除

- Catalog 直接升级到 schema V2，不保留 V1 fallback。
- 现有钉钉条目转换为 `managed-cli` V2。
- 删除 `src/agent/mcp.ts` 作为独立配置/连接实现，逻辑迁入 Connector Domain。
- 删除旧 `/api/mcp*`、`mcp.json` 生产读取和前端 MCP 独立状态；统一使用 `/api/connectors*`。
- 不自动复制旧 `mcp.json` 中的密钥，避免把明文秘密迁入新系统；升级后用户需要在统一连接器界面重新配置。
- 自动化中的 connector 字段继续保存 Connector ID，由统一 Service 解析。

## 分期实施

### 第一期：统一底座

- Descriptor V2 与严格校验；
- 统一 Registry/Service/状态 DTO；
- CredentialStore；
- `pi-mcp-adapter` SDK宿主封装；
- managed MCP stdio + remote MCP；
- 钉钉 V2 迁移；
- API/IPC/UI 合并；
- 删除旧 MCP 生产链。

实施顺序固定为：

1. 定义 Descriptor V2、严格校验器和脱敏 DTO；
2. 建立 CredentialStore 与 revision，不接 UI；
3. 建立 PiMcpRuntimeFactory，先接 Remote MCP；
4. 接入 Managed MCP stdio 与现有受管 Node/npm；
5. 让 Prompt Runtime 从 Connector Service 获取 proxy/direct tools；
6. 合并 API、IPC、Store 和连接器中心 UI；
7. 转换钉钉 Catalog，并删除旧 MCP 生产链；
8. 更新自动化与子代理继承链；
9. 完成静态检查后，等待用户授权进行真实运行验证。

建议源码结构：

```text
src/domains/connector/
├── model/
│   ├── descriptor.ts
│   └── state.ts
└── node/
    ├── registry_v2.ts
    ├── credential_store.ts
    ├── service_v2.ts
    ├── runtime_factory.ts
    ├── pi_mcp_runtime.ts
    ├── managed_mcp_driver.ts
    └── managed_cli_driver.ts
```

实施完成后去掉 `_v2` 后缀并删除旧文件；后缀只允许存在于开发过程，不进入最终生产架构。

### 第二期：首批业务连接器

- 审核并锁定 TAPD MCP；
- 审核并锁定企业微信群机器人 MCP；
- 增加凭据表单与连接诊断；
- macOS/Windows 行为验证。

### 第三期：企业部署能力

- 企业签名 Catalog；
- OAuth Credential Provider；
- 企业微信接收消息 Remote MCP；
- MCP Resources/Prompts；
- 连接健康检查与后台刷新。

## 影响范围

- `src/agent/mcp.ts`
- `src/domains/connector/node/*`
- `src/agent/provider.ts`
- `src/agent/tools/index.ts`
- `src/infra/keychain.ts`、`src/infra/windows_credentials.ts`
- `application.electron.ts`
- `src/electron/ipc-handlers.ts`、`src/electron/preload.cjs`
- `frontend/src/api/client.ts`
- `frontend/src/store/useSkillStore.ts`
- `frontend/src/components/Composer.tsx`
- `frontend/src/components/ComposerPlusMenu.tsx`
- `frontend/src/components/ExpertPanel.tsx`
- `resources/builtin-connectors/*`
- 自动化 Connector 解析链
- MCP、Connector、IPC 和总体架构文档

## 风险

- 第三方 TAPD/企业微信 MCP 包可能存在供应链风险，不能因协议兼容就进入内置目录。
- Catalog V2 与删除旧 `mcp.json` 会要求用户重新配置已有 MCP。
- 不同 MCP Server 对 SDK transport 和 annotations 的实现质量不同，需要 fail closed。
- Windows 子进程启动、`.cmd` 包装和 Electron-as-Node 必须复用既有平台实现，不能另写命令拼接。
- Keychain 在 Windows 的实现和安装包环境必须验证；凭据层失败时连接器应不可用，不能回退明文。
- 企业微信完整能力权限面广，必须拆分最小权限 Connector，不能用一个 Secret 默认开放全部工具。
- UI/API 合并涉及范围较大，应按领域边界实施，避免在 IPC handler 中放业务逻辑。

## 验证方式

未经用户另行授权，不执行测试套件。实施后默认只进行：

- Catalog JSON 语法与严格解析检查；
- 主进程 TypeScript 类型检查；
- 前端 TypeScript 类型检查；
- `git diff --check`；
- 搜索确认旧 `/api/mcp`、`mcp.json` 和独立 MCP Store 不再进入生产链。

需要用户明确授权后执行：

- Electron 启动验证；
- macOS/Windows 真实 MCP stdio/HTTP 连接；
- TAPD 真实 API 读写；
- 企业微信真实消息发送；
- 连接器安装、凭据删除、重连和升级恢复测试。

## 完成标准

- 前端只存在一个连接器管理和选择入口。
- 后端只存在一个 Connector Registry/Service 状态事实源。
- 普通 MCP 与受管 CLI 通过 Descriptor 的 transport 判别，不再拥有重复 API/Store。
- 内置 stdio MCP 不依赖系统 Node/npm/npx/PATH。
- 凭据不进入 JSON、SQLite、日志或 Renderer 读取响应。
- TAPD 与企业微信新增接入只需要经过审核的 Descriptor、图标和必要 Skill，不修改 Connector 核心生命周期。
