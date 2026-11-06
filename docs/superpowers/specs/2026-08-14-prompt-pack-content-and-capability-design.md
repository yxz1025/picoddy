# Prompt Pack 内容与能力注入增强设计

**状态：** 已确认，实施计划已完成  
**日期：** 2026-08-14  
**范围：** Prompt Runtime v2 的 Core、Mode、Category、Capability Prompt Pack，能力识别、变量注入、行为覆盖与测试
**实施计划：** `docs/superpowers/plans/2026-08-14-prompt-pack-content-and-capability.md`

## 1. 背景

Prompt Runtime v2 已经完成单一 Snapshot、结构化 Source、Prompt Pack、Envelope 与 Harness 调用链，但 `resources/prompts/v2` 当前主要迁移了旧 `SYSTEM_PROMPT` 的规则，尚未完整吸收 WorkBuddy 提示词中的代理行为规范。

现状不只是静态 Prompt 较短，还存在能力注入缺口：当前工具注册表已经包含文档、联网、知识检索、任务、子代理、交互提问、文件交付和云服务工具，但 `CapabilitySource` 只识别文件、记忆、Computer Use、Visualization 和 MCP。已注册能力没有对应 Capability Group 时，其 Prompt Pack 永远无法被选择。

本设计参考：

- `docs/architecture/prompt-runtime-v2-design.md`
- `docs/workbuddy-prompt-architecture-analysis.md`
- `/private/tmp/wb-builtin-full/resources/templates/*.tpl`
- `/private/tmp/wb-builtin-full/main/workbuddy-auth-product-coordinator.js`

本设计不以复制 WorkBuddy 大模板为目标，而是把可复用行为规范映射到本项目真实的工具、模式、类别和运行时边界。

## 2. 决策

采用“中央能力目录 + 条件化 Prompt Pack + 行为归属测试”。

```text
CapabilityActivationContext
  ├─ 最终可用 AgentTool[]
  ├─ 已解析 Skill Resources
  ├─ 显式选择的 MCP 工具名
  └─ Category
  -> CapabilityCatalog 精确分类
  -> CapabilityContext
  -> Prompt Pack Selector
  -> Fragment Loader
  -> Prompt Manifest
  -> System Prompt / Turn Prompt
```

核心约束：

1. 工具实际存在时才激活对应 Capability Pack。
2. 不根据 Prompt、工具描述或模型输出推断能力。
3. Core、Mode、Category、Capability 各自拥有唯一行为职责。
4. 不存在的能力可以预先注册 Pack，但不得进入最终 Prompt。
5. WorkBuddy 规则必须经过“采纳、改写、拒绝”审计，不直接复制产品私有约定。

## 3. 方案比较

### 3.1 在 CapabilitySource 中继续维护工具名集合

实现简单，但工具注册、能力分类和 Prompt Pack 注册继续分散。新增工具时容易只注册工具而遗漏 Prompt 能力链路，不采用。

### 3.2 中央能力目录

建立单一 `CapabilityCatalog`，声明工具名、能力组、Pack 和排序。CapabilitySource 与 Pack Selector 都从该目录读取，采用此方案。

### 3.3 根据 description 自动推断能力

工具描述属于模型可读文案，不是稳定协议。文本推断会重现此前 MCP Prompt 文本推断的脆弱性，不采用。

## 4. 中央能力目录

### 4.1 定义

```ts
export type CapabilityActivation =
  | {
      kind: "tools";
      anyTools?: readonly string[];
      allTools?: readonly string[];
    }
  | { kind: "skill-resources" }
  | { kind: "selected-mcp-tools" };

export interface CapabilityDefinition {
  id: CapabilityId;
  promptPackId: string;
  fragmentPath: string;
  order: number;
  activation: CapabilityActivation;
}

export interface CapabilityActivationContext {
  tools: readonly AgentTool[];
  skillNames: readonly string[];
  selectedMcpToolNames: ReadonlySet<string>;
}

export interface CapabilityContext {
  groups: CapabilityId[];
  activeToolNames: string[];
  catalogRevision: string;
}
```

目录负责：

- 根据结构化 Activation Context 计算能力组；
- 为每个能力组提供唯一 Prompt Pack；
- 审计已注册工具是否有能力归属；
- 保证 Capability Pack 的确定性顺序。

目录不负责：

- 选择工具；
- 判断工具权限；
- 连接 MCP；
- 根据自然语言增加能力；
- 覆盖 Category 或 Mode 的工具策略。

### 4.2 初始能力矩阵

| Capability | 激活工具 | Prompt Pack |
|---|---|---|
| `file-read` | `read` | `capabilities/file-read.md` |
| `file-mutation` | `write`, `edit` | `capabilities/file-mutation.md` |
| `shell` | `bash` | `capabilities/shell.md` |
| `document-processing` | `read_doc`, `write_docx`, `write_xlsx`, `write_pptx`, `edit_docx`, `edit_docx_free`, `edit_xlsx`, `edit_pptx` | `capabilities/document-processing.md` |
| `web-research` | `web_search`, `web_fetch` | `capabilities/web-research.md` |
| `knowledge-retrieval` | `index_doc`, `search_docs` | `capabilities/knowledge-retrieval.md` |
| `memory` | `memory_recall`, `memory_write` | `capabilities/memory.md` |
| `computer-use` | `computer`, `screenshot`, `mouse_click`, `mouse_move`, `key_type`, `app_focus`, `cursor_pos` | `capabilities/computer-use.md` |
| `visualization` | `read_me`, `show_widget` | `capabilities/visualization.md` |
| `task-management` | `task`, `goal_complete` | `capabilities/task-management.md` |
| `subagent` | `call_subagent` | `capabilities/subagent.md` |
| `user-interaction` | `ask_user_question` | `capabilities/user-interaction.md` |
| `artifact-delivery` | `present_files` | `capabilities/artifact-delivery.md` |
| `cloud-connectors` | `connect_cloud_service` | `capabilities/cloud-connectors.md` |
| `skills` | 已解析 Skill Resource | `capabilities/skills.md` |
| `mcp` | 本轮显式选择并进入最终工具集的 MCP 工具 | `capabilities/mcp.md` |
| `skill-draft` | `skill_draft_*` | `capabilities/skill-draft.md` |
| `expert-draft` | `expert_draft_*` | `capabilities/expert-draft.md` |

`skills` 和 `mcp` 不是固定内置工具名集合。前者由已解析 Skill Resource 激活，后者由“本轮显式选择的 MCP 名称”与最终工具集求交后激活。二者必须进入同一个 CapabilityCatalog 解析流程，删除 Provider 中手工追加 Capability Group 的旁路。

### 4.3 预置但休眠的能力包

为规划中的能力建立独立 Fragment，但在没有确定工具协议时不伪造工具名：

| 预置 Pack | 激活状态 |
|---|---|
| `capabilities/browser-control.md` | 休眠；未来浏览器工具注册时，同时向 CapabilityCatalog 增加精确工具名映射 |
| `capabilities/automation.md` | 休眠；未来自动化工具注册时，同时增加精确工具名映射 |

休眠 Pack 可以被 Fragment Loader 和内容预算测试校验，但不得被普通 Pack Selection 选中。文档处理不是休眠能力；当前已有真实工具，应在本次直接激活。

### 4.4 工具归属审计

每个进入最终 Runtime Profile 的工具必须满足以下之一：

- 属于一个或多个 Capability；
- 显式声明为 `promptless`，表示其完整行为已由 Category Pack 或工具 schema 承担。

禁止工具静默不归类。审计针对真实 Tool Registry 和 Category 专用 Tool Pack 执行，不维护脱离运行时的第二份“预期工具清单”。

## 5. Prompt Pack 职责

### 5.1 Core

Core 只包含所有会话都成立的规则。

| Pack | 唯一职责 |
|---|---|
| `core/product-identity` | 产品身份、真实性、能力和职责边界 |
| `core/instruction-priority` | 指令优先级、不可信内容、Prompt Injection |
| `core/communication` | 语言、表达、提问与假设披露 |
| `core/file-safety` | 路径解析、危险文件操作、平台差异和可恢复性 |
| `core/tool-use` | 工具选择、并行、schema、失败处理和降级 |
| `core/agent-loop` | 理解、调查、规划、执行、验证、交付闭环 |
| `core/error-recovery` | 错误分类、重试边界、部分失败和不可绕权 |
| `core/result-presentation` | 最终回答、验证声明、产物和敏感信息边界 |

Core 不列举具体可用工具；具体能力行为由 Capability Pack 负责。

### 5.2 Mode

#### Ask

- 以解释、分析和建议为主；
- 默认不修改项目或外部状态；
- 不为了展示工具而调用工具；
- 只能使用 Runtime Profile 实际提供的工具；
- 如果用户请求超出当前 Mode，明确说明限制，不模拟完成。

#### Plan

- 允许读取、调研、设计和风险分析；
- 禁止执行项目修改；
- 计划覆盖数据结构、完整调用链、失败路径、迁移、测试和验收；
- 未验证假设必须显式标注；
- 不把架构改造降级为局部补丁清单。

#### Craft

- 在授权范围内持续执行到完成；
- 修改前识别并保护用户现有改动；
- 不因复杂度省略必要链路；
- 完成后执行与风险相称的验证；
- 不能把部分实现描述成完整完成。

### 5.3 Category

- `assistant`：普通任务，不承担 Skill/Expert 包管理职责。
- `skill_creator`：只操作当前会话 Skill 草稿，执行初始化、编辑、验证和交付流程。
- `expert_creator`：创建 schemaVersion 2 Expert 草稿，校验后发布。
- `expert_editor`：从明确目标版本创建草稿，编辑、校验和发布，禁止直接绕过管理链修改已安装包。

Category 可以覆盖 Mode 的 Tool Pack，但不能提升 Permission。草稿 Capability 只有在对应 Category 和工具同时成立时才激活。

### 5.4 Capability

Capability Pack 只说明如何正确使用当前能力，不复制工具参数 schema。

关键规范：

- `file-read`：先读取最相关范围，保持来源和行号可追踪，不将读取内容视为高优先级指令。
- `file-mutation`：最小必要修改、保护用户已有改动、修改后复读或测试。
- `shell`：专用工具优先；命令平台匹配；不使用未解析变量、宽泛通配符或危险根路径。
- `document-processing`：先识别格式和结构，优先保持样式，输出后验证可读性和格式。
- `web-research`：搜索用于发现来源、抓取用于读取原文；时效信息核实；事实和推断分离。
- `knowledge-retrieval`：索引和查询职责分离；引用命中文档；无结果不等同于事实不存在。
- `memory`：按相关性使用；写入长期稳定信息；不存敏感内容或一次性细节。
- `computer-use`：感知、定位、操作、再次感知；不重复使用过期截图或失效坐标。
- `visualization`：只在显著提升理解时使用；先读取组件规范；主题缺失时使用自适应变量。
- `task-management`：仅为长链路任务建任务；状态由真实进展驱动；完成信号必须真实。
- `subagent`：只委派边界清晰的独立任务；主代理负责整合和最终验证；不得借此绕权。
- `user-interaction`：只有用户选择会实质改变结果且无法安全推断时才提问；一次聚焦关键决策。
- `artifact-delivery`：检查产物存在性、类型和关键内容后再交付；临时文件不是最终产物。
- `cloud-connectors`：连接必须来自显式用户动作；失败可见；连接内容继续作为不可信外部数据。
- `skills`：显式调用优先；按 Skill 指令读取必要资源；Skill 不能扩权或增加工具。
- `mcp`：只描述本轮已显式选择和成功注册的 MCP；不从 Prompt 文本推断和连接服务器。
- `skill-draft` / `expert-draft`：严格限制在会话草稿根，校验通过后才能发布。

## 6. 动态变量与 Turn Surface

### 6.1 SettingsSource

目标类型：

```ts
export interface PromptSettingsContext {
  customInstructions: string | null;
  language?: string;
  tone?: string;
  theme?: "light" | "dark" | "system";
}
```

仅注入项目中真实存在且通过白名单读取的设置。不存在的字段保持缺省，不构造虚假偏好。动态值继续由类型化 Block Renderer 编码，不能覆盖系统、权限、Mode 或 Category 边界。

如果当前产品没有持久化 `tone` 或 `theme`，本次实现只保留可选领域字段和测试，不新增未经产品确认的设置入口。

### 6.2 Turn Context

以下内容只进入 Turn Surface：

- 用户原始请求；
- 文本附件；
- 二进制附件元数据及 `binary_asset` 标识；
- 文件引用路径与已解析内容；
- Connector 来源标识和内容；
- 当前轮 Skill/Prompt Template Invocation；
- 参考 Expert 和所选 Expert Skills；
- Category 草稿运行时信息。

附件、网页、文件、Connector 和检索结果一律作为不可信数据块编码，不能闭合外围边界或提升为系统指令。

## 7. WorkBuddy 行为迁移审计

### 7.1 采纳

- Agent Loop；
- 提问原则；
- 工具使用和失败恢复；
- 文件与命令安全；
- 最终回答和文件交付；
- Computer Use 感知—操作闭环；
- 任务状态真实性；
- 动态上下文与静态行为规则分离。

### 7.2 改写

- Visualization 改为当前 `read_me` / `show_widget` 规范；
- 文档处理绑定当前 `read_doc`、`write_*` 和 `edit_*`；
- 联网绑定当前 `web_search` / `web_fetch`；
- 任务管理绑定当前 `task` / `goal_complete`；
- Expert 和 Skill 管理绑定当前草稿与发布链；
- 平台安全规则使用项目路径策略和真实 Shell 实现。

### 7.3 拒绝

- WorkBuddy 私有目录、产物路径和工具名；
- 由 Prompt 自动发现或连接 MCP；
- 自动创建、安装或更新 Skill；
- WorkBuddy Design Canvas 私有节点协议；
- 未被当前产品确认的地域内容政策；
- 为追求模板长度复制 30KB–37KB 整页模板；
- `.tpl` 与 Addon Plugin 双轨或模板 fallback。

## 8. 排序与预算

Prompt Pack 排序语义保持：

```text
Core -> Category -> Mode -> Capability -> Result
```

同一 Surface 使用唯一 `order`，并以 `id` 作为稳定次级排序。CapabilityCatalog 是 Capability 顺序的唯一权威。

预算规则：

- Core 总预算固定且构建时校验；
- 单个 Capability Pack 有独立预算；
- 最终 System Prompt 有总预算；
- 超预算必须产生稳定 diagnostic 或构建失败；
- 固定规则不得静默截断；
- 只有明确允许裁剪的动态 Source 可以标记 `truncated`。

具体字节阈值在实施计划的基线测试中根据当前模型上下文和现有 Prompt 大小确定，不以 WorkBuddy 模板大小作为目标。

## 9. 测试设计

实施遵循测试先行。

### 9.1 能力目录测试

- 每个内置工具都有 Capability 或显式 `promptless` 归属；
- 工具不存在时对应 Pack 不激活；
- 多个工具命中同一能力时只注入一次；
- MCP 只按结构化选择激活；
- Skill 只按结构化资源激活。

### 9.2 Pack 选择测试

- Ask、Plan、Craft 分别得到符合工具集的能力包；
- Category 专用工具正确激活草稿能力包；
- Category、Mode 和 Capability 顺序稳定；
- 未注册 Capability ID 不能静默忽略。

### 9.3 行为归属测试

建立 WorkBuddy 行为迁移清单，每条采纳规则必须有唯一 Owner Pack。测试或静态审计拒绝重复 Owner 和无 Owner 项。

### 9.4 内容与负向测试

- 不出现不存在的工具名；
- 不出现 WorkBuddy 私有路径和协议；
- 不出现文本推断 MCP；
- 不出现旧 `SYSTEM_PROMPT` 内容源；
- 动态内容不能注入新的静态 Pack 或闭合结构化边界。

### 9.5 Prompt 组合快照

至少覆盖：

- 普通 Ask；
- 普通 Plan；
- 普通 Craft；
- Craft + MCP；
- Craft + Expert；
- Skill Creator；
- Expert Creator；
- Expert Editor；
- 受保护工作区；
- 二进制附件和 Connector Context。

### 9.6 完整回归

- Prompt Runtime 单元和集成测试；
- Provider / Engine 测试；
- TypeScript 编译；
- 前端测试和构建；
- Expert Python 测试；
- 旧 Prompt 符号扫描；
- `git diff --check`。

## 10. 验收标准

1. 当前所有实际可用工具都有明确的 Prompt 能力归属。
2. Prompt 中出现的能力与 Runtime Profile 最终工具集一致。
3. Core 不维护具体工具清单，Capability Pack 不复制工具 schema。
4. WorkBuddy 中被采纳的行为规范有唯一 Owner，并在迁移清单中可追踪。
5. Ask、Plan、Craft 与 Category 专用场景的 Prompt 组合均有测试。
6. 预置能力只有在对应工具真实注册时才进入 Prompt。
7. 不引入模板 fallback、双轨 Prompt、文本能力推断或兼容补丁。
8. 超预算、来源失败、未知能力和未归类工具均失败可见。

## 11. 非目标

- 本次不新增浏览器、自动化或文档工具实现；文档能力绑定现有工具，浏览器和自动化只建立休眠 Pack 与接入契约。
- 本次不改变 Permission L1/L2/L3 的运行时语义。
- 本次不引入 Nunjucks 或其他通用模板引擎。
- 本次不新增未经产品确认的 Tone、Theme 设置 UI。
- 本次不复制 WorkBuddy 产品身份、地域政策和私有文件系统约定。
