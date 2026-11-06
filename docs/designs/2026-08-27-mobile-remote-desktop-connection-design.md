# 移动端远程 Agent 与电脑桌面连接设计

## 1. 背景

PiCoddy-a 当前是本地 Electron 桌面应用：本地 HTTP 服务只监听 `127.0.0.1`，Renderer 主要通过 IPC 调用主进程。项目已经具备会话、SSE 事件、附件、工件、权限确认，以及 macOS/Windows 的截图、鼠标、键盘和应用切换能力，但没有移动端、设备配对、远程会话、互联网中转或实时桌面流。

现有 WorkBuddy v5.1.7 静态调研显示，其 Claw 采用“渠道消息 → 腾讯云后端 → WebSocket 推送桌面端 → 触发 Agent”的后端中转模式，支持微信、企业微信、飞书、钉钉等渠道，并提供扫码绑定、设备授权、状态变化和断线重连。该机制解决的是远程触发 Agent 和收取结果，不等同于完整的远程桌面协议。

本设计借鉴 WorkBuddy 的设备绑定、桌面端主动出站长连接和云端中转，同时增加 WebRTC 桌面画面与交互控制，使手机既能远程使用 Agent，也能在明确授权后查看和操作电脑桌面。

## 2. 目标

- 提供手机浏览器可安装的移动端 PWA，后续可复用协议开发 iOS/Android 原生客户端。
- 手机可查看桌面设备在线状态、发起新任务、继续会话、接收流式回复、查看工件和处理权限确认。
- 手机可发起低延迟桌面查看，会话内按需升级为鼠标键盘控制。
- 桌面端不开放公网监听端口，只建立主动出站连接。
- 支持局域网外连接、NAT 穿透失败时的 TURN 中继和断线恢复。
- 所有远程访问都绑定用户、设备、会话、权限和审计记录。
- 复用现有 Agent、会话、工件、Computer Use 和权限体系，不建立第二套业务逻辑。

## 3. 非目标

- 不直接把本地 `8000`/`5173` 端口暴露到局域网或公网。
- 不把 VNC/RDP 服务直接嵌入主进程并开放端口。
- 首期不支持无人值守的永久全控制。
- 不在后台持续录屏，不绕过 macOS Screen Recording/Accessibility 或 Windows 系统权限。
- 不把桌面登录密码、系统凭证、模型密钥或本地数据库上传到中转服务。
- 不允许移动端发送任意 Shell、任意 IPC 名称或原始工具调用。
- 首期不实现多用户共同控制同一台电脑。

## 4. 方案选择

### 4.1 采用：云端控制面 + 桌面主动 WSS + WebRTC 媒体面

远程能力拆成两个平面：

- **控制面**：HTTPS/WSS 承载登录、设备绑定、在线状态、Agent 消息、权限确认和 WebRTC 信令。
- **媒体面**：WebRTC 承载桌面视频；可靠 DataChannel 承载经过校验的鼠标键盘事件。优先端到端直连，失败时通过 TURN 转发加密媒体。

该方案保留 WorkBuddy 的“桌面主动连接云端”优势，又避免把高频桌面图像经普通 WebSocket 和应用服务器转发。

### 4.2 采用：PWA 先行，原生客户端后置

首期移动端使用 React + Vite PWA：同一套代码覆盖 iOS Safari、Android Chrome 和桌面浏览器，支持 WebRTC 接收、触控映射、会话和工件。需要稳定后台推送、生物识别、本地文件系统或系统级快捷入口时，再封装 Capacitor 或开发 React Native 客户端。

### 4.3 不采用：手机直接访问电脑 IP

直接访问局域网 IP 只能覆盖同网环境，还会引入端口、防火墙、TLS、动态 IP 和路由器映射问题。公网暴露本地 API 会放大当前本地接口的攻击面，因此不采用。

### 4.4 不采用：全部通过服务端视频转码

服务端接收原始桌面画面会显著增加带宽、成本和隐私风险。TURN 只在 P2P 失败时转发 DTLS-SRTP 加密流，不解码桌面内容。

## 5. 总体架构

```text
┌──────────────────────┐
│ Mobile PWA / App     │
│ 会话 / 工件 / 权限    │
│ WebRTC Viewer        │
└───────┬──────────────┘
        │ HTTPS + WSS（控制、信令、Agent 事件）
        │ WebRTC（视频 + 控制 DataChannel）
┌───────▼──────────────────────────────────────────┐
│ Remote Relay / Control Plane                     │
│ Auth · Device Registry · Pairing · Presence      │
│ Session Router · Signaling · Push · Audit        │
│ STUN/TURN Credentials                            │
└───────┬──────────────────────────────────────────┘
        │ 桌面端主动出站 WSS；无公网监听
┌───────▼──────────────────────────────────────────┐
│ PiCoddy-a Desktop                                   │
│ RemoteGatewayService                             │
│ ├─ DeviceIdentity / Pairing                      │
│ ├─ AgentRemoteBridge                             │
│ ├─ RemoteSessionPolicy                           │
│ ├─ WebRTC Signaling                              │
│ └─ Audit / Reconnect / Resume                    │
│                                                  │
│ Hidden Capture Renderer                          │
│ └─ desktopCapturer/getUserMedia → WebRTC video  │
│                                                  │
│ Main Process                                     │
│ ├─ Session / Provider / Artifact                 │
│ ├─ Permission confirmation                       │
│ └─ Existing Computer Use executor                │
└──────────────────────────────────────────────────┘
```

## 6. 核心组件

### 6.1 Remote Relay

中转服务是可独立部署的网络服务，不进入 Electron 主进程：

- 用户认证与短期访问令牌；
- 设备注册、设备公钥、绑定关系和吊销；
- 一次性配对挑战与二维码状态；
- 桌面连接在线状态、心跳和路由；
- 移动端与桌面端之间的 Agent 消息和 WebRTC SDP/ICE 信令；
- APNs/Web Push/Android Push 通知适配；
- 短期 TURN 凭证签发；
- 安全审计元数据，不保存 Agent 正文和桌面媒体。

Relay 可以先采用单服务部署，接口边界保持独立：`auth`、`devices`、`pairing`、`sessions`、`signaling`、`audit`。在线路由和短期状态可用 Redis，设备绑定和审计元数据使用 PostgreSQL；TURN 使用 coturn 或兼容服务。

### 6.2 Desktop RemoteGatewayService

桌面端主进程维护唯一远程网关：

- 应用启动并登录后建立出站 WSS；
- 指数退避重连，网络恢复后重新注册 presence；
- 使用 `seq`、`ack` 和 `resumeToken` 恢复未完成的控制面事件；
- 验证用户、移动设备、会话 ID、消息类型和权限范围；
- 把远程 Agent 请求映射到现有 session/provider，不直接调用内部工具；
- 把现有 ServerEvent、工件和确认事件转换为远程事件；
- 管理远程桌面会话状态、超时、暂停和终止；
- 屏幕锁定、退出登录或应用退出时立即终止远程控制。

长连接不能放在普通 React Renderer 中，否则页面刷新或 HMR 会断开远程能力。控制面连接由主进程或受监管 UtilityProcess 持有。

### 6.3 Hidden Capture Renderer

WebRTC 和屏幕媒体捕获运行在专用、不可导航的隐藏 Renderer：

- 只加载应用内置页面；
- `contextIsolation: true`、`nodeIntegration: false`；
- 通过受限 preload 接收会话 ID、显示器选择和 WebRTC 信令；
- 使用 Electron `desktopCapturer` 选择屏幕或窗口源；
- 将视频 Track 直接发给移动端，不写入磁盘；
- 只把经过校验的控制事件送回主进程；
- 结束会话后停止所有 MediaStreamTrack 并销毁 PeerConnection。

主窗口关闭、刷新或隐藏不能影响已经批准的远程会话，但托盘必须持续显示远程连接状态。

### 6.4 Mobile PWA

移动端包含：

- 登录与设备配对；
- 电脑列表、在线状态、最后活动时间和吊销入口；
- 会话列表、新建任务、流式消息、附件和工件预览；
- 权限确认卡片；
- 桌面查看器、显示器切换、画质选择和全屏；
- 触控板模式、直接触摸模式、软键盘和快捷键面板；
- 明确的“仅查看/允许控制”状态和结束按钮。

PWA 不保存桌面长期令牌。刷新令牌放在平台安全能力可用的位置；浏览器版本使用短期会话和 HttpOnly/SameSite Cookie，设备私钥使用 WebCrypto 不可导出密钥。

## 7. 设备登录与配对

### 7.1 身份基础

桌面端和移动端使用同一用户身份系统。当前本地 CAS 会话只能证明桌面本地登录，不能直接作为远程设备协议；远程服务需要可验证的云端 access token、refresh token、audience 和设备绑定声明。

桌面设备首次启用远程连接时生成设备密钥对：

- 签名密钥用于设备挑战响应；
- 私钥存储在 macOS Keychain/Windows Credential Manager；
- Relay 只保存公钥、设备名、平台、用户 ID 和吊销状态；
- 不把设备私钥或模型 API Key写入 SQLite。

### 7.2 二维码配对

1. 桌面端点击“添加移动设备”。
2. Relay 创建一次性 `pairingChallenge`，有效期建议 2 分钟。
3. 二维码只包含 Relay 地址、challenge ID 和随机 nonce，不包含 access token。
4. 已登录手机扫码并提交自己的设备公钥。
5. 桌面显示手机名称、平台和账号，用户本地确认。
6. Relay 建立同一用户下的设备绑定，并向双方返回绑定完成事件。
7. challenge 使用一次后立即失效；超时、取消或账号不一致均失败。

用户可在桌面和手机查看已绑定设备并随时吊销。吊销后 Relay 立即断开该设备的所有控制面和媒体会话。

## 8. 远程 Agent 数据流

```text
手机发送任务
  → Relay 校验用户、设备和 desktopId
  → 桌面 RemoteGateway 验证消息签名与权限
  → 创建/继续现有 Conversation
  → 调用现有 Provider prompt 流程
  → ServerEvent 转为带 seq 的远程事件
  → 手机流式展示消息、工具状态、工件和确认卡片
```

远程请求只能使用公开的 Remote Command Schema，例如：

```ts
type RemoteCommand =
  | { type: "conversation.create"; requestId: string; title?: string }
  | { type: "conversation.prompt"; requestId: string; conversationId: string; text: string; attachmentIds?: string[] }
  | { type: "conversation.stop"; requestId: string; conversationId: string }
  | { type: "permission.respond"; requestId: string; confirmationId: string; approved: boolean }
  | { type: "artifact.get"; requestId: string; artifactId: string }
  | { type: "desktop.request"; requestId: string; mode: "view" | "control" };
```

不得把 IPC 名称、Agent Tool 名称或 Shell 命令直接作为远程协议。RemoteGateway 将公开命令映射到现有领域服务，数据库操作仍通过既定 API/领域边界完成。

远程创建的会话记录 `source=mobile`、`sourceDeviceId` 和远程请求 ID。相同 requestId 必须幂等，断线重发不能导致消息或写操作重复执行。

## 9. 远程桌面数据流

### 9.1 建立连接

1. 手机发送 `desktop.request(view)`。
2. 桌面显示本地确认：“设备 X 请求查看屏幕”，并显示倒计时。
3. 用户确认后，Hidden Capture Renderer 创建屏幕视频 Track。
4. 双方通过 Relay 交换 SDP/ICE；优先 P2P，失败时使用 TURN。
5. 手机收到视频后进入仅查看模式。
6. 手机请求升级 `control` 时再次本地确认；批准后才建立控制 DataChannel 权限。

### 9.2 视频

- 首期使用 H.264/VP8 浏览器协商，默认 1280×720、8–15 fps；文字操作时允许提升清晰度而不是盲目提高帧率。
- 支持按网络情况降到 960×540 或 640×360。
- 多显示器先选择一块主屏，后续通过显式操作切换。
- 媒体不经过 Agent prompt、不保存到工件、不写入 Relay。
- 屏幕锁定、系统睡眠、权限撤销或 Secure Desktop 出现时停止 Track。

### 9.3 输入控制

DataChannel 只接受固定结构事件：

```ts
type RemoteInput =
  | { type: "pointer.move"; x: number; y: number; viewportWidth: number; viewportHeight: number }
  | { type: "pointer.button"; button: "left" | "right"; action: "down" | "up"; x: number; y: number }
  | { type: "pointer.scroll"; deltaX: number; deltaY: number }
  | { type: "keyboard.text"; text: string }
  | { type: "keyboard.key"; key: string; modifiers: string[] };
```

桌面端负责：

- 按实际显示器 bounds 和 scaleFactor 归一化坐标；
- 限制坐标、文本长度、事件频率和允许按键；
- 禁止远程合成系统安全序列、支付确认和密码读取；
- 将事件交给现有 Computer Use 平台执行器，而不是运行移动端提供的命令；
- 对剪贴板、文件传输和拖放使用独立权限，首期默认禁用。

## 10. 权限与安全模型

### 10.1 默认策略

- 远程功能默认关闭。
- 新设备必须扫码配对并在桌面本地确认。
- 每次远程桌面会话默认需要本地确认，默认仅查看。
- “允许控制”必须单独确认，15 分钟无输入自动降级或断开。
- 首期不提供永久无人值守全控制。
- Agent 写操作仍遵守 Ask/Plan/Craft 与 L1/L2/L3 权限，不因请求来自已配对手机而放宽。

### 10.2 本地可见性和紧急停止

- 托盘、窗口顶部和系统通知持续显示远程设备与会话模式。
- 屏幕边缘显示不可被远端隐藏的“正在共享/正在控制”指示。
- 本地鼠标键盘优先；检测到本地输入可暂停远程控制。
- 提供全局紧急停止快捷键和托盘“断开远程连接”。
- 退出账号、锁屏、睡眠、切换用户或撤销设备立即断开。

### 10.3 网络安全

- 所有控制面使用 TLS，桌面端只发起出站 WSS。
- 每条消息包含 `protocolVersion`、`messageId`、`seq`、`timestamp`、`deviceId` 和签名/会话 MAC。
- 防重放窗口、速率限制、消息大小限制和严格 Schema 校验。
- WebRTC 使用 DTLS-SRTP；TURN 只转发密文并使用短期凭证。
- Relay 不保存桌面帧、键盘文本、附件正文或 Agent 会话正文；需要离线通知时只保存最小元数据。
- 设备密钥和远程 refresh token 使用系统安全存储，不能沿用当前 SQLite 明文 token 方式。

## 11. 数据模型

```ts
interface RemoteDevice {
  id: string;
  userId: string;
  kind: "desktop" | "mobile";
  name: string;
  platform: string;
  publicKey: string;
  createdAt: string;
  lastSeenAt: string;
  revokedAt?: string;
}

interface DeviceBinding {
  desktopDeviceId: string;
  mobileDeviceId: string;
  scope: "agent" | "desktop-view" | "desktop-control";
  approvedAt: string;
  revokedAt?: string;
}

interface RemoteSession {
  id: string;
  desktopDeviceId: string;
  mobileDeviceId: string;
  mode: "agent" | "desktop-view" | "desktop-control";
  state: "requested" | "awaiting-local-approval" | "connecting" | "active" | "paused" | "ended";
  startedAt: string;
  expiresAt: string;
  endedAt?: string;
  endReason?: string;
}
```

本地 SQLite 保存设备绑定缓存、远程会话审计和远程 Conversation 来源；Relay 保存设备注册、绑定和路由所需元数据。双方数据必须可通过设备吊销和账号注销清理。

## 12. 当前项目可复用能力与缺口

### 可复用

- `src/agent/provider.ts` 和会话领域：Agent 任务与流式事件。
- `src/agent/tools/os.ts`、`os_windows.ts`：截图、鼠标、键盘和应用控制。
- `src/agent/permissions.ts`：工具风险和确认策略。
- 附件、工件、会话停止和权限响应 API。
- Electron 系统权限检测和设置入口。
- `src/electron/preload.cjs` 的安全 IPC 模式。

### 必须新增或整改

- 当前 `node:http` 只监听 loopback，应继续保持；不得改成 `0.0.0.0` 充当远程入口。
- 新增独立 Remote Relay、桌面 WSS 客户端、设备注册和配对协议。
- 新增移动端 PWA 与部署入口。
- 新增 Hidden Capture Renderer、WebRTC 信令和 TURN。
- 新增远程公开命令 Schema、幂等、事件序号和恢复机制。
- 现有本地认证会话把 access token 保存在 SQLite，不满足远程设备凭证要求；远程凭证必须迁移到系统安全存储。
- 当前 SSE 面向本机前端且不可作为跨网断线恢复协议，远程控制面必须使用可续传 WSS 事件。
- Computer Use 当前主要面向 Agent 工具调用，需要抽出可复用、限流、可审计的 Platform Input Executor，供远程控制和 Agent 共用。
- 增加屏幕共享本地指示、远程会话审计、设备管理和全局紧急停止。

## 13. 分阶段交付

### 阶段 A：远程 Agent（WorkBuddy Claw 对标）

- Relay、设备登录、二维码配对和桌面 WSS；
- 移动端会话、流式回复、停止、权限确认和工件查看；
- 不传屏幕，不控制鼠标键盘。

该阶段先验证身份、路由、断线恢复和权限模型，是风险最低的端到端切片。

### 阶段 B：仅查看桌面

- Hidden Capture Renderer；
- WebRTC 信令、STUN/TURN；
- 显示器选择、清晰度调整、本地共享指示和会话终止。

### 阶段 C：交互控制

- 触控到鼠标键盘映射；
- 单独的控制授权、限流、审计和紧急停止；
- 本地输入优先、锁屏终止和敏感操作限制。

### 阶段 D：增强能力

- 原生移动应用、推送通知、生物识别；
- 明确策略下的可信设备快速批准；
- 剪贴板和文件传输；
- 多显示器、弱网自适应和企业自托管 Relay。

无人值守控制需另行设计和安全评审，不随阶段 D 自动开放。

## 14. 可观测性与错误协议

稳定错误码至少包括：

| 错误码 | 含义 |
|---|---|
| `REMOTE_DEVICE_OFFLINE` | 桌面不在线 |
| `REMOTE_DEVICE_REVOKED` | 设备已吊销 |
| `REMOTE_PAIRING_EXPIRED` | 配对挑战过期 |
| `REMOTE_APPROVAL_REQUIRED` | 等待桌面本地确认 |
| `REMOTE_APPROVAL_DENIED` | 桌面拒绝请求 |
| `REMOTE_PERMISSION_DENIED` | 缺少屏幕录制或辅助功能权限 |
| `REMOTE_SIGNALING_FAILED` | WebRTC 信令失败 |
| `REMOTE_TURN_UNAVAILABLE` | P2P 失败且 TURN 不可用 |
| `REMOTE_SESSION_EXPIRED` | 会话超时 |
| `REMOTE_RATE_LIMITED` | 输入或消息频率超限 |
| `REMOTE_PROTOCOL_MISMATCH` | 协议版本不兼容 |

审计记录用户 ID、设备 ID、会话 ID、模式、开始/结束时间、批准人、权限变化和稳定错误码；不记录桌面帧、键盘正文、Agent 正文或令牌。

## 15. 验证方式

遵循当前项目约束，设计阶段只做文档和引用路径检查，不自动运行测试。实施后所需验证包括：

- 桌面没有公网监听端口，断开 Relay 后本地功能不受影响；
- 二维码一次性、短时有效、账号一致且需要桌面确认；
- 设备吊销后现有 WSS/WebRTC 立即断开；
- 远程 Agent 断线恢复不重复提交 prompt 或写操作；
- 默认仅查看，控制升级必须单独批准；
- 锁屏、睡眠、退出登录、权限撤销和紧急停止立即终止媒体与输入；
- P2P 和 TURN 两条 WebRTC 路径可用，Relay 不获得媒体明文；
- macOS Retina 和 Windows 缩放下坐标映射正确；
- 本地权限确认能够同步到手机，但远程来源不能绕过高风险确认；
- 弱网降码率、超时和重连行为明确；
- 日志、数据库和 Relay 中不存在屏幕帧、键盘正文、Token 或模型密钥。

## 16. 完成定义

阶段 A 至 C 完成后，用户可通过已配对手机在公网环境下安全连接自己的在线电脑：远程创建或继续 Agent 任务、接收流式结果和工件、处理权限确认；经桌面本地批准后查看屏幕，并经第二次批准进行鼠标键盘控制。桌面端始终只主动出站连接，所有访问可见、可撤销、可审计、可立即停止，且移动端无法直接访问本地 IPC、数据库、Shell 或模型密钥。
