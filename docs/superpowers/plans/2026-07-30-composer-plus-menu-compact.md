# Composer “+” Menu Compact Styling Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 收紧聊天输入区“+”号一级菜单间距，并用技能名称首字符替换技能二级列表中的斜杠图标。

**Architecture:** 将技能首字符计算放入现有 `composerMenuModel.ts`，保持 React 组件只负责渲染。CSS 只调整一级菜单项高度，避免影响模式、专家和连接器二级列表。

**Tech Stack:** React 19、TypeScript、Vanilla CSS、Deno test、Vite

---

### Task 1: 技能首字符模型

**Files:**
- Modify: `frontend/src/components/composerMenuModel.ts`
- Test: `frontend/src/components/composerMenuModel_test.ts`

- [ ] **Step 1: 写入失败测试**

在 `composerMenuModel_test.ts` 的导入列表加入 `skillInitial`，并添加：

```ts
Deno.test("skillInitial uses the first visible character of the skill label", () => {
  assertEquals(skillInitial({ displayName: "数据分析", name: "data-analysis" }), "数");
  assertEquals(skillInitial({ displayName: " PPT 制作", name: "ppt" }), "P");
  assertEquals(skillInitial({ name: "weekly-report" }), "w");
  assertEquals(skillInitial({ displayName: "  ", name: "  " }), "?");
});
```

- [ ] **Step 2: 运行测试并确认失败**

Run:

```bash
deno test frontend/src/components/composerMenuModel_test.ts
```

Expected: FAIL，提示 `skillInitial` 未导出。

- [ ] **Step 3: 实现最小函数**

在 `composerMenuModel.ts` 添加：

```ts
export function skillInitial(skill: {
  displayName?: string;
  name: string;
}): string {
  const label = (skill.displayName || skill.name).trim();
  return Array.from(label)[0] || "?";
}
```

- [ ] **Step 4: 运行测试并确认通过**

Run:

```bash
deno test frontend/src/components/composerMenuModel_test.ts
```

Expected: 所有测试 PASS。

### Task 2: 菜单渲染与紧凑样式

**Files:**
- Modify: `frontend/src/components/ComposerPlusMenu.tsx`
- Modify: `frontend/src/components/ComposerPlusMenu.css`

- [ ] **Step 1: 使用技能首字符**

将 `ComposerPlusMenu.tsx` 的模型导入改为：

```ts
import {
  ATTACHMENT_INPUT_ACCEPT,
  skillInitial,
} from "./composerMenuModel";
```

将技能图标内容改为：

```tsx
<span className="composer-plus__skill-glyph">{skillInitial(skill)}</span>
```

- [ ] **Step 2: 收紧一级菜单高度**

将 `ComposerPlusMenu.css` 中 `.composer-plus__item` 的高度改为：

```css
.composer-plus__item {
  height: 36px;
}
```

其余属性保持不变。

- [ ] **Step 3: 运行定向测试**

Run:

```bash
deno test frontend/src/components/composerMenuModel_test.ts
```

Expected: 所有测试 PASS。

- [ ] **Step 4: 运行前端检查与生产构建**

Run:

```bash
cd frontend
npm run lint
npm run build
```

Expected: lint 无新增错误，TypeScript 与 Vite 构建成功。

- [ ] **Step 5: 提交实现**

```bash
git add frontend/src/components/composerMenuModel.ts frontend/src/components/composerMenuModel_test.ts frontend/src/components/ComposerPlusMenu.tsx frontend/src/components/ComposerPlusMenu.css docs/superpowers/plans/2026-07-30-composer-plus-menu-compact.md
git commit -m "style: 收紧加号菜单并更新技能图标"
```
