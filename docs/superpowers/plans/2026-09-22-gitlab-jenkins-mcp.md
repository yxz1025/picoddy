# GitLab / Jenkins 内置 MCP 实现计划

用户已确认：点击加号下载依赖，完成后弹窗填写参数，保存启用；取消保留依赖，失败可重试。

架构：独立 npm MCP 服务复用受管 Node/npm 和 mcp.json 原子存储；前端共享参数卡片；Electron IPC 使用主窗口来源校验。包固定为核验过的 GitLab 1.0.0 / Jenkins 2.3.0，直接运行已安装入口。

- [x] 后端：新增 src/agent/builtin_npm_mcp.ts；测试安装去重、失败重试、取消后的安装状态、配置校验和密钥脱敏。测试命令：npx tsx --test test/src/agent/builtin_npm_mcp.test.ts。
- [x] 集成：application.electron.ts 增加状态/安装/配置路由和可选 MCP 摘要；client.ts、preload.cjs、ipc-handlers.ts 串通 IPC；mcp.ts 在连接时解析当前受管 Node，配置变更断开旧连接。
- [x] 前端：BuiltinNpmMcpCard.tsx 复用连接器卡片和弹窗样式；两张卡片包含加号、安装状态、失败重试、参数编辑、密码输入及取消操作。
- [x] 验证：后端定向测试、IPC 路由测试、前端构建、git diff --check；真实包下载验证入口。无真实账号，不声称服务鉴权联调通过。
