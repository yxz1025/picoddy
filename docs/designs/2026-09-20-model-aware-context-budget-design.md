# 模型感知的上下文预算与溢出恢复设计

## 背景

2026-09-20 的一个全新 TAPD 会话在首轮调用 `qwen-max` 时连续失败。模型接口返回：

```text
<400> InternalError.Algo.InvalidParameter: Range of input length should be [1, 30720]
```

该会话首条用户消息只有 17 个字符、没有附件、没有既有历史，说明超限来源不是用户正文，而是应用在请求时自动注入的系统提示、技能目录、Memory、工具定义和连接器/MCP schema。

当前链路存在三个确定性缺口：

1. `provider_models` 的旧格式只保存模型 ID，缺少 `contextWindow`；`createModelItem()` 对缺失值统一回退到 `128000`，高估了 `qwen-max` 的实际容量。
2. Prompt Runtime 只用固定字节上限保护系统提示，Pi Agent 的 compaction 主要处理历史消息；请求发送前没有按具体模型核算“系统提示 + 历史 + 当前输入 + 工具 schema + 输出预留”的完整预算。
3. 模型返回空正文的 error assistant 后，`TaskRunCoordinator` 未将其识别为有效终态，又抛出“PI 会话未返回 assistant 消息”，导致同一错误被展示两次。

切换到 `qwen3.8-flash` 后，同一会话能够正常调用 TAPD，证明连接器、认证、网络和后端运行正常。本设计针对模型上下文治理和错误收敛，不改变 TAPD 业务逻辑。

## 目标

1. 为每个已注册模型提供可信、可追溯的上下文窗口和最大输出能力。
2. 在每次模型调用前核算完整请求预算，首轮大系统提示或大量工具 schema 也必须被覆盖。
3. 复用 Pi Agent 原生 compaction 处理历史，不在应用层实现第二套历史摘要算法。
4. 按需暴露工具和技能，并对大型工具结果进行有损上下文投影，避免工具循环持续放大输入。
5. 对供应商实际限制与本地元数据不一致的情况执行至多一次安全恢复。
6. 同一失败只产生一条 assistant 错误消息，并向用户说明可操作的原因和建议。
7. 增加不记录正文和敏感参数的预算可观测性，以支持线上定位。

## 非目标

- 不改变模型供应商、API Key 和连接器认证方式。
- 不自动切换模型；模型切换会影响成本、能力和数据策略，必须由用户决定。
- 不删除 Core JSONL 或 SQLite 中的完整历史和工具结果。
- 不用字符截断代替 Pi Agent 的历史 compaction。
- 不在本次改造中引入远程 Token 计费服务或新的数据库。
- 不保证未知自定义模型第一次就能得到精确窗口；未知模型采用保守预算，并支持从明确的供应商错误中校正。

## 设计原则

### 事实源分层

- SQLite 和 Core JSONL 继续保存完整事实。
- 模型请求只消费受预算约束的上下文投影。
- UI 消息不因模型上下文裁剪而丢失。
- 工具结果的完整内容与送给模型的摘要/分页引用分离。

### 单一压缩责任

- Pi Agent 继续负责历史消息切点、摘要生成、compaction 记录和恢复。
- PiCoddyClaw 负责模型能力、静态提示、工具 schema、当前输入和输出预留的预算规划。
- 应用层只在预算规划器判定“历史部分需要让位”时请求 Pi Agent `compact()`，不自行改写历史消息。

### 保守失败

- 元数据未知时宁可使用较小窗口，不得使用明显偏大的乐观默认值。
- 裁剪必须按稳定优先级执行，并留下诊断信息。
- 自动恢复最多一次，不形成隐藏的无限重试。

## 总体架构

```text
模型目录/内置能力表/用户配置/运行时校正
                    │
                    ▼
          ModelCapabilityRegistry
                    │
Prompt Envelope ────┼──── Core Session 历史
工具定义/图片 ──────┤
                    ▼
          ContextBudgetPlanner
             │             │
       预算充足│             │超预算
             │             ▼
             │    工具/技能裁剪、结果投影
             │             │
             │      仍超预算且历史可压缩
             │             ▼
             │       Pi Agent compact()
             │             │
             └──────► 重新核算 ──────┐
                                     │
                              预算通过│仍超预算
                                     ▼
                                模型请求/可操作错误
```

## 一、模型能力注册表

### 数据结构

新增统一模型能力结构：

```ts
export type ModelCapabilitySource =
  | "catalog"
  | "builtin"
  | "user"
  | "observed"
  | "fallback";

export interface ModelCapabilities {
  providerId: string;
  modelId: string;
  contextWindow: number;
  maxOutputTokens: number;
  supportsTools: boolean;
  supportsImages: boolean;
  source: ModelCapabilitySource;
  verifiedAt?: string;
}
```

`contextWindow` 表示供应商定义的总上下文窗口；`maxOutputTokens` 表示单次最大输出，不得将两者混用。

### 合并优先级

同一模型的能力按以下顺序合并，高优先级覆盖低优先级：

1. 本次进程内从明确供应商错误解析出的 `observed` 限制；
2. 用户显式配置；
3. 模型目录接口返回的能力；
4. 应用内置已知模型表；
5. 保守 fallback。

模型目录只返回名称时，必须继续查内置表；不能因为目录请求成功就把缺失的窗口解释为 128K。

### 保守默认值

对无法识别的 OpenAI-compatible 自定义模型，默认采用：

```ts
contextWindow = 32_768
maxOutputTokens = min(4_096, configuredMaxTokens)
source = "fallback"
```

若用户配置的值更小则尊重更小值。设置页应显示“容量未验证”，允许高级用户覆盖。

### 持久化兼容

`provider_models` 同时兼容旧字符串数组和新对象数组：

```json
{
  "qwen": [
    {
      "id": "qwen-max",
      "name": "qwen-max",
      "contextWindow": 30720,
      "maxOutputTokens": 4096,
      "capabilitySource": "builtin"
    }
  ]
}
```

读取旧值时在内存中补全能力；只有用户保存设置或模型目录刷新成功时才写回新格式，避免启动阶段产生无关数据库写入。

### 运行时校正

只解析具有明确语义的供应商错误，例如：

```text
Range of input length should be [1, 30720]
maximum context length is 32768 tokens
```

解析结果只允许收紧当前进程内的模型上限，不允许通过模糊错误扩大上限。是否持久化 `observed` 数据作为后续优化项，本期不落库，避免供应商临时网关限制污染长期配置。

## 二、完整请求预算模型

### 预算公式

```text
safeInputBudget = contextWindow
                - outputReserve
                - safetyMargin

estimatedInput = systemPromptTokens
               + historyTokens
               + currentTurnTokens
               + toolSchemaTokens
               + imageTokens
               + protocolOverheadTokens
```

默认值：

```ts
outputReserve = min(model.maxOutputTokens, configuredAgentMaxTokens)
safetyMargin = max(1_024, ceil(model.contextWindow * 0.05))
```

`outputReserve` 必须至少保留能生成一次工具调用或一段可读答案的空间。若 `safeInputBudget <= 0`，直接判定模型能力配置无效。

### 估算策略

优先使用当前 Pi SDK/供应商可用的 tokenizer；没有对应 tokenizer 时使用保守估算器，并给不同内容附加开销：

- 普通文本按 UTF-8/语言混合的保守比例估算；
- 工具 schema 按最终 JSON 序列化结果估算；
- 消息计算角色、name、tool call ID 等协议开销；
- 图片使用模型目录提供的规则，未知时按高档位保守估算；
- 最终估算额外乘小幅安全系数，供应商返回的真实 usage 用于后续诊断，不反向篡改历史。

预算器必须尽可能消费与 Provider 最终请求相同的序列化结构，禁止仅计算 `userPrompt.length`。

### 组件级报告

```ts
export interface ContextBudgetReport {
  contextWindow: number;
  safeInputBudget: number;
  estimatedInputTokens: number;
  outputReserve: number;
  safetyMargin: number;
  components: {
    system: number;
    history: number;
    turn: number;
    tools: number;
    images: number;
    protocol: number;
  };
  actions: ContextReductionAction[];
  capabilitySource: ModelCapabilitySource;
}
```

报告只记录数量、模型标识和裁剪动作，不记录提示词、工具参数、工具输出或 API Key。

## 三、预算执行时机

### 首次预检

在 `buildTurnEnvelope()` 完成且本轮工具集合已经确定后、调用 `AgentSession.prompt()` 之前执行预检。此时已具备：

- 最终系统提示；
- 当前用户输入；
- 当前模型；
- 本轮活动工具和 schema；
- Core Session 的历史消息；
- 图片输入。

不得把预检放到 Prompt Runtime 之前，因为那时无法看到最终技能、能力块和工具集合。

### 工具循环预检

首轮预检不足以保护多轮工具调用。每次工具结果准备重新进入模型前，也要使用相同预算策略。优先通过 Pi Agent `before_agent_start`/上下文转换扩展点接入；如果当前 SDK 无法在每次 LLM call 前提供最终 payload，则在 PiCoddyClaw 的 Provider 包装层增加最小适配，并推动 SDK 暴露正式的 preflight hook，避免长期维护私有分叉。

### 与 Pi compaction 的协作

1. 预算器先计算非历史固定成本：系统、当前轮、工具、图片和协议。
2. 若固定成本本身超过 `safeInputBudget`，历史 compaction 无效，直接进入工具/技能裁剪。
3. 固定成本可容纳但历史使总量超限时，调用一次 Pi Agent 原生 `compact()`。
4. compaction 完成后重新构建报告；不得使用压缩前的旧估算继续请求。
5. 若没有可压缩历史或压缩后仍超限，进入受控失败。

## 四、上下文缩减策略

缩减动作按以下顺序执行，每一步后重新估算：

### 1. 工具集合按需化

“完全访问”表示权限上允许使用完整能力，不等于每一轮都把所有工具 schema 发送给模型。

工具选择分为三层：

- `required`：当前显式技能、连接器命令或用户选择强制要求的工具；
- `relevant`：由会话类别、意图和能力目录判断可能需要的工具；
- `available`：权限允许但当前不需要，不进入本轮 schema。

TAPD 查询轮应优先只暴露 TAPD delegate 工具和少量只读基础工具。`bash`、文档生成、浏览器、图片、发布等无关工具不应仅因“完全访问”而全部注入。

工具选择必须可解释且确定性优先；第一期基于现有 category/mode/skill/MCP 选择规则，不额外调用模型进行工具路由。

### 2. 技能上下文按需化

系统提示仅注入：

- 用户明确选择的技能；
- forced invocation 对应技能；
- 专家绑定的资源技能；
- 当前类别必须的内置说明。

未激活技能只保留短名称/描述目录，或完全省略正文。不得在普通问答中注入所有 `SKILL.md` 全文。

### 3. 大型工具结果投影

工具执行事实仍完整写入 Core JSONL/SQLite；进入后续模型上下文的结果投影遵循：

- 结构化列表默认分页、字段白名单和条数上限；
- 超过阈值的结果生成确定性摘要：总数、字段、前后少量样本、保存位置和继续读取方式；
- 对可重新查询的数据保留查询游标或过滤条件；
- 对不可重放的外部结果保留本地产物引用和摘要；
- 错误结果保留错误码和必要诊断，不保留大段重复堆栈。

MCP/连接器工具应优先从源头支持 `limit`、分页和字段选择，而不是返回后再盲目截断 JSON。

### 4. 历史 compaction

完成静态上下文和工具结果治理后，才请求 Pi Agent 压缩历史。压缩事件继续通过现有 `compaction_start`/`compaction_end` 显示状态，并保留 Core compaction 记录。

应用不得用消息数量近似判断压缩资格。调用前必须使用 Pi Agent 当前版本的
`prepareCompaction()` 对真实 Session 分支和压缩设置进行检查；没有合法切点时跳过
压缩。检查与执行之间出现的 `Nothing to compact` / `Already compacted` 只表示无操作，
不得作为助手错误消息展示。非历史固定成本已经超限时同样不得调用历史压缩。

### 5. 当前用户输入

用户本轮正文和明确附件默认不静默截断。若它们单独就超过预算，向用户说明具体模型上限并建议：

- 将大文本作为附件并使用分段读取；
- 缩小附件范围；
- 切换更大上下文模型。

## 五、溢出后的单次恢复

供应商仍可能因 tokenizer、隐式协议开销或网关限制拒绝请求。对明确的上下文溢出错误执行一次恢复：

1. 将解析出的限制作为本进程 `observed` 上限；
2. 生成新的预算报告；
3. 使用更严格的工具结果投影和相关工具集合；
4. 如果历史占比仍高，请求一次 Pi compaction；
5. 使用同一模型重试一次。

恢复禁止：

- 重放已经成功的写操作或外部副作用；
- 自动切换模型；
- 在错误语义不明确时重试；
- 对同一 turn 执行第二次溢出重试。

如果溢出发生在工具执行之前，重试整个模型调用是安全的；如果发生在工具执行之后，只能从已持久化的 Core 状态继续，不得重新执行已经完成的工具。

## 六、错误模型与前端展示

### 统一错误类型

```ts
export class ContextCapacityError extends Error {
  code = "CONTEXT_CAPACITY_EXCEEDED" as const;
  constructor(
    public readonly report: ContextBudgetReport,
    public readonly stage: "preflight" | "provider" | "recovery",
    public readonly providerMessage?: string,
  ) {
    super("Model context capacity exceeded");
  }
}
```

错误对用户展示为一条消息：

```text
当前请求超过 qwen-max 的输入容量（30,720 Token）。
系统提示和已启用工具占用较多上下文。请减少工具，或切换到更大上下文模型。
```

若主要占比来自用户附件或历史，则根据 `components` 改写第二句，不再统一提示“对话历史过长”。

### assistant 终态规则

`TaskRunCoordinator` 查找本轮 assistant 时必须接受：

- 有正文的成功 assistant；
- `stopReason: "error"` 且只有 `errorMessage` 的 assistant；
- `stopReason: "aborted"` 的 assistant。

只有在本轮完全没有收到 assistant 终态、也没有可识别的 Provider 错误时，才生成内部错误“模型会话未产生终态消息”。该内部错误不应与已持久化的 Provider 错误同时出现。

持久化和事件广播保持单一所有者：原始 error assistant 经 `assistantResponseText()` 转成用户可见文本并落库；`handlePromptFailure()` 不得再次生成语义重复的 synthetic assistant。

## 七、可观测性

新增结构化操作事件：

```text
context.preflight
context.reduced
context.compaction_requested
context.provider_overflow
context.recovery_succeeded
context.recovery_failed
```

允许记录：

- provider/model；
- capability source；
- 窗口、预算和各组件 Token 数；
- 工具数量和裁剪数量；
- 是否执行 compaction/retry；
- 错误码和阶段。

禁止记录：

- 原始用户内容、Memory、系统提示正文；
- 工具参数和工具输出正文；
- API Key、Cookie、Token；
- 本地附件内容和完整敏感路径。

开发模式可以通过受控诊断接口查看当前会话最近一次 `ContextBudgetReport`；生产 UI 只显示总量、主要占用项和操作建议。

## 八、代码影响范围

### 模型能力

- `src/agent/models.ts`
  - 删除乐观的统一 `128000` fallback；
  - 接入 `ModelCapabilityRegistry`；
  - 扩展 `ConfiguredProviderModel`。
- `src/agent/provider_model_catalog.ts`
  - 保留目录能力字段；
  - 合并内置能力表和来源标记。
- 新增 `src/agent/model_capabilities.ts`
  - 内置能力、优先级合并、保守 fallback、运行时收紧。
- `application.electron.ts`
  - 设置 API 兼容新模型能力字段。

### 预算与缩减

- 新增 `src/agent/context-budget/types.ts`
- 新增 `src/agent/context-budget/estimator.ts`
- 新增 `src/agent/context-budget/planner.ts`
- 新增 `src/agent/context-budget/provider-error.ts`
- `src/agent/prompt-runtime/tool-policy.ts`
  - 区分权限可用工具与本轮活动工具。
- `src/agent/prompt-runtime/envelope-builder.ts`
  - 输出可分项估算的 prompt 组件元数据；现有 64 KB 绝对安全线继续保留，但不再充当模型容量判断。
- `src/agent/engine.ts`
  - 接入每次 LLM call 前的预检/投影扩展点。
- `src/agent/provider.ts`
  - 首轮预算、compaction 协作、一次恢复和诊断事件。
- 连接器/MCP 结果适配层
  - 增加分页、字段选择和受控上下文投影。

### 错误收敛

- `src/agent/long_task.ts`
  - 接受无正文 error assistant；按本轮边界选择终态。
- `src/shared/assistant_response.ts`
  - 使用结构化错误优先，字符串正则作为兼容兜底。
- `src/domains/session/node/store.ts`
  - 保证同一 turn 的错误 assistant 只落库一次。
- `frontend/src/store/eventModel.ts`、`frontend/src/store/useStore.ts`
  - 展示单一结构化错误和可选预算提示。

## 九、实施阶段

### 阶段一：修复当前故障

1. 引入模型能力注册表和 Qwen 已知能力。
2. 将未知模型 fallback 调整为保守值。
3. 修复空正文 error assistant 的识别和重复错误。
4. 添加模型能力、Qwen 30720 错误解析和错误去重测试。

该阶段即可解决本次 `qwen-max` 错误识别不准和重复展示问题，但不能完全解决全工具 schema 过大的架构问题。

### 阶段二：完整预检

1. 实现完整请求估算和组件报告。
2. 在首轮调用前接入预算器。
3. 与 Pi Agent 原生 `compact()` 协作。
4. 对固定上下文本身超限给出明确错误。

### 阶段三：按需工具和结果投影

1. 将“权限可用”和“本轮活动”工具拆开。
2. TAPD 等连接器实现分页和字段筛选。
3. 大型工具结果只向模型投影摘要/引用。
4. 接入每次工具循环后的再次预检。

### 阶段四：供应商溢出恢复与诊断 UI

1. 运行时收紧模型上限并单次恢复。
2. 增加预算事件和开发诊断视图。
3. 根据真实数据调整安全余量和 fallback。

## 十、测试方案

### 单元测试

- 旧字符串 `provider_models` 能补全内置 Qwen 能力。
- 新对象格式往返保存不丢 `contextWindow`、`maxOutputTokens` 和来源。
- 未知模型使用保守 fallback，不再默认 128K。
- 能力合并遵循 `observed > user > catalog > builtin > fallback`。
- 预算公式正确预留输出和安全余量。
- UTF-8 中文、英文、JSON schema、图片和协议开销估算稳定。
- 工具裁剪永不移除 `required` 工具。
- 工具结果投影保留总数、必要字段、引用和错误码。
- 明确的 30720 溢出错误可以解析；模糊 400 不触发容量校正。
- error assistant 只有 `errorMessage` 时仍成为本轮终态。
- Provider 错误和协调器兜底不会生成两条错误消息。

### 集成测试

1. 新会话、17 字用户消息、全访问模式、`qwen-max`：发送前发现超预算并裁剪无关工具，或只展示一个容量错误。
2. 同一场景切换 `qwen3.8-flash`：正常进入工具调用。
3. 长历史场景：预算器请求一次 Pi compaction，压缩后继续，不丢工具状态。
4. 固定系统提示和必需工具本身超限：不调用 compaction，直接返回准确错误。
5. 工具返回 25 KB/100 KB JSON：完整结果落库，后续模型只接收受控投影。
6. 首次供应商溢出：收紧上限并重试一次；第二次失败后停止。
7. 工具已经成功执行后发生溢出：恢复流程不重复执行该工具。
8. 模型目录缺少窗口字段、目录请求失败、自定义模型三种场景均有确定性 fallback。

### 回归测试

- Ask/Plan/Craft、专家、Skill Creator、自动化和子代理工具集合不发生越权。
- 权限确认逻辑仍基于允许能力，不因本轮工具裁剪而放宽权限。
- Core JSONL、SQLite UI 消息、工具审计和 compaction 记录保持一致。
- 模型切换后立即使用新模型能力重新预算。
- 会话重启后不会重复展示旧的 Provider 错误。
- 日志不包含用户正文、工具输出、API Key 或访问 Token。

## 十一、验收标准

- `qwen-max` 不再以 128K 上下文注册；本次 30,720 限制能够被正确识别。
- 新会话首轮请求也经过完整预算，不依赖历史 compaction 才发现超限。
- 任何发往模型的请求都满足：

  ```text
  estimatedInput + outputReserve + safetyMargin <= contextWindow
  ```

- “完全访问”不再等价于每轮注入全部工具 schema。
- 单个大型工具结果不会原样无限进入后续模型上下文。
- 同一 Provider 失败在 UI 和 SQLite 中只出现一条 assistant 错误消息。
- 容量错误能够指出模型、已知上限和主要占用来源，并给出可操作建议。
- 溢出自动恢复最多一次，不自动切换模型，不重复外部副作用。
- 既有 Pi Agent compaction、权限、工具调用、持久化和取消行为无回归。

## 十二、风险与控制

### Token 估算与供应商不一致

通过安全余量、保守 fallback、真实 usage 观测和明确错误的运行时收紧控制。预检是保护线，不宣称与供应商 tokenizer 完全一致。

### 工具裁剪导致模型不会调用必要工具

所有显式技能、选中 MCP 和连接器命令映射到 `required`；相关性裁剪只作用于 `available`。裁剪结果进入诊断报告，并通过类别/模式集成测试锁定。

### 工具结果摘要丢失关键信息

完整结果仍作为事实源持久化；投影必须提供继续分页读取或本地产物引用。不可重放结果采用更保守的保留策略。

### compaction 产生额外成本或失败

只有历史确实是超限来源时才调用一次；失败不循环，向用户保留原始历史并展示明确错误。

### 旧配置迁移改变模型行为

读取时兼容、延迟写回；内置能力表需要版本化测试。对不确定模型使用保守来源标记，并允许用户覆盖。

## 决策总结

本设计采用“准确模型能力 + 完整请求预检 + 按需工具/技能 + 大结果投影 + Pi 原生历史 compaction + 单次溢出恢复 + 单一错误终态”的组合方案。

仅修正 `qwen-max.contextWindow` 可以解除当前误判，但不足以防止其他模型、首轮大工具集合和连续工具结果再次超限；仅增加历史压缩也无法解决新会话固定上下文本身过大的问题。因此实施必须至少完成阶段一和阶段二，阶段三是长期稳定运行的必要收敛项。

## 十三、2026-09-20 实施记录

本次已完成当前故障所需的核心闭环：

- 新增统一模型能力解析，内置 `qwen-max` 的 32,768 总上下文、30,720 最大输入和 8,192 最大输出，以及 `qwen3.8-flash` 的已知能力；未知模型改用 32K 保守 fallback。
- `provider_models` 对象格式增加 `maxInputTokens`、`maxOutputTokens` 的兼容读写，模型注册时同时受用户配置输出上限约束。
- 新增请求前预算，覆盖系统提示词、当前输入、Pi 历史消息和工具 schema，并预留输出与安全余量。
- 对不超过 32K 输入的小上下文模型收敛本轮活动工具；显式选择的 MCP 工具始终保留，权限策略保持不变。
- 仅当历史是显著占用来源时调用一次 Pi Agent 原生 `compact()`；固定提示词/工具仍超限时在本地返回单一、可操作的容量错误。
- `TaskRunCoordinator` 以本轮 `message_end` 的 error assistant 作为终态，即使 Pi history 没有收录该空正文错误，也不会再抛出“PI 会话未返回 assistant 消息”形成第二条错误。

本次未实现、继续保留为后续演进项：供应商 usage 观测回写、运行时学习上限、工具结果分页/投影、每个工具循环后的再次预算、专用预算诊断 UI。它们不阻塞本次 `qwen-max` 首轮超限和重复报错修复。
