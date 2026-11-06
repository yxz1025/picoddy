# Prompt Runtime v2 架构设计

**2026-10-26 工具发现更新：** 移除小模型按用户文本关键词删除工具的二次裁剪；保留模式/类别权限过滤及现有 Pi tool_search、Codemode、exposure 机制。专家与显式技能配置不变，不统一强制延迟加载。详见 [设计](../designs/2026-10-26-native-tool-discovery-design.md)。

**2026-10-26 更新：** 需求资产仅注入版本元数据与完整路径，移除关键词筛选和自动正文摘录。复用 Pi 原生工具按需检索、分段读取及输出截断；通过 `context_with_system` 对当前实际历史中的相同资产元数据精确去重，原始会话记录不变，压缩/回滚后重新判定。详见 [资产上下文实现](../designs/2026-10-26-requirement-asset-context-design.md)。尚未运行验证。

**2026-10-23 更新：** 编码耗时优化复用 Pi 原生 Qwen 能力与思考级别，精确去重提示片段和引用，当时需求资产采用限额版本片段（已由 2026-10-26 的按需读取方案替代）。继续由 Pi 管理压缩及模型重试，未改模型真实窗口。新增不含正文的请求/工具/重试/压缩计时；直接 npm 安装使用有界默认预算并阻止无依据的重复失败安装。详见 [实施设计与限制](../designs/2026-10-23-agent-coding-latency-design.md)。本轮仅静态检查，运行验证待做。

**状态：** 已实施
**日期：** 2026-08-14
**范围：** PiCoddy-a 的 Prompt、模式、工具、权限、设置、记忆、Expert、Skill、MCP 与单轮调用链

**2026-09-20 更新：** 当前 AgentSession 路径的请求 Token 近似估算仅作诊断，
不触发应用侧手动压缩或硬拦截；Pi 原生负责自动压缩和溢出恢复。
连续会话及专家/显式技能绑定保留模式允许工具。上下文对完全相同的记忆和引用去重，
并带入当前会话最近 8 个成果路径。参见 `../designs/2026-09-20-context-preflight-optimization-design.md`。

## 1. 背景

当前 Prompt 运行时分散在多个位置：

- `src/agent/engine.ts` 维护静态 `SYSTEM_PROMPT`、平台字符串替换、设置、记忆和 Skill 拼接。
- `src/agent/provider.ts` 同时解析 Mode、Category、Expert、Skill、MCP、Slash Command、工具和 Harness 执行。
- `application.electron.ts` 在 HTTP 传输层读取附件、Connector 和 `@file` 内容并拼接用户 Prompt。
- `src/agent/mcp.ts` 允许从 Expert Prompt 文本推断并连接 MCP。
- Expert、Skill、Memory 和 Mode 都以字符串 addon 进入 System Prompt，但实际工具和权限由其他模块决定。

这导致 Prompt 对能力的描述与真实运行时能力没有共同的权威来源，也无法回答“某一轮模型调用究竟使用了哪些输入、规则、工具和资源”。

本设计参考 `docs/workbuddy-prompt-architecture-analysis.md` 以及 `/private/tmp/wb-builtin-full` 中的 WorkBuddy 实现，但不复制其旧 `.tpl` 与新 Addon Plugin 并存的双轨状态。

## 2. 架构结论

采用单一的 Prompt Runtime：

```text
PromptRequest
  -> SessionIntentResolver
  -> TurnIntentResolver
  -> RuntimeProfileResolver
  -> PromptContextAssembler
  -> PromptPackComposer
  -> PromptEnvelopeBuilder
  -> PromptAwareHarness
  -> AgentHarness
```

每次模型调用只产生一个不可变的 `PromptContextSnapshot`。System Prompt、User Prompt、Tools、Resources 和 Permission Policy 必须由同一个 `RuntimeProfile` 与 Snapshot 共同派生；工具可见性与执行授权是正交维度。

不保留旧 Prompt Assembly，不增加兼容层、fallback、运行时 feature flag 或双轨选择。

## 3. 设计原则

1. **单一权威。** 一轮调用只有一个 Runtime Profile 和一个 Snapshot。
2. **能力一致。** Prompt 描述的工具必须等于 Harness 实际激活的工具。
3. **能力与权限正交。** Mode、Category 和用户显式 MCP 选择决定可见工具；Permission 只控制工具调用时的执行授权。Expert 和 Skill 既不能增加工具，也不能提升权限。
4. **Expert 正交。** Expert 是会话级领域覆盖层，不是 Mode，不创建第二个 Agent。
5. **显式资源。** Skill、Prompt Template 和 MCP 通过结构化 Resource/Selection 注入，不从自然语言推断。
6. **来源可追踪。** 动态上下文必须记录来源、revision、hash、字节数和裁剪状态。
7. **采集只读。** Context Source 不得写文件、安装资源、连接 MCP 或修改设置。
8. **失败可见。** 必需来源失败时终止调用；可选来源失败时产生 diagnostic，禁止静默吞错。
9. **无通用模板语言。** 固定规则使用 Registry 中的静态 Markdown Fragment；动态内容只能由类型化 Block Renderer 序列化。
10. **无向后兼容。** 新链切换后直接删除旧字符串拼接和旧语义。

## 4. 不采用的 WorkBuddy 设计

以下内容不进入 PiCoddy-a：

- `expert` 第四 Mode。
- normal/ask/expert × code/work/design 整页模板矩阵。
- Plan 使用 Craft Prompt、再单独改变工具和权限。
- 模板文件缺失时自动 fallback。
- `Record<string, string>` 无类型变量容器。
- Nunjucks `autoescape: false` 直接注入任意内容。
- Collector 内初始化身份文件等写副作用。
- 同一轮多次执行 Collector。
- 由 `expertId` 隐式改变 Template Family。
- 旧 System Prompt 与新 Plugin Prompt 双轨并存。

## 5. 核心领域模型

### 5.1 SessionIntent

`SessionIntent` 是会话已持久化事实与调用方显式输入的结构化投影，不包含 Prompt 字符串。

```ts
export type InteractionMode = "ask" | "plan" | "craft";
export type SessionCategory = "assistant" | "skill_creator" | "expert_creator";
export type ExpertOperation = "create" | "edit";

export interface SessionIntent {
  sessionId: string;
  modelProvider: string;
  modelId: string;
  category: SessionCategory;
  interactionMode: InteractionMode;
  permission: PermLevel;
  workspace: WorkspaceRef;
  expertBinding?: ExpertBindingRef;
  expertOperation?: ExpertOperation;
  selectedSkillNames: string[];
  selectedMcpTools: AgentTool[];
}
```

Mode 和 Permission 继续作为每轮显式输入，不增加数据库 migration。Expert、Category、Model 和 Workspace 继续从现有 Conversation 数据读取。

### 5.2 TurnIntent

```ts
export interface TurnIntent {
  turnId: string;
  rawText: string;
  invocation?:
    | { kind: "skill"; name: string; instructions: string }
    | { kind: "prompt_template"; name: string; args: string[] };
  attachments: AttachmentContextItem[];
  fileReferences: FileReferenceContext[];
  connectorContext: ConnectorContextItem[];
  referenceExpertId?: string;
  selectedExpertSkills: string[];
}
```

附件、文件引用、Connector 信息和专家创建时的参考专家必须保持结构化，直到 `TurnContextSource` 统一序列化。`referenceExpertId` 对应现有 `selectedExpertId`，与会话绑定的 `activeExpertId` 完全不同，不得进入 `ExpertSource`。

图片附件除结构化元数据外还有独立的模型调用载荷：PNG、JPEG、GIF 和 WebP 受管附件在 Provider 调用 `AgentSession.prompt()` 前通过 Pi 图片处理链转换为 `ImageContent[]`，并使用 `PromptOptions.images` 随同本轮 User Prompt 直接提交。该过程不依赖 Mode 是否暴露 `read` 工具，因此 Ask、Plan 和 Craft 的图片输入语义一致。base64 图片数据不写入 `TurnContext`、`PromptEnvelope`、Manifest 或业务数据库；Pi 原生会话按照 SDK 的多模态消息语义保存 image block。路径必须精确匹配受管附件目录，读取或处理失败时终止本轮，禁止退化为仅路径提示后继续回答。

### 5.3 RuntimeProfile

```ts
export interface RuntimeProfile {
  session: SessionIntent;
  mode: ModeProfile;
  category: CategoryProfile;
  expert?: ExpertRuntimeProfile;
  tools: AgentTool[];
  activeToolNames: string[];
  resources: AgentHarnessResources;
  permissionPolicy: ResolvedPermissionPolicy;
  structuralHash: string;
  diagnostics: PromptDiagnostic[];
}
```

### 5.4 PromptContextSnapshot

```ts
export interface PromptContextSnapshot {
  schemaVersion: 2;
  snapshotId: string;
  sessionId: string;
  turnId: string;
  createdAt: string;
  environment: EnvironmentContext;
  workspace: WorkspaceContext;
  settings: PromptSettingsContext;
  memory: MemoryContext;
  skills: SkillContext;
  expert?: ExpertContext;
  capabilities: CapabilityContext;
  turn: TurnContext;
  sourceRevisions: Record<string, SourceRevision>;
  diagnostics: PromptDiagnostic[];
}
```

### 5.5 PromptEnvelope

```ts
export interface PromptEnvelope {
  snapshotId: string;
  systemPrompt: string;
  userPrompt: string;
  tools: AgentTool[];
  activeToolNames: string[];
  resources: AgentHarnessResources;
  permissionPolicy: ResolvedPermissionPolicy;
  invocation?: TurnIntent["invocation"];
  manifest: PromptManifest;
}
```

## 6. Mode、Category 与能力矩阵

工具可见性与执行授权使用两条独立链路：

```text
availableTools = resolveTools(category, mode, explicitMcpSelection)
executionDecision = permissionPolicy.check(toolCall, platform, permissionLevel)
```

`Category` 存在专用 Tool Pack 时覆盖 Assistant 的 Mode Tool Pack；否则由 Mode 决定。Permission 不参与工具数组求交，也不影响 Manifest 中的 `activeTools`。同一 Mode/Category/MCP 输入在 L1/L2/L3 下必须得到相同的工具列表，但调用结果可因 Permission hooks、平台沙箱和危险命令规则不同而不同。

当前平台语义作为本次重构的兼容基线：macOS 在 sandbox 检查后 L2/L3 基本直通；Windows 的 L2 对 Shell、写入和控制类工具确认，L3 只对危险调用确认。本次 Prompt Runtime 不调整该安全语义；若要统一平台行为，必须单独设计和评审。

### 6.1 Mode

| Mode | Prompt 行为 | 工具 | 写操作 |
|---|---|---|---|
| `ask` | 纯回答、解释、分析 | 无 | 禁止 |
| `plan` | 读取、调研、设计、风险分析 | `getReadOnlyTools()` | 禁止 |
| `craft` | 执行、验证、交付 | `getFullTools()` | 由权限策略决定 |

Mode Policy 同时返回 Prompt Pack ID 和基础 Tool Capability，不允许 Prompt 与工具分别判断。Permission Policy 不在这里过滤工具。

### 6.2 Category

| Category | 允许 Mode | Tool Pack | Skill Invocation |
|---|---|---|---|
| `assistant` | ask/plan/craft | Mode 决定 | 用户显式 Skill/Template |
| `skill_creator` | craft | `getSkillCreatorTools()` | 强制 `skill-creator` |
| `expert_creator/create` | craft | Full + Expert Draft | 强制 `expert-manager` |
| `expert_creator/edit` | craft | Readonly + Expert Draft | 强制 `expert-manager` |

非法组合返回 `CATEGORY_MODE_NOT_ALLOWED`，不再隐式覆盖 Mode。

### 6.3 Expert

Expert 只允许绑定到 `assistant` Category。其 Profile 可以提供 Persona、Workflow、Risk Notes、Skill Resources 和 Capability Hints，但不能直接修改工具、权限或 MCP。

## 7. 静态 Fragment、Block Renderer 和 Prompt Pack

Prompt 文件按职责拆分，不按所有组合复制整页模板：

```text
resources/prompts/v2/
  core/
    product-identity.md
    instruction-priority.md
    tool-use.md
    file-safety.md
    agent-loop.md
    result-presentation.md
  modes/
    ask.md
    plan.md
    craft.md
  categories/
    assistant.md
    skill-creator.md
    expert-creator.md
    expert-editor.md
  capabilities/
    memory.md
    skills.md
    mcp.md
    visualization.md
    computer-use.md
```

固定规则全部是无变量的 Markdown Fragment。项目不引入 Nunjucks，也不实现 `{{variable}}`、表达式、循环、include 或任意模板求值。动态 Environment、Workspace、Settings、Memory、Expert、Capability 和 Turn 数据由对应的类型化 Renderer 直接从领域类型生成。

每个 Fragment 是静态 Registry 项：

```ts
export interface PromptPackDefinition {
  id: string;
  surface: "system" | "turn";
  order: number;
  fragmentPath: string;
}
```

Registry 和 Renderer 必须：

- 拒绝 Registry 外路径。
- 拒绝静态 Fragment 中的模板占位符。
- 动态字段只能进入对应的类型化 Renderer，不接受 `Record<string, string>`。
- JSON 载荷使用标准序列化；XML 属性只允许固定名称并执行转义。
- 输出每个片段的 hash 和字节数。
- `system` 与 `turn` 分别按 `(order, id)` 排序；同一 surface 内 `order` 必须唯一，跨 surface 不比较顺序。

### 7.1 现有 SYSTEM_PROMPT 迁移矩阵

| 现有 Section | v2 归属 | 迁移规则 |
|---|---|---|
| `identity` | `core/product-identity.md` | 只保留固定产品身份；cwd、平台和模型进入动态 Source |
| `tools` | AgentTool schemas + `CapabilitySource` | 删除手写逐工具清单，不复制 tool description |
| `computer_use` | `capabilities/computer-use.md` | 仅实际激活 Computer Use 工具时加载 |
| `agent_loop` | `core/agent-loop.md` | 完整保留感知、执行、验证和结束条件 |
| `tool_usage_policy` | `core/tool-use.md` | 保留通用编排规则，工具参数约束由 schema 负责 |
| `file_safety` | `core/file-safety.md` | 保留读取、写入、覆盖和保护路径边界 |
| `working_modes` | `modes/{ask,plan,craft}.md` | 只加载当前 Mode，不再列出全部 Mode |
| `memory` | `capabilities/memory.md` | 仅 Memory 上下文或工具实际可用时加载 |
| `result_presentation` | `core/result-presentation.md` | 通用交付规则；工具专属说明按能力条件加载 |
| `visualization` | `capabilities/visualization.md` | 仅实际激活可视化工具时加载，保留 viewBox、大小等硬约束 |

现有整段字符串替换全部删除：桌面路径由 `WorkspaceSource` 提供；平台、Shell 和快捷键由 `EnvironmentSource` 提供；工具差异从实际 `AgentTool` 集合派生。

## 8. Context Source

```ts
export interface PromptContextSource<K extends PromptContextKey> {
  readonly id: string;
  readonly required: boolean;
  collect(input: PromptSourceInput): Promise<PromptSourceResult<K>>;
}
```

固定顺序：

1. `EnvironmentSource`
2. `WorkspaceSource`
3. `SettingsSource`
4. `MemorySource`
5. `SkillSource`
6. `ExpertSource`
7. `CapabilitySource`
8. `TurnContextSource`

每个 Source 只能执行一次。Assembler 对结果做 `Object.freeze()`，后续阶段不得修改 Snapshot。

### 8.1 EnvironmentSource

提供：平台、系统版本、日期、默认 shell、模型名称、产品名称。平台差异由变量渲染，不再对完整 Prompt 做字符串替换。

### 8.2 WorkspaceSource

使用 `resolveConversationSessionRoot()` 的结果，提供真实 cwd、artifact 目录、protected workspace、Git 状态。Workspace 解析失败属于必需来源失败。

### 8.3 SettingsSource

首期只读取当前已经存在且有消费者的设置：

- `agent_system_prompt`
- 当前产品语言/平台默认语言

不预先创建 Tone、Identity Onboarding 等当前产品没有入口的抽象。以后真正增加产品功能时再扩展类型。

设置读取失败产生 diagnostic；`agent_system_prompt` 最大 8,000 字符，作为 `user-config` 信任级别注入。超过上限不截断，直接以 `PROMPT_CONTEXT_LIMIT_EXCEEDED` 在模型调用前失败，避免用户规则被静默改变。

### 8.4 Identity 决策

PiCoddy-a 当前没有 WorkBuddy 的 SOUL/IDENTITY/USER/BOOTSTRAP 产品入口，因此本次不预建 Identity Source、身份文件初始化器或 onboarding 状态机。产品身份由 `core/product-identity.md` 提供；用户偏好由现有 Settings 与 User Memory 提供。这样保留真实需求边界，也避免 Collector 读取时偷偷创建文件。

未来若产品明确增加可编辑人格和 onboarding，应单独设计写侧 `IdentityWorkspaceInitializer` 与只读 `IdentitySource`，不能把写副作用塞进 Context Assembler。

### 8.5 MemorySource

只自动注入：

- 当前 session 的 working memory，最多 8,000 字符。
- user memory，最多 4,000 字符。

按完整 Memory 条目裁剪，不在条目中间切断。排序规则保留各 scope 的现有业务语义并增加稳定次序：working memory 使用 `createdAt DESC, id ASC`，user memory 使用 `updatedAt DESC, id ASC`。每层记录 included/dropped 数量和 hash。

8,000/4,000 是相对现状的有意行为变化：现状 working memory 无上限、user memory 上限为 10,000 字符。被预算排除的完整条目产生只包含数量和预算的 diagnostic，不记录正文。

Memory Tool 继续负责显式检索和写入；Memory Prompt 只描述实际存在的 memory tools。

### 8.6 SkillSource

`skills.ts` 改为返回 `AgentHarnessResources.skills`。`SkillSource` 使用 Pi Core 的 `formatSkillsForSystemPrompt(resources.skills)` 生成规范化可用 Skill 列表；Harness 负责 Skill 的显式调用和单轮资源快照，不假设 Harness 会自动修改自定义 System Prompt。Skill 正文不全量注入。

普通 Skill 通过 `harness.skill()` 调用。Pi Core 的 `promptFromTemplate(name, args)` 不能附加本轮附件、Connector 等 TurnPayload，因此 Slash Prompt Template 不直接调用该方法：Runtime 从同一 Resources 快照解析模板，使用 Pi Core `formatPromptTemplateInvocation()` 展开参数，再与 TurnPayload 合成唯一 User Prompt，最后调用 `harness.prompt()`。不存在“无上下文走 promptFromTemplate、有上下文走 prompt”的双轨分支。

### 8.7 ExpertSource

复用现有 Registry、Prompt Resolver、Installed Catalog 和 Binding Service。`runtime_profile.ts` 不再返回可直接拼接的大字符串，而是返回结构化 Persona、Workflow、Skills 和 Hints。

Expert 动态内容使用 `controlled-extension` Block。核心 Prompt 明确声明其优先级低于 Core Safety、用户当前请求和运行时 Permission。

### 8.8 CapabilitySource

从 `RuntimeProfile.tools` 生成高层能力摘要，例如文件修改、Computer Use、Memory 或 Visualization 是否可用。禁止维护第二份逐工具清单，也不把 `name + label + description` 复制进 System Prompt；详细工具语义和参数的唯一权威是 AgentTool schema。

迁移前必须审计所有 Mode、Category、macOS/Windows Tool Pack：每个可激活 AgentTool 都必须有非空且准确的 `label`、`description` 和参数 schema。质量问题修复在工具注册层，不在 Prompt 中增加补充文案。

### 8.9 TurnContextSource

负责原始用户请求、附件、`@file`、Connector、`referenceExpertId` 和 selected expert skills 等本轮上下文。传输层只提供结构化 DTO，不再负责 Prompt 文本。

本地文件默认只注入路径和元数据；只有附件解析流程已经显式产生内容时才注入内容。最终 User Prompt 是一个标准 JSON 序列化的载荷，不使用字符串拼接：

```xml
<turn_payload encoding="json">{"query":"...","attachments":[],"referenceExpertId":null}</turn_payload>
```

`query` 和所有动态文本都作为 JSON 字符串值编码，并把 `<`、`>`、`&` 转成 JSON Unicode escape；外围标签由固定 Renderer 生成。因此输入中的 `</turn_payload>` 不能闭合边界。System Surface 只承载规则和会话上下文；Turn Surface 只进入当前 User Prompt，绝不拼入 System Prompt。Skill 调用时同一 TurnPayload 进入 `additionalInstructions`；PromptTemplate 参数在 Runtime 内先展开为模板文本，再与 TurnPayload 合成一个 User Prompt。

## 9. Skill 与 Expert Skill

### 9.1 普通 Skill

```text
Skill Catalog
  -> SkillResourceAdapter
  -> harness.setResources()
  -> harness.skill(name, instructions)
```

Provider 不再维护 `/brainstorm`、`/plan`、`/implement`、`/goal` 等硬编码字符串。命令必须对应真实 Skill 或 Prompt Template；不存在时返回 `INVOCATION_NOT_FOUND`。

当前 Builtin Resources 中没有名为 `plan` 的 Skill 或 PromptTemplate，因此切换后 `/plan` 明确返回 `INVOCATION_NOT_FOUND`；它不能作为 Mode 切换别名。Plan Mode 只能由请求中的 `interactionMode` 选择。未来如果需要同名 slash command，必须注册一等 PromptTemplate，不能恢复 Provider 字符串特判。

### 9.2 Creator Category

- `skill_creator` 将用户文本交给 `harness.skill("skill-creator", text)`。
- `expert_creator` 将结构化创建上下文和用户文本交给 `harness.skill("expert-manager", text)`。
- `selectedSkillNames` 在后端重新解析，前端名称不是信任边界。

### 9.3 Expert 包内 Skill

Expert Skill 使用内部 namespace：`expert/<expertId>/<skillName>`。Manifest 增加：

```ts
export interface ExpertSkillActivation {
  name: string;
  activation: "always" | "on-demand";
}
```

- `always` 内容进入 Expert Pack，受 Expert 总预算约束。
- `on-demand` 注册为 Harness Skill Resource。

包 schema 直接升为 `schemaVersion: 2`。旧包不兼容、不自动转换、不 fallback；校验器返回 `EXPERT_SCHEMA_VERSION_UNSUPPORTED`。不支持的包不进入可选择 Expert 列表，Installed Catalog 返回不含本地绝对路径的结构化 diagnostic，前端提示重新创建或重新安装。若已有绑定在运行时失效，对外仍返回 `EXPERT_INITIALIZATION_FAILED`，内部 cause 保留版本错误码。

## 10. MCP

唯一合法链路：

```text
用户显式 Connector 选择
  -> 已连接状态校验
  -> MCP Tool 实例
  -> Category 专用 Tool Pack 或 Mode Tool Pack 校验
  -> RuntimeProfile.tools
```

Permission 不参与 MCP Tool 可见性计算；MCP 调用与内建工具一样，在执行阶段经过同一 Permission Policy。删除 `connectMcpServersReferencedByPrompt()`。Expert Prompt、Skill 正文和用户文件中出现 MCP 名称均不得产生连接行为。

## 11. Harness 集成

当前 `AgentHarness` 在 `prompt()`、`skill()` 或 `promptFromTemplate()` 开始时快照 systemPrompt、activeTools 和 resources。项目新增 `PromptAwareHarness`，保证在同一 session queue 内按以下顺序执行：

```text
prepare envelope
  -> setTools(envelope.tools)
  -> setResources(envelope.resources)
  -> expose envelope.systemPrompt to systemPrompt callback
  -> prompt / skill
  -> clear active envelope in finally
```

禁止多个并发 turn 共用可变 `activeEnvelope`；现有 `promptQueues` 继续作为 session 串行边界。

本设计已针对当前锁定的 `@earendil-works/pi-agent-core` 验证以下能力：每轮 `systemPrompt` callback、`setTools()`、`setResources()`、`skill()`、`formatPromptTemplateInvocation()`，以及 turn state 对 active tools/resources 的快照。`promptFromTemplate()` 的存在也纳入契约测试，但因它不能附加 TurnPayload，不作为 v2 Template 执行入口。依赖升级后任一所需契约失效都必须阻止升级。`PromptAwareHarness` 只做事务式设置和调用，不复制 Pi Core 的会话或资源实现。

## 12. 完整调用链

### 12.1 普通 Turn

```text
HTTP /api/prompt
  -> DTO 校验
  -> attachment/file/connector 引用解析为结构化输入
  -> provider.prompt
  -> session queue
  -> SessionIntentResolver
  -> TurnIntentResolver
  -> RuntimeProfileResolver
  -> ContextAssembler
  -> PackComposer
  -> EnvelopeBuilder
  -> PromptAwareHarness.execute
  -> AgentHarness
  -> permission hooks
  -> core session commit
```

### 12.2 Mode 切换

Mode 属于本轮显式意图。下一轮重新生成 Profile、Tools 和 Prompt Pack。切换后的第一轮加入 `mode-transition` 片段，但不复用旧 Mode Prompt。

### 12.3 Expert Turn

```text
Conversation expert binding
  -> ExpertRegistry
  -> ExpertPromptResolver
  -> ExpertRuntimeProfileBuilder
  -> ExpertSource
  -> Expert Pack + namespaced Skill Resources
  -> ToolPolicy 忽略 Expert 扩权声明
```

### 12.4 Creator Turn

Creator Category 先完成 Category/Tool/Permission 解析，再选择强制 Skill Invocation。Creator Skill 不常驻 System Prompt。

### 12.5 Resume / Compaction

Resume 读取 Conversation、Expert、Workspace 和 Model 重新构造 RuntimeProfile。Mode/Permission 由下一轮显式请求提供。Compaction 只压缩会话历史，不接收、缓存或重放 `PromptEnvelope`。

每轮顺序固定为：

```text
ensure session
  -> pre-turn compaction
  -> resolve RuntimeProfile
  -> collect Snapshot
  -> compose Envelope
  -> execute model turn
  -> commit turn
  -> post-turn compaction
```

pre-turn compaction 完成后才构造本轮 Envelope，保证其来源是压缩后的当前状态。post-turn compaction 不修改已完成 Envelope；下一轮重新生成 Mode、Workspace、Expert、Memory、Resources 和 Capability，不依赖旧 Prompt 字符串恢复能力。现有 `compactIfNeeded()`/`harness.compact()` 继续负责历史摘要，只有契约测试证明存在接口缺口时才修改 compaction 模块。

## 13. Prompt Manifest

```ts
export interface PromptManifest {
  schemaVersion: 2;
  snapshotId: string;
  contentHash: string;
  route: {
    mode: InteractionMode;
    category: SessionCategory;
    expertId?: string;
  };
  fragments: PromptFragmentManifest[];
  sources: PromptSourceManifest[];
  activeTools: string[];
  skillNames: string[];
  promptTemplateNames: string[];
  permissionSummary: string;
  diagnostics: PromptDiagnostic[];
}
```

`snapshotId` 是每轮随机 UUID，不参与稳定 hash。`contentHash` 是 canonical JSON 的 SHA-256，只覆盖确定性内容：schemaVersion、route、structuralHash、有序 Fragment ID/内容 hash、Source ID/revision/内容 hash/size/truncated、按 Policy 顺序排列的 active tool names、Skill/PromptTemplate names 和 Permission 摘要。`createdAt`、snapshotId、Source 耗时、diagnostic 时间和随机值必须排除。

首期 Manifest 通过结构化日志和测试暴露，不新增数据库表。不得在日志中记录完整记忆、用户自定义 Prompt、附件内容、Expert 正文或 Skill 正文。

## 14. 错误模型

| 错误码 | 条件 | 行为 |
|---|---|---|
| `CATEGORY_MODE_NOT_ALLOWED` | Creator 使用非 Craft | 调用前失败 |
| `PROMPT_SOURCE_FAILED` | 必需 Source 失败 | 调用前失败 |
| `PROMPT_FRAGMENT_INVALID` | Fragment 未注册、缺失、含模板占位符或顺序冲突 | 调用前失败 |
| `PROMPT_CONTEXT_LIMIT_EXCEEDED` | 不允许裁剪的设置/扩展超过预算 | 调用前失败 |
| `INVOCATION_NOT_FOUND` | Skill/Template 不存在 | 调用前失败 |
| `EXPERT_INITIALIZATION_FAILED` | 绑定 Expert 无法加载 | 保留现有错误语义 |
| `EXPERT_SCHEMA_VERSION_UNSUPPORTED` | 已安装 Expert 包版本不是 v2 | Catalog diagnostic；绑定失效时作为 Expert 初始化 cause |
| `MCP_SELECTION_INVALID` | MCP 工具未显式授权 | 调用前失败 |

普通 Prompt 不返回 `PROMPT_RUNTIME_BUSY`。同 session 并发继续通过现有 `promptQueues` 串行化；新的用户 turn 对活动 turn 的 abort/排队语义保持不变。Envelope 重入只能作为内部 invariant failure，不能改变 Automation 或用户消息的业务排队行为。Expert profile reload 等管理操作继续使用其已有的专用 busy 错误。

## 15. 文件所有权

### 新建

```text
src/agent/prompt-runtime/
  types.ts
  diagnostics.ts
  session-intent.ts
  turn-intent.ts
  mode-policy.ts
  category-policy.ts
  tool-policy.ts
  permission-policy.ts
  runtime-profile.ts
  context-assembler.ts
  prompt-packs.ts
  fragment-loader.ts
  block-renderers.ts
  boundary-encoding.ts
  envelope-builder.ts
  prompt-aware-harness.ts
  manifest.ts
  sources/
    environment.ts
    workspace.ts
    settings.ts
    memory.ts
    skills.ts
    expert.ts
    capabilities.ts
    turn-context.ts
```

### 修改

- `src/agent/provider.ts`：保留 Session 生命周期、队列和公共 Provider API；委托 Prompt Runtime。
- `src/agent/engine.ts`：只保留 Harness 构建、安全 hooks 和事件适配。
- `src/agent/skills.ts`：返回类型化 Skill Resources。
- `src/agent/experts/runtime_profile.ts`：返回结构化 Profile。
- `src/agent/mcp.ts`：保留显式 MCP 管理，删除 Prompt 文本推断。
- `application.electron.ts`：Prompt 路由不再拼接 Prompt 文本。

### 删除

- `SYSTEM_PROMPT`
- `systemPromptForPlatform()`
- `loadMemoryPrompt()`
- `assembleSystemPromptSections()`
- `buildSystemPrompt()`
- `MODE_PROMPTS`
- `expertAddon`
- `modeAddon`
- Provider 中 Slash Command 字符串 switch
- `connectMcpServersReferencedByPrompt()`
- HTTP 层 attachment/connector/file Prompt 拼接
- `loadSkillsPrompt()` 全量 System Prompt 注入

## 16. 测试策略

### 单元测试

- Mode × Category 全矩阵。
- Tool Policy 与 Permission 正交：同一能力输入在 L1/L2/L3 下工具列表相同，执行决策不同。
- macOS/Windows Permission Policy 契约保持现状。
- Expert 不能扩权。
- 未选择 MCP 不进入工具集。
- Context Source 固定顺序且每轮一次。
- Working/User Memory 分别按 `createdAt`/`updatedAt` 排序并执行条目级预算。
- `agent_system_prompt` 超预算失败，不截断。
- Fragment 未注册、缺文件、重复 order 和包含占位符时失败。
- TurnPayload 对用户闭合标签、代码、路径和中文进行稳定 JSON 编码。
- 所有可激活 AgentTool 的 label/description/schema 元数据审计。
- Skill/PromptTemplate Invocation 路由。
- Manifest `contentHash` 排除 UUID/时间并保持稳定，敏感内容不落日志。
- Pi Core `systemPrompt` callback、`setTools()`、`setResources()`、`skill()`、`formatPromptTemplateInvocation()` 契约，以及 `promptFromTemplate()` 无 additional context 参数的限制。

### 集成测试

- 普通 Ask/Plan/Craft。
- Expert 绑定、切换和恢复。
- Skill Creator。
- Expert Creator create/edit。
- 显式 Connector MCP。
- Mode 切换。
- Compaction 前后 Profile 一致。
- 用户与 Automation 同 session 并发保持 abort/串行排队，不返回 409。
- 不支持的 Expert schema 不进入 Catalog，前端收到安全 diagnostic。

### 强制不变量

```text
manifest.activeTools == harness.activeToolNames
ask.activeTools == []
plan.activeTools 不含 mutation tool
tools(mode, category, mcp, L1) == tools(mode, category, mcp, L2) == tools(mode, category, mcp, L3)
expert tools ⊆ mode/category tools
MCP tools ⊆ explicit user selection
source collect count == 1 per turn
manifest.contentHash excludes snapshotId and createdAt
```

## 17. 风险与控制

| 风险 | 控制措施 |
|---|---|
| 新 Runtime 模块很多，容易只完成浅层壳 | Task 1-10 必须有独立行为测试；Provider 切换前 Envelope 已能端到端生成 |
| 切换时形成双轨 | 生产入口只切换一次；Task 11 后旧链不再可达，Task 14 物理删除旧符号 |
| Prompt 片段拆分后规则遗漏 | 使用 7.1 的完整 SYSTEM_PROMPT→Pack 矩阵逐项迁移并建立行为测试 |
| Expert schema v2 让旧安装包不可用 | 明确版本错误并要求重新生成/安装；不增加转换器或 fallback |
| Skill 列表与实际 Resources 漂移 | 同一 RuntimeProfile 同时生成 Resources 和 `formatSkillsForSystemPrompt()` 输入 |
| TurnPayload 编码后可读性或边界变化 | 用真实中文、路径、代码和恶意闭合标签建立 JSON Renderer 回归样例 |
| Context Source 读取慢拖累首 token | 每个 Source 记录耗时；只允许 Memory/Settings/Workspace 本地读取，禁止网络和副作用 |
| Manifest 泄漏隐私 | 只记录 hash、长度、名称和诊断；测试用敏感哨兵断言不落 Manifest/日志 |
| Permission 被误用于过滤工具，破坏 L2 确认载体 | ToolPolicy API 不接受 Permission；PermissionPolicy 只在 tool hook 执行并做平台契约测试 |
| AgentTool 描述质量不足 | 切换前审计所有平台和 Category Tool Pack，在注册层修复元数据，不在 Prompt 复制说明 |
| Pi Core 升级破坏动态资源契约 | 对锁定版本建立 Harness 契约测试，升级时强制运行 |
| Compaction 后模型沿用旧 Mode/Expert | 每轮重新生成当前 Mode、Expert reminder、Workspace 和 Active Tools Context |

## 18. 验收标准

1. 每次模型调用只有一个 Snapshot。
2. Prompt、Tools、Resources 和 Permission Policy 来自同一个 RuntimeProfile，但工具可见性与执行授权保持正交。
3. Expert 不能连接 MCP、增加工具或提升权限。
4. Ask 无工具；Plan 无写工具；Creator 非 Craft 被拒绝。
5. Skill 正文仅在实际调用或 `always` Expert Skill 时加载。
6. HTTP 传输层不再拥有 Prompt 业务组装。
7. 静态 Fragment 无模板变量；动态内容只经过类型化 Renderer，无 fallback。
8. Source 错误有稳定诊断，无静默 catch。
9. 删除全部旧 Prompt Assembly 和文本推断 MCP。
10. TypeScript、单元测试、前端构建全部通过。

## 19. 实施结果（2026-08-14）

生产入口已切换到本设计定义的唯一链路。`LocalPiProvider` 在每个串行 turn 中先执行 pre-turn compaction，再重新解析 SessionIntent、RuntimeProfile、TurnIntent 和全部 Context Sources，生成一个 PromptEnvelope；`PromptAwareHarness` 使用同一 Envelope 原子设置 System Prompt、Tools、Resources 与 Permission Policy 后执行。提交完成后才允许 post-turn compaction。

HTTP 层现在只生成结构化附件、文件路径和 Connector DTO；附件正文由受控附件服务解析，`@file` 默认仅注入路径。Creator Category 通过 Pi 原生 `skill-creator` / `expert-manager` invocation 执行，动态草稿、目标和包路径位于 `turn_payload.categoryRuntime`。Expert 为结构化 controlled extension，不能改变工具或权限。

已物理删除旧 `SYSTEM_PROMPT`、Mode/Expert/Creator addon、字符串 Skill catalog 注入、HTTP XML 拼接和基于 Prompt 文本连接 MCP 的函数，不存在兼容开关或双生产链。

实施验证覆盖：

- Prompt Runtime、Sources、Expert、Provider、附件与前端请求模型测试；
- Ask / Plan / Craft、显式 MCP、绑定 Expert、Skill Creator、Expert create/edit 矩阵；
- L1/L2/L3 工具集合正交、Manifest 隐私、边界编码和 Compaction 调用顺序；
- Electron TypeScript、前端生产构建和旧符号归零检查。


## 2026-10-29 会话与稳定资源复用

同一 conversationId 下初始化配置不变时复用 Pi AgentSession，动态提示按轮更新；不同会话保持实例与历史隔离。专家目录、技能目录和静态提示片段按文件元数据失效缓存。云端保持每任务沙箱隔离及检查点恢复，增加静态提示缓存与耗时日志。详见 [同步设计](../designs/2026-10-29-session-context-reuse-design.md)。
