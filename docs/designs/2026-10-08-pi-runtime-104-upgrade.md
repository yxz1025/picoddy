# Pi 1.0.4 升级与验证记录

日期：2026-10-08。当前工作区由 Pi 0.83.0 升级至 1.0.4，未提交、未发布。

## 最终实现

- 将 chord、pi-agent-core、pi-ai、pi-coding-agent、pi-tui、pi-codemode、pi-mcp 全部精确锁定为 1.0.4；`npm ls` 确认使用同一版本，没有混入 0.83 或 1.1。
- 删除已被上游移除的 experimental harness 适配和旧 CoreSession 转换代码；使用 Pi 原生 AgentSession、SessionManager、ModelRuntime、压缩和持久化。
- 技能目录、技能格式化、显式 `/skill:` 调用、提示模板加载与参数解析使用 Pi 实现。专家与连接器技能提供完整原生元数据，按会话资源范围加载。
- 插件由每个原生会话加载、绑定真实上下文和 settings，接收 session_start/session_shutdown。全局插件扫描只提供工具目录，不再通过伪造会话上下文执行工具。
- 标准 MCP stdio/Streamable HTTP 使用 Pi 客户端与传输，保留安全元数据、图片和结构化结果，支持分页、取消以及初始化期间关闭。Pi 未提供旧 SSE 传输，因此 SSE 继续使用官方 MCP SDK；产品 TAPD 授权与业务协议保持原实现。
- 产品权限、受保护目录、工具选择、任务完成边界和业务领域工具继续由产品层负责。Pi 没有这些产品规则，不能用通用内核替换。
- 后端测试入口改为 Node 文件遍历和 spawn 参数数组，移除 Unix find 命令依赖；新增测试使用跨平台临时目录、Node 子进程与 HTTP 服务。

## 验证结果

| 检查 | 结果 |
| --- | --- |
| TypeScript `tsc -p tsconfig.electron.json` | 通过，0 错误 |
| 前端生产构建 `npm run build:frontend` | 通过，有既有 bundle 大小提示 |
| 后端全量 `npm run test:backend` | 664 项：625 通过、31 失败、1 取消、7 跳过 |
| 升级前 HEAD 独立目录、原 0.83 依赖，同一测试入口 | 666 项：610 通过、48 失败、1 取消、7 跳过 |
| 前端现有测试 | 148 项：147 通过、1 失败；失败在升级前 HEAD 单独复现 |
| HTTP 服务测试 `node --test --test-timeout=30000 test/server/*.test.mjs` | 33/33 通过 |
| 升级重点测试组合 | 40/40 通过；最终全量再次包含原生会话与 MCP 新测试 |
| macOS arm64 应用打包 | 通过，未发布 |
| 最终应用包内隔离冒烟 | Pi 1.0.4、图片读取/输入处理、会话调用通过，Electron 43.2.0 / Node 24.18.0 |
| `git diff --check` | 通过 |

按测试名归一化路径与运行时间后比较，最终后端的 31 个失败和 1 个取消全部在升级前基线复现，没有新增失败项。测试数量变化包含移除旧 harness 测试、新增原生集成测试，并修正失效的原生会话测试桩。这里没有把“没有新增失败”视为“所有功能通过”。

新增集成验证覆盖：原生技能正文展开、图片输入、系统提示、权限拦截、会话重开、压缩落盘、插件真实上下文与关闭事件、MCP stdio/HTTP、分页、鉴权头、图片/结构化结果、错误、调用取消、初始化中断。模型使用 Pi fauxProvider，MCP 使用真实本地测试服务，不会向生产系统发送业务请求。

## 兼容边界与未验证范围

- 旧自定义格式会话不再自动迁移或使用兼容层。历史文件保留；尝试继续该类会话会提示新建会话。原生 Pi 格式会话支持重开。
- Windows 相关路径/进程实现已按跨平台 API 处理，现有平台单元测试随全量执行；当前机器为 macOS，没有 Windows 真机，也没有完成 Windows 安装包运行验证。
- 没有运行真实付费模型、生产账号授权或外部系统写入端到端测试。现有自动化测试无法证明全部生产功能均正常。
- 原生 SDK 根入口未导出的 shell operations 与提示模板 helper 仍集中在 vendor 文件引用 Pi 自身实现；精确锁版避免内部路径随版本漂移。

## 产物与原始日志

macOS 应用：`/private/tmp/pi-104-package/mac-arm64/PiCoddyClaw.app`。

日志位于本机临时目录，可能被系统清理：

- `/private/tmp/pi-104-final-backend.log`
- `/private/tmp/pi-104-baseline-tests.log`
- `/private/tmp/pi-104-frontend-tests.log`
- `/private/tmp/pi-104-baseline-frontend.log`
- `/private/tmp/pi-104-server-tests.log`
- `/private/tmp/pi-104-final-native.log`
- `/private/tmp/pi-104-mcp-final.log`
- `/private/tmp/pi-104-after-tsc.log`
- `/private/tmp/pi-104-frontend.log`
- `/private/tmp/pi-104-package.log`
- `/private/tmp/pi-104-packaged-smoke.log`

## 升级前已存在的后端失败/取消项

以下是最终全量运行的原始测试名；其中连接器 cancel 用例在 60 秒后取消。业务与 UI 断言、失效导出和测试夹具问题不作为本次 Pi 升级的附带重构。

- WorkBuddy behavior ownership is a complete deterministic governance audit
- auth exit without matching status is AUTH_FAILED
- cancel aborts an in-flight operation
- capability context derives groups from active tools without descriptions
- composer routes clipboard images through the existing attachment flow
- desktop -> HTTP gateway -> callback -> account discovery token, restart and isolation
- ensurePythonRuntime installs and reuses a validated version
- full registry loads every active and dormant capability fragment
- installed expert cards use the compact reference dimensions
- installs, extracts the Skill, and atomically activates the version
- logout runs the CLI reset and keeps the installation
- manual config cannot overwrite reserved names or forge a managed source
- manual replacement and deletion preserve builtin configs and credentials in the same file
- memory source uses scope-specific stable sorting and whole-entry budgets
- model prompt includes fresh TAPD text, tasks, stage, all repository references and selected assets
- multiple live repositories and pinned asset versions survive switching and edits
- new task aligns with the navigation menu gutters
- project builtin source publishes the official frontend-design skill
- project discovery failure keeps the account authorized and recovers on retry
- rate limiting during verification stops later batches and resumes without duplicate writes
- rejects ZIP traversal, duplicate paths, symlinks, depth, count, and inflated-byte overflow
- rejects package identity, bin, and lockfile tampering
- scaffoldMicroapp copies frozen skeleton and rewrites placeholders
- scaffoldMicroapp rewrites placeholders copied from a read-only skeleton
- task and space headers stick within their section wrappers
- template generation removes examples, retains instructions and produces importable rows
- test/src/agent/tools/subagent.test.ts
- test/src/domains/automation/node/activity_gate.test.ts
- test/src/domains/testing/node/execution.test.ts
- update and repair delegate to activate
- upload-only validates before remote writes, preserves local failure, retries and deduplicates by content and field
- welcome secondary menu is 5px from the taller composer
