# Prompt Runtime v2 Implementation Plan

> **项目执行约束：** 本项目禁止使用 `superpowers` / `using-superpowers`。实施时使用项目原生工具逐任务执行；每个任务都必须通过对应测试后再进入下一任务。

**Goal:** 用一条类型化、可追踪、Pi Harness 原生的 Prompt Runtime 替换现有 System Prompt、Mode addon、Expert addon、Skill 全量拼接和 Prompt 文本推断 MCP。

**Architecture:** 每轮先解析 `SessionIntent` 与 `TurnIntent`，再由统一 Policy 生成 `RuntimeProfile`，由固定顺序 Context Sources 生成一个不可变 Snapshot，最后生成同时携带 Prompt、Tools、Resources、Permission Policy 和 Manifest 的 `PromptEnvelope`。工具可见性由 Category/Mode/显式 MCP 决定，Permission 只在执行 hooks 中授权。Provider 保留 Session 生命周期和队列，但不再拥有 Prompt 业务规则。

**Tech Stack:** TypeScript、Node.js、Electron、SQLite、`@earendil-works/pi-agent-core`、Node test runner via `tsx --test`。

**设计依据：** `docs/architecture/prompt-runtime-v2-design.md`

---

## File Map

### Prompt Runtime

- `src/agent/prompt-runtime/types.ts`：所有 Intent、Profile、Snapshot、Envelope 和 Manifest 类型。
- `src/agent/prompt-runtime/diagnostics.ts`：稳定错误码和无敏感内容诊断。
- `src/agent/prompt-runtime/session-intent.ts`：从 Conversation、Workspace 和 PromptOptions 解析会话意图。
- `src/agent/prompt-runtime/turn-intent.ts`：解析 Skill/PromptTemplate invocation 和结构化本轮上下文。
- `src/agent/prompt-runtime/mode-policy.ts`：Ask/Plan/Craft 行为与基础工具语义。
- `src/agent/prompt-runtime/category-policy.ts`：Assistant/Creator 组合约束。
- `src/agent/prompt-runtime/tool-policy.ts`：Mode、Category、显式 MCP 工具的唯一组合点，不接受 Permission。
- `src/agent/prompt-runtime/permission-policy.ts`：封装现有平台 sandbox、确认和危险调用 hooks，不过滤工具。
- `src/agent/prompt-runtime/runtime-profile.ts`：协调 Policy、Expert 和 Resources。
- `src/agent/prompt-runtime/context-assembler.ts`：固定顺序执行 Context Sources，一轮一次。
- `src/agent/prompt-runtime/prompt-packs.ts`：Prompt Pack Registry。
- `src/agent/prompt-runtime/fragment-loader.ts`：只加载 Registry 中的无变量 Markdown Fragment。
- `src/agent/prompt-runtime/block-renderers.ts`：从类型化 Context 生成动态 System blocks。
- `src/agent/prompt-runtime/boundary-encoding.ts`：稳定 JSON TurnPayload 和固定边界编码。
- `src/agent/prompt-runtime/manifest.ts`：来源摘要、hash 和不变量验证。
- `src/agent/prompt-runtime/envelope-builder.ts`：构建最终 Envelope。
- `src/agent/prompt-runtime/prompt-aware-harness.ts`：原子设置 Prompt、Tools、Resources 并调用 Harness。
- `src/agent/prompt-runtime/sources/*.ts`：环境、Workspace、Settings、Memory、Skill、Expert、Capability、Turn Context。

### Prompt Resources

- `resources/prompts/v2/core/*.md`
- `resources/prompts/v2/modes/*.md`
- `resources/prompts/v2/categories/*.md`
- `resources/prompts/v2/capabilities/*.md`

动态内容不使用 `.tpl` 文件或通用模板引擎。

### Existing Integration Points

- `src/agent/provider.ts`
- `src/agent/engine.ts`
- `src/agent/skills.ts`
- `src/agent/experts/runtime_profile.ts`
- `src/agent/mcp.ts`
- `application.electron.ts`

---

### Task 1: 建立核心类型和稳定错误

**Files:**
- Create: `src/agent/prompt-runtime/types.ts`
- Create: `src/agent/prompt-runtime/diagnostics.ts`
- Create: `src/agent/prompt-runtime/types.test.ts`

- [ ] **Step 1: 写失败测试，固定 Envelope 和错误码契约**

```ts
import assert from "node:assert/strict";
import test from "node:test";
import { PromptRuntimeError } from "./diagnostics.ts";
import { freezePromptSnapshot } from "./types.ts";

test("freezePromptSnapshot returns an immutable snapshot", () => {
  const snapshot = freezePromptSnapshot({
    schemaVersion: 2,
    snapshotId: "s1",
    sessionId: "c1",
    turnId: "t1",
    createdAt: "2026-08-14T00:00:00.000Z",
    environment: {}, workspace: {}, settings: {}, memory: {}, skills: {},
    capabilities: {}, turn: {}, sourceRevisions: {}, diagnostics: [],
  });
  assert.equal(Object.isFrozen(snapshot), true);
});

test("PromptRuntimeError exposes a stable code and status", () => {
  const error = new PromptRuntimeError("CATEGORY_MODE_NOT_ALLOWED", 400, "invalid mode");
  assert.equal(error.code, "CATEGORY_MODE_NOT_ALLOWED");
  assert.equal(error.status, 400);
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx tsx --test src/agent/prompt-runtime/types.test.ts`
Expected: FAIL，模块尚不存在。

- [ ] **Step 3: 实现类型与错误**

在 `types.ts` 定义设计文档中的 `InteractionMode`、`SessionCategory`、`SessionIntent`、`TurnIntent`、`RuntimeProfile`、`PromptContextSnapshot`、`PromptEnvelope`、`PromptManifest`、`PromptDiagnostic` 和 `SourceRevision`。`freezePromptSnapshot()` 必须冻结顶层和各一层 Context 对象及数组。

在 `diagnostics.ts` 定义以下错误码联合类型：

```ts
export type PromptRuntimeErrorCode =
  | "CATEGORY_MODE_NOT_ALLOWED"
  | "PROMPT_SOURCE_FAILED"
  | "PROMPT_FRAGMENT_INVALID"
  | "PROMPT_CONTEXT_LIMIT_EXCEEDED"
  | "INVOCATION_NOT_FOUND"
  | "MCP_SELECTION_INVALID";
```

`EXPERT_SCHEMA_VERSION_UNSUPPORTED` 属于 Expert package/catalog 错误联合类型；绑定 Expert 初始化失败时作为 `EXPERT_INITIALIZATION_FAILED` 的内部 cause，不混入普通 Prompt Runtime 错误。

- [ ] **Step 4: 运行测试与类型检查**

Run: `npx tsx --test src/agent/prompt-runtime/types.test.ts`
Expected: PASS。

Run: `npx tsc --project tsconfig.electron.json --noEmit`
Expected: exit 0。

- [ ] **Step 5: Commit**

```bash
git add src/agent/prompt-runtime/types.ts src/agent/prompt-runtime/diagnostics.ts src/agent/prompt-runtime/types.test.ts
git commit -m "feat: define prompt runtime contracts"
```

### Task 2: Mode 和 Category Policy

**Files:**
- Create: `src/agent/prompt-runtime/mode-policy.ts`
- Create: `src/agent/prompt-runtime/category-policy.ts`
- Create: `src/agent/prompt-runtime/mode-category-policy.test.ts`

- [ ] **Step 1: 写全矩阵失败测试**

测试必须覆盖：

```ts
const allowed = [
  ["assistant", "ask"], ["assistant", "plan"], ["assistant", "craft"],
  ["skill_creator", "craft"], ["expert_creator", "craft"],
] as const;

const rejected = [
  ["skill_creator", "ask"], ["skill_creator", "plan"],
  ["expert_creator", "ask"], ["expert_creator", "plan"],
] as const;
```

断言 Ask 为 `none` capability、Plan 为 `readonly`、Craft 为 `full`；非法组合抛出 `CATEGORY_MODE_NOT_ALLOWED`。

- [ ] **Step 2: 确认测试失败**

Run: `npx tsx --test src/agent/prompt-runtime/mode-category-policy.test.ts`
Expected: FAIL，Policy 未实现。

- [ ] **Step 3: 实现纯函数 Policy**

```ts
export function resolveModeProfile(mode: InteractionMode): ModeProfile;
export function resolveCategoryProfile(
  category: SessionCategory,
  operation?: ExpertOperation,
): CategoryProfile;
export function assertCategoryModeAllowed(
  category: SessionCategory,
  mode: InteractionMode,
): void;
```

Policy 不导入 Provider、DB 或 Harness。

- [ ] **Step 4: 运行测试**

Run: `npx tsx --test src/agent/prompt-runtime/mode-category-policy.test.ts`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add src/agent/prompt-runtime/mode-policy.ts src/agent/prompt-runtime/category-policy.ts src/agent/prompt-runtime/mode-category-policy.test.ts
git commit -m "feat: resolve prompt mode and category policy"
```

### Task 3: 正交化 Tool Availability 与 Permission Policy

**Files:**
- Create: `src/agent/prompt-runtime/tool-policy.ts`
- Create: `src/agent/prompt-runtime/tool-policy.test.ts`
- Create: `src/agent/prompt-runtime/permission-policy.ts`
- Create: `src/agent/prompt-runtime/permission-policy.test.ts`
- Modify: `src/agent/tools/index.ts`

- [ ] **Step 1: 写不变量测试**

构造带 `read/write/bash/mcp_demo` 名称的假工具，验证：

- Ask 结果为空。
- Plan 只使用 `getReadOnlyTools()` 的结果。
- Craft 才能合并显式 MCP 工具。
- Creator 使用 Category Tool Pack，不受 Assistant Mode Tool Pack 替换。
- 重名工具按名称去重。
- 对同一 Mode/Category/MCP 输入，L1/L2/L3 的工具名称完全相同。
- Expert capability hints 不作为函数输入，无法扩权。
- Permission Policy 保留 macOS 与 Windows 的现有 sandbox/confirmation/dangerous-call 行为。

- [ ] **Step 2: 确认测试失败**

Run: `npx tsx --test src/agent/prompt-runtime/tool-policy.test.ts src/agent/prompt-runtime/permission-policy.test.ts`
Expected: FAIL。

- [ ] **Step 3: 实现唯一工具组合入口**

```ts
export interface ResolveToolPolicyInput {
  mode: ModeProfile;
  category: CategoryProfile;
  sessionRoot: SessionRoot;
  protectedPathPolicy: ProtectedPathPolicy;
  selectedMcpTools: AgentTool[];
}

export function resolveToolPolicy(input: ResolveToolPolicyInput): ResolvedToolPolicy;
```

将 Provider 当前 `toolsForConversation()` 的 Category 优先、否则 Mode 分支迁入此文件；`tools/index.ts` 继续只负责构建 Tool Pack。MCP 只有在显式选择且当前 Tool Capability 允许时合并。

`permission-policy.ts` 封装现有 `permissions.ts` 的运行时 hook 判定，输入为 tool call、platform 和 permission level，输出 allow/block/confirm；不得返回或修改工具数组。本任务不统一 macOS/Windows 权限语义。

- [ ] **Step 4: 运行测试和类型检查**

Run: `npx tsx --test src/agent/prompt-runtime/tool-policy.test.ts src/agent/prompt-runtime/permission-policy.test.ts`
Expected: PASS。

Run: `npx tsc --project tsconfig.electron.json --noEmit`
Expected: exit 0。

- [ ] **Step 5: Commit**

```bash
git add src/agent/prompt-runtime/tool-policy.ts src/agent/prompt-runtime/tool-policy.test.ts src/agent/prompt-runtime/permission-policy.ts src/agent/prompt-runtime/permission-policy.test.ts src/agent/tools/index.ts
git commit -m "refactor: separate tool availability from permission policy"
```

### Task 4: Skill Resources 和 Invocation 路由

**Files:**
- Modify: `src/agent/skills.ts`
- Create: `src/agent/prompt-runtime/turn-intent.ts`
- Create: `src/agent/prompt-runtime/turn-intent.test.ts`
- Create: `src/agent/prompt-runtime/sources/skills.ts`

- [ ] **Step 1: 写失败测试**

覆盖：

- `loadSkillResources()` 返回 Pi `Skill[]`，保留 name/description/content/filePath。
- `/known argument` 解析为 Skill 或 Prompt Template invocation。
- 普通文本不是 invocation。
- 未知 slash command 抛出 `INVOCATION_NOT_FOUND`。
- 当前资源目录没有 `plan` Skill/PromptTemplate，因此 `/plan` 返回 `INVOCATION_NOT_FOUND`，不能切换 Mode。
- `selectedSkillNames` 不参与普通 slash 路由。

- [ ] **Step 2: 确认测试失败**

Run: `npx tsx --test src/agent/prompt-runtime/turn-intent.test.ts`
Expected: FAIL。

- [ ] **Step 3: 修改 Skill API**

保留现有扫描优先级、禁用 frontmatter 和大小边界，将公开函数改为：

```ts
export function loadSkillResources(): Skill[];
export function loadPromptTemplateResources(): PromptTemplate[];
```

删除项目自定义 `<skills>` 字符串格式化职责。Builtin/User 同名仍按当前优先级去重；模型可见列表统一由 Pi Core `formatSkillsForSystemPrompt()` 根据同一份 Resources 生成。

- [ ] **Step 4: 实现 TurnIntentResolver**

```ts
export function resolveTurnIntent(input: {
  turnId: string;
  text: string;
  skills: Skill[];
  promptTemplates: PromptTemplate[];
  attachments: AttachmentContextItem[];
  fileReferences: FileReferenceContext[];
  connectorContext: ConnectorContextItem[];
}): TurnIntent;
```

- [ ] **Step 5: 运行测试**

Run: `npx tsx --test src/agent/prompt-runtime/turn-intent.test.ts`
Expected: PASS。

- [ ] **Step 6: Commit**

```bash
git add src/agent/skills.ts src/agent/prompt-runtime/turn-intent.ts src/agent/prompt-runtime/turn-intent.test.ts src/agent/prompt-runtime/sources/skills.ts
git commit -m "feat: expose pi-native skill resources"
```

### Task 5: Environment、Workspace、Settings 与 Memory Sources

**Files:**
- Create: `src/agent/prompt-runtime/sources/environment.ts`
- Create: `src/agent/prompt-runtime/sources/workspace.ts`
- Create: `src/agent/prompt-runtime/sources/settings.ts`
- Create: `src/agent/prompt-runtime/sources/memory.ts`
- Create: `src/agent/prompt-runtime/sources/base.ts`
- Create: `src/agent/prompt-runtime/sources/sources.test.ts`

- [ ] **Step 1: 写 Source 测试**

使用依赖注入的 fake settings/memory/platform，验证：

- Environment 使用真实平台变量，不替换整段 Prompt。
- Workspace 解析失败抛出 `PROMPT_SOURCE_FAILED`。
- `agent_system_prompt` 超过 8,000 字符时抛出 `PROMPT_CONTEXT_LIMIT_EXCEEDED`，不截断。
- Working Memory 预算 8,000，User Memory 预算 4,000。
- Working Memory 按 `createdAt DESC, id ASC`，User Memory 按 `updatedAt DESC, id ASC`。
- Memory 按完整条目裁剪，绝不返回半条内容。
- Memory 预算丢弃产生不含正文的 diagnostic；Memory Source 错误产生 diagnostic，不静默消失。

- [ ] **Step 2: 确认测试失败**

Run: `npx tsx --test src/agent/prompt-runtime/sources/sources.test.ts`
Expected: FAIL。

- [ ] **Step 3: 实现 SourceResult 和预算函数**

```ts
export interface PromptSourceResult<T> {
  value: T;
  revision: SourceRevision;
  diagnostics: PromptDiagnostic[];
}

export function takeWholeEntriesWithinBudget<T>(
  entries: readonly T[],
  budget: number,
  render: (entry: T) => string,
): { included: T[]; dropped: number; text: string };
```

- [ ] **Step 4: 实现四个 Source**

所有 Store/Platform/Workspace 访问通过构造函数依赖传入，便于测试。Context Source 不允许写数据库或文件。

- [ ] **Step 5: 运行测试**

Run: `npx tsx --test src/agent/prompt-runtime/sources/sources.test.ts`
Expected: PASS。

- [ ] **Step 6: Commit**

```bash
git add src/agent/prompt-runtime/sources
git commit -m "feat: collect bounded prompt context sources"
```

### Task 6: 结构化 Expert Runtime Profile

**Files:**
- Modify: `src/agent/experts/types.ts`
- Modify: `src/agent/experts/runtime_profile.ts`
- Modify: `src/agent/experts/runtime_profile.test.ts`
- Modify: `src/agent/experts/installed_skill.ts`
- Modify: `src/agent/experts/installed_catalog.ts`
- Modify: `src/agent/experts/installed_catalog.test.ts`
- Modify: `frontend/src/components/ExpertPanel.tsx`
- Modify: `resources/builtin-skills/expert-manager/SKILL.md`
- Modify: `resources/builtin-skills/expert-manager/scripts/validate_expert.py`
- Modify: `resources/builtin-skills/expert-manager/scripts/init_expert.py`
- Modify: `resources/builtin-skills/expert-manager/scripts/package_expert.py`
- Create: `src/agent/prompt-runtime/sources/expert.ts`

- [ ] **Step 1: 重写现有测试为结构化断言**

测试不再调用 `assembleSystemPromptSections()`。断言：

- Profile 包含 persona/workflow/revision/source。
- Expert Skill 使用 `expert/<expertId>/<skillName>` namespace。
- `always` 与 `on-demand` 分离。
- Expert preferredTools/MCP 仅为 hint，不出现在 Profile 的 active tools。
- 超预算 Expert 整体失败，不截断单个 Skill。
- schemaVersion 不是 2 的包返回 `EXPERT_SCHEMA_VERSION_UNSUPPORTED`，不进入可选目录。
- Catalog diagnostic 不暴露本地绝对路径；前端提示重新创建或重新安装。

- [ ] **Step 2: 运行测试确认失败**

Run: `npx tsx --test src/agent/experts/runtime_profile.test.ts`
Expected: FAIL，当前返回字符串 addon。

- [ ] **Step 3: 实现结构化 Profile**

```ts
export interface ExpertRuntimeProfile {
  expertId: string;
  revision: string;
  source: ExpertCatalogSource;
  persona: ControlledPromptBlock;
  workflow: ControlledPromptBlock;
  alwaysOnSkills: ControlledPromptBlock[];
  resourceSkills: Skill[];
  capabilityHints: string[];
}
```

更新 Expert 包校验与生成脚本使用 `schemaVersion: 2`；旧 schema 返回 `EXPERT_SCHEMA_VERSION_UNSUPPORTED`，不增加转换分支。若会话绑定的包失效，对外保留 `EXPERT_INITIALIZATION_FAILED`，并把版本错误作为内部 cause。

- [ ] **Step 4: 实现 ExpertSource**

`ExpertSource` 只读取已经解析好的 `ExpertRuntimeProfile`，生成 Snapshot Context 和 Resources，不读取 Registry 或网络。

- [ ] **Step 5: 运行 Expert 全部测试**

Run: `npx tsx --test src/agent/experts/*.test.ts frontend/src/types/experts.test.ts`
Expected: PASS。

- [ ] **Step 6: Commit**

```bash
git add src/agent/experts src/agent/prompt-runtime/sources/expert.ts resources/builtin-skills/expert-manager frontend/src/components/ExpertPanel.tsx
git commit -m "refactor: expose structured expert runtime profiles"
```

### Task 7: Prompt Fragment Registry 与类型化 Renderer

**Files:**
- Create: `resources/prompts/v2/**`
- Create: `src/agent/prompt-runtime/prompt-packs.ts`
- Create: `src/agent/prompt-runtime/fragment-loader.ts`
- Create: `src/agent/prompt-runtime/block-renderers.ts`
- Create: `src/agent/prompt-runtime/boundary-encoding.ts`
- Create: `src/agent/prompt-runtime/renderers.test.ts`

- [ ] **Step 1: 写 Fragment 与 Renderer 失败测试**

覆盖：Registry 外路径、缺失文件、静态 Fragment 含 `{{...}}`、同 surface 重复 order、按 `(order,id)` 稳定排序、动态值中的 `</turn_payload>`、中文/代码/路径 JSON 编码，以及类型化 Block 的固定字段顺序。

- [ ] **Step 2: 确认测试失败**

Run: `npx tsx --test src/agent/prompt-runtime/renderers.test.ts`
Expected: FAIL。

- [ ] **Step 3: 创建 Prompt 资源**

严格按设计文档 7.1 的 10 项迁移矩阵拆分当前 `SYSTEM_PROMPT`。工具清单不得复制到静态文件；平台路径不得硬编码；Mode 规则只出现在对应 Mode 文件；Creator 规则只出现在对应 Category 文件。为每一项建立旧行为到新 Fragment/Source 的测试或审计记录。

- [ ] **Step 4: 实现 FragmentLoader 和类型化 Renderer**

FragmentLoader 只读取 Registry 中的无变量 Markdown。动态 Block 使用领域类型入参，不接受变量 Map；Turn Surface 使用标准 JSON 序列化：

```ts
export function renderEnvironmentBlock(value: EnvironmentContext): string;
export function renderMemoryBlock(value: MemoryContext): string;
export function renderTurnPayload(value: TurnContext): string;
```

外围标签和属性名固定在实现中，属性值执行 XML escape，正文使用 `JSON.stringify()`；不引入 Nunjucks 或任何通用模板引擎。

- [ ] **Step 5: 运行测试**

Run: `npx tsx --test src/agent/prompt-runtime/renderers.test.ts`
Expected: PASS。

- [ ] **Step 6: Commit**

```bash
git add resources/prompts/v2 src/agent/prompt-runtime/prompt-packs.ts src/agent/prompt-runtime/fragment-loader.ts src/agent/prompt-runtime/block-renderers.ts src/agent/prompt-runtime/boundary-encoding.ts src/agent/prompt-runtime/renderers.test.ts
git commit -m "feat: add typed prompt fragment rendering"
```

### Task 8: Context Assembler、Manifest 与 Envelope

**Files:**
- Create: `src/agent/prompt-runtime/context-assembler.ts`
- Create: `src/agent/prompt-runtime/manifest.ts`
- Create: `src/agent/prompt-runtime/envelope-builder.ts`
- Create: `src/agent/prompt-runtime/envelope-builder.test.ts`
- Create: `src/agent/prompt-runtime/sources/capabilities.ts`
- Create: `src/agent/prompt-runtime/tool-metadata.test.ts`

- [ ] **Step 1: 写一次性采集与一致性测试**

为每个 fake Source 记录调用次数，断言固定顺序且每个 Source 恰好一次。构建 Envelope 后断言：

```ts
assert.deepEqual(envelope.manifest.activeTools, envelope.activeToolNames);
assert.deepEqual(envelope.activeToolNames, envelope.tools.map((tool) => tool.name));
assert.equal(envelope.manifest.snapshotId, envelope.snapshotId);
```

另测 Manifest 不包含 memory/custom/expert/skill 原文；不同 `snapshotId`/`createdAt` 的确定性内容产生相同 `contentHash`，任一 Fragment/Source/tool/resource 确定性内容变化都会改变 hash。

- [ ] **Step 2: 确认测试失败**

Run: `npx tsx --test src/agent/prompt-runtime/envelope-builder.test.ts src/agent/prompt-runtime/tool-metadata.test.ts`
Expected: FAIL。

- [ ] **Step 3: 实现 ContextAssembler**

Assembler 依次 await 固定 Source 数组，聚合 diagnostics 后调用 `freezePromptSnapshot()`。必需 Source 失败立即抛 `PROMPT_SOURCE_FAILED`。

- [ ] **Step 4: 实现 Manifest 和 EnvelopeBuilder**

Manifest `contentHash` 使用 `node:crypto` SHA-256 和 canonical JSON。输入仅包含 schemaVersion、route、structuralHash、有序 Fragment 摘要、Source revision/hash/size/truncated、有序工具名、Skill/PromptTemplate 名和 Permission 摘要；排除 snapshotId、createdAt、耗时和 diagnostic 时间。EnvelopeBuilder 根据 Mode、Category、Capability 和 Expert 决定 Pack，不接受调用方传任意片段列表。

CapabilitySource 只生成高层能力组，不复制逐工具 description。增加 Tool Metadata 审计，遍历 Mode、Category、macOS/Windows 所有可激活 Tool Pack，断言每个 AgentTool 的 name/label/description/schema 完整；发现问题直接修复工具注册定义。

- [ ] **Step 5: 运行测试**

Run: `npx tsx --test src/agent/prompt-runtime/envelope-builder.test.ts src/agent/prompt-runtime/tool-metadata.test.ts`
Expected: PASS。

- [ ] **Step 6: Commit**

```bash
git add src/agent/prompt-runtime/context-assembler.ts src/agent/prompt-runtime/manifest.ts src/agent/prompt-runtime/envelope-builder.ts src/agent/prompt-runtime/envelope-builder.test.ts src/agent/prompt-runtime/sources/capabilities.ts src/agent/prompt-runtime/tool-metadata.test.ts
git commit -m "feat: build immutable prompt envelopes"
```

### Task 9: PromptAwareHarness 原子执行

**Files:**
- Create: `src/agent/prompt-runtime/prompt-aware-harness.ts`
- Create: `src/agent/prompt-runtime/prompt-aware-harness.test.ts`
- Create: `src/agent/prompt-runtime/pi-harness-contract.test.ts`
- Modify: `src/agent/engine.ts`

- [ ] **Step 1: 写 Harness 顺序测试**

使用 fake Harness 记录调用，分别验证普通、Skill、PromptTemplate 三条路径：

```text
setTools -> setResources -> prompt
setTools -> setResources -> skill
setTools -> setResources -> formatPromptTemplateInvocation -> prompt
```

Template 始终先从 Envelope Resources 解析并使用 Pi helper 展开，再与 TurnPayload 合成唯一 User Prompt；禁止按是否存在附件在 `promptFromTemplate()` 与 `prompt()` 之间分支。

并验证执行失败后清理 active Envelope。直接绕过 session queue 的重入触发内部 invariant error，不映射为 HTTP 409。

契约测试针对锁定的 Pi Core 版本验证每轮 `systemPrompt` callback、`setTools()`、`setResources()`、`skill()`、`formatPromptTemplateInvocation()` 以及 active tools/resources turn snapshot；同时固定 `promptFromTemplate()` 无 additional context 参数的已知限制。任一所需能力缺失必须先停止依赖升级，不在 Wrapper 中复制 Pi Core 实现。

- [ ] **Step 2: 确认测试失败**

Run: `npx tsx --test src/agent/prompt-runtime/prompt-aware-harness.test.ts src/agent/prompt-runtime/pi-harness-contract.test.ts`
Expected: FAIL。

- [ ] **Step 3: 实现 PromptAwareHarness**

```ts
export class PromptAwareHarness {
  async execute(envelope: PromptEnvelope): Promise<AssistantMessage>;
  getSystemPrompt(): string;
}
```

`createPiHarness()` 的 `systemPrompt` callback 只调用 `PromptAwareHarness.getSystemPrompt()`；不再调用 DB、Memory、Settings、Skill 或 Expert 解析器。

- [ ] **Step 4: 运行测试和类型检查**

Run: `npx tsx --test src/agent/prompt-runtime/prompt-aware-harness.test.ts src/agent/prompt-runtime/pi-harness-contract.test.ts`
Expected: PASS。

Run: `npx tsc --project tsconfig.electron.json --noEmit`
Expected: exit 0。

- [ ] **Step 5: Commit**

```bash
git add src/agent/prompt-runtime/prompt-aware-harness.ts src/agent/prompt-runtime/prompt-aware-harness.test.ts src/agent/prompt-runtime/pi-harness-contract.test.ts src/agent/engine.ts
git commit -m "feat: execute prompt envelopes atomically"
```

### Task 10: RuntimeProfileResolver 与 SessionIntentResolver

**Files:**
- Create: `src/agent/prompt-runtime/session-intent.ts`
- Create: `src/agent/prompt-runtime/runtime-profile.ts`
- Create: `src/agent/prompt-runtime/runtime-profile.test.ts`

- [ ] **Step 1: 写端到端 Profile 测试**

覆盖 Assistant Ask/Plan/Craft、Skill Creator、Expert Creator create/edit、绑定 Expert、显式 MCP、非法 Category/Mode、失效 Expert。

- [ ] **Step 2: 确认测试失败**

Run: `npx tsx --test src/agent/prompt-runtime/runtime-profile.test.ts`
Expected: FAIL。

- [ ] **Step 3: 实现 SessionIntentResolver**

查询字段必须与当前 Provider 读取一致：category、model provider/id、expert binding/revision/source、expert operation、workspace。PromptOptions 提供 mode、permission、selectedSkillNames 和显式 MCP tools。Permission 只解析为 `ResolvedPermissionPolicy`，不得作为 `resolveToolPolicy()` 输入。

- [ ] **Step 4: 实现 RuntimeProfileResolver**

执行顺序固定：Category 校验 → Workspace Policy → Expert Profile → Tool Policy → Permission Policy → Skill Resources → structural hash。Tool Policy 与 Permission Policy 输出独立字段。不得读取 Prompt Fragment 或生成字符串。

- [ ] **Step 5: 运行测试**

Run: `npx tsx --test src/agent/prompt-runtime/runtime-profile.test.ts`
Expected: PASS。

- [ ] **Step 6: Commit**

```bash
git add src/agent/prompt-runtime/session-intent.ts src/agent/prompt-runtime/runtime-profile.ts src/agent/prompt-runtime/runtime-profile.test.ts
git commit -m "feat: resolve unified agent runtime profiles"
```

### Task 11: Provider 生产入口切换

**Files:**
- Modify: `src/agent/provider.ts`
- Modify: `src/agent/provider_profile_reload.test.ts`
- Create: `src/agent/provider_prompt_runtime.test.ts`

- [ ] **Step 1: 写 Provider 集成失败测试**

验证每个 queued turn 在 pre-turn compaction 后只构建一个 Envelope；Provider 不调用 `buildSystemPrompt()`；Mode 切换同步改变 Prompt Manifest 和 active tools；Profile reload 后 Expert 变化；失败 turn 不泄漏 active Envelope；用户与 Automation 同 session 并发保持现有 abort/串行排队且不返回 409。

- [ ] **Step 2: 确认测试失败**

Run: `npx tsx --test src/agent/provider_prompt_runtime.test.ts`
Expected: FAIL。

- [ ] **Step 3: 精简 SessionEntry**

删除：

```ts
expertAddon: string;
modeAddon: string;
mcpTools: AgentTool[]; // Expert 文本推断得到的隐式 MCP
```

增加：

```ts
promptHarness: PromptAwareHarness;
```

- [ ] **Step 4: 替换 executePrompt 主链**

在 session queue 内执行：pre-turn compaction → SessionIntent → RuntimeProfile → TurnIntent → Snapshot → Envelope → PromptAwareHarness → commit → post-turn compaction。删除 `MODE_PROMPTS`、`toolsForConversation()` 和 slash switch。Compaction 只处理历史消息，不接收或缓存 Envelope。

- [ ] **Step 5: 迁移 Creator Invocation**

- Skill Creator 使用 `skill-creator` Skill invocation。
- Expert Creator 使用 `expert-manager` Skill invocation。
- 现有 `selectedExpertId` 重命名映射为 `referenceExpertId`，与会话 `activeExpertId` 分离；它和 selected expert skills 都作为 `TurnContext` 结构化字段，不再生成 `skillPromptAddon`。

- [ ] **Step 6: 运行 Provider 测试**

Run: `npx tsx --test src/agent/provider_prompt_runtime.test.ts src/agent/provider_profile_reload.test.ts`
Expected: PASS。

- [ ] **Step 7: Commit**

```bash
git add src/agent/provider.ts src/agent/provider_prompt_runtime.test.ts src/agent/provider_profile_reload.test.ts
git commit -m "refactor: route provider turns through prompt runtime"
```

### Task 12: HTTP Prompt 边界与 Turn Context 切换

**Files:**
- Modify: `application.electron.ts`
- Modify: `frontend/src/api/promptRequestModel.ts`
- Modify: `frontend/src/api/promptRequestModel.test.ts`
- Create: `src/agent/prompt-runtime/sources/turn-context.ts`
- Create: `src/agent/prompt-runtime/sources/turn-context.test.ts`

- [ ] **Step 1: 写边界测试**

验证 API model 保留原始 query、attachment/file/connector、referenceExpertId 和 selected expert skills 的结构化字段；`TurnContextSource` 负责生成单一 JSON TurnPayload；恶意 `</turn_payload>` 只作为 JSON 字符串内容；文件引用默认只注入路径而非读取全文。

- [ ] **Step 2: 确认测试失败**

Run: `npx tsx --test frontend/src/api/promptRequestModel.test.ts src/agent/prompt-runtime/sources/turn-context.test.ts`
Expected: FAIL。

- [ ] **Step 3: 移出 HTTP 拼接逻辑**

`/api/prompt` 只校验请求、解析授权对象并传递结构化 `PromptTurnInput`。删除 `processedText` 中 attachment/connector/file 内容串联。

- [ ] **Step 4: 实现 TurnContextSource**

保持固定字段顺序：query → attachments → connector context → file references → reference expert → selected expert skills。每种输入有独立预算和 Source Manifest 摘要。System Prompt 不包含任何 Turn Surface 内容；普通、Skill 和 PromptTemplate 三条执行路径复用同一编码器。

- [ ] **Step 5: 运行测试与前端构建**

Run: `npx tsx --test frontend/src/api/promptRequestModel.test.ts src/agent/prompt-runtime/sources/turn-context.test.ts`
Expected: PASS。

Run: `npm --prefix frontend run build`
Expected: exit 0。

- [ ] **Step 6: Commit**

```bash
git add application.electron.ts frontend/src/api/promptRequestModel.ts frontend/src/api/promptRequestModel.test.ts src/agent/prompt-runtime/sources/turn-context.ts src/agent/prompt-runtime/sources/turn-context.test.ts
git commit -m "refactor: move turn context out of http transport"
```

### Task 13: 删除 Prompt 文本推断 MCP

**Files:**
- Modify: `src/agent/mcp.ts`
- Modify: `src/agent/provider.ts`
- Create: `src/agent/prompt-runtime/mcp-invariant.test.ts`

- [ ] **Step 1: 写安全回归测试**

构造包含已配置 MCP server 名称的 Expert Prompt 和 Skill 正文，断言没有连接调用；只有 `PromptOptions.mcpTools` 中的工具进入 Craft Profile。

- [ ] **Step 2: 确认旧实现会失败**

Run: `npx tsx --test src/agent/prompt-runtime/mcp-invariant.test.ts`
Expected: FAIL，旧 Expert 初始化会扫描 Prompt。

- [ ] **Step 3: 删除推断函数和调用点**

删除 `connectMcpServersReferencedByPrompt()` 及其 exports、imports、SessionEntry 缓存。保留显式 MCP Server 管理与由 API 授权得到的 AgentTool。

- [ ] **Step 4: 运行测试**

Run: `npx tsx --test src/agent/prompt-runtime/mcp-invariant.test.ts`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add src/agent/mcp.ts src/agent/provider.ts src/agent/prompt-runtime/mcp-invariant.test.ts
git commit -m "fix: require explicit mcp selection"
```

### Task 14: 删除旧 Prompt Assembly

**Files:**
- Modify: `src/agent/engine.ts`
- Modify: `src/agent/provider.ts`
- Modify: `src/agent/experts/runtime_profile.test.ts`
- Modify: `src/agent/skills.ts`

- [ ] **Step 1: 搜索所有旧符号**

Run:

```bash
rg -n "SYSTEM_PROMPT|systemPromptForPlatform|loadMemoryPrompt|assembleSystemPromptSections|buildSystemPrompt|MODE_PROMPTS|expertAddon|modeAddon|loadSkillsPrompt|connectMcpServersReferencedByPrompt" src application.electron.ts
```

Expected: 列出尚未删除的旧定义/引用。

- [ ] **Step 2: 删除旧定义和旧测试依赖**

`engine.ts` 只保留 Agent/Harness 创建、事件适配、安全 hooks 和 permission hooks。`skills.ts` 不再导出字符串 Prompt。Provider 不再保存任何 Prompt addon。

- [ ] **Step 3: 再次搜索确认归零**

Run: 同 Step 1。
Expected: 无输出，exit 1 是 `rg` 的正常“未找到”状态。

- [ ] **Step 4: 运行全部 Agent 测试**

Run: `npx tsx --test src/agent/**/*.test.ts src/agent/*.test.ts`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add src/agent/engine.ts src/agent/provider.ts src/agent/skills.ts src/agent/experts/runtime_profile.test.ts
git commit -m "refactor: remove legacy prompt assembly"
```

### Task 15: 完整矩阵与恢复/Compaction 回归

**Files:**
- Create: `src/agent/prompt-runtime/prompt-runtime.integration.test.ts`
- Modify: `src/agent/compaction.ts` only if the test exposes a real integration gap
- Modify: `src/agent/core_session.ts` only if the test exposes a real integration gap

- [ ] **Step 1: 添加集成矩阵**

测试以下链路：

1. Assistant Ask。
2. Assistant Plan。
3. Assistant Craft。
4. Craft + explicit MCP。
5. Bound Expert + Craft。
6. Skill Creator。
7. Expert Creator create。
8. Expert Creator edit。
9. Ask → Craft Mode 切换。
10. pre-turn Compaction 后才构建 Envelope，下一轮 Expert/Mode/Tools/Resources 全量重建。
11. post-turn Compaction 不修改已执行 Envelope。
12. 用户消息与 Automation 同 session 并发保持 abort/串行排队，不返回 409。
13. L1/L2/L3 的工具集合相同，但 Permission hook 决策按平台契约不同。
14. Expert schema v1 不进入 Catalog，diagnostic 不含绝对路径。

每个 case 断言 Manifest route、active tools、resources 和 invocation。

- [ ] **Step 2: 运行集成测试**

Run: `npx tsx --test src/agent/prompt-runtime/prompt-runtime.integration.test.ts`
Expected: PASS；如失败，只修复该测试证明的真实边界，不增加兼容 fallback。

- [ ] **Step 3: 添加敏感内容日志断言**

以 `SECRET_MEMORY_VALUE`、`SECRET_EXPERT_VALUE`、`SECRET_ATTACHMENT_VALUE` 构造上下文，断言 Manifest JSON 与 diagnostics 均不包含这些值。

- [ ] **Step 4: Commit**

```bash
git add src/agent/prompt-runtime/prompt-runtime.integration.test.ts src/agent/compaction.ts src/agent/core_session.ts
git commit -m "test: cover prompt runtime integration matrix"
```

### Task 16: 最终验证和架构文档同步

**Files:**
- Modify: `docs/architecture/prompt-runtime-v2-design.md`
- Modify: `docs/18-专家系统架构设计.md`
- Modify: `docs/workbuddy-prompt-architecture-analysis.md`

- [ ] **Step 1: 运行全部相关测试**

Run:

```bash
npx tsx --test \
  src/agent/prompt-runtime/*.test.ts \
  src/agent/prompt-runtime/sources/*.test.ts \
  src/agent/experts/*.test.ts \
  src/agent/*.test.ts \
  frontend/src/api/promptRequestModel.test.ts
```

Expected: PASS，无 skipped Prompt Runtime case。

- [ ] **Step 2: 运行 TypeScript 与前端构建**

Run: `npx tsc --project tsconfig.electron.json --noEmit`
Expected: exit 0。

Run: `npm --prefix frontend run build`
Expected: exit 0。

- [ ] **Step 3: 运行旧链归零检查**

Run:

```bash
rg -n "SYSTEM_PROMPT|MODE_PROMPTS|expertAddon|modeAddon|loadSkillsPrompt|connectMcpServersReferencedByPrompt" src application.electron.ts
```

Expected: 无输出。

- [ ] **Step 4: 检查 diff**

Run: `git diff --check`
Expected: 无 trailing whitespace/error。

Run: `git status --short`
Expected: 只包含本次 Prompt Runtime 改造文件和用户原有未跟踪文件；不得误纳入 `.claude/` 或其他无关内容。

- [ ] **Step 5: 同步文档状态**

在 v2 设计文档中把状态改为“已实施”，记录最终验证命令。在专家架构文档中将 Prompt Assembly 指向 v2，并明确 Expert Skill Resource 与显式 MCP 规则。在 WorkBuddy 分析文档末尾注明 PiCoddy-a 采纳/拒绝决策。

- [ ] **Step 6: Final commit**

```bash
git add docs/architecture/prompt-runtime-v2-design.md docs/18-专家系统架构设计.md docs/workbuddy-prompt-architecture-analysis.md
git commit -m "docs: finalize prompt runtime v2 architecture"
```

---

## Execution Checkpoints

- **Checkpoint A — Task 1-3：** 类型、Mode/Category、Tool Policy 完成；尚未接生产入口。
- **Checkpoint B — Task 4-8：** Resource、Source、Expert、Renderer、Envelope 完成；所有模块可独立测试。
- **Checkpoint C — Task 9-11：** Harness 与 Provider 完成生产切换；此时不允许保留旧 Prompt 运行分支。
- **Checkpoint D — Task 12-14：** HTTP Context、MCP 安全和旧链删除完成。
- **Checkpoint E — Task 15-16：** 全矩阵、恢复、Compaction、构建和文档验收完成。

## Definition of Done

- 一轮调用只采集一个 Snapshot。
- Prompt、Tools、Resources、Permission Policy 和 Manifest 来自同一 RuntimeProfile/Snapshot 链。
- Tool availability 与 Permission execution policy 正交。
- Expert、Skill 或文本内容不能连接 MCP 或扩大工具集合。
- Creator 使用 Pi 原生 Skill invocation。
- HTTP 层不拼 Prompt。
- System Surface 与 Turn Surface 不混合，TurnPayload 统一 JSON 编码。
- 静态 Fragment 无变量，动态数据只由类型化 Renderer 输出。
- 普通并发 turn 保持现有 session queue 行为，不返回 busy 409。
- 旧 Prompt Assembly 符号归零。
- 不存在 compatibility adapter、fallback 或双轨 feature flag。
- 所有验证命令通过。
