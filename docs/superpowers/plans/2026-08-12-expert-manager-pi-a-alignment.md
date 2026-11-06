# Expert Manager Pi-a Alignment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove Team experts and WorkBuddy-only behavior, harden the Python expert lifecycle, and load packaged expert Skills as self-contained runtime instructions.

**Architecture:** Keep the Python scripts as the sole init/validate/register/package lifecycle, but make their accepted disk format identical to the TypeScript installed-expert scanner. Extend the internal expert manifest with validated package-local Skill bodies and inject them into the bounded expert runtime profile; keep public summaries free of prompt bodies and local paths.

**Tech Stack:** Python 3 standard library, TypeScript, Node test runner, React/Zustand, Electron IPC, generated builtin-skill bundle

---

## Working-tree constraints

The repository already contains user changes in the expert-manager flow. Preserve them and edit only the lines required by this plan. In particular, retain the current semantic decision in `src/agent/expert_manager_context.ts`: validation plus registration installs an expert; packaging only creates a sharing archive and does not roll back registration.

## File responsibility map

- `resources/builtin-skills/expert-manager/scripts/init_expert.py`: create one Agent package skeleton.
- `resources/builtin-skills/expert-manager/scripts/validate_expert.py`: authoritative on-disk package validation shared by register/package.
- `resources/builtin-skills/expert-manager/scripts/register_expert.py`: atomically publish a validated package into the fixed Pi-a marketplace.
- `resources/builtin-skills/expert-manager/scripts/package_expert.py`: atomically create a bounded sharing ZIP outside the expert tree.
- `src/agent/experts/installed_skill.ts`: safely read and hash declared package-local Skill trees.
- `src/agent/experts/installed_catalog.ts`: scan registered Agent packages and attach internal Skill snapshots.
- `src/agent/experts/types.ts`, `registry.ts`, `runtime_profile.ts`: model, clone, and inject package-local Skill instructions.
- `frontend/src/components/ExpertPanel.tsx`: single Agent installed-expert UI.
- `resources/builtin-skills/expert-manager/SKILL.md` and `references/`: Pi-a-only agent creation instructions.
- `src/agent/builtin_skills/*.generated.*`: generated immutable builtin bundle; never hand-edit.

### Task 1: Make the domain Agent-only

**Files:**
- Modify: `src/agent/experts/types.ts`
- Modify: `src/agent/experts/registry.ts`
- Modify: `src/agent/experts/registry.test.ts`
- Modify: `src/agent/experts/installed_catalog.test.ts`
- Modify: `src/agent/experts.ts`
- Modify mechanically: `src/agent/expert_center.json`
- Modify: `frontend/src/components/ExpertPanel.tsx`

- [ ] **Step 1: Write failing registry and catalog tests**

Change fixtures to use `expertType: "agent"` and add an explicit rejection test:

```ts
test("registry rejects non-agent expert manifests", () => {
  const team = manifest("legacy-team") as ExpertManifest;
  (team as { expertType: string }).expertType = "team";
  const registry = createExpertRegistry({ builtins: [], catalog: [], installed: [team] });
  assert.equal(registry.get("legacy-team"), undefined);
  assert.match(registry.diagnostics()[0]?.message ?? "", /agent/i);
});
```

Update `installed_catalog.test.ts` so a registered `expertType: "team"` produces `INVALID_PLUGIN` and no manifest.

- [ ] **Step 2: Run the focused tests and observe the intended failures**

Run:

```bash
node --import tsx --test src/agent/experts/registry.test.ts src/agent/experts/installed_catalog.test.ts
```

Expected: failure because the registry normalizes Team to Team and the installed scanner accepts Team.

- [ ] **Step 3: Restrict types and normalization**

Use a literal Agent type:

```ts
export type ExpertType = "agent";
```

In `normalizeManifest`, reject raw manifests whose `expertType !== "agent"` instead of silently coercing. Add an `INVALID_EXPERT_TYPE` registry diagnostic and skip invalid entries during rebuild. In `installed_catalog.ts`, require `plugin.expertType === "agent"` and always use badge `"我的专家"`.

- [ ] **Step 4: Remove Team catalog and UI paths**

Mechanically remove every `experts[]` entry whose `expertType` is `"team"` from `src/agent/expert_center.json`, preserving the other top-level fields and two-space JSON formatting. Remove `installedExpertType`, Team counts, type tabs, Team filtering, and Team-specific empty/create-card text from `ExpertPanel.tsx`.

Update legacy catalog mapping in `src/agent/experts.ts` to discard non-Agent input before normalization rather than reinterpret it as Agent.

- [ ] **Step 5: Verify Agent-only behavior**

Run:

```bash
node --import tsx --test src/agent/experts/registry.test.ts src/agent/experts/installed_catalog.test.ts
npx tsc --project tsconfig.electron.json --noEmit
cd frontend && npx tsc -b --pretty false
```

Expected: all commands exit 0 and `rg -n 'expertType.*team|专家团' src/agent frontend/src` reports no executable Team paths.

- [ ] **Step 6: Commit the Agent-only slice**

```bash
git add src/agent/experts/types.ts src/agent/experts/registry.ts src/agent/experts/registry.test.ts src/agent/experts/installed_catalog.ts src/agent/experts/installed_catalog.test.ts src/agent/experts.ts src/agent/expert_center.json frontend/src/components/ExpertPanel.tsx
git commit -m "refactor: make experts agent-only"
```

### Task 2: Simplify expert initialization and remove WorkBuddy resources

**Files:**
- Create: `resources/builtin-skills/expert-manager/scripts/test_init_expert.py`
- Modify: `resources/builtin-skills/expert-manager/scripts/init_expert.py`
- Modify: `resources/builtin-skills/expert-manager/SKILL.md`
- Modify: `resources/builtin-skills/expert-manager/references/plugin-json-spec.md`
- Modify: `resources/builtin-skills/expert-manager/references/agent-md-spec.md`
- Delete: `resources/builtin-skills/expert-manager/references/team-spec.md`
- Delete: `resources/builtin-skills/expert-manager/references/avatar-spec.md`
- Delete: `resources/builtin-skills/expert-manager/scripts/batch_create.py`
- Modify: `resources/builtin-skills/expert-manager/.picoddy-plugin/plugin.json`

- [ ] **Step 1: Add failing initializer tests**

Test the public `main` behavior through subprocesses with an injected project home:

```python
def test_initializes_only_agent_package(self):
    result = self.run_init('growth-expert', '--path', str(self.plugins_dir))
    self.assertEqual(result.returncode, 0, result.stderr + result.stdout)
    plugin = json.loads((self.plugins_dir / 'growth-expert' / '.picoddy-plugin' / 'plugin.json').read_text())
    self.assertEqual(plugin['expertType'], 'agent')
    self.assertNotIn('members', plugin)
    self.assertNotIn('teamInfo', plugin)
    self.assertNotIn('avatar', plugin)

def test_rejects_removed_team_flag(self):
    result = self.run_init('growth-team', '--type', 'team', '--path', str(self.plugins_dir))
    self.assertNotEqual(result.returncode, 0)
```

Expose a small `PI_A_CONFIG_DIR` test-only argument to `get_project_config_dir(environment=...)` rather than adding a production environment override. Tests should import and call `init_expert.main(args, expected_plugins_dir=...)` directly so production directory behavior remains fixed.

- [ ] **Step 2: Run tests and observe failure**

```bash
python3 resources/builtin-skills/expert-manager/scripts/test_init_expert.py
```

Expected: failure because `--type` is required and Team templates still exist.

- [ ] **Step 3: Implement the Agent-only initializer**

Refactor to:

```python
def main(argv=None, expected_plugins_dir=None):
    args = list(sys.argv[1:] if argv is None else argv)
    # accepted form: <name> --path <plugins-dir>
```

Remove `TEAM_PLUGIN_JSON`, `TEAM_LEAD_MD_TEMPLATE`, `TEAM_MEMBER_MD_TEMPLATE`, `SETTINGS_JSON`, `init_team`, `--type`, avatar placeholders, and WorkBuddy success text. Keep name/path hard checks and return an exit code usable from tests.

- [ ] **Step 4: Replace skill documentation with Pi-a Agent instructions**

Make the lifecycle:

```text
collect and confirm Agent definition
-> init_expert.py
-> write Agent/plugin content
-> materialize selected Skills
-> validate_expert.py
-> register_expert.py
-> optional package_expert.py
```

Delete Team, `TeamCreate`, `Agent`, `SendMessage`, `ImageGen`, `CODEBUDDY_SESSION_ID`, `.workbuddy-plugin`, batch creation, and automatic-avatar claims. Keep avatar format constraints as an optional paragraph in `plugin-json-spec.md`. Change the builtin plugin metadata description/author/keywords to Pi-a and remove its `workbuddy` extension object. Preserve `LICENSE.txt` unchanged.

- [ ] **Step 5: Verify the resource slice**

```bash
python3 resources/builtin-skills/expert-manager/scripts/test_init_expert.py
rg -n -i 'WorkBuddy|TeamCreate|SendMessage|subagent_type|ImageGen|CODEBUDDY_SESSION_ID|\.workbuddy-plugin' resources/builtin-skills/expert-manager --glob '!LICENSE.txt'
```

Expected: initializer tests pass and the search returns no matches.

- [ ] **Step 6: Commit the resource slice**

```bash
git add resources/builtin-skills/expert-manager
git commit -m "refactor: make expert manager Pi-a agent-only"
```

### Task 3: Make Python validation match the installed scanner

**Files:**
- Modify: `resources/builtin-skills/expert-manager/scripts/test_validate_expert_skills.py`
- Create: `resources/builtin-skills/expert-manager/scripts/test_validate_expert_package.py`
- Modify: `resources/builtin-skills/expert-manager/scripts/validate_expert.py`

- [ ] **Step 1: Add failing package validation tests**

Use a valid Agent fixture, then cover one failure per test:

```python
def test_rejects_team(self):
    self.plugin['expertType'] = 'team'
    self.assert_error('expertType must be agent')

def test_default_prompt_mismatch_is_error(self):
    self.plugin['defaultInitPrompt']['zh'] = 'different'
    self.assert_error('must match the first quickPrompt')

def test_rejects_todo_in_primary_agent(self):
    self.agent_path.write_text('---\nname: valid-expert\ndescription: ok\n---\n[TODO]')
    self.assert_error('contains [TODO]')

def test_avatar_is_optional(self):
    self.plugin.pop('avatar', None)
    self.assertTrue(validate_expert(self.expert_dir).is_valid)
```

Add name consistency tests for directory/name/plugin/agentName, direct-child path enforcement, i18n fields, category, three tags, three prompts, and declared Agent path.

- [ ] **Step 2: Run tests and observe the precise failures**

```bash
python3 resources/builtin-skills/expert-manager/scripts/test_validate_expert_package.py
python3 resources/builtin-skills/expert-manager/scripts/test_validate_expert_skills.py
```

Expected: new tests fail because Team is accepted, prompt mismatch is a warning, and package consistency is incomplete.

- [ ] **Step 3: Implement strict Agent validation**

Refactor `validate_expert(expert_path, expected_plugins_dir=None)` so tests can supply an isolated root while production defaults to `get_expert_plugins_dir()`. Require the expert directory to be a direct child, not merely a descendant. Convert prompt mismatch to `result.error`, reject all Team fields, require exact names and declared primary Agent, and scan the entire primary Agent text for `[TODO]`.

Use the same constants for Python Skill validation:

```python
MAX_SKILL_FILES = 2048
MAX_SKILL_TREE_BYTES = 32 * 1024 * 1024
MAX_SKILL_MD_BYTES = 128 * 1024
MAX_SKILL_BODIES_BYTES = 128 * 1024
```

Parse the root `SKILL.md` frontmatter name, require equality with the directory, reject `disabled: true`, reject `expert-manager`, and enforce cumulative limits.

- [ ] **Step 4: Run Python validator regression tests**

```bash
python3 resources/builtin-skills/expert-manager/scripts/test_validate_expert_package.py
python3 resources/builtin-skills/expert-manager/scripts/test_validate_expert_skills.py
```

Expected: all tests pass.

- [ ] **Step 5: Commit validator changes**

```bash
git add resources/builtin-skills/expert-manager/scripts/validate_expert.py resources/builtin-skills/expert-manager/scripts/test_validate_expert_package.py resources/builtin-skills/expert-manager/scripts/test_validate_expert_skills.py
git commit -m "fix: align expert package validation"
```

### Task 4: Harden fixed-path registration

**Files:**
- Create: `resources/builtin-skills/expert-manager/scripts/test_register_expert.py`
- Modify: `resources/builtin-skills/expert-manager/scripts/register_expert.py`

- [ ] **Step 1: Add failing registration tests**

Cover fixed roots, full validation, removal of legacy flags, and atomic replacement:

```python
def test_rejects_expert_outside_fixed_plugins_dir(self):
    ok = register_main([str(self.outside_expert)], expected_plugins_dir=self.plugins_dir)
    self.assertEqual(ok, 1)

def test_rejects_workbuddy_manifest(self):
    self.codebuddy_plugin.rename(self.expert_dir / '.workbuddy-plugin')
    self.assertEqual(register_main([str(self.expert_dir)], expected_plugins_dir=self.plugins_dir), 1)

def test_validation_failure_keeps_marketplace_unchanged(self):
    before = self.marketplace_path.read_bytes()
    self.break_primary_agent()
    self.assertEqual(register_main([str(self.expert_dir)], expected_plugins_dir=self.plugins_dir), 1)
    self.assertEqual(self.marketplace_path.read_bytes(), before)
```

Also assert `--marketplace-dir` is rejected and `.created-by-session` is never written.

- [ ] **Step 2: Run tests and observe failure**

```bash
python3 resources/builtin-skills/expert-manager/scripts/test_register_expert.py
```

Expected: failure because legacy manifest/marketplace options and the weaker validator remain.

- [ ] **Step 3: Implement one fixed Pi-a registration path**

Import `validate_expert` from the sibling module, remove `find_plugin_json` fallback and `validate_expert_completeness`, accept only `<expert-dir>`, and derive marketplace from `expected_plugins_dir.parent`. Write JSON using a unique sibling temporary file:

```python
with open(temp_path, 'x', encoding='utf-8') as handle:
    json.dump(manifest, handle, indent=2, ensure_ascii=False)
    handle.flush()
    os.fsync(handle.fileno())
os.replace(temp_path, manifest_path)
```

Clean the temporary file in `finally`. Do not write session marker files.

- [ ] **Step 4: Verify registration tests**

```bash
python3 resources/builtin-skills/expert-manager/scripts/test_register_expert.py
```

Expected: all tests pass.

- [ ] **Step 5: Commit registration changes**

```bash
git add resources/builtin-skills/expert-manager/scripts/register_expert.py resources/builtin-skills/expert-manager/scripts/test_register_expert.py
git commit -m "fix: harden expert registration"
```

### Task 5: Repair bounded atomic packaging

**Files:**
- Modify: `resources/builtin-skills/expert-manager/scripts/test_package_expert.py`
- Modify: `resources/builtin-skills/expert-manager/scripts/package_expert.py`

- [ ] **Step 1: Extend the already-failing packager tests**

Keep the four existing tests and add:

```python
def test_failure_keeps_existing_archive_and_removes_temp_file(self):
    final_zip = self.output_dir / 'safe-packager.zip'
    final_zip.write_bytes(b'previous')
    packager.MAX_PACKAGE_BYTES = 2
    self.assertIsNone(packager.package_expert(self.expert_dir, self.output_dir))
    self.assertEqual(final_zip.read_bytes(), b'previous')
    self.assertEqual(list(self.output_dir.glob('.safe-packager.zip.tmp-*')), [])
```

Assert ZIP names use `safe-packager/content.txt` with `/` separators and exclude `.created-by-session`, root `dist/`, caches, the output directory, and temporary archives.

- [ ] **Step 2: Run the test and confirm current failure**

```bash
python3 resources/builtin-skills/expert-manager/scripts/test_package_expert.py
```

Expected: four existing errors mention missing `MAX_PACKAGE_BYTES`; new atomic tests also fail.

- [ ] **Step 3: Implement atomic packaging**

Define:

```python
MAX_PACKAGE_BYTES = 64 * 1024 * 1024
```

Reject output directories equal to or inside the expert root. Build the complete inclusion list before opening the archive, excluding root `dist` and output/temp paths. Write a unique sibling temporary ZIP, check `temp_path.stat().st_size`, then `os.replace` it onto the final path. Always remove the temp path on failure.

- [ ] **Step 4: Run packager and validator tests**

```bash
python3 resources/builtin-skills/expert-manager/scripts/test_package_expert.py
python3 resources/builtin-skills/expert-manager/scripts/test_validate_expert_package.py
```

Expected: all tests pass.

- [ ] **Step 5: Commit packaging changes**

```bash
git add resources/builtin-skills/expert-manager/scripts/package_expert.py resources/builtin-skills/expert-manager/scripts/test_package_expert.py
git commit -m "fix: package experts atomically"
```

### Task 6: Load package-local Skills into installed manifests

**Files:**
- Create: `src/agent/experts/installed_skill.ts`
- Create: `src/agent/experts/installed_skill.test.ts`
- Modify: `src/agent/experts/types.ts`
- Modify: `src/agent/experts/installed_catalog.ts`
- Modify: `src/agent/experts/installed_catalog.test.ts`
- Modify: `src/agent/experts/registry.ts`
- Modify: `src/agent/experts/registry.test.ts`

- [ ] **Step 1: Write failing installed-Skill tests**

Define the intended API through tests:

```ts
const skills = await loadInstalledExpertSkills(expertDir, ["./skills/data-analysis"]);
assert.equal(skills[0]?.name, "data-analysis");
assert.match(skills[0]?.body ?? "", /Analyze data carefully/);
assert.match(skills[0]?.revision ?? "", /^[a-f0-9]{64}$/);
```

Add separate tests for path escape, duplicate names, `expert-manager`, directory/file symlinks, missing root `SKILL.md`, mismatched frontmatter name, disabled Skill, non-ordinary entry, file-count limit, tree-byte limit, body-byte limit, and deterministic sorted hashing.

- [ ] **Step 2: Run tests and observe missing-module failure**

```bash
node --import tsx --test src/agent/experts/installed_skill.test.ts
```

Expected: failure because `installed_skill.ts` does not exist.

- [ ] **Step 3: Implement the bounded loader**

Export:

```ts
export interface InstalledExpertSkill {
  name: string;
  root: string;
  body: string;
  revision: string;
}

export async function loadInstalledExpertSkills(
  expertDir: string,
  declarations: readonly unknown[],
): Promise<InstalledExpertSkill[]>;
```

Use `lstat`, `readdir`, `readFile`, `relative`, and `realpath`; do not follow links. Parse frontmatter with the repository `yaml` dependency. Apply the same numeric limits as Python and hash sorted POSIX relative paths plus NUL separators.

- [ ] **Step 4: Attach Skills without exposing them publicly**

Add optional `installedSkills?: InstalledExpertSkill[]` to `ExpertManifest`; installed packages populate it, while existing builtin/catalog fixtures may omit it. In `readManifest`, load `plugin.skills` and include their revisions in the expert revision hash. In `summaryOf`/`toSummary`, omit `installedSkills`. In `registry.ts`, deep-clone every Skill object and include them in stable revision material.

- [ ] **Step 5: Verify loader, scanner, and registry**

```bash
node --import tsx --test src/agent/experts/installed_skill.test.ts src/agent/experts/installed_catalog.test.ts src/agent/experts/registry.test.ts
```

Expected: all tests pass; summaries contain neither `body`, `root`, nor `installedSkills`.

- [ ] **Step 6: Commit installed-Skill loading**

```bash
git add src/agent/experts/installed_skill.ts src/agent/experts/installed_skill.test.ts src/agent/experts/types.ts src/agent/experts/installed_catalog.ts src/agent/experts/installed_catalog.test.ts src/agent/experts/registry.ts src/agent/experts/registry.test.ts
git commit -m "feat: load skills from installed experts"
```

### Task 7: Inject self-contained Skill bodies into the expert runtime

**Files:**
- Modify: `src/agent/experts/runtime_profile.ts`
- Modify: `src/agent/experts/runtime_profile.test.ts`
- Modify: `src/agent/provider.ts`

- [ ] **Step 1: Add failing runtime profile tests**

Use a manifest with an installed Skill and no global Skill:

```ts
test("injects packaged skills without a global skill dependency", () => {
  const profile = buildExpertRuntimeProfile({
    manifest: manifest({
      installedSkills: [{
        name: "local-analysis",
        root: "/experts/analyst/skills/local-analysis",
        body: "Use the packaged workflow.",
        revision: "a".repeat(64),
      }],
    }),
    resolvedPrompt: resolvedPrompt(),
    availableTools: new Set(),
    availableSkills: new Set(),
  });
  assert.match(profile.addon, /<active_expert_skill name="local-analysis"/);
  assert.match(profile.addon, /Use the packaged workflow/);
  assert.deepEqual(profile.bundledSkills, ["local-analysis"]);
});
```

Add XML/control-character escaping and a test asserting oversized installed Skill bodies throw a bounded initialization error instead of truncating or dropping a Skill.

- [ ] **Step 2: Run tests and observe missing injection**

```bash
node --import tsx --test src/agent/experts/runtime_profile.test.ts
```

Expected: packaged Skill tags are absent and `bundledSkills` is empty without a global match.

- [ ] **Step 3: Implement complete Skill injection**

Build one escaped block per installed Skill:

```xml
<active_expert_skill name="..." root="..." revision="...">
...
</active_expert_skill>
```

Treat `installedSkills.map(skill => skill.name)` as the runtime bundled Skill list without filtering against global skills. Keep legacy global capability hints only for builtin/catalog experts that have no installed package Skills. Reserve boundaries and closing XML in the byte budget; throw if complete role plus installed Skill bodies exceeds `MAX_EXPERT_ADDON_BYTES`.

- [ ] **Step 4: Update provider initialization expectations**

Keep `availableSkills` for builtin/catalog hints, but ensure installed expert creation does not fail merely because a package-local name is absent from `loadSkillsPrompt()`. Convert bounded runtime-profile failures to `ExpertInitializationError` through the existing provider path.

- [ ] **Step 5: Verify runtime behavior**

```bash
node --import tsx --test src/agent/experts/runtime_profile.test.ts src/agent/provider_profile_reload.test.ts
```

Expected: all tests pass.

- [ ] **Step 6: Commit runtime injection**

```bash
git add src/agent/experts/runtime_profile.ts src/agent/experts/runtime_profile.test.ts src/agent/provider.ts
git commit -m "feat: activate packaged expert skills"
```

### Task 8: Align context, docs, bundle, and end-to-end regression

**Files:**
- Modify: `src/agent/expert_manager_context.ts`
- Modify: `src/agent/expert_manager_context.test.ts`
- Modify: `docs/18-专家系统架构设计.md`
- Modify generated: `src/agent/builtin_skills/builtin-skills.manifest.generated.json`
- Modify generated: `src/agent/builtin_skills/builtin-skills.bundle.generated.ts`
- Verify: `scripts/build-builtin-skills.test.ts`

- [ ] **Step 1: Update failing context expectations first**

Assert the context says Agent-only, optional avatar, fixed scripts, registration-is-installation, and optional sharing package. Assert it contains no Team, ImageGen, WorkBuddy, `--session-id`, or session marker instructions.

- [ ] **Step 2: Run context tests and observe failure**

```bash
node --import tsx --test src/agent/expert_manager_context.test.ts
```

Expected: failure because current context still says `--session-id` and avatar generation.

- [ ] **Step 3: Align runtime context and architecture documentation**

Update the lifecycle text to use the new initializer signature and register command. Preserve exact `expert_plugins_dir` and `packages_dir`. Document Agent-only behavior, package-local Skill body loading, optional avatar fallback, atomic register/package behavior, and rejected legacy Team packages.

- [ ] **Step 4: Regenerate the protected builtin bundle**

```bash
npm run gen:builtin-skills
```

Expected: generated manifest and bundle remove deleted Team/avatar/batch resources and contain the updated file digests.

- [ ] **Step 5: Run complete focused regression**

```bash
python3 resources/builtin-skills/expert-manager/scripts/test_project_paths.py
python3 resources/builtin-skills/expert-manager/scripts/test_init_expert.py
python3 resources/builtin-skills/expert-manager/scripts/test_validate_expert_package.py
python3 resources/builtin-skills/expert-manager/scripts/test_validate_expert_skills.py
python3 resources/builtin-skills/expert-manager/scripts/test_register_expert.py
python3 resources/builtin-skills/expert-manager/scripts/test_package_expert.py
node --import tsx --test scripts/build-builtin-skills.test.ts src/agent/experts/*.test.ts src/agent/expert_manager_context.test.ts src/agent/expert_selected_skills.test.ts src/agent/provider_profile_reload.test.ts frontend/src/components/expertCreatorModel.test.ts frontend/src/components/expertSkillSelectionModel.test.ts
npx tsc --project tsconfig.electron.json --noEmit
cd frontend && npm run build
```

Expected: every command exits 0 with zero failed tests and zero type errors.

- [ ] **Step 6: Run final repository checks**

```bash
rg -n -i 'WorkBuddy|TeamCreate|SendMessage|subagent_type|ImageGen|CODEBUDDY_SESSION_ID|\.workbuddy-plugin' resources/builtin-skills/expert-manager --glob '!LICENSE.txt'
rg -n 'expertType.*team|专家团' src/agent frontend/src resources/builtin-skills/expert-manager --glob '!*.test.ts' --glob '!test_*.py'
git diff --check
git status --short
```

Expected: both searches return no executable/product matches, `git diff --check` exits 0, and status contains only the intended implementation files plus pre-existing unrelated user changes.

- [ ] **Step 7: Commit the integration slice**

```bash
git add src/agent/expert_manager_context.ts src/agent/expert_manager_context.test.ts docs/18-专家系统架构设计.md src/agent/builtin_skills/builtin-skills.manifest.generated.json src/agent/builtin_skills/builtin-skills.bundle.generated.ts
git commit -m "docs: align expert creation lifecycle"
```

## Plan self-review

- Every approved design requirement maps to a task above.
- Agent-only removal covers disk data, types, registry, scanner, frontend, templates, and runtime.
- Self-contained Skill loading covers validation, safe reading, internal model cloning, prompt injection, bounds, and summary secrecy.
- Python lifecycle changes have independent red/green tests before production edits.
- Installation and packaging semantics preserve the user's current `expert_manager_context.ts` decision.
- Generated builtin files are updated only by the repository generator.
- No user-owned installed Team directories are deleted.
