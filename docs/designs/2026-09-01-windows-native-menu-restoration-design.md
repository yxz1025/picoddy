# Windows 原生菜单栏恢复设计

> 状态：已由 [Windows 标题栏 Logo 与菜单同行设计](./2026-09-01-windows-titlebar-inline-menu-design.md) 取代。原生应用菜单会固定占据第二行，后续实现改用 Window Controls Overlay 与原生弹出子菜单。

## 背景

Windows 版合并后的主窗口只保留了应用图标和 `PiCoddy-a` 标题，标题栏下方原有的“编辑 / 窗口 / 帮助”菜单文字不再显示。截图对比表明，期望继续使用 Windows 原生菜单栏，而不是把这组文字画进 React 页面。

## 目标

- 在 Windows 主窗口恢复“编辑(E) / 窗口(W) / 帮助(H)”原生菜单。
- 保留 `PiCoddy-a` 原生窗口标题、最小化、最大化、关闭、拖边缩放和系统贴靠能力。
- 让常用编辑命令继续使用 Electron 标准角色和系统快捷键。

## 非目标

- 不实现自绘标题栏或自定义窗口控制按钮。
- 不修改聊天区域中的会话标题、侧边栏标题或欢迎页布局。
- 不改变 macOS 的 `hiddenInset` 标题栏和菜单行为。
- 不增加新的帮助页面、外部链接或 IPC 通道。

## 现状

- `main.mjs` 已给 `BrowserWindow` 设置 `title: "PiCoddy-a"`，因此应用标题本身仍然存在。
- Windows 窗口设置了 `autoHideMenuBar: true`，创建后又调用 `setMenuBarVisibility(false)`。
- 启动阶段还调用了 `Menu.setApplicationMenu(null)`，从应用级彻底移除了菜单。
- 三处逻辑共同导致菜单文字不存在；这不是前端 CSS、文字颜色或合并后字体缺失问题。

## 方案

### 1. 恢复 Windows 专用原生菜单

在 Electron 主进程中使用 `Menu.buildFromTemplate()` 创建 Windows 专用菜单，并在创建主窗口前通过 `Menu.setApplicationMenu()` 安装。顶级菜单固定为：

- `编辑(&E)`：撤销、重做、剪切、复制、粘贴、全选；具体行为使用 Electron 标准 `role`。
- `窗口(&W)`：最小化和关闭窗口；使用标准窗口角色。
- `帮助(&H)`：提供“关于 PiCoddy-a”；使用 Electron 标准关于角色。

`&E / &W / &H` 交给 Windows 原生菜单渲染访问键，不在 React 中模拟。

### 2. 取消 Windows 菜单隐藏

- 删除 Windows 的 `autoHideMenuBar: true`。
- 删除窗口创建后的 `setMenuBarVisibility(false)`。
- 用上述菜单替换 `Menu.setApplicationMenu(null)`。

窗口继续使用原生 `frame`，不会影响系统窗口按钮和缩放行为。

### 3. 保持平台边界

菜单模板只在 `process.platform === "win32"` 时安装。macOS 沿用当前窗口配置；托盘菜单继续使用现有独立模板，不与应用菜单混用。

## 影响范围

- `main.mjs`：新增 Windows 菜单模板并取消菜单隐藏。
- `docs/10-Windows-MSI构建与启动处理记忆.md`：更新当前有效的 Windows 菜单行为。
- 不修改前端组件、状态或样式。

## 风险

- 恢复原生菜单会占用一行系统菜单高度，这是截图中的预期布局。
- `Alt` 键会重新激活 Windows 菜单访问键，属于恢复原生菜单后的正常系统行为。
- 菜单标签显式使用中文，因此不会跟随英文系统自动切换；当前产品界面以中文为主，与现有需求一致。

## 验证方式

按照仓库约束默认执行：

- `npx tsc --project tsconfig.electron.json --noEmit`
- `git diff --check`

不自动运行测试、构建或打包。代码检查通过后，需要重启 Electron 主进程；如需确认安装包效果，再由用户授权执行 Windows 构建并人工核对“编辑 / 窗口 / 帮助”菜单及其快捷命令。
