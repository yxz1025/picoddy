# UI And Website Skill Selection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Import the official `frontend-design` skill from `@sentiolabs/pi-frontend-design@0.1.1` as a protected builtin and make the welcome-page UI-design and website-development entries render the correct mutually exclusive skill tag in the composer.

**Architecture:** Keep skill selection on the existing `composer:skill-selected` event path, but centralize welcome-page category mappings and fixed composer metadata in a small pure model. Publish the official package's `frontend-design` skill through the existing deterministic builtin-skill source and generated bundle; do not add a plugin runtime or backend registration path.

**Tech Stack:** React 19, TypeScript, Node.js test runner via `tsx --test`, Pi builtin `SKILL.md`, deterministic builtin bundle generator, Vite, Playwright visual interaction check.

---

### Task 1: Define the welcome-page skill mapping

**Files:**
- Create: `frontend/src/components/welcomeSkillSelectionModel.test.ts`
- Create: `frontend/src/components/welcomeSkillSelectionModel.ts`
- Modify: `frontend/src/components/ChatArea.tsx:30,1245-1258`
- Modify: `frontend/src/components/Composer.tsx:49-53,550-580`

- [ ] **Step 1: Write the failing mapping tests**

Create `frontend/src/components/welcomeSkillSelectionModel.test.ts`:

```ts
import assert from "node:assert/strict";
import test from "node:test";

import {
  getWelcomeSkillSelection,
  WELCOME_FIXED_SKILLS,
} from "./welcomeSkillSelectionModel";

test("maps welcome design and website entries to distinct frontend skills", () => {
  assert.deepEqual(getWelcomeSkillSelection("设计创意", "UI 设计"), {
    command: "/frontend-design",
    label: "UI 设计",
  });
  assert.deepEqual(getWelcomeSkillSelection("代码开发", "网站开发"), {
    command: "/frontend-create",
    label: "网站开发",
  });
});

test("preserves document and data skill mappings", () => {
  assert.deepEqual(getWelcomeSkillSelection("日常办公", "文档处理"), {
    command: "/document-processing",
    label: "文档处理",
  });
  assert.deepEqual(getWelcomeSkillSelection("日常办公", "数据分析"), {
    command: "/data-analysis",
    label: "数据分析",
  });
  assert.equal(getWelcomeSkillSelection("设计创意", "图片编辑"), undefined);
});

test("exposes every fixed welcome skill for composer token rendering", () => {
  assert.deepEqual(WELCOME_FIXED_SKILLS, [
    { command: "/document-processing", label: "文档处理" },
    { command: "/data-analysis", label: "数据分析" },
    { command: "/frontend-create", label: "网站开发" },
    { command: "/frontend-design", label: "UI 设计" },
  ]);
});
```

- [ ] **Step 2: Run the mapping test and verify RED**

Run: `npx tsx --test frontend/src/components/welcomeSkillSelectionModel.test.ts`

Expected: FAIL because `welcomeSkillSelectionModel.ts` does not exist.

- [ ] **Step 3: Implement the pure mapping model**

Create `frontend/src/components/welcomeSkillSelectionModel.ts`:

```ts
export interface WelcomeSkillSelection {
  command: string;
  label: string;
}

export const WELCOME_FIXED_SKILLS: readonly WelcomeSkillSelection[] = [
  { command: "/document-processing", label: "文档处理" },
  { command: "/data-analysis", label: "数据分析" },
  { command: "/frontend-create", label: "网站开发" },
  { command: "/frontend-design", label: "UI 设计" },
];

const WELCOME_SKILLS_BY_ENTRY = new Map<string, WelcomeSkillSelection>([
  ["日常办公\u0000文档处理", WELCOME_FIXED_SKILLS[0]],
  ["日常办公\u0000数据分析", WELCOME_FIXED_SKILLS[1]],
  ["代码开发\u0000网站开发", WELCOME_FIXED_SKILLS[2]],
  ["设计创意\u0000UI 设计", WELCOME_FIXED_SKILLS[3]],
]);

export function getWelcomeSkillSelection(
  mainTab: string,
  subTab: string,
): WelcomeSkillSelection | undefined {
  return WELCOME_SKILLS_BY_ENTRY.get(`${mainTab}\u0000${subTab}`);
}
```

- [ ] **Step 4: Route welcome clicks through the model**

Import `getWelcomeSkillSelection` in `ChatArea.tsx`. Replace the conditional mapping inside `handleSubTabSelected` with:

```ts
const skill = getWelcomeSkillSelection(activeTab, subTab);
if (skill) {
  window.dispatchEvent(new CustomEvent(COMPOSER_SKILL_EVENT, {
    detail: skill,
  }));
}
```

- [ ] **Step 5: Make all welcome skills fixed composer commands**

Import `WELCOME_FIXED_SKILLS` in `Composer.tsx`. In `knownSkillCommands`, add:

```ts
for (const skill of WELCOME_FIXED_SKILLS) {
  commands.add(skill.command.toLowerCase());
}
```

In `skillDisplayLabels`, add:

```ts
for (const skill of WELCOME_FIXED_SKILLS) {
  labels.set(skill.command.toLowerCase(), skill.label);
}
```

Keep the existing document-processing plugin activation handler unchanged.

- [ ] **Step 6: Run the focused frontend tests and verify GREEN**

Run: `npx tsx --test frontend/src/components/welcomeSkillSelectionModel.test.ts frontend/src/components/documentProcessingModel.test.ts frontend/src/components/composerMenuModel.test.ts`

Expected: all tests pass.

### Task 2: Publish the official `frontend-design` as a protected builtin skill

**Files:**
- Modify: `test/scripts/build-builtin-skills.test.ts`
- Create: `resources/builtin-skills/frontend-design/SKILL.md`
- Create: `resources/builtin-skills/frontend-design/LICENSE.txt`
- Regenerate: `src/agent/builtin_skills/builtin-skills.manifest.generated.json`
- Regenerate: `src/agent/builtin_skills/builtin-skills.bundle.generated.ts`

- [ ] **Step 1: Write the failing source-publication test**

Append to `test/scripts/build-builtin-skills.test.ts`:

```ts
test("project builtin source publishes the official frontend-design skill", async () => {
  const result = await buildBuiltinSkills({
    sourceDir: resolve("resources/builtin-skills"),
  });

  assert.ok(result.manifest.skills.some((skill) =>
    skill.name === "frontend-design" &&
    skill.skillFile === "frontend-design/SKILL.md"
  ));
  assert.ok(result.manifest.files.some((file) =>
    file.path === "frontend-design/SKILL.md"
  ));
});
```

Add `resolve` to the existing `node:path` import.

- [ ] **Step 2: Run the build test and verify RED**

Run: `npx tsx --test test/scripts/build-builtin-skills.test.ts`

Expected: the new test FAILS because the project source does not yet contain `frontend-design`.

- [ ] **Step 3: Import the official builtin skill source**

Resolve and inspect `@sentiolabs/pi-frontend-design@0.1.1`, then copy its
`skills/frontend-design/SKILL.md` byte-for-byte to
`resources/builtin-skills/frontend-design/SKILL.md`. Copy the package's
Apache-2.0 `LICENSE` to `resources/builtin-skills/frontend-design/LICENSE.txt`.
Pin the official SKILL SHA-256
`46ebac01e569a8f843ca099d463445fc933325bbff564588720e60f9134026e8`
in the source-publication test so a locally rewritten substitute cannot pass.

- [ ] **Step 4: Validate the skill source**

Run: `python resources/builtin-skills/skill-creator/scripts/quick_validate.py resources/builtin-skills/frontend-design`

Expected: validation succeeds with exit code 0.

- [ ] **Step 5: Run the build test and verify GREEN**

Run: `npx tsx --test test/scripts/build-builtin-skills.test.ts`

Expected: all builtin source builder tests pass.

- [ ] **Step 6: Regenerate the protected builtin bundle**

Run: `npm run gen:builtin-skills`

Expected: generated manifest and bundle contain `frontend-design/SKILL.md`, its license, and a new bundle digest.

- [ ] **Step 7: Verify generated bundle determinism and installer compatibility**

Run: `npx tsx --test test/scripts/build-builtin-skills.test.ts test/src/agent/builtin_skills_installer.test.ts`

Expected: all tests pass.

### Task 3: Verify interaction and preserve unrelated behavior

**Files:**
- Verify: `frontend/src/components/ChatArea.tsx`
- Verify: `frontend/src/components/Composer.tsx`
- Verify: `resources/builtin-skills/frontend-design/SKILL.md`
- Verify: `resources/builtin-skills/frontend-design/LICENSE.txt`

- [ ] **Step 1: Run frontend static verification**

Run: `npx tsc --project frontend/tsconfig.json --noEmit`

Expected: exit code 0.

Run: `npm run build --prefix frontend`

Expected: Vite build exits 0; the existing chunk-size advisory may remain.

- [ ] **Step 2: Run the focused regression set**

Run: `npx tsx --test frontend/src/components/welcomeSkillSelectionModel.test.ts frontend/src/components/documentProcessingModel.test.ts frontend/src/components/composerMenuModel.test.ts test/scripts/build-builtin-skills.test.ts test/src/agent/builtin_skills_installer.test.ts`

Expected: all focused tests pass.

- [ ] **Step 3: Verify the rendered selection flow**

Start Vite and use a Playwright browser with empty mocked skill data. Check this exact sequence:

```text
click 设计创意
click UI 设计
composer token label == UI 设计
composer token data-cmd == /frontend-design
click 代码开发
click 网站开发
composer has exactly one skill token
composer token label == 网站开发
composer token data-cmd == /frontend-create
```

Also type ordinary text after the first token and confirm the `.composer-token__text`
content remains after switching skills.

- [ ] **Step 4: Run final diff verification**

Run: `git diff --check`

Expected: exit code 0.

- [ ] **Step 5: Commit the implementation**

```bash
git add frontend/src/components/ChatArea.tsx frontend/src/components/Composer.tsx frontend/src/components/welcomeSkillSelectionModel.ts frontend/src/components/welcomeSkillSelectionModel.test.ts resources/builtin-skills/frontend-design test/scripts/build-builtin-skills.test.ts src/agent/builtin_skills/builtin-skills.manifest.generated.json src/agent/builtin_skills/builtin-skills.bundle.generated.ts docs/superpowers/plans/2026-08-24-ui-and-website-skill-selection.md
git commit -m "feat: add ui design builtin skill selection"
```
