# Protected Built-in Skills Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Package six real built-in skill directories into a deterministic gzip bundle, install them atomically into a protected system root, scan them through the existing `skills.ts`, and prevent Agent tools from modifying PiCoddy-a code or built-in skills on macOS and Windows.

**Architecture:** `resources/builtin-skills` becomes the only authored source. A build script validates and compresses the tree into generated artifacts; startup installs the bundle into `platformPaths.builtinSkillsDir`. Existing `loadSkills()` scans built-in and user roots in precedence order. A cross-platform path policy and session-specific tool root replace the current HOME-wide writable tool scope.

**Tech Stack:** Deno 2.9, TypeScript, Web `CompressionStream`/`DecompressionStream`, SHA-256 Web Crypto, `node:path` POSIX/Win32 adapters, Pi coding tools, Deno tests.

---

## File map

**Create**

- `resources/builtin-skills/{weekly-report,data-analysis,presentation,polish-writing,doc-qa}/SKILL.md` — real simple built-in skills.
- `resources/builtin-skills/skill-creator/**` — complete official package copied from the pinned source represented by the current generated bundle.
- `scripts/build-builtin-skills.ts` — deterministic scanner, validator, manifest and gzip bundle generator.
- `scripts/build-builtin-skills_test.ts` — build-format and cross-platform regression tests.
- `src/agent/builtin_skills/bundle.ts` — generated artifact contract and decompression helpers.
- `src/agent/builtin_skills/installer.ts` — verified staging/backup/current installation.
- `src/agent/builtin_skills/installer_test.ts` — first install, reuse, replacement and rollback tests.
- `src/platform/path_policy.ts` — platform-aware protected-root and writable-target policy.
- `src/platform/path_policy_test.ts` — macOS/Windows path normalization and boundary tests.
- `src/agent/tools/session_root.ts` — resolve per-session workspace/artifact root and protected status.
- `src/agent/tools/session_root_test.ts` — workspace selection tests.
- `src/domains/skill/node/store_test.ts` — source-aware skill listing and mutation protection tests.
- `src/agent/provider_test.ts` — session-root tool selection tests.

**Modify**

- `src/platform/paths.ts`, `src/platform/paths_test.ts` — expose system/built-in paths.
- `src/agent/skills.ts` — install bundle and scan built-in + user roots.
- `src/domains/skill/node/store.ts` — merge roots and make built-ins read-only by source.
- `src/agent/skill_creator_context.ts`, `src/agent/skill_creator_context_test.ts` — read protected `skill-creator/SKILL.md`.
- `src/agent/tools/index.ts`, `src/agent/provider.ts` — use session-specific roots and remove HOME-wide writes.
- `src/agent/sandbox.ts`, `src/agent/permissions.ts` and tests — hard-block protected paths and shell use in protected workspaces.
- `deno.json` — run bundle generation before desktop builds.

**Delete after replacement tests pass**

- `scripts/embed-skill-creator.ts`
- `src/agent/builtin_skills/skill_creator.generated.ts`
- `src/agent/builtin_skills/skill_creator_seed.ts`
- `src/agent/builtin_skills/skill_creator.ts`

---

### Task 1: Real skill tree and deterministic bundle builder

**Files:**

- Create: `resources/builtin-skills/**`
- Create: `scripts/build-builtin-skills.ts`
- Create: `scripts/build-builtin-skills_test.ts`
- Create generated: `src/agent/builtin_skills/builtin-skills.manifest.generated.json`
- Create generated: `src/agent/builtin_skills/builtin-skills.bundle.generated.ts`

- [ ] **Step 1: Write failing builder tests**

Test a fixture with text and binary files and assert stable `/` paths, six required real skills, identical repeated output, SHA-256 integrity, rejection of symlinks, case-folded duplicate skill names and invalid frontmatter. The public API must be:

```ts
export interface BuiltinSkillManifest {
  formatVersion: 1;
  bundleDigest: string;
  skills: Array<{ name: string; skillFile: string }>;
  files: Array<{ path: string; size: number; sha256: string }>;
}

export async function buildBuiltinSkills(input: {
  sourceDir: string;
  manifestOutput?: string;
  moduleOutput?: string;
}): Promise<{ manifest: BuiltinSkillManifest; gzip: Uint8Array }>;
```

- [ ] **Step 2: Run the test and verify RED**

Run:

```bash
deno test --allow-read --allow-write --allow-env scripts/build-builtin-skills_test.ts
```

Expected: FAIL because `build-builtin-skills.ts` and the API do not exist.

- [ ] **Step 3: Move the six skills into real directories**

Copy the five literal `SKILL.md` bodies from `src/agent/skills.ts`. Reconstruct the official `skill-creator` files byte-for-byte from the current generated module, preserving the pinned hashes already asserted in `skill_creator_context_test.ts`.

- [ ] **Step 4: Implement the minimal deterministic builder**

Use `lstat`, reject symlinks, normalize archive paths with `/`, stable-sort entries, calculate SHA-256 with `crypto.subtle.digest`, serialize a stable JSON payload, and gzip it. To keep gzip deterministic, patch or construct the header with a zero modification timestamp before producing the generated Base64 module.

The generated module shape must be:

```ts
export const BUILTIN_SKILLS_MANIFEST = /* generated manifest */ as const;
export const BUILTIN_SKILLS_GZIP_BASE64 = "...";
```

- [ ] **Step 5: Run builder tests and generate repository artifacts**

Run:

```bash
deno test --allow-read --allow-write --allow-env scripts/build-builtin-skills_test.ts
deno run --allow-read --allow-write scripts/build-builtin-skills.ts resources/builtin-skills src/agent/builtin_skills
```

Expected: all builder tests PASS; generated manifest contains exactly six skills.

- [ ] **Step 6: Commit this vertical slice**

```bash
git add resources/builtin-skills scripts/build-builtin-skills.ts scripts/build-builtin-skills_test.ts src/agent/builtin_skills/builtin-skills.manifest.generated.json src/agent/builtin_skills/builtin-skills.bundle.generated.ts
git commit -m "feat: package real builtin skill directories"
```

---

### Task 2: Cross-platform paths and atomic built-in installer

**Files:**

- Modify: `src/platform/paths.ts`
- Modify: `src/platform/paths_test.ts`
- Create: `src/agent/builtin_skills/bundle.ts`
- Create: `src/agent/builtin_skills/installer.ts`
- Create: `src/agent/builtin_skills/installer_test.ts`

- [ ] **Step 1: Add failing platform path tests**

Assert these exact values:

```ts
assertEquals(paths.systemDir, "/Users/tester/.pi-a/system");
assertEquals(
  paths.builtinSkillsDir,
  "/Users/tester/.pi-a/system/builtin-skills/current",
);
```

and on Windows:

```ts
assertEquals(
  paths.builtinSkillsDir,
  "C:\\Users\\测试 用户\\AppData\\Local\\Pi-a\\system\\builtin-skills\\current",
);
```

- [ ] **Step 2: Add failing installer tests**

Inject filesystem hooks into:

```ts
export async function ensureBuiltinSkillsInstalled(options?: {
  rootDir?: string;
  manifest?: BuiltinSkillManifest;
  gzip?: Uint8Array;
  beforeActivate?: () => void | Promise<void>;
}): Promise<"installed" | "current" | "updated">;
```

Cover empty install, same digest reuse without rewriting, new bundle replacement, hash mismatch rejection, injected activation failure rollback, no symlink traversal, and Windows-style path entries.

- [ ] **Step 3: Run both tests and verify RED**

```bash
deno test --allow-read --allow-write --allow-env src/platform/paths_test.ts src/agent/builtin_skills/installer_test.ts
```

Expected: FAIL for missing path fields and installer.

- [ ] **Step 4: Implement paths, decompression and installer**

Add to `PlatformPaths`:

```ts
systemDir: string;
builtinSkillsRootDir: string;
builtinSkillsDir: string;
```

Implement JSON payload decompression, file-by-file hash validation, unique staging/backup names, same-parent rename activation and rollback. Use POSIX chmod only when `Deno.build.os !== "windows"`; do not use symlinks on either platform.

- [ ] **Step 5: Run tests and verify GREEN**

```bash
deno test --allow-read --allow-write --allow-env src/platform/paths_test.ts src/agent/builtin_skills/installer_test.ts
```

Expected: all tests PASS.

- [ ] **Step 6: Commit this vertical slice**

```bash
git add src/platform/paths.ts src/platform/paths_test.ts src/agent/builtin_skills/bundle.ts src/agent/builtin_skills/installer.ts src/agent/builtin_skills/installer_test.ts
git commit -m "feat: install builtin skills atomically"
```

---

### Task 3: Existing skills.ts multi-root scan and read-only UI store

**Files:**

- Modify: `src/agent/skills.ts`
- Create: `src/agent/skills_test.ts`
- Modify: `src/domains/skill/node/store.ts`
- Create: `src/domains/skill/node/store_test.ts`
- Modify: `src/agent/skill_creator_context.ts`
- Modify: `src/agent/skill_creator_context_test.ts`
- Delete after green: legacy skill-creator generated/seed files and embed script

- [ ] **Step 1: Write failing multi-root and progressive-loading tests**

Expose an injectable helper in `skills.ts`:

```ts
export function loadSkillsPromptFromPaths(paths: {
  builtinDir: string;
  userDir: string;
}): string;
```

Assert built-in and user skills are present, built-in wins same-name collisions, disabled user skills are omitted, and prompt text contains metadata/location but not the body marker `SECRET_BODY_MUST_BE_LAZY`.

- [ ] **Step 2: Write failing store and creator tests**

Change store APIs to accept roots for tests:

```ts
export interface SkillRoots {
  builtinDir: string;
  userDir: string;
}

export async function listSkills(roots?: Partial<SkillRoots>): Promise<SkillMeta[]>;
```

Assert built-ins are marked by source, editing/deleting a built-in rejects with `内置技能不可修改`, user skills remain editable, and creator addon reads `builtinDir/skill-creator/SKILL.md` rather than generated constants.

- [ ] **Step 3: Run tests and verify RED**

```bash
deno test --allow-read --allow-write --allow-env src/agent/skills_test.ts src/agent/skill_creator_context_test.ts src/domains/skill/node/store_test.ts
```

Expected: FAIL because the new roots and protected creator source do not exist.

- [ ] **Step 4: Implement multi-root scanning in existing skills.ts**

Replace `writeBuiltinSkills()` and `seedBundledSkillCreator()` with `ensureBuiltinSkillsInstalled()`. Call `loadSkills` with `[builtinSkillsDir, skillsDir]`; keep `formatSkillsForPrompt` unchanged so only metadata is injected.

- [ ] **Step 5: Implement source-aware store and creator addon**

Scan built-in and user roots separately, tag results by source, reject mutations targeting built-ins before any filesystem operation, and read the creator body from the installed system root. Keep XML draft-ID escaping and the `skill_draft_*` runtime addon.

- [ ] **Step 6: Remove legacy special-case files and run GREEN tests**

```bash
deno test --allow-read --allow-write --allow-env src/agent/skills_test.ts src/agent/skill_creator_context_test.ts src/domains/skill/node/store_test.ts
```

Expected: all tests PASS; no production import references the deleted special-case modules.

- [ ] **Step 7: Commit this vertical slice**

```bash
git add src/agent/skills.ts src/agent/skills_test.ts src/domains/skill/node/store.ts src/domains/skill/node/store_test.ts src/agent/skill_creator_context.ts src/agent/skill_creator_context_test.ts src/agent/builtin_skills scripts/embed-skill-creator.ts
git commit -m "feat: scan protected and user skill roots"
```

---

### Task 4: Cross-platform protected path policy

**Files:**

- Create: `src/platform/path_policy.ts`
- Create: `src/platform/path_policy_test.ts`
- Modify: `src/agent/sandbox.ts`
- Modify: `src/agent/sandbox_test.ts`
- Modify: `src/agent/permissions.ts`
- Modify: `src/agent/permissions_windows_test.ts`

- [ ] **Step 1: Write failing pure path-policy tests**

Required API:

```ts
export interface ProtectedPathPolicy {
  os: "darwin" | "windows" | "linux";
  protectedRoots: string[];
}

export function isPathWithin(root: string, target: string, os: ProtectedPathPolicy["os"]): boolean;
export function assertWritableTarget(target: string, policy: ProtectedPathPolicy): void;
export function commandReferencesProtectedWrite(command: string, policy: ProtectedPathPolicy): boolean;
```

Test root/descendant blocking, sibling allowance, `..`, Windows case-folding, mixed separators, drive roots and UNC paths. Test that installation, source and built-in roots are hard-blocked.

- [ ] **Step 2: Write failing permission/sandbox tests**

Assert `write`/`edit` against a protected root is rejected on Darwin and Windows before L1/L2/L3 branching. Assert shell commands explicitly redirecting to protected roots are rejected on both platforms.

- [ ] **Step 3: Run tests and verify RED**

```bash
deno test --allow-read --allow-env src/platform/path_policy_test.ts src/agent/sandbox_test.ts src/agent/permissions_windows_test.ts
```

Expected: FAIL because application roots are not currently protected.

- [ ] **Step 4: Implement the pure policy and integrate the hard gate**

Construct the default roots from `installationDir`, `builtinSkillsRootDir`, and a development repository detector that requires `deno.json`, `application.ts`, and `src/agent`. Invoke the policy at the top of `inspectToolCallForPlatform`, before permission-level auto-approval.

- [ ] **Step 5: Run tests and verify GREEN**

```bash
deno test --allow-read --allow-env src/platform/path_policy_test.ts src/agent/sandbox_test.ts src/agent/permissions_windows_test.ts
```

Expected: all tests PASS on host OS using injected Darwin and Windows cases.

- [ ] **Step 6: Commit this vertical slice**

```bash
git add src/platform/path_policy.ts src/platform/path_policy_test.ts src/agent/sandbox.ts src/agent/sandbox_test.ts src/agent/permissions.ts src/agent/permissions_windows_test.ts
git commit -m "fix: protect application paths from agent writes"
```

---

### Task 5: Session-specific tool roots and self-workspace read-only mode

**Files:**

- Create: `src/agent/tools/session_root.ts`
- Create: `src/agent/tools/session_root_test.ts`
- Modify: `src/agent/tools/index.ts`
- Modify: `src/agent/provider.ts`
- Modify or create: `src/agent/provider_test.ts`

- [ ] **Step 1: Write failing session-root tests**

Required API:

```ts
export interface SessionToolRoot {
  cwd: string;
  protected: boolean;
}

export function resolveSessionToolRoot(input: {
  workspaceDir?: string | null;
  artifactsDir: string;
  policy: ProtectedPathPolicy;
}): SessionToolRoot;
```

Assert a normal workspace is used, no workspace falls back to artifacts rather than HOME, and a PiCoddy-a source workspace is marked protected.

- [ ] **Step 2: Write failing tool-selection tests**

Change signatures to:

```ts
export function getFullTools(options: {
  cwd: string;
  protectedWorkspace: boolean;
  selectedMcpTools?: AgentTool[];
}): AgentTool[];

export function getReadOnlyTools(cwd: string): AgentTool[];
```

Assert protected workspaces contain `read/grep/find/ls` but not `write/edit/bash`; normal workspaces retain writable tools; no-workspace sessions bind to artifacts.

- [ ] **Step 3: Run tests and verify RED**

```bash
deno test --allow-read --allow-write --allow-env src/agent/tools/session_root_test.ts src/agent/provider_test.ts
```

Expected: FAIL because tools are still created with `homeDirectory()`.

- [ ] **Step 4: Implement session root resolution and provider wiring**

Read `workspace_id` and workspace `dir_path` during `createSession`. Pass `sessionId`, resolved cwd and protection status into `toolsForConversation`. Remove the HOME-root helper. Filter shell/write/edit in protected workspaces and use artifacts for unbound sessions.

- [ ] **Step 5: Guard actual write/edit operations**

Supply wrapped Pi coding-tool operations that call `assertWritableTarget()` immediately before mkdir/write. Keep read tools able to open absolute built-in `SKILL.md` paths so progressive loading still works.

- [ ] **Step 6: Run tests and verify GREEN**

```bash
deno test --allow-read --allow-write --allow-env src/agent/tools/session_root_test.ts src/agent/provider_test.ts src/platform/path_policy_test.ts
```

Expected: all tests PASS.

- [ ] **Step 7: Commit this vertical slice**

```bash
git add src/agent/tools/session_root.ts src/agent/tools/session_root_test.ts src/agent/tools/index.ts src/agent/provider.ts src/agent/provider_test.ts
git commit -m "fix: scope agent tools to session workspaces"
```

---

### Task 6: Build integration, regression and startup acceptance

**Files:**

- Modify: `deno.json`
- Modify: `docs/11-已安装技能修订与原子更新处理记忆.md`
- Modify or create: `src/agent/builtin_skills/startup_acceptance_test.ts`

- [ ] **Step 1: Add failing build-task and startup acceptance tests**

Assert every desktop/package task runs `build:builtin-skills` before compilation. Add an acceptance test using a temporary app data root that runs install, calls the existing `skills.ts` scanner, and checks the six built-in names and protected locations.

- [ ] **Step 2: Run acceptance test and verify RED**

```bash
deno test --allow-read --allow-write --allow-env src/agent/builtin_skills/startup_acceptance_test.ts
```

Expected: FAIL until task wiring and startup path are complete.

- [ ] **Step 3: Wire build tasks and update the handling memory**

Add:

```json
"build:builtin-skills": "deno run --allow-read --allow-write scripts/build-builtin-skills.ts resources/builtin-skills src/agent/builtin_skills"
```

Prepend it to `desktop`, `build`, macOS builds and `build:windows:prepare`. Document the source/bundle/system-root/update model and the protected-path rule.

- [ ] **Step 4: Run the focused full regression suite**

```bash
deno test --allow-read --allow-write --allow-env --allow-ffi --allow-run \
  scripts/build-builtin-skills_test.ts \
  src/platform/paths_test.ts \
  src/platform/path_policy_test.ts \
  src/agent/builtin_skills/installer_test.ts \
  src/agent/builtin_skills/startup_acceptance_test.ts \
  src/agent/skills_test.ts \
  src/agent/skill_creator_context_test.ts \
  src/domains/skill/node/store_test.ts \
  src/domains/skill-draft/node/store_test.ts \
  src/agent/sandbox_test.ts \
  src/agent/permissions_windows_test.ts \
  src/agent/tools/session_root_test.ts \
  src/agent/provider_test.ts
```

Expected: zero failed tests.

- [ ] **Step 5: Run type and frontend verification**

```bash
deno check main.ts application.ts
deno task build:frontend
deno task gen:frontend
```

Expected: all commands exit 0. Preserve any pre-existing user change to `src/ui/frontend-assets.ts`; only report the generated diff rather than overwriting unrelated work without review.

- [ ] **Step 6: Run startup/index acceptance**

Start with an isolated data directory or injected test paths, wait for the startup log marker `skills-loaded`, call `/api/skills`, and assert:

```text
weekly-report data-analysis presentation polish-writing doc-qa skill-creator
```

All six must have `builtin=true` and paths under `system/builtin-skills/current`.

- [ ] **Step 7: Review the final diff and commit**

```bash
git status --short
git diff --check
git diff --stat
git add deno.json docs/11-已安装技能修订与原子更新处理记忆.md src/agent/builtin_skills/startup_acceptance_test.ts src/ui/frontend-assets.ts
git commit -m "test: verify protected builtin skill startup"
```

Do not stage unrelated pre-existing changes. If `src/ui/frontend-assets.ts` was dirty before execution, compare it against the generated output and obtain user direction before staging it.
