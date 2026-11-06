# Welcome Layout Alignment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Center the new-task welcome content in the right pane, increase the welcome composer height, and keep exactly 5px between the secondary menu and composer border.

**Architecture:** Add one layout wrapper around the existing `ChatArea` and `Composer`, preserving both components and their state ownership. Give their existing root/content elements stable class names, then scope all centering, spacing, and height overrides to the welcome modifier class so established conversation layouts remain unchanged.

**Tech Stack:** React 19, TypeScript, CSS, Node.js test runner via `tsx --test`, Vite.

---

### Task 1: Add a failing welcome-layout contract test

**Files:**
- Create: `test/src/components/welcomeLayout.test.ts`
- Test: `test/src/components/welcomeLayout.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const appSource = readFileSync("frontend/src/App.tsx", "utf8");
const chatSource = readFileSync("frontend/src/components/ChatArea.tsx", "utf8");
const composerSource = readFileSync("frontend/src/components/Composer.tsx", "utf8");
const chatCss = readFileSync("frontend/src/components/ChatArea.css", "utf8");

test("new-task welcome layout has stable scoped hooks", () => {
  assert.match(appSource, /chat-layout--welcome/);
  assert.match(chatSource, /className="chat-area-root"/);
  assert.match(chatSource, /chat-scroll-content/);
  assert.match(composerSource, /className="composer-root"/);
});

test("welcome secondary menu is 5px from the taller composer", () => {
  assert.match(
    chatCss,
    /\.chat-layout--welcome\s+\.composer-root\s*\{[^}]*padding-top:\s*5px\s*!important/s,
  );
  assert.match(
    chatCss,
    /\.chat-layout--welcome\s+\.composer-editor\s*\{[^}]*min-height:\s*80px\s*!important/s,
  );
  assert.match(
    chatCss,
    /\.chat-layout--welcome\s+\.chat-scroll-content\s*\{[^}]*padding-bottom:\s*0\s*!important/s,
  );
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx tsx --test test/src/components/welcomeLayout.test.ts`

Expected: FAIL because the wrapper/root hooks and scoped 5px/80px rules do not exist.

### Task 2: Add the welcome layout structure and scoped styles

**Files:**
- Modify: `frontend/src/App.tsx:171-193`
- Modify: `frontend/src/components/ChatArea.tsx:769-863`
- Modify: `frontend/src/components/Composer.tsx:1094-1102`
- Modify: `frontend/src/components/ChatArea.css:319-379`
- Test: `test/src/components/welcomeLayout.test.ts`

- [ ] **Step 1: Wrap the chat and composer in a stable layout container**

Replace the ordinary chat fragment in `App.tsx` with:

```tsx
<div className={`chat-layout ${isWelcome ? "chat-layout--welcome" : ""}`}>
  <ChatArea />
  <Composer />
</div>
```

- [ ] **Step 2: Add stable component hooks without changing behavior**

Add `className="chat-area-root"` to the outermost `ChatArea` div, add `className="chat-scroll-content"` to the message-content div inside `.chat-scroll`, and add `className="composer-root"` to the outermost `Composer` div. Preserve all current inline styles.

- [ ] **Step 3: Replace stale welcome selectors with scoped layout rules**

Use the following welcome layout rules in `ChatArea.css`:

```css
.chat-layout {
  min-height: 0;
  flex: 1;
  display: flex;
  flex-direction: column;
}

.chat-layout--welcome {
  justify-content: center;
  overflow-y: auto;
  padding-block: 16px;
  box-sizing: border-box;
}

.chat-layout--welcome .chat-area-root,
.chat-layout--welcome .chat-workspace {
  flex: 0 0 auto !important;
}

.chat-layout--welcome .chat-header {
  display: none;
}

.chat-layout--welcome .chat-scroll {
  overflow: visible;
}

.chat-layout--welcome .chat-scroll-content {
  padding-top: 0 !important;
  padding-bottom: 0 !important;
}

.chat-layout--welcome .composer-root {
  padding-top: 5px !important;
}

.chat-layout--welcome .composer-editor {
  min-height: 80px !important;
}
```

Remove the obsolete `.chat-area-root--welcome`, `.composer-root--welcome`, and `.chat-scroll-content--welcome` blocks. Change `.welcome-screen` bottom padding to `0` so the 5px root padding is the only gap between the secondary menu and composer border.

- [ ] **Step 4: Run the focused test to verify it passes**

Run: `npx tsx --test test/src/components/welcomeLayout.test.ts`

Expected: 2 tests pass, 0 fail.

- [ ] **Step 5: Run the frontend checks**

Run: `npx tsc --project frontend/tsconfig.json --noEmit`

Expected: exit code 0.

Run: `npm run build --prefix frontend`

Expected: TypeScript and Vite build complete with exit code 0.

### Task 3: Verify the rendered layout

**Files:**
- Modify if visual correction is needed: `frontend/src/components/ChatArea.css`

- [ ] **Step 1: Start the local frontend**

Run: `npm run dev --prefix frontend -- --host 127.0.0.1`

Expected: Vite reports a local development URL.

- [ ] **Step 2: Inspect the new-task welcome state at desktop size**

Open the local page at 1440×900 and verify with browser-computed rectangles:

```text
secondaryMenu.bottom to composerShell.top = 5px
composerEditor.height >= 80px
abs(welcomeGroupCenterY - rightPaneCenterY) <= 8px
```

Confirm that the title, primary menu, secondary menu, composer, toolbar, workspace selector, and disclaimer remain visible.

- [ ] **Step 3: Inspect a compact window**

Resize to 900×650. Confirm horizontal padding remains, the composer is not clipped, and the welcome layout can scroll vertically if its content exceeds the available height.

- [ ] **Step 4: Re-run verification after any visual correction**

Run: `npx tsx --test test/src/components/welcomeLayout.test.ts && npx tsc --project frontend/tsconfig.json --noEmit && npm run build --prefix frontend && git diff --check`

Expected: 2 tests pass and all remaining commands exit with code 0.

- [ ] **Step 5: Commit the implementation**

```bash
git add frontend/src/App.tsx frontend/src/components/ChatArea.tsx frontend/src/components/Composer.tsx frontend/src/components/ChatArea.css test/src/components/welcomeLayout.test.ts
git commit -m "fix: center new task welcome layout"
```
