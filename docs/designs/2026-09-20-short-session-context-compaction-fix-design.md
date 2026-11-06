# 短会话上下文压缩误触发修复设计

## 背景

`qwen-max` 专家会话在已经完成文档生成后，用户仅回复“暂无”时返回：

```text
Nothing to compact (session too small)
```

实际会话只有两个已完成用户轮次。应用侧预检只依据估算历史 Token 和消息数量判断是否压缩，随后直接调用 Pi Agent `compact()`；Pi Agent 使用自己的分支、保留尾部和切点规则判断后认为没有可压缩内容，因此抛出内部英文异常。该异常未经语义转换进入了最终助手消息。

同时，小上下文模型的工具收敛逻辑把核心工具的“排序优先级”误当成“与本轮相关”，导致计划模式即使只输入“暂无”，仍携带多组无关工具 schema，增加了错误触发预算预检的概率。

## 目标

- 使用 Pi Agent 的真实压缩准备结果判断本轮是否可压缩。
- 短会话、刚压缩的会话和只有近期内容的会话不得调用手动压缩。
- 即使 Pi Agent 在检查与执行之间返回“无内容可压缩”，也不得向用户暴露内部英文异常。
- 小上下文模型仅携带本轮相关工具；简单确认轮保留最小模式工具集。
- 真正无法容纳的请求返回中文、可操作的容量提示。
- 保持上一轮生成文档的会话历史和文件引用不变；“暂无”不要求用户重新上传文档。

## 非目标

- 不修改 Pi Agent 依赖源码或实现第二套摘要算法。
- 不改变模型上下文窗口配置。
- 不自动删除历史消息、工具结果或已生成文件。
- 不新增数据库表或迁移。
- 本次不实现跨会话的文档资产自动挂载；当前会话已有的消息和文件路径继续由既有 Session/SQLite 记录承载。

## 现状

当前 `LocalPiProvider` 在请求前满足以下条件就调用 `session.compact()`：

- 预算估算超限；
- 历史估算超过 2,048 Token；
- `session.messages.length >= 4`。

消息数量不是 Pi Agent 的压缩资格。Pi Agent 还要根据 Session 分支、上一次压缩边界、`keepRecentTokens` 和合法切点执行 `prepareCompaction()`。因此应用判断为“可压缩”时，Pi Agent 仍可能返回 `Nothing to compact (session too small)`。

工具收敛函数使用一个数值同时表达工具优先级和文本相关性。核心工具具有正优先级，所以即使当前文本完全不相关，也会被加入工具集合。

## 方案

### 1. 采用 Pi Agent 原生压缩资格

通过项目既有的 headless vendor 边界导出 Pi Agent `prepareCompaction()`。Provider 使用当前 `sessionManager.getBranch()` 与 `settingsManager.getCompactionSettings()` 生成准备结果。

只有同时满足以下条件才请求压缩：

1. 请求估算超限；
2. 非历史固定成本仍能放入安全预算；
3. 历史超过最低治理阈值；
4. Pi Agent 返回有效的 `CompactionPreparation`。

这保证应用与实际执行压缩使用同一套切点语义。

### 2. 把无可压缩内容视为无操作

手动压缩仍可能因会话状态变化返回 `Nothing to compact` 或 `Already compacted`。Provider 只对这两个明确的无操作结果降级：

- 不产生失败助手消息；
- 重新使用未压缩预算执行后续判断；
- 其他鉴权、网络、摘要、取消错误继续向上抛出，避免隐藏真实故障。

### 3. 修正小上下文工具相关性

工具候选拆分为三个维度：

- `required`：用户显式选择的 MCP 工具，始终保留；
- `matched`：名称、标签或描述与本轮文本实际匹配；
- `priority`：只用于已匹配候选的稳定排序，不再代表相关。

普通 assistant 会话在没有匹配工具时保留最小工具集：

- Plan：`read`；
- Craft：`read`、`edit`、`write`。

专用 Category 的工具包不经过该通用收敛逻辑，避免裁掉 Creator 或 Connector 的必需工具。

### 4. 容量错误中文化

压缩后仍超限时，根据占用来源生成单条中文消息：

- 固定成本超限：建议减少启用工具、技能或切换大上下文模型；
- 历史主导：建议新建会话或切换大上下文模型；
- 当前输入主导：建议减少附件或分段提供内容。

错误消息不包含 Pi Agent 内部异常字符串。

### 5. 文档连续性

当前问题不是文档丢失。上一轮助手消息、工具结果和生成文件路径已经进入当前会话；普通确认不需要重新读取 DOCX。后续明确要求修改正文时，Agent 继续通过既有文件路径和文档工具读取。此次不改变资产 UI 的“本轮附件”计数语义。

## 影响范围

- `src/vendor/pi_coding_agent.ts`：导出原生压缩准备函数。
- `src/agent/context_budget.ts`：压缩决策、无操作识别、工具相关性和容量消息。
- `src/agent/provider.ts`：使用原生资格并处理压缩结果。
- `test/src/agent/model_context_budget.test.ts`：补充纯函数和无操作回归用例。
- `docs/designs/2026-09-20-model-aware-context-budget-design.md`：补充短会话约束。

## 风险

- Pi Agent 深层 API 随依赖升级变化：统一经 `src/vendor/pi_coding_agent.ts` 暴露，并由类型检查和回归测试约束。
- 工具收敛过强可能影响模糊的继续指令：Craft 保留最小读写工具集，显式 MCP 和文本匹配工具始终保留；专用 Category 不收敛。
- 估算与供应商 tokenizer 仍可能有差异：预检只负责明确治理，Pi Agent 原生溢出恢复继续作为供应商返回后的最终保护。

## 验证方式

- TypeScript 检查通过。
- `git diff --check` 通过。
- 回归测试源码覆盖：
  - 短会话不可压缩时不调用 `compact()`；
  - `Nothing to compact` 和 `Already compacted` 被识别为无操作；
  - 其他压缩错误不被吞掉；
  - “暂无”在 Plan 模式只保留最小只读工具；
  - 显式 MCP 和文本相关工具继续保留；
  - 容量错误按主要来源输出中文建议。
- 手工验收：在已生成文档的短会话中回复“暂无”，应正常得到确认回复，不出现压缩状态或英文内部错误。
