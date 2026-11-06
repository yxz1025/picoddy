# Skill Creator Composer and Draft Panel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restore a removable `skill-creator` composer tag, keep the generic artifact preview closed during skill creation, and reveal the skill draft panel only when the draft is ready for installation.

**Architecture:** Keep the backend and the persisted `skill_creator` category unchanged. Put pure UI decisions in the existing `skillDraftModel` and `artifactPanelModel`, render the creator tag through the existing inline-context UI, and make tag removal call the existing `resetToWelcome()` navigation action.

**Tech Stack:** React 19, TypeScript, Zustand, Node.js test runner via `tsx`, Vite.

---

## File map

- `frontend/src/components/skillDraftModel.ts`: pure creator-tag and draft-panel visibility decisions.
- `frontend/src/components/skillDraftModel.test.ts`: focused tests for creator UI state.
- `frontend/src/components/artifactPanelModel.ts`: pure decision for automatic generic artifact-panel opening.
- `frontend/src/components/artifactPanelModel.test.ts`: artifact auto-open regression tests.
- `frontend/src/components/Composer.tsx`: creator tag rendering and removal navigation.
- `frontend/src/components/ChatArea.css`: shared inline-context layout for expert and skill creator rows.
- `frontend/src/components/SkillDraftPanel.tsx`: hide the panel until its draft is install-ready.
- `frontend/src/store/useStore.ts`: consume the tested artifact auto-open decision while preserving the existing local preview-state changes.

### Task 1: Lock down creator UI decisions

**Files:**
- Create: `frontend/src/components/skillDraftModel.test.ts`
- Modify: `frontend/src/components/skillDraftModel.ts`

- [ ] **Step 1: Write the failing model tests**

```ts
import assert from "node:assert/strict";
import test from "node:test";
import {
  creatorComposerContext,
  shouldShowSkillDraftPanel,
} from "./skillDraftModel.ts";

test("creator composer context selects the removable skill-creator tag", () => {
  assert.deepEqual(creatorComposerContext({ category: "skill_creator" }), {
    command: "/skill-creator",
    label: "skill-creator",
  });
  assert.equal(creatorComposerContext({ category: "assistant" }), null);
});

test("initial skill draft panel appears only when install-ready", () => {
  assert.equal(shouldShowSkillDraftPanel(null), false);
  assert.equal(shouldShowSkillDraftPanel({ status: "editing" }), false);
  assert.equal(
    shouldShowSkillDraftPanel({
      status: "valid",
      validation: { valid: false },
    }),
    false,
  );
  assert.equal(
    shouldShowSkillDraftPanel({
      status: "valid",
      validation: { valid: true },
    }),
    true,
  );
  assert.equal(shouldShowSkillDraftPanel({ status: "installed" }), true);
});

test("an installed skill revision keeps its existing draft panel", () => {
  assert.equal(
    shouldShowSkillDraftPanel({
      status: "editing",
      revisionOf: "existing-skill",
    }),
    true,
  );
});
```

- [ ] **Step 2: Run the test and verify RED**

Run: `npx tsx --test frontend/src/components/skillDraftModel.test.ts`

Expected: FAIL because `creatorComposerContext` and `shouldShowSkillDraftPanel` are not exported.

- [ ] **Step 3: Implement the minimal pure model**

```ts
export const SKILL_CREATOR_COMMAND = "/skill-creator";

export function creatorComposerContext(
  conversation?: { category?: string } | null,
): { command: string; label: string } | null {
  return creatorConversation(conversation)
    ? { command: SKILL_CREATOR_COMMAND, label: "skill-creator" }
    : null;
}

export function shouldShowSkillDraftPanel(
  draft?: {
    status: "editing" | "valid" | "installed";
    revisionOf?: string;
    validation?: { valid: boolean };
  } | null,
): boolean {
  if (!draft) return false;
  if (draft.status === "installed" || draft.revisionOf) return true;
  return draft.status === "valid" && draft.validation?.valid === true;
}
```

- [ ] **Step 4: Run the test and verify GREEN**

Run: `npx tsx --test frontend/src/components/skillDraftModel.test.ts`

Expected: 3 tests pass.

### Task 2: Render and remove the creator tag

**Files:**
- Modify: `frontend/src/components/Composer.tsx`
- Modify: `frontend/src/components/ChatArea.css`

- [ ] **Step 1: Consume the tested context model**

Import `Hammer` from `lucide-react`, import `creatorComposerContext`, destructure `resetToWelcome` from the store, and derive:

```ts
const skillCreatorContext = creatorComposerContext(currentConversation);
```

- [ ] **Step 2: Render the removable tag before the editor**

Use the shared creator row class and existing token styles:

```tsx
<div className={`composer-editor-row ${
  isCreatorConversation ? "composer-editor-row--context" : ""
}`}>
  {skillCreatorContext && (
    <div className="composer-inline-context" aria-label="技能创建上下文">
      <span className="composer-inline-token composer-inline-token--fixed">
        <Hammer size={13} />
        <strong>{skillCreatorContext.label}</strong>
        <button
          type="button"
          className="composer-inline-token__remove"
          disabled={busy || sending}
          onClick={resetToWelcome}
          title="退出技能创建流程"
          aria-label="移除 skill-creator 标签并退出技能创建流程"
        >
          <X size={11} />
        </button>
      </span>
    </div>
  )}
```

Keep the existing expert context block immediately after this block.

- [ ] **Step 3: Generalize the creator-row CSS selector**

Rename `.composer-editor-row--expert` selectors to `.composer-editor-row--context` while keeping the declarations unchanged, so both creator types use the same layout.

- [ ] **Step 4: Run the frontend type check**

Run: `cd frontend && npx tsc -b --pretty false`

Expected: PASS with no diagnostics.

### Task 3: Hide incomplete drafts

**Files:**
- Modify: `frontend/src/components/SkillDraftPanel.tsx`
- Test: `frontend/src/components/skillDraftModel.test.ts`

- [ ] **Step 1: Use the tested visibility decision**

Import `shouldShowSkillDraftPanel` and, after all hooks and derived values but before the JSX return, add:

```ts
if (!shouldShowSkillDraftPanel(draft)) return null;
```

This keeps polling active because the component remains mounted while removing all visible width until the draft is valid.

- [ ] **Step 2: Run the model test and type check**

Run: `npx tsx --test frontend/src/components/skillDraftModel.test.ts && cd frontend && npx tsc -b --pretty false`

Expected: all model tests pass and TypeScript reports no diagnostics.

### Task 4: Lock down generic preview isolation

**Files:**
- Modify: `frontend/src/components/artifactPanelModel.test.ts`
- Modify: `frontend/src/components/artifactPanelModel.ts`
- Modify: `frontend/src/store/useStore.ts`

- [ ] **Step 1: Write the failing preview decision test**

```ts
import { shouldAutoOpenArtifactPanel } from "./artifactPanelModel";

test("does not auto-open generic artifacts for skill creation", () => {
  assert.equal(shouldAutoOpenArtifactPanel("skill_creator"), false);
  assert.equal(shouldAutoOpenArtifactPanel("assistant"), true);
  assert.equal(shouldAutoOpenArtifactPanel(undefined), true);
});
```

- [ ] **Step 2: Run the test and verify RED**

Run: `npx tsx --test frontend/src/components/artifactPanelModel.test.ts`

Expected: FAIL because `shouldAutoOpenArtifactPanel` is not exported.

- [ ] **Step 3: Implement and consume the pure decision**

Add to `artifactPanelModel.ts`:

```ts
export function shouldAutoOpenArtifactPanel(category?: string): boolean {
  return category !== "skill_creator";
}
```

In `useStore.ts`, replace the inline category comparison in the existing `deliveryBatch` patch with:

```ts
if (shouldAutoOpenArtifactPanel(currentConv?.category)) {
  patch.showArtifacts = true;
  patch.panelMode = "preview";
}
```

- [ ] **Step 4: Run the focused tests and verify GREEN**

Run: `npx tsx --test frontend/src/components/artifactPanelModel.test.ts frontend/src/components/skillDraftModel.test.ts`

Expected: all focused tests pass.

### Task 5: Full verification and visual regression

**Files:**
- Verify only; no backend modifications.

- [ ] **Step 1: Run automated verification**

Run: `npx tsx --test frontend/src/components/artifactPanelModel.test.ts frontend/src/components/skillDraftModel.test.ts && cd frontend && npm run build`

Expected: focused tests and Vite production build pass.

- [ ] **Step 2: Check the exact diff boundary**

Run: `git diff --check && git diff --name-only`

Expected: no whitespace errors; implementation changes are limited to the frontend files listed above plus the pre-existing `package-lock.json` change.

- [ ] **Step 3: Verify in the local browser**

Start the existing frontend development server, open the app in the local browser, and verify:

1. A skill creator conversation shows the `skill-creator` tag before the prompt.
2. Removing the tag returns to the ordinary welcome screen without changing backend files or APIs.
3. An incomplete skill draft occupies no panel width.
4. A valid draft reveals the existing install confirmation panel.
5. Generic artifact preview stays closed for skill creator delivery and still opens for ordinary conversations.

- [ ] **Step 4: Report verification evidence**

Include focused test counts, build result, browser observations, and confirmation that no backend file changed.
