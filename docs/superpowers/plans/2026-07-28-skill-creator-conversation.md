# Conversation Skill Creator Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the “添加技能” modal entry with a WorkBuddy-style conversation that activates the bundled `skill-creator`, builds a validated full-package draft, previews it, and installs it only after explicit confirmation.

**Architecture:** Bundle an application-adapted copy of the Codex `skill-creator` package as TypeScript-embedded resources, seed it into `~/.pi-a/skills`, and give `skill_creator` conversations a restricted draft toolset. Store drafts outside the installed skill tree, expose read/validate/install APIs, and render a draft inspector beside the existing chat stream.

**Tech Stack:** Deno 2, TypeScript, `@earendil-works/pi-agent-core`, TypeBox, React 19, Zustand, Vite, CSS, Deno tests.

---

## File map

### Backend

- Create `scripts/embed-skill-creator.ts`: reproducibly convert the installed Codex package into a TypeScript file map.
- Create `src/agent/builtin_skills/skill_creator.generated.ts`: exact embedded contents of the Codex `skill-creator` package.
- Create `src/agent/builtin_skills/skill_creator.ts`: package exports and dedicated Pi-a runtime context.
- Modify `src/agent/skills.ts`: seed the bundled package and export a reliable loader.
- Modify `src/domains/skill/node/store.ts`: mark `skill-creator` as built-in.
- Create `src/domains/skill-draft/node/store.ts`: draft persistence, safe file access, validation, attachment import, and atomic installation.
- Create `src/domains/skill-draft/node/store_test.ts`: domain and security tests.
- Modify `src/domains/attachment/node/store.ts`: resolve an attachment only when it belongs to the current conversation.
- Create `src/agent/tools/skill_draft.ts`: Agent tools bound to the current conversation’s draft.
- Create `src/agent/tools/skill_draft_test.ts`: schema/tool-binding tests.
- Modify `src/agent/tools/index.ts`: export the restricted creator toolset.
- Create `src/agent/skill_creator_context.ts`: pure category-to-system-context decision.
- Create `src/agent/skill_creator_context_test.ts`: activation regression tests.
- Modify `src/agent/provider.ts`: query category, inject `skill-creator`, and select creator tools.
- Modify `main.ts`: draft query, validation, file preview, and install endpoints.

### Frontend

- Create `frontend/src/api/skillDrafts.ts`: typed draft API client.
- Create `frontend/src/components/skillDraftModel.ts`: pure presentation helpers.
- Create `frontend/src/components/skillDraftModel_test.ts`: presentation-state tests.
- Create `frontend/src/components/SkillDraftPanel.tsx`: file tree, preview, validation, and install UI.
- Create `frontend/src/components/SkillDraftPanel.css`: panel styling.
- Modify `frontend/src/store/useSkillStore.ts`: create and enter a `skill_creator` conversation.
- Modify `frontend/src/components/ExpertPanel.tsx`: route “添加技能” to the creator conversation.
- Modify `frontend/src/components/Composer.tsx`: fixed creator tag and placeholder.
- Modify `frontend/src/components/ChatArea.tsx`: mount the draft panel for creator conversations.
- Modify `frontend/src/components/ChatArea.css`: creator layout integration.

## Task 1: Bundle and seed the real `skill-creator`

**Files:**

- Create: `src/agent/builtin_skills/skill_creator.ts`
- Create: `src/agent/builtin_skills/skill_creator.generated.ts`
- Create: `scripts/embed-skill-creator.ts`
- Modify: `src/agent/skills.ts`
- Modify: `src/domains/skill/node/store.ts`
- Test: `src/agent/skill_creator_context_test.ts`

- [ ] **Step 1: Write the failing built-in package test**

Create `src/agent/skill_creator_context_test.ts`:

```ts
import { assert, assertEquals, assertStringIncludes } from "jsr:@std/assert";
import { SKILL_CREATOR_FILES, buildSkillCreatorSystemAddon } from "./builtin_skills/skill_creator.ts";

Deno.test("bundled skill-creator contains its required package", () => {
  assert(SKILL_CREATOR_FILES["SKILL.md"]);
  assert(SKILL_CREATOR_FILES["agents/openai.yaml"]);
  assert(SKILL_CREATOR_FILES["references/openai_yaml.md"]);
  assert(SKILL_CREATOR_FILES["scripts/init_skill.py"]);
  assert(SKILL_CREATOR_FILES["scripts/generate_openai_yaml.py"]);
  assert(SKILL_CREATOR_FILES["scripts/quick_validate.py"]);
});

Deno.test("skill-creator addon binds the agent to the draft workflow", () => {
  const addon = buildSkillCreatorSystemAddon("draft-123");
  assertStringIncludes(addon, "skill-creator");
  assertStringIncludes(addon, "draft-123");
  assertStringIncludes(addon, "skill_draft_init");
  assertStringIncludes(addon, "完成并安装");
});

Deno.test("skill-creator frontmatter uses the official skill name", () => {
  const skill = SKILL_CREATOR_FILES["SKILL.md"];
  assertEquals(skill.match(/^name:\s*(.+)$/m)?.[1], "skill-creator");
});
```

- [ ] **Step 2: Run the test and verify it fails**

Run:

```bash
deno test --allow-read --allow-write --allow-env src/agent/skill_creator_context_test.ts
```

Expected: FAIL because `builtin_skills/skill_creator.ts` does not exist.

- [ ] **Step 3: Add the package embedding generator**

Create `scripts/embed-skill-creator.ts`:

```ts
const source = Deno.args[0];
const output = Deno.args[1];
if (!source || !output) {
  throw new Error("Usage: embed-skill-creator.ts <source-directory> <output-file>");
}

const allowed = [
  "SKILL.md",
  "agents/openai.yaml",
  "references/openai_yaml.md",
  "scripts/init_skill.py",
  "scripts/generate_openai_yaml.py",
  "scripts/quick_validate.py",
];
const files: Record<string, string> = {};
for (const relative of allowed) {
  files[relative] = await Deno.readTextFile(`${source}/${relative}`);
}
const generated = `// Generated from the Codex skill-creator package. Do not edit manually.
export const GENERATED_SKILL_CREATOR_FILES: Readonly<Record<string, string>> =
  ${JSON.stringify(files, null, 2)} as const;
`;
await Deno.mkdir(output.slice(0, output.lastIndexOf("/")), { recursive: true });
await Deno.writeTextFile(output, generated);
```

Generate the exact package snapshot:

```bash
deno run --allow-read=/Users/xiaozhongyuan/.codex/skills/.system/skill-creator --allow-write=src/agent/builtin_skills scripts/embed-skill-creator.ts /Users/xiaozhongyuan/.codex/skills/.system/skill-creator src/agent/builtin_skills/skill_creator.generated.ts
```

Expected: the generated file contains the official `SKILL.md`, initializer, validator, YAML generator, reference, and UI metadata without rewriting their content.

- [ ] **Step 4: Add the Pi-a runtime adapter**

Create `src/agent/builtin_skills/skill_creator.ts`:

```ts
import { GENERATED_SKILL_CREATOR_FILES } from "./skill_creator.generated.ts";

export const SKILL_CREATOR_NAME = "skill-creator";
export const SKILL_CREATOR_FILES = GENERATED_SKILL_CREATOR_FILES;

export function buildSkillCreatorSystemAddon(draftId: string): string {
  return `\n\n<active_skill name="skill-creator">
${SKILL_CREATOR_FILES["SKILL.md"]}
</active_skill>
<skill_creator_runtime draft_id="${draftId}">
Follow the active skill exactly, replacing its filesystem initializer and validator commands
with the equivalent skill_draft_init and skill_draft_validate tools supplied by Pi-a.
Use only skill_draft_* tools to modify this draft. Never use general write, edit, or bash tools.
Never install or overwrite an installed skill. The user installs only through “完成并安装”.
</skill_creator_runtime>`;
}
```

- [ ] **Step 5: Seed every embedded file safely**

In `src/agent/skills.ts`, export `SKILLS_DIR`, import `SKILL_CREATOR_FILES`, and add:

```ts
async function writeBundledSkillCreator(): Promise<void> {
  const skillDir = `${SKILLS_DIR}/skill-creator`;
  for (const [relativePath, content] of Object.entries(SKILL_CREATOR_FILES)) {
    const target = `${skillDir}/${relativePath}`;
    await Deno.mkdir(target.slice(0, target.lastIndexOf("/")), { recursive: true });
    try {
      await Deno.stat(target);
    } catch {
      await Deno.writeTextFile(target, content);
    }
  }
}
```

Call `await writeBundledSkillCreator()` from `ensureSkillsDir()` after the existing built-ins. Add `"skill-creator"` to `BUILTIN_NAMES` in `src/domains/skill/node/store.ts`.

- [ ] **Step 6: Run focused tests**

Run:

```bash
deno test --allow-read --allow-write --allow-env src/agent/skill_creator_context_test.ts
deno check src/agent/skills.ts src/domains/skill/node/store.ts
```

Expected: all tests pass and checks report no errors.

## Task 2: Implement the isolated skill-draft domain

**Files:**

- Create: `src/domains/skill-draft/node/store.ts`
- Create: `src/domains/skill-draft/node/store_test.ts`
- Modify: `src/domains/attachment/node/store.ts`

- [ ] **Step 1: Write failing lifecycle and security tests**

Create `src/domains/skill-draft/node/store_test.ts` using a temporary root:

```ts
import {
  assert,
  assertEquals,
  assertRejects,
  assertStringIncludes,
} from "jsr:@std/assert";
import { createSkillDraftStore } from "./store.ts";

Deno.test("draft lifecycle writes, validates, and installs a full package", async () => {
  const root = await Deno.makeTempDir();
  try {
    const store = createSkillDraftStore(root);
    const draft = await store.getOrCreateForConversation("conv-1");
    await store.writeFile(draft.id, "SKILL.md", `---
name: release-notes
description: Generate structured release notes from commits when users request a changelog summary.
---

# Release Notes

Read commits, group changes, and produce concise release notes.
`);
    await store.writeFile(draft.id, "scripts/collect.ts", "export const collect = () => [];\n");
    const validation = await store.validate(draft.id);
    assert(validation.valid);
    const installed = await store.install(draft.id);
    assertEquals(installed.name, "release-notes");
    assertStringIncludes(
      await Deno.readTextFile(`${root}/skills/release-notes/SKILL.md`),
      "Generate structured release notes",
    );
    assertEquals((await store.get(draft.id)).status, "installed");
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("draft paths cannot escape package root", async () => {
  const root = await Deno.makeTempDir();
  try {
    const store = createSkillDraftStore(root);
    const draft = await store.getOrCreateForConversation("conv-2");
    await assertRejects(() => store.writeFile(draft.id, "../escape", "bad"), Error, "非法草稿路径");
    await assertRejects(() => store.writeFile(draft.id, "/tmp/escape", "bad"), Error, "非法草稿路径");
    await assertRejects(() => store.writeFile(draft.id, "other/file", "bad"), Error, "不允许的技能路径");
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("invalid frontmatter and duplicate installation are rejected", async () => {
  const root = await Deno.makeTempDir();
  try {
    const store = createSkillDraftStore(root);
    const first = await store.getOrCreateForConversation("conv-3");
    await store.writeFile(first.id, "SKILL.md", "---\\nname: Bad_Name\\ndescription: x\\n---\\n");
    assertEquals((await store.validate(first.id)).valid, false);

    await Deno.mkdir(`${root}/skills/release-notes`, { recursive: true });
    const second = await store.getOrCreateForConversation("conv-4");
    await store.writeFile(second.id, "SKILL.md", "---\\nname: release-notes\\ndescription: Create release notes when requested.\\n---\\n");
    await assertRejects(() => store.install(second.id), Error, "技能已存在");
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});
```

- [ ] **Step 2: Run tests and verify failure**

Run:

```bash
deno test --allow-read --allow-write --allow-env src/domains/skill-draft/node/store_test.ts
```

Expected: FAIL because the store module does not exist.

- [ ] **Step 3: Implement metadata, safe paths, and file operations**

Create `src/domains/skill-draft/node/store.ts` with exported types:

```ts
export type SkillDraftStatus = "editing" | "valid" | "installed";

export interface SkillDraftMetadata {
  id: string;
  conversationId: string;
  status: SkillDraftStatus;
  skillName?: string;
  createdAt: number;
  updatedAt: number;
  installedAt?: number;
}

export interface SkillDraftFile {
  path: string;
  size: number;
  binary: boolean;
}

export interface SkillDraftValidationItem {
  path?: string;
  code: string;
  message: string;
}

export interface SkillDraftValidation {
  valid: boolean;
  errors: SkillDraftValidationItem[];
  warnings: SkillDraftValidationItem[];
  checkedAt: number;
}
```

Implement `createSkillDraftStore(root = \`${HOME}/.pi-a\`)` with:

```ts
const ALLOWED_ROOT_FILE = new Set(["SKILL.md"]);
const ALLOWED_PREFIXES = ["agents/", "scripts/", "references/", "assets/"];

function safeRelativePath(input: string): string {
  if (!input || input.startsWith("/") || input.includes("\\0")) {
    throw new Error("非法草稿路径");
  }
  const normalized = input.replaceAll("\\\\", "/").split("/").filter(Boolean);
  if (normalized.some((part) => part === "." || part === "..")) {
    throw new Error("非法草稿路径");
  }
  const relative = normalized.join("/");
  if (!ALLOWED_ROOT_FILE.has(relative) && !ALLOWED_PREFIXES.some((p) => relative.startsWith(p))) {
    throw new Error("不允许的技能路径");
  }
  return relative;
}
```

The store must expose:

```ts
getOrCreateForConversation(conversationId: string): Promise<SkillDraftMetadata>;
get(id: string): Promise<SkillDraftMetadata>;
listFiles(id: string): Promise<SkillDraftFile[]>;
readFile(id: string, path: string): Promise<{ text?: string; size: number; binary: boolean }>;
writeFile(id: string, path: string, content: string): Promise<void>;
importAsset(id: string, sourcePath: string, fileName: string): Promise<string>;
deleteFile(id: string, path: string): Promise<void>;
validate(id: string): Promise<SkillDraftValidation>;
install(id: string): Promise<{ name: string; path: string }>;
```

Write metadata through `draft.json.tmp` followed by `Deno.rename`. Reject writes when status is `installed`. On every mutation, set status to `editing` and update `updatedAt`.

Export the production singleton:

```ts
const HOME = Deno.env.get("HOME") || "/tmp";
export const skillDraftStore = createSkillDraftStore(`${HOME}/.pi-a`);
```

In `src/domains/attachment/node/store.ts`, add:

```ts
export function getConversationAttachment(
  conversationId: string,
  attachmentId: string,
): AttachmentRecord | undefined {
  return getDb().prepare(`
    SELECT a.id, a.original_name AS name, a.file_path AS filePath,
           a.mime_type AS mimeType, a.extension, a.size
      FROM attachments a
      JOIN message_attachments ma ON ma.attachment_id = a.id
      JOIN messages m ON m.id = ma.message_id
     WHERE a.id = ? AND m.conversation_id = ?
     LIMIT 1
  `).get(attachmentId, conversationId) as AttachmentRecord | undefined;
}
```

`importAsset` must normalize `fileName`, force the target under `assets/`, reject a symbolic-link source with `Deno.lstat`, copy only a regular file, and return its relative target path.

- [ ] **Step 4: Implement strict validation**

Parse frontmatter without adding a YAML dependency: require the opening/closing `---` block and parse only single-line `name:` and `description:` fields. Reject duplicate keys, unknown keys, missing values, angle brackets in description, invalid names, names over 64 characters, and descriptions over 1024 characters.

Recursively inspect entries with `Deno.lstat`; reject symlinks, special files, README/CHANGELOG files, and files outside the allowed roots. On success persist `status: "valid"` and `skillName`.

- [ ] **Step 5: Implement atomic no-overwrite installation**

Copy regular files into `${root}/skills/.installing-<draft-id>`, verify the destination name still does not exist, and rename the temporary directory to `${root}/skills/<skillName>`. On failure remove only the explicit temporary directory. Never remove or overwrite the final destination.

- [ ] **Step 6: Run domain tests**

Run:

```bash
deno test --allow-read --allow-write --allow-env src/domains/skill-draft/node/store_test.ts
deno check src/domains/skill-draft/node/store.ts
```

Expected: all lifecycle, validation, traversal, and collision tests pass.

## Task 3: Add conversation-bound Agent tools

**Files:**

- Create: `src/agent/tools/skill_draft.ts`
- Create: `src/agent/tools/skill_draft_test.ts`
- Modify: `src/agent/tools/index.ts`

- [ ] **Step 1: Write the failing toolset test**

Create `src/agent/tools/skill_draft_test.ts`:

```ts
import { assertEquals } from "jsr:@std/assert";
import { getSkillDraftTools } from "./skill_draft.ts";

Deno.test("creator toolset exposes only controlled draft mutations", () => {
  assertEquals(
    getSkillDraftTools().map((tool) => tool.name),
    [
      "skill_draft_init",
      "skill_draft_list",
      "skill_draft_read",
      "skill_draft_write",
      "skill_draft_import_attachment",
      "skill_draft_delete",
      "skill_draft_validate",
    ],
  );
});
```

- [ ] **Step 2: Run the test and verify failure**

Run:

```bash
deno test --allow-read --allow-write --allow-env src/agent/tools/skill_draft_test.ts
```

Expected: FAIL because the tool module does not exist.

- [ ] **Step 3: Implement TypeBox schemas and bound execution**

Create `src/agent/tools/skill_draft.ts`. Resolve the current session with:

```ts
async function currentDraft() {
  const conversationId = sessionContext.getStore()?.sessionId;
  if (!conversationId) throw new Error("无法获取技能创建会话");
  return await skillDraftStore.getOrCreateForConversation(conversationId);
}

function textResult(value: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(value) }],
    details: value,
  };
}
```

Define tools with exact argument shapes:

```ts
skill_draft_init: { name: string; description: string; resources?: ("scripts"|"references"|"assets")[] }
skill_draft_list: {}
skill_draft_read: { path: string }
skill_draft_write: { path: string; content: string }
skill_draft_import_attachment: { attachmentId: string; fileName?: string }
skill_draft_delete: { path: string }
skill_draft_validate: {}
```

`skill_draft_init` writes a standards-compliant initial `SKILL.md` and optional empty resource directories without example placeholders. All other tools call the domain store and return structured JSON.

`skill_draft_import_attachment` must call `getConversationAttachment(conversationId, attachmentId)`, reject attachments from any other conversation, and pass only the server-owned `filePath` and sanitized requested/original name to `importAsset`.

- [ ] **Step 4: Export a restricted creator toolset**

In `src/agent/tools/index.ts`, add:

```ts
import { getSkillDraftTools } from "./skill_draft.ts";

export function getSkillCreatorTools(): AgentTool<any>[] {
  return [
    ...getSkillDraftTools(),
    askUserQuestionTool,
    readDocTool,
  ];
}
```

Do not include general `write`, `edit`, `bash`, memory-write, computer-use, subagent, or MCP tools.

- [ ] **Step 5: Run tool tests and checks**

Run:

```bash
deno test --allow-read --allow-write --allow-env src/agent/tools/skill_draft_test.ts
deno check src/agent/tools/skill_draft.ts src/agent/tools/index.ts
```

Expected: the tool list is exact and type checking succeeds.

## Task 4: Activate `skill-creator` in provider and expose draft APIs

**Files:**

- Create: `src/agent/skill_creator_context.ts`
- Create: `src/agent/skill_creator_context_test.ts`
- Modify: `src/agent/provider.ts`
- Modify: `main.ts`

- [ ] **Step 1: Write the failing activation decision test**

Add to `src/agent/skill_creator_context_test.ts`:

```ts
import { creatorContextForConversation } from "./skill_creator_context.ts";

Deno.test("only skill_creator conversations receive creator context", async () => {
  const resolveDraft = async (conversationId: string) => ({
    id: "draft-test",
    conversationId,
    status: "editing" as const,
    createdAt: 1,
    updatedAt: 1,
  });
  const normal = await creatorContextForConversation("assistant", "conv-a", resolveDraft);
  assertEquals(normal, null);
  const creator = await creatorContextForConversation("skill_creator", "conv-b", resolveDraft);
  assert(creator);
  assertStringIncludes(creator.systemAddon, "<active_skill name=\"skill-creator\">");
  assertEquals(creator.draft.conversationId, "conv-b");
});
```

- [ ] **Step 2: Run the test and verify failure**

Run:

```bash
deno test --allow-read --allow-write --allow-env src/agent/skill_creator_context_test.ts
```

Expected: FAIL because `skill_creator_context.ts` does not exist.

- [ ] **Step 3: Implement the activation helper**

Create `src/agent/skill_creator_context.ts`:

```ts
import { buildSkillCreatorSystemAddon } from "./builtin_skills/skill_creator.ts";
import { skillDraftStore } from "../domains/skill-draft/node/store.ts";

type DraftResolver = typeof skillDraftStore.getOrCreateForConversation;

export async function creatorContextForConversation(
  category: string,
  conversationId: string,
  resolveDraft: DraftResolver = skillDraftStore.getOrCreateForConversation.bind(skillDraftStore),
) {
  if (category !== "skill_creator") return null;
  const draft = await resolveDraft(conversationId);
  return {
    draft,
    systemAddon: buildSkillCreatorSystemAddon(draft.id),
  };
}
```

- [ ] **Step 4: Integrate category-aware provider setup**

In `src/agent/provider.ts`:

- query `category` with model and expert fields;
- call `creatorContextForConversation`;
- set initial `systemPrompt` to expert prompt plus creator addon;
- store `category` and a stable `baseSystemPrompt` on `SessionEntry`;
- change tool selection to:

```ts
function toolsForConversation(mode: RunMode, category: string): AgentTool<any>[] {
  if (category === "skill_creator") return getSkillCreatorTools();
  if (mode === "ask") return [];
  if (mode === "plan") return getReadOnlyTools();
  return getFullTools();
}
```

Build every prompt from `entry.baseSystemPrompt` so mode and slash-command changes never strip the creator context. Force creator conversations to use the restricted toolset even if the frontend sends `craft/full`.

- [ ] **Step 5: Add API routes**

In `main.ts`, add before the generic `/api/skills` routes:

```text
GET  /api/skill-drafts/by-conversation/:conversationId
GET  /api/skill-drafts/:draftId
GET  /api/skill-drafts/:draftId/files
GET  /api/skill-drafts/:draftId/file?path=...
POST /api/skill-drafts/:draftId/validate
POST /api/skill-drafts/:draftId/install
```

Use `decodeURIComponent` only on individual opaque IDs/path query values, call `skillDraftStore`, return `404` for missing drafts, `409` for installation collisions/already-installed drafts, and `400` for validation or path errors. Responses must never include the user home path; map installed results to `{ name }`.

- [ ] **Step 6: Verify backend integration**

Run:

```bash
deno test --allow-read --allow-write --allow-env src/agent/skill_creator_context_test.ts src/agent/tools/skill_draft_test.ts src/domains/skill-draft/node/store_test.ts
deno check main.ts src/agent/provider.ts
```

Expected: all tests pass and the full server type-checks.

## Task 5: Add typed frontend draft state and creator navigation

**Files:**

- Create: `frontend/src/api/skillDrafts.ts`
- Create: `frontend/src/components/skillDraftModel.ts`
- Create: `frontend/src/components/skillDraftModel_test.ts`
- Modify: `frontend/src/store/useSkillStore.ts`

- [ ] **Step 1: Write failing presentation-model tests**

Create `frontend/src/components/skillDraftModel_test.ts`:

```ts
import { assertEquals } from "jsr:@std/assert";
import { creatorConversation, draftInstallState } from "./skillDraftModel.ts";

Deno.test("creatorConversation identifies only creator sessions", () => {
  assertEquals(creatorConversation({ category: "skill_creator" }), true);
  assertEquals(creatorConversation({ category: "assistant" }), false);
  assertEquals(creatorConversation(undefined), false);
});

Deno.test("install state requires a valid non-installed draft", () => {
  assertEquals(draftInstallState(undefined), "empty");
  assertEquals(draftInstallState({ status: "editing", validation: { valid: false } }), "invalid");
  assertEquals(draftInstallState({ status: "valid", validation: { valid: true } }), "ready");
  assertEquals(draftInstallState({ status: "installed", validation: { valid: true } }), "installed");
});
```

- [ ] **Step 2: Run tests and verify failure**

Run:

```bash
deno test frontend/src/components/skillDraftModel_test.ts
```

Expected: FAIL because `skillDraftModel.ts` does not exist.

- [ ] **Step 3: Implement types, model helpers, and API client**

Create `frontend/src/components/skillDraftModel.ts` with exported `creatorConversation` and `draftInstallState` matching the tests.

Create `frontend/src/api/skillDrafts.ts` with:

```ts
export interface SkillDraftValidation {
  valid: boolean;
  errors: Array<{ path?: string; code: string; message: string }>;
  warnings: Array<{ path?: string; code: string; message: string }>;
  checkedAt: number;
}

export interface SkillDraft {
  id: string;
  conversationId: string;
  status: "editing" | "valid" | "installed";
  skillName?: string;
  createdAt: number;
  updatedAt: number;
  installedAt?: number;
  validation?: SkillDraftValidation;
}

export interface SkillDraftFile {
  path: string;
  size: number;
  binary: boolean;
}
```

Export `getDraftByConversation`, `listDraftFiles`, `readDraftFile`, `validateDraft`, and `installDraft` using the existing `apiGet`/`apiPost` helpers.

- [ ] **Step 4: Add `startSkillCreatorChat`**

Extend `SkillState` and `useSkillStore`:

```ts
startSkillCreatorChat: async () => {
  const appStore = useStore.getState();
  const conversation = await apiPost<Conversation>("/api/conv", {
    title: "创建技能",
    category: "skill_creator",
    workspaceId: appStore.composerWorkspaceId,
  });
  appStore.setComposerWorkspaceId(null);
  await appStore.loadConversations();
  await appStore.selectConversation(conversation.id);
},
```

If conversation selection fails after creation, keep the conversation so it remains recoverable from the sidebar; propagate the error for the panel to display.

- [ ] **Step 5: Run frontend model tests and build**

Run:

```bash
deno test frontend/src/components/skillDraftModel_test.ts
cd frontend && npm run build
```

Expected: model tests pass and TypeScript/Vite build succeeds.

## Task 6: Build the WorkBuddy-style creator UI

**Files:**

- Create: `frontend/src/components/SkillDraftPanel.tsx`
- Create: `frontend/src/components/SkillDraftPanel.css`
- Modify: `frontend/src/components/ExpertPanel.tsx`
- Modify: `frontend/src/components/Composer.tsx`
- Modify: `frontend/src/components/ChatArea.tsx`
- Modify: `frontend/src/components/ChatArea.css`

- [ ] **Step 1: Route “添加技能” to the creator conversation**

In `ExpertPanel.tsx`, read `startSkillCreatorChat` from the skill store. Replace `handleOpenAddModal` for the add button with an async handler that sets the existing saving/loading state, calls `startSkillCreatorChat`, and displays the existing panel error UI on failure.

Keep the modal and `saveSkill` code for editing installed skills. Remove only the “new skill” path that opens the modal.

- [ ] **Step 2: Add the fixed composer activation chip**

In `Composer.tsx`, derive:

```ts
const currentConversation = conversations.find((item) => item.id === currentConvId);
const isSkillCreator = currentConversation?.category === "skill_creator";
const effectiveSkillTag = isSkillCreator
  ? { cmd: "/skill-creator", name: "skill-creator", icon: "🛠" }
  : activeSkillTag;
const placeholder = isSkillCreator
  ? "请帮我创建一个可以实现「……」的 skill"
  : "给 Pi-a 发送消息";
```

Render `effectiveSkillTag`, hide its remove button when `isSkillCreator`, prevent the skills submenu from replacing it, and send the user’s plain visible text without prefixing `/skill-creator`. The backend category performs activation.

- [ ] **Step 3: Build `SkillDraftPanel`**

The component accepts `conversationId` and:

- loads the draft whenever `conversationId`, `busy`, or message count changes;
- loads files after draft refresh;
- selects `SKILL.md` by default;
- renders a nested-looking path list using indentation from `/` depth;
- renders text in a `<pre>` and binary files as name/size metadata;
- renders all validation errors and warnings;
- disables installation unless status is `valid`;
- asks for a local confirmation before calling `installDraft`;
- calls `useSkillStore.getState().loadSkills()` after successful installation;
- shows `409` collision errors without modifying the draft.

Use this explicit state:

```ts
type PanelRequestState = "idle" | "loading" | "validating" | "installing";
```

All buttons must have accessible labels and visible disabled/focus states.

- [ ] **Step 4: Mount the panel only in creator conversations**

In `ChatArea.tsx`, compute the current conversation and render:

```tsx
<div className={isSkillCreator ? "chatCreatorLayout" : undefined}>
  <div className="chatCreatorStream">{/* existing chat contents */}</div>
  {isSkillCreator && currentConvId && (
    <SkillDraftPanel
      conversationId={currentConvId}
      busy={busy}
      messageCount={messages.length}
    />
  )}
</div>
```

On narrow widths, stack the draft panel below the message stream. On desktop, use a 360–420 px right column with a subtle border and independent scrolling.

- [ ] **Step 5: Add production styling**

In `SkillDraftPanel.css`, use the app’s existing CSS variables. Required visual structure:

- compact header with `skill-creator` mint accent;
- status pill for editing/valid/installed;
- dark file tree with a clearly selected row;
- monospace preview with line wrapping disabled and horizontal scrolling;
- validation section with red error and amber warning treatments;
- high-contrast mint “完成并安装” button.

Do not introduce gradients or a separate design system. Match the screenshot’s dark, restrained WorkBuddy surface and the project’s existing radii.

- [ ] **Step 6: Build and lint**

Run:

```bash
cd frontend && npm run build
cd frontend && npm run lint
```

Expected: both commands succeed without TypeScript or lint errors.

## Task 7: Regression verification

**Files:**

- Verify all files changed in Tasks 1–6.
- Preserve existing attachment-response changes and tests.

- [ ] **Step 1: Run the complete Deno test suite**

Run:

```bash
deno test --allow-read --allow-write --allow-env --allow-ffi --allow-run
```

Expected: all existing PDF, Excel, attachment, event, model, history, and new skill-creator tests pass.

- [ ] **Step 2: Type-check the backend**

Run:

```bash
deno check main.ts
```

Expected: no type errors.

- [ ] **Step 3: Build and lint the frontend**

Run:

```bash
cd frontend && npm run build
cd frontend && npm run lint
```

Expected: Vite build and oxlint both succeed.

- [ ] **Step 4: Run local UI verification**

Start the existing development app and verify:

1. “添加技能” opens a conversation, not the create modal.
2. The fixed `skill-creator` chip and creator placeholder appear.
3. A normal conversation does not display creator UI.
4. Sending a requirement produces draft tool events.
5. The draft panel refreshes and previews `SKILL.md` plus nested resources.
6. Installation is disabled before successful validation.
7. “完成并安装” adds the skill to the skill list without a restart.
8. Reusing the same name returns a visible collision error.
9. Editing, enabling, disabling, and deleting existing non-built-in skills still work.
10. PDF failure and Excel response events still render visible assistant outcomes.

- [ ] **Step 5: Inspect the final diff**

Run:

```bash
git diff --check
git status --short
```

Expected: no whitespace errors; only the skill-creator work, the already-present attachment-response work, and their docs/tests are listed.
