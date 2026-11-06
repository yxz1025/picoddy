# 打包客户端启动加载动效设计

## 背景

打包客户端启动时，Electron 主进程需要依次完成 TypeScript runtime、数据库、业务模块、本地 HTTP 服务、浏览器视图和 IPC handler 初始化。当前 `main.mjs` 在这些工作全部完成后才创建 `BrowserWindow` 并加载 React 页面。

在前端静态服务尚未就绪或页面资源尚未完成加载的间隔内，用户只能看到系统创建的空白窗口背景，视觉上表现为黑屏，也无法判断应用仍在启动还是已经失败。

用户提供了一套三轨道 Orb SVG 动效，要求将其作为客户端启动加载反馈。

## 目标

- 打包客户端创建主窗口后立即展示用户提供的 Orb 加载动效。
- 加载页完全本地化，不依赖 React、Vite、本地 HTTP 服务、网络或第三方字体。
- 后端、IPC 和静态服务就绪后，在同一个窗口内平滑切换到正式前端。
- 避免窗口初次显示时的纯黑闪烁、双窗口切换和焦点跳动。
- 保留用户 SVG 的轨道、速度、方向、颜色和 reduced-motion 行为。
- 启动失败时不让动画无限旋转，改为可识别的错误状态并保留终端错误日志。

## 非目标

- 不将启动页改造成 React 组件，也不启动第二套前端开发服务器。
- 不引入新的动画库、图片、字体或 npm 依赖。
- 不改变登录页、欢迎页和主界面的业务交互。
- 不覆盖发生在 Electron `app.whenReady()` 之前的进程级启动失败；该阶段尚不能安全创建窗口。
- 不在本轮执行自动测试套件或打包命令。

## 现状

当前生产启动顺序为：

```text
app ready
  → initDb
  → import application.electron.ts
  → startStaticServer
  → createWindow
  → loadURL(http://127.0.0.1:<port>)
  → create BrowserViewManager
  → register IPC handlers
  → register tray / shortcut
```

存在三个问题：

1. 主窗口创建过晚，前面的初始化阶段没有任何视觉反馈；
2. `loadURL()` 没有被等待，主流程无法精确表达“正式页面已加载”；
3. 正式页面导航发生在 IPC handler 注册之前，快速加载时存在前端先调用 IPC 的竞态。

## 方案比较

### 方案 A：同一主窗口先加载内置启动页（采用）

立即创建隐藏的主窗口，加载 ASAR 内的独立启动 HTML，在首帧可绘制后显示窗口。后端和 IPC 初始化完成后，同一窗口导航到正式页面。

优点：单窗口、无焦点切换、无需额外进程或服务、启动页可以在 HTTP 服务之前工作。缺点：需要调整主进程初始化顺序。

### 方案 B：额外创建 SplashWindow

单独创建无边框小窗口展示动画，主窗口完成后关闭 SplashWindow。

优点：与主窗口生命周期隔离。缺点：双窗口容易闪烁、Dock/任务栏和焦点行为更复杂，窗口大小切换也与当前产品形态不一致。

### 方案 C：把动画放进 React 的 `index.html`

在 React mount 前直接显示 SVG，React 初始化后移除。

优点：前端侧改动简单。缺点：仍必须等本地 HTTP 服务和 `index.html` 可访问，无法覆盖当前主要黑屏阶段。

因此采用方案 A。

## 视觉设计

### 风格

采用克制的“轨道核心”视觉：深色背景 `#121214` 与客户端现有 BrowserWindow 背景一致，Orb 使用用户提供的 `#f5f5f7`。页面不增加 Logo、进度条、营销文案或外部装饰，唯一视觉焦点是 96×96 的三轨道动效。

### 布局

- 页面占满整个窗口；
- Orb 在可用内容区域水平、垂直居中；
- body 使用安全区和窗口拖拽区域兼容设置，不显示滚动条；
- 动画首帧使用轻微透明度进入，避免从系统背景突然跳变；
- 不增加固定最短展示时长，初始化足够快时直接进入主界面。

### 动效

完整保留用户提供的：

- 三个不同倾角与扁率的椭圆轨道；
- `2.6s / 3.4s / 4.2s` 三档周期；
- 正反向旋转；
- 珠子反向旋转和反缩放以保持圆形；
- `prefers-reduced-motion: reduce` 静止姿态。

启动页不使用 JavaScript 驱动动画，所有正常加载动效均由 CSS 完成。

## 资源组织

新增独立资源：

```text
resources/startup/loading.html
```

该文件包含完整 HTML、CSS 和用户 SVG，不依赖其他文件。`electron-builder.yml` 已包含 `resources/**/*`，因此无需新增打包复制规则，文件会进入 `app.asar`。

使用独立资源而不是把 HTML 拼接进 `main.mjs`，可以保持主进程职责清晰，也便于后续只调整视觉而不触碰启动编排。

启动页配置严格 CSP：默认禁止外部资源，仅允许自身内联样式和用于错误状态切换的最小内联脚本。页面不加载网络、不访问 Node API，也不持有业务数据。

## 启动编排

新的生产启动顺序：

```text
app ready
  → create hidden main window
  → load resources/startup/loading.html
  → first page ready, show main window
  → initDb
  → import application.electron.ts
  → startStaticServer
  → create BrowserViewManager
  → register IPC handlers
  → register tray / shortcut
  → await loadURL(http://127.0.0.1:<port>)
  → React page replaces loading page
  → log PiCoddy-a ready
```

开发模式继续直接加载 Vite 页面，不额外展示打包启动页，避免掩盖 Vite 未启动或端口错误。生产模式才执行内置启动页阶段。

`BrowserWindow` 初始设为 `show: false`，监听第一次 `ready-to-show` 后显示。这样系统不会先显示一个尚未绘制的黑色窗口。正式页面导航仍使用同一个 `webContents`，加载页会自然保留到新页面开始提交绘制，不创建或销毁第二个窗口。

IPC handler 必须在正式页面导航前注册，消除前端首屏请求与 handler 注册之间的竞态。

## 错误处理

将 `app.whenReady()` 后的启动过程收敛为一个可捕获的异步 bootstrap：

- 任一步骤失败都输出包含堆栈的 `[startup]` 错误日志；
- 如果启动页已经可用，通过页面内的受限函数切换到错误状态；
- 错误状态停止轨道动画，展示简短的“启动失败，请从终端查看错误日志”；
- 错误详情不直接写入页面，避免泄露本地路径、凭证或内部实现；
- 不自动退出应用，用户仍可以关闭窗口或读取终端日志；
- 若错误发生在窗口创建前，维持现有进程日志行为，这是本设计明确的边界。

正式前端 `loadURL()` 失败也进入相同错误处理，不再留下永久黑屏或无限加载动画。

## 窗口生命周期

- macOS 关闭主窗口时继续沿用隐藏而非退出的现有行为；
- Dock 激活已有窗口时直接显示当前页面；
- 若窗口确实被销毁并重新创建，而本地服务已经就绪，则直接加载正式页面，不重复完整后端初始化；
- 单实例锁、托盘和快捷键逻辑保持不变。

## 影响范围

- `resources/startup/loading.html`
  - 新增零依赖启动页和用户提供的 SVG 动效。
- `main.mjs`
  - 提前创建并安全显示主窗口；
  - 调整后端、IPC、页面导航顺序；
  - 等待启动页和正式页面加载；
  - 统一捕获并显示启动错误。
- `docs/designs/2026-08-28-packaged-client-startup-loading-design.md`
  - 记录本设计。
- `docs/README.md`
  - 增加设计索引。

不修改 React 组件、preload API、数据库协议、连接器逻辑或构建依赖。

## 风险与控制

### 启动页本身加载失败

风险：路径错误或资源未进入 ASAR，窗口仍然不可见。

控制：启动页路径统一从 `APP_ROOT` 解析；`loadFile()` 必须被等待并捕获；资源继续由现有 `resources/**/*` 打包规则包含。

### IPC 首屏竞态

风险：正式页面过早调用尚未注册的 handler。

控制：先完成 BrowserViewManager 和 IPC 注册，再调用正式页面 `loadURL()`。

### 错误信息泄露

风险：把异常堆栈或用户路径渲染到窗口中。

控制：详细错误只写主进程日志，页面仅显示固定错误文案。

### reduced-motion 与动画失真

风险：系统减少动态效果设置无效，或椭圆缩放使珠子变形。

控制：完整保留用户 SVG 的 counter-rotate、inverse scale 和 reduced-motion CSS。

### 开发模式体验变化

风险：加载页掩盖 Vite 连接错误。

控制：启动页只用于 `app.isPackaged` 对应的生产路径；开发模式维持直接连接 `http://localhost:5173`。

## 验证方式

按当前项目约束，实施后只自动执行：

- `node --check main.mjs`
- `npx tsc --project tsconfig.electron.json --noEmit`
- 对启动 HTML 的静态结构与关键 SVG/CSP 标记检查
- `git diff --check`

不自动运行测试套件，不自动打包或启动客户端。

需要用户另行执行的动态验收：

1. `npm run build:mac` 生成新客户端；
2. 启动客户端后立即看到居中的 Orb 动效，而不是黑屏；
3. 后端和前端就绪后，同一窗口进入正式界面；
4. 窗口没有二次创建、尺寸跳变或焦点闪烁；
5. 开启 macOS“减少动态效果”后，Orb 使用静止姿态；
6. 人为制造正式页面加载失败时，页面进入固定错误状态而不是永久黑屏。

## 结论

启动加载反馈必须位于 React 和本地 HTTP 服务之前，因此采用同一 BrowserWindow 的两阶段导航。内置 HTML 负责最早可用的视觉反馈，主进程负责初始化、错误收敛和最终页面切换；用户提供的 Orb SVG 作为唯一视觉元素，既解决黑屏感知，也保持启动链路简单、离线和可维护。
