# Attachment Response Error Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make PDF attachments readable and ensure Agent failures after Office-file prompts are visible and persisted.

**Architecture:** Fix PDF worker setup at the reader boundary. Normalize stored history before it enters the Agent SDK, and use small pure helpers to convert empty-content SDK error messages into user-visible text on both backend and frontend.

**Tech Stack:** Deno 2, TypeScript, pdfjs-dist 4, React/Zustand, pi-agent-core.

---

### Task 1: PDF Worker Regression

**Files:**

- Create: `src/domains/doc/node/reader_test.ts`
- Modify: `src/domains/doc/node/reader.ts`

- [ ] Write a test that creates a minimal valid PDF and asserts `readDoc()` returns `kind: "pdf"` with extracted text.
- [ ] Run the test and verify it fails with the missing `workerSrc` error.
- [ ] Set `GlobalWorkerOptions.workerSrc = "./pdf.worker.mjs"`.
- [ ] Re-run the test and verify it passes.

### Task 2: Safe History Replay and Backend Error Persistence

**Files:**

- Create: `src/agent/history.ts`
- Create: `src/agent/history_test.ts`
- Modify: `src/agent/provider.ts`
- Modify: `main.ts`

- [ ] Write failing tests for complete assistant history metadata, assistant error text fallback, and failed-response detection.
- [ ] Run the tests and verify the new API is absent.
- [ ] Implement the pure history/event helpers and use them in provider history replay.
- [ ] Persist fallback error text and mark error-ended prompts as failed.
- [ ] Re-run tests and type-check.

### Task 3: Frontend Error Rendering

**Files:**

- Create: `frontend/src/store/eventModel.ts`
- Create: `frontend/src/store/eventModel_test.ts`
- Modify: `frontend/src/store/useStore.ts`

- [ ] Write a failing pure test for empty-content assistant error messages.
- [ ] Implement the formatter and use it for `message_update` and `message_end`.
- [ ] Verify the pure test, frontend build, and lint.

### Task 4: Full Regression

- [ ] Run document, attachment, history, frontend model, and existing model tests.
- [ ] Run Deno checks and the frontend production build.
- [ ] Confirm no `[DEBUG-` instrumentation remains and review the final diff.
