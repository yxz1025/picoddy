# SkillHub Catalog Installation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the hard-coded recommended SkillHub cards with the self-hosted SkillHub catalog and install a remote skill when the user clicks “+”.

**Architecture:** A Node-side catalog client loads every web catalog page. A generic built-in CLI plugin runtime executes registered manifests with a fixed registry and custom user-skill directory; the SkillHub adapter is the first plugin. Existing local API/IPC plumbing exposes list and install operations to the renderer. The Zustand store owns catalog/loading/installing state and the existing ExpertPanel renders it.

**Tech Stack:** Electron 43, Node.js 22 fetch/child_process, `@astron-team/skillhub`, TypeScript, React 19, Zustand 5, Node test runner via `tsx --test`.

---

### Task 1: SkillHub catalog client

**Files:**
- Create: `src/domains/skillhub/node/client.ts`
- Test: `src/domains/skillhub/node/client.test.ts`

- [ ] **Step 1: Write failing client tests**

Cover catalog response mapping, loading all pages reported by `total`, and safe failures for non-zero business codes, invalid pagination, or failed HTTP responses. Use an injected `fetchImpl` so tests perform no network I/O.

- [ ] **Step 2: Run the client test and verify RED**

Run: `npx tsx --test src/domains/skillhub/node/client.test.ts`

Expected: FAIL because `client.ts` does not exist.

- [ ] **Step 3: Implement the minimal client**

Define `SkillHubSkill`, `SkillHubVersion`, `SkillHubClientOptions`, and `listSkillHubSkills(options?)`. The default registry is:

```ts
const DEFAULT_BASE_URL = "http://skillhub.example.com";
```

Allow `SKILLHUB_BASE_URL` to override the default. Validate every remote envelope and return only normalized fields used by the renderer.

- [ ] **Step 4: Run the client test and verify GREEN**

Run: `npx tsx --test src/domains/skillhub/node/client.test.ts`

Expected: all client tests PASS.

### Task 2: Official CLI installer

**Files:**
- Create: `src/domains/skillhub/node/installer.ts`
- Test: `src/domains/skillhub/node/installer.test.ts`
- Modify: `package.json`
- Modify: `package-lock.json`

- [ ] **Step 1: Write failing CLI adapter tests**

Inject the process runner and assert that installation uses the pinned CLI entry with arguments `install`, `<namespace>/<slug>`, `--version`, `--dir`, `--registry`, and `--json`. Assert that no shell is used, `ELECTRON_RUN_AS_NODE=1` is set, optional `SKILLHUB_TOKEN` is inherited, output is bounded, and exit codes map to safe errors.

- [ ] **Step 2: Run the store test and verify RED**

Run: `npx tsx --test src/domains/skillhub/node/installer.test.ts`

Expected: FAIL because `installer.ts` does not exist.

- [ ] **Step 3: Implement `installSkillHubSkillWithCli`**

Add `@astron-team/skillhub` as a runtime dependency so Electron Builder includes it. Resolve its `dist/index.js` entry without a global command, then execute it using `process.execPath` and an argument array:

```ts
[
  cliEntry, "install", `${namespace}/${slug}`,
  "--version", version,
  "--dir", platformPaths.skillsDir,
  "--registry", baseUrl,
  "--json",
]
```

Run with stdin ignored, no shell, a bounded buffer and timeout. Set `ELECTRON_RUN_AS_NODE=1`; pass `SKILLHUB_TOKEN` only through the child environment. Parse the JSON success envelope and map CLI exit codes to safe application errors.

- [ ] **Step 4: Run the store test and verify GREEN**

Run: `npx tsx --test src/domains/skillhub/node/installer.test.ts`

Expected: all installer tests PASS.

### Task 2a: Standard built-in CLI plugin runtime

**Files:**
- Create: `src/platform/cli/runtime.ts`
- Create: `src/platform/cli/runtime.test.ts`
- Create: `src/platform/cli/plugins.ts`

- [ ] Define the manifest, trusted built-in registry, sanitized process environment, Electron Node-mode execution, timeout and output limits.
- [ ] Keep business adapters responsible only for their CLI arguments and result/error mapping.
- [ ] Verify the runtime with injected runners; do not execute network or third-party commands in tests.

### Task 3: Local API and IPC routes

**Files:**
- Modify: `application.electron.ts`
- Modify: `src/electron/ipc-handlers.ts`
- Modify: `src/electron/preload.cjs`
- Modify: `frontend/src/api/client.ts`
- Modify: `frontend/src/api/client.test.ts`

- [ ] **Step 1: Add failing renderer route tests**

Export a test-only route resolver from `client.ts` if needed, then assert:

```ts
GET  /api/skillhub/skills  -> skillhub.list
POST /api/skillhub/install -> skillhub.install with the request body unchanged
```

- [ ] **Step 2: Run renderer route tests and verify RED**

Run: `npx tsx --test frontend/src/api/client.test.ts`

Expected: FAIL because SkillHub routes are absent.

- [ ] **Step 3: Add API and IPC plumbing**

Add `GET /api/skillhub/skills` and `POST /api/skillhub/install` before the generic `/api/skills/:name` matching. The install route validates non-empty `namespace`, `slug`, and `version`, executes the official CLI installer, rescans `/api/skills`, and returns the installed `SkillMeta`. Register `skillhub.list` and `skillhub.install` handlers and expose matching preload helpers.

- [ ] **Step 4: Run renderer route tests and type-check**

Run: `npx tsx --test frontend/src/api/client.test.ts`

Expected: all route tests PASS.

Run: `npx tsc --project tsconfig.electron.json --noEmit`

Expected: exit 0.

### Task 4: Catalog state model

**Files:**
- Create: `frontend/src/components/skillHubModel.ts`
- Test: `frontend/src/components/skillHubModel.test.ts`
- Modify: `frontend/src/store/useSkillStore.ts`

- [ ] **Step 1: Write failing model tests**

Test stable remote identity (`namespace/slug`), published-version selection, namespace categories, search across display name/slug/summary/namespace, and installed matching by returned installed name or slug.

- [ ] **Step 2: Run model tests and verify RED**

Run: `npx tsx --test frontend/src/components/skillHubModel.test.ts`

Expected: FAIL because `skillHubModel.ts` does not exist.

- [ ] **Step 3: Implement model helpers and Zustand actions**

Add `SkillHubSkill` and pure helpers to the model. Extend `SkillState` with catalog/loading/error/installing state plus:

```ts
loadSkillHubSkills: () => Promise<void>;
installSkillHubSkill: (skill: SkillHubSkill) => Promise<SkillMeta>;
```

The install action rejects a missing published version, deduplicates the same identity, calls `/api/skillhub/install`, records the returned local name, refreshes `/api/skills`, and always clears installing state.

- [ ] **Step 4: Run model tests and verify GREEN**

Run: `npx tsx --test frontend/src/components/skillHubModel.test.ts`

Expected: all model tests PASS.

### Task 5: Replace the recommended SkillHub UI

**Files:**
- Modify: `frontend/src/components/ExpertPanel.tsx`
- Modify: `frontend/src/components/ExpertPanel.css`

- [ ] **Step 1: Connect panel lifecycle to catalog loading**

Select the new SkillHub store state/actions and load the catalog when the skill tab is first displayed. Retain `TEMPLATE_SKILLS` only for the separate featured section.

- [ ] **Step 2: Replace hard-coded recommended cards**

Build categories and filtered cards from remote skills. Render `displayName ?? slug`, `summary`, namespace, installed/enabled state, published-version availability, and a per-card installing spinner. Clicking “+” calls `installSkillHubSkill`; installed cards remain non-destructive and are removed only from “我安装的”.

- [ ] **Step 3: Add empty/error/retry states**

Show a loading state during the first request, an inline retry button on failure, and an empty message when the response contains no skills. Reuse existing visual tokens and add only focused CSS for the status rows/spinner.

- [ ] **Step 4: Build the frontend**

Run: `npm run build --prefix frontend`

Expected: TypeScript and Vite build exit 0.

### Task 6: Full verification and review

**Files:**
- Review all files changed by Tasks 1–5.

- [ ] **Step 1: Run all new focused tests together**

Run: `npx tsx --test src/domains/skillhub/node/client.test.ts src/domains/skillhub/node/installer.test.ts frontend/src/api/client.test.ts frontend/src/components/skillHubModel.test.ts src/electron/api-response.test.ts`

Expected: all tests PASS with zero failures.

- [ ] **Step 2: Run project verification**

Run: `npx tsc --project tsconfig.electron.json --noEmit`

Expected: exit 0.

Run: `npm run build --prefix frontend`

Expected: exit 0.

- [ ] **Step 3: Review scope and whitespace**

Run: `git diff --check`

Expected: no output and exit 0.

Run: `git diff --stat`

Expected: changes are limited to the SkillHub catalog/CLI adapter and tests, runtime dependency, API/IPC plumbing, store/model, ExpertPanel, CSS, spec, and this plan.
