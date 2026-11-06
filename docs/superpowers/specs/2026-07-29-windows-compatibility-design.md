# Windows Compatibility Design

## 目标

在不改变现有 macOS 业务行为、接口响应和性能路径的前提下，为 Pi-a 增加 Windows 10/11 x64 支持。首期覆盖桌面打包、路径与数据目录、文件打开、目录选择、剪贴板与前台应用、LibreOffice PDF 导出、防休眠、权限诊断和原生依赖构建。Computer Use 的 Windows 实现放在最后一个独立阶段。

发布产物同时包括：

- macOS `.app`，继续沿用现有构建和运行逻辑。
- Windows x64 便携应用目录，可压缩为 ZIP 分发。
- Windows x64 `.msi` 安装包。

## 约束

- macOS 分支继续执行现有 `open`、AppleScript、`pbpaste`、`caffeinate`、`cliclick` 和系统框架调用。
- 不在 macOS 热路径上增加外部进程、网络请求或重复平台检测。
- 前端调用的 API 路径和主要响应字段保持兼容。
- Windows 命令必须使用结构化参数传递，不把用户路径拼接进可执行脚本文本。
- Windows 不得伪报 macOS 权限或 Computer Use 能力可用。
- 原生依赖必须在对应平台构建或验证，不能复用另一平台的原生缓存。

## 方案选择

采用统一平台适配层。业务代码调用稳定接口，平台模块内部根据 `Deno.build.os` 委派给 macOS 或 Windows 实现。

未采用以下方案：

- 在业务文件中就地散布平台判断：改动看似较少，但容易遗漏，难以测试。
- 维护独立的 Windows 主入口：会复制路由和业务逻辑，长期产生双平台行为漂移。

## 模块结构

### `src/platform/runtime.ts`

提供平台标识和能力描述：

- `currentPlatform`
- `isMacOS`
- `isWindows`
- `PlatformCapabilities`

平台值在模块初始化时计算一次。macOS 业务路径不会重复执行平台探测。

### `src/platform/paths.ts`

提供：

- `homeDir()`
- `tempDir()`
- `appDataDir()`
- `joinPath()`
- `dirname()`
- `basename()`
- `isAbsolutePath()`
- `expandHomePath()`

macOS 应用数据目录继续为 `~/.pi-a`。Windows 使用 `%LOCALAPPDATA%\Pi-a`，缺失时降级到 `%USERPROFILE%\AppData\Local\Pi-a`。所有新代码使用 `node:path` 的平台实现，不再用字符串 `/` 拆分文件系统路径。

已有数据库、技能、草稿、截图、工件、任务、快照、专家缓存和 MCP 配置逐步统一到该模块。macOS 返回路径必须与改造前一致。

### `src/platform/shell.ts`

统一暴露：

- `openPath(path)`
- `pickDirectory()`
- `readClipboardText()`
- `getForegroundApplication()`

macOS 实现保持：

- `open`
- AppleScript 原生目录选择
- `pbpaste`
- System Events 查询前台应用

Windows 实现：

- 使用 `cmd.exe /d /s /c start "" <path>` 打开文件或目录；路径作为独立参数处理。
- 使用 PowerShell STA 模式调用 `.NET FolderBrowserDialog`。
- 使用 PowerShell `Get-Clipboard -Raw` 读取剪贴板。
- 使用 PowerShell 和 Win32 `GetForegroundWindow`/`GetWindowThreadProcessId` 获取前台进程。

目录选择取消统一返回 `null`。调用方继续转换成 `{ cancelled: true }`。

### `src/platform/libreoffice.ts`

统一提供：

- `findLibreOfficeExecutable()`
- `exportWithLibreOffice(sourcePath)`

macOS 搜索顺序保持现有 `/Applications/LibreOffice.app/Contents/MacOS/soffice` 和 `/opt/homebrew/bin/soffice`。

Windows 搜索顺序：

1. `PATH` 中的 `soffice.exe`
2. `%PROGRAMFILES%\LibreOffice\program\soffice.exe`
3. `%PROGRAMFILES(X86)%\LibreOffice\program\soffice.exe`

输出目录、文件名和生成结果使用跨平台路径函数计算。错误提示按平台给出安装方式。

### `src/platform/power.ts`

统一提供：

- `setKeepAwake(enabled)`
- `disposeKeepAwake()`

macOS 继续使用现有 `caffeinate -d -i` 子进程。

Windows 使用一个受控 PowerShell 子进程调用 Win32 `SetThreadExecutionState`，并保持进程存活。关闭功能或应用退出时终止该进程并恢复系统默认电源状态。模块保证重复启用幂等且不会产生多个后台进程。

### `src/platform/permissions.ts`

统一返回：

- 操作系统
- 目录选择、剪贴板、前台应用能力
- Computer Use 能力
- 辅助功能和屏幕录制状态
- 依赖可用性及错误信息

macOS 继续执行现有 Accessibility、CoreGraphics 和 `cliclick` 检查。

Windows 首期将通用桌面能力按真实探测结果返回；Computer Use 标记为未实现。不得再通过非 macOS 分支直接把全部权限设为 `true`。

### `src/platform/index.ts`

仅导出业务层需要使用的稳定接口。平台实现细节不得从该入口泄漏。

## API 改造

`main.ts` 保持现有 HTTP API：

- `/api/open`
- `/api/pick-dir`
- `/api/export-pdf`
- `/api/system/permissions`
- `/api/system/permissions/open`
- `/api/system/context`

这些路由改为调用平台适配层。

兼容规则：

- 成功响应保持现有字段。
- 目录选择取消仍返回 `{ cancelled: true }`。
- 系统上下文失败仍返回空字符串，不阻塞聊天。
- 权限接口增加能力字段时保留现有字段，避免前端旧逻辑崩溃。
- Windows 权限设置入口只打开实际存在的 Windows 设置页面；无法定位时返回可展示的错误。
- 平台命令失败必须转成明确的 API 错误，不允许未处理异常终止服务。

## 默认设置

移除前后端写死的 `/Users/hanfeng/Desktop/pi-a` 和 `/tmp` 默认安全目录。

默认值在后端按平台生成：

- macOS：保持当前兼容目录语义。
- Windows：使用用户目录、系统临时目录和默认工作区。

前端不再内置某位开发者的绝对路径，只展示后端返回值。工作区输入框提示改为平台中立示例。

## 原生依赖

以下依赖必须在 Windows 构建或 CI 环境验证：

- `keytar`
- SQLite 使用的原生绑定
- Deno Desktop WebView/CEF 后端

Windows 终端和 Sidecar 固定使用 `child_process.spawn`/`Deno.Command`
纯管道，不声明、加载或打包 `node-pty`。这是强制架构约束，不是运行失败后的降级策略。
桌面端通过 ACP/HTTP 通信，不需要 PTY 语义，同时规避 ConPTY/winpty
兼容性、命名管道锁竞争和输出截断问题。macOS 保持当前运行实现不变。

API Key 存储继续优先使用 `keytar`。Windows 构建验证 Windows Credential Manager 能正常读写；失败时仅保留现有环境变量读取降级，不静默明文写入配置文件。

## Deno Desktop 构建

要求 Deno 2.9 或更高版本。

使用官方支持的目标：

```text
x86_64-pc-windows-msvc
```

新增构建任务：

- `build:mac`
- `build:windows`
- `build:windows:portable`
- `build:windows:msi`

便携产物使用 Deno Desktop 的 Windows 应用目录，不宣称为单文件 EXE。发布时将整个目录压缩成 ZIP。

MSI 由 Deno Desktop 直接生成：

```bash
deno desktop \
  --target x86_64-pc-windows-msvc \
  --output dist/windows/Pi-a.msi \
  --icon resources/app-icon.ico \
  --compress \
  --allow-read --allow-write --allow-env --allow-net \
  --allow-ffi --allow-sys --allow-run --allow-scripts \
  main.ts
```

配置补充稳定的应用名称、标识符、分平台图标和输出目录。Windows 新增多尺寸 `resources/app-icon.ico`；macOS 继续使用现有图标资源。

Windows 对外发布前使用代码签名证书和 `signtool` 签署应用二进制及安装包。签名配置允许通过 CI 密钥注入，不将证书提交到仓库。

## Computer Use 后置阶段

首期只完成平台接口和准确的能力报告，不实现 Windows 鼠标键盘控制。

最后阶段补充：

- Windows 屏幕尺寸与缩放比例
- 屏幕截图
- 鼠标移动、点击、拖动和滚轮
- 键盘输入及快捷键
- 窗口列表、前台窗口和窗口聚焦

优先使用 Win32/UI Automation 能力；PowerShell 只作为低频或降级方案。macOS 的 `cliclick` 和 AppleScript 路径不改动。

## 错误处理

- `unsupported`：平台明确不支持。
- `unavailable`：平台支持但依赖未安装。
- `failed`：执行过程中失败。

API 返回适合用户展示的中文信息，日志保留底层命令和退出码，但不得记录剪贴板内容、API Key 或完整敏感文件内容。

所有子进程设置超时或受控生命周期。应用退出时清理防休眠进程及其他长期存活的 Windows 辅助进程。

## 测试与验收

### 静态及单元测试

- 路径模块分别模拟 macOS 和 Windows 环境。
- 验证 macOS 路径和命令与改造前一致。
- 验证 Windows 空格路径、中文路径、盘符路径和 UNC 路径。
- 验证打开文件、目录选择、LibreOffice 搜索和防休眠的命令选择。
- 验证 PowerShell 参数不会被用户路径解释为脚本。
- 验证权限接口不会在未实现时返回可用。

### macOS 回归

- 应用启动和退出。
- 聊天、附件、技能和文档处理。
- 文件打开、目录选择、PDF 导出。
- 系统上下文、剪贴板、防休眠。
- Computer Use 现有能力。
- 构建 `.app` 并在干净用户环境启动。

### Windows 验收

- Windows 10/11 x64 启动便携目录。
- 安装、启动和卸载 MSI。
- 中文用户名和包含空格的安装/工作区路径。
- 聊天、附件、技能、SQLite 数据和文档处理。
- 文件打开、原生目录选择、剪贴板和前台应用。
- LibreOffice 已安装及未安装两种分支。
- 防休眠启用、关闭和应用异常退出后的恢复。
- Keytar/Credential Manager 写入、读取和删除。
- Computer Use 首期准确显示不可用；最后阶段通过完整自动化验收。

Windows 真机/CI 验收是发布 Windows 支持的必要条件。仅在 macOS 上完成交叉编译不视为 Windows 功能通过。

## 实施顺序

1. 建立平台标识与路径模块。
2. 迁移数据目录和默认设置。
3. 实现打开文件、目录选择、剪贴板和前台应用。
4. 实现 LibreOffice 跨平台发现与导出。
5. 实现防休眠和退出清理。
6. 修正权限能力报告和设置入口。
7. 增加 Windows 图标、便携目录及 MSI 构建。
8. 验证和修复 Windows 原生依赖。
9. 完成 macOS 回归与 Windows 真机验收。
10. 最后实现 Windows Computer Use。
