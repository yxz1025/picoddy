# Pi Runtime 0.84.4 升级设计

> 实施结论（2026-08-31）：**暂缓升级，已恢复 `0.83.0` 基线。** `0.84.4` 的 Durable AgentHarness v2 尚未达到官方所述的 migration-ready 状态；发布包中的 `prompt`、`compact`、`abort` 等核心方法仍会返回 `HarnessNotImplemented`。在该状态下升级会破坏现有 Agent 主流程，不能用类型适配或补丁规避。待上游完成 Harness 生命周期并发布可迁移版本后，再重新执行本设计的版本矩阵与回归验证。

## 背景

项目当前直接依赖 `@earendil-works/pi-agent-core`、`@earendil-works/pi-ai`、`@earendil-works/pi-coding-agent` `0.83.0`。统一 MCP Connector 计划采用 `pi-mcp-adapter` 的程序化配置入口，但当前可用 Adapter 版本依赖 Pi `0.84.x` 中的 API；在 `0.83.0` 上会出现缺少 `complete` 导出等编译和运行时错误。

本次升级不能只改变某一个 Pi 包。Agent Core、AI、Coding Agent、TUI 及 Adapter 必须按同一兼容矩阵锁定，否则 npm 可能安装嵌套的不同 Pi 副本，使 Extension API、Tool 类型和运行时状态不一致。

## 目标

- 将直接使用的 Pi Runtime 从 `0.83.0` 整套升级至 `0.84.4`。
- 固定 `pi-mcp-adapter@2.31.0`，验证其公开的 `createMcpAdapter({ config })` 入口。
- 保持现有 Provider、Prompt Runtime、插件加载、工具包装、Subagent、会话压缩、附件和 Connector 行为不变。
- 确认 Electron 内置 Node 满足 Pi `>=22.19.0` 的运行时要求，macOS 和 Windows 不依赖系统 Node。
- 通过类型、依赖树、针对性回归与打包检查证明升级链路完整，不使用类型忽略、深层导入或私有补丁。

## 非目标

- 本次不同时实现统一 Connector/MCP 业务改造；只建立其可靠依赖基础并验证 Adapter 宿主入口。
- 不改变 Prompt、工具权限、Subagent Schema、附件协议或 UI 行为。
- 不升级无关依赖，不顺手修复现有业务问题。
- 不保留 `0.83.x` fallback 或双版本 Pi Runtime。

## 版本矩阵

根据 2026-08-31 npm 包元数据，目标精确版本为：

| 包 | 当前 | 目标 |
|---|---:|---:|
| `@earendil-works/pi-agent-core` | `0.83.0` | `0.84.4` |
| `@earendil-works/pi-ai` | `0.83.0` | `0.84.4` |
| `@earendil-works/pi-coding-agent` | `0.83.0` | `0.84.4` |
| `@earendil-works/pi-tui` | 间接依赖 | `0.84.4`（直接锁定，满足 Adapter peer） |
| `pi-mcp-adapter` | 无 | `2.31.0` |

所有版本使用精确版本，不使用 `^`、`~` 或 `latest`。Pi `0.84.4` 要求 Node `>=22.19.0`；项目开发 Node 为 `24.10.0`，Electron `43.2.0` 使用随应用运行时，实施时还需用主进程实际 `process.versions.node` 验证打包运行环境。

## 现状影响面

Pi 类型和运行时直接进入以下链路：

- `src/agent/provider.ts`：模型、消息流、Agent Session 和工具执行；
- `src/agent/plugin_tools.ts`：Extension Runtime、ExtensionRunner、工具包装；
- `src/agent/tools/*`：AgentTool、Schema、工具结果；
- `src/agent/prompt-runtime/*`：工具集合、上下文和压缩前后调用；
- `src/agent/tools/subagent.ts`：子代理工具 Schema、任务上下文与结果；
- `application.electron.ts`：启动初始化、Prompt/SSE 调用；
- 插件安装与动态加载链路；
- 后续 `pi-mcp-adapter` 宿主适配。

附件读写本身不依赖 Pi，但附件转换后的内容会进入 Prompt Runtime，因此必须验证含附件消息仍能构造并提交。

## 方案

### 1. 原子升级依赖

一次 npm 操作精确安装五个目标包并更新锁文件。随后执行 `npm ls`，要求：

- 根与 `pi-coding-agent` 使用同一组 `0.84.4` Pi 包；
- 不出现 `invalid`、`extraneous` 或 Adapter peer mismatch；
- 不存在由 Adapter 引入的旧 Pi 副本。

若无法形成单一依赖树，立即停止，不通过 overrides 强压不兼容版本。

### 2. 只处理真实 API 变化

先运行 TypeScript 检查并按错误逐项核对 `0.84.4` 公共导出：

- 仅修改因公开 API/类型签名变化而受影响的调用；
- 不增加 `any`、`@ts-ignore`、compat wrapper 或旧版 fallback；
- Extension 仍走 `discoverAndLoadExtensions`、`ExtensionRunner` 和 `wrapRegisteredTools` 官方路径；
- Provider、Prompt Runtime 和工具权限语义不得借升级改变。

当前工作树中 `src/agent/tools/subagent.ts` 已存在两个类型错误。升级验证必须区分升级前既有错误与升级新增错误；本次若这些错误属于此前已确认的 Subagent 改造，则只做其原设计范围内的正确类型修复，不能用依赖升级掩盖。

### 3. Adapter 公共入口契约检查

增加最小宿主契约代码或类型级验证，确认：

- 只能从包公开 export 导入 `createMcpAdapter` 与配置类型；
- programmatic config 能关闭宿主配置发现并禁用 Direct Tools；
- Adapter 注册的代理工具可由现有 ExtensionRunner 正确包装；
- Session shutdown 能释放 Adapter 生命周期；
- 不读取或写入旧 `mcp.json`。

这里只验证宿主接入能力，不接入生产 Prompt/API/UI，避免与下一阶段 Connector 改造混在一起。

### 4. 流程回归范围

验证按风险分层：

1. 后端 TypeScript：Electron/Agent/Domain 全量类型检查；
2. 前端 TypeScript：确认 DTO 未被依赖升级意外影响；
3. 依赖树：Pi 单版本、Adapter peer 完整；
4. Agent 核心：Provider 创建、工具列表装配、Prompt Runtime profile/envelope；
5. 插件：发现、加载、注册、卸载后的工具刷新；
6. Subagent：单任务与 tasks 数组 Schema、上下文传递、结果聚合；
7. 会话：新会话、继续会话、压缩事件与恢复；
8. 附件：上传记录、附件上下文构建、含附件 Prompt；
9. Connector：现有钉钉受管 CLI 状态和工具装配不变；
10. Electron：无头菜单、IPC 白名单、启动初始化；
11. 平台构建：macOS 与 Windows TypeScript/打包配置检查。

自动化测试、构建和打包只在本设计确认后按用户本次“确认全部流程”的授权执行；不会发布、安装产物或修改外部系统。

## 影响范围

预期必改：

- `package.json`
- `package-lock.json`
- Pi 公共 API 发生变化时对应的 `src/agent/*` 精确调用点
- Adapter 宿主契约验证源码
- 本文及 MCP 设计文档的最终版本矩阵

不应修改：

- Connector API/IPC/UI 产品协议
- 附件存储协议
- Prompt 文案和权限策略
- Electron 菜单与窗口适配
- macOS/Windows 专项补丁逻辑

## 风险与控制

### 上游 Harness 尚不可迁移（已触发）

风险：`0.84.4` 将 `AgentHarness` 改为异步 `AgentHarness.create()`、Result 返回值和异步 getter，同时发布实现中的核心执行方法仍是 scaffold。官方 AgentHarness lifecycle 文档将完整生命周期列为进行中，并明确还有“Later coding-agent migration plan”。

控制：不把“可安装、可通过部分类型检查”等同于可运行；本次已撤回五个目标依赖并通过 `npm ci` 恢复锁文件版本。禁止通过 `any`、调用内部 API、复制旧 Harness 或双版本 Pi 运行时继续推进。参考：[AgentHarness lifecycle](https://github.com/earendil-works/pi/blob/main/packages/agent/docs/agent-harness.md)、[Durable AgentHarness design](https://github.com/earendil-works/pi/blob/main/packages/agent/docs/harness-v2.md)。

### Pi 包出现多版本

风险：Tool、Message 或 Extension API 来自不同包实例，类型看似相近但运行时不一致。

控制：直接锁定整套 `0.84.4`，检查完整依赖树，不使用 npm overrides 强制掩盖。

### Node 最低版本提高

风险：开发机通过，但打包后的 Electron Node 不满足 `>=22.19.0`。

控制：验证 Electron 主进程实际 Node 版本；不回退到系统 Node/PATH。

### Extension API 行为变化

风险：插件或 Adapter 能加载但工具执行上下文不完整。

控制：继续使用官方 Runner，检查注册工具和 shutdown；不自行仿造 Extension API。

### 既有脏工作树混淆

风险：把此前 Windows、附件、Subagent 改动误认为升级改动。

控制：只修改明确目标文件；验证前后记录基线错误；不覆盖用户现有修改。

## 验证与完成标准

升级完成必须同时满足：

- `npm ls` 无 Pi/Adapter peer 错误且 Pi 只有 `0.84.4`；
- 后端与前端 TypeScript 检查无新增错误；
- Adapter 公共程序化入口可加载并能安全关闭；
- Agent、插件、Subagent、压缩、附件和现有 Connector 的针对性回归通过；
- Electron 主进程 Node 版本满足要求；
- macOS 与 Windows 构建配置检查通过；
- `git diff --check` 通过；
- 没有 `@ts-ignore`、深层包导入、兼容 fallback 或无关改动。

若任何核心流程无法验证，不得表述为“全部没问题”，必须列明失败项和是否由本次升级引入。
