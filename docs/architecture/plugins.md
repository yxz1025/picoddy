# 通用插件运行时（Pi 生态扩展包）

## 目标

用户自装 Pi 生态扩展包（如 `pi-web-access`、`pi-mcp-adapter`、`pi-subagents`），**不修改应用代码、不打进应用包**。安装到用户数据目录，运行时动态加载，与 pi-coding-agent 官方 `pi install npm:xxx` 同机制。

## 目录布局与状态

```
~/.pi-a/plugins/                 # 插件根（appDataDir/plugins）
  <plugin-id>/                   # 已安装插件：npm install --prefix 产物
    package.json                 # dependencies: { <pkg>: "..." }（npm 自动写入）
    node_modules/<pkg>/          # 包内容（含 package.json "pi.extensions" 字段）
```

- **目录存在即已安装**——无单独状态文件；元信息读 `node_modules/<pkg>/package.json`。
- scoped 包用嵌套目录 `@scope/name`。
- 用户手动放置扩展源码到 `~/.pi-a/extensions/`（agentDir）也会被自动发现（Pi 同款机制）。
- 卸载 = `unloadPlugin(id)` + 删目录；安装失败清理半成品目录。
- 无并发锁——单窗口应用，UI 层 `installingId` 防重入。

## 加载机制

`src/agent/plugin_tools.ts`：

- `discoverAndLoadExtensions(pkgDirs, cwd, agentDir, bus)`（pi-coding-agent 官方 API）发现 + jiti 编译 TS 源码。
- 加载走**官方路径**（同 pi-coding-agent AgentSession）：`new ExtensionRunner(extensions, runtime, cwd, sessionManager, modelRegistry)` → `runner.bindCore(actions, contextActions)` → `wrapRegisteredTools(tools, runner)`。本宿主没有真实 SessionManager/ModelRegistry，传入最小支撑对象（`{ getBranch: () => [] }` / 空对象，类型断言）；actions 降级 no-op（宿主不提供会话写入/模型切换/命令）。不绑定则 runtime 的 action 是抛错 stub，插件执行时炸「Extension runtime not initialized」。工具 ctx 由 `runner.createContext()` 官方生成，不自写。
- 加载完成后 `registerPluginToolNames(tools.map(t => t.name))` 把插件工具名注册进 capability 校验放行集（`assertCapabilityAssignments` 要求每个工具必须有精确能力归属，与 MCP 工具的 selectedMcpToolNames 豁免同机制）；卸载时 `unregisterPluginToolNames` 注销。否则 prompt 构建失败「Unclassified tool(s)」。
- 进程级缓存 `loadedPlugins: Map<pluginId, AgentTool[]>`；`getPluginTools()` 合并全部。
- **工具装配每 prompt 重建**（`getFullTools`/`getReadOnlyTools` 无缓存）→ 安装/卸载即时生效，无需重启。
- 同名覆盖：`mergePluginTools(builtin, plugin)` 中插件工具覆盖内置同名工具。
- 单个插件加载失败仅 warn，不阻塞整体。

## 安装/卸载服务

`src/domains/plugin/node/service.ts`：

1. 包名校验 `validatePkgName`（npm 合法包名正则，防命令注入；args 数组传参不拼 shell）。
2. 探测 npm：spawn 失败（ENOENT）→ 「未检测到 Node.js/npm，请先安装」。
3. `npm install --prefix <plugins>/<id> <pkg>@latest`，5 分钟超时 kill（Windows 经 `cmd.exe /c` 包装，因 `.cmd` 无法直接 CreateProcessW）。
4. 成功后 `loadAllPlugins()` 刷新缓存；`isPluginLoaded(id)` 为 false（非 Pi 扩展包）→ 清理目录 + 报错。
5. 卸载：校验已安装 → `unloadPlugin` + 删目录。
6. `searchPackages(q)`：npm registry `/-/v1/search?text=<q>&size=20`（与 Pi 官方同数据源）。

## API 与 IPC

```
GET  /api/plugins          已安装列表（id/name/version/description/loaded）
GET  /api/plugins/catalog  内置精选清单 + installed 状态
GET  /api/plugins/search?q=  npm registry 搜索结果
POST /api/plugins/install  { package }  400 非法包名 / 500 安装失败
POST /api/plugins/uninstall { id }
```

IPC 三段式：`client.ts` IPC_ROUTES（5 条 route）→ `preload.cjs` `plugins` 域 → `ipc-handlers.ts` `_registerDomainHandlers`（`api()` 助手）。

启动预热：`application.electron.ts` 顶层在 `refreshInstalledExperts()` 后调 `loadAllPlugins()`（失败仅 warn）。

## 安全模型

- 插件在主进程执行任意代码（与 VSCode 扩展同模型，Pi 官方亦如此）——安装 UI 显示来源与包名，接受此模型。
- 包名正则校验防注入；npm args 数组传参。
- 只读白名单：包 `package.json` 声明 `"pi.readOnlyTools"`（缺失时用 `PLUGIN_CATALOG` 兜底映射），经 `registerReadOnlyToolNames` 注册进 L1 只读模式放行集。

## 前端

- `usePluginStore.ts`：installed / catalog / searchResults / installingId / error。
- `PluginSection.tsx`（技能市场 tab 顶部）：精选卡片网格（三态按钮：安装 / 安装中… / 已安装+卸载）、npm 搜索（400ms 防抖）、手动包名安装、卸载二次确认（「卸载」→「确认卸载？」）。

## 开发者如何发布扩展包供用户安装

1. npm 包内 `package.json` 声明 `"pi": { "extensions": ["./index.ts"] }`（或根目录 `index.ts`）。
2. 包 exports `piAgentExtension` 并注册工具，可选声明 `"pi.readOnlyTools": [...]`。
3. 用户在本应用「技能市场 → 插件推荐」搜索包名或从精选清单一键安装。

## 未来扩展

- 自建市场源（替代 npm registry 搜索）：仿 Codex marketplace（Git 仓库清单 + 本地缓存）。
- 插件配置面板、启停开关（当前目录即状态，卸载即删除）。
