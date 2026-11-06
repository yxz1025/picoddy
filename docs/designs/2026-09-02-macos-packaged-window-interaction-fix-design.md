# macOS 打包客户端窗口交互修复设计

## 背景

macOS 打包客户端启动后，登录页视觉渲染正常，但真实鼠标悬停在“使用企业账号登录”按钮上时不显示手型，点击也没有反应。无障碍控件动作可以触发同一按钮，CAS 登录接口和系统浏览器打开链路均正常。

运行时探针确认，登录按钮在 DOM 中处于启用状态，`pointer-events` 为 `auto`，计算光标为 `pointer`，中心点命中元素也是按钮；内置 `WebContentsView` 未挂载到窗口。真实鼠标事件计数在修复前始终为零。给当前页面的 `html`、`body`、登录根容器和按钮临时设置 `-webkit-app-region: no-drag` 后，`pointerover`、`mousedown`、`mouseup` 和 `click` 事件立即恢复，CAS 页面正常打开。

打包启动流程会先在主窗口加载 `resources/startup/loading.html`。该页面把整个 `body` 标记为 `-webkit-app-region: drag`，随后同一个 WebContents 导航到 React 页面，而 React 根页面没有显式清除原生拖拽区域。这个跨导航的拖拽命中状态导致打包版真实鼠标交互被窗口拖拽层截获。

同一轮诊断还确认两个 macOS 窗口问题：非活动窗口默认不接受第一次鼠标点击，以及窗口 `close` handler 在应用退出期间仍无条件阻止关闭，导致旧进程不能真正退出，新包启动时命中单实例锁并聚焦旧实例。

## 目标

- 打包客户端导航到登录页后，所有普通页面区域明确为非拖拽区域，鼠标悬停和点击正常送达 React。
- 启动页只保留标题栏顶部的可拖拽区域，不再把整个页面标记为拖拽区域。
- macOS 非活动窗口的第一次点击可以直接操作目标控件。
- macOS 点击红色关闭按钮时继续隐藏窗口，显式退出应用时真正结束进程。
- 不改变 Windows 标题栏、CAS 协议、登录回调、内置浏览器或单实例产品语义。

## 非目标

- 不在本轮处理 Developer ID 签名、公证或 TCC 权限身份。
- 不修改 CAS 地址、票据验证或会话持久化。
- 不重构主窗口、启动页和内置浏览器的整体生命周期。
- 不引入独立 Splash Window 或第二个主窗口。
- 不处理系统权限页使用 `shell.openPath` 打开 URL 的既有问题。

## 现状

### 启动页拖拽范围

`resources/startup/loading.html` 当前对整个 `body` 设置：

```css
-webkit-app-region: drag;
```

这使启动页所有内容都成为原生窗口拖拽区域。正式 React 页面没有全局 `no-drag` 基线，只在侧边栏、Windows 标题栏和浮窗的个别交互元素上声明 `no-drag`。

### 非活动窗口首击

主窗口未设置 `acceptFirstMouse`。Electron 在 macOS 上的默认值为 `false`，非活动窗口的第一次点击只激活窗口，不会继续点击 WebContents 中的控件。

### 退出状态

主窗口 `close` 事件在 macOS 上始终调用 `preventDefault()` 并隐藏窗口。托盘“退出 PiCoddy-a”、系统退出接口和 `app.quit()` 会再次触发同一 `close` handler，因此退出请求也被取消。

## 方案

采用单窗口、显式命中区域和退出状态守卫方案。

### 1. 收窄启动页拖拽区域

启动页的 `body` 明确设置为 `no-drag`。增加固定在页面顶部、高度约 38px 的专用拖拽区域，仅用于移动无边框/隐藏标题栏窗口。启动动画、错误文案和页面主体保持非拖拽状态。

拖拽区域不承载按钮、链接或其他交互内容，避免额外维护交互元素白名单。

### 2. 为正式前端建立非拖拽基线

在正式前端的全局样式中为 `html`、`body` 和 `#root` 显式设置 `-webkit-app-region: no-drag`。登录页根容器和登录按钮再声明一次 `no-drag`，形成对打包启动跨导航问题的局部防护和清晰文档化。

现有需要拖拽的侧边栏标题区、Windows 自定义标题栏和浮窗标题区继续使用各自的显式 `drag` 规则；其中按钮和输入框继续使用既有 `no-drag` 规则。全局基线不改变这些更具体的拖拽声明。

### 3. 接受 macOS 第一次鼠标点击

在 `BrowserWindow` 顶层构造参数中仅对 macOS 设置：

```js
acceptFirstMouse: true
```

Windows 和 Linux 不传入该选项，保持现有平台行为。

### 4. 区分隐藏窗口与退出应用

主进程维护 `isQuitting` 布尔状态：

- 默认值为 `false`；
- `before-quit` 发生时先设为 `true`，再释放全局快捷键；
- macOS `close` handler 只在 `isQuitting === false` 时阻止关闭并隐藏窗口；
- 显式退出期间不阻止 `close`，允许窗口销毁和进程结束。

普通点击红色关闭按钮仍然隐藏应用，托盘退出、系统退出和操作系统退出都能真正终止进程。应用下次启动时不再被旧实例的单实例锁重定向。

## 影响范围

- `resources/startup/loading.html`：启动页原生拖拽区域。
- `frontend/src/index.css`：正式页面全局非拖拽基线。
- `frontend/src/components/AuthScreen.css`：登录页面局部非拖拽防护。
- `main.mjs`：macOS 首击和退出状态处理。
- 回归测试：静态验证上述跨 HTML、CSS 和主进程配置约束。
- `docs/designs/2026-08-28-packaged-client-startup-loading-design.md`：同步记录启动页拖拽区域边界。

## 错误处理与兼容性

- `acceptFirstMouse` 只在 Darwin 分支生效，不影响 Windows 自定义标题栏。
- 启动页顶部拖拽区域不依赖 JavaScript，即使后端启动失败仍可移动窗口。
- `before-quit` 在 Electron 正常退出路径中同步设置状态，不增加异步退出竞态。
- 如果启动初始化失败，错误页仍位于同一个启动文档中，除顶部拖拽区域外保持可选择和可交互。

## 风险

- 全局 `no-drag` 可能影响已有拖拽区。通过保留并检查侧边栏、Windows 标题栏和浮窗中更具体的 `drag` 声明控制风险。
- 启动页只有顶部区域可拖拽，相比整个页面可拖拽的命中范围变小；这是避免全窗口吞掉交互的有意取舍。
- 静态单元测试只能验证样式和窗口配置存在，无法完整模拟 macOS 原生拖拽命中缓存；最终仍需打包后用真实鼠标验收。

## 验证方式

### 自动化源码回归

- 启动页 `body` 必须为 `no-drag`，且存在顶部专用 `drag` 区域。
- 正式前端 `html`、`body`、`#root` 必须建立 `no-drag` 基线。
- 登录根容器和按钮必须显式为 `no-drag`。
- 主窗口 macOS 配置必须包含 `acceptFirstMouse: true`。
- `close` handler 必须只在非退出状态下隐藏窗口，`before-quit` 必须先设置退出状态。

### 静态验证

- Electron 主进程 TypeScript 类型检查。
- 前端 TypeScript 类型检查。
- `git diff --check`。
- 前端生产构建。

### 打包验收

1. 完全结束所有旧的 PiCoddy-a 进程。
2. 重新生成 macOS arm64 打包产物并安装到 `/Applications`。
3. 启动后将鼠标移到企业登录按钮，确认显示手型和 hover 效果。
4. 在应用处于非活动状态时直接点击按钮，确认第一次点击即进入“认证中”状态并打开 CAS 页面。
5. 关闭 CAS 页面后重新加载客户端，确认按钮仍可点击。
6. 点击红色关闭按钮，确认窗口隐藏但进程保留。
7. 从托盘执行退出，确认进程结束；重新打开新包，确认不会聚焦旧实例。

