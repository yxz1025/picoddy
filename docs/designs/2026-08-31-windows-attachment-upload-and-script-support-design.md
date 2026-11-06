# Windows 附件上传与脚本支持核查设计

## 背景

Windows 客户端选择附件后可能不在输入区显示。当前渲染进程把文件字节转换为普通数字数组后通过 IPC 发送；主进程上传处理失败时记录日志并返回空数组，前端没有校验返回数量，因此失败会被误判为成功且界面无提示。

用户同时要求核查读取文件、写脚本和 Python 在 Windows 打包环境中的支持情况。

## 目标

- Windows 和 macOS 使用同一条附件 IPC 上传链路。
- 避免普通数字数组造成的跨进程内存放大。
- 上传失败必须显示已有附件错误提示，不能静默消失。
- 明确 Windows 文件读写和 Python 脚本执行边界。

## 非目标

- 不新增文件选择对话框或新的 IPC 通道。
- 不重构附件存储服务、数据库或输入框编辑器。
- 不随应用打包 Python，不自动安装 Python，不增加多解释器探测补丁。
- 不修改脚本权限策略和 Windows 命令执行架构。

## 现状

- 选择器使用 Chromium 原生 `<input type="file">`，Windows 可返回标准 `File`。
- 前端使用 `Array.from(new Uint8Array(buffer))`，大文件会创建数百万至数千万个 JS number。
- 主进程 `attachments.upload` 使用 `Buffer.from(data)` 写入应用数据目录，路径拼接使用 Node `path.join`，本身支持 Windows。
- 主进程捕获所有异常后返回 `[]`；前端过滤返回值后不检查数量，最终保持原输入状态且不报错。
- Windows Shell 工具通过 Win32 `CREATE_NO_WINDOW` 启动 `cmd.exe`，支持读取、创建和修改工作区文件，不弹控制台窗口。
- Python 不包含在 Electron 安装包内。只有系统存在可执行命令且在 PATH 中时才能运行；部分内置专家脚本硬编码 `python3`，不兼容仅提供 `python.exe` 或 `py.exe` 的 Windows 环境。

## 方案

采用 Electron 32+ 官方跨平台文件路径方案，不在 IPC 中传输文件内容：

1. 保留现有 Chromium `<input type="file">`，不新增另一套文件选择 UI。
2. preload 使用 Electron `webUtils.getPathForFile(file)` 从用户实际选择的 `File` 获取本地路径，并直接调用附件 IPC；不把完整路径暴露给网页主世界。
3. 主进程只接收 preload 提交的源文件路径，按现有 25MB、扩展名和文件名规则验证后，将文件复制到应用管理的附件目录并写入数据库。
4. 上传失败时让 `ipcRenderer.invoke` reject，不再返回空数组；前端严格校验返回附件数量，异常沿用现有 `composer-attachment-error` 展示。
5. 非 Electron 浏览器开发环境继续使用已有 HTTP `FormData`，两条链路最终使用同一附件服务校验和存储语义。
6. 更新 Windows 专项文档，记录文件 I/O、Shell 和 Python 的实际支持边界；本次不扩展 Python 逻辑。

该方案依据 Electron 官方 `webUtils.getPathForFile` API。Electron 32 已移除非标准 `File.path`，官方要求在启用 context isolation 时从 preload 调用 `webUtils`。它在 macOS 和 Windows 使用同一接口，避免把文件字节序列化进 IPC。

## 影响范围

- `frontend/src/api/attachments.ts`
- `src/electron/preload.cjs`
- `src/electron/ipc-handlers.ts`
- `src/domains/attachment/node/service.ts`
- `docs/10-Windows-MSI构建与启动处理记忆.md`

## 风险

- `webUtils.getPathForFile` 只接受由本地文件选择产生且有磁盘后端的 `File`；JS 人工构造的 `File` 返回空路径，主进程必须拒绝。
- 主进程必须继续验证大小、扩展名和目标路径，不能因为路径来自 preload 就跳过服务边界。
- 本次不会解决 Windows 未安装 Python或只有 `py.exe` 时的解释器差异，只会如实记录能力边界。
- 不改变 25MB 和 10 个附件的现有产品限制。

## 验证方式

- 主进程 TypeScript 静态检查。
- 前端 TypeScript 静态检查。
- `node --check main.mjs`。
- `git diff --check`。
- 不自动运行测试或打包；Windows 真机需分别人工选择小型文本文件和接近 25MB 的允许格式文件，确认附件 token 出现，失败时显示错误。
