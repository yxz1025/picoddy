# macOS 构建、ASAR 与签名分层设计

## 背景

当前执行 `npm run build:mac` 时，`electron-builder --mac --dir` 已经成功生成应用，随后脚本却报错：

```text
xattr: No such file: dist-electron/mac-arm64/PiCoddy-a.app
```

同一次输出还包含两类警告：

- `asar usage is disabled`：当前配置显式设置了 `asar: false`；
- `skipped macOS application code signing`：本机只找到过期或不受信任的证书，没有有效的 `Developer ID Application` 身份。

这三条信息属于不同层次，不能用同一个改动处理。

首次启用 ASAR 后，打包客户端又出现黑屏。使用现有产物从终端启动得到确定错误：

```text
[main] Electron ready
UnhandledPromiseRejectionWarning: Error: spawn ENOTDIR
    at ensureServiceIsRunning (.../app.asar/node_modules/esbuild/lib/main.js:2268:29)
```

黑屏不是前端资源缺失。静态审计确认 `app.asar` 包含 `frontend/dist/index.html`、全部 172 个前端资源和所有 JavaScript chunk 依赖。真正失败发生在窗口创建之前：主进程加载 `tsx` 时，esbuild 尝试把 ASAR 虚拟路径当作系统可执行文件启动。

## 目标

- 修复 macOS 目录构建完成后仍因错误产物路径退出的问题。
- 启用 ASAR，并只解包确实需要真实文件路径或原生加载的资源。
- 明确区分本地无签名构建与正式签名发布，避免把证书缺失误报成代码构建失败。
- 统一产物目录的事实来源，消除 `dist-electron` 与 `../build/picoddy-a` 双路径。
- 保证受管 npm、连接器 CLI、TypeScript 运行时和原生依赖在打包后仍具备所需的外部文件条件。
- 保证打包主进程在加载 `tsx` 前解析到真实的 esbuild 可执行文件，消除 ASAR 启动黑屏。

## 非目标

- 不在仓库中生成、下载或保存 Apple 开发者证书、私钥和公证凭证。
- 不通过关闭 hardened runtime 伪装成已完成正式签名。
- 不修改 Windows MSI 或 Linux 打包方案。
- 不改变连接器安装、授权、会话工具隔离和运行时版本锁协议。
- 本轮不执行自动测试或打包验证；实施后只按用户当前约束执行语法、类型和差异检查。

## 现状与根因

### 1. 直接失败：构建脚本使用了过期路径

`electron-builder.yml` 当前配置：

```yaml
directories:
  output: ../build/picoddy-a
```

实际产物已经存在于：

```text
../build/picoddy-a/mac-arm64/PiCoddy-a.app
```

但 `package.json` 的 `build:mac` 和 `postbuild` 仍引用：

```text
dist-electron/mac-arm64/PiCoddy-a.app
```

因此 `electron-builder` 已完成，真正失败的是后置 `xattr` 命令。`dist-electron` 中同时存在旧的 builder effective config 和历史产物，更容易造成误判。

### 2. ASAR 警告：配置主动禁用了归档

`electron-builder.yml` 显式设置 `asar: false`，所以警告会稳定出现。启用 ASAR 不能只改一个布尔值，因为当前运行时存在以下真实文件边界：

- 主进程通过 `tsx` 动态加载 TypeScript，`tsx` 间接使用 esbuild 平台可执行文件；
- 受管 CLI 通过 Electron 的 Node 模式执行 bundled npm CLI；
- `onnxruntime-node`、`sharp`、`koffi`、canvas 等依赖包含 `.node` 和平台动态库；
- 下载后的第三方连接器安装在应用数据目录，不属于应用 ASAR，不需要重复解包。

Electron-builder 的 smart unpack 能自动识别一部分原生模块，但受管 npm 和 esbuild 的子进程执行语义不是普通模块读取，仍需显式声明。

### 3. 签名警告：本机没有有效发布身份

日志中的两个身份分别为过期和不受信任状态，因此没有可用于发布的有效签名证书。仓库配置无法修复证书本身。

`--dir` 本地构建可以无签名生成 `.app`；对外分发则需要有效的 `Developer ID Application`、hardened runtime、entitlements 和公证。当前脚本把本地构建与发布条件混在一起，导致警告看起来像构建错误。

### 4. 打包路径还包含一个 ASAR 兼容点

`main.mjs` 的 `APP_ROOT` 基于 `import.meta.url`，启用 ASAR 后可自然指向 `app.asar`。但图标路径在生产环境被单独写成：

```text
<resources>/app/resources/app-icon.png
```

启用 ASAR 后不再存在 `<resources>/app` 目录，应统一基于 `APP_ROOT` 解析应用内资源。

### 5. 黑屏根因：解包文件不等于切换执行路径

当前 `asarUnpack` 已正确生成：

```text
Contents/Resources/app.asar.unpacked/node_modules/@esbuild/darwin-arm64/bin/esbuild
```

但 esbuild 的 JavaScript API 仍从逻辑模块路径执行 `require.resolve()`，得到：

```text
Contents/Resources/app.asar/node_modules/@esbuild/darwin-arm64/bin/esbuild
```

Electron 的 ASAR 文件系统可以读取归档内文件，但操作系统的 `spawn()` 不能执行归档中的虚拟路径，因此返回 `ENOTDIR`。仅增加 `asarUnpack` 规则不足以改变 esbuild 计算出的命令路径。

## 方案

### 一、统一产物目录和构建职责

继续以 `electron-builder.yml` 的 `directories.output: ../build/picoddy-a` 为唯一产物目录，不把 Electron 打包产物迁回 `dist-electron`。原因是 `dist-electron` 同时承担过历史配置或编译输出语义，继续复用会增加污染和误判风险。

调整脚本语义：

- 每次桌面构建前运行平台级清理器，从 `electron-builder.yml` 读取 output 根目录，只移除当前目标平台的旧应用目录和安装包；
- `build:mac` 保持为本地目录构建，显式禁用签名身份自动发现，避免无效本机证书干扰本地流程；
- 删除构建链末尾硬编码的 `xattr -cr dist-electron/...`；
- 删除或改写错误的通用 `postbuild`，不再静默处理一个不存在的历史路径；
- 增加独立的正式发布脚本，由 electron-builder 生成 DMG/ZIP，并要求外部注入有效签名与公证环境；
- 输出位置由 builder 配置和 builder 日志表达，不在 npm script 中复制架构相关的 `mac-arm64` 目录名。

平台级清理器必须拒绝文件系统根、项目根、用户目录和符号链接形式的 output 根。它根据目录项名称做闭合集合匹配：macOS 只处理 `mac`/`mac-*` 应用目录及 DMG/ZIP，Windows 只处理 `win-*unpacked`、MSI/EXE，Linux 只处理 `linux-*unpacked`、AppImage/DEB/RPM。它可以删除 builder 自身的临时配置记录，但不能递归删除整个共享 output 根，从而保留其他平台产物。

本地生成的应用不是从互联网下载得到，通常没有 quarantine 属性，因此默认构建不需要执行 `xattr -cr`。如后续确有清除隔离属性的人工场景，应提供独立、显式且先验证目标存在的命令，而不是绑定到每次构建。

### 二、启用 ASAR 并定义最小外置集合

将 `asar` 设为 `true`，保留 electron-builder 默认的 smart unpack，并显式补充以下类别：

- 所有原生 Node 扩展和平台动态库：`*.node`、`*.dylib`、`*.so`、`*.dll`；
- `esbuild` 与 `@esbuild` 平台包，保证 `tsx` 的转换进程可以执行真实二进制；
- bundled `npm` 包，保证受管连接器安装流程拿到真实的 npm CLI 路径；
- 经源码确认需要由子进程或系统加载器访问的原生运行时包，例如 onnxruntime、sharp、koffi 和 canvas 平台包。

不解包前端静态文件、提示词、内置技能、连接器目录元数据和普通 JavaScript 依赖；这些继续由 Electron 的 ASAR 文件系统读取。下载并安装的第三方连接器仍位于应用数据目录，完全不进入 `app.asar`。

实施时以明确的包路径规则为主，通用二进制后缀规则兜底。不会使用 `node_modules/**/*` 整体解包，因为那会基本抵消 ASAR 的完整性和文件数量收益。

### 三、修正应用内资源定位

生产与开发统一通过 `APP_ROOT` 解析应用内图标、preload、前端静态资源和其他只读资源。这样开发环境指向仓库根，打包环境指向 `app.asar`，不再额外假设 `<resources>/app` 目录存在。

需要真实系统路径执行的内容不得从 `APP_ROOT` 直接启动，必须属于 `asarUnpack` 或应用数据目录。该边界与受管 CLI 的安全模型保持一致。

### 四、在 TSX 初始化前绑定真实 esbuild 二进制

主进程入口必须在第一次加载 `tsx/esm/api` 之前完成 esbuild bootstrap：

1. 先用 Node 内置路径模块计算 `APP_ROOT`，判断入口是否位于 `app.asar`；
2. 开发环境不设置 `ESBUILD_BINARY_PATH`，继续使用依赖默认解析；
3. 打包环境根据 `process.platform` 和 `process.arch` 形成当前平台包名；
4. macOS/Linux 使用 `node_modules/@esbuild/<platform>-<arch>/bin/esbuild`，Windows 使用 `node_modules/@esbuild/win32-<arch>/esbuild.exe`；
5. 将路径固定在 `process.resourcesPath/app.asar.unpacked` 下，验证路径包含关系、文件类型及平台可执行权限；
6. 验证通过后设置 esbuild 官方支持的 `ESBUILD_BINARY_PATH`，再加载和注册 `tsx`；
7. 若打包资源不完整，抛出包含平台、架构和预期路径的明确启动错误，不回退 ASAR 虚拟路径或系统 esbuild。

该方案保留 ASAR，也不复制或修改第三方包源码。`ESBUILD_BINARY_PATH` 是 esbuild 自身读取的正式运行时入口，适合表达“JS API 位于归档、原生服务位于归档外”的部署结构。

### 五、拆分本地构建与正式发布

本地构建：

- 使用 `--mac --dir`；
- 设置 `CSC_IDENTITY_AUTO_DISCOVERY=false`；
- 目标是获得可供本机开发验收的无签名 `.app`；
- 不声称产物适合对外分发。

正式发布：

- 使用 electron-builder 的 mac target 生成 DMG/ZIP；
- 保留 `hardenedRuntime: true`、entitlements 和继承 entitlements；
- 由 CI 或受控发布环境提供有效 `Developer ID Application` 身份和 Apple 公证凭证；
- 发布入口在缺少必要凭证时应明确失败，不降级成无签名发布包。

证书安装和 Apple 账号配置属于发布环境运维，不写入源码和配置仓库。

## 影响范围

- `electron-builder.yml`
  - 启用 ASAR；
  - 增加受控 `asarUnpack` 规则。
- `package.json`
  - 所有桌面构建入口增加平台级前置清理；
  - 修正本地 macOS 构建脚本；
  - 移除错误的后置 `xattr`；
  - 增加清晰的正式发布入口。
- `main.mjs`
  - 在 `tsx` 首次导入前解析并校验 packaged esbuild 的真实路径；
  - 统一应用内资源路径解析，消除 `<resources>/app` 假设。
- 构建专项文档
  - 记录 macOS 本地构建、正式签名和产物位置。

不影响前端业务接口、IPC、数据库、会话协议或连接器目录协议。

## 风险与控制

### ASAR 中的动态 TypeScript 加载

风险：`tsx` 或 esbuild 找不到可执行文件，或继续把 `app.asar` 虚拟路径交给 `spawn()`。

控制：显式解包 esbuild 平台包，并在 `tsx` 加载前将 `ESBUILD_BINARY_PATH` 绑定到经过校验的 `app.asar.unpacked` 真实文件；普通 TypeScript/JavaScript 源码保留在 ASAR 中，由 Electron 文件系统读取。

### esbuild 平台映射不完整

风险：新增目标架构后找不到对应 `@esbuild` 可选包。

控制：只支持 Electron 构建实际声明的桌面平台/架构组合；无法形成受支持映射时立即报告平台与架构，不猜测路径、不回退系统命令。构建配置继续携带 `@esbuild/**/*`，确保目标平台包进入 unpacked 目录。

### 受管 npm 从 ASAR 启动

风险：npm CLI 被解析为 ASAR 虚拟路径后，子进程无法稳定执行或访问自身文件。

控制：完整解包 bundled npm 包，并继续使用运行时锁校验其版本和入口。

### 原生依赖漏解包

风险：应用启动或特定文档、RAG 功能首次使用时才出现动态库加载错误。

控制：保留 smart unpack，增加通用原生后缀和已知平台包规则；正式发布验收需覆盖应用启动、模型会话、连接器安装和本地文档/RAG 入口。

### 无签名应用的系统限制

风险：本地无签名产物在其他机器上触发 Gatekeeper，或无法用于自动更新和正式发布。

控制：在脚本命名和文档中明确“本地无签名”边界；正式发布入口不允许无凭证降级。

### 架构目录差异

风险：Intel 和 Apple Silicon 输出子目录不同，再次出现硬编码错误。

控制：npm script 不拼接 `mac-arm64` 或 `mac`；将 output 根目录交给 electron-builder 管理。

### 清理器目标过宽

风险：构建前清理误删其他平台产物或用户目录。

控制：output 根来自已解析的 builder 配置；清理前执行受保护路径、符号链接和路径包含检查；只删除当前平台闭合集合中的直接子项，不对共享 output 根执行整体递归删除。

## 验证方式

按用户当前约束，本轮实施后仅自动执行：

- `npx tsc --project tsconfig.electron.json --noEmit`
- `node` 对 `package.json` 的 JSON 解析检查
- electron-builder 配置的静态解析检查
- `git diff --check`

不自动运行测试套件，也不自动执行打包。

需要用户另行明确授权后才能进行的动态验收：

1. 执行本地 `build:mac`，确认退出码为 0，且不再访问 `dist-electron/mac-arm64/PiCoddy-a.app`；
2. 检查 `../build/picoddy-a/mac-arm64/PiCoddy-a.app/Contents/Resources/app.asar` 存在；
3. 检查 `app.asar.unpacked` 只包含声明的外置资源；
4. 启动打包应用，验证前端、preload、托盘图标和本地 HTTP 服务；
5. 终端启动日志不再出现 esbuild `spawn ENOTDIR`，并出现静态服务器与应用 ready 日志；
6. 验证受管 npm/连接器安装授权流程；
7. 在具备有效证书的发布环境验证 codesign、DMG/ZIP 和 notarization。

## 结论

最初的构建报错不是 `.app` 未生成，而是成功构建后使用了错误的历史路径；后续黑屏则是 esbuild 仍执行 ASAR 虚拟路径。修复必须同时清理路径双轨，并把真实外置二进制路径显式交给 esbuild。ASAR 与签名仍是独立问题：ASAR 通过受控解包和启动路径绑定解决，签名通过本地与发布流程分层解决，正式证书必须由可信发布环境提供。
