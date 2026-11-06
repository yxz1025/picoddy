# Expert Manager Creation Flow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the complete “My Experts → Create Expert → preselected expert-manager conversation → validated registered expert package” flow.

**Architecture:** Add an installed-expert scanner and mutable registry overlay behind the existing expert APIs, plus a dedicated expert-creator conversation context that activates the protected builtin skill. The renderer receives installed summaries through the shared API/IPC path and uses a one-shot composer bootstrap to render the selected skill pill and creation prompt.

**Tech Stack:** TypeScript, Electron IPC, React, Zustand, Node test runner, Python expert-manager scripts, CSS.

---

### Task 1: Installed expert package scanner and registry overlay

**Files:**
- Create: `src/agent/experts/installed_catalog.ts`
- Create: `src/agent/experts/installed_catalog.test.ts`
- Modify: `src/agent/experts/types.ts`
- Modify: `src/agent/experts/registry.ts`
- Modify: `src/agent/experts/registry.test.ts`
- Modify: `src/agent/experts.ts`

- [ ] Write failing tests proving that only registered, in-root expert packages are loaded; Agent and Team metadata are mapped correctly; prompt bodies stay out of summaries; invalid paths and packages produce diagnostics.
- [ ] Run `node --import tsx --test src/agent/experts/installed_catalog.test.ts src/agent/experts/registry.test.ts` and verify the new tests fail because installed scanning and overlay APIs do not exist.
- [ ] Implement `scanInstalledExperts`, `refreshInstalledExperts`, `listInstalledExperts`, the `installed` catalog source, `expertType`, and an atomic installed registry overlay with precedence `builtin > installed > catalog`.
- [ ] Re-run the focused tests and verify they pass.

### Task 2: Dedicated expert-manager conversation context

**Files:**
- Create: `src/agent/expert_manager_context.ts`
- Create: `src/agent/expert_manager_context.test.ts`
- Modify: `src/agent/provider.ts`

- [ ] Write failing tests for `buildExpertManagerSystemAddon` and `expertManagerContextForConversation`, including category gating, escaped session/path attributes, official skill loading, fixed expert directory, required lifecycle and session-bound registration.
- [ ] Run `node --import tsx --test src/agent/expert_manager_context.test.ts` and verify failure because the context module does not exist.
- [ ] Implement the context and append it during provider session creation for `expert_creator`; keep full Craft tools available and prevent missing-skill fallback to ordinary chat.
- [ ] Re-run the focused tests and existing provider profile tests.

### Task 3: Protect and publish the expert-manager builtin skill

**Files:**
- Modify: `src/agent/builtin_skills/builtin-skills.manifest.generated.json`
- Modify: `src/agent/builtin_skills/builtin-skills.bundle.generated.ts`
- Verify: `resources/builtin-skills/expert-manager/**`

- [ ] Run the builtin bundle test before generation and confirm the current manifest does not contain `expert-manager`.
- [ ] Run `npm run gen:builtin-skills` to regenerate the deterministic protected bundle from `resources/builtin-skills`.
- [ ] Run `node --import tsx --test src/agent/builtin_skills/*.test.ts scripts/build-builtin-skills_test.ts` and verify the generated bundle passes validation and includes all expert-manager scripts and references.

### Task 4: Installed expert APIs and IPC parity

**Files:**
- Modify: `application.electron.ts`
- Modify: `src/electron/ipc-handlers.ts`
- Modify: `src/electron/preload.cjs`
- Modify: `frontend/src/api/client.ts`

- [ ] Add a failing route/client test, where available, proving `GET /api/experts/installed` reaches the same backend through HTTP and IPC.
- [ ] Implement `GET /api/experts/installed`, refresh the overlay before responding, make detail and binding responses use dynamic `getExpert`, and add `expert.listInstalled` IPC mapping.
- [ ] Run the route/client tests and TypeScript checks.

### Task 5: Renderer state and one-shot composer bootstrap

**Files:**
- Create: `frontend/src/components/expertCreatorModel.ts`
- Create: `frontend/src/components/expertCreatorModel.test.ts`
- Modify: `frontend/src/store/useStore.ts`
- Modify: `frontend/src/store/useSkillStore.ts`
- Modify: `frontend/src/components/Composer.tsx`
- Modify: `frontend/src/components/ComposerPlusMenu.tsx`

- [ ] Write failing model tests for the exact `/expert-manager` prompt, one-shot bootstrap consumption, and expert-creator category behavior.
- [ ] Run the focused model test and verify it fails before implementation.
- [ ] Add `installedExperts`, `loadInstalledExperts`, and `startExpertCreatorChat`; create an `expert_creator` conversation, navigate to it, then enqueue a composer bootstrap scoped to its id.
- [ ] Consume the bootstrap in Composer, render `/expert-manager` through the existing token system, lock out conflicting skill selection for the dedicated conversation, and retain normal file/permission controls.
- [ ] Re-run the focused tests and frontend TypeScript check.

### Task 6: WorkBuddy-style My Experts interface

**Files:**
- Modify: `frontend/src/components/ExpertPanel.tsx`
- Modify: `frontend/src/components/ExpertPanel.css`
- Modify: `frontend/src/types/experts.ts`

- [ ] Replace the expert-tab catalog grid with an installed-expert view containing Agent/Team filters, counts, search, accessible cards, deterministic avatar fallback, empty/error states and a create card.
- [ ] Wire create-card pending/navigation recovery behavior and installed-card expert chat creation.
- [ ] Match the supplied interaction hierarchy while preserving the existing theme tokens, responsive layout, keyboard focus and reduced-motion behavior.
- [ ] Run frontend lint, TypeScript and production build.

### Task 7: End-to-end refresh and regression verification

**Files:**
- Modify: `docs/18-专家系统架构设计.md`

- [ ] Document the implemented installed-expert overlay and expert-manager creation flow in the main expert architecture document.
- [ ] Run `node --import tsx --test src/agent/experts/*.test.ts src/agent/expert_manager_context.test.ts src/agent/provider_profile_reload.test.ts src/domains/session/node/expert_binding_store.test.ts frontend/src/components/expertCreatorModel.test.ts frontend/src/utils/artifactPresentation.test.ts`.
- [ ] Run `npx tsc --project tsconfig.electron.json --noEmit`, `cd frontend && npx tsc --noEmit -p tsconfig.app.json`, `cd frontend && npm run lint`, `cd frontend && npm run build`, and `git diff --check`.
- [ ] Manually inspect the final diff for prompt leakage, path traversal, stale registry replacement, duplicate conversation creation and accidental edits to unrelated user changes.

