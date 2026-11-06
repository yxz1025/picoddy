# 主进程危险操作日志设计

## 目标

为 Windows 打包客户端增加可用于崩溃定位的结构化操作日志，覆盖所有可能导致 Electron 主进程退出、原生调用失败或子进程异常的边界。日志必须避免记录 API Key、Token、密码、Authorization 和请求正文。

## 范围

记录业务操作和系统危险边界，不记录普通 DOM 点击、输入框每次变化或完整请求参数。重点包含：

- Electron 启动阶段和正常退出阶段。
- IPC 调用和内部 API 路由调用。
- SQLite 初始化、Windows DPAPI 密钥读写。
- PowerShell、子进程、Windows 原生调用。
- MCP、连接器和外部请求的开始、结束、失败与耗时。
- 主进程未捕获异常、未处理 Promise rejection，以及 Electron 渲染/子进程退出。

## 日志格式与位置

使用 JSON Lines，每行一条事件，写入：

- Windows：`%LOCALAPPDATA%\\Pi-a\\logs\\operations.jsonl`
- macOS/Linux：`~/.pi-a/logs/operations.jsonl`

每条事件包含时间戳、事件阶段、操作名、子系统、进程号、平台、架构、耗时和错误摘要。危险操作在执行前同步写入 `begin` 事件；完成后写 `success` 或 `error`。因此，即使 native 调用直接终止主进程，最后一条 `begin` 仍能指出崩溃边界。

## 脱敏规则

日志只允许记录经过筛选的元数据，例如 provider ID、路由名、参数数量、输入长度和退出码。以下字段和值永远不写入：`key`、`apiKey`、`token`、`password`、`secret`、`authorization`、`cookie`、请求正文及命令行密钥。错误文本也必须经过统一脱敏。

## 失败处理

日志写入失败不得阻塞业务操作，也不得触发二次崩溃。日志目录自动创建；单个日志文件达到固定大小后轮换，保留有限数量的历史文件。主进程异常处理器使用同步追加，确保崩溃前事件尽可能落盘。

## 验证

验证日志格式、脱敏、开始/结束配对、错误堆栈和 Windows 路径行为。当前 macOS 环境只做静态检查与单元测试；Windows x64 上需重新打包后验证启动、保存 Key、测试连接、子进程失败和应用退出场景。
