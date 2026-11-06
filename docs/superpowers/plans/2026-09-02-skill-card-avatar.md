# Skill Card Avatar Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为 SkillHub 技能卡片增加与专家卡片一致的首字头像，其他交互和布局保持不变。

**Architecture:** 继续使用 `ExpertPanel.tsx` 中现有的 `getAvatarStyle(identity)`，不新增状态或数据模型。技能标题左侧增加一个复用 `expert-avatar` 样式的元素，并用一条源代码结构测试锁定首字和配色逻辑。

**Tech Stack:** React、TypeScript、CSS、Node test runner

---

### Task 1: 技能卡片头像

**Files:**
- Modify: `test/src/components/skillDiscoveryLayout.test.ts`
- Modify: `frontend/src/components/ExpertPanel.tsx`
- Modify: `frontend/src/components/ExpertPanel.css`

- [ ] **Step 1: 写失败测试**

在布局测试中断言技能卡片包含 `skill-hub-avatar`，头像样式调用 `getAvatarStyle(identity)`，文字取 `(skill.displayName || skill.slug).charAt(0)`。

- [ ] **Step 2: 运行测试确认失败**

Run: `npx tsx --test test/src/components/skillDiscoveryLayout.test.ts`

Expected: FAIL，提示找不到 `skill-hub-avatar`。

- [ ] **Step 3: 最小实现**

在 `.hub-card-top` 内增加标题容器和头像：

```tsx
<div className="skill-hub-heading">
  <div className="expert-avatar skill-hub-avatar" style={getAvatarStyle(identity)}>
    {(skill.displayName || skill.slug).charAt(0) || "技"}
  </div>
  <div className="skill-title-row">…</div>
</div>
```

CSS 仅负责标题容器横向对齐和 32px 头像尺寸，不改变卡片其余规则。

- [ ] **Step 4: 验证测试与构建**

Run: `npx tsx --test test/src/components/skillDiscoveryLayout.test.ts`

Expected: PASS。

Run: `npm run build:frontend`

Expected: TypeScript 与 Vite build 成功。
