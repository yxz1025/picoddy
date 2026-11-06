# Test Layout and Dead Code Cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move backend and script tests into a root `test/` mirror while preserving all frontend test locations, then remove only project code proven to be unused.

**Architecture:** Keep `frontend/` unchanged. Move only tests currently under `src/` and `scripts/` into `test/src/` and `test/scripts/`, rewriting their imports to point back to production files. Use static-analysis output as a candidate list, manually protect dynamic Electron/plugin/generated entrypoints, and delete candidates one group at a time with focused verification.

**Tech Stack:** Node.js `node:test`, `tsx`, TypeScript, `rg`, npm scripts, existing Electron/Vite build.

---

## File map

- Move: every `src/**/*.{test,spec}.{ts,tsx}` to the matching `test/src/` path.
- Move: every `scripts/**/*.{test,spec}.{ts,tsx}` to the matching `test/scripts/` path.
- Keep unchanged: all `frontend/**/*.{test,spec}.{ts,tsx}` files.
- Modify: moved backend/script tests to repair imports from the new location.
- Modify: `AGENT.md` to document the backend/script test rule and frontend exception.
- Modify: `package.json` to add repeatable backend test commands without changing frontend commands.
- Modify: files identified by static analysis only after reference verification.

## Task 1: Establish the test command and rule before moving files

**Files:**
- Modify: `AGENT.md`
- Modify: `package.json`

- [ ] **Step 1: Add the repository test commands.**

Add scripts that discover only the moved backend/script tests:

```json
{
  "test:backend": "tsx --test $(find test/src test/scripts -type f \\( -name '*.test.ts' -o -name '*.test.tsx' -o -name '*.spec.ts' -o -name '*.spec.tsx' \\) -print)",
  "test:backend:changed": "tsx --test"
}
```

Keep `frontend/package.json` unchanged. The `test:backend:changed` command is used with explicit test paths during incremental execution; the normal command is the full backend/script suite.

- [ ] **Step 2: Add the exact AGENT.md rule.**

Under `必须遵守`, add:

```markdown
- 后端和脚本测试文件统一放在根目录 `test/` 下，并按源码目录镜像组织；`frontend/` 测试保持现有位置，不要移动前端测试。
```

- [ ] **Step 3: Verify the documentation and package JSON.**

Run:

```bash
node --input-type=module -e "const p=JSON.parse(await import('node:fs/promises').then(m=>m.readFile('package.json','utf8'))); if (!p.scripts['test:backend']) throw new Error('missing test:backend'); console.log('ok')"
git diff --check
```

Expected: `ok` and no diff errors.

## Task 2: Move backend and script tests, preserving frontend tests

**Files:**
- Move: all test files selected by `rg --files src scripts -g '*test.ts' -g '*test.tsx' -g '*spec.ts' -g '*spec.tsx'`.
- Modify: moved files only.

- [ ] **Step 1: Snapshot the exact migration set.**

Run and save the list for review:

```bash
rg --files src scripts -g '*test.ts' -g '*test.tsx' -g '*spec.ts' -g '*spec.tsx' | sort
```

Expected: 41 backend/script test files in the current tree; no `frontend/` path appears.

- [ ] **Step 2: Move each file into the mirrored test directory.**

For every path `src/X.test.ts`, move it to `test/src/X.test.ts`; for every path `scripts/X.test.ts`, move it to `test/scripts/X.test.ts`. Use `git mv` for tracked files and a recoverable move for untracked files. Do not move or delete any `frontend` test.

- [ ] **Step 3: Rewrite relative imports based on the original test location.**

For every moved test import or export beginning with `.`, resolve it relative to the original test directory, then rewrite it relative to the new `test/<original-directory>` directory. Imports into production code must resolve under `src/` or `scripts/`; imports of test helpers must resolve under `test/`.

Example:

```ts
// Original: src/domains/workspace/node/path.test.ts
import { normalizeWorkspaceDirPath } from "./path.ts";

// New: test/src/domains/workspace/node/path.test.ts
import { normalizeWorkspaceDirPath } from "../../../../../src/domains/workspace/node/path.ts";
```

- [ ] **Step 4: Verify no backend/script test remains in its source tree.**

Run:

```bash
test "$(rg --files src scripts -g '*test.ts' -g '*test.tsx' -g '*spec.ts' -g '*spec.tsx' | wc -l | tr -d ' ')" = "0"
test "$(rg --files frontend -g '*test.ts' -g '*test.tsx' -g '*spec.ts' -g '*spec.tsx' | wc -l | tr -d ' ')" = "11"
```

Expected: backend/script count `0`; frontend count remains `11`.

## Task 3: Run moved tests and repair migration defects

**Files:**
- Modify: moved files under `test/src/` and `test/scripts/` only when a test import or fixture path is broken.

- [ ] **Step 1: Run the smallest moved test groups.**

Run:

```bash
npx tsx --test test/src/domains/workspace/node/path.test.ts test/scripts/build-builtin-skills.test.ts
```

Expected: both groups pass. A module-resolution failure means the moved file's relative import needs correction before proceeding.

- [ ] **Step 2: Run the complete backend/script suite.**

Run:

```bash
npm run test:backend
```

Expected: all migrated tests pass. Tests that depend on the Electron runtime or external services must be reported separately and not silently skipped.

- [ ] **Step 3: Run frontend tests unchanged.**

Run the existing frontend test command with the same paths and imports as before:

```bash
npx tsx --test frontend/src/api/client.test.ts frontend/src/utils/artifactPresentation.test.ts frontend/src/utils/markdownPreview.test.ts
```

Expected: frontend tests continue to pass without any frontend file move.

## Task 4: Produce and review the unused-code candidate list

**Files:**
- Candidate files only after review; no automatic deletion in this task.

- [ ] **Step 1: Run static analysis without adding a permanent dependency.**

Run:

```bash
npx --yes knip --include files,exports,dependencies --no-exit-code
```

Treat its output as candidates, not proof. Record each candidate with its file path, symbol, and reason.

- [ ] **Step 2: Cross-check every candidate against project entrypoints.**

For each candidate, run `rg -n` for imports, string-based IPC names, dynamic imports, package exports, generated-file references, plugin manifests, `main.mjs`, `application.electron.ts`, `preload.cjs`, Vite config, and electron-builder config. Exclude candidates used through runtime strings or generated artifacts.

- [ ] **Step 3: Separate safe deletions from uncertain candidates.**

Safe deletions require zero references after the cross-check and must not be an entrypoint. Keep uncertain candidates unchanged and report them instead of guessing.

## Task 5: Delete confirmed unused code in small groups

**Files:**
- Modify/delete only the reviewed safe candidates from Task 4.

- [ ] **Step 1: Delete one candidate group.**

Use `apply_patch` for source edits and remove only the exact confirmed file/symbol. Do not touch existing unrelated modified files unless the candidate is independently proven unused.

- [ ] **Step 2: Verify after each group.**

Run:

```bash
npx tsc --project tsconfig.electron.json --noEmit
npm run test:backend
cd frontend && npm run build
```

Expected: all checks pass. If a deletion breaks a dynamic path or test, restore that candidate and classify it as retained.

- [ ] **Step 3: Repeat only for the remaining safe candidates.**

Do not batch uncertain deletions. Keep a final retained-candidates note in the handoff rather than deleting by intuition.

## Task 6: Final repository verification

**Files:**
- Modify: `AGENT.md`, `package.json`, moved tests, and confirmed cleanup files only.

- [ ] **Step 1: Verify layout and imports.**

Run:

```bash
rg --files src scripts -g '*test.ts' -g '*test.tsx' -g '*spec.ts' -g '*spec.tsx'
rg -n 'from ["\x27]\./|from ["\x27]\../' test/src test/scripts
```

The first command must return no files. The second command must show only imports that resolve to existing files.

- [ ] **Step 2: Run the complete verification set.**

```bash
npm run test:backend
npx tsx --test frontend/src/api/client.test.ts frontend/src/utils/artifactPresentation.test.ts frontend/src/utils/markdownPreview.test.ts
npx tsc --project tsconfig.electron.json --noEmit
npm run build --prefix frontend
git diff --check
```

- [ ] **Step 3: Report cleanup evidence.**

List moved test count, frontend tests intentionally left in place, deleted files/symbols with reference evidence, retained uncertain candidates, and all verification results.
