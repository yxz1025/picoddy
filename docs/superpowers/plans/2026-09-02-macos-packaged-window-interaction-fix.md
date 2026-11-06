# macOS Packaged Window Interaction Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restore real mouse interaction in the packaged macOS client, accept the first click on an inactive window, and let explicit quit operations terminate the application.

**Architecture:** Keep the existing single-window startup flow. Replace the startup page's full-body drag region with a dedicated top strip, establish an explicit `no-drag` baseline in the React document, configure macOS first-click handling on `BrowserWindow`, and gate close-to-hide behavior with an application quitting flag.

**Tech Stack:** Electron 43, React 19, CSS `-webkit-app-region`, Node.js test runner, TypeScript/Vite.

---

## File map

- Create `test/src/electron/macos_window_interaction.test.ts`: source-level regression checks for native drag regions and macOS window lifecycle configuration.
- Modify `resources/startup/loading.html`: restrict the startup drag surface to a top strip.
- Modify `frontend/src/index.css`: establish the React document's `no-drag` baseline.
- Modify `frontend/src/components/AuthScreen.css`: document and enforce the login page's interactive region.
- Modify `main.mjs`: enable `acceptFirstMouse` on macOS and distinguish close-to-hide from actual quit.
- Modify `docs/designs/2026-08-28-packaged-client-startup-loading-design.md`: record the corrected startup drag boundary.

### Task 1: Add the packaged-window regression test

**Files:**
- Create: `test/src/electron/macos_window_interaction.test.ts`

- [ ] **Step 1: Write the failing source-level regression test**

```ts
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const mainSource = readFileSync("main.mjs", "utf8");
const startupSource = readFileSync("resources/startup/loading.html", "utf8");
const globalCss = readFileSync("frontend/src/index.css", "utf8");
const authCss = readFileSync("frontend/src/components/AuthScreen.css", "utf8");

test("packaged pages clear the startup drag region before accepting input", () => {
  assert.match(
    startupSource,
    /body\s*\{[\s\S]*?-webkit-app-region:\s*no-drag;/,
  );
  assert.match(
    startupSource,
    /\.startup-drag-region\s*\{[\s\S]*?-webkit-app-region:\s*drag;/,
  );
  assert.match(startupSource, /<div class="startup-drag-region"/);
  assert.match(
    globalCss,
    /html,\s*\nbody,\s*\n#root\s*\{[\s\S]*?-webkit-app-region:\s*no-drag;/,
  );
  assert.match(
    authCss,
    /\.auth-shell,\s*\n\.auth-panel,\s*\n\.auth-btn\s*\{[\s\S]*?-webkit-app-region:\s*no-drag;/,
  );
});

test("the macOS window accepts first mouse and only hides outside quit", () => {
  assert.match(
    mainSource,
    /process\.platform === "darwin"\s*\?\s*\{[\s\S]*?acceptFirstMouse:\s*true/,
  );
  assert.match(mainSource, /let isQuitting = false;/);
  assert.match(
    mainSource,
    /process\.platform === "darwin"\s*&&\s*!isQuitting/,
  );
  assert.match(
    mainSource,
    /app\.on\("before-quit",\s*\(\)\s*=>\s*\{[\s\S]*?isQuitting = true;/,
  );
});
```

- [ ] **Step 2: Run the targeted test and verify RED**

Run only after the user explicitly authorizes test execution:

```bash
npx tsx --test test/src/electron/macos_window_interaction.test.ts
```

Expected: both subtests fail because the startup/React `no-drag` rules, `acceptFirstMouse`, and quit guard do not exist yet.

- [ ] **Step 3: Commit the failing regression test**

```bash
git add -- test/src/electron/macos_window_interaction.test.ts
git commit -m "test: cover macOS packaged window interaction"
```

### Task 2: Restore packaged-page mouse hit testing

**Files:**
- Modify: `resources/startup/loading.html`
- Modify: `frontend/src/index.css`
- Modify: `frontend/src/components/AuthScreen.css`
- Test: `test/src/electron/macos_window_interaction.test.ts`

- [ ] **Step 1: Restrict the startup drag region**

Change the startup page body rule and add a dedicated drag strip:

```css
body {
  display: grid;
  place-items: center;
  -webkit-app-region: no-drag;
  user-select: none;
}

.startup-drag-region {
  position: fixed;
  z-index: 10;
  top: 0;
  right: 0;
  left: 0;
  height: 38px;
  -webkit-app-region: drag;
}
```

Add the empty drag strip as the first body child:

```html
<body>
  <div class="startup-drag-region" aria-hidden="true"></div>
  <main class="startup-stage" aria-live="polite">
```

- [ ] **Step 2: Establish the React document no-drag baseline**

Add to `frontend/src/index.css` before the animation declarations:

```css
html,
body,
#root {
  -webkit-app-region: no-drag;
}
```

- [ ] **Step 3: Make the login surface explicitly interactive**

Add to `frontend/src/components/AuthScreen.css`:

```css
.auth-shell,
.auth-panel,
.auth-btn {
  -webkit-app-region: no-drag;
}
```

- [ ] **Step 4: Run the targeted test and inspect the remaining failure**

Run only after explicit test authorization:

```bash
npx tsx --test test/src/electron/macos_window_interaction.test.ts
```

Expected: the packaged-page drag-region subtest passes; the macOS window lifecycle subtest still fails.

- [ ] **Step 5: Commit the mouse hit-test fix**

```bash
git add -- resources/startup/loading.html frontend/src/index.css frontend/src/components/AuthScreen.css test/src/electron/macos_window_interaction.test.ts
git commit -m "fix: restore macOS packaged page mouse input"
```

### Task 3: Fix macOS first-click and quit behavior

**Files:**
- Modify: `main.mjs`
- Test: `test/src/electron/macos_window_interaction.test.ts`

- [ ] **Step 1: Add the main-process quit state**

Place the state with the other application lifecycle state:

```js
let mainWindow = null;
let isQuitting = false;
let serverPort = isDev ? 8000 : 0;
```

- [ ] **Step 2: Enable click-through activation on macOS**

Extend the existing Darwin BrowserWindow options:

```js
...(process.platform === "darwin"
  ? {
      titleBarStyle: "hiddenInset",
      acceptFirstMouse: true,
    }
  : {}),
```

- [ ] **Step 3: Guard close-to-hide behavior during quit**

Replace the unconditional Darwin close handler with:

```js
win.on("close", (event) => {
  if (process.platform === "darwin" && !isQuitting) {
    event.preventDefault();
    win.hide();
  }
});
```

Set the flag before Electron begins closing windows:

```js
app.on("before-quit", () => {
  isQuitting = true;
  globalShortcut.unregisterAll();
});
```

- [ ] **Step 4: Run the targeted regression test and verify GREEN**

Run only after explicit test authorization:

```bash
npx tsx --test test/src/electron/macos_window_interaction.test.ts
```

Expected: 2 tests pass, 0 fail.

- [ ] **Step 5: Commit the macOS window lifecycle fix**

```bash
git add -- main.mjs test/src/electron/macos_window_interaction.test.ts
git commit -m "fix: handle first click and quit on macOS"
```

### Task 4: Update startup behavior documentation

**Files:**
- Modify: `docs/designs/2026-08-28-packaged-client-startup-loading-design.md`

- [ ] **Step 1: Document the drag boundary**

Add to the startup-page behavior section:

```markdown
- macOS 启动页仅顶部 38px 为窗口拖拽区；页面主体必须显式为 `no-drag`，避免同一 WebContents 导航到正式前端后保留全窗口拖拽命中。
- 正式前端的 `html`、`body` 和 `#root` 必须建立 `no-drag` 基线；需要拖拽的标题栏区域单独声明 `drag`。
```

- [ ] **Step 2: Commit the documentation update**

```bash
git add -- docs/designs/2026-08-28-packaged-client-startup-loading-design.md
git commit -m "docs: define packaged startup drag boundary"
```

### Task 5: Verify source, build, and packaged behavior

**Files:**
- Verify only; no planned source changes.

- [ ] **Step 1: Run Electron TypeScript checking**

```bash
npx tsc --project tsconfig.electron.json --noEmit
```

Expected: exit code 0.

- [ ] **Step 2: Run frontend TypeScript checking**

```bash
cd frontend && npx tsc --noEmit -p tsconfig.app.json
```

Expected: exit code 0.

- [ ] **Step 3: Check patch formatting**

```bash
git diff --check
```

Expected: no output and exit code 0.

- [ ] **Step 4: Build the production frontend**

```bash
npm run build:frontend
```

Expected: TypeScript and Vite complete with exit code 0.

- [ ] **Step 5: Build the local unsigned macOS application**

```bash
npm run build:mac
```

Expected: `../build/picoddy-a/mac-arm64/PiCoddy-a.app` is regenerated successfully.

- [ ] **Step 6: Perform the original real-mouse acceptance check**

Fully terminate existing PiCoddy-a processes, launch the rebuilt app, and verify:

1. Hovering the enterprise login button shows the pointer/hover styling.
2. One click from an inactive window changes the UI to `认证中…` and opens the CAS page.
3. The red close button hides the window without terminating the process.
4. Tray Quit terminates the process, and a new launch starts the rebuilt binary rather than focusing a stale instance.

- [ ] **Step 7: Record final repository state**

```bash
git status --short
git log -5 --oneline
```

Expected: only pre-existing user changes remain uncommitted; implementation commits are visible in history.

