# Multi-Skill Composer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 Workbuddy 聊天输入区支持按选择顺序追加多个技能 chip，并按截图样式发送。

**Architecture:** Composer 持有有序 `selectedSkills` 数组；技能菜单和 `/skill` 命令面板只负责追加，不做菜单反选。输入区显示多个可删除 chip；发送 payload 扩展 `skillNames[]`，最终文本按顺序生成 `/skill-a /skill-b 任务内容`，并保留旧 `skillName` 兼容。

**Tech Stack:** React、TypeScript、Zustand、Lucide、Deno 前端模型测试、Vite。

---

### Task 1: 扩展 payload 模型

**Files:**
- Modify: `frontend/src/components/composerMenuModel.ts`
- Test: `frontend/src/components/composerMenuModel_test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
const payload = buildComposerPayload({
  text: "整理结果",
  skillNames: ["tapd-workload", "skill-creator"],
  attachmentIds: [],
});
assertEquals(payload.text, "/tapd-workload /skill-creator 整理结果");
```

补充空数组、保持顺序、重复项只保留第一次、旧 `skillName` 单技能兼容测试。

- [ ] **Step 2: Run RED**

`deno test --allow-read --allow-env frontend/src/components/composerMenuModel_test.ts`

Expected: 新断言因当前只支持 `skillName` 而失败。

- [ ] **Step 3: Implement minimal change**

新增 `skillNames?: string[]`，按顺序过滤空值并去重；非空数组优先，否则回退到 `skillName`。保持 connector、附件和 attachment-only 行为不变。

- [ ] **Step 4: Run GREEN**

重复运行上述测试，预期全部通过。

- [ ] **Step 5: Commit**

`git add frontend/src/components/composerMenuModel.ts frontend/src/components/composerMenuModel_test.ts && git commit -m "feat: build ordered multi-skill composer payload"`

### Task 2: 引入有序选择状态

**Files:**
- Create: `frontend/src/components/composerSelectionModel.ts`
- Test: `frontend/src/components/composerSelectionModel_test.ts`
- Modify: `frontend/src/components/Composer.tsx`

- [ ] **Step 1: Write failing tests**

测试 `appendSelectedSkill([], A)` 得到 `[A]`，再追加 B 保持 `[A,B]`；重复追加 A 不产生第二项；`removeSelectedSkill([A,B], A)` 得到 `[B]`。

- [ ] **Step 2: Run RED**

`deno test --allow-read --allow-env frontend/src/components/composerSelectionModel_test.ts`

Expected: helper 尚不存在而失败。

- [ ] **Step 3: Implement and wire state**

在 `Composer` 增加 `useState<SkillMeta[]>([])`。菜单选择和 slash 选择都调用 append helper；选择后清除 `/skill query` 并保持输入焦点。会话切换、发送成功和进入固定 `skill-creator` 会话时清空。发送传 `selectedSkills.map((s) => s.name)`；固定创建会话不追加普通技能。

- [ ] **Step 4: Run GREEN and build**

`deno test --allow-read --allow-env frontend/src/components/composerSelectionModel_test.ts frontend/src/components/composerMenuModel_test.ts && npm run build`

- [ ] **Step 5: Commit**

`git add frontend/src/components/Composer.tsx frontend/src/components/composerSelectionModel.ts frontend/src/components/composerSelectionModel_test.ts frontend/src/components/composerMenuModel.ts frontend/src/components/composerMenuModel_test.ts && git commit -m "feat: keep ordered skills in composer state"`

### Task 3: 连续追加菜单与截图风格 chip

**Files:**
- Modify: `frontend/src/components/ComposerPlusMenu.tsx`
- Modify: `frontend/src/components/ComposerPlusMenu.css`
- Modify: `frontend/src/components/Composer.tsx`
- Test: `frontend/src/components/composerSelectionModel_test.ts`

- [ ] **Step 1: Write failing interaction tests**

覆盖 A 后 B 的回调顺序、重复点击不重复追加、`/skill`/`/skill data` 过滤、Enter/Tab 选择、Escape 只关闭建议、固定创建会话隐藏普通技能入口。

- [ ] **Step 2: Run RED**

`deno test --allow-read --allow-env frontend/src/components/composerSelectionModel_test.ts frontend/src/components/composerMenuModel_test.ts`

Expected: 连续追加和 `/skill` 过滤断言失败。

- [ ] **Step 3: Implement menu behavior**

保留 `onSkillSelected(skill)`，增加已选名称集合供展示 `aria-selected`/Check；技能项点击只追加并保持技能菜单打开，重复项由 Composer helper 去重，不实现菜单反选。模式、专家、连接器继续旧的选择后关闭逻辑。slash 选择移除触发文本但保留 chip 顺序。

- [ ] **Step 4: Implement chips**

在 `.composer-pending` 中按顺序渲染技能 chip，显示图标、displayName/name 和 X 删除；删除只移除对应项。保留 connector/附件 chip；窄屏换行，数量多时容器滚动。

- [ ] **Step 5: Run GREEN and build**

`deno test --allow-read --allow-env frontend/src/components/composerSelectionModel_test.ts frontend/src/components/composerMenuModel_test.ts && npm run build`

- [ ] **Step 6: Commit**

`git add frontend/src/components/Composer.tsx frontend/src/components/ComposerPlusMenu.tsx frontend/src/components/ComposerPlusMenu.css frontend/src/components/composerSelectionModel.ts frontend/src/components/composerSelectionModel_test.ts && git commit -m "feat: support ordered multi-skill composer chips"`

### Task 4: 最终回归

**Files:**
- Verify: composer model/selection tests and frontend build
- Preserve: `src/ui/frontend-assets.ts` remains the user’s existing dirty file and is never staged or regenerated.

- [ ] **Step 1: Run focused tests**

`deno test --allow-read --allow-env frontend/src/components/composerMenuModel_test.ts frontend/src/components/composerSelectionModel_test.ts`

- [ ] **Step 2: Build frontend**

`npm run build`

Do not run `gen:frontend` and do not rewrite `src/ui/frontend-assets.ts`.

- [ ] **Step 3: Inspect diff**

`git diff --check && git status --short`

Expected: only intended composer files are changed; the pre-existing frontend asset file remains unstaged.
