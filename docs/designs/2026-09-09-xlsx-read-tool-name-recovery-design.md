# XLSX 读取工具名误调用与恢复展示设计

**状态：** 已实施

**日期：** 2026-09-09

**范围：** 文档读取工具提示、工具运行记录的恢复判定与展示

## 背景

Windows 用户上传 `.xlsx` 后，附件预解析和最终读取均成功，但 Agent 第一次工具调用使用了未注册的 `read_xlsx`。Pi Core 在执行工具参数或文件访问前按名称查找工具，因此返回 `Tool "read_xlsx" not found`。模型随后改用已注册的 `read_doc` 并成功完成任务，但前端仍把第一次调用显示为红色“失败”，工具组也显示“部分失败”。

该现象与 Windows 路径、用户名、文件权限和 ExcelJS 解析无关。截图中的同一路径已被后续 `read_doc` 成功读取；失败发生在工具名称解析阶段，尚未进入 `src/domains/doc/node/reader.ts`。

当前运行时的权威工具名是 `read_doc`：

- `src/agent/tools/doc.ts` 只注册 `read_doc`；
- `resources/builtin-skills/document-processing/SKILL.md` 和 `data-analysis/SKILL.md` 均要求使用 `read_doc`；
- `capability_context.activeToolNames` 会把实际工具名传给模型；
- Pi Core 对未知工具名直接产生错误工具结果，`beforeToolCall` 和文档读取实现都无法拦截该错误。

前端已有 `autoCorrectedToolCallIds()`，但当前没有接入 `ChatArea`，并且它只识别“同名工具参数校验失败后成功重试”，不能识别 `read_xlsx` 失败后由 `read_doc` 成功恢复的场景。

## 目标

1. 降低模型把 Excel 读取工具误写为 `read_xlsx` 的概率。
2. 当 `read_xlsx` 的未知工具错误已经被紧邻的 `read_doc` 成功调用恢复时，不再向用户显示红色失败或“部分失败”。
3. 保留原始失败记录、参数和错误详情，便于展开排查和审计。
4. Windows、macOS 和 Linux 使用一致的判定逻辑，不按路径分隔符或平台做特殊分支。

## 非目标

- 不新增或注册 `read_xlsx` 兼容别名；文档读取继续保持 `read_doc` 单一入口。
- 不修改 ExcelJS、附件上传、附件预解析或文件路径解析逻辑。
- 不吞掉未恢复的未知工具、真实文件读取失败、权限失败或解析失败。
- 不修改数据库中的 `isError`、工具审计日志或 Pi Core 原始事件。
- 不对任意未知工具名做模糊匹配或自动执行，避免把模型错误路由到错误能力。

## 现状与原因

实际链路如下：

```text
模型调用 read_xlsx(path)
  -> Pi Core validateToolCall
  -> 工具注册表中不存在 read_xlsx
  -> tool_execution_end(isError=true, "Tool read_xlsx not found")
  -> 模型读取错误结果并改用 read_doc(path)
  -> readDocTool.execute
  -> ExcelJS 解析成功
  -> 前端仍按任一 isError=true 判定工具组“部分失败”
```

`read_xlsx` 是模型根据文件后缀和 `write_xlsx` 对称命名推测出的工具名，不是产品注册的工具，也不是 Windows 专属故障。因为失败发生在 Pi Core 的工具查找阶段，增加文件路径兼容或修改解析器不能解决这个问题。

## 方案

### 1. 强化权威工具说明

在 `read_doc` 的工具描述以及文档处理、数据分析内置技能中明确：

- `read_doc` 是读取 Excel、Word、PPT、PDF、CSV 和文本的统一工具；
- 读取 `.xlsx` 仍调用 `read_doc`；
- 不存在 `read_xlsx`，不得根据扩展名推导工具名。

说明只放在工具元数据和对应内置技能中，不在 Core Prompt 维护第二份工具清单。

### 2. 定义严格的“已恢复”判定

扩展 `frontend/src/components/toolActivityModel.ts`，返回已自动纠正的失败调用 ID。除现有的同名参数校验恢复外，新增且仅新增以下规则：

1. 当前调用的 `toolName` 精确等于 `read_xlsx`；
2. 当前调用状态为失败；
3. 错误文本精确匹配 Pi Core 的未知工具错误，且错误中的工具名为 `read_xlsx`；
4. 紧邻的下一条工具记录是成功的 `read_doc`；
5. 两次调用参数都能解析为 JSON；
6. 两次调用的 `path` 都是非空字符串，并在规范化分隔符与 Windows 大小写后相同。

只有同时满足全部条件才标记为已恢复。参数无法解析、路径不同、中间插入其他工具、`read_doc` 失败，或错误文本不是未知工具错误时，均保留真实失败状态。

路径比较只用于展示判定，不用于文件访问；规范化时将 `\\` 和 `/` 统一，并在 Windows 风格盘符路径上进行不区分大小写比较，不调用文件系统，不解析符号链接。

### 3. 接入工具运行记录展示

在 `ChatArea` 的工具组内计算恢复 ID 集合，并将恢复状态传给行项目：

- 已恢复调用显示“已自动纠正”，不显示红色叉号和“失败”；
- 工具组计算“部分失败”时忽略已恢复调用；
- 展开行后仍显示原始工具参数和 `Tool "read_xlsx" not found`；
- 未恢复失败继续保持现有红色状态；
- 运行中的调用不参与恢复判定。

该变化只影响派生展示，不修改消息对象或持久化数据。

### 4. 不增加运行时工具别名

不把 `read_xlsx` 注册为委托到 `read_doc` 的别名，原因如下：

- 会形成两个描述同一读取能力的工具，破坏 `read_doc` 作为文档读取单一入口的现有架构；
- 增加模型工具选择歧义和 schema 上下文体积；
- 只能修复一个后缀，无法合理覆盖所有可能被推测出的 `read_docx`、`read_pdf` 等名称；
- 未知名称在进入权限和工具 Hook 前失败，通用模糊重写会扩大安全边界。

## 影响范围

- `src/agent/tools/doc.ts`：强化 `read_doc` 描述。
- `resources/builtin-skills/document-processing/SKILL.md`：明确统一工具名。
- `resources/builtin-skills/data-analysis/SKILL.md`：明确 Excel 读取方式。
- `frontend/src/components/toolActivityModel.ts`：增加严格恢复判定和参数路径比较。
- `frontend/src/components/toolActivityModel.test.ts`：补充成功恢复与反例测试源码。
- `frontend/src/components/ChatArea.tsx`：接入恢复状态，调整行与工具组派生状态。
- `frontend/src/components/ChatArea.css`：如现有状态样式不足，增加“已自动纠正”的中性样式。
- `docs/04-文档处理引擎.md`：补充文档读取工具名与恢复展示约束。
- 运行 `npm run gen:builtin-skills` 后更新生成的内置技能资源；不手工编辑生成产物。

## 风险与控制

### 把真实失败误标为成功

使用工具名、标准错误文本、紧邻成功调用和相同路径四重约束。任何条件不满足都不降级错误状态，原始详情始终保留。

### Windows 路径表示差异导致无法识别

仅在展示层做保守的分隔符和盘符大小写规范化；不使用 `realpath`，避免文件不存在、权限或符号链接带来的副作用。

### 只修展示但模型继续浪费一次调用

同时强化工具元数据和两个相关内置技能，降低首次误调用概率。模型输出仍无法被完全保证，因此保留恢复展示作为兜底。后续若统计显示未知工具误调用仍频繁，应单独设计通用的运行时纠正机制，不在本次加入模糊别名。

### 历史消息展示变化

历史记录也会通过同一纯函数重新判定。只有满足严格恢复条件的历史调用会显示“已自动纠正”，数据库和审计不变。

## 验证方式

按项目约束，本次实施后默认只执行静态验证，不自动运行测试套件：

1. 编写前端纯函数测试源码，覆盖：
   - `read_xlsx` 未找到后，同路径 `read_doc` 成功；
   - Windows 路径大小写和分隔符差异；
   - 路径不同、参数缺失、错误文本不同、非紧邻、后续失败；
   - 原有 `write_xlsx` 参数校验后同名成功重试。
2. 执行前端 TypeScript 类型检查。
3. 执行主进程 TypeScript 类型检查。
4. 执行 `git diff --check`。
5. 若用户明确授权，再运行对应前端测试。
6. 人工复核截图场景：工具组显示“已处理”，原 `read_xlsx` 行显示“已自动纠正”，展开后仍能看到原始错误，后续 `read_doc` 保持成功。

## 验收标准

1. `.xlsx` 的权威读取工具仍只有 `read_doc`。
2. 新会话中相关提示明确禁止推导 `read_xlsx`。
3. 截图所示的同路径成功恢复不再显示红色失败或“部分失败”。
4. 所有未恢复或非精确匹配的错误仍显示失败。
5. 原始工具记录、参数、错误详情和审计状态不被篡改。
6. Windows 路径比较不依赖当前运行平台，也不影响实际文件读取。

## 实施结果（2026-09-10）

- 已强化 `read_doc` 工具元数据及文档处理、数据分析内置技能说明。
- 已扩展并接入前端自动纠正判定；同路径 `read_xlsx` 未找到后由 `read_doc` 成功恢复时，工具组不再显示“部分失败”，失败行显示“已自动纠正”。
- 已保留原始工具参数、错误详情、数据库记录和审计状态。
- 已通过项目生成脚本更新内置技能生成产物。
- 前端 TypeScript 类型检查和 `git diff --check` 通过；主进程 TypeScript 类型检查仍被本次修改之外的既有错误阻塞，涉及 `src/agent/tools/subagent.ts` 和 `src/platform/windows_process.ts`。
- 按项目约束未运行测试套件。
