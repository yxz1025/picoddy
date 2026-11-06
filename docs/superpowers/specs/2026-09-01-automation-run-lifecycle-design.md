# 自动化任务可靠执行设计

## 背景

当前自动化任务在创建关联会话和 `inProgress` 运行记录后，以未等待、未捕获的 Promise 启动 Agent。会话初始化完成前没有任何消息落库；初始化失败、应用退出或 Promise 中断时，运行记录会永久停留在 `inProgress`，关联会话保持空白。

调度器每 30 秒执行一次异步扫描，但只在 Agent 完成后更新 `nextRun`。任务执行超过 30 秒时，后续扫描会再次领取同一任务。现有数据库中已出现连续重复执行记录。

本次改造聚焦可靠性闭环，不加入绑定已有会话、Git worktree、文件事件触发或外部任务队列。

## 目标

- 每次运行都具有明确、可恢复的终态。
- 用户点击“查看会话”时至少能看到本次任务的输入，不再进入无说明的空会话。
- 同一个自动化任务在任一时刻最多有一个活跃运行。
- 调度扫描不会因 Agent 执行时间超过扫描间隔而重复触发。
- 应用重启后能收敛上次进程遗留的活跃运行。
- assistant 和 tool 消息只有一个持久化所有者，避免运行中打开会话造成重复消息。
- 用户前台任务活跃时，自动化保持排队，不与前台任务同时启动。
- 保持现有 Electron IPC/HTTP 路由和任务创建表单基本兼容。

## 非目标

- 不实现云端常驻调度；本地任务仍要求桌面应用运行。
- 不增加多进程 Worker、Redis 或第三方队列。
- 不承诺同进程内的 CPU、网络和文件系统绝对资源隔离；硬隔离需要独立 sidecar 与独立工作区，另立项目实施。
- 不实现自动化绑定已有聊天。
- 不实现 Git worktree 隔离。
- 不补齐 `file_watch`、热键、专家执行和小程序推送。
- 不重构无关的会话、Provider 或前端状态管理代码。

## 架构决策

采用单机 SQLite 事务协调器，而不是内存锁或外部队列。

```text
手动 Run Now / 定时扫描
          │
          ▼
AutomationRunCoordinator
  ├─ BEGIN IMMEDIATE
  ├─ 检查同任务是否已有活跃 Run
  ├─ 调度触发时提前推进 nextRun
  ├─ 创建 Conversation
  ├─ 创建 Run(queued)
  ├─ COMMIT
  ├─ 准备 Provider 会话与持久化监听
  └─ 写入首条 user 消息后才返回
          │
          ▼
AutomationExecutor
  ├─ 等待前台会话空闲
  ├─ Run → running
  ├─ 初始化技能/连接器/Agent
  ├─ 执行超时与 abort
  └─ Run → completed / failed / timedOut
          │
          ▼
运行记录 UI + 关联会话
```

SQLite 的 `BEGIN IMMEDIATE` 串行化任务领取。协调器在事务内查询同一 `automation_id` 的活跃 Run；存在时不创建第二次运行。应用只有一个 Electron 主进程，因此不需要新增数据库唯一索引或分布式租约。

## 状态模型

运行状态调整为：

- `queued`：Run 和 Conversation 已经持久化，协调器正在准备会话或等待执行器接管；成功响应返回前首条消息必须已经持久化。
- `running`：执行器已经开始初始化或运行 Agent。
- `completed`：Agent 正常结束。
- `failed`：初始化、工具装配或 Agent 执行失败。
- `timedOut`：超过最大执行时间，执行器已请求中止。
- `cancelled`：保留给后续主动取消能力；本次只支持读取和显示，不新增取消入口。

旧的 `inProgress` 只作为读取兼容值：启动恢复时统一标记为 `timedOut`，新运行不再写入该状态。SQLite 状态列为文本，不需要修改表结构。

终态为 `completed | failed | timedOut | cancelled`。活跃态为 `queued | running | inProgress`。

## 事务创建与调度领取

新增协调器负责手动运行和定时运行的共同创建流程：

1. 使用 `BEGIN IMMEDIATE` 开始事务。
2. 重新读取自动化配置，避免使用扫描前的过期对象。
3. 查询同一任务是否有活跃 Run。
4. 若已有活跃 Run：
   - 手动运行返回结构化冲突结果，HTTP/IPC 映射为 409。
   - 定时扫描视为本轮已处理，不创建新 Run。
5. 定时触发在启动 Agent 前计算并写入 `lastRun` 和下一次 `nextRun`；一次性任务同时停用。
6. 创建 `automation` 分类 Conversation。
7. 创建状态为 `queued` 的 Run。
8. 提交领取事务。
9. 准备 Provider 会话并安装单一持久化监听。Provider 在这一步捕获不包含本次 Prompt 的稳定历史快照。
10. 写入原始用户可见 Prompt。

步骤 1–8 任一步失败都会回滚，避免只存在 Run 或只存在 Conversation。步骤 9–10 失败时，协调器保留 Run 和 Conversation，写入可展示的失败说明，并将 Run 结束为 `failed`。这段两阶段流程是必要的：如果在 Provider 首次初始化前写入 Prompt，Core Session 的旧 SQLite 历史迁移可能导入该 Prompt，随后正式执行又追加一次，造成上下文重复。

手动执行接口在第 10 步完成后返回 `{ ok, runId, sessionId, status }`，随后以显式 `.catch()` 监管后台执行。接口不等待 Agent 完成，但保证成功响应关联的会话已经可查看。

## 执行与错误处理

执行器只接收已经持久化的 Run：

1. 等待前台活动门控允许启动。
2. 将 `queued` 原子更新为 `running`；更新失败则停止，避免重复执行同一 Run。
3. 装配连接器工具和 Agent 选项。
4. 调用 Provider 执行 Prompt。
5. 正常结束后读取最后一条 assistant 消息作为摘要，并写入 `completed`。
6. 捕获全部初始化和执行异常，写入 `failed`，摘要保存可展示的错误信息。
7. 使用 30 分钟固定上限监管本地任务。超时后调用 `provider.abort(sessionId)`，等待执行 Promise 收敛，再将 Run 写为 `timedOut`。
8. 终态更新采用条件更新，只允许从 `queued/running/inProgress` 进入终态，避免超时和迟到完成相互覆盖。

本次不增加可配置超时 UI。固定上限满足当前可靠性需求，也避免新增未经验证的配置面。

## 前台优先与主进程影响控制

自动化与普通聊天目前运行在同一个 Electron 主进程。不同 `sessionId` 具有独立 Agent 和 Prompt 队列，但仍共享事件循环、SQLite、模型网络、MCP 连接以及全局文件写锁。因此仅靠会话隔离不能宣称“完全不影响主进程”。

本次增加进程内前台活动门控，覆盖“用户正在执行任务时自动化到点”的主要场景：

- `/api/prompt` 从收到用户任务开始登记前台活动，在对应 `provider.prompt()` 结束或失败后释放。
- 自动化 Run 可以按时创建并显示为 `queued`，但只有当前台活动数为零并持续空闲 3 秒后才进入 `running`。
- 等待期间如果又有用户任务到达，重新计算空闲窗口，前台永远优先获得启动机会。
- 全局最多一个自动化 Run 进入 `running`；不同自动化也不并行执行。
- 已经进入 `running` 的自动化不因新用户任务强制中止。工具调用可能已经产生文件写入或外部副作用，抢占式 abort 会制造更难恢复的半完成状态。
- 新用户任务不会被活动门控阻塞；如果它在自动化已经运行后到达，两者可能短暂共享 CPU、网络或文件写锁。后续要消除此残余影响，必须把自动化 Agent Runtime 拆到独立 sidecar，并为写任务提供独立工作区。

后台任务不能占用前台交互界面：

- 自动化会话不注册会弹窗的工具确认处理器。
- 自动化执行中遇到需要确认的写操作时自动拒绝，并将 Run 标记为 `failed`，提示用户调整权限或任务配置。
- 自动化 Runtime 不提供 `ask_user_question`；需要用户补充信息时以失败摘要结束，不显示全局提问弹窗。
- 用户主动打开自动化会话只用于查看流和历史，不改变以上无人值守策略。

## 单一消息持久化所有者

当前自动化使用 `provider.attachPersistence()` 写 assistant/tool 消息；用户在运行中打开会话后，应用事件中继也会写相同消息，存在双写风险。

改造后：

- Provider 会话持久化监听是 assistant/tool 消息的唯一写入者。
- `attachPersistence(sessionId)` 改为确保该会话已安装一个长期、幂等的持久化监听，不再返回会被自动化执行结束时移除的临时所有权。
- 普通聊天和自动化在执行 Prompt 前都调用这一入口。
- `SessionEventRelay` 只负责流式事件转发、交互请求状态和使用量统计，不再写 assistant/tool 消息。
- 用户消息仍由各入口在执行前显式持久化；自动化由协调器事务写入，普通聊天保持现有 HTTP/IPC 流程。

这使“是否有前端 SSE 连接”不再决定消息能否落库。

## 启动恢复

调度器启动前执行一次恢复：

- 将所有 `queued`、`running`、`inProgress` Run 更新为 `timedOut`。
- `finishedAt` 写入恢复时刻。
- `summary` 写入“应用退出或任务中断，运行未正常完成”。
- 如果关联会话没有消息，补写一条说明任务中断的 assistant 错误消息，保证历史运行可解释而不是空白。

本地执行不能在进程重启后续跑，因此不伪造重试。对应自动化的 `nextRun` 已在领取时推进；重启后继续等待下一周期。一次性任务不会自动重跑，用户可以从运行记录手动再次执行。

## 调度器行为

- 保留 30 秒扫描周期。
- 使用非重入扫描保护，上一轮扫描未结束时跳过下一次 tick。
- 扫描只负责领取和派发；不等待所有 Agent 执行完成。
- 每个任务的 `nextRun` 在事务领取时提前推进。
- 单任务活跃 Run 检查防止手动执行和定时执行相互重叠。
- 单个任务派发失败不得阻断同一轮其他任务。
- 派发器通过前台活动门控和全局自动化许可保证一次只启动一个后台 Agent。

当前 Cron 解析器的 7 天搜索上限和标准 Cron 日/月语义不在本次可靠性改造范围；后续应独立替换为成熟的 RRULE/Cron 库。

## 前端行为

- “立即运行”成功后刷新任务内运行记录和全局运行记录。
- `queued` 显示“等待执行”，`running` 和旧 `inProgress` 显示“运行中”。
- `timedOut` 显示“已超时”，其他终态沿用现有中文状态。
- 运行列表在存在活跃 Run 时定时刷新；所有 Run 进入终态后停止轮询。
- `sessionId` 存在时仍显示“查看会话”。由于接口返回前已写入用户消息，点击后不会是空白会话。
- 手动执行遇到同任务已有活跃 Run 时显示明确提示，不创建重复记录。
- 运行失败或超时仍允许查看关联会话，以便检查已产生的消息和工具记录。

本次不新增独立运行详情页，避免扩大 UI 范围。

## API 契约

`POST /api/automations/:id/run` 成功响应：

```json
{
  "ok": true,
  "runId": "run-id",
  "sessionId": "conversation-id",
  "status": "queued"
}
```

同任务已有活跃运行时返回 HTTP 409：

```json
{
  "error": "该自动化任务正在运行",
  "code": "AUTOMATION_ALREADY_RUNNING",
  "runId": "active-run-id",
  "sessionId": "active-session-id"
}
```

Electron IPC 继续通过现有 `_callApi`/`handleApi` 链路，不新增渲染进程直连数据库能力。

## 模块边界

- `src/domains/automation/node/store.ts`
  - 状态类型、活跃 Run 查询、条件状态更新、启动恢复。
- `src/domains/automation/node/coordinator.ts`
  - Run/Conversation 事务创建、Provider 准备、首条消息写入和调度推进。
- `src/domains/automation/node/executor.ts`
  - 前台空闲等待、Agent 执行、超时、中止、摘要和终态。
- `src/domains/automation/node/activity_gate.ts`
  - 前台活动计数、3 秒空闲窗口和单个自动化执行许可。
- `src/domains/automation/node/scheduler.ts`
  - 定时扫描、非重入保护和派发，不再承担消息持久化细节。
- `src/agent/provider.ts`
  - 幂等安装会话消息持久化监听。
- `application.electron.ts`
  - HTTP/IPC 适配、后台 Promise 监管、事件中继去除数据库双写。
- `frontend/src/store/automationStore.ts`
  - 新状态契约、冲突传播和运行刷新。
- `frontend/src/components/AutomationPanel.tsx`
  - 状态展示、活跃运行轮询和错误提示。

## 测试策略

所有生产修改采用测试先行。

### Store 与协调器

- 领取事务中的 Run 和 Conversation 要么同时创建，要么全部回滚。
- Provider 准备完成前不写当前 Prompt，避免 Core Session 历史重复导入。
- Provider 准备失败时 Run 进入 `failed`，会话包含原始 Prompt 和失败说明。
- 同一自动化存在活跃 Run 时不能创建第二个 Run。
- 不同自动化可以分别创建活跃 Run。
- 状态只能从活跃态进入终态，迟到结果不能覆盖 `timedOut`。
- 启动恢复正确处理 `queued/running/inProgress`，不修改已完成记录。
- 定时领取在 Agent 启动前推进 `nextRun`。

### 执行器

- 前台任务活跃时 Run 保持 `queued`，不会调用 Agent。
- 前台持续空闲 3 秒后 Run 才进入 `running`。
- 多个自动化 Run 排队时全局只运行一个。
- 初始化失败写入 `failed`。
- Prompt 失败写入 `failed`。
- 正常完成写入 `completed` 和摘要。
- 超时调用 abort 并写入 `timedOut`。
- 后台 Promise 拒绝不会产生未处理拒绝。
- 自动化需要工具确认或用户提问时不会弹出全局 UI，而是结束为 `failed`。

### 消息持久化

- 同一会话重复调用持久化安装只产生一份 assistant/tool 消息。
- 没有 SSE 客户端时自动化消息仍然落库。
- 运行中建立 SSE 不会造成消息重复。

### 调度器与前端

- 扫描重入时不会重复派发。
- 一个任务失败不影响其他到期任务。
- 活跃运行显示正确状态并触发轮询；进入终态后停止轮询。
- “查看会话”加载到协调器返回前写入的首条用户消息。

## 验收标准

- 连续点击“立即运行”只产生一个活跃 Run，第二次得到明确提示。
- 用户前台任务运行时，到期自动化保持 `queued`；前台结束并空闲 3 秒后才启动。
- 两个不同自动化同时到期时只运行一个，另一个保持 `queued`。
- 立即进入运行记录并查看会话，至少显示任务 Prompt。
- 模拟 Agent 初始化失败后，Run 为 `failed`，会话保留输入和错误结果。
- 模拟任务超过 30 秒扫描周期，不产生重复 Run。
- 模拟超时后，Run 为 `timedOut` 且 Provider 收到 abort。
- 模拟应用重启后，遗留活跃 Run 被收敛为 `timedOut`。
- 自动化无前端连接时正常持久化；运行中打开会话不产生重复消息。
- 现有自动化 CRUD、任务开关、运行列表和普通聊天消息持久化不回归。

## 多平台边界

协调器、执行器和调度器只依赖 Electron 主进程、Node.js、SQLite、`Date` 和定时器，不引入平台专用命令。工作目录继续通过现有平台路径抽象解析。

功能完成只能证明代码路径平台无关；Windows 与 Linux 可用性仍需各自的打包和运行冒烟验证，不能用 macOS 本机测试代替。
