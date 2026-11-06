# Model Switch Consistency Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the composer model, persisted conversation model, IPC payload, and provider request model identical for new and existing tasks.

**Architecture:** Extend the existing prompt DTO rather than adding a second model-update endpoint. Keep model validation and harness switching in `LocalPiProvider`, while a pure frontend resolver prevents the picker from displaying a model different from the stored selection.

**Tech Stack:** React 19, Zustand, Electron IPC, TypeScript, node:test.

---

### Task 1: Preserve model identity through prompt IPC

**Files:**
- Modify: `frontend/src/api/promptRequestModel.ts`
- Modify: `frontend/src/api/promptRequestModel.test.ts`
- Modify: `src/electron/ipc-handlers.ts`

- [x] Add regression assertions that `modelProvider` and `modelId` survive `mapPromptRequestToSessionContinue` as a pair.
- [x] Add the pair to `PromptRequest` and its mapper; omit both when either value is empty.
- [x] Forward the pair from `session.continue` to `/api/prompt` and include non-sensitive model identity in the diagnostic log.
- [x] Do not execute the test file; run TypeScript checks only.

### Task 2: Make picker display and store selection identical

**Files:**
- Create: `frontend/src/components/modelSelectionModel.ts`
- Create: `frontend/src/components/modelSelectionModel.test.ts`
- Modify: `frontend/src/components/Composer.tsx`

- [x] Define a pure `resolveModelSelection` helper that returns the exact stored model when available and otherwise returns the first available model.
- [x] Add regression cases for exact selection, stale selection, and an empty list.
- [x] Use the resolver in `ModelPicker` and synchronize a stale selection with `setModel` in an effect.
- [x] Render `未配置模型` when the available list is empty.
- [x] Do not execute the test file; run frontend TypeScript checks only.

### Task 3: Verify and commit

**Files:**
- Verify all files from Tasks 1 and 2.

- [x] Run `npx tsc --project tsconfig.electron.json --noEmit`.
- [x] Run `cd frontend && npx tsc --noEmit -p tsconfig.app.json`.
- [x] Run `git diff --check`.
- [x] Inspect the diff to ensure unrelated existing changes remain unstaged.
- [ ] Commit only the model consistency implementation, regression sources, and these two documents.
