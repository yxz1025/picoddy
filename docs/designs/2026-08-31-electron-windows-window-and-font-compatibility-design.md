# Electron Windows 窗口、样式与字体兼容设计

## 背景

当前 Electron 主窗口只在 macOS 使用 `hiddenInset` 标题栏。Windows 使用 Electron 默认原生窗口，并且未移除默认应用菜单，因此打包或开发运行时会出现 `File / Edit / View / Window / Help` 菜单。前端虽然已有 Windows 可用的字体回退和响应式布局，但平台判断、标题栏拖拽区域、系统字体与打包后平台能力尚未形成明确的一致策略。

## 目标

- Windows 客户端不显示 Electron 默认菜单栏。
- macOS 保留符合系统习惯的红绿灯和 `hiddenInset` 外观。
- Windows 保留原生最小化、最大化、关闭按钮及窗口缩放能力，避免无框窗口必须自行实现命中测试、系统菜单和辅助功能。
- 统一中英文、等宽字体和符号字体回退，在 macOS 与 Windows 均优先使用系统字体。
- 明确前端布局在 Windows 缩放、较小窗口和不同字体度量下的适配边界。
- 列出 macOS / Windows 打包后的平台能力差异和不可用项。

## 非目标

- 不实现完全自绘的 Windows 标题栏和窗口控制按钮。
- 不改变现有产品布局、主题配色或交互信息架构。
- 不引入或打包第三方字体文件。
- 不在本次改动中为某个平台补齐其底层本来不支持的系统自动化能力。

## 现状

### 窗口与菜单

- `main.mjs` 创建 `BrowserWindow` 时，macOS 设置 `titleBarStyle: "hiddenInset"`，Windows 没有专用窗口配置。
- 主进程导入了 `Menu`，但仅用于托盘和 macOS Dock 菜单，没有调用 `Menu.setApplicationMenu(null)`。
- Windows 因此显示 Electron 默认菜单；按 `Alt` 也可能激活菜单栏。
- 侧栏顶部已设置 `-webkit-app-region: drag`，但目前主要服务于 macOS 的隐藏式标题栏。

### 样式与字体

- 主窗口最小尺寸为 `960 × 640`，多数主布局使用 Flex 且关键容器有 `min-width: 0`，基础桌面适配可用。
- 工具弹窗和侧面板普遍使用 `max-width` 或媒体查询；固定宽度组件在约 1000px 处已有降级。
- 全局字体当前为 Apple 系统字体、`Segoe UI`、苹方、微软雅黑的回退链；Windows 中文能够回退到微软雅黑，但缺少 `system-ui`、`Segoe UI Variable`、emoji / symbol 的统一回退。
- macOS 判断存在 `navigator.userAgent.includes("Mac")` 与 preload 平台字段两套方式，平台样式应使用 Electron 明确暴露的平台值。

### 打包后平台差异

- macOS：可用 `hiddenInset`、Dock 菜单、关闭时隐藏、托盘菜单以及 AppleScript 降级；系统级权限模型是辅助功能/屏幕录制等 macOS 权限。
- Windows：可用原生窗口按钮、MSI 安装、Windows 凭据保护及 Win32 自动化；没有 macOS Dock、AppleScript、Finder 和 macOS 权限入口。
- 托盘目前只在 macOS 初始化，因此 Windows 打包后没有托盘入口。
- `Alt+Space` 被注册为全局快捷键，两端均尝试启用；Windows 上它会覆盖系统窗口菜单的常用快捷键，属于需要单独确认的产品行为，本次不擅自调整。
- Linux 虽有 builder 配置，但项目主要桌面权限和自动化只声明支持 macOS / Windows，不能视为完整可用平台。

## 方案

根据确认意见，本次实施收敛为最小必要范围：执行下述第 1 项、全局字体回退和 `select` 字体继承。平台 class、额外布局补丁和能力扩展均不实施，避免为未复现的问题增加适配逻辑。

### 1. 移除默认菜单但保留 Windows 原生窗口框架

- 应用启动时调用 `Menu.setApplicationMenu(null)`，从根源移除默认 `File / Edit` 菜单。
- Windows 主窗口同时设置 `autoHideMenuBar: true` 并执行 `setMenuBarVisibility(false)`，避免窗口级菜单重新出现。
- 不设置 `frame: false`。完全无框会移除 Windows 原生最小化、最大化、关闭、拖边缩放、`Win+方向键` 贴靠相关命中区和系统辅助功能，需要新增一套窗口控制 IPC；仅为隐藏菜单不值得引入这些风险。
- macOS 继续使用 `hiddenInset`，应用菜单同样不展示默认 Electron 模板；保留现有 Dock 菜单。

### 2. 平台样式标识与拖拽区（本次不实施）

- 通过 preload 已暴露的 `window.electronAPI.platform` 判断平台，在应用根节点增加稳定的平台 class。
- macOS 保持侧栏顶部额外 32px 红绿灯避让。
- Windows 使用原生标题栏时不增加顶部避让；现有侧栏拖拽区不会替代原生标题栏，但保留不会影响按钮点击，因为交互按钮已有 `no-drag`。
- 浏览器预览模式没有 preload 时使用浏览器平台信息作为非 Electron 降级，仅影响预览样式。

### 3. 字体回退统一

- 正文字体调整为 `system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI Variable", "Segoe UI", "Microsoft YaHei UI", "Microsoft YaHei", "PingFang SC", "Hiragino Sans GB", sans-serif`。
- 等宽字体调整为 `ui-monospace, "SFMono-Regular", "SF Mono", "Cascadia Mono", "Cascadia Code", Consolas, "Liberation Mono", monospace`。
- 符号/emoji 场景补充 `"Segoe UI Emoji"`, `"Segoe UI Symbol"`, `"Apple Color Emoji"`, `"Apple Symbols"` 回退。
- 不捆绑字体，避免安装包体积和字体授权问题；使用系统字体可正确跟随 Windows ClearType 与显示缩放。

### 4. Windows 布局稳健性（本次仅核对，不增加补丁）

- 保持 `960 × 640` 最小窗口边界。
- 检查固定宽度弹窗、侧栏、技能面板和交付物面板在 960px 宽度下是否存在横向溢出；只修复可复现的容器约束，不重做布局。
- 对表单控件补齐继承字体范围（包括 `select`），减少 Windows 原生控件与应用文字的视觉偏差。
- 保持浏览器缩放和 Windows 125% / 150% DPI 下的 CSS 像素布局，不使用平台硬编码像素补偿。

### 5. 平台能力说明

更新 Windows 构建专项文档，加入当前 Electron 架构下的平台能力矩阵：窗口/菜单、托盘、Dock、系统脚本、权限、凭据存储、文件管理器、自动化和构建产物。界面中已经按平台隐藏或降级的能力保持现状；发现错误暴露时再进行最小修复。

## 影响范围

- `main.mjs`：应用菜单和 Windows 窗口选项。
- `frontend/src/App.tsx`：可靠的平台 class。
- `frontend/src/store/appStore.ts`：全局正文和等宽字体变量、表单字体继承。
- 少量存在明确 Windows 溢出或符号字体问题的组件样式。
- `docs/10-Windows-MSI构建与启动处理记忆.md`：Electron 当前实现和跨平台能力说明。

## 风险

- 完全移除应用菜单会同时移除菜单内默认快捷项，但常用编辑快捷键在 Chromium 输入控件中仍可用；需要静态检查是否依赖自定义菜单角色。
- Windows 不采用完全无框，视觉上仍保留系统标题栏；这是为了保留原生窗口能力。如果产品要求真正全自绘标题栏，需要另立设计并增加窗口控制 IPC、安全边界与多 DPI 验证。
- 系统字体在不同 Windows 版本上的字宽略有不同，需要以 Flex 收缩和溢出规则承接，而不是追求像素完全一致。

## 验证方式

按照仓库约束，本次默认只执行：

- `npx tsc --project tsconfig.electron.json --noEmit`
- `cd frontend && npx tsc --noEmit -p tsconfig.app.json`
- `git diff --check`

不自动运行测试或打包。若用户授权，再执行前端构建、macOS 目录包和 Windows x64 MSI 构建；Windows 最终外观与 DPI 仍需在 Windows 10/11 的 100%、125%、150% 缩放下人工验收。
