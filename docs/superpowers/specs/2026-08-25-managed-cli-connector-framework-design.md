# Managed CLI Connector Framework 设计

## 文档状态

本文是 PiCoddy-a 通用受管 CLI 连接器的权威技术设计，描述目标架构、公共协议、安全边界和第三方接入条件。实现进度以本文“实施对齐与剩余闭环”章节为准；按任务拆分的历史执行记录见 `docs/superpowers/plans/2026-08-26-on-demand-cli-connector-catalog.md`。

本文中的“连接器”专指经过应用目录审核、由应用管理安装和授权生命周期、通过隐藏子代理使用的第三方 CLI。它不等同于用户配置的 MCP，也不等同于 Pi 扩展插件。

## 目标

建立一套通用的受管 CLI 连接器框架。任何后续第三方 CLI 能力都通过同一套安装、版本、授权、状态、权限、审计、子代理和卸载协议接入，不能再在前端写死一条 `npx mcp-server-*` 配置。

首期交付通用框架和钉钉连接器。钉钉是首个目录配置和端到端验收样例，不是框架中的特殊分支。企业微信、WPS、飞书及其他标准 Node/npm CLI 后续只增加一条经过审核的 JSON 目录配置；只有出现新的运行时或授权协议时才扩展 Driver，不修改核心生命周期。

## 范围

首期包含：

- 应用审核并内置的轻量连接器目录 JSON；
- 应用内置 Node/npm 运行时；
- 每个连接器独立的私有 npm prefix；
- 声明式安装、精确版本校验、授权、状态检查、退出和卸载；
- 授权域名限制和浏览器授权流程；
- 通用 CLI 命令网关；
- 每个主会话对应一个隐藏且持久的连接器子代理；
- 主 Agent 的轻量自主委派工具；
- 权限、确认、审计、错误分类和敏感信息脱敏；
- 连接器中心真实状态和管理交互；
- 点击安装后下载的钉钉官方 `dingtalk-workspace-cli`。

首期不包含：

- 远程动态更新连接器目录；
- 未审核的用户连接器包；
- 从未经过内置目录锁定的远端清单加载可执行代码；
- 企业微信或 WPS 的正式适配器；
- 多账号或多企业切换；
- 把第三方 CLI 的全部命令直接注入主 Agent；
- 允许模型通过普通 Shell 任意执行连接器 CLI。

## 与 MCP、Pi 插件和 Skill 的边界

项目同时存在三种扩展机制，必须保持独立，不能因为都能提供工具而混用生命周期：

| 机制 | 来源与信任 | 安装/连接方式 | Agent 暴露方式 | 适用场景 |
|---|---|---|---|---|
| 受管 CLI 连接器 | 应用审核的内置目录 JSON，官方 CLI 包 | 用户点击“＋”后由宿主按锁定版本安装、授权和维护 | 主 Agent 只获得轻量 `delegate_to_<connector>`；完整 Skill 与 CLI Gateway 在隐藏子代理 | 钉钉、企业微信、WPS 等需要独立 CLI、OAuth 和生命周期的办公平台 |
| MCP 配置 | 用户或企业配置的 MCP Server | 按任务连接，连接可缓存 | 当前任务显式注入所选 MCP 工具 | 数据库、内部服务、标准 MCP Server |
| Pi 扩展插件 | 用户主动安装的 Pi 生态 npm 包 | 插件管理器安装到用户插件目录，运行时动态加载 | 插件注册的工具直接进入宿主工具装配 | `pi-mcp-adapter`、浏览器、开发工具等 Pi 扩展 |

连接器安装成功后提取出的 Skill 是连接器私有运行资源，不注册成普通内置 Skill，不出现在主 Agent 的通用技能上下文，也不通过斜杠菜单直接执行。主 Agent 是否委派由 Agent 根据委派工具描述自主判断；用户只负责安装、授权和高风险操作确认。

`pi-mcp-adapter` 可以作为 Pi 插件帮助适配标准 MCP，但它不负责官方 CLI 下载、版本锁、OAuth 页面拦截、授权状态、Skill 提取、升级回滚或隐藏连接器子会话，因此不能替代本框架。

## 已核验的 WorkBuddy 基线

本设计复用已经从本机 WorkBuddy 安装和用户目录核验的模式：

- WorkBuddy 随应用提供 Node 22.22.2 和 npm；
- CLI 连接器使用声明式 `cli.json`；
- `cli.json` 声明 runtime、init、versionCheck、auth、unAuth、status、状态匹配和授权域名；
- CLI 包安装到 `~/.workbuddy/binaries/node/cli-connector-packages/` 私有 prefix，而不是用户系统 npm prefix；
- 钉钉连接器通过 `npm install -g dingtalk-workspace-cli` 安装，通过 `dws auth login -y` 授权，通过 `dws auth status` 检查；
- 连接器包可以携带 Skill；
- WorkBuddy 的连接器能力经 ConnectorProxy/MCP 接入，MCP Server 包装为子代理并通过 handoff 接入主 Agent；
- 工具按 provider 分组，危险操作使用延迟确认。

本设计保留上述核心模式，并增加以下项目级增强：

- 每个连接器独立依赖目录，避免共享 prefix 的包和 bin 冲突；
- 安装清单不接受任意 Shell 字符串；
- 命令通过参数数组和固定可执行文件执行；
- 命令路径必须通过当前 CLI Schema 或审核资源校验；
- 每个主会话使用隐藏且持久的连接器子会话；
- 首期只把受信目录 JSON 随应用发布，CLI、Skill 和厂商资源在用户点击安装后从目录锁定的官方包获取；
- 安装切换、回滚、并发锁和敏感信息脱敏由框架统一负责。

## 方案选择

### 采用：声明式受管 CLI + ConnectorProxy + 连接器子代理

应用负责可信运行时、依赖生命周期和安全边界；第三方官方 CLI 负责厂商 API、OAuth 和自身令牌刷新；连接器子代理负责业务意图到 CLI 命令的映射；主 Agent 只看到轻量委派工具。

首期的“内置 Node/npm 运行时”不是再次下载一套 Node 到用户目录：Node 使用 Electron 当前的 `process.execPath` 并设置 `ELECTRON_RUN_AS_NODE=1`，npm 使用应用依赖中锁定并随包发布的 `npm` CLI。启动连接器服务时必须验证 Electron Node 版本和 bundled npm 版本与运行时锁一致；不依赖用户系统的 `node`、`npm`、PATH 或全局 prefix。

### 采用：内置轻量目录 JSON + 点击后安装官方包

应用启动时只读取目录配置并展示卡片。用户点击“＋”后才下载目录锁定的官方 CLI tarball，校验完整性并提取包内 Skill。这样离线时仍能展示目录，未选择的连接器不会增加安装包体积，也不会把 Skill 或工具提前加入 Agent 上下文。

### 不采用：额外开发 `connector-<vendor>` npm 适配包

钉钉官方 CLI 已包含可执行程序、授权流程、Schema 和 Skill，因此不再包装一层项目自研 npm 包。只有厂商 CLI 缺少统一协议所需能力且无法通过声明式配置表达时，才单独评审适配包；普通 Node/npm CLI 接入只增加 JSON。

### 不采用：把完整厂商资源随应用发布

完整 Skill、参考资料、脚本和许可证会显著增加应用体积，也会让“未安装”和“已安装”的边界失真。它们必须在用户明确点击安装后，从经过摘要校验的官方包中获得。

### 不采用：直接使用写死的第三方 MCP 包

`npx -y mcp-server-dingtalk` 之类的静态配置无法保证 npm 包存在、来源可信、版本稳定、授权完整或工具能力准确，也无法提供安装回滚和真实状态。

### 不采用：在项目内重写每个厂商 API

直接维护 OAuth、Token 刷新和大量 OpenAPI 会让通用框架退化为厂商专项代码，并重复官方 CLI 已经解决的问题。

## 总体架构

```text
内置 connector-catalog.json
      ↓
Connector Registry
      ↓
Catalog Entry Validator
      ↓ 用户点击“＋”
Official Package Downloader
      ↓ integrity 校验
Installed Package Validator / Skill Extractor
      ↓
Connector Runtime Driver
      ↓
Connector Lifecycle Runner
      ├─ 安装/升级/回滚/卸载
      ├─ 版本与完整性校验
      └─ 进程与文件锁
      ↓
Connector Authorization Broker
      ├─ 官方授权页面
      ├─ 授权域名限制
      └─ 状态/退出/重新授权
      ↓
Connector Command Gateway
      ├─ 固定可执行文件
      ├─ argv 校验
      ├─ Schema/Risk 校验
      └─ 结构化错误
      ↓
隐藏连接器 Subagent
      ↓
delegate_to_<connector>
      ↓
主 Agent
```

## 组件职责

### Connector Registry

读取应用随包发布的 `connector-catalog.json`，解析并验证展示元数据、官方包坐标、完整性摘要、结构化生命周期命令和 Skill 提取规则，向后端、前端和 Agent Runtime 提供同一份只读目录。读取目录不会下载、解压或加载 Skill。

首期只信任应用内置 JSON。用户的 `mcp.json`、前端输入和远端响应不能覆盖连接器身份、包名、版本、完整性摘要、安装策略、可执行文件或授权域名。

### Catalog Entry Validator

验证：

- 连接器 ID 唯一且只使用受限字符；
- catalog 及每条配置只包含已知字段；
- Registry、下载地址和授权地址只能使用审核过的 HTTPS 域名；
- npm 包名、精确版本和 `sha512` integrity 完整绑定；
- runtime、install、executable、auth、status、logout 和 commandPolicy 满足对应 Schema；
- 生命周期命令只使用 argv 数组，不接受 Shell 字符串；
- Skill 只能声明为已校验包内的归档路径和入口文件，不能指向任意本地或远端路径；
- 依赖锁中的每个包都有精确版本、Registry 和 integrity。

### Installed Package Validator / Skill Extractor

用户点击安装后，Downloader 把目录锁定的官方包下载到 staging。Validator 在运行任何包脚本之前校验 tarball integrity、包名、版本、文件类型、路径和预算；随后由受管 Driver 执行审核过的安装步骤。Skill Extractor 只从已经通过完整性校验的包内固定归档路径提取内容，拒绝符号链接、路径逃逸、压缩炸弹、重复路径、超深目录和超预算文件。提取完成的 Skill 属于该连接器的已安装版本，不进入应用内置资源，也不常驻主 Agent 上下文。

### Connector Runtime Driver

核心接口：

```ts
interface ConnectorRuntimeDriver {
  prepareRuntime(request: RuntimeRequest): Promise<PreparedRuntime>;
  install(request: InstallRequest): Promise<InstalledCli>;
  verify(request: VerifyRequest): Promise<VerificationResult>;
  resolveExecutable(request: ResolveExecutableRequest): Promise<string>;
  uninstall(request: UninstallRequest): Promise<void>;
}
```

首期只实现审核注册的 `node-npm` Driver。以后增加原生二进制、Python 或其他运行时，只能通过代码注册新的 Driver；目录配置不能声明并动态执行新的 Driver 代码。

### Connector Lifecycle Runner

负责统一状态机、安装 staging、原子切换、旧版本保留、回滚、超时、输出限制、并发互斥和卸载。

安装命令由 Driver 生成，不从目录配置拼接 Shell。Node/npm Driver 使用应用内置 npm、固定 Registry、精确包版本和独立 prefix。

### Connector Authorization Broker

按已验证目录条目执行授权、状态和退出命令，拦截 CLI 给出的授权 URL，只允许打开 `allowedDomains` 中的 HTTPS 域名。

Broker 不读取或保存第三方明文 Token。CLI 自己使用系统安全存储时，项目只保存授权状态摘要；未来必须由宿主保存凭证的连接器需要单独的受审核 Credential Provider，不能写入通用目录字段或 SQLite 明文字段。

### Connector Command Gateway

连接器子代理不能访问普通 Shell，而只能调用通用 `connector_cli_execute`：

```ts
interface ConnectorCliExecuteInput {
  connectorId: string;
  argv: string[];
  attachmentIds?: string[];
}
```

生产实现从活动子代理上下文确定 connectorId，模型不能切换到另一个连接器。Gateway 使用 `execFile` 或等价参数数组执行；可执行文件只能由 Runtime Driver 解析，输入不能包含 Shell、管道、重定向、变量替换或命令替换。

### Connector Agent Manager

授权状态为 ready 时，为主 Agent 注册轻量 `delegate_to_<connector>` 工具。完整 Skill、命令 Schema、业务说明和 CLI 工具只进入对应连接器子代理。

每个主会话与每个连接器最多对应一个隐藏子会话。子会话跨该主任务多轮保留上下文；新建任务、删除父会话、退出登录或卸载连接器时销毁。隐藏子会话不出现在左侧会话列表，其调用、确认和结果归档到父会话审计记录。

## 连接器目录协议

应用资源只包含目录与运行时锁，不包含任何钉钉专属目录、Skill、脚本、LICENSE、NOTICE 或 npm lock 文件。卡片图标复用应用已有的公共静态资源，不在连接器资源目录复制厂商文件：

```text
resources/builtin-connectors/
├── connector-catalog.json
└── connector-runtime-lock.json
```

`connector-catalog.json` 同时承担卡片展示和受管安装合同。钉钉条目采用配置驱动，不需要自研 `connector-dingtalk` npm 包：

```json
{
  "schemaVersion": 1,
  "connectors": [
    {
      "id": "dingtalk",
      "version": "1.0.0",
      "displayName": "钉钉",
      "description": "管理钉钉办公能力",
      "presentation": {
        "icon": "/logos/dingtalk.png"
      },
      "delegate": {
        "toolName": "delegate_to_dingtalk",
        "description": "当用户需要使用钉钉办公能力时委派给钉钉连接器"
      },
      "runtime": {
        "type": "node-npm",
        "version": "22.22.2"
      },
      "install": {
        "package": "dingtalk-workspace-cli",
        "version": "1.0.59",
        "registry": "https://registry.npmjs.org",
        "tarball": "https://registry.npmjs.org/dingtalk-workspace-cli/-/dingtalk-workspace-cli-1.0.59.tgz",
        "integrity": "sha512-f/dqjtpeUF9lz/uunqkgLerB1YoiXBVeM69QocjlFQeNhBYDdWI2isCRG6lzfilSVGDfm5Xp5IZvcrrsweUM3g==",
        "postInstall": {
          "path": "install.js",
          "argv": []
        }
      },
      "skill": {
        "source": "package-archive",
        "archive": "assets/dws-skills.zip",
        "entry": "SKILL.md"
      },
      "executable": {
        "darwin": "dws",
        "linux": "dws",
        "win32": "dws.cmd"
      },
      "versionCheck": {
        "argv": ["--version"],
        "outputPattern": "^dws version v1\\.0\\.59\\b"
      },
      "auth": {
        "argv": ["auth", "login", "-y", "--no-browser"],
        "allowedDomains": ["login.dingtalk.com"],
        "waitForExit": true
      },
      "status": {
        "argv": ["auth", "status"],
        "format": "json",
        "jsonMatch": {
          "authenticated": true
        }
      },
      "logout": {
        "argv": ["auth", "reset"]
      },
      "commandPolicy": {
        "schema": {
          "argv": ["schema", "--compact", "--format", "json"]
        }
      },
      "errors": {
        "AUTH_REQUIRED": ["not (?:logged in|authenticated)", "未登录"],
        "AUTH_FAILED": ["authentication failed", "认证失败"],
        "CONNECTOR_TIMEOUT": ["timed? out", "超时"],
        "NETWORK_ERROR": ["econnreset|econnrefused|enotfound", "网络(?:错误|不可用)"],
        "defaultNonZeroExit": "CONNECTOR_BROKEN"
      },
      "packages": {
        "dingtalk-workspace-cli@1.0.59": {
          "resolved": "https://registry.npmjs.org/dingtalk-workspace-cli/-/dingtalk-workspace-cli-1.0.59.tgz",
          "integrity": "sha512-f/dqjtpeUF9lz/uunqkgLerB1YoiXBVeM69QocjlFQeNhBYDdWI2isCRG6lzfilSVGDfm5Xp5IZvcrrsweUM3g=="
        }
      }
    }
  ]
}
```

目录条目必须锁定完整依赖图；示例 CLI 没有额外 npm 依赖，所以 `packages` 只有根包。若后续企业微信 CLI 存在传递依赖，目录条目必须列出每个包的精确版本、`resolved` HTTPS tarball 和 integrity，安装器不得在安装时接受未锁定的新依赖版本或下载地址。

`presentation.icon` 只用于 Renderer 展示，首期可引用应用已有公共图标；它不参与 CLI 安装或 Agent 上下文。未来远程目录若支持远程图标，必须增加独立的 URL 白名单、内容类型、大小和摘要校验，本期不实现。

## 文件与运行时布局

```text
~/.pi-a/connectors/
├── packages/
│   └── <connector-id>/
│       ├── current
│       └── versions/
│           └── <cli-version>/
│               ├── package.json
│               ├── package-lock.json
│               ├── node_modules/
│               ├── skill/
│               └── metadata.json
├── states/
│   └── <connector-id>.json
├── cache/
│   └── <connector-id>/
├── logs/
│   └── <connector-id>/
└── locks/
    └── <connector-id>.lock
```

Node 运行时来自 Electron，npm CLI 来自应用依赖，因此不在 `~/.pi-a/connectors/` 重复存放 runtime。`connector-runtime-lock.json` 是发布审核根：Registry 校验其结构和摘要，Runtime Resolver 必须验证实际 Node/npm 版本。若以后改成可下载 runtime，必须新增独立的 Runtime Downloader 与二进制摘要验证，不能复用连接器包安装器隐式下载。

目录配置版本与第三方 CLI 版本分别管理。安装先写入 `versions/.staging-<cli-version>`；`current` 只指向完成依赖安装、版本校验、Skill 提取和 metadata 写入的版本。升级先完成 staging，再原子替换版本目录并切换 `current`；失败时保留旧版本，不得把半成品作为 current。

同一连接器的安装、升级、修复和卸载使用进程内互斥和文件锁。应用崩溃后的下一次操作必须识别过期锁和未完成 staging，并按状态记录安全清理。

## 生命周期状态机

```text
not_installed
  -> installing
  -> installed_unauthorized
  -> authorizing
  -> ready
  -> auth_expired
  -> authorizing
```

错误状态：

```text
install_failed
version_invalid
auth_failed
runtime_broken
```

状态只能由后端真实操作和探测结果改变。前端配置存在不等于已安装，CLI 存在不等于已授权，授权命令退出不等于授权成功。

离线时 Registry 仍能从内置 JSON 展示全部卡片和本地真实状态；未安装连接器点击“＋”后返回可重试的网络错误，不创建 current，不弹出授权页。已经安装且 CLI 自身支持离线的操作不因目录读取受影响。

### 状态转换与允许操作

后端状态记录是唯一权威，前端只能映射展示和发起白名单操作：

| 当前状态 | 允许的主要操作 | 成功后的状态 | 失败处理 |
|---|---|---|---|
| `not_installed` | `activate` | `installed_unauthorized` → `authorizing` → `ready` | `install_failed` 或 `version_invalid` |
| `installing` | `cancel` | `not_installed` 或保留旧可用版本 | `CONNECTOR_CANCELLED` |
| `installed_unauthorized` | `reauthorize`、`logout`、`uninstall` | `authorizing` → `ready`，或保持未授权 | `auth_failed` |
| `authorizing` | `cancel` | 回到已安装未授权状态 | `CONNECTOR_CANCELLED` |
| `ready` | `reauthorize`、`logout`、`update`、`uninstall` | 依操作变化 | 保留旧可用版本并记录稳定错误 |
| `auth_expired` | `reauthorize`、`logout`、`uninstall` | `authorizing` → `ready` | `auth_failed` |
| `install_failed` / `version_invalid` / `runtime_broken` / `connector_broken` | `repair`、`uninstall` | 成功后进入授权或 ready 流程 | 保持故障状态并更新错误摘要 |

`repair` 和 `update` 可以复用安装管线，但不能覆盖仍可用的旧 current。重复操作必须由进程内锁与文件锁拒绝或串行化。`cancel` 只中止当前连接器操作，不影响其他连接器和主会话。

## 安装与授权流程

用户点击连接器“＋”：

1. Registry 读取并验证内置 `connector-catalog.json`，前端立即显示未安装卡片，不下载任何厂商资源。
2. 用户点击“＋”；Lifecycle Runner 检查运行时、已安装 CLI 版本和完整性。
3. 缺失或版本不符时，前端显示“首次使用或更新需要安装连接器依赖”。
4. Downloader 只从目录锁定的 npm Registry/Tarball 下载到 staging，并在解压或执行脚本前校验 `sha512` integrity。
5. Validator 检查包名、版本、完整依赖锁、bin 入口、普通文件树和资源预算。
6. Driver 在禁用依赖生命周期脚本的条件下安装精确依赖，再仅执行目录明确允许且位于已校验根包内的 post-install 入口。
7. Skill Extractor 从已校验包内的固定归档路径提取 Skill，重新执行路径和预算校验。
8. Lifecycle Runner 写入 metadata/integrity，并原子切换 current；任何失败都删除 staging，状态保持 `not_installed` 或回退到旧 current。
9. Authorization Broker 执行 auth argv，只打开允许域名的 HTTPS 授权 URL。
10. auth 进程结束后独立执行 status argv；匹配成功后状态变为 ready，并注册连接器 Agent。

凭证失效时不自动弹出授权窗口。Command Gateway 返回 `AUTH_REQUIRED`，当前任务停止，卡片显示“授权已过期”并恢复“＋”；只有用户点击后才重新授权。

## Agent 与子代理数据流

```text
用户提出第三方服务任务
  -> 主 Agent 根据委派工具描述自主判断
  -> delegate_to_<connector>
  -> Connector Agent Manager 获取父会话对应的隐藏子会话
  -> 注入连接器 Skill、任务、必要摘要和显式附件
  -> 子代理选择 CLI 命令
  -> connector_cli_execute
  -> Command Gateway 校验、确认并执行
  -> 子代理整理结果
  -> 返回主 Agent
```

主 Agent 不加载完整连接器 Skill、命令目录、Schema 或凭据。连接器子代理不能访问普通 Shell、项目文件写入、其他连接器工具或专家管理工具。

附件只按当前委派显式传递，不继承父会话全部历史附件。子代理产生的可交付文件通过父会话工件协议返回。

## 权限与确认

Command Gateway 使用 CLI Schema、审核资源和项目权限策略确定命令 effect、risk 和 confirmation：

- Ask/Plan 不执行连接器命令；
- L1 只允许只读命令；
- L2 的普通写入和高风险写入需要用户确认；
- L3 的普通写入可自动执行；删除、审批、发消息、权限变更等高风险写入始终确认。

确认流程：

1. 子代理生成命令。
2. Gateway 生成操作摘要；CLI 支持时执行 dry-run 获取预览。
3. 父会话展示确认卡片。
4. 用户明确确认。
5. Gateway 使用完全相同的业务参数追加 CLI 规定的确认参数，例如 `--yes`。
6. 命令只执行一次。

不得用管道输入确认，不得在确认后替换命令或业务参数，不得把 `confirmation_required` 当作普通网络错误自动重试。

## 错误协议

框架向前端和 Agent 返回稳定错误码：

| 错误码 | 行为 |
|---|---|
| `AUTH_REQUIRED` | 状态改为 auth_expired，显示重新授权入口 |
| `CONFIRMATION_REQUIRED` | 进入父会话确认流程 |
| `PERMISSION_DENIED` | 当前模式或权限拒绝 |
| `CLI_NOT_INSTALLED` | 显示安装/修复入口 |
| `CLI_VERSION_INVALID` | 安装审核版本或继续使用已验证旧版本 |
| `COMMAND_NOT_ALLOWED` | 拒绝 Schema 外或越界命令 |
| `NETWORK_ERROR` | 只读操作允许有限重试，写操作不自动重试 |
| `OUTPUT_TOO_LARGE` | 完整结果保存为工件，返回摘要和路径 |
| `CONNECTOR_TIMEOUT` | 终止子进程并保留脱敏诊断 |
| `CONNECTOR_BROKEN` | 状态改为需要修复，不自动重装 |

CLI 厂商错误必须映射到稳定框架错误，同时保留脱敏的厂商错误码和 trace ID 供诊断。

## 数据存储

首期按职责拆分存储：

- `~/.pi-a/connectors/states/<connector-id>.json` 保存生命周期状态，使用临时文件、fsync 和原子 rename 写入；
- 每个已安装版本的 `metadata.json` 保存目录版本、CLI 版本、包图摘要、Skill 摘要和安装时间；
- SQLite 只保存父会话、连接器与隐藏子会话的关联，以便随会话删除和跨轮复用；
- 厂商凭证由官方 CLI 的安全存储负责，宿主不复制到 SQLite 或状态 JSON。

连接器状态只保存：

- 连接器 ID、当前成功激活的目录版本和 CLI 版本；
- 生命周期状态、当前操作 ID 和更新时间；
- 最后稳定错误码和脱敏诊断。

不得保存第三方明文 Token、Cookie、授权码、AppSecret 或业务响应正文。日志只记录连接器 ID、命令 identity、风险级别、退出码、耗时和脱敏错误码；不记录消息正文、人员信息、命令敏感参数或完整环境变量。

## 对外服务、HTTP 与 IPC 合同

Renderer 不读取目录文件、安装路径或状态文件，也不能提交包名、下载 URL、argv、可执行路径或授权域名。所有操作只提交审核过的 `connectorId`，后端从 Registry 解析其余参数。

### ConnectorService

```ts
interface ConnectorService {
  list(): Promise<ConnectorServiceItem[]>;
  get(connectorId: string): Promise<ConnectorServiceItem>;
  activate(connectorId: string): Promise<ConnectorServiceItem>;
  cancel(connectorId: string): Promise<void>;
  reauthorize(connectorId: string): Promise<ConnectorServiceItem>;
  logout(connectorId: string): Promise<ConnectorServiceItem>;
  repair(connectorId: string): Promise<ConnectorServiceItem>;
  update(connectorId: string): Promise<ConnectorServiceItem>;
  uninstall(connectorId: string): Promise<ConnectorServiceItem>;
}
```

服务返回的公共 DTO：

```ts
interface ConnectorServiceItem {
  id: string;
  displayName: string;
  description: string;
  icon: string;
  toolName: string;
  catalogVersion: string;
  installedCatalogVersion: string; // 未安装时为空字符串
  state: ConnectorLifecycleState;
  cliVersion?: string;
  updatedAt: string;
  error?: { code: string; message: string; retryable: boolean };
}
```

`catalogVersion !== installedCatalogVersion` 表示存在目录更新；不能用 CLI 版本代替目录版本，因为目录可能只更新命令策略、错误映射或授权规则。

### HTTP 路由

| 方法与路径 | 作用 |
|---|---|
| `GET /api/connectors` | 返回目录展示信息与所有真实状态 |
| `GET /api/connectors/:id` | 返回单个连接器状态 |
| `POST /api/connectors/:id/activate` | 安装缺失依赖并进入授权 |
| `POST /api/connectors/:id/cancel` | 取消当前安装或授权操作 |
| `POST /api/connectors/:id/reauthorize` | 保留 CLI，重新执行授权 |
| `POST /api/connectors/:id/logout` | 清除厂商授权，保留 CLI |
| `POST /api/connectors/:id/repair` | 重新验证并修复受管安装 |
| `POST /api/connectors/:id/update` | 安装当前目录锁定版本并原子切换 |
| `DELETE /api/connectors/:id` | 卸载 CLI、状态、缓存和隐藏子会话 |

对应 IPC 名称固定为 `connector.list/get/activate/cancel/reauthorize/logout/repair/update/uninstall`。`frontend/src/api/client.ts` 负责 HTTP 路径到 IPC 的映射，`src/electron/ipc-handlers.ts` 只把白名单操作转发到同一 `handleApi`/ConnectorService 单例，不能形成第二套业务逻辑。通用 `preload.cjs` call forwarder 已能承载这些 invoke，不为单个连接器增加专属方法。

### 稳定错误响应

HTTP/IPC 错误至少返回 `{ error, code }`，`code` 使用框架稳定错误码。前端根据错误码决定“重试、重新授权、修复或停止”，不解析厂商 stderr。内部错误可以记录脱敏 cause，但不能把命令完整输出、Token 或环境变量返回 Renderer。

## 前端交互

删除 `ExpertPanel.tsx` 的静态 `PRESET_CONNECTORS` 作为权威目录。页面从本地后端读取 Registry 和真实状态。

卡片状态：

| 状态 | 主操作 |
|---|---|
| 未安装 | ＋ |
| 正在安装 | 进度/取消 |
| 待授权 | 去授权 |
| 正在授权 | 等待授权完成 |
| 已连接 | ✓ |
| 授权已过期 | ＋ |
| 需要更新 | 更新 |
| 安装失败 | 重试 |
| 需要修复 | 修复 |

已连接卡片提供重新授权、退出登录、检查更新、修复依赖和卸载连接器。重新授权保留 CLI；退出登录清除第三方授权但保留 CLI；卸载删除 CLI、连接器状态、缓存、授权和隐藏子会话。

连接器采用主 Agent 自主委派后，Composer 的“＋ → 连接器”不再承担单轮 MCP 工具授权，只显示状态并跳转管理入口。

连接器页面首次打开时调用 `connector.list`。处于 `installing` 或 `authorizing` 时可以短周期轮询；离开页面或状态稳定后必须停止轮询。前端本地 `loading` 只能用于防重复点击，不能覆盖后端状态。应用重启后重新读取 Registry 与状态文件即可恢复展示，不能依赖 Renderer 内存。

安装与使用是两个阶段：

1. 用户在连接器中心点击“＋”，完成依赖安装和厂商授权。
2. 进入 `ready` 后，主 Agent 在每轮工具装配时获得该连接器的轻量委派工具。
3. 用户提出相关办公任务时，由主 Agent 根据工具描述自主决定是否委派，不要求用户输入斜杠命令或每轮重新选择连接器。
4. 完整 CLI Schema 和 Skill 只在隐藏子代理中生效；新建主任务会建立新的父子映射，旧任务继续复用自己的子会话。

## 钉钉首个目录配置

钉钉目录条目使用审核并锁定的 `dingtalk-workspace-cli@1.0.59`。项目不开发或发布额外的 `connector-dingtalk` npm 包。首期单设备只绑定一个账号和企业；重新授权替换原绑定。

目录 JSON 定义：

- npm 包与精确版本；
- `dws` 平台入口；
- `dws auth login -y --no-browser`，由宿主校验并打开 CLI 输出的授权地址；
- `dws auth status` 的 JSON 成功条件；
- `dws auth reset`；
- `login.dingtalk.com` 授权域名；
- 官方包内 `assets/dws-skills.zip` 的固定提取规则；
- `dws schema` 命令发现与风险语义；
- 钉钉厂商错误到框架错误的映射。

钉钉专属字符串和判断只能存在于该目录条目及其测试中，不能进入通用 Registry、Runtime Driver、Lifecycle Runner、Authorization Broker、Command Gateway 或 Agent Manager。`resources/builtin-connectors/dingtalk/` 必须删除；安装前磁盘上不得存在内置钉钉 Skill 或参考资料。

## 新增第三方 CLI 连接器的准入合同

后续企业微信、WPS、飞书或其他第三方工具，并不是“知道一个 npm 包名就一定能一键接入”。只有同时满足以下条件，才能只增加一条目录 JSON 而不修改通用代码：

1. 存在可审核的官方 Node/npm CLI，并能锁定精确版本和完整依赖图。
2. 每个依赖都有固定 Registry tarball 和有效 `sha512` integrity。
3. CLI 提供可非交互启动的授权命令，并在 stdout 或 stderr 输出 HTTPS 授权 URL（宿主对两个流都做 URL 提取）。
4. 授权 URL 域名可以静态枚举；授权完成后存在独立、机器可读的状态命令。
5. CLI 提供退出登录命令，且凭证由 CLI 自身安全保存，不要求宿主保存明文 Secret。
6. CLI 提供稳定版本检查和机器可读命令 Schema，或存在可审核并能声明式表达的等价命令清单。
7. CLI 包内包含可提取的 Skill 入口，或厂商提供与 CLI 版本绑定、可做摘要校验的 Skill 归档。
8. CLI 能在 `shell: false`、参数数组、受限环境变量和有限超时/输出预算下运行。
9. 高风险命令可以被 Schema 识别，并支持宿主确认后以相同业务参数执行。
10. npm 包许可证允许应用按需下载和在用户设备上运行。

满足以上合同的接入步骤：

1. 审计官方包、许可证、bin、Skill、授权流程和 Schema。
2. 生成完整依赖锁，记录每个 `package@version` 的 tarball 与 integrity。
3. 在 `connector-catalog.json` 增加展示、delegate、runtime、install、skill、executable、versionCheck、auth、status、logout、commandPolicy、errors 和 packages。
4. 验证未安装时只显示卡片，不下载、不解压、不加载 Skill。
5. 验证点击“＋”后的安装、授权、状态、委派、高风险确认、退出、更新、修复和卸载闭环。
6. 验证 macOS 与 Windows 可执行入口及路径行为。

如果厂商缺少上述任一关键能力，必须先做专项设计：可以新增经过代码注册的 Runtime Driver、Credential Provider 或审核适配包，但不能把任意脚本、凭证字段或远程代码塞进目录 JSON。适配包仍必须服从相同的安装、权限、审计和子代理边界。

## 安全不变量

以下规则不因厂商、平台或 UI 变化而放宽：

- 目录加载是离线、只读、有限大小且无副作用的；加载目录不得访问网络、执行脚本或读取厂商包。
- 目录、运行时锁、状态文件、package.json 和 Skill 归档读取必须防符号链接、路径逃逸、TOCTOU 替换和超预算内容。
- npm 安装使用生成的完整 lock 和 `npm ci --ignore-scripts --no-audit --no-fund`；安装后 lock 内容必须保持不变。
- 只允许显式声明且位于已验证根包内的 post-install 入口，使用受管 Node 和固定 argv 执行。
- 进程执行固定 `shell: false`，限制时间、stdout、stderr 和环境变量，并在取消或超时后终止整个进程树。
- 模型不能控制 runtime、Registry、tarball、integrity、binPath、cwd、授权域名或另一个连接器的 connectorId。
- 主 Agent 不获得厂商 CLI Gateway；连接器子代理不获得普通 Shell、其他连接器、专家管理或任意文件写工具。
- 同一个确认 ID 只允许重放指纹完全一致、尚未过期的命令；写操作和高风险操作不自动重试。
- Token、Cookie、授权码、AppSecret、业务正文和完整命令环境不得写入日志、状态文件或主会话提示词。

## 实施对齐与剩余闭环（2026-08-27）

### 已落地并提交

- 严格离线目录与 Registry：字段白名单、精确 semver、SRI、npm tarball、授权域名、受限正则、安全相对路径和不可变结果。
- 钉钉已改为 `connector-catalog.json` 中的按需条目；内置钉钉资源树已删除。
- 私有路径、原子状态文件、进程内互斥、文件锁、staging 清理和崩溃恢复能力。
- Electron Node + bundled npm 运行时解析，以及 shell-free、可取消、有输出和超时上限的进程执行。
- 完整 npm lock 物化、`npm ci --ignore-scripts`、显式 post-install、版本验证、Skill 安全提取和 current 原子切换。
- 授权 URL 域名拦截、独立 JSON status 验证、logout、repair、update、cancel 和 uninstall 生命周期。
- Schema 绑定命令网关、连接器身份绑定、高风险确认指纹、厂商错误映射和大输出工件化。
- `connector-agent` 子运行时、工具隔离、显式附件传递、持久隐藏子会话和主 Agent 自主委派工具。
- 单一 ConnectorService、HTTP 路由、IPC 白名单和前端 API 路由。
- 前端连接器卡片已由静态 `PRESET_CONNECTORS` 全量替换为目录驱动：图标/名称/描述来自目录、后端生命周期状态权威、busy 轮询、失败重试、取消与退出/卸载确认；旧 `installPresetMcp` 权威路径已删除。
- 启动接线：`initializeAgentRuntime` 增加 `initializeConnectors` 阶段，应用启动时急切构建连接器单例（`createConnectorRegistry` 严格校验目录 + `resolveManagedNpmRuntime` 校验运行时锁），随后执行一次 `recoverStartup()` 清理过期锁与残留 staging；该阶段不联网、不安装、不提取 Skill、不执行包脚本、不打开授权，也不为非 ready 连接器注册委派。
- 打包约束：`electron-builder.yml` 从 `app.asar` 排除 `resources/builtin-connectors` 的两个顶层描述 JSON 和所有供应商子目录，再以精确 `extraResources` 白名单把 `connector-catalog.json` 与 `connector-runtime-lock.json` 发布到 `process.resourcesPath/builtin-connectors`；生产代码只从该真实目录读取并执行完整文件身份校验，不回退 ASAR、用户目录或系统目录。即使开发者本地创建 `<connector-id>/` 厂商目录也不会进入产物；`git ls-files resources/builtin-connectors/` 与打包约束测试源码均固定只允许两个 JSON。详见 `docs/designs/2026-08-28-packaged-connector-registry-resources-design.md`。
- 运行时版本对齐（Electron 43.2.0 / Node 24.18.0 / npm 11.7.0，见 `docs/designs/2026-08-27-managed-cli-runtime-version-alignment-design.md`）：`connector-runtime-lock.json` 升级为 schema v2（`host` 描述真实宿主来源与 `nodeVersion`，integrity 对应 `package-lock.json` 发布摘要）；Catalog 条目不再复制 Node 版本，只引用 `managed-node-npm/default`；Registry 通过 `runtimeLock()` 返回校验后的不可变锁，作为运行时版本唯一事实来源；`resolveManagedNpmRuntime` 从该锁解析并验证 `process.versions.electron/node`、npm 物理 package.json 版本与 npm bin 入口（拒绝回退系统运行时）。Electron 是生产宿主而不是 ASAR 内应用依赖，运行时不得要求 `electron/package.json` 存在；Node 使用真实的 `process.execPath`。打包 npm 由 `asarUnpack` 发布，并显式规范化到 `process.resourcesPath/app.asar.unpacked/node_modules/npm/bin/npm-cli.js` 后再交给子进程，避免依赖 ASAR 透明重定向；用户安装的厂商 CLI 始终位于应用数据目录。新增 `src/domains/connector/node/assembly.ts` 共享装配，应用服务与连接器子代理网关复用同一 Registry+runtime 惰性实例，`application.electron.ts` 与 `src/agent/tools/index.ts` 中的锁字面量与重复 Registry 单例已删除。
- 启动失败隔离（fail closed for connectors, fail open for the app）：连接器子系统初始化失败——目录无效 `CONNECTOR_CATALOG_INVALID`、运行时不可用 `CONNECTOR_RUNTIME_UNAVAILABLE`——由 `connectorsReady` 捕获并记录脱敏日志，异常不再穿透顶层启动序列；Skills、Models、主 Agent 照常启动，不产生未处理 Promise rejection；`/api/connectors` 返回稳定错误码，前端显示"运行环境异常"并建议重启/更新应用；delegate 工具缓存刷新失败时清空（不注册），`connector_cli_execute` 网关复用共享装配，失败即拒绝执行。
- 授权 URL 双流提取（实测 `dws auth login` 把 OAuth 链接打印到 stderr）：`runConnectorProcess` 的 `onLine` 回调同时解析 stdout 与 stderr 的行（各流独立缓冲，残余无换行行在进程退出时补发），`authorizeConnector` 的 `openExternal` 因此能捕获落在 stderr 的授权链接；准入合同第 3 条同步放宽为"stdout 或 stderr"。

#### 验证记录（2026-08-27，按用户验证策略：不运行自动化测试/测试套件）

```bash
# 类型与语法验证（全部通过，EXIT 0）
npx tsc --project tsconfig.electron.json --noEmit
npx tsc --project frontend/tsconfig.app.json --noEmit
npx tsc --noEmit --strict --target es2023 --lib es2023,dom --module esnext \
  --moduleResolution bundler --allowImportingTsExtensions --skipLibCheck \
  test/src/domains/connector/node/packaging.test.ts
npx tsc --noEmit --strict --target es2023 --lib es2023,dom --module esnext \
  --moduleResolution bundler --allowImportingTsExtensions --skipLibCheck \
  test/src/domains/connector/node/e2e.test.ts
npx esbuild application.electron.ts --loader:.ts=ts --format=esm --outfile=/dev/null
git diff --check
# 目录约束确认
git ls-files resources/builtin-connectors/   # 仅 connector-catalog.json + connector-runtime-lock.json
```

计划 Step 4 的 `npx tsx --test …` 与 `npm run test:backend` 按用户验证策略不执行；TypeScript 全量类型检查与 `git diff --check` 已覆盖本次变更。

#### 验证记录（2026-08-27，运行时版本对齐 + 启动失败隔离）

```bash
# 1. 运行时锁与 package-lock 对齐：schema v2 完整性摘要逐字节匹配发布锁定
node -e "const l=require('./resources/builtin-connectors/connector-runtime-lock.json'),p=require('./package-lock.json');
const sri=n=>p.packages[n].integrity;
if(sri('node_modules/electron')!==l.host.integrity)throw new Error('electron integrity mismatch');
if(sri('node_modules/npm')!==l.npm.integrity)throw new Error('npm integrity mismatch');
if(l.host.nodeVersion!=='24.18.0'||l.host.version!=='43.2.0'||l.npm.version!=='11.7.0')throw new Error('version mismatch');
console.log('LOCK-OK')"
# 2. 主进程 + 前端全量类型检查（均 EXIT 0）
npx tsc --project tsconfig.electron.json --noEmit
npx tsc --project frontend/tsconfig.app.json --noEmit
# 3. 12 个受影响测试文件的独立严格类型检查（全部通过）
#    test/src/domains/connector/node/{service,registry,catalog,lifecycle,packaging,
#    node_npm_driver,command_gateway,e2e,authorization,dingtalk_catalog}.test.ts
#    test/src/domains/agent/agent_manager.test.ts
#    test/src/platform/cli/runtime.test.ts
npx tsc --noEmit --strict --target es2023 --lib es2023,dom --module esnext \
  --moduleResolution bundler --allowImportingTsExtensions --skipLibCheck <file>
# 4. 顶层装配入口可编译
npx esbuild application.electron.ts --loader:.ts=ts --format=esm --outfile=/dev/null
# 5. 差异格式检查
git diff --check
```

运行时版本对齐（runtime lock v2、共享装配、Catalog 去版本化）与启动失败隔离（`connectorsReady` 捕获 `CONNECTOR_CATALOG_INVALID`/`CONNECTOR_RUNTIME_UNAVAILABLE`，Skills/Models/主 Agent 照常启动，前端显示"运行环境异常"）按用户验证策略只做语法/类型/格式验证，自动化测试套件未执行。

### 尚未完成，不能宣称首期闭环

1. **生命周期联动清理**：logout、uninstall、目录版本变化和 CLI 版本替换时，必须调用 Agent Manager 销毁对应隐藏子会话；当前生命周期与 Agent Manager 仍需统一事件桥。
2. **授权失效回写**：Command Gateway 识别 `AUTH_REQUIRED` 后必须把连接器状态更新为 `auth_expired`，使前端恢复“＋/重新授权”入口；不得只把错误返回子代理。
3. **状态目录统一**：设计规定状态位于 `~/.pi-a/connectors/states/`；当前 StateStore 的装配根需要与该布局统一，不能继续把连接器状态散落到 `~/.pi-a/states/`。
4. **激活版本原子提交**：`installedCatalogVersion` 只能在新版本完整安装并切换 current 后更新；安装或升级开始时不能提前覆盖旧活动版本，否则失败回滚后 UI 会错误显示已更新。
5. **取消状态归一化**：安装取消应回到 `not_installed` 或旧稳定版本，授权取消应回到 `installed_unauthorized`；不能笼统落入 `install_failed` 或 `auth_failed`。
6. **彻底卸载语义**：卸载需要覆盖 CLI 版本目录、cache、logs、状态文件、厂商授权和隐藏子会话；失败要返回可诊断的部分清理状态，不能提前显示未安装。
7. **打包后运行验证**：确认 macOS/Windows 打包产物的 `process.execPath` Node 模式、npm CLI、junction/symlink 和 bin 入口均可用；目前只完成了打包筛选约束与离线验收测试。
8. **真实钉钉端到端验收**：在无系统 Node/npm 环境完成安装、浏览器授权、状态刷新、自主委派、附件、高风险确认、授权过期、升级失败回滚和卸载。

上述闭环完成前，“再增加一个 JSON 即可接入任何第三方 CLI”只对满足准入合同且通用框架已完成的连接器成立。企业微信或 WPS 是否能只点击安装，必须先完成官方 CLI 能力审计，不能仅凭产品名称假设。

## 测试策略

以下是完成定义所需的验证覆盖，不代表本次文档更新会自动执行。遵循当前项目约束：默认只做 Markdown/JSON/TypeScript 语法和差异格式检查；自动化测试与真实端到端验收必须由用户明确授权后运行。

### 单元测试

- catalog 未知字段、重复或非法 ID、非 HTTPS 来源、未锁定依赖和摘要不匹配被拒绝；
- 仅加载目录时不会发起下载、提取 Skill 或执行包脚本；
- tarball、Skill ZIP 的路径逃逸、符号链接、重复路径和预算绕过被拒绝；
- node-npm Driver 使用内置运行时和独立 prefix；
- 安装参数固定包名和精确版本，不经过 Shell；
- 版本、bin 和完整性验证；
- 生命周期合法迁移，非法迁移失败；
- 授权 URL 只允许清单域名和 HTTPS；
- status 必须真实匹配才进入 ready；
- argv、可执行文件和 connectorId 不能由模型越界；
- Schema 外命令和高风险绕过被拒绝；
- 日志和错误不包含敏感值。

### 集成测试

- 干净临时 appData 下从目录配置完成模拟下载、校验、Skill 提取、npm 安装、授权和注册；
- 下载、摘要校验、解压或 Skill 校验失败时不留下 current 或半安装目录；
- 安装失败保持旧 current；
- 两个并发安装合并或串行，不产生双写；
- 崩溃残留 staging 和过期锁可恢复；
- 授权过期使委派返回 AUTH_REQUIRED 并更新 UI 状态；
- 父会话只有轻量委派工具，子会话获得连接器 Skill 和 CLI Gateway；
- 子会话跨父任务多轮复用，新建任务和卸载后销毁；
- 高风险命令确认后只重放同一命令；
- 大输出转为工件；
- macOS 和 Windows 路径解析使用同一目录条目。

### 钉钉端到端验收

- 无系统 Node/npm 的机器可以安装锁定版本；
- 所有文件位于 `~/.pi-a/connectors/`；
- 安装完成自动进入官方授权；
- 授权成功后卡片显示已连接；
- 主 Agent 能自主委派通讯录、日历和文档类任务；
- 主上下文不包含完整钉钉 Skill 和命令 Schema；
- 高风险命令进入父会话确认；
- 授权失效后卡片恢复授权入口且不自动弹窗；
- 升级失败继续使用旧版本；
- 退出、卸载和新建任务正确清理连接器子会话。

## 推进顺序

1. 定义并验证轻量连接器目录 JSON 协议。
2. 建立跨平台目录、状态和生命周期模型。
3. 打包并验证内置 Node/npm 运行时。
4. 实现 node-npm Driver 与原子安装。
5. 实现授权 Broker 和域名限制。
6. 实现 Command Gateway、Schema 校验、权限和确认桥。
7. 实现隐藏连接器 Agent 和自主委派。
8. 用真实 Registry 替换静态前端卡片。
9. 增加钉钉目录配置，删除内置钉钉资源目录，并完成点击安装、授权与业务验收。
10. 完成跨平台、回滚、脱敏和安全回归测试。

## 完成定义

通用框架不能依赖钉钉专属分支；新增一个同为 Node/npm 且遵循现有生命周期的审核 CLI 连接器时，只需在 `connector-catalog.json` 增加一条包含完整锁与厂商错误映射的配置，不开发额外适配包，也不修改通用生命周期、授权、命令执行、权限、子代理或前端状态机。钉钉端到端验收全部通过后，首期完成。
