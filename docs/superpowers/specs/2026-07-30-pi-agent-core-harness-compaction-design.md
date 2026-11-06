# pi-agent-core Harness 与上下文压缩接入设计

## 背景

当前应用通过 `LocalPiProvider` 包装 `pi-agent-core` 的基础 `Agent`。这条链路已经承载 HTTP/SSE、Ask/Plan/Craft 模式、权限确认、工具审计、自动化、子代理和 SQLite 消息投影，但存在以下问题：

- 基础 `Agent` 的消息数组持续增长，没有上下文阈值检查和摘要压缩。
- 应用重启时只从 SQLite 恢复 user/assistant 文本，工具调用和工具结果不会重新进入模型上下文。
- core 0.80.3 已提供 `AgentHarness`、`Session`、`JsonlSessionRepo` 和 compaction 能力，应用尚未接入。
- 长期记忆只在 Agent 创建时注入，存活会话内新增记忆不会自动刷新。
- working memory 没有会话标识，实际被所有会话共享，也没有在会话删除时清理。

本设计将完整上下文生命周期交给 `pi-agent-core`，应用仅保留业务适配和 UI 投影，不重新实现 Token 估算、切割点选择、摘要生成或压缩后上下文重建。

## 目标

- 将主会话运行时从基础 `Agent` 迁移到 `AgentHarness`。
- 使用 core 原生 JSONL Session 保存完整消息树、工具结果和压缩记录。
- 使用 core 的 `estimateContextTokens`、`shouldCompact` 和 `AgentHarness.compact` 实现自动上下文压缩。
- 保持现有 HTTP、SSE、SQLite UI 数据、权限、工具、自动化和子代理接口不变。
- 兼容现有用户的 SQLite 历史会话。
- 保持 Windows 与 macOS 的运行、路径和打包兼容性。
- 将 working memory 隔离到会话，并让系统提示在每轮开始时重新加载最新记忆。

## 非目标

- 不实现新的 Token 估算、摘要算法、向量数据库或语义检索。
- 不改变前端消息协议和界面。
- 不迁移或删除现有 SQLite user/assistant/tool 消息。
- 不改变现有长期记忆的用户管理 API。
- 不在本次迁移中实现 core 会话分支 UI。
- 不将 core JSONL 内容复制进 SQLite。

## 方案选择

### 采用：AgentHarness + JsonlSessionRepo

每个应用 conversation 对应一个同 ID 的 core Session。core JSONL 是模型上下文真源，SQLite 是会话列表和前端消息的投影。

选择理由：

- 完整复用 core Session 和 compaction 数据结构。
- 工具结果、压缩摘要和保留边界可跨重启恢复。
- 不需要自行实现 SQLite `SessionStorage` 协议。
- Provider 的外部接口可以保持稳定，降低对上层的影响。

### 未采用：基础 Agent + compaction helpers

这种方式改动较小，但应用必须自行维护 Session entry、压缩记录、上下文重建和事件时机，会形成一套不完整的 Harness。

### 未采用：自定义 SQLite SessionStorage

这种方式可以只使用一个数据库，但需要长期维护 core SessionStorage 语义、树结构和迁移逻辑，与“直接使用 core 能力”的目标冲突。

## 数据所有权

### core JSONL

负责：

- 完整 user、assistant、toolResult 消息。
- core Session tree entry。
- model、thinking level 和 active tools 变化记录。
- compaction summary、`firstKeptEntryId` 和 `tokensBefore`。
- 压缩后的上下文重建。

### SQLite

继续负责：

- `conversations` 列表、标题、分类、状态、模型、工作空间和父会话关系。
- 前端展示用 user、assistant 和 tool 消息。
- 附件关系。
- 记忆、设置、工具审计、自动化运行和使用量。

SQLite 新增 `conversations.core_session_path`，用于直接打开对应 JSONL，避免每次启动扫描全部 Session 文件。

## 文件位置和跨平台路径

core Session 根目录使用：

```text
platformPaths.join(platformPaths.appDataDir, "core-sessions")
```

运行时环境：

- macOS：`~/.pi-a/core-sessions`
- Windows：`%LOCALAPPDATA%\Pi-a\core-sessions`

所有拼接通过 `platformPaths` 或 core FileSystem 接口完成，不写死 `/`、反斜杠、HOME 或 USERPROFILE。Harness 使用 core 提供的 `NodeExecutionEnv` 作为 `ExecutionEnv` 和 JSONL FileSystem；测试必须覆盖带空格和中文字符的 Windows 路径。

## 组件设计

### CoreSessionManager

新增独立模块，负责 core 会话的创建、打开、旧历史导入和删除。它依赖：

- `JsonlSessionRepo`
- `NodeExecutionEnv`
- `platformPaths`
- SQLite conversation 元数据

公开职责：

- `openOrCreate(conversationId)`：打开已有 JSONL，或创建同 ID Session。
- `delete(conversationId)`：删除 conversation 对应的 JSONL。
- `getContextUsage(session)`：调用 core 的上下文估算。

它不负责 Prompt、事件广播、工具或 UI 消息持久化。

### PiAgentHarness 工厂

现有 `createPiAgent` 演进为 Harness 工厂，负责：

- 获取模型。
- 注入 `Models`、core Session、ExecutionEnv 和工具。
- 提供动态 system prompt 回调。
- 注册权限和审计 hooks。
- 将 core AgentEvent 转发给 Provider。

工厂不实现压缩算法，只组合 core 能力。

### LocalPiProvider

对外的 `AgentProvider` 接口不变。内部 `SessionEntry` 保存 Harness、core Session、监听器、会话分类和最近一次运行选项。

Provider 继续负责：

- `sessionId -> SessionEntry` 生命周期。
- Ask/Plan/Craft 工具切换。
- 斜杠技能增量。
- 当前权限和 `AsyncLocalStorage` session context。
- Prompt、steer、abort、事件广播和销毁。
- Prompt 前后的自动压缩触发。

### SQLite 投影监听器

现有 `application.ts` 和 `attachPersistence()` 继续监听 AgentEvent：

- `message_end(assistant)` 写入 assistant 文本。
- `tool_execution_start/end` 写入工具参数和结果。
- token usage 继续写 usage log。

Harness 自己写 JSONL；投影监听器不写 core Session。

## Prompt 生命周期

```text
POST /api/prompt
  → SQLite 写入用户可见消息
  → Provider.ensureSession
  → CoreSessionManager 打开/创建 JSONL
  → 必要时导入旧 SQLite 历史
  → Provider 检查是否需要预压缩
  → Harness 动态生成 system prompt
  → Harness.prompt
  → core 写完整消息到 JSONL
  → AgentEvent 经 Provider 广播
  → SSE/轮询推送并更新 SQLite 投影
  → Provider 检查是否需要后压缩
  → 更新 conversation 状态
```

HTTP `/api/prompt` 仍然快速返回 `{ ok: true }`，结果继续通过 SSE 返回。

## 自动压缩

自动压缩只组合 core API：

1. 使用 `session.buildContext()` 取得 core 已重建的当前上下文。
2. 使用 `estimateContextTokens(context.messages)` 计算当前占用。
3. 使用 `shouldCompact(tokens, model.contextWindow, DEFAULT_COMPACTION_SETTINGS)` 判断阈值。
4. 达到阈值时调用 `harness.compact()`。
5. Harness 使用 core 默认设置生成摘要并写入 compaction entry。
6. 下一轮 `session.buildContext()` 自动返回“摘要 + 保留的近期消息 + 新消息”。

检查发生在：

- Prompt 前：防止重启或历史导入后的超限上下文直接请求模型。
- Prompt 后：在本轮刚达到阈值时提前压缩，为下一轮准备。

同一会话同一时刻只允许一个 Prompt 或 compaction。压缩不与正在运行的 Harness 并发。

压缩事件可继续通过 Provider 广播，但前端不依赖或展示该事件。

### 压缩失败

- Prompt 前压缩失败：不发送可能超限的模型请求，返回可见错误，原 JSONL 保持不变。
- Prompt 后压缩失败：本轮正常回答已经保存和展示；记录错误日志，保留原 JSONL，并在下一轮再次尝试。
- 不删除原始 Session 文件，不写入伪造摘要。

## 旧会话迁移

当 `core_session_path` 为空时：

1. 创建 ID 等于 `conversationId` 的 core Session。
2. 按创建时间读取 SQLite 消息。
3. 只导入 user 和 assistant 消息，保持当前恢复语义。
4. Assistant 历史消息补齐 core 所需的 provider、model、usage 和 stopReason 元数据。
5. 更新 `core_session_path`。

迁移必须幂等：

- JSONL 创建并完成导入后才写 `core_session_path`。
- 路径存在且元数据 ID 匹配时直接打开。
- 路径不存在或元数据不匹配时明确失败，不静默创建空会话造成“失忆”。
- 新版运行产生的 toolResult 会完整写入 JSONL；旧 SQLite 历史中已经丢失的工具调用结构无法逆向恢复。

## 动态系统提示与记忆

Harness 的 `systemPrompt` 使用异步回调，每轮开始重新组合：

- 与当前行为一致的基础提示：专家或 Skill Creator 提示存在时替代平台基础提示，否则使用平台基础提示。
- 用户自定义提示。
- 最新 Skills 提示。
- 最新长期记忆。
- 当前会话 working memory。
- 当前 Ask/Plan/Craft 和斜杠技能增量。

长期记忆继续由现有 SQLite `memories` 表和 `memory_recall`/`memory_write` 工具管理，不引入第二套记忆数据库。

长期记忆仍保留 10000 字符安全上限；本次不把它描述为“摘要压缩”。对话上下文压缩由 core compaction 独立完成。

## Working memory 会话隔离

`memories` 新增可空 `session_id`：

- Agent 工具写入 `scope=working` 时，使用 `sessionContext` 中的当前会话 ID。
- 自动系统提示只读取当前 `session_id` 的 working memory。
- 旧版 `session_id IS NULL` 的 working memory 作为兼容全局数据继续展示，但不自动注入任意新会话，避免跨会话泄漏。
- UI 直接创建 `scope=working` 且没有 session ID 时保留为未绑定数据。
- 删除 conversation 时删除其绑定的 working memory。
- `scope=user` 行的 `session_id` 始终为空。

现有 `/api/memories` 列表、创建和删除接口保持兼容；新增 `sessionId` 是可选参数。

## 权限、工具和认证兼容

### 权限

Harness 的 `tool_call` hook 替代基础 Agent 的 `beforeToolCall`：

- 继续调用 `checkToolPermission`。
- bash 写操作在放行后、执行前继续创建文件快照。
- 被阻止的工具继续产生 core 标准错误 tool result。

Harness 的 `tool_result` hook 替代 `afterToolCall`，继续写工具审计日志。

### 工具

现有 `AgentTool` 对象直接传给 Harness：

- Ask：空工具集。
- Plan：只读工具。
- Craft：完整工具。
- Skill Creator：草稿专用工具。
- Windows 继续将 bash 替换为 `createWindowsShellTool`。
- MCP 工具继续由现有异步启动逻辑追加。

### 模型认证

Harness 的模型请求通过注入的 `Models` 执行。所有 Provider 注册必须保留当前 Keychain、环境变量和自定义 Provider 的认证行为。迁移测试必须验证 Harness 路径能从现有 Provider 配置完成请求选项解析；不得要求用户重新录入 Key。

## 自动化与子代理

- 自动化继续调用 `provider.attachPersistence()` 和 `provider.prompt()`。
- `call_subagent` 继续创建 SQLite 子 conversation，再通过 Provider 创建对应 core Session。
- 独立的 `task` 工具暂时保留其短生命周期基础 `Agent`，因为它不持久化会话，也不累积跨轮上下文；这不影响主会话 compaction。
- 删除父/子会话时只删除目标 conversation 对应的 JSONL，不级联删除其他会话。

## 删除与清理

删除会话的顺序为：

1. 中止并等待对应 Harness 空闲。
2. 删除 core JSONL Session。
3. 删除该会话的 working memory。
4. 删除 SQLite 附件关系、消息、产物关联和 conversation。
5. 清理 Provider 内存监听器和 SessionEntry。

若 JSONL 已经不存在，删除操作按幂等成功处理；其他 JSONL 删除错误必须返回失败，避免 SQLite 已删除而 core 文件残留且无法定位。

## 错误处理

- Session 初始化失败使用现有 Provider 错误事件链生成可见 assistant 错误。
- JSONL 解析失败不得回退到空上下文。
- Harness busy 时沿用当前行为：先 abort 当前任务，等待 idle 后再执行新 Prompt。
- SSE 监听器异常不得阻断其他监听器。
- SQLite 投影失败记录日志，但不回滚已经写入的 core Session。
- core Session 写入失败由 Harness 终止当前运行并生成失败状态。

## 测试策略

### 单元测试

- core Session 路径在 Windows/macOS 下正确生成。
- 新 conversation 创建同 ID JSONL Session。
- 已有 `core_session_path` 能重新打开。
- 旧 SQLite user/assistant 历史只导入一次。
- JSONL 缺失或 ID 不匹配时不创建空会话。
- Prompt 前后只在 core 阈值达到时调用 `harness.compact()`。
- 压缩失败时保留原 Session。
- 动态 system prompt 每轮读取最新长期记忆。
- working memory 只注入当前会话。
- 会话删除只清理目标 working memory。

### 集成测试

- Provider 发出的现有 AgentEvent 仍能被 application 队列和 SSE 消费。
- 工具调用与 toolResult 写入 JSONL，重新打开后仍在 `session.buildContext()` 中。
- 自动化无 SSE 时仍写 SQLite assistant/tool 投影。
- 子代理仍能完成并返回最后一条 assistant 回复。
- Ask/Plan/Craft 工具集合和权限行为不变。

### 回归与平台验证

- 运行全部 Deno 测试。
- 构建前端。
- 运行 macOS 本地桌面启动冒烟测试。
- 运行 Windows 路径和 shell 单元测试。
- 执行 Windows cross-target portable/MSI 构建可用的静态打包检查；若当前主机无法启动 Windows GUI，必须明确记录该限制，不得声称完成 Windows 运行时人工验证。

## 验收标准

- 前端不需要修改现有 Prompt、SSE、Abort 和 Confirm 协议。
- 新会话的完整上下文由 core JSONL 持久化。
- 新会话发生工具调用后，重启 Provider 仍能恢复 toolResult。
- 达到 core 阈值后生成 compaction entry，重建上下文包含摘要和近期消息。
- SQLite 消息列表与迁移前展示行为一致。
- 现有自动化、子代理、权限和工具审计测试通过。
- working memory 不再跨新会话自动注入。
- Windows/macOS 路径测试和项目构建通过。
