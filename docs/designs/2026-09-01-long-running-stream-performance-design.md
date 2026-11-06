# 长任务流式输出性能优化设计

## 背景

当前桌面会话由 Pi Agent 产生 `message_update`，经 `LocalPiProvider`、`application.electron.ts` 中的会话事件队列、HTTP `ReadableStream`、`main.mjs` 的 `node:http` 转发和前端 `EventSource` 到达 Zustand，再由 `ChatArea` 渲染 Markdown。

现状在短回复下可用，但长回复、密集工具调用、长历史会话和反复切换会话时存在确定性的放大效应：

- Pi Agent 的 `message_update` 已携带 `assistantMessageEvent.delta`，当前链路却反复序列化和传输完整 assistant 消息快照。
- 实际主聊天走 SSE，而已有 `useIPC` 的 RAF 合帧逻辑只监听未接入主聊天的 `server-event`，因此每个模型事件都会触发 Zustand 更新。
- 流式过程中会反复遍历全部消息、解析 Markdown 并测量滚动高度。
- SSE 清理由 `application.electron.ts` 调用 `req.on("close")`，但 `main.mjs` 传入的请求适配器把 `on` 实现为空函数，连接关闭后订阅和心跳可能残留。
- 每会话事件队列最多保留 500 个事件；当事件含完整递增消息时，会造成额外内存占用。逐事件日志也会放大主进程负担。
- `ReadableStream.enqueue()` 和 `ServerResponse.write()` 均未形成背压闭环。

本次优化要求不改变会话、消息、工具、权限确认、用户提问、取消、浮窗、持久化、断线恢复和交付物等既有产品功能。

## 目标

1. 将长回复的流式传输从重复完整快照改为增量传输，避免随回复长度出现近似二次增长的序列化、传输和解析成本。
2. 将高频模型事件合并为有限频率的 UI 更新，保证输入、滚动、按钮和窗口交互在长任务期间保持响应。
3. 确保 SSE 关闭、切换和重连后释放监听器、定时器、Reader 和待发送数据。
4. 避免历史消息和已完成 Markdown 因当前回复增量而重复渲染。
5. 对长会话和大型工具结果限制 DOM 与内存增长，同时保留完整数据和查看能力。
6. 保持事件顺序：任何 `message_end`、工具事件、`agent_end` 发出前必须先提交此前的文本增量。

## 非目标

- 不改变模型调用、Prompt Runtime、上下文压缩和工具执行策略。
- 不改变 SQLite 中消息的最终存储格式和既有历史记录。
- 不改变用户可见的最终 Markdown 内容、工具结果、确认流程或会话状态含义。
- 不引入 WebSocket、远程服务或新的后端框架。
- 不借本次性能优化重构无关组件、样式或业务领域。

## 现状与根因

### 后端事件链路

`LocalPiProvider` 将同一原始事件广播给会话监听器。`getQueue()` 创建一个长期监听器，负责最终消息持久化、工具持久化和事件入队；每条 SSE 连接又创建一个直接监听器。

这带来四个问题：

1. 同一事件至少经过队列监听器和 SSE 监听器两条路径。
2. `message_update.message` 是当前完整快照，虽然 SDK 同时提供 delta，但没有使用。
3. 队列只在 SSE 建连时清空，在线期间仍持续积累到 500 条。
4. HTTP 适配层没有把真实连接关闭信号传给 `handleApi`。

### 前端状态与渲染链路

`connectSSE()` 对每个 `message_update` 立即调用 Zustand `set`，复制消息数组并更新最后一条消息。`ChatArea` 随后重新分组消息、渲染消息列表、解析 Markdown并执行自动滚动。`App` 和 `ChatArea` 均以无 selector 方式订阅整个 Store，扩大了更新范围。

已有 `useIPC` 虽然包含 RAF 合帧，但当前后端没有发送对应的 `stream.partial` 主聊天事件，而且其回调闭包读取的是调度 RAF 时捕获的旧 Store 状态，不能直接作为新链路复用。

## 方案

### 一、建立单一会话事件中继

在后端建立每会话一个 `SessionEventRelay`，替换“持久化队列监听器 + 每条 SSE 直接监听器”的双订阅结构。

中继负责：

- 只创建一个 Provider 订阅。
- 在 `message_end` 和 `tool_execution_end` 上执行现有持久化逻辑，持久化内容与时机保持不变。
- 从 `message_update.assistantMessageEvent` 提取 `text_delta`；只对文本 delta 做批量合并。
- 维护当前 turn 的完整文本快照、递增 sequence 和运行状态，供新 SSE 客户端连接时恢复正在生成的内容。
- 立即转发工具、确认、用户提问和状态事件，但在这些有序边界事件前先 flush 已缓存的文本 delta。
- 不再缓存 500 条完整事件。待处理确认和用户提问继续以现有 `pendingConfirms` / pending answer 状态作为重放真源。
- 会话删除或 Provider dispose 时释放中继资源。

文本事件采用内部瘦协议：

```ts
type StreamTextEvent = {
  type: "stream_text";
  sessionId: string;
  sequence: number;
  mode: "delta" | "snapshot";
  text: string;
};
```

- 常规发送为 `mode: "delta"`。
- 新连接发现当前 turn 正在运行时，先发一次 `mode: "snapshot"`。
- 后端按约 32ms 合并 delta，降低跨层调用和 JSON 开销。
- `message_end` 仍携带最终 assistant 消息，作为最终一致性校验和持久化边界；前端收到后以最终文本覆盖流快照并提交历史消息。

所有项目内消费者，包括主聊天和浮窗，原子切换到该协议；不保留新旧流协议双轨兼容层。

### 二、正确处理连接生命周期和背压

`main.mjs` 为每个 HTTP 请求建立真实 `AbortController`，在 `req.aborted`、`req.close` 或 `res.close` 时 abort，并把真实 `AbortSignal` 传入 `handleApi`。

SSE 路由在创建流时立即写入一条 EventSource 会忽略的注释帧，`main.mjs` 同时主动刷新 `text/event-stream` 响应头。前端因此可以先确认流已建立再启动 prompt，空闲会话和打包冷启动不会形成“等待首个模型事件才建连、等待建连才提交消息”的循环等待。

SSE `ReadableStream` 的 cleanup 必须幂等，并覆盖以下竞态：

- 连接在 `provider.onEvent()` 完成前关闭。
- EventSource 主动关闭。
- Vite 代理断开或网络错误。
- Reader 被上层取消。
- 会话删除或 Provider 销毁。

cleanup 负责清除 heartbeat、取消中继订阅并关闭或取消 stream。异步订阅完成时若连接已经关闭，应立即调用刚取得的 unsubscribe。

`main.mjs` 写响应时检查 `res.write()` 返回值；为 `false` 时等待 `drain`，连接关闭则停止读取并 `reader.cancel()`。后端合并器只保留尚未发送的字符串缓冲，不为同一 turn 建立无界事件数组。

### 三、隔离流式状态并限制更新频率

Zustand 将“已完成历史消息”和“当前流式消息”分离到两个 Store，避免仍使用整 Store 订阅的无关组件被流式更新唤醒：

```ts
messages: Message[];
// 独立 useStreamStore
activeStream: Message | null;
```

- `stream_text snapshot` 创建或替换 `activeStream`。
- `stream_text delta` 先进入模块级缓冲，不立即写 Store。
- 前端按 animation frame 调度，但设置约 50ms 的最小提交间隔，避免高刷新率屏幕放大 Markdown 和布局成本。
- `message_end` 前同步 flush，使用最终消息校正文本，然后一次性把它追加到 `messages` 并清空 `activeStream`。
- 切换会话、取消、错误和重连时清理旧会话缓冲，禁止跨会话串流。
- 事件通过 `sessionId + sequence` 去重，忽略重连或异步到达的旧事件。

工具消息仍按现有时机进入历史数组；权限确认和用户提问仍走现有状态字段，不改变交互。

### 四、隔离历史消息渲染

将消息流拆成稳定的渲染单元：

- `ChatArea` 只订阅所需 Store slice，不再订阅整个 Store。
- `App`、消息行、工具组、Markdown 内容使用窄 selector、稳定 props 和 `React.memo`。
- `groupToolMessages()` 对稳定历史消息使用 `useMemo`；当前流式消息单独追加，不促使历史分组重算。
- Markdown 插件和 component 映射提升为模块级稳定常量，避免每次创建。
- 已完成消息内容引用不变时，不重新解析 Markdown。

流式消息在生成期间采用保真纯文本渲染（保留换行、空白和代码文本），只显示流式光标；收到 `message_end` 后再进行一次完整 Markdown 渲染。最终显示结果与现有行为一致，避免对不断增长的未闭合 Markdown 重复构建 AST。

### 五、滚动与长历史控制

- 自动跟随仅在用户仍位于底部附近时启用。
- 流式更新和滚动写入共用同一调度帧，每次 UI flush 最多执行一次滚动。
- 避免在同一处理循环内交替读取和写入布局属性。
- 工具组继续保持既有展开/折叠功能；折叠状态下不挂载完整输出内容。
- 为消息行增加浏览器原生渲染隔离；只有在性能基准证明长历史仍不达标时，才引入支持动态高度的成熟虚拟列表库。虚拟化必须验证 Widget、代码块、工具展开和自动跟随，不以牺牲这些功能换性能。

这一门槛设计避免在 P0/P1 已解决主要瓶颈后，仍无条件引入高风险的消息列表替换。

### 六、文档收敛

更新 `docs/03-技术架构设计.md` 和 `docs/15-Pi-Agent与Electron前端IPC交互协议.md`，明确桌面主聊天当前采用的实际流通道、增量协议、合帧位置、最终消息边界、连接清理与背压规则，删除与实际代码不一致的描述。

## 影响范围

预计只修改以下范围：

- `application.electron.ts`：会话事件中继、持久化入口、SSE 事件协议和清理。
- `main.mjs`：真实断开信号、Reader 取消和响应背压。
- `frontend/src/store/useStore.ts`：流缓冲、active stream 和事件顺序。
- `frontend/src/store/useStreamStore.ts`：高频流状态，与应用业务 Store 隔离。
- `frontend/src/components/ChatArea.tsx`：稳定历史渲染、流式纯文本、滚动调度。
- `frontend/src/components/FloatView.tsx`：消费相同增量协议。
- 必要的事件模型和针对性回归测试文件。
- `docs/03-技术架构设计.md`、`docs/15-Pi-Agent与Electron前端IPC交互协议.md`。

`application.electron.ts` 当前存在用户对登录 TTL 的未提交修改。本次补丁不得覆盖、格式化或暂存该无关改动。

## 风险与控制

### 事件丢失或乱序

控制方式：文本事件带单调 sequence；有序边界事件前强制 flush；`message_end` 使用最终完整消息校正。测试覆盖 delta、snapshot、重连、结束前 flush 和重复事件。

#### 审查补充：断线期间非文本事件恢复

实施后审查发现，仅保存当前文本 snapshot 不足以恢复断线期间发生的 `tool_execution_start`、`tool_execution_end`、`message_end` 和 `agent_end`。如果连接在最终消息持久化后、前端收到 `message_end` 前断开，新连接既收不到已结束 turn 的 snapshot，也不会自动重新读取数据库。

采用以下单一恢复协议，不进行无游标的盲目重放：

1. `SessionEventRelay` 为所有对 Renderer 可见的事件分配会话内单调递增的 `relaySequence`，文本事件不再拥有独立于其他事件的序列空间。
2. 中继维护有界 replay buffer，同时限制事件数量和序列化字节数；相邻文本 delta 继续合并。缓冲只用于短暂断线恢复，不作为消息事实源。
3. 前端为当前会话记录最后成功处理的 `relaySequence`。手动重连 EventSource 时通过查询参数提交 `after=<relaySequence>`；首次选择会话不提交游标，因为历史消息已经从数据库加载。
4. 中继订阅时：
   - 游标仍在 replay window 内：按原序补发 `relaySequence` 更大的事件；
   - 游标早于 replay window：先发送 `stream_resync_required`，不猜测缺失事件；
   - 首次订阅且 turn 正在生成：发送当前文本 snapshot。
5. 前端收到 `stream_resync_required` 后，使用现有 `/api/msgs/:id` 读取数据库最终态，原子替换已完成消息，同时保留或以中继 snapshot 校正仍在生成的文本；不得并行开启第二条 Provider/SSE 链路。
6. `message_end`、工具结束事件和交互事件按稳定身份去重：消息最终态依赖 `relaySequence`，工具依赖 `toolCallId`，交互依赖 `requestId`。重放不能追加第二条相同工具或 assistant 消息。
7. replay buffer 达到上限时从最旧事件开始淘汰并推进 `earliestReplaySequence`；不允许为保证重放而形成无界数组。大型工具输出进入缓冲前按协议只保留事件引用或受控大小，完整最终内容继续以 SQLite 为事实源。

新增回归覆盖：

- 文本 delta 后断线，重连补发剩余 delta 且不重复已有前缀；
- 工具开始后断线，重连补发工具结束并更新同一 `toolCallId`；
- `message_end` 持久化后、发送到前端前断线，重连恢复最终 assistant 消息；
- 断线跨越 replay window 时触发一次数据库重同步；
- 首次选择已有历史会话不重放旧事件；
- 重连期间待确认/待回答事件不重复创建交互状态；
- replay buffer 的事件数和字节数均保持在上限内。

### 切换会话时文本串入新会话

控制方式：所有缓冲按 sessionId 隔离；selection generation 变化时取消旧连接和调度；Store 提交前再次检查当前会话。

### SSE 异步订阅清理竞态

控制方式：cleanup 幂等并记录 closed 状态；unsubscribe 晚到时立即执行；同时监听输入请求和输出响应关闭。

### 流式阶段 Markdown 暂时以纯文本显示

这是唯一有意的瞬时展示差异：内容、顺序和最终 Markdown 不变。它避免未闭合 Markdown 在每个 token 上重复解析，也避免代码块结构不断跳动。

### 用户已有修改冲突

对重叠文件使用最小范围补丁；修改前后核对 diff，只暂存或提交本任务文件需另获用户指令。

## 验证方式

遵循项目规则，默认不自动运行测试套件。实施后执行允许的静态验证：

1. `npx tsc --project tsconfig.electron.json --noEmit`
2. `cd frontend && npx tsc --noEmit -p tsconfig.app.json`
3. `git diff --check`
4. 检查 diff，确认登录 TTL、Sidebar 和 ExpertPanel 等用户已有修改未被覆盖。

新增但默认不执行的回归测试应覆盖：

- 多个 text delta 合并且字符不丢失、不重复。
- `message_end`、工具事件和 `agent_end` 前 flush。
- snapshot 后只接收更大 sequence 的 delta。
- 切换会话清除旧 buffer。
- SSE 在订阅完成前和完成后关闭均只清理一次。
- `res.write()` 背压与连接关闭。
- 历史消息引用稳定时不重复构造流式消息。

如用户授权运行测试和本地性能验证，再补充执行：

- 10 万字符、细粒度 delta 的持续输出压力场景。
- 500 条历史消息与多组工具输出场景。
- 反复切换会话和断线重连场景。
- 使用 Chromium Performance/Memory 观察长任务期间 long task、帧率、堆内存和残留监听器。

验收标准：

- 网络负载与最终文本长度保持线性关系，不再重复传输完整前缀。
- 同一会话正常情况下只有一个 Provider 中继订阅；SSE 客户端数量随连接关闭回落。
- 流式 Store 提交频率不高于配置的约 20 次/秒，并保证结束事件前文本完整。
- 已完成 Markdown 不因当前回复 delta 重解析。
- 连接关闭后无残留 heartbeat、Reader 或 SSE subscriber。
- 最终消息、工具结果、确认、提问、取消、浮窗和持久化行为与改造前一致。
