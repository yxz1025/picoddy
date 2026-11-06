# Expert Multi-Skill Composition Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow an `expert_creator` conversation to select multiple business skills in the Composer and pass a validated skill set to the existing `expert-manager` script lifecycle for creation of a self-contained expert package.

**Architecture:** Keep `expert-manager` as the fixed control-plane skill and store business-skill selection separately from editable prompt text. Send canonical skill names through the HTTP/IPC prompt contract, resolve them against the authoritative skill registry on every turn, and expose only validated roots/revisions to the existing `expert-manager` workflow. Existing `init_expert.py`, `register_expert.py`, and `package_expert.py` retain their responsibilities; `validate_expert.py` gains multi-skill path and manifest-consistency checks.

**Tech Stack:** React 19, Zustand, TypeScript 6, Electron IPC/HTTP bridge, Node.js test runner, Python `unittest`, Playwright.

---

## File map

- Create `frontend/src/components/expertSkillSelectionModel.ts`: pure ordered-set operations and the eight-skill limit.
- Create `frontend/src/components/expertSkillSelectionModel.test.ts`: selection model regression tests.
- Modify `frontend/src/store/useStore.ts`: per-conversation selected-skill state and prompt payload.
- Create `frontend/src/api/promptRequestModel.ts`: pure HTTP-to-IPC prompt request mapping.
- Create `frontend/src/api/promptRequestModel.test.ts`: request mapping regression test.
- Modify `frontend/src/components/ComposerPlusMenu.tsx`: show skills while expert mode is locked and expose selected state.
- Modify `frontend/src/components/Composer.tsx`: fixed manager chip, business-skill chips, add/remove behavior and send integration.
- Modify `frontend/src/components/ChatArea.css`: WorkBuddy-style skill chip layout and accessibility states.
- Modify `frontend/src/api/client.ts`: forward `selectedSkillNames` through IPC.
- Modify `src/electron/ipc-handlers.ts`: forward selected names to the application prompt handler.
- Modify `application.electron.ts`: validate request shape and pass selected names to Provider.
- Create `src/agent/expert_selected_skills.ts`: authoritative resolution, limits, safe tree inspection, hashing and XML addon generation.
- Create `src/agent/expert_selected_skills.test.ts`: backend resolution/security tests.
- Modify `src/agent/provider.ts`: resolve selected skills per creator turn and inject the addon without replacing the existing manager context.
- Modify `resources/builtin-skills/expert-manager/SKILL.md`: document selected-skill materialization using the existing lifecycle.
- Modify `resources/builtin-skills/expert-manager/scripts/validate_expert.py`: validate package-local skills and Agent manifest consistency.
- Create `resources/builtin-skills/expert-manager/scripts/test_validate_expert_skills.py`: Python regression tests.
- Regenerate `src/agent/builtin_skills/builtin-skills.manifest.generated.json` and `src/agent/builtin_skills/builtin-skills.bundle.generated.ts`.
- Modify `docs/18-专家系统架构设计.md`: record the final multi-skill data flow.

### Task 1: Ordered per-conversation skill selection

**Files:**
- Create: `frontend/src/components/expertSkillSelectionModel.ts`
- Create: `frontend/src/components/expertSkillSelectionModel.test.ts`
- Modify: `frontend/src/store/useStore.ts`

- [ ] **Step 1: Write failing selection-model tests**

Cover ordered insertion, case-folded de-duplication, removal, rejection of `expert-manager`, and the maximum of eight skills:

```ts
test("adds business skills in order and de-duplicates case-insensitively", () => {
  assert.deepEqual(addExpertSkill(["alpha"], "Beta"), ["alpha", "Beta"]);
  assert.deepEqual(addExpertSkill(["alpha"], "ALPHA"), ["alpha"]);
});

test("reserves expert-manager and limits selection to eight skills", () => {
  assert.throws(() => addExpertSkill([], "expert-manager"), /reserved/);
  assert.throws(
    () => addExpertSkill(["a", "b", "c", "d", "e", "f", "g", "h"], "i"),
    /8/,
  );
});
```

- [ ] **Step 2: Run the tests and verify RED**

Run:

```bash
node --import tsx --test frontend/src/components/expertSkillSelectionModel.test.ts
```

Expected: FAIL because the model module does not exist.

- [ ] **Step 3: Implement the minimal pure model**

Export:

```ts
export const MAX_EXPERT_BUSINESS_SKILLS = 8;
export function addExpertSkill(current: readonly string[], name: string): string[];
export function removeExpertSkill(current: readonly string[], name: string): string[];
```

Require a non-empty canonical skill name, reserve `expert-manager`, preserve insertion order and return defensive arrays.

- [ ] **Step 4: Add Zustand state keyed by conversation ID**

Add these fields to `AppState`:

```ts
expertComposerSkills: Record<string, string[]>;
addExpertComposerSkill(conversationId: string, skillName: string): void;
removeExpertComposerSkill(conversationId: string, skillName: string): void;
clearExpertComposerSkills(conversationId: string): void;
```

Initialize the map as `{}`. Use the pure model for mutations and clear the matching entry from `deleteConversation`.

- [ ] **Step 5: Run tests and type-check GREEN**

```bash
node --import tsx --test frontend/src/components/expertSkillSelectionModel.test.ts
cd frontend && npx tsc --noEmit -p tsconfig.app.json
```

Expected: all model tests pass and TypeScript exits 0.

- [ ] **Step 6: Commit the focused change**

```bash
git add frontend/src/components/expertSkillSelectionModel.ts frontend/src/components/expertSkillSelectionModel.test.ts frontend/src/store/useStore.ts
git commit -m "feat: track expert creator skill selections"
```

### Task 2: WorkBuddy-style multi-skill Composer UI

**Files:**
- Modify: `frontend/src/components/ComposerPlusMenu.tsx`
- Modify: `frontend/src/components/Composer.tsx`
- Modify: `frontend/src/components/ChatArea.css`

- [ ] **Step 1: Extend the menu contract before changing rendering**

Add props:

```ts
allowSkillSelection?: boolean;
selectedSkillNames?: readonly string[];
```

Change root filtering so `modeLocked` hides only mode selection; hide the skill item only when `allowSkillSelection === false`. Reorder creator items as 添加文件 → 技能 → 专家 → 连接器.

- [ ] **Step 2: Render selected state and keep the skill submenu open**

For each skill, compare `skill.name` with `selectedSkillNames` case-insensitively, set `aria-checked`, add `is-selected`, and render `<Check size={16} />`. Clicking an already selected skill is a no-op; a new selection calls `onSkillSelected` without closing the menu so multiple skills can be added consecutively.

- [ ] **Step 3: Replace editable manager token with fixed visual state**

Change expert creator bootstrap to contain only the prompt body. In the Composer input surface render:

```tsx
<div className="composer-selected-skills" aria-label="已选技能">
  <span className="composer-skill-pill is-fixed" aria-label="固定技能 expert-manager">
    <Sparkles size={13} />
    expert-manager
    <LockKeyhole size={11} />
  </span>
  {selectedSkills.map((skill) => (
    <span className="composer-skill-pill" key={skill.name}>
      {skill.displayName || skill.name}
      <button aria-label={`移除技能 ${skill.name}`} ...><X size={11} /></button>
    </span>
  ))}
</div>
```

The contenteditable contains only the expert description. `expert-manager` cannot be deleted; business skills are removable while idle.

- [ ] **Step 4: Connect selection actions**

For `expert_creator`, `handleDynamicSkill` calls `addExpertComposerSkill(currentConvId, skill.name)` instead of inserting slash text. Normal conversations retain the existing slash-token behavior. Pass `allowSkillSelection={!isSkillCreator}` and the selected names into `ComposerPlusMenu`.

- [ ] **Step 5: Add focused CSS**

Use existing theme variables. The row must wrap, remain inside the input border, expose `:focus-visible`, use a restrained accent for the fixed chip, and disable chip removal while busy. Do not add new fonts or global colors.

- [ ] **Step 6: Type-check and visually inspect**

```bash
cd frontend && npx tsc --noEmit -p tsconfig.app.json
```

Expected: exit 0. Manual DOM expectation: the menu exposes 技能, two selections render two removable pills, and expert-manager has no remove button.

- [ ] **Step 7: Commit the UI change**

```bash
git add frontend/src/components/ComposerPlusMenu.tsx frontend/src/components/Composer.tsx frontend/src/components/ChatArea.css frontend/src/components/expertCreatorModel.ts frontend/src/components/expertCreatorModel.test.ts
git commit -m "feat: select multiple skills while creating experts"
```

### Task 3: Prompt protocol plumbing

**Files:**
- Modify: `frontend/src/store/useStore.ts`
- Create: `frontend/src/api/promptRequestModel.ts`
- Create: `frontend/src/api/promptRequestModel.test.ts`
- Modify: `frontend/src/api/client.ts`
- Modify: `src/electron/ipc-handlers.ts`
- Modify: `application.electron.ts`
- Modify: `src/agent/provider.ts`

- [ ] **Step 1: Add a failing request-mapping assertion**

Create a pure `mapPromptRequestToSessionContinue` mapper and test that this request:

```ts
{
  sessionId: "expert-1",
  text: "创建测试专家",
  selectedSkillNames: ["report-writer", "data-analysis"],
}
```

produces a `session.continue` payload containing the same ordered array.

- [ ] **Step 2: Verify RED**

Run:

```bash
node --import tsx --test frontend/src/api/promptRequestModel.test.ts
```

Expected: FAIL because the mapper module does not exist.

- [ ] **Step 3: Extend the frontend send contract**

Implement `mapPromptRequestToSessionContinue` with all fields currently mapped inline in `client.ts`, including `selectedSkillNames`. Use it from the `/api/prompt` IPC route. Add `selectedSkillNames?: string[]` to `sendMessage` options and include it in `/api/prompt`. In `Composer.handleSend`, pass the current expert conversation's selected names. Do not clear the selection after a successful turn; it describes the expert being built across the whole creation conversation.

- [ ] **Step 4: Forward through IPC and HTTP**

Add `selectedSkillNames: b?.selectedSkillNames` to the `/api/prompt` IPC map. Extend `session.continue` payload handling and the HTTP handler to preserve only arrays of strings; malformed values reach backend validation as an empty or rejected request according to the resolver contract.

- [ ] **Step 5: Extend Provider options**

Add:

```ts
selectedSkillNames?: string[];
```

to `PromptOptions` and forward the ordered array from `application.electron.ts`.

- [ ] **Step 6: Run mapping tests and both type-checks**

```bash
node --import tsx --test frontend/src/api/promptRequestModel.test.ts
npx tsc --project tsconfig.electron.json --noEmit
cd frontend && npx tsc --noEmit -p tsconfig.app.json
```

Expected: mapping tests pass and both compilers exit 0.

- [ ] **Step 7: Commit protocol plumbing**

```bash
git add frontend/src/store/useStore.ts frontend/src/api/promptRequestModel.ts frontend/src/api/promptRequestModel.test.ts frontend/src/api/client.ts src/electron/ipc-handlers.ts application.electron.ts src/agent/provider.ts
git commit -m "feat: forward selected expert skills"
```

### Task 4: Authoritative selected-skill resolver

**Files:**
- Create: `src/agent/expert_selected_skills.ts`
- Create: `src/agent/expert_selected_skills.test.ts`
- Modify: `src/agent/provider.ts`

- [ ] **Step 1: Write failing resolver tests**

Test these observable behaviors with temporary builtin/user roots:

```ts
test("resolves ordered enabled skills and emits bounded XML", async () => {});
test("rejects expert-manager, unknown, disabled and more than eight skills", async () => {});
test("rejects symlinks and a tree larger than 32 MiB or 2048 files", async () => {});
test("deduplicates case-insensitively and hashes the complete ordinary-file tree", async () => {});
```

Assert that the XML contains escaped canonical names, source, root and a lowercase 64-character SHA-256, but does not embed full skill bodies.

- [ ] **Step 2: Verify RED**

```bash
node --import tsx --test src/agent/expert_selected_skills.test.ts
```

Expected: FAIL because the resolver module does not exist.

- [ ] **Step 3: Implement safe resolution**

Export:

```ts
export const MAX_SELECTED_EXPERT_SKILLS = 8;
export const MAX_SELECTED_SKILL_FILES = 2048;
export const MAX_SELECTED_SKILL_BYTES = 32 * 1024 * 1024;

export async function resolveSelectedExpertSkills(
  names: readonly string[],
  dependencies?: ResolverDependencies,
): Promise<ResolvedExpertSkill[]>;

export function buildSelectedExpertSkillsAddon(
  skills: readonly ResolvedExpertSkill[],
): string;
```

Use `listSkills()` as the authoritative registry. Derive each root from `dirname(skill.path)`, inspect every entry with `lstat`, reject symbolic links and non-ordinary entries, sort relative POSIX paths before hashing, and hash path separators plus file bytes for deterministic revisions.

- [ ] **Step 4: Inject per-turn context only for expert creator**

In `executePrompt`, when `entry.category === "expert_creator"`, resolve `o.selectedSkillNames ?? []` and set:

```ts
entry.modeAddon = buildSelectedExpertSkillsAddon(resolvedSkills);
```

For other creator categories keep `modeAddon` empty. For ordinary conversations retain `MODE_PROMPTS[o.mode] + skillPromptAddon`. The existing `buildPrompt` callback will combine the selected-skills addon with the fixed `expertManagerAddon`.

- [ ] **Step 5: Run resolver and provider regressions**

```bash
node --import tsx --test src/agent/expert_selected_skills.test.ts src/agent/expert_manager_context.test.ts src/agent/provider_profile_reload.test.ts
npx tsc --project tsconfig.electron.json --noEmit
```

Expected: all tests pass and compiler exits 0.

- [ ] **Step 6: Commit backend resolution**

```bash
git add src/agent/expert_selected_skills.ts src/agent/expert_selected_skills.test.ts src/agent/provider.ts
git commit -m "feat: resolve selected skills for expert manager"
```

### Task 5: Reuse and strengthen the existing expert-manager lifecycle

**Files:**
- Modify: `resources/builtin-skills/expert-manager/SKILL.md`
- Modify: `resources/builtin-skills/expert-manager/scripts/validate_expert.py`
- Create: `resources/builtin-skills/expert-manager/scripts/test_validate_expert_skills.py`
- Modify generated builtin skill files.

- [ ] **Step 1: Write failing Python validation tests**

Build minimal temporary experts and assert:

```py
def test_accepts_two_declared_package_local_skills(self): ...
def test_rejects_duplicate_or_non_direct_skill_paths(self): ...
def test_rejects_symlink_anywhere_in_a_declared_skill(self): ...
def test_rejects_plugin_and_main_agent_skill_mismatch(self): ...
```

Use `plugin.json.skills = ["./skills/alpha", "./skills/beta"]` and main Agent frontmatter `skills: [alpha, beta]` for the valid fixture.

- [ ] **Step 2: Verify RED**

```bash
python resources/builtin-skills/expert-manager/scripts/test_validate_expert_skills.py
```

Expected: at least the traversal/symlink and manifest mismatch cases fail.

- [ ] **Step 3: Extend `validate_expert.py` without duplicating lifecycle operations**

Require every `plugin.json.skills` entry to match `./skills/<safe-kebab-name>`, reject duplicates case-insensitively, verify the resolved directory remains under `<expert>/skills`, walk with `lstat` and reject all symbolic links. Parse the main Agent's inline `skills: [...]` frontmatter and require its ordered canonical names to equal the plugin declaration basenames.

- [ ] **Step 4: Update the manager instructions**

Document the `<selected_expert_skills>` block and require the existing workflow to:

```text
init_expert.py
→ materialize each selected root into <expert>/skills/<name>
→ update plugin.json and main Agent frontmatter
→ validate_expert.py
→ register_expert.py --session-id
→ package_expert.py
```

Explicitly state that `expert-manager` itself is never materialized and that no alternate init/register/package implementation may be created.

- [ ] **Step 5: Verify Python tests GREEN**

```bash
python resources/builtin-skills/expert-manager/scripts/test_validate_expert_skills.py
python resources/builtin-skills/expert-manager/scripts/test_package_expert.py
python resources/builtin-skills/expert-manager/scripts/test_project_paths.py
```

Expected: all tests pass.

- [ ] **Step 6: Regenerate and verify the protected bundle**

```bash
npm run gen:builtin-skills
node --import tsx --test scripts/build-builtin-skills.test.ts
```

Expected: generated manifest/bundle contain the revised manager and new test; generator tests pass.

- [ ] **Step 7: Commit lifecycle validation**

```bash
git add resources/builtin-skills/expert-manager src/agent/builtin_skills/builtin-skills.manifest.generated.json src/agent/builtin_skills/builtin-skills.bundle.generated.ts
git commit -m "feat: validate multi-skill expert packages"
```

### Task 6: Documentation, browser acceptance and full verification

**Files:**
- Modify: `docs/18-专家系统架构设计.md`
- Modify: `docs/superpowers/specs/2026-08-11-expert-multi-skill-composition-design.md` only if implementation reveals a necessary correction.

- [ ] **Step 1: Update architecture documentation**

Record the final flow:

```text
Composer ordered selection
→ selectedSkillNames
→ authoritative resolver
→ <selected_expert_skills>
→ existing expert-manager scripts
→ package-local skills
```

State that `platformPaths.appDataDir` remains the only project configuration root.

- [ ] **Step 2: Run Playwright acceptance**

Mock two enabled skills and verify:

1. Create expert opens with fixed `expert-manager`.
2. “+” contains 技能 while 模式 remains unavailable.
3. Selecting two skills renders two pills.
4. Re-selecting does not duplicate.
5. Removing one changes the outgoing `selectedSkillNames` to the remaining name.
6. No unexpected page or console errors occur.

Run with the existing server helper:

```bash
python /Users/xiaozhongyuan/.agents/skills/webapp-testing/scripts/with_server.py --server "npm run dev -- --host 127.0.0.1" --port 5173 -- python /tmp/expert_multi_skill_smoke.py
```

Expected: `expert multi-skill UI smoke passed`.

- [ ] **Step 3: Run the complete focused Node suite**

```bash
node --import tsx --test scripts/build-builtin-skills.test.ts src/agent/experts/*.test.ts src/agent/expert_manager_context.test.ts src/agent/expert_selected_skills.test.ts src/agent/provider_profile_reload.test.ts src/domains/session/node/expert_binding_store.test.ts frontend/src/components/expertCreatorModel.test.ts frontend/src/components/expertSkillSelectionModel.test.ts frontend/src/utils/artifactPresentation.test.ts
```

Expected: zero failures.

- [ ] **Step 4: Run final static and build checks**

```bash
npx tsc --project tsconfig.electron.json --noEmit
npm run lint  # workdir: frontend
npm run build # workdir: frontend
git diff --check
```

Expected: compilers/build/diff check exit 0; lint has no new errors or warnings introduced by this feature.

- [ ] **Step 5: Audit forbidden configuration paths**

```bash
rg -n "process\\.env\\.WORKBUDDY_CONFIG_DIR|Path\\.home\\(\\).*\\.workbuddy" src frontend resources scripts
```

Expected: no runtime-code matches.

- [ ] **Step 6: Commit documentation if workspace policy permits**

```bash
git add docs/18-专家系统架构设计.md docs/superpowers/specs/2026-08-11-expert-multi-skill-composition-design.md docs/superpowers/plans/2026-08-11-expert-multi-skill-composition.md
git commit -m "docs: document expert multi-skill composition"
```
