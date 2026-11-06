# Slash Skill Menu Completeness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the ordinary `/` menu show every enabled skill alongside system commands, with deterministic deduplication and on-demand skill loading.

**Architecture:** Add a small generic command-merging helper to the existing composer menu model, preferring API-backed dynamic skills over same-name fixed shortcuts. Composer derives one complete command list from that helper and triggers the existing `loadSkills()` action whenever either slash menu opens with no cached skills.

**Tech Stack:** React 19, TypeScript, Zustand, Node.js test runner via `tsx`, Vite.

---

## File map

- `frontend/src/components/composerMenuModel.ts`: case-insensitive command deduplication helper.
- `frontend/src/components/composerMenuModel.test.ts`: merge ordering, dynamic precedence, and case-insensitive deduplication tests.
- `frontend/src/components/Composer.tsx`: on-demand loading and complete slash-command composition.
- `test/src/components/welcomeLayout.test.ts`: source-level regression proving both slash entry points trigger loading and the complete list is consumed.

### Task 1: Add deterministic command merging

**Files:**
- Modify: `frontend/src/components/composerMenuModel.test.ts`
- Modify: `frontend/src/components/composerMenuModel.ts`

- [ ] **Step 1: Write the failing merge test**

```ts
import {
  deleteSkillTagAtOffset,
  insertSkillAtCursor,
  mergeUniqueSlashCommands,
  tokenizeSkillCommands,
} from "./composerMenuModel.ts";

test("dynamic slash skills precede and replace duplicate fixed commands", () => {
  const dynamic = [
    { cmd: "/weekly-report", desc: "current registry description" },
    { cmd: "/custom-skill", desc: "custom" },
  ];
  const fixed = [
    { cmd: "/WEEKLY-REPORT", desc: "stale fixed description" },
    { cmd: "/plan", desc: "system mode" },
  ];

  assert.deepEqual(mergeUniqueSlashCommands(dynamic, fixed), [
    dynamic[0],
    dynamic[1],
    fixed[1],
  ]);
});
```

- [ ] **Step 2: Run the test and verify RED**

Run: `npx tsx --test frontend/src/components/composerMenuModel.test.ts`

Expected: FAIL because `mergeUniqueSlashCommands` is not exported.

- [ ] **Step 3: Implement the minimal generic helper**

```ts
export function mergeUniqueSlashCommands<T extends { cmd: string }>(
  preferred: readonly T[],
  fallback: readonly T[],
): T[] {
  const seen = new Set<string>();
  return [...preferred, ...fallback].filter((command) => {
    const key = command.cmd.trim().toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
```

- [ ] **Step 4: Run the model test and verify GREEN**

Run: `npx tsx --test frontend/src/components/composerMenuModel.test.ts`

Expected: all composer menu model tests pass.

### Task 2: Load and display the complete slash menu

**Files:**
- Modify: `frontend/src/components/Composer.tsx`
- Modify: `test/src/components/welcomeLayout.test.ts`

- [ ] **Step 1: Write the failing source regression**

```ts
test("slash menus load and merge all enabled skills", () => {
  assert.match(composerSource, /slashQuery !== null \|\| slashSkillQuery !== null/);
  assert.match(composerSource, /void loadSkills\(\)/);
  assert.match(
    composerSource,
    /mergeUniqueSlashCommands\(databaseSkillSlashCommands, SLASH_COMMANDS\)/,
  );
});
```

- [ ] **Step 2: Run the source regression and verify RED**

Run: `npx tsx --test test/src/components/welcomeLayout.test.ts`

Expected: FAIL because ordinary slash commands are not merged with dynamic skills.

- [ ] **Step 3: Load skills when either slash menu opens**

Add an effect after the existing expert-creator loading effect:

```ts
useEffect(() => {
  if (
    (slashQuery !== null || slashSkillQuery !== null) &&
    skills.length === 0
  ) {
    void loadSkills();
  }
}, [loadSkills, skills.length, slashQuery, slashSkillQuery]);
```

- [ ] **Step 4: Merge enabled skills into ordinary slash commands**

Import `mergeUniqueSlashCommands`, then derive:

```ts
const completeSlashCommands = useMemo(
  () => mergeUniqueSlashCommands(databaseSkillSlashCommands, SLASH_COMMANDS),
  [databaseSkillSlashCommands],
);
```

Use `completeSlashCommands` for ordinary conversations. For expert creation, keep the existing restrictions by merging dynamic skills with only fixed commands whose category is neither `skill` nor `mode`:

```ts
const slashCommandSource = isExpertCreator
  ? mergeUniqueSlashCommands(
    databaseSkillSlashCommands,
    SLASH_COMMANDS.filter((command) =>
      command.category !== "skill" && command.category !== "mode"
    ),
  )
  : completeSlashCommands;
```

Filter `slashCommandSource` by the existing command/name query. Leave `/skill` filtering unchanged.

- [ ] **Step 5: Run focused tests and TypeScript**

Run: `npx tsx --test frontend/src/components/composerMenuModel.test.ts test/src/components/welcomeLayout.test.ts && cd frontend && npx tsc -b --pretty false`

Expected: all focused tests pass and TypeScript reports no diagnostics.

### Task 3: Verify behavior and scope

**Files:**
- Verify only; no backend modifications.

- [ ] **Step 1: Run related regression tests**

Run: `npx tsx --test frontend/src/components/composerMenuModel.test.ts frontend/src/components/skillDraftModel.test.ts test/src/components/welcomeLayout.test.ts`

Expected: all slash menu, skill creator, and layout tests pass.

- [ ] **Step 2: Run the production build**

Run: `cd frontend && npm run build`

Expected: TypeScript and Vite build pass.

- [ ] **Step 3: Check diff scope**

Run: `git diff --check && git diff --name-only`

Expected: no whitespace errors; implementation changes are limited to the four frontend/test files in this plan, aside from unrelated pre-existing untracked files.

- [ ] **Step 4: Verify the running UI**

Open an ordinary conversation and type `/`. Confirm all enabled skills returned by `/api/skills` appear, duplicate fixed shortcuts appear once using current registry metadata, disabled skills remain hidden, system modes/actions remain available, search works, and `/skill` still searches dynamic skills only.
