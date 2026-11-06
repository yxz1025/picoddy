# Channels

项目内独立的远程消息通道模块。公共入口为 `index.ts`，无 Electron、前端、PI 或平台 SDK 依赖。

## 扩展插槽

| 接口 | 职责 |
| --- | --- |
| ChannelAdapterFactory | 声明渠道 ID、名称、配置字段、凭证字段和能力，创建连接适配器 |
| ChannelAdapter | connect / disconnect / send；负责平台 SDK、重连、消息解析及 ACK |
| ChannelManager | 每个 connectionId 一个运行实例，串行启停与发送，统一状态和入站来源 |
| ChannelCredentialStore | 宿主提供设备本地加密存储；凭证不进入公开连接配置 |
| ChannelConnectionStore | 保存不含凭证的连接配置 |
| ChannelSessionStore | 持久保存外部会话与项目会话的映射 |
| ChannelSessionRouter | 按渠道、连接、外部会话、可选 scopeId 隔离；合并并发创建 |
| ChannelAgentBridge | 宿主调用 provider.prompt/onEvent 的边界，保留权限与持久化流程 |

## 新增渠道

创建 `src/channels/<platform>/`，实现 `ChannelAdapterFactory`，再通过 `registry.register(factory)` 注册。
设置页从 `registry.list()` 的字段元数据生成基础表单；复杂平台配置可由前端独立组件接管。
注册器不自动扫描目录或执行第三方包，具体渠道由宿主显式注册。

```ts
import { ChannelRegistry, ChannelManager } from './index.ts';
import type { ChannelAdapterFactory } from './index.ts';

export function createChannels(adapter: ChannelAdapterFactory, onMessage: ConstructorParameters<typeof ChannelManager>[1]['onMessage']) {
  const registry = new ChannelRegistry();
  registry.register(adapter);
  return new ChannelManager(registry, { onMessage });
}
```

宿主组合顺序：实例化 registry → 注册平台 factory → 创建 manager 并注入 onMessage → 从存储读取连接与凭证 → 调用 manager.connect(connection, credentials)。退出应用时 await manager.dispose()。

## 入站与出站

`onMessage` 应完成权限校验、群/用户白名单、去重和入队后返回。不要在其中等待整轮 Agent 处理或等待 manager.send：connect 期间适配器可能触发回调，等待同一连接队列会造成死锁。适配器在宿主接受消息后执行平台 ACK；失败按平台协议重试。标准消息不携带完整原始 SDK payload，也不携带 sessionWebhook 等敏感回复凭证；这些由适配器内部保存。

后台消费者调用 router.resolve(address)，再调用宿主 ChannelAgentBridge.handle。node/service.ts 提供默认组合，按会话与发送人排队，队列上限 100 条。桥接的 reply 回调调用 manager.send(connectionId, output)。AbortSignal 由宿主任务生命周期管理。通用层不决定执行权限、并发队列容量、消息去重保留期或群共享/按用户隔离策略。

## 生命周期

- connect 对已经运行的连接幂等；修改配置或凭证须先 disconnect 再 connect。
- SDK 自动重连通过 context.onStatus 上报；manager 不重复建立连接。
- disconnected 后旧适配器的消息会被拒绝，旧状态通知被忽略。
- disconnect 失败保留运行实例，重试清理成功前不创建第二个实例。
- manager 只对本进程内实例去重，不能阻止另一台机器使用相同平台凭证。
- onStatus 只接受状态，公共错误使用固定错误码，不暴露 SDK 原始异常。
- SessionRouter 的并发合并限单实例；宿主应共享一个 router，跨进程需存储层提供原子绑定。

## 当前范围

已接入钉钉适配器、设置 → 远程通道、可信主窗口 IPC、Electron safeStorage 加密本机文件、启动恢复和现有 provider。凭证文件位于应用数据目录的 channels/connections.enc，不经 HTTP，不返回 App Secret。断开连接停用启动恢复并取消排队与在途任务；退出应用清理连接但保留启动恢复设置。

钉钉当前支持单聊文本和群中 @机器人文本，文本/Markdown 回复按 1000 Unicode 字符分段；不处理附件和卡片流式输出。使用默认模型、craft 模式与 default 权限，需要确认的后台操作直接拒绝。单任务 10 分钟超时。群和发送人白名单可在弹窗“访问范围”设置，留空不限制；凭证本身不绑定硬件，另一台电脑持有相同凭证仍可连接。

当前去重窗口 1 小时、最多 2000 条，仅在内存中，不保证进程重启或崩溃后的 exactly-once。ACK 表示成功进入本进程队列，不代表已持久化任务。异常退出时排队任务可能丢失。会话 ID 映射保存到加密配置中，聊天内容由原有会话存储负责。

设置 UI 目前管理一个钉钉连接；后端支持多个连接实例。新增平台可注册适配器与字段描述，平台专用 IPC 参数校验在 node/ipc.ts 扩展。

验证：`npx tsx --test src/channels/channels.test.ts`。

验证：node --import tsx --test src/channels/channels.test.ts src/channels/dingtalk/adapter.test.ts src/channels/dingtalk/transport.test.ts src/channels/node/store.test.ts src/channels/node/service.test.ts src/channels/node/ipc.test.ts。

来源和许可正文位于 dingtalk/THIRD_PARTY_LICENSES.txt，使用 txt 后缀确保进入 Electron 发布包。

## 用户选择文件夹的知识库问答

设置 → 远程通道 → 钉钉机器人 → 修改配置 → 启用知识库问答 → 选择任意本机文件夹 → 保存并连接。目录由用户决定，不写死产品名、业务编号或个人路径。同一 App Key 下密钥留空保留；更换账号需新密钥。

当前实现不依赖 Obsidian、CLI、插件、市场技能或向量库。旧 kind=obsidian 配置仍兼容目录读取；新配置 kind=directory。知识库范围是用户选择的目录，不是其父目录。切换目录创建独立的通道会话映射。

第三方通道任务统一调用现有普通 Agent，mode=craft、permission=default，不修改普通 Agent 或普通聊天、项目会话。配置知识库时，仅在通道本轮输入中附加所选目录，要求先查看导航索引，再读取相关笔记，并按需继续使用现有技能与工具。未配置知识库时直接传入用户问题。原始用户问题独立保存在会话中。

不再切换 channel-knowledge 隔离策略、不预载目录、不强制每次回答必须有知识库引用。目录是参考资料范围，普通 Agent 的工具权限保持原规则；第三方通道仍自动拒绝需要交互确认的操作。目录文件内容不视为执行授权。目录专用读取模块保留供独立使用，但不再连接钉钉任务主流程。

返回钉钉前移除数字引用标记和末尾来源列表。会话仍按连接、群、发送者和目录配置隔离；更换目录不复用旧目录的会话。

## 个人微信 ClawBot

设置 → 远程通道 → 个人微信 → 连接 → 生成微信二维码 → 手机微信扫码确认 → 保存并连接。遇到配对码时输入手机端显示的码。可同时配置任意知识库目录，复用第三方通道的普通 Agent + 技能流程，普通会话和项目会话不变。

使用腾讯 @tencent-weixin/openclaw-weixin 2.4.10 中的 iLink HTTP/JSON 协议（许可见 weixin/THIRD_PARTY_LICENSES.txt），没有 OpenClaw 运行时依赖。二维码是手机授权凭证，不显示原始 token。需支持 ClawBot 的微信版本/账号；仅支持绑定账号本人文字私聊，普通微信群和媒体消息不会触发任务。

扫码令牌仅驻留主进程并通过 safeStorage 加密保存，公共快照只显示 botId、ownerId。二维码授权最多保留五分钟；关闭弹窗取消授权。微信 API 仅允许 HTTPS 的微信官方子域，禁止自动重定向，限制响应尺寸与请求时长。官方返回 -14 或鉴权失败时停止接收，需重新扫码。

消息游标与最近2000个消息 ID 另行加密保存；连接中断自动重试，断开连接会取消轮询和正在执行的通道任务。回复使用原消息 context_token，只允许回到绑定账号；回复最多拆成10条文字，超长内容请在电脑端查看。客户端需运行且联网，扫码确认不代表已验证模型可用性，模型仍由用户选择。
