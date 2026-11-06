# 剪贴板图片粘贴附件设计

## 背景

当前 Composer 支持通过“添加文件”和拖放方式上传图片，但不支持将截图工具、浏览器或即时通讯软件复制到剪贴板的图片通过 `Ctrl+V` 直接加入当前对话。

现有 `handleEditorPaste()` 会无条件阻止浏览器默认粘贴行为，并且只读取 `clipboardData.getData("text/plain")`。剪贴板中的 `image/*` 文件因此被忽略。即使直接把剪贴板 `File` 交给现有上传函数，Electron preload 也只通过 `webUtils.getPathForFile()` 获取磁盘路径；剪贴板图片不是磁盘文件时该 API 返回空字符串，上传会以“无法读取所选文件路径”失败。

项目现有附件系统已经具备图片扩展名校验、大小与数量限制、本地文件保存、数据库记录、输入框附件标签、消息关联和历史展示能力。本次应补齐剪贴板图片进入该系统的入口，不重做附件模型。

## 目标

- 在 Composer 获得焦点时，支持通过 `Ctrl+V` 粘贴剪贴板中的 PNG、JPEG、GIF、WebP 等现有白名单图片。
- 粘贴图片后复用现有附件上传流程，在光标位置显示附件标签，并随当前消息发送。
- 支持纯图片粘贴以及“纯文本 + 图片”混合剪贴板内容；混合内容中的文本继续按现有规则归一化并插入。
- 保持点击选择文件、拖放文件、纯文本粘贴和技能/附件标签光标行为不变。
- 对没有磁盘路径的剪贴板 `File` 通过安全 IPC 传输字节，在主进程完成校验、落盘和附件数据库写入。
- 保持 Windows 和 macOS Electron 行为一致，并保留非 Electron 环境的 HTTP FormData 上传路径。

## 非目标

- 本次不把图片直接转换为各模型供应商的原生多模态 image content。
- 本次不改变图片附件在 Prompt Runtime 中的 `binary_asset` 表示，也不承诺模型仅凭该附件即可完成视觉理解。
- 不增加新的图片格式、附件数量或大小限制。
- 不实现剪贴板 HTML、富文本样式或 base64 图片标签解析。
- 不修改附件数据库结构、会话消息结构或历史消息展示样式。

## 现状

### Composer 粘贴

`frontend/src/components/Composer.tsx` 的 `handleEditorPaste()` 调用 `preventDefault()` 后只读取 `text/plain`，没有检查 `clipboardData.items` 或 `clipboardData.files`。图片粘贴不会进入 `handleFilesSelected()`。

### 附件上传

`frontend/src/api/attachments.ts` 在 Electron 环境优先调用 `window.electronAPI.attachments.upload(file)`。

`src/electron/preload.cjs` 的 `attachments.upload()` 使用 `webUtils.getPathForFile(file)`，仅能处理由磁盘文件选择或拖放得到的 `File`。JS 或剪贴板构造的内存文件没有磁盘路径，因此当前桥接会直接失败。

`src/electron/ipc-handlers.ts` 的 `attachments.upload` handler 目前只接受 `{ path, mimeType }`，并调用 `saveLocalFiles()`。

### 可复用能力

`src/domains/attachment/node/service.ts` 已提供：

- `saveLocalFiles()`：复制有磁盘路径的文件；
- `saveUploadedFiles()`：从 Web `File` 字节流写入附件目录；
- 文件名、扩展名、25 MB 大小限制和最多 10 个附件的服务端校验；
- 文件落盘与附件数据库记录的一致性清理。

因此内存图片可在主进程重建为 `File` 后复用 `saveUploadedFiles()`。

## 方案

### 1. 提取并规范化剪贴板图片

在 Composer 粘贴处理器中遍历 `clipboardData.items`：

- 只提取 `kind === "file"` 且 MIME 为 `image/*` 的项目；
- 调用 `getAsFile()` 获得图片文件；
- 当剪贴板文件名为空或没有受支持的图片扩展名时，根据 MIME 类型生成 `clipboard-image-<timestamp>-<序号>.<扩展名>`；
- 不接受无法映射到现有图片白名单的 MIME 类型，继续由现有附件错误提示处理。

处理顺序为：先阻止默认粘贴，再按现有逻辑插入 `text/plain`，随后把规范化图片交给附件上传流程。附件锚点使用文本插入后的光标位置，避免图文混合粘贴时标签出现在原光标之前。

为避免复制现有选择删除、文本归一化和附件锚点移动逻辑，将当前文本粘贴部分抽成 Composer 内部复用函数；纯文本粘贴继续走相同函数。

### 2. 支持无路径 File 的 preload 上传

保持 `attachments.upload(file)` 前端调用形式不变，在 preload 内部选择两条分支：

- `webUtils.getPathForFile(file)` 返回有效路径：继续发送 `{ path, mimeType }`，保持现有选择文件和拖放行为；
- 路径为空：读取 `file.arrayBuffer()`，发送 `{ name, mimeType, bytes }`。

字节数据使用 `ArrayBuffer` 通过 Electron structured clone 传输，不使用 base64，避免额外体积和编码开销。

### 3. 扩展附件 IPC handler

将 `attachments.upload` 请求定义为互斥的两种载荷：

- 本地路径载荷：`{ path, mimeType }`；
- 内存文件载荷：`{ name, mimeType, bytes }`。

主进程处理规则：

1. 有合法 `path` 时继续调用 `saveLocalFiles()`；
2. 否则校验 `name`、`mimeType` 和 `bytes` 类型；
3. 把字节重建为 Web `File`；
4. 调用 `saveUploadedFiles()`，由领域服务执行与其他附件一致的文件名、扩展名和大小校验，并同时写入文件与数据库记录；
5. 返回现有 `PublicAttachment` 结构，前端后续流程不变。

不新增 IPC 通道，继续使用既有 `attachments.upload` 白名单项，避免扩张 preload API 面。

### 4. 错误与并发行为

- 任务运行中、正在发送或已有附件上传进行中时，沿用现有错误提示。
- 图片超过 25 MB、总数超过 10 个、格式不支持或与待发送附件重复时，沿用 `validateSelectedFiles()` 的提示。
- 内存字节传输失败、主进程载荷无效或落盘失败时，沿用现有附件上传错误区域展示。
- 一次粘贴的多个图片作为同一批次上传；任何一个失败时保持现有批次失败语义。

### 5. 回归约束

新增源码级或可独立运行的回归测试，覆盖：

- Composer 从 `clipboardData.items` 提取图片并路由到 `handleFilesSelected()`；
- 图片与文本混合粘贴时保留文本并将附件锚定到插入后位置；
- preload 对有路径 File 保持原 IPC 载荷；
- preload 对无路径 File 使用字节载荷；
- IPC handler 的路径载荷继续调用 `saveLocalFiles()`，字节载荷调用 `saveUploadedFiles()`；
- 非图片剪贴板文件不会被误当作图片附件。

测试源码会按项目规范编写，但除非用户明确授权，本次不自动运行测试套件。

## 影响范围

- `frontend/src/components/Composer.tsx`
- `frontend/src/api/attachments.ts`（原则上保持接口不变，仅在需要明确类型或错误处理时调整）
- `src/electron/preload.cjs`
- `src/electron/ipc-handlers.ts`
- 与 Composer 剪贴板和附件 IPC 对应的测试文件
- `docs/15-Pi-Agent与Electron前端IPC交互协议.md` 中附件上传载荷说明

预计不修改：

- 附件数据库表结构；
- 会话发送载荷；
- `application.electron.ts` 的 HTTP FormData 上传接口；
- Prompt Runtime 和模型 Provider；
- 当前工作区中与本需求无关的生成文件、构建目录和发布日志。

## 风险

- 不同来源的剪贴板图片文件名和 MIME 类型不完全一致，需要生成稳定且可通过现有扩展名校验的文件名。
- 图文混合粘贴涉及 contenteditable 光标、React 状态刷新和异步上传，必须在上传前冻结文本插入后的附件锚点，不能在上传完成后重新读取可能已变化的光标。
- 大图片通过 IPC 复制会占用短时内存；现有 25 MB 限制在前端和主进程均保留，且使用 `ArrayBuffer` 避免 base64 膨胀。
- `Composer.tsx` 当前文件较大且近期有文件拖放改动，实施时只做局部修改，避免覆盖已有行为。
- 生成文件当前在 IDE 中显示状态异常，但内容与 Git 索引一致；本次不得重新生成或提交这些文件。

## 验证方式

遵循项目约束，本次默认执行：

1. 前端 TypeScript 类型检查：`cd frontend && npx tsc --noEmit -p tsconfig.app.json`
2. Electron/后端 TypeScript 类型检查：`npx tsc --project tsconfig.electron.json --noEmit`
3. `git diff --check`
4. 检查最终差异，确认没有修改现有生成文件、`build/` 或发布日志
5. 静态检查纯文本粘贴、文件选择和文件拖放仍保留原调用链

建议的人工验收场景：

1. Windows 截图后在空输入框按 `Ctrl+V`，出现图片附件标签并可发送；
2. 在已有文本中间粘贴图片，附件标签位于当前光标；
3. 从浏览器复制同时包含文本和图片的内容，文本与图片均保留；
4. 连续粘贴多张图片，数量、重复和 25 MB 限制提示正确；
5. 点击选择图片和拖放图片仍可正常上传；
6. 纯文本、多行文本和技能命令粘贴行为不变。

## 实施结果

- Composer 粘贴入口已支持从 `clipboardData.items` 提取图片，并在缺少有效文件名时根据 MIME 类型生成受支持的图片文件名。
- 纯图片和图文混合粘贴均复用现有 `handleFilesSelected()`；附件锚点冻结在粘贴文本后的光标位置。
- Preload 已保留磁盘路径上传分支，并为无路径的剪贴板 `File` 增加 `ArrayBuffer` 字节载荷。
- `attachments.upload` IPC handler 已支持路径与字节两种互斥载荷；字节载荷重建为 Web `File` 后复用 `saveUploadedFiles()`。
- 已补充附件 IPC 协议文档和源码级回归测试；按项目约束未运行测试套件。
- 前端 TypeScript 类型检查通过，Preload Node 语法检查通过，`git diff --check` 通过。
- Electron/后端全量 TypeScript 类型检查被既有 `src/domains/skill/node/store.ts` 中 `version` 字段类型错误阻断；错误不在本次修改文件中。
