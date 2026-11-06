# pi.dev 生态接入设计

> 状态：待确认
> 日期：2026-08-17

## 目标

让 PiCoddy-a 能消费 pi.dev 生态包（`pi install npm:@foo/pi-tools` / `git:...` 安装的第三方能力包），在保持现有 Electron 架构不变的前提下，把 pi 生态的**skills、prompt templates、extensions 三类内容**接入现有能力体系。themes 是 pi TUI 专属概念，明确不做。

## 兼容性结论（设计前提）

| pi 包内容 | 兼容性 | 落地通道 |
|---|---|---|
| Skills（SKILL.md 能力包） | ✅ 格式已对齐 | `skills.ts` 已 vendor pi 的 `loadSkillsFromDir`，新增 packages 技能根 |
| Prompt templates（markdown） | ✅ 零运行时成本 | 注册进 `profile.resources.promptTemplates`，复用已有 `prompt_template` invocation 机制 |
| Extensions（TS 模块） | ⚠️ 需新建运行时 | pi 的扩展点绑定 TUI；PiCoddy-a 需定义 Electron 版扩展 API（工具 + 生命周期事件子集） |
| Themes | ❌ 不做 | 纯 TUI 概念 |

已核实的关键事实：

- `pi-coding-agent` 的 `DefaultPackageManager`（`dist/core/package-manager.js`）**不依赖 pi-tui**，仅依赖 `config.js`（目录常量）、`utils/child-process.js`、`utils/git.js`，可通过深路径导入 vendor 复用（与现有 `src/vendor/pi_coding_agent_skills.ts` 模式一致）。
- `pi-coding-agent` 的 package.json exports 只暴露 `.` 和 `./rpc-entry`，包管理器必须走深路径导入。项目已精确 pin `0.80.3`，深路径在版本锁定下是安全的。
- `DefaultPackageManager` 依赖 `SettingsManager`（pi.toml 读写），可通过实现 `SettingsStorage` 接口适配到 PiCoddy-a 的 settings 域。
- 包内布局约定由 `ResolvedPaths` 定义：包根下 `extensions/`、`skills/`、`prompts/`、`themes/` 四个顶层目录。

## 总体架构

```
pi.dev 包（npm:/git: 源）
  └── PackageManager（vendor pi）
        ├── 安装/更新/移除 → ~/.pi-a/packages/<scope>/<name>/
        ├── 包清单持久化 → settings 域（SQLite settings 表）
        └── ResolvedPaths 解析 → 三条落地通道
              ├── skills/    → skills.ts 新增 packagesDir 根（与 protected/user 并列）
              ├── prompts/   → prompt-runtime 注册 promptTemplates
              └── extensions/ → Electron 扩展运行时（P1，esbuild + 动态 import）
```

与现有插件通道的分工：

| 通道 | 定位 | 本设计是否涉及 |
|---|---|---|
| MCP 连接器 | 外部服务工具，按次显式注入 | 不涉及 |
| 专家包（expert archives） | 人格 + 技能组合 | 不涉及 |
| 技能草稿 / 已安装技能 | 用户自建技能 | 仅共享技能根合并逻辑 |
| **pi.dev 包** | **第三方本地能力（技能/提示词/扩展）** | **本设计** |

## 核心决策

### D1：包管理器 vendor pi 的 DefaultPackageManager，不自写

理由：npm/git 双协议安装、git pull 更新、四类资源解析（ResolvedPaths）、progress 回调都已实现；符合"优先用成熟库"原则。做法与现有 `src/vendor/pi_coding_agent_skills.ts` 完全一致。

适配点：

- 实现 `SettingsStorage` 适配器：读 PiCoddy-a settings 域的 `packages` key（JSON 数组），写回 `setSetting("packages", json)`。不引入 pi.toml 文件。
- `PackageManagerOptions` 注入：`cwd` = 会话工作区（解析 project scope 时用）、`agentDir` = `~/.pi-a`。
- 包版本锁定：npm 包安装后**固定锁定的 resolved 版本**（pi 的 semver 处理已有），避免上游 break。

### D2：包存储位置

```
~/.pi-a/packages/
├── user/      # 全局包（scope: user）
└── project/   # 项目包（scope: project，随工作区切换生效）
```

复用 `platformPaths.appDataDir`（`~/.pi-a`）约定，与 attachments/skills 目录平级。

### D3：包清单持久化到 settings 域

`settings` 表新增 key `packages`，值为 JSON 数组：

```json
[
  { "source": "npm:@foo/pi-tools", "scope": "user", "enabled": true },
  { "source": "git:github.com/bar/pi-ssh", "scope": "project", "enabled": false }
]
```

不用 SQLite 新表：包清单是配置而非业务数据，且 pi 的 `ConfiguredPackage` 模型本身就是配置语义。`filtered`（按 agent 过滤）暂不使用。

### D4：Skills 通道 — skills.ts 增加 packages 根

`SkillPathRoots` 从 `{builtinDir, userDir}` 扩展为 `{builtinDir, userDir, packagesDir}`：

- `packagesDir` = 所有启用包的 `skills/` 目录聚合。加载器已有多根扫描 + 名称折叠去重逻辑，新增根复用现有合并路径。
- 优先级：内置（protected）> 用户技能 > 包技能（同名时包技能让位）。
- 包卸载/停用后：重建技能索引（现有技能刷新机制），下一次会话生效。

### D5：Prompts 通道 — 注册 promptTemplates

- 解析启用包的 `prompts/` 目录：每个 markdown 文件（含 frontmatter：name/description）→ `PromptTemplate` 对象。
- 注册进 `profile.resources.promptTemplates`（`runtime-profile.ts` 的资源聚合处），与现有模板合并。
- 调用路径零改动：`envelope-builder.ts` 已支持 `invocation.kind === "prompt_template"`，通过 `formatPromptTemplateInvocation` 渲染。
- frontmatter 字段与 pi 对齐的细节在实现计划中 spike 验证（以 `dist/core/skills.js` 同源的 prompts loader 为参照）。

### D6：扩展运行时（P1）— Electron 版扩展 API 子集

pi 扩展可做的事（TUI 组件、快捷键、命令、工具、生命周期事件）中，PiCoddy-a 只实现**工具注册 + 生命周期事件**两个子集；TUI 类扩展（Component/Overlay/Keybinding）不实现，包解析时跳过声明 UI 能力的扩展并提示。

扩展 API 草案（`src/agent/extensions/types.ts`）：

```typescript
export interface PiCoddyExtensionApi {
  registerTool(tool: AgentTool<unknown>): void;
  onSessionStart?(ctx: { sessionId: string }): void;
  onTurnEnd?(ctx: { sessionId: string }): void;
  // 预留：访问 provider 事件流（复用 provider.emitEvent 通路）
}
export interface PiCoddyExtension {
  name: string;
  setup(api: PiCoddyExtensionApi): void | Promise<void>;
}
```

加载机制：

1. 扩展入口约定：包根 `extensions/<name>.ts`，默认导出 `PiCoddyExtension`。
2. 用 **esbuild**（已是依赖）bundle TS 入口 → 临时产物 → 动态 `import()`。Electron 主进程是 ESM（`"type": "module"`），Node 22 动态 import 无障碍。
3. 注册的工具并入会话工具集（与 base tools 同路径），停用包时对应工具移除。扩展工具是本地可信代码，采用**全局注册**而非 MCP 的按次注入。

### D7：不做 pi.dev 画廊浏览

pi 没有包 registry API，安装本身走 npm/git 源。UI 只提供源字符串安装，不实现"浏览 pi.dev /packages 列表"（后续如 pi 推出 registry 再加）。

## 领域与 API 设计

### 后端领域

```
src/domains/packages/node/
├── store.ts     # settings key "packages" 读写 + SettingsStorage 适配器
└── service.ts   # list/install/remove/update/enable/disable（调 PackageManager）
src/agent/packages/
├── resolver.ts  # ResolvedPaths → skills 根 / promptTemplates / 扩展清单
└── extensions/  # P1：扩展运行时（loader + registry）
```

### handleApi 路由

| 路由 | 方法 | 说明 |
|---|---|---|
| `/api/packages` | GET | 列出已配置包（source/scope/enabled/installedPath） |
| `/api/packages` | POST | 安装：`{ source, scope }`，progress 走事件队列 |
| `/api/packages/:source` | DELETE | 卸载（同时重建技能索引、移除模板与扩展工具） |
| `/api/packages/:source` | POST | 更新（git pull / npm update） |
| `/api/packages/:source/toggle` | POST | 启用/停用 |

安装进度复用现有事件队列机制（`provider.emitEvent` 通路）推送 UI。

### 前端（P1 随扩展运行时一起交付，MVP 仅 API）

设置页新增"包管理"面板：安装（源字符串 + scope 选择）、列表、启用开关、卸载（复用全局 `AppDialog` 危险确认）、更新。

## 安全模型

- **安装即信任**：扩展以主进程完整权限运行（与 pi 的 in-process 模型一致）。安装确认框明示："包内扩展代码以完整本地权限运行，仅安装可信来源"。npm 源展示包名，git 源展示仓库地址。
- **布局白名单**：包内只解析 `extensions/ skills/ prompts/ themes/` 四个顶层目录，其余内容忽略。
- **停用即隔离**：停用/卸载后工具与模板立即从注册表移除，不残留。
- **P2 沙箱**（不在本设计范围）：utilityProcess + RPC 工具执行，把扩展代码移出主进程。当前先对齐 pi 的信任模型，不做预防性过度设计。

## 阶段划分

### MVP（零运行时成本通道 + 包管理）

1. vendor `DefaultPackageManager` + SettingsStorage 适配器
2. `domains/packages` 领域 + `/api/packages` 路由
3. Skills 通道（skills.ts packages 根）
4. Prompts 通道（promptTemplates 注册）
5. 验证：安装一个真实 pi 技能包（如 pi 仓库示例技能）端到端可用

### P1（扩展运行时 + UI）

1. Electron 扩展 API（工具 + 生命周期子集）+ esbuild loader
2. 设置页包管理面板
3. 验证：移植一个纯工具类 pi 扩展（如 SSH execution）跑通

### P2（加固，视需要）

- utilityProcess 沙箱
- pi 推出 registry 后的画廊浏览

## 验证重点

- 安装 npm/git 包后，其 skills 出现在技能列表且可被选中执行（走现有技能选择流程）。
- 包内 prompts 可通过现有模板调用路径渲染。
- 同名技能冲突时优先级：内置 > 用户 > 包。
- 停用包后技能/模板/扩展工具立即不再出现在下一次会话。
- 卸载后 `~/.pi-a/packages/` 目录清理、settings 清单同步移除、无残留注册。
- 包安装失败（源无效/网络错误）时清单不写入、目录不留半成品。
- 扩展注册的工具在会话中可被模型调用，停用后调用失败且不崩溃。

## 待确认问题

1. **扩展工具全局注册 vs 会话隔离**：本设计选全局注册（本地可信代码、pi 对齐）。若产品上希望"第三方工具仅在用户显式选择的会话可用"，可改为按次注入（复用 MCP 的 `PromptOptions` 显式传入模式）——需要产品拍板。
2. **MVP 是否连 UI 一起做**：本设计 MVP 只有 API，UI 放 P1。若设置页简单面板成本可控，可与 MVP 合并交付。
3. **git 包更新的时机**：pi 支持手动 `pi update`。PiCoddy-a 是否要"启动时自动检查更新"（默认不做，避免启动变慢与惊喜变更）。
