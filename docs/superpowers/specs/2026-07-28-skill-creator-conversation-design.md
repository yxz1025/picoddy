# 会话式 Skill Creator 设计

## 目标

把“专家·技能·连接器”页面中的“添加技能”从基础信息弹窗升级为类似 WorkBuddy 的会话式创建流程。

用户点击“添加技能”后进入独立会话，由应用内置并强制激活的 `skill-creator` 技能引导需求澄清、规划技能目录、生成完整草稿和校验。生成结果先停留在隔离草稿区，只有用户点击“完成并安装”后才进入正式技能目录。

## 核心原则

- 真正使用 `skill-creator` 技能，不使用另一套同名提示词模拟它。
- `skill-creator` 随应用发布，不依赖开发机或用户机器上的 `~/.codex`。
- Agent 负责对话式创建和迭代；后端负责路径边界、持久化、校验和原子安装。
- 生成草稿不等于安装。安装必须由用户在界面中显式确认。
- 支持标准 Skill 包，而不只是一段 `SKILL.md` 文本。
- 保留现有已安装技能的编辑、启停和删除流程。

## 范围

本次包含：

- 内置并初始化 `skill-creator` 技能包。
- 点击“添加技能”创建专用会话并跳转。
- 专用会话固定展示 `skill-creator` 标签和创建提示。
- 将完整 `skill-creator` 指令注入专用 Agent 会话。
- 技能草稿的创建、读取、修改、删除、校验和状态查询。
- 草稿文件树、文件预览、校验结果和安装操作。
- 支持 `SKILL.md`、`agents/openai.yaml`、`scripts/`、`references/`、`assets/`。
- 显式安装、同名冲突保护和技能列表刷新。
- 前后端自动化测试及关键页面回归验证。

本次不包含：

- 技能市场发布和远端同步。
- 多人协同编辑同一草稿。
- 覆盖已安装同名技能。
- 任意目录写入或在草稿区外运行生成脚本。
- 将现有基础编辑弹窗升级为完整包编辑器；它继续用于已安装技能的轻量编辑。

## 方案选择

采用“内置技能包 + 专用会话 + 受控草稿域”的方案。

### 采用方案

应用源码内保存一个可打包的 `skill-creator` 技能定义及其必要辅助资源。应用启动时将其初始化到正式技能目录；创建会话时，后端明确读取该技能的 `SKILL.md` 并注入 Agent 上下文，同时提供只作用于当前草稿的工具。

这样既能保证 Agent 遵循真实的 `skill-creator` 工作流，也能保证桌面应用在没有 Codex 系统技能目录时独立运行。

### 未采用方案

- 直接引用 `~/.codex/skills/.system/skill-creator`：开发机可用，但发布后路径和版本不可控。
- 只发送 `/skill-creator` 文本：依赖模型自行发现和读取技能，无法保证专用流程每次都被激活。
- 独立表单向导：实现简单，但失去用户要求的对话式澄清和持续迭代体验。

## 用户流程

### 进入创建会话

1. 用户在“技能”页点击“添加技能”。
2. 前端创建 `category = "skill_creator"` 的新会话。
3. 前端选择该会话并切换到普通聊天区域。
4. 输入框顶部固定显示不可移除的 `skill-creator` 标签。
5. 空输入框显示：

   ```text
   请帮我创建一个可以实现「……」的 skill
   ```

6. 用户描述需求并发送，后端为该会话创建或恢复草稿。

### 对话生成

`skill-creator` 按以下阶段工作：

1. 理解目标、典型触发语和预期结果。
2. 判断是否需要脚本、参考资料、资源文件或 UI 元数据。
3. 初始化符合命名约束的技能目录。
4. 生成或修改 `SKILL.md` 和必要资源。
5. 执行结构与内容校验。
6. 向用户总结当前草稿、未决问题和校验状态。

每次文件变化后，页面中的草稿面板实时刷新。

### 预览与安装

1. 草稿面板展示文件树、选中文件内容、最后更新时间和校验结果。
2. 校验未通过时，“完成并安装”保持禁用，并显示可操作的错误。
3. 校验通过后，用户点击“完成并安装”。
4. 后端再次校验并检查同名冲突。
5. 安装成功后刷新技能列表、标记草稿已安装，并保留当前会话及历史。
6. 用户可以从技能管理页查看、启停或删除新技能。

## 内置 `skill-creator`

### 发布方式

`skill-creator` 以源码可嵌入的文件映射随应用构建，避免桌面打包遗漏外部静态目录。启动时由技能初始化逻辑写入：

```text
~/.pi-a/skills/skill-creator/
├── SKILL.md
├── agents/
│   └── openai.yaml
├── references/
│   └── openai_yaml.md
└── scripts/
    ├── init_skill.py
    ├── generate_openai_yaml.py
    └── quick_validate.py
```

内置技能必须保持标准约束：

- 技能名为 `skill-creator`。
- `SKILL.md` frontmatter 只包含 `name` 和 `description`。
- 名称使用小写字母、数字和连字符，长度不超过 64。
- 只按需创建 `scripts/`、`references/`、`assets/`。
- 不生成 README、CHANGELOG 等无关文件。
- 使用渐进披露，避免把大段参考资料塞入 `SKILL.md`。

### 激活方式

当会话类别为 `skill_creator` 时，Agent Provider 必须：

1. 解析当前会话对应的草稿 ID。
2. 读取已初始化的 `skill-creator/SKILL.md`。
3. 将技能正文作为专用技能指令加入系统上下文。
4. 明确本次唯一允许修改的目标是当前草稿。
5. 注册草稿工具并传入当前草稿 ID。
6. 禁止 Agent 将草稿直接复制到正式安装目录。

普通会话仍沿用现有技能发现和斜杠激活逻辑，不受影响。

## 草稿域

### 存储结构

草稿保存在：

```text
~/.pi-a/skill-drafts/<draft-id>/
├── draft.json
└── package/
    ├── SKILL.md
    ├── agents/
    ├── scripts/
    ├── references/
    └── assets/
```

`draft.json` 至少包含：

```ts
interface SkillDraftMetadata {
  id: string;
  conversationId: string;
  status: "editing" | "valid" | "installed";
  skillName?: string;
  createdAt: number;
  updatedAt: number;
  installedAt?: number;
}
```

一个创建会话只对应一个草稿。重复打开会话时恢复原草稿；草稿安装后保持只读，后续修改需要创建新草稿。

### 受控工具

专用 Agent 可使用以下逻辑能力：

- `skill_draft_init`：初始化标准目录和 `SKILL.md`。
- `skill_draft_list`：列出草稿内文件及类型。
- `skill_draft_read`：读取文本文件或二进制元数据。
- `skill_draft_write`：创建或覆盖草稿内文件。
- `skill_draft_delete`：删除草稿内文件或空目录。
- `skill_draft_validate`：执行标准校验并返回结构化结果。

所有工具都由会话上下文隐式绑定 `draftId`，模型不能指定其他草稿或绝对路径。

路径规则：

- 只允许相对于 `package/` 的规范化路径。
- 拒绝绝对路径、`..`、符号链接和空路径。
- 允许根文件 `SKILL.md`、`agents/openai.yaml` 以及 `scripts/`、`references/`、`assets/` 下的文件。
- 文本写入设置大小上限；二进制资源通过已有附件能力导入，不允许模型伪造任意二进制内容。
- 脚本文件可生成和预览，但创建阶段不自动执行不受信任脚本。

附件导入通过 `skill_draft_import_attachment` 完成。工具只能引用当前消息或当前会话中已上传的附件，并只能写入 `assets/`；后端负责复制原始字节、清理文件名和拒绝符号链接。普通文本附件仍可以由 Agent 读取后整理到 `references/`。

每次写入、删除或导入文件都会把草稿状态重置为 `editing`；只有完整校验成功后才变为 `valid`。

## 校验

后端校验器覆盖内置 `quick_validate.py` 的规则，并针对应用安装安全做进一步收紧。它输出结构化错误，至少检查：

- `SKILL.md` 存在且可读取。
- YAML frontmatter 合法。
- frontmatter 只有 `name` 和 `description`。
- `name` 符合小写连字符规范且不超过 64 字符；安装目标目录必须使用该名称。
- `description` 非空，并清楚描述能力和触发场景。
- 不存在路径穿越、符号链接或范围外文件。
- 不存在 README、CHANGELOG 等不应生成的附加文档。
- `agents/openai.yaml` 存在时 YAML 合法，且界面元数据与技能一致。

返回格式：

```ts
interface SkillDraftValidation {
  valid: boolean;
  errors: Array<{ path?: string; code: string; message: string }>;
  warnings: Array<{ path?: string; code: string; message: string }>;
  checkedAt: number;
}
```

警告不阻塞安装，错误阻塞安装。

## 后端 API

### 创建专用会话

沿用现有会话创建接口，增加：

```json
{
  "category": "skill_creator"
}
```

草稿可以在会话创建时初始化，也可以在首次发送消息时惰性初始化；对前端表现一致。

### 草稿查询

```text
GET /api/skill-drafts/by-conversation/:conversationId
GET /api/skill-drafts/:draftId
GET /api/skill-drafts/:draftId/files
GET /api/skill-drafts/:draftId/file?path=...
```

二进制资源导入由 Agent 的受控工具完成，不向浏览器暴露可指定任意源文件路径的复制接口。

### 草稿校验

```text
POST /api/skill-drafts/:draftId/validate
```

返回 `SkillDraftValidation`。

### 安装

```text
POST /api/skill-drafts/:draftId/install
```

处理顺序：

1. 确认草稿存在、属于有效创建会话且未安装。
2. 重新执行完整校验。
3. 从 `SKILL.md` 解析最终技能名。
4. 检查 `~/.pi-a/skills/<name>` 不存在。
5. 将草稿复制到同一文件系统内的临时安装目录。
6. 再次检查目标并通过重命名完成原子安装。
7. 更新草稿状态和时间。
8. 返回已安装技能元数据。

同名冲突返回 `409`，不覆盖现有技能，也不修改草稿内容。

## 前端设计

### “添加技能”入口

`ExpertPanel` 中：

- “添加技能”不再打开基础信息弹窗。
- 点击后调用 `startSkillCreatorChat()`。
- 创建失败时保留当前页面并显示错误。
- 现有编辑已安装技能弹窗保持不变。

### Composer

根据当前会话的 `category` 渲染专用状态：

- 固定 `skill-creator` 技能标签，不提供删除按钮。
- 使用专用 placeholder。
- 不允许切换成其他技能标签覆盖 `skill-creator`。
- 文件附件入口继续可用，以便提供参考资料或导入 assets。
- 发送仍走现有 `/api/prompt` 事件流。

前端不需要把 `/skill-creator` 写入用户可见文本；后端根据会话类别可靠激活技能。

### SkillDraftPanel

在创建会话的聊天区域显示可折叠侧栏或内嵌面板：

- 顶部：草稿名称、状态、校验摘要。
- 左侧：文件树。
- 右侧：文本预览或二进制文件信息。
- 底部：重新校验、完成并安装。

状态：

- 尚未生成：引导用户先描述目标。
- 生成中：保留上次内容并显示更新提示。
- 校验失败：定位到相关文件并展示错误。
- 可安装：突出“完成并安装”。
- 安装中：禁用重复操作。
- 已安装：显示成功状态和“查看技能”入口。
- 同名冲突：提示返回技能页处理现有技能，不自动覆盖。

面板通过草稿查询 API 获取权威状态；在 Agent 工具执行完成事件或一次响应结束后刷新，避免高频轮询。

## 事件与错误处理

- 专用会话继续使用现有 prompt 流式事件协议。
- 草稿工具错误必须转换为 Agent 可理解的工具结果，同时通过最终响应向用户说明。
- 如果 `skill-creator` 内置技能缺失或损坏，创建会话请求失败并给出可恢复错误，不退化成普通聊天。
- 页面刷新后依据会话类别和 conversation ID 恢复草稿面板。
- Agent 响应失败不丢失已经写入的草稿文件。
- 安装接口失败不改变草稿为已安装状态。
- 安装成功后的技能列表刷新失败只提示重新加载，不回滚已完成的安装。

## 安全边界

- Agent 永远不能直接指定正式技能安装路径。
- 草稿工具不接受绝对路径或客户端传入的根目录。
- 校验和安装分别执行路径安全检查，避免 TOCTOU 式绕过。
- 安装拒绝符号链接和特殊文件。
- 默认不执行生成的脚本。
- 同名技能永不静默覆盖。
- API 错误不向前端暴露主目录绝对路径。

## 测试策略

### 后端

- 初始化内置 `skill-creator` 后文件齐全且可被技能扫描器发现。
- `skill_creator` 会话确实加载 `skill-creator` 正文和草稿工具。
- 草稿与 conversation 一一绑定。
- 允许合法文件并拒绝路径穿越、绝对路径、符号链接和越界目录。
- 标准 Skill 包校验通过。
- frontmatter、名称、描述、非法附加文档等错误可被精确识别。
- 安装成功后目录完整，草稿状态正确。
- 同名安装返回 `409`，原技能不变。
- 重复安装被拒绝。

### 前端

- 点击“添加技能”创建并进入 `skill_creator` 会话。
- Composer 显示固定标签和专用 placeholder。
- 普通会话不显示专用状态。
- 草稿面板正确展示空、生成中、失败、可安装和已安装状态。
- 校验失败时安装按钮禁用。
- 安装成功后技能列表刷新。
- 编辑已安装技能的现有入口不回归。

### 端到端

1. 从技能页点击“添加技能”。
2. 输入一个明确的技能需求。
3. 验证 Agent 使用 `skill-creator` 创建标准文件结构。
4. 打开并检查多个草稿文件。
5. 验证校验成功后才能安装。
6. 安装后在技能列表中看到新技能。
7. 新建普通会话并通过技能标签或斜杠命令激活它。

## 验收标准

- “添加技能”进入会话页，不再打开新建基础信息弹窗。
- 创建会话由真实、内置的 `skill-creator` 驱动。
- 用户可以在聊天过程中持续修改完整技能包。
- 页面能够预览草稿文件及校验结果。
- 未点击“完成并安装”前，正式技能目录不出现新技能。
- 校验失败、同名冲突和安装失败均不会破坏原技能或草稿。
- 安装成功后无需重启即可在技能列表和普通会话中使用新技能。
- PDF/Excel 附件及现有消息事件流修复不发生回归。
