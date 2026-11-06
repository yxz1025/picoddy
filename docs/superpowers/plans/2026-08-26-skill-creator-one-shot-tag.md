# Skill Creator One-Shot Tag Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the `skill-creator` context tag from the composer to the first user message after a successful send, without changing backend payloads or persisted schemas.

**Architecture:** Derive the tag lifecycle from the existing conversation category and message history. Pure model helpers decide whether the composer tag is pending and whether a user message is the first creator prompt; `Composer` and `ChatArea` only render those decisions, so optimistic-send rollback and page reload work without new state.

**Tech Stack:** React 19, TypeScript, Zustand, Node.js test runner via `tsx`, Vite.

---

## File map

- `frontend/src/components/skillDraftModel.ts`: pure one-shot creator-tag lifecycle decisions.
- `frontend/src/components/skillDraftModel.test.ts`: lifecycle tests covering initial, sent, failed/rolled-back, and non-creator states.
- `frontend/src/components/Composer.tsx`: hides the pending tag as soon as the first optimistic user message exists.
- `frontend/src/components/ChatArea.tsx`: renders a read-only tag on only the first creator user message.
- `frontend/src/components/ChatArea.css`: message-tag spacing without changing composer token styling.
- `test/src/components/welcomeLayout.test.ts`: source-level wiring regression for both render locations.

### Task 1: Model the one-shot lifecycle

**Files:**
- Modify: `frontend/src/components/skillDraftModel.test.ts`
- Modify: `frontend/src/components/skillDraftModel.ts`

- [ ] **Step 1: Write failing lifecycle tests**

Extend the imports and add these cases:

```ts
import {
  creatorComposerContext,
  isCreatorFirstUserMessage,
  shouldShowSkillDraftPanel,
} from "./skillDraftModel.ts";

const creator = { category: "skill_creator" };
const assistant = { category: "assistant" };
const firstUser = { id: "user-1", role: "user" };
const secondUser = { id: "user-2", role: "user" };

test("creator composer context is pending only before the first user message", () => {
  assert.deepEqual(creatorComposerContext(creator, []), {
    command: "/skill-creator",
    label: "skill-creator",
  });
  assert.equal(creatorComposerContext(creator, [firstUser]), null);
  assert.equal(creatorComposerContext(assistant, []), null);
});

test("creator message tag belongs only to the first user message", () => {
  const messages = [
    { id: "assistant-intro", role: "assistant" },
    firstUser,
    secondUser,
  ];
  assert.equal(isCreatorFirstUserMessage(creator, messages, firstUser), true);
  assert.equal(isCreatorFirstUserMessage(creator, messages, secondUser), false);
  assert.equal(isCreatorFirstUserMessage(assistant, messages, firstUser), false);
});

test("removing a failed optimistic user message restores pending context", () => {
  assert.equal(creatorComposerContext(creator, [firstUser]), null);
  assert.deepEqual(creatorComposerContext(creator, []), {
    command: "/skill-creator",
    label: "skill-creator",
  });
});
```

- [ ] **Step 2: Run the focused test and verify RED**

Run: `npx tsx --test frontend/src/components/skillDraftModel.test.ts`

Expected: FAIL because `creatorComposerContext` does not accept message history and `isCreatorFirstUserMessage` is not exported.

- [ ] **Step 3: Implement the minimal pure helpers**

Use the shared minimal message shape and derive state from the first `role === "user"` entry:

```ts
type CreatorMessageRef = { id: string; role: string };

export function creatorComposerContext(
  conversation?: { category?: string } | null,
  messages: readonly CreatorMessageRef[] = [],
): { command: string; label: string } | null {
  return creatorConversation(conversation) &&
      !messages.some((message) => message.role === "user")
    ? { command: SKILL_CREATOR_COMMAND, label: "skill-creator" }
    : null;
}

export function isCreatorFirstUserMessage(
  conversation: { category?: string } | null | undefined,
  messages: readonly CreatorMessageRef[],
  message: CreatorMessageRef,
): boolean {
  if (!creatorConversation(conversation) || message.role !== "user") return false;
  return messages.find((item) => item.role === "user")?.id === message.id;
}
```

- [ ] **Step 4: Run the focused test and verify GREEN**

Run: `npx tsx --test frontend/src/components/skillDraftModel.test.ts`

Expected: all lifecycle and draft-panel tests pass.

### Task 2: Wire the lifecycle into composer and message rendering

**Files:**
- Modify: `frontend/src/components/Composer.tsx`
- Modify: `frontend/src/components/ChatArea.tsx`
- Modify: `frontend/src/components/ChatArea.css`
- Modify: `test/src/components/welcomeLayout.test.ts`

- [ ] **Step 1: Write a failing source-wiring regression test**

Add assertions that require both model decisions to be consumed:

```ts
test("skill creator tag moves from composer to the first user message", () => {
  assert.match(composerSource, /creatorComposerContext\(currentConversation, messages\)/);
  assert.match(chatSource, /isCreatorFirstUserMessage\(conv, messages, msg\)/);
  assert.match(chatSource, /className="creator-message-context"/);
});
```

- [ ] **Step 2: Run the source regression and verify RED**

Run: `npx tsx --test test/src/components/welcomeLayout.test.ts`

Expected: FAIL because the composer does not pass messages and the chat does not render creator-message context.

- [ ] **Step 3: Hide the composer tag after optimistic send**

Destructure `messages` from `useStore()` in `Composer.tsx` and pass it into the tested helper:

```ts
const skillCreatorContext = creatorComposerContext(
  currentConversation,
  messages,
);
```

No send payload changes are made. The existing optimistic message insertion hides the tag; the existing failed-send removal restores it.

- [ ] **Step 4: Render the read-only tag on the first creator prompt**

Import `Hammer` and `isCreatorFirstUserMessage` in `ChatArea.tsx`. Inside `.userMessageBubble`, before `ReactMarkdown`, render:

```tsx
{isCreatorFirstUserMessage(conv, messages, msg) && (
  <div className="creator-message-context" aria-label="技能创建上下文">
    <span className="composer-inline-token composer-inline-token--fixed">
      <Hammer size={13} aria-hidden="true" />
      <strong>skill-creator</strong>
    </span>
  </div>
)}
```

Keep `msg.content` unchanged and continue passing the original text to `ReactMarkdown`.

- [ ] **Step 5: Add scoped message spacing**

Add:

```css
.creator-message-context {
  display: flex;
  margin-bottom: 7px;
}
```

- [ ] **Step 6: Run focused tests and verify GREEN**

Run: `npx tsx --test frontend/src/components/skillDraftModel.test.ts test/src/components/welcomeLayout.test.ts`

Expected: all focused tests pass.

### Task 3: Verify frontend-only behavior

**Files:**
- Verify only; do not modify backend files.

- [ ] **Step 1: Run the production build**

Run: `cd frontend && npm run build`

Expected: TypeScript and Vite build pass with no errors.

- [ ] **Step 2: Run the relevant regression suite**

Run: `npx tsx --test frontend/src/components/skillDraftModel.test.ts frontend/src/components/artifactPanelModel.test.ts test/src/components/welcomeLayout.test.ts`

Expected: all creator-tag, draft-panel, preview-panel, and layout tests pass.

- [ ] **Step 3: Check scope and whitespace**

Run: `git diff --check && git diff --name-only`

Expected: no whitespace errors; this change adds only the four frontend files and one frontend source-regression test listed above to the existing worktree changes.

- [ ] **Step 4: Verify the running UI**

In a new skill creator conversation, send the first prompt and confirm: the composer tag disappears immediately, the first user bubble shows the read-only `skill-creator` tag, later user bubbles do not repeat it, and no request payload contains the display-only tag. Simulate or observe a failed send and confirm the composer tag returns after the optimistic message is removed.
