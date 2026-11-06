# PiCoddyClaw Electron 增量更新设计

> 状态：历史草案。远程升级实施请以 [2026-09-07 详细设计](../../designs/2026-09-07-remote-update-detailed-design.md) 为准；该设计修正了下载后自动重启、MSI 迁移和故障恢复等边界。


## 1. 背景与目标

PiCoddyClaw 已通过 Electron 和 electron-builder 打包为 macOS、Windows 客户端。当前构建流程能生成安装包，但客户端没有版本检查、差分下载、更新提示和自动重启能力。

本设计实现类似 Codex/WorkBuddy 的更新体验：客户端启动后在后台检查新版本，左下角显示更新状态；用户点击更新后下载差分包，下载完成自动退出并重启到新版本。

### 目标

- 支持 macOS 和 Windows 的正式安装包自动更新。
- 通过 blockmap 进行差分下载，避免每次下载完整应用。
- 更新过程由 Electron 主进程控制，渲染进程只能通过 preload/IPC 调用。
- 左下角展示“有新版本”“下载中”“重启更新”等状态。
- 下载完成后调用 `quitAndInstall()` 自动重启。
- 更新失败时保留当前可运行版本，并展示可重试错误。

### 非目标

- 不更新用户数据、SQLite 数据库、工作区文件或远程部署项目。
- 不在更新器中安装 Node、Java、Docker 等运行时。
- 不支持开发模式热更新。
- 不实现后台静默强制升级；最终重启由用户触发更新操作。

## 2. 当前代码基线

- `package.json` 当前只有 `electron-builder`，没有 `electron-updater`。
- `electron-builder.yml` 已配置 macOS 的 `dmg` 和 `zip` 产物，Windows 当前只有 `msi`。
- `asar: true` 已开启，适合生成可做 blockmap 的发布产物。
- `main.mjs` 是主进程入口，并集中完成窗口、静态服务器和 IPC 初始化。
- `src/electron/preload.cjs` 通过 `contextBridge` 暴露 `electronAPI`。
- `src/electron/ipc-handlers.ts` 集中注册 IPC handler 和 ClientEvent 白名单。
- `frontend/src/hooks/useIPC.ts` 已消费主进程事件，可扩展更新事件。
- IPC 协议文档已经预留 `update.check`、`update.install` 及对应 ServerEvent，但实现尚未接入。
- `package.json` 版本为 `1.0.0`，Sidebar 和设置页存在硬编码版本显示，最终应统一读取 Electron 应用版本。

## 3. 方案选择

### 方案 A：electron-updater + electron-builder（采用）

主进程使用 `electron-updater`，发布流程由 `electron-builder` 生成安装包、更新清单和 blockmap。更新器负责签名校验、差分下载、安装和重启。

优点：成熟、跨平台、与现有 Electron 构建链路一致；可以复用现有 IPC 事件协议。缺点：必须配置 HTTPS 更新源、代码签名和正式发布产物。

### 方案 B：自研下载器和安装器

客户端自行请求版本接口、下载压缩包并替换应用目录。

不采用。需要自行处理平台锁文件、签名校验、权限、回滚和重启，风险高且无法直接复用 electron-builder 的差分机制。

### 方案 C：只提示用户下载完整安装包

客户端只检查版本，打开浏览器下载新安装包。

不采用。无法满足差分下载和下载完成自动重启的体验。

## 4. 总体架构

```text
                HTTPS 更新源
       latest-mac.yml / latest.yml
        zip/msi-or-nsis + blockmap
                       ▲
                       │ check/download
┌──────────────────────┴──────────────────────┐
│ Electron 主进程                              │
│ UpdateManager                                │
│ - 检查版本                                   │
│ - 下载差分包                                 │
│ - 处理签名和错误                             │
│ - quitAndInstall()                           │
└──────────────────────┬──────────────────────┘
                       │ IPC
┌──────────────────────┴──────────────────────┐
│ preload.cjs / ipc-handlers.ts                │
│ update.check / update.install                │
└──────────────────────┬──────────────────────┘
                       │ ServerEvent
┌──────────────────────┴──────────────────────┐
│ React + Zustand                              │
│ useIPC → updateStore → Sidebar               │
│ available / progress / downloaded / error    │
└──────────────────────────────────────────────┘
```

更新器只存在于主进程。渲染进程不访问 Node.js、文件系统或更新 URL。

## 5. 更新源与产物

### 5.1 更新源

使用公司 HTTPS 静态文件服务，例如：

```text
https://download.example.com/picoddy/stable/
```

更新源只提供由发布流水线生成的文件，不提供任意文件上传能力。正式版和测试版使用不同目录或 channel。

### 5.2 macOS 产物

保留 `dmg` 和 `zip`。自动更新使用 `zip`，人工首次安装使用 `dmg`。发布目录包含：

```text
latest-mac.yml
PiCoddyClaw-x.y.z-mac.zip
PiCoddyClaw-x.y.z-mac.zip.blockmap
```

### 5.3 Windows 产物

将自动更新目标从单独的 `msi` 调整为 NSIS 安装包。MSI 可以作为人工安装产物保留，但不作为自动更新主路径。发布目录包含：

```text
latest.yml
PiCoddyClaw Setup x.y.z.exe
PiCoddyClaw Setup x.y.z.exe.blockmap
```

### 5.4 electron-builder 配置方向

```yaml
publish:
  provider: generic
  url: https://download.example.com/picoddy/stable/

mac:
  target:
    - dmg
    - zip

win:
  target:
    - nsis
```

实际的域名、证书、签名凭据通过 CI secret 注入，不写入仓库。

## 6. 主进程 UpdateManager

新增 `src/electron/update-manager.ts`，只负责更新生命周期，不承担 UI 逻辑。

### 6.1 状态

```ts
type UpdateState =
  | "idle"
  | "checking"
  | "available"
  | "downloading"
  | "downloaded"
  | "not-available"
  | "error";
```

状态对象至少包含：

```ts
interface UpdateSnapshot {
  state: UpdateState;
  currentVersion: string;
  version?: string;
  percent?: number;
  bytesPerSecond?: number;
  transferred?: number;
  total?: number;
  message?: string;
}
```

### 6.2 行为

- `app.isPackaged === false` 时不检查、不下载。
- 应用启动完成后检查一次。
- 检查周期为 6 小时，应用退出时清理定时器。
- 同一时间只允许一个检查或下载任务。
- `autoDownload` 设为 `false`，发现新版本后等待用户点击。
- 用户点击更新后调用 `downloadUpdate()`。
- 下载完成后发送 `update.downloaded`，随后调用 `quitAndInstall()`。
- 网络错误、清单错误、签名错误统一转换为用户可读的 `update.error`。
- 不接受低于当前版本的更新。

### 6.3 重启安全

安装前检查是否存在正在执行的 Agent 任务。若有任务，UI 显示“任务完成后更新”或要求用户确认；确认后才允许退出。主进程的 `before-quit` 将更新退出标记设置为正常退出，避免 macOS 的窗口隐藏逻辑拦截安装重启。

## 7. IPC 契约

### 7.1 ClientEvent

```ts
{ type: "update.check", payload: {} }
{ type: "update.install", payload: {} }
```

`update.install` 表示“开始下载并在下载完成后自动重启”，不是立即强制杀进程。

### 7.2 ServerEvent

```ts
{ type: "update.available", payload: { version: string } }
{ type: "update.progress", payload: {
  percent: number;
  bytesPerSecond: number;
  transferred: number;
  total: number;
} }
{ type: "update.downloaded", payload: { version: string } }
{ type: "update.not-available", payload: {} }
{ type: "update.error", payload: { message: string } }
```

需要同步修改：

- `src/electron/ipc-handlers.ts`：加入白名单和事件分发。
- `src/electron/preload.cjs`：暴露 `electronAPI.update.check/install`。
- `frontend/src/hooks/useIPC.ts`：接收并更新 Zustand 状态。

## 8. 前端交互设计

新增 `frontend/src/store/updateStore.ts`，保存更新快照和操作方法。Sidebar 底部增加更新状态行，位于用户信息上方或作为用户信息区域的附加行。

### 状态展示

| 状态 | 展示 | 操作 |
|---|---|---|
| `checking` | 正在检查更新 | 禁用按钮 |
| `available` | 发现新版本 vX.Y.Z | 点击开始下载 |
| `downloading` | 下载中 XX% | 展示进度，不重复触发 |
| `downloaded` | 更新完成，正在重启 | 等待自动退出 |
| `not-available` | 不展示更新入口 | 保持界面简洁 |
| `error` | 更新失败 | 点击重试，保留旧版本 |

### 交互规则

- 启动检查和定时检查不弹模态框，只显示左下角提示。
- 用户主动点击“检查更新”时，可显示检查结果。
- 下载完成后立即自动重启，不再要求第二次确认。
- 应用重启后显示当前实际版本，版本号来自 `app.getVersion()`。
- 侧边栏收起时保留一个带红点的更新图标，展开后显示文字。

## 9. 发布流水线

发布版本必须先更新根 `package.json` 的 `version`，该字段是唯一版本来源。CI 执行：

```text
校验版本号和 git tag
  → 构建 frontend
  → macOS 签名、notarize、生成 dmg/zip
  → Windows 签名、生成 NSIS
  → 生成 latest*.yml 和 blockmap
  → 上传到 stable/beta 对应目录
  → 校验清单可访问
```

开发用的 `electron-builder --dir` 只生成目录，不发布更新清单，不应被标记为可更新版本。发布脚本需要显式使用正式目标和 `--publish`。

## 10. 安全与可靠性

- macOS 启用 Developer ID 签名和 notarization。
- Windows 安装包使用组织代码签名证书。
- 更新源全程 HTTPS。
- 使用 electron-updater 的签名校验，不执行未签名或篡改的包。
- CI 不把签名私钥、更新源凭据写入仓库或安装包。
- 服务端至少保留当前稳定版本和上一个稳定版本。
- 更新失败不删除现有应用，不修改用户数据。
- 记录检查、下载、安装失败原因，避免记录 API key、用户消息等敏感数据。
- 通过 staged rollout 控制大版本发布范围，出现问题时停止清单发布即可阻止继续升级。

## 11. 测试设计

### 单元测试

- 开发模式不会调用更新源。
- 新版本高于当前版本时进入 `available`。
- 版本相同或更低时进入 `not-available`。
- 下载进度正确映射到 `percent`、`transferred`、`total`。
- 更新器重复调用不会产生并行下载。
- 更新错误转换为 `update.error`。

### IPC 测试

- `update.check` 在白名单中并调用 UpdateManager。
- `update.install` 在白名单中并触发下载流程。
- 未授权事件仍返回 403。

### UI 测试

- 收到 `update.available` 后左下角出现版本提示。
- 下载时显示进度且按钮不可重复点击。
- 收到 `update.downloaded` 后进入重启状态。
- `update.error` 显示重试入口。
- 收起 Sidebar 后更新红点仍可见。

### 发布验收

1. 安装旧版本。
2. 发布一个只修改少量前端文件的新版本。
3. 旧版本启动后发现新版本。
4. 点击更新，确认下载大小明显小于完整安装包或符合 blockmap 差分结果。
5. 下载完成后应用自动退出并重新打开。
6. 确认版本号、会话、设置、技能和工作区数据仍然存在。
7. 模拟网络中断，确认旧版本仍可启动并可重试。

## 12. 实施边界与顺序

建议按以下顺序实施：

1. 增加 `electron-updater` 和更新源配置。
2. 实现主进程 `UpdateManager` 及事件转换。
3. 接入 preload、IPC 白名单和 `client-invoke`。
4. 增加 `updateStore`、`useIPC` 映射和 Sidebar 更新入口。
5. 调整 Windows 发布目标，补齐签名和 CI 上传流程。
6. 编写单元、IPC、UI 和真实安装升级验收测试。

完成标准是：用户无需填写配置、无需手动下载新安装包，在客户端左下角点击更新后即可完成差分下载、自动重启并运行新版本。
