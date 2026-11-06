# Windows 标题栏 Logo 与菜单同行设计

## 背景

Windows 原生 `BrowserWindow` 标题栏与 Electron 应用菜单是两个独立的系统区域。恢复应用菜单后，`PiCoddy-a` Logo/标题位于第一行，“编辑 / 窗口 / 帮助”固定显示在第二行，形成额外高度；用户期望参考 WorkBuddy，让品牌与菜单处于同一行。

Electron 官方说明：`titleBarStyle: "hidden"` 配合 `titleBarOverlay` 可以隐藏默认标题栏内容，同时保留 Windows 右侧原生窗口控制按钮，并允许渲染进程在安全区域内绘制标题栏。因此该效果不能通过调整现有原生菜单 CSS 完成，需要改为窗口控件覆盖模式和应用内顶级菜单。

参考：[Electron Custom Title Bar](https://www.electronjs.org/docs/latest/tutorial/custom-title-bar)、[Electron Menu](https://www.electronjs.org/docs/latest/api/menu/)。

## 目标

- Windows 顶部只保留一行，高度约 30px。
- 左侧依次显示 PiCoddy-a Logo、名称、“编辑(E) / 窗口(W) / 帮助(H)”。
- 右侧继续使用 Electron 提供的 Windows 原生最小化、最大化、关闭按钮。
- 菜单下拉项继续使用 Electron 原生 `Menu` 与标准角色，保留复制、粘贴等系统行为。
- 标题栏支持拖动、双击最大化以及浅色/深色主题。

## 非目标

- 不自绘右侧最小化、最大化和关闭按钮。
- 不把菜单行为降级为纯 HTML 命令或 `document.execCommand()`。
- 不改变聊天会话标题、侧边栏头部和业务导航布局。
- 不改变 macOS 的 `hiddenInset` 窗口。

## 现状

- `main.mjs` 使用 Windows 默认 `titleBarStyle`，原生标题栏显示图标和 `PiCoddy-a`。
- `Menu.setApplicationMenu()` 安装的菜单由 Windows 固定放在标题栏下方，无法通过前端样式横向移动。
- `preload.cjs` 已安全暴露平台标识和受限 IPC，可以沿用同一安全边界增加菜单弹出与标题栏主题能力。
- 前端根布局目前直接占满窗口，没有独立的 Windows 顶部框架层。

## 方案

### 1. 启用 Windows Window Controls Overlay

Windows 的 `BrowserWindow` 使用：

- `titleBarStyle: "hidden"`；
- `titleBarOverlay`，高度固定为 30px；
- 浅色与深色分别设置覆盖层背景色和按钮符号色。

同时重新调用 `Menu.setApplicationMenu(null)`，避免原生应用菜单继续生成第二行。窗口仍然有系统边框和右侧原生控制按钮，不使用 `frame: false`。

### 2. 增加应用内 Windows 标题栏

新增独立 `WindowsTitleBar` 组件：

- 仅在 Electron Windows 主界面和登录界面渲染；浮窗保持现状。
- 使用现有 `PiLogo`，依次渲染 `PiCoddy-a` 与三个菜单按钮。
- 标题栏背景、边框和文字使用现有主题变量。
- 整个空白区域设置 `-webkit-app-region: drag`，品牌和菜单按钮设置 `no-drag`。
- 使用 Window Controls Overlay 的安全区域变量限制内容宽度，避免进入右侧系统按钮区域。

应用主体放入标题栏下方的可伸缩容器，原有侧栏和聊天区域继续占满剩余高度。

### 3. 原生菜单弹出 IPC

顶级菜单按钮点击后，通过 preload 白名单调用 `window.menu.popup`，参数仅包含：

- 固定联合类型菜单 ID：`edit | window | help`；
- 菜单按钮底边的整数坐标。

主进程校验菜单 ID 与坐标范围，再通过 `Menu.buildFromTemplate()` 和 `menu.popup()` 显示原生子菜单：

- 编辑：撤销、重做、剪切、复制、粘贴、全选。
- 窗口：最小化、关闭。
- 帮助：关于 PiCoddy-a。

菜单关闭时 IPC Promise 完成，前端移除按钮激活态。任意字符串不能被解释为 Electron role 或主进程命令。

### 4. 主题同步

标题栏组件监听现有 Zustand `theme`：

- 首次渲染及主题切换时，通过受限 IPC 调用 `BrowserWindow.setTitleBarOverlay()`。
- 主进程只接受 `light | dark`，并映射到固定颜色，不接收任意 CSS 色值。
- DOM 标题栏与右侧原生按钮区域使用一致的浅色/深色背景和符号色。

### 5. 启动页

打包启动页在 Windows 标题栏覆盖模式下保留 30px 顶部安全区，避免加载动画进入窗口控制区域。启动页不复制完整菜单；正式前端加载后再显示品牌和菜单。

### 6. 原应用根布局保持（回归补充）

Windows 标题栏引入的纵向框架只能负责分配顶部 30px 和剩余内容高度，不能改变原应用根节点的横向尺寸计算。标题栏下方的内容容器为 Flex 时，必须让其直接子节点保持 `width: 100%`、`flex: 1` 和 `min-width: 0`，否则原应用根节点会按欢迎区内容宽度收缩，导致欢迎标题、分类标签和 Composer 整体偏到窗口左侧。

本项只补齐外层尺寸约束，使侧栏与主内容重新占满标题栏以下的完整宽度；不修改 `isWelcome` 判定、欢迎区居中规则、Composer 宽度或侧栏逻辑。

## 影响范围

- `main.mjs`：窗口标题栏覆盖配置，并移除占据第二行的应用菜单。
- `src/electron/ipc-handlers.ts`：受限菜单弹出和标题栏主题 IPC。
- `src/electron/preload.cjs`：只暴露菜单 ID/坐标与主题同步方法。
- `frontend/src/components/WindowsTitleBar.tsx`、对应 CSS：Windows 同行标题栏。
- `frontend/src/App.tsx`：为主界面和认证界面增加 Windows 框架层。
- `resources/startup/loading.html`：Windows 标题栏安全区。
- `docs/10-Windows-MSI构建与启动处理记忆.md`：更新当前窗口实现。

## 风险

- 自定义可拖动区域若覆盖按钮会导致菜单无法点击，因此交互控件必须明确设置 `no-drag`。
- Window Controls Overlay 的系统按钮区域不可被 DOM 占用，需要使用官方安全区变量并保留右侧空间。
- 标题栏框架若未让原应用根节点横向拉伸，会使欢迎区按内容宽度收缩；外层必须显式维持 `width: 100%` 和 `flex: 1`。
- 原生菜单弹出坐标来自渲染进程，必须限制为窗口范围内的有限整数。
- 主进程代码变更后仅刷新前端无效，必须重启 Electron；安装版需要重新构建。

## 验证方式

按仓库约束默认执行：

- `node --check main.mjs`
- `npx tsc --project tsconfig.electron.json --noEmit`
- `cd frontend && npx tsc --noEmit -p tsconfig.app.json`
- `git diff --check`

不自动运行测试、构建或打包。静态检查完成后人工验证 Windows 浅色/深色主题、菜单弹出、文本编辑命令、拖动、双击最大化以及右侧系统按钮；如需构建安装包，由用户另行授权。
