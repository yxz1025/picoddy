# Visualizer Hardening Implementation Plan

> **For agentic workers:** Execute inline, task by task. The user explicitly deferred unit tests; verify with type checks, builds, lint, and runtime smoke checks.

**Goal:** Close the security, validation, rendering, and build gaps in the implemented Visualizer while preserving its existing event and persistence architecture.

**Architecture:** Keep `read_me` and `show_widget` as stateless agent tools, retain the existing realtime/details plus database-JSON dual-source flow, and harden rendering at the frontend trust boundary. Add only local validation and UI behavior; do not add dependencies or compatibility layers.

**Tech Stack:** TypeScript, React 19, Zustand, TypeBox, Electron, sandboxed `srcdoc` iframe.

---

### Task 1: Harden backend tool contracts

**Files:**
- Modify: `src/agent/tools/show_widget.ts`
- Modify: `src/agent/tools/read_me.ts`
- Modify: `src/agent/tools/design_guides.ts`

- [x] Add schema and runtime limits for title, widget code, and loading messages.
- [x] Validate SVG/HTML shape, forbidden document wrappers, external resources, and network APIs.
- [x] Throw on invalid input so the agent framework emits `isError=true`.
- [x] Return complete guide objects from `read_me` and complete the missing module examples.
- [x] Remove hard-coded-color contradictions from the guide.

### Task 2: Harden rendering and iframe communication

**Files:**
- Modify: `frontend/src/components/WidgetRenderer.tsx`
- Modify: `frontend/src/store/appStore.ts`

- [x] Sanitize the SVG root and every descendant with lowercase tag matching.
- [x] Restrict all URL-bearing SVG attributes to local fragment references.
- [x] Correct supported SVG tags for clip paths and safe filter primitives; keep SVG `<style>` excluded because it could style the host document.
- [x] Bind iframe messages to the exact `contentWindow` and widget identifier.
- [x] Report iframe runtime errors without weakening sandbox or CSP.
- [x] Snapshot effective computed theme variables and rebuild on theme changes.

### Task 3: Complete widget UX

**Files:**
- Modify: `frontend/src/components/WidgetRenderer.tsx`
- Modify: `frontend/src/components/ChatArea.tsx`
- Modify: `frontend/src/components/ChatArea.css`

- [x] Render `loading_messages` sequentially with a default loading message.
- [x] Add copy and download controls.
- [x] Add a useful error state with access to the original code.
- [x] Remove duplicated raw/localized module labels.

### Task 4: Restore build correctness

**Files:**
- Modify: `frontend/src/store/useStore.ts`

- [x] Preserve the `Message["status"]` literal union in `tool_execution_end` updates.
- [x] Resolve remaining build failures only where they are part of the current dirty worktree and block verification.

### Task 5: Verify without unit tests

- [x] Run `npx tsc --project tsconfig.electron.json --noEmit`.
- [x] Run `npm run build` in `frontend`.
- [x] Run `npm run lint` in `frontend` and separate pre-existing warnings from new issues.
- [x] Invoke `read_me` and `show_widget` directly to smoke-test valid and invalid contracts.
- [x] Inspect the final diff for unrelated or destructive changes.
