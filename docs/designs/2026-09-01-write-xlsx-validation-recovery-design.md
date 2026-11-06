# write_xlsx 参数完整性、运行时纠正与恢复展示设计

## 背景

数据分析任务中，模型第一次调用 `write_xlsx` 时只提交了 `fileName`，遗漏必填的 `sheets`，触发工具 Schema 校验失败。已有修复强化了 Schema、技能说明和“失败后重试成功”的恢复展示，但新的实际案例中，模型收到校验错误后直接结束，没有再次调用工具，因此仍然无法生成文件。

现有 `write_xlsx` Schema 正确地将 `sheets` 设为必填，执行层也必须依赖工作表数据生成文件。Pi Core 会把参数校验错误作为工具结果交回模型，但模型仍可以选择输出说明并停止。参数校验发生在 `beforeToolCall` 和 `tool_result` 钩子之前，现有权限钩子和工具结果钩子无法对这类错误追加纠正要求。

## 目标

- 降低模型首次调用 `write_xlsx` 时遗漏 `sheets` 的概率。
- 明确要求一次性提供 `fileName` 和至少一个完整工作表。
- 保持缺失 `sheets` 的调用校验失败，不生成伪成功的空文件。
- 当 `write_xlsx` 因参数 Schema 校验失败时，在同一次 Agent 运行的下一模型轮自动追加一次明确纠正要求。
- 每次 Agent 运行最多触发一次自动纠正，避免无限重试。
- 当一次工具参数校验失败后，紧接着同名工具重试成功时，将前一次展示为“已自动纠正”。
- 保留失败详情和审计记录，不隐藏真实调用历史。

## 非目标

- 不把 `sheets` 改为可选，也不自动创建空工作表。
- 不使用后续调用的数据反向修改第一次工具调用。
- 不修改 Excel 文件写入实现、文件路径或预览逻辑。
- 不把运行时错误、权限错误或业务错误标记为自动纠正。
- 不实现通用的模型工具参数自动补全器。
- 不在后端猜测、补造或缓存模型尚未提交的工作表数据。
- 不保证模型在收到纠正要求后必然生成合法参数；第二次仍失败时保留真实失败结果。

## 现状与根因

`src/agent/tools/doc.ts` 的 Schema 已要求 `fileName` 和 `sheets`，但：

- 工具描述只用一句话概括字段，没有明确禁止仅传文件名；
- `sheets` 没有限制最少一项；
- `resources/builtin-skills/data-analysis/SKILL.md` 只说“用 write_xlsx 生成”，没有要求先整理完整二维数据再调用，也没有完整示例；
- `ChatArea` 只要工具消息包含任意错误，就把整组显示为“处理完成，部分失败”，不了解下一次同名成功调用已经恢复。

已有提示和展示修复完成后仍存在最后一个缺口：Pi Core 在 `tool_execution_end` 中返回 Schema 校验错误并继续下一模型轮，但没有要求模型必须纠正。若模型选择停止，就不会出现供前端识别的成功重试。

Pi Core 的校验顺序为“解析参数 → Schema 校验 → `beforeToolCall` → 执行 → `tool_result`”。校验失败会直接形成错误工具结果，跳过后两个 Hook。因此恢复入口必须监听核心 `tool_execution_end`，不能放入工具实现或 `tool_result` Hook。

## 采用方案

### 1. 强化工具 Schema 与描述

调整 `write_xlsx` 元数据：

- 顶层描述明确“单次调用必须同时提供 `fileName` 和非空 `sheets`，禁止仅传 `fileName`”；
- `sheets` 增加 `minItems: 1`；
- `sheets` 描述包含最小 JSON 形态；
- `name`、`headers`、`rows` 的描述明确必填关系和二维数组格式；
- `rows` 保持可为空数组，以支持只有表头的合法工作表，但字段本身仍为必填。

Schema 继续失败关闭，执行函数不提供缺参兜底。

### 2. 强化内置数据分析技能

更新 `resources/builtin-skills/data-analysis/SKILL.md`：

- 先完成数据整理，再调用 `write_xlsx`；
- 明确一次性提供全部工作表；
- 给出包含 `fileName`、`sheets`、`name`、`headers` 和 `rows` 的完整 JSON 示例；
- 明确不得先用只有 `fileName` 的占位调用探测工具。

实施后通过项目生成脚本刷新 `src/agent/builtin_skills` 生成产物，不手工编辑生成文件。

### 3. 识别紧邻的参数校验恢复

新增一个前端纯函数，根据同一工具组内的消息顺序计算自动纠正状态。只有同时满足以下条件才成立：

1. 当前工具调用状态为失败；
2. 错误文本明确匹配工具参数 Schema 校验失败，例如 `Validation failed for tool`；
3. 下一条工具消息与当前 `toolName` 相同；
4. 下一条工具消息状态为成功。

要求“下一条紧邻成功”可避免把相隔很久、语义无关的同名调用错误关联起来。

### 4. 调整时间线展示但保留审计

- 自动纠正的旧调用在行内显示“已自动纠正”，不显示红色“失败”；
- 工具组的“部分失败”判断忽略已自动纠正的参数校验错误；
- 展开后仍展示原始参数和校验错误，保证透明度；
- 数据库中的 `isError`、工具审计日志和事件协议保持不变；
- 其他失败继续按红色失败展示。

### 5. 增加一次性运行时纠正

在 `src/agent/engine.ts` 的 Harness 边界增加仅针对 `write_xlsx` 的纠正状态机：

1. 每次收到 `agent_start` 时清空本次运行的纠正状态；
2. 监听 `tool_execution_end`，只接受 `toolName === "write_xlsx"`、`isError === true` 且文本明确匹配 `Validation failed for tool` 的事件；
3. 记录对应 `toolCallId`，同一次运行只记录第一次匹配，后续失败不再触发；
4. 在下一次 Harness `context` Hook 中找到该调用的 `toolResult`，复制消息并向其文本内容追加内部纠正指令：立即使用同一工具重试，单次提交 `fileName` 和非空 `sheets`，每个工作表包含 `name` 与二维 `rows`，禁止只解释错误或再次提交占位参数；
5. 注入完成后立即消费待纠正状态。

纠正指令只存在于下一次模型请求的临时 Context 变换中，不写入 SQLite、不追加伪造的用户消息、不改变原工具错误内容，也不显示在前端。模型仍使用原会话中已经整理的数据构造完整 `sheets`。

状态识别与 Context 变换提取为纯函数/小型状态对象，便于覆盖匹配、单次限制、运行重置和不可变消息变换。若模型纠正成功，现有前端逻辑继续把第一次失败显示为“已自动纠正”；若再次失败或模型仍停止，则保持失败。

## 影响范围

- `src/agent/tools/doc.ts`：工具 Schema 和描述。
- `resources/builtin-skills/data-analysis/SKILL.md`：数据分析调用规范。
- `src/agent/builtin_skills/*generated*`：由生成脚本刷新。
- `frontend/src/components/ChatArea.tsx`：时间线状态展示。
- `frontend/src/components/toolActivityModel.ts`：自动纠正判定纯函数。
- `frontend/src/components/toolActivityModel.test.ts`：前端回归测试源码。
- `test/src/agent/tools/doc.test.ts`：工具元数据回归测试源码。
- `src/agent/tool_validation_recovery.ts`：`write_xlsx` 校验失败识别、单次状态和临时 Context 注入。
- `src/agent/engine.ts`：接入 Harness 核心事件与 `context` Hook。
- `test/src/agent/tool_validation_recovery.test.ts`：运行时纠正状态机回归测试源码。
- `docs/architecture/prompt-runtime-v2-design.md`：记录 Harness 边界上的一次性工具参数纠正行为。
- `docs/README.md`：设计索引。

## 风险与控制

### 提示增强不能绝对保证模型永不漏参

工具参数由模型生成，描述优化只能显著降低概率，不能形式化保证首次调用完整。Schema 仍作为最终防线，后续模型重试仍可恢复。

### 错误恢复识别误配

只匹配明确的参数校验错误、同名工具和紧邻成功调用；权限、文件写入、网络、业务等错误均不改变展示状态。

### 隐藏真实失败

不删除、不合并数据库记录，也不隐藏展开详情；仅把已被下一次成功调用恢复的中间状态改为“已自动纠正”。

### 自动纠正形成无限循环

每次 `agent_start` 只允许一次 `write_xlsx` 校验纠正。第二次失败不再注入指令，由模型正常结束并向用户展示真实错误。

### 纠正指令污染会话或界面

不调用 `steer`/`followUp` 追加持久化消息，而是在下一轮 `context` Hook 中不可变地复制目标 `toolResult` 并追加临时文本；数据库、核心 Session 和前端消息均保留原始事件。

### 误把其他错误当作参数错误

同时校验工具名、`isError` 和标准 Schema 校验错误前缀。写文件失败、权限拒绝、路径错误及其他工具失败均不触发。

## 验证方式

- TypeScript 检查工具 Schema 元数据和前端纯函数。
- 回归测试源码覆盖：缺参错误紧邻成功、非校验错误、不同工具、非紧邻成功和最终仍失败。
- 运行时纠正测试源码覆盖：首次匹配注入、非 Schema 错误不注入、其他工具不注入、同一运行仅一次、下一次运行恢复额度、原消息不被修改。
- 运行内置技能生成脚本并确认生成产物更新。
- 执行前端及主进程 TypeScript 类型检查和 `git diff --check`。
- 人工验证 `write_xlsx` 首次只传 `fileName` 时，下一模型轮收到纠正要求并携带完整 `sheets` 重试；连续失败不会形成循环。
- 按项目约束不自动运行测试套件；用户明确授权后再运行定向测试。
