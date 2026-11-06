# 统一子代理运行时设计

## 背景

当前项目同时存在两套普通子代理实现：

- `call_subagent` 创建持久子会话，继承父模型与工作区，能传当前轮附件和 Skill，但固定以 `craft/default` 运行，并通过轮询数据库等待结束。
- `task` 创建临时 Pi `Agent`，优先固定 DeepSeek 模型，只提供只读工具，不传附件、Skill、权限或父子会话元数据。

两者同时进入 Craft 工具包，模型可任选其一，导致同一委派意图在模型、工具、权限、附件、持久化、取消和压缩方面行为不一致。项目已经为受管 CLI 连接器实现了更严格的隐藏子会话与 delegate 模式，但普通子代理尚未复用同一类宿主管理边界。

WorkBuddy 使用 AgentService、SessionManager、ToolManager 和 AgentTeam 管理 orchestrator/subagent，并通过 handoff summary、生命周期事件和 checkpoint 形成完整闭环。成熟 Agent 框架普遍区分 manager-as-tools 与 handoff：普通独立任务由主 Agent 保持控制并调用子代理工具；只有需要长期接管用户对话的专家才使用 handoff。

## 目标

- 普通子代理只有一个工具和一套运行协议。
- 主 Agent 始终拥有用户会话与最终回答责任，普通子代理作为受管工具运行。
- 子代理继承父模型、工作区、当前 Skill 和显式附件，且权限与工具只能缩减、不能扩大。
- 支持单任务和有限并行任务；取消可以传播到所有子会话。
- 子会话使用现有 Provider、Prompt Runtime、CoreSession、SQLite 与 compaction，不依赖系统 `pi` CLI。
- 子代理结果包含稳定状态、摘要和 `childSessionId`，并产生生命周期事件供客户端展示。
- 禁止递归创建普通子代理。

## 非目标

- 本次不引入第三方 `pi-subagent` / `pi-subagents` 运行时代码。
- 不启动独立 `pi` CLI 子进程，不增加 Agent Sidecar。
- 不实现 WorkBuddy 完整 Agent Teams、任意图编排或 peer-to-peer Agent 通信。
- 不实现长期接管用户对话的 handoff；专家会话继续使用现有 Expert 绑定体系。
- 不实现后台 Fleet 管理页、运行中 steering 或跨应用重启继续执行。
- 不允许普通子代理调用连接器凭据网关、专家/技能安装管理或再次创建子代理。

## 现状

### 工具装配

`getFullTools()` 同时装配 `call_subagent` 和 `createTaskTool(cwd)`。Prompt capability 只以 `call_subagent` 激活 `subagent.md`，但 `task` 也被模型看到，系统说明与实际工具集合不一致。

### 上下文

父轮通过 `AsyncLocalStorage<SessionContext>` 暴露 `sessionId`、当前轮附件、激活 Skill 和连接器上下文。缺少父权限、活动工具、turnId 和委派深度。

### 子会话

`call_subagent` 创建 category=`subagent` 的 Conversation；Prompt Runtime 当前将未知 category 归一为 `assistant`，所以子会话实际获得普通 Craft 全量工具，包括再次委派能力。

### 生命周期

父取消信号已传播到 `call_subagent` 子会话，但完成检测通过 500ms SQLite 轮询。IPC 文档已有 `subagent.lifecycle` 事件，当前生产链未实现。

### 压缩

持久子会话复用 `AgentHarness` 与 CoreSession，因而拥有独立 pre/post-turn compaction；临时 `task` Agent 没有持久化与压缩。

## 架构方案

```text
Main Agent
   -> subagent tool
   -> SubagentRuntime.delegate(request, parentContext, signal)
      -> validate role / concurrency / depth / attachments
      -> create child Conversation(category=subagent)
      -> build structured handoff prompt
      -> provider.prompt(child, subagent options)
      -> lifecycle events + durable messages
      -> structured SubagentResult
   -> Main Agent validates and synthesizes final response
```

普通子代理采用 manager-as-tools：子代理结果回到主 Agent，不改变当前用户会话控制权。

## 统一工具协议

工具名统一为 `subagent`。删除 `call_subagent` 与 `task` 两个公开工具。

首期支持两种互斥输入：

```ts
type SubagentToolInput =
  | {
      agent: SubagentRole;
      task: string;
      expectedOutput?: string;
      includeAttachments?: boolean;
    }
  | {
      tasks: Array<{
        agent: SubagentRole;
        task: string;
        expectedOutput?: string;
        includeAttachments?: boolean;
      }>;
    };
```

限制：

- 单次最多 8 个任务；
- 最大并发 4；
- 并行模式首期只允许只读角色；
- `task` 和 `expectedOutput` 使用明确长度预算；
- 输入必须恰好选择 single 或 parallel；
- `includeAttachments` 默认 false，只有显式为 true 才传当前轮全部附件。

不在首期加入 chain。链式任务可以由主 Agent根据前一步结构化结果再次调用，避免在工具内部创建第二套不可见上下文循环。

## 角色注册表

首期内置固定角色：

| Role | 用途 | 工具上限 |
|---|---|---|
| `scout` | 代码库与本地资料定位 | 文件只读 |
| `researcher` | Web/资料调研 | 文件只读 + Web |
| `reviewer` | 审阅变更、找风险 | 文件只读 |
| `verifier` | 静态验证与证据收集 | 文件只读 + 受保护 Shell |
| `worker` | 明确、隔离的实施任务 | 父 Agent Full Tools 的安全子集 |

角色由代码注册，包含 prompt fragment、允许能力、是否可并行和输出限制。首期不自动加载仓库内 `.agents` 或用户目录 Agent 定义，避免项目代码在未确认时影响运行权限。

## 子代理 Category 与工具策略

Prompt Runtime 新增正式 `subagent` category 和结构化 `SubagentRuntimeContext`。子代理工具从三者求交：

```text
childTools = parentActiveTools ∩ roleAllowedTools ∩ platformPolicyTools
```

无论角色如何，以下工具始终排除：

- `subagent`；
- 普通 `call_subagent` / `task` 旧名；
- 专家与技能安装/草稿管理工具；
- Connector delegate 与 `connector_cli_execute`；
- 交互式 `ask_user_question`；
- `goal_complete` 和父会话任务状态工具。

子代理 category 使用独立 prompt pack，只说明角色、委派目标、边界和输出协议，不加载父会话 Expert 绑定。

## 权限继承

`SessionContext` 增加：

```ts
parentTurnId: string;
permission: PermLevel;
activeToolNames: readonly string[];
delegationDepth: number;
```

子代理使用父权限作为硬上限，不使用固定 `default`：

```text
childPermission = parentPermission
```

角色工具求交已经进一步缩减能力。现有 Permission Policy、protected path、mutation lock 和 Windows Shell 审计继续在子会话执行边界生效。`delegationDepth >= 1` 时不注册 `subagent` 工具，运行时同时拒绝再次委派。

## 结构化交接上下文

`SubagentRuntime` 构造确定性的 handoff block：

```ts
interface SubagentHandoff {
  parentSessionId: string;
  parentTurnId: string;
  role: SubagentRole;
  task: string;
  expectedOutput?: string;
  workspace: { cwd: string; protected: boolean };
  attachmentIds: string[];
  activeSkillName?: string;
}
```

只传当前任务必要信息，不复制父会话全部历史，不直接注入父 CoreSession 历史，也不自动传长期记忆。主 Agent已有分析必须写入 `task`；系统负责补充工作区、权限、附件和 Skill 等不可由自然语言可靠表达的运行时事实。

## 附件

- 只有 `includeAttachments: true` 时，从父 `SessionContext.attachments` 选择当前轮全部附件。
- 必须存在附件 ID；无 ID 的临时上下文拒绝委派。
- 子用户消息通过 `appendMessageWithAttachments` 建立独立关联，不重复复制文件。
- 子 Prompt继续接收已有解析内容与受管路径。
- 历史附件不自动继承；未来如需历史附件选择，应单独增加可验证的 attachmentIds UI/协议。
- 子代理生成的文件首期通过现有 `present_files`/artifact 能力形成受管产物；结构化结果返回 artifact 标识，若底层暂时只能提供路径则必须位于父工作区且经过路径策略验证。

## 会话与执行

- 每个普通委派创建一个 per-invocation 子会话，记录 `parent_id`。
- 继承父模型与 workspace_id。
- 使用 `provider.attachPersistence()` 保证无前端监听时仍落库。
- 使用 Provider 完成事件或 `provider.prompt()` 的完成语义等待，不轮询 SQLite。
- 子会话完成后保留并默认从普通会话列表隐藏，可从父任务详情查看。
- 父取消时取消所有活动子会话并等待退出。
- 并行任务使用固定并发池，不调用无界 `Promise.all`。

## 返回协议

```ts
interface SubagentResult {
  runId: string;
  childSessionId: string;
  agent: SubagentRole;
  status: "completed" | "failed" | "cancelled";
  summary: string;
  artifactIds: string[];
  error?: string;
}
```

并行调用返回 `results[]` 和成功/失败计数。返回给主模型的文本每个任务限制 50 KiB；完整子会话保留在 CoreSession/SQLite，不创建临时明文输出文件。

## 生命周期事件

复用并落实已有 `subagent.lifecycle` 协议：

```ts
{
  runId,
  parentSessionId,
  childSessionId,
  agent,
  status: "running" | "completed" | "failed" | "cancelled",
  startedAt,
  completedAt?,
  summary?,
  error?
}
```

事件从 Provider 当前父会话监听链发送。首期前端复用工具调用卡片展示状态，不建立独立 Fleet 页面；事件仍持久化必要的 run metadata，避免 UI刷新后完全丢失状态。

## 压缩

- 每个持久子会话继续使用现有 CoreSession pre/post-turn compaction。
- 父会话只接收子代理的有界结构化结果，不导入子会话完整历史。
- handoff block 必须把任务目标、附件名称和验收要求作为当前子轮输入写入 CoreSession，使压缩后仍可被摘要。
- 本次不修改 Pi Core 的压缩算法；增加契约检查，确认压缩不会改变父子会话关联和 SQLite 附件记录。

## 数据与清理

- `conversations.parent_id` 继续作为父子关系。
- category 正式使用 `subagent`，普通会话列表默认排除 `subagent` 和 `connector-agent`。
- 删除父会话时沿用会话清理服务清理普通子会话 CoreSession、消息和未再引用数据。
- 本次不增加数据库 migration；若生命周期 run metadata 现有 schema 无处存放，则只通过事件和 Conversation 状态投影，不临时增加半成品表。

## 影响范围

- 删除或停止导出 `src/agent/tools/task.ts` 的公开工具。
- 将 `src/agent/tools/subagent.ts` 改为统一 runtime/tool，必要时拆分到 `src/agent/subagents/`。
- `src/agent/tools/index.ts`：只装配统一 `subagent`。
- `src/infra/context.ts`：父上下文增加权限、工具、turn 与深度。
- `src/agent/provider.ts`：传递结构化子代理运行上下文和生命周期事件。
- `src/agent/prompt-runtime/*`：新增 subagent category、role context、工具求交与 prompt pack。
- `resources/prompts/v2/categories/subagent.md`、`capabilities/subagent.md`。
- `src/domains/session/node/store.ts` 与清理服务：隐藏、父子清理和结果读取。
- `src/electron/*`、前端事件 Store/工具卡片：消费生命周期事件。
- `docs/01-Agent框架实现逆向.md`、`docs/03-技术架构设计.md`、`docs/15-Pi-Agent与Electron前端IPC交互协议.md`。

## 风险

- Worker 子代理与父代理修改同一文件可能冲突；首期禁止并行 worker，并继续使用全局 mutation lock。
- Prompt Runtime 新 category 若遗漏 pack 或 tool policy 会使子会话初始化失败，必须由契约检查覆盖。
- 生命周期事件与无前端监听持久化同时存在时，必须避免 assistant 消息重复落库。
- 父取消、子失败和 Provider 初始化失败必须各自只落一次终态。
- 子结果过长会污染父上下文，必须在工具结果边界截断而不是事后依赖 compaction。
- 当前仓库已有静态类型检查基线错误，验证时必须区分既有问题与新增问题。

## 验证方式

遵守仓库规则，默认只执行 TypeScript 类型检查、JavaScript 语法检查和 `git diff --check`，不自动运行测试。

需要新增但不自动执行的回归测试覆盖：

- `task`、`call_subagent` 不再进入工具列表，只有 `subagent`；
- ask/plan 不提供普通子代理，craft 提供；
- 子权限等于父权限且工具只能缩减；
- 子代理不能递归；
- 当前轮附件只有显式选择时传递并正确关联子消息；
- 父模型、workspace 与 Skill继承；
- 单任务、并行只读任务、部分失败与结果顺序；
- 父取消传播到全部子任务；
- 子会话不轮询 SQLite 等待；
- 子会话独立 compaction，父会话只收到有界结果；
- macOS 与 Windows 使用同一运行协议，Windows 不创建控制台子进程。

若用户授权运行测试，再执行相关定向测试；完整打包验收需分别在 macOS 和 Windows 检查附件、取消、生命周期 UI 与长会话压缩。

## 完成定义

生产工具列表中只有一个普通子代理工具；所有普通委派都由应用内 `SubagentRuntime` 创建受管子会话，继承父模型/工作区/权限上限，显式传递当前轮附件，禁止递归，支持最多四并发的只读任务，并向父 Agent返回有界结构化结果。父取消、子失败、持久化和压缩均有单一明确语义，macOS/Windows 不依赖外部 `pi` CLI。
