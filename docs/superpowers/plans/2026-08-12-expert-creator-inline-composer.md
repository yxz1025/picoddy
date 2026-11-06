# Expert Creator Inline Composer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `expert_creator` use the same single-row composer interaction as `skill_creator`, with the expert-manager token, selected business-skill tokens, and user text sharing one input row.

**Architecture:** Reuse the existing Composer contenteditable/token mechanics and existing per-conversation business-skill selection state. Move the expert-creator context chips into the editor row instead of rendering a separate pending panel; preserve the current request payload (`text` plus `selectedSkillNames`) and the fixed backend expert-manager context.

**Tech Stack:** React, TypeScript, existing Composer CSS, Zustand conversation-scoped selection state.

---

### Task 1: Move expert-creator context into the inline composer row

**Files:**
- Modify: `frontend/src/components/Composer.tsx`
- Modify: `frontend/src/components/ChatArea.css`
- Modify: `frontend/src/components/ComposerPlusMenu.css`

- [ ] **Step 1: Replace the separate expert pending panel**

Render the `expert-manager` context chip and selected business-skill chips inside the same flex row that contains the contenteditable editor. Keep the manager chip visually locked because it is the control-plane skill; keep business-skill remove buttons and existing store callbacks unchanged.

- [ ] **Step 2: Preserve editor behavior and submission contract**

Keep `text` as the editable user prompt and continue sending `expertBusinessSkills` through `selectedSkillNames`. Ensure moving the chips does not add chip labels to the prompt text or change normal-conversation slash-token behavior.

- [ ] **Step 3: Align responsive styles**

Use a wrapping inline context row with the same padding, gap, height, focus, and overflow behavior as the skill-creator composer. Remove the expert-only “chips above editor” styling and keep attachments/connectors in their existing pending area.

- [ ] **Step 4: Run static checks**

Run `cd frontend && npx tsc -b --pretty false` and `git diff --check`. Do not run test files or test suites.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/Composer.tsx frontend/src/components/ChatArea.css frontend/src/components/ComposerPlusMenu.css
git commit -m "fix: align expert creator composer interaction"
```

### Task 2: Final flow review

**Files:**
- Inspect: `frontend/src/components/Composer.tsx`
- Inspect: `frontend/src/components/ComposerPlusMenu.tsx`
- Inspect: `frontend/src/store/useStore.ts`

- [ ] **Step 1: Confirm interaction flow**

Verify that entering an expert-creator conversation shows the manager token and prompt on one row, selecting/removing business Skills updates the same row, Enter still submits the editable prompt, and the payload still contains ordered `selectedSkillNames`.

- [ ] **Step 2: Confirm no scope drift**

Verify ordinary conversations and the expert-selection navigation flow remain unchanged, and no backend/test files are modified.

