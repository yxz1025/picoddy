# Installed Expert Management Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add safe viewing, guided invocation, conversational editing, folder opening, and recoverable uninstalling for installed Agent experts.

**Architecture:** Keep `my-experts` and `ExpertRegistry` as the installed-expert source of truth. Add one backend management service that resolves expert IDs to verified package roots, serializes mutations, creates isolated edit drafts, publishes by validated atomic replacement, and performs recoverable uninstall plus conversation unbinding. Reuse the renderer's global `AppDialog` for uninstall confirmation, extend the one-shot Composer bootstrap for both expert-manager and ordinary expert prompts, and expose every operation through the shared HTTP/IPC path.

**Tech Stack:** Electron, TypeScript, React, Zustand, SQLite, Node filesystem APIs, existing Python `expert-manager` validation/registration scripts.

**Verification constraint:** The user explicitly disabled automated test execution. Do not run test suites. Validate with flow inspection, Electron/frontend TypeScript compilation, Python syntax compilation when Python changes, JSON parsing, and `git diff --check` only.

---

## File structure

- `src/agent/experts/installed_management.ts` — trusted ID-to-package resolution, per-expert locks, edit draft creation/publish, folder resolution, recoverable uninstall.
- `src/agent/experts/installed_catalog.ts` — export the same safe marketplace/package resolver used by scan and management.
- `src/agent/experts.ts` — facade methods for installed management and registry refresh.
- `src/domains/session/node/store.ts` — installed binding DTO support, creator-operation metadata, batch unbinding, and one-shot expert notice consumption.
- `src/domains/session/node/expert_binding_store.ts` — preserve `installed` binding sources.
- `src/infra/db.ts` — additive conversation columns for edit targets and one-shot uninstall notices.
- `src/agent/expert_manager_context.ts` — create/edit-specific authoritative system context.
- `src/agent/tools/expert_draft.ts` — bounded read/write/list/delete/validate/publish tools for an edit draft.
- `src/agent/tools/index.ts` and `src/agent/provider.ts` — select expert edit tools for edit conversations and release affected expert runtimes for uninstall.
- `application.electron.ts`, `src/electron/ipc-handlers.ts`, `frontend/src/api/client.ts` — one HTTP/IPC contract for edit session, folder open, and uninstall.
- `frontend/src/components/expertCreatorModel.ts`, `frontend/src/store/useStore.ts` — generalized per-conversation Composer bootstrap and one-shot system notice.
- `frontend/src/store/useSkillStore.ts` — expert detail/actions and guided expert chat orchestration.
- `frontend/src/components/ExpertPanel.tsx`, `frontend/src/components/ExpertPanel.css` — card menu, detail dialog, guided prompt actions, and reused uninstall confirmation.
- `frontend/src/components/Composer.tsx` — render the bootstrap's explicit expert-manager-token flag.
- `docs/18-专家系统架构设计.md` — document installed expert lifecycle.

### Task 1: Make installed bindings and management metadata durable

**Files:**
- Modify: `src/infra/db.ts`
- Modify: `src/domains/session/node/store.ts`
- Modify: `src/domains/session/node/expert_binding_store.ts`
- Modify: `frontend/src/store/useStore.ts`

- [ ] **Step 1: Add additive conversation columns**

Add these migrations next to the current expert binding columns in `initDb()`:

```ts
addColumn("conversations", "expert_operation", "TEXT");
addColumn("conversations", "expert_target_id", "TEXT");
addColumn("conversations", "expert_target_revision", "TEXT");
addColumn("conversations", "expert_draft_root", "TEXT");
addColumn("conversations", "expert_notice", "TEXT");
```

- [ ] **Step 2: Preserve installed catalog sources everywhere**

Change both backend `Conversation.expertCatalogSource` and binding row normalization to accept all canonical values:

```ts
type ExpertCatalogSource = "builtin" | "installed" | "catalog";

const expertCatalogSource =
  source === "builtin" || source === "installed" || source === "catalog"
    ? source
    : null;
```

Use the imported `ExpertCatalogSource` type instead of repeating narrower unions.

- [ ] **Step 3: Add explicit creator metadata and notice types**

Extend the backend and renderer conversation DTOs with:

```ts
expertOperation?: "create" | "edit" | null;
expertTargetId?: string | null;
expertTargetRevision?: string | null;
expertDraftRoot?: string | null; // backend DTO only; never serialize to renderer
expertNotice?: "uninstalled" | null;
```

Select the operation/target/notice columns in `listConversations()` and `getConversation()`, but omit `expert_draft_root` from renderer responses.

- [ ] **Step 4: Add session-store management methods**

Implement focused store functions:

```ts
export function setExpertEditMetadata(
  conversationId: string,
  input: {
    targetId: string;
    targetRevision: string;
    draftRoot: string;
  },
): void;

export function clearExpertBindingsForUninstall(expertId: string): string[];

export function listConversationIdsByExpert(expertId: string): string[];

export function consumeExpertNotice(
  conversationId: string,
): "uninstalled" | null;
```

`listConversationIdsByExpert()` is read-only. `clearExpertBindingsForUninstall()` must run one SQLite transaction, collect the same affected IDs, set all three binding columns to `NULL`, and set `expert_notice = 'uninstalled'`. `consumeExpertNotice()` must read and clear the field within one transaction.

- [ ] **Step 5: Perform static checks and commit**

Run:

```bash
npx tsc --project tsconfig.electron.json --noEmit
cd frontend && npx tsc -b --pretty false
git diff --check
```

Expected: all commands exit 0; no test command is run.

Commit only the four Task 1 files:

```bash
git add src/infra/db.ts src/domains/session/node/store.ts src/domains/session/node/expert_binding_store.ts frontend/src/store/useStore.ts
git commit -m "fix: preserve installed expert bindings"
```

### Task 2: Build the trusted installed-expert locator and recoverable uninstall service

**Files:**
- Create: `src/agent/experts/installed_management.ts`
- Modify: `src/agent/experts/installed_catalog.ts`
- Modify: `src/agent/experts.ts`
- Modify: `src/agent/provider.ts`

- [ ] **Step 1: Extract a shared trusted package resolver**

Export a resolver from `installed_catalog.ts` that reads the marketplace registration and repeats the scanner's direct-child and symlink checks:

```ts
export interface ResolvedInstalledExpertPackage {
  id: string;
  marketplaceDir: string;
  marketplacePath: string;
  pluginsDir: string;
  expertDir: string;
  registration: Record<string, unknown>;
}

export async function resolveInstalledExpertPackage(
  expertId: string,
  options?: InstalledExpertScanOptions,
): Promise<ResolvedInstalledExpertPackage>;
```

Reject invalid IDs, missing registrations, non-direct sources, symbolic links, realpath escapes, mismatched `plugin.json.name`, and non-Agent packages with stable error codes.

- [ ] **Step 2: Add one per-expert mutation lock**

In `installed_management.ts`, create `InstalledExpertManagementError` with `code`, `status`, and bounded messages. Serialize `createEditDraft`, `publishEdit`, and `uninstall` by expert ID with a promise-tail lock so edit and uninstall cannot overlap.

- [ ] **Step 3: Add safe folder resolution**

Expose:

```ts
resolveFolder(expertId: string): Promise<string>;
```

Return only the verified `expertDir` produced by the shared resolver. Do not accept any renderer-supplied path.

- [ ] **Step 4: Add recoverable uninstall**

Implement:

```ts
uninstall(
  expertId: string,
  dependencies: {
    releaseSessions(ids: string[]): Promise<void>;
    listConversationIds(id: string): string[];
    clearBindings(id: string): string[];
    refresh(): Promise<InstalledExpertRefreshResult>;
  },
): Promise<{ expertId: string; affectedConversationIds: string[] }>;
```

Inside the expert lock:

1. Resolve and record the current package and registration.
2. Query affected conversation IDs through the read-only dependency, ask the provider to abort/wait and evict their harnesses without deleting history.
3. Atomically write marketplace JSON without the registration.
4. Rename the expert directory to `.trash/<id>-<timestamp>-<revision>` on the same filesystem.
5. Run the SQLite batch unbind transaction.
6. Refresh the installed registry.

On a failure after step 3, rename the directory back when needed, restore the original marketplace manifest atomically, leave bindings intact when their transaction did not commit, and throw a structured error. Never call recursive permanent deletion.

- [ ] **Step 5: Add provider release by conversation IDs**

Add:

```ts
async releaseExpertSessions(sessionIds: readonly string[]): Promise<void>
```

For every ID, abort the active harness, wait for idle, remove only its in-memory session entry, and retain event listeners and all persistent history. Reject if any session cannot be safely drained.

- [ ] **Step 6: Export management facade methods**

From `src/agent/experts.ts`, export the singleton service and bounded methods for resolve-folder, create-edit-draft, publish-edit, and uninstall. Every successful mutation must call `refreshInstalledExperts()`.

- [ ] **Step 7: Perform static checks and commit**

Run Electron TypeScript and `git diff --check`. Expected exit 0; do not run tests.

```bash
git add src/agent/experts/installed_management.ts src/agent/experts/installed_catalog.ts src/agent/experts.ts src/agent/provider.ts
git commit -m "feat: add installed expert management service"
```

### Task 3: Add controlled expert edit drafts and publish tools

**Files:**
- Create: `src/agent/tools/expert_draft.ts`
- Modify: `src/agent/experts/installed_management.ts`
- Modify: `src/agent/tools/index.ts`
- Modify: `src/agent/provider.ts`
- Modify: `src/agent/expert_manager_context.ts`
- Modify: `resources/builtin-skills/expert-manager/SKILL.md`
- Modify: `resources/builtin-skills/expert-manager/scripts/validate_expert.py`
- Modify: `src/agent/builtin_skills/builtin-skills.bundle.generated.ts`
- Modify: `src/agent/builtin_skills/builtin-skills.manifest.generated.json`

- [ ] **Step 1: Create an edit draft from a pinned revision**

Implement `createEditDraft(expertId, revision, conversationId)` in the management service. Resolve the package, reject a revision mismatch with HTTP 409, create `<appDataDir>/expert-drafts/<conversationId>/<expertId>`, and recursively copy only ordinary files/directories. Reject symbolic links, special files, more than 4096 entries, or more than 64 MiB total bytes. Return the canonical draft root.

- [ ] **Step 2: Add bounded edit tools**

Create these tools in `expert_draft.ts`:

```text
expert_draft_list
expert_draft_read
expert_draft_write
expert_draft_delete
expert_draft_validate
expert_draft_publish
```

Every tool derives conversation ID from `sessionContext`, loads edit metadata from SQLite, resolves relative paths under `draftRoot`, rejects absolute paths, `..`, links and special files, and never returns an absolute path. Write operations use temporary files plus rename. Delete is limited to entries inside the draft.

- [ ] **Step 3: Validate drafts with the authoritative Python validator**

`expert_draft_validate` invokes the bundled `validate_expert.py` with a new optional `--expected-plugins-dir <draft-parent>` argument. Use an abort-aware child process, cap combined output, and return `{ ok, summary }` without leaking local paths. Update the Python CLI parser while retaining the existing one-argument command.

- [ ] **Step 4: Publish with revision conflict protection**

`expert_draft_publish` calls the management service. Under the expert lock, re-resolve the installed package, compare its revision with `expert_target_revision`, validate the draft, move the old package to a temporary backup, rename the draft copy into the fixed package path, invoke `register_expert.py`, refresh the registry, then move the old-version backup into `.trash/<id>-<timestamp>-<old-revision>` after success. Restore the backup and marketplace registration on any failure.

- [ ] **Step 5: Select the edit toolset in provider**

For `expert_creator`:

- `operation=create`: preserve the current creation tools and lifecycle.
- `operation=edit`: expose read-only general tools plus `getExpertDraftTools()`; do not expose generic `write`, `edit`, or `bash` against application-managed paths.

The edit mode must not depend on the visible `expert-manager` token.

- [ ] **Step 6: Make expert-manager context operation-aware**

Extend `ExpertManagerContext` to read conversation management metadata. In edit mode, inject target ID/revision and these rules: read the full draft first, preserve immutable identifiers, modify only requested capabilities, validate, ask for confirmation when requirements materially change, then publish through `expert_draft_publish`. Do not include an absolute installed package path in the model-visible context.

- [ ] **Step 7: Update the builtin skill instructions**

Document the controlled edit tools in `SKILL.md`; remove any instruction that tells edit mode to write the installed directory directly. Creation continues to use the existing init/validate/register scripts.

- [ ] **Step 8: Regenerate the builtin bundle and check syntax**

Run:

```bash
npm run gen:builtin-skills
python3 -m py_compile resources/builtin-skills/expert-manager/scripts/validate_expert.py
npx tsc --project tsconfig.electron.json --noEmit
git diff --check
```

Expected: all exit 0; no test suite runs.

Commit the tool, provider/context, skill source, validator, and mechanically generated bundle files together.

### Task 4: Expose edit, folder, uninstall, and notice APIs through HTTP and IPC

**Files:**
- Modify: `application.electron.ts`
- Modify: `src/electron/ipc-handlers.ts`
- Modify: `frontend/src/api/client.ts`

- [ ] **Step 1: Add the edit-session route**

Implement `POST /api/experts/:id/edit-session`. It must:

1. Resolve the installed expert and current revision.
2. Create an `expert_creator` conversation titled `修改<专家名>`.
3. Create its isolated draft.
4. Persist `operation=edit`, target ID/revision and draft root.
5. Return only the conversation DTO plus safe expert summary.

If draft creation fails, delete the newly created conversation and its draft remnants.

- [ ] **Step 2: Add folder and uninstall routes**

Implement:

```text
POST   /api/experts/:id/open-folder
DELETE /api/experts/:id
```

The folder route resolves by ID and calls `platformShell.openPath()`. The DELETE route calls the installed management service and returns `{ ok, expertId, affectedConversationIds }`.

- [ ] **Step 3: Return structured errors**

Map `InstalledExpertManagementError` to `jsonError`-style responses with status and code:

```json
{ "error": "安全且可展示的错误", "code": "EXPERT_UNINSTALL_CONFLICT" }
```

Do not return HTTP 200 with `{ error }`.

- [ ] **Step 4: Consume the one-shot uninstall notice**

Change `GET /api/msgs/:id` to return:

```ts
{ messages: MessageRecord[]; notice: "uninstalled" | null }
```

Consume `expert_notice` only after messages are read successfully. Update IPC mapping and renderer parsing together so older calls cannot mistake the envelope for an array.

- [ ] **Step 5: Add IPC routes and allowlist entries**

Register `expert.createEditSession`, `expert.openFolder`, and `expert.uninstall`; add them to `ALLOWED`, and add corresponding renderer client routes. Encode expert IDs with the existing `pathSegment()` helper.

- [ ] **Step 6: Perform static checks and commit**

Run Electron/frontend TypeScript and `git diff --check`; expected exit 0. Do not run API tests.

```bash
git add application.electron.ts src/electron/ipc-handlers.ts frontend/src/api/client.ts
git commit -m "feat: expose installed expert management APIs"
```

### Task 5: Generalize Composer bootstrap for expert prompts and edit prompts

**Files:**
- Modify: `frontend/src/components/expertCreatorModel.ts`
- Modify: `frontend/src/store/useStore.ts`
- Modify: `frontend/src/components/Composer.tsx`
- Modify: `frontend/src/components/ChatArea.tsx`
- Modify: `frontend/src/components/ChatArea.css`

- [ ] **Step 1: Replace the fixed creator bootstrap shape**

Define:

```ts
export interface ExpertComposerBootstrap {
  conversationId: string;
  text: string;
  expertManagerToken: boolean;
}

export function createExpertComposerBootstrap(
  conversationId: string,
  options: { text?: string; expertManagerToken?: boolean } = {},
): ExpertComposerBootstrap;
```

Defaults remain the current creation prompt plus `expertManagerToken: true`.

- [ ] **Step 2: Consume the complete bootstrap object**

Change `takeExpertComposerBootstrap()` and the store consumer to return the bootstrap object rather than only text. Composer sets both `text` and `showExpertManagerToken` from it, focuses the editor, and positions the caret after the prefilled prompt.

- [ ] **Step 3: Render uninstall notices outside message history**

When `selectConversation()` receives `{ messages, notice }`, store a transient system notice separately from `messages`. Render it in ChatArea as a dismissible neutral notice: `原专家已卸载，已切换为普通会话`. It must not be passed to `sendMessage()` or persisted as a message.

- [ ] **Step 4: Perform frontend TypeScript and diff checks**

Run frontend TypeScript and `git diff --check`; expected exit 0. Do not run existing model tests.

```bash
git add frontend/src/components/expertCreatorModel.ts frontend/src/store/useStore.ts frontend/src/components/Composer.tsx frontend/src/components/ChatArea.tsx frontend/src/components/ChatArea.css
git commit -m "feat: guide expert conversations in composer"
```

### Task 6: Add renderer expert management actions

**Files:**
- Modify: `frontend/src/store/useSkillStore.ts`

- [ ] **Step 1: Add action contracts**

Extend `SkillState` with:

```ts
getExpert(id: string): Promise<Expert>;
startExpertChat(
  expertId: string,
  expertName: string,
  initialPrompt?: string,
): Promise<void>;
startExpertEdit(expert: Expert): Promise<string>;
openExpertFolder(expertId: string): Promise<void>;
uninstallExpert(expertId: string): Promise<{ affectedConversationIds: string[] }>;
```

- [ ] **Step 2: Prefill expert chats only after binding succeeds**

Keep the current create-conversation → bind-expert compensation flow. After binding and navigation both succeed, set a bootstrap with:

```ts
text: initialPrompt?.trim() || expert.quickPrompts.find((item) => item.trim()) || expert.description,
expertManagerToken: false,
```

Do not send the text automatically.

- [ ] **Step 3: Start edit sessions with the confirmed prompt**

Call the edit-session API, update/select the returned conversation, and enqueue:

```ts
{
  conversationId: conversation.id,
  text: `帮我修改专家：[${expert.id}]，增加/优化[请补充你希望新增/优化的技能或知识领域等]方面的能力`,
  expertManagerToken: true,
}
```

- [ ] **Step 4: Refresh local state after uninstall**

After successful DELETE, remove the expert from `installedExperts` immediately, call `loadInstalledExperts()` and `loadExperts()`, then call `useStore.getState().loadConversations()`. Preserve the current panel state when refresh fails and surface the structured backend message.

- [ ] **Step 5: Perform frontend TypeScript and diff checks**

Run frontend TypeScript and `git diff --check`; expected exit 0.

```bash
git add frontend/src/store/useSkillStore.ts
git commit -m "feat: add installed expert renderer actions"
```

### Task 7: Build the card menu and expert detail dialog

**Files:**
- Modify: `frontend/src/components/ExpertPanel.tsx`
- Modify: `frontend/src/components/ExpertPanel.css`

- [ ] **Step 1: Separate card and menu actions**

Replace the installed expert's single outer `<button>` with a semantic card container. Keep a dedicated “召唤专家” button and add a neutral `MoreHorizontal` button. Stop propagation on the menu button and menu items.

- [ ] **Step 2: Implement the four-item menu**

Render `role="menu"` with:

```text
Eye       查看专家
Pencil    修改专家
Folder    打开文件夹
Trash2    卸载专家
```

Only the uninstall item uses danger styling. Support outside click, Escape, keyboard focus, and returning focus to the “…” button.

- [ ] **Step 3: Reuse AppDialog for uninstall confirmation**

Call the existing global API exactly as follows:

```ts
const approved = await requestUiConfirm({
  title: "卸载专家",
  message: `确定卸载专家「${expert.name}」？\n历史消息将保留，相关会话会切换为普通会话。`,
  confirmLabel: "确认卸载",
  cancelLabel: "取消",
  tone: "danger",
});
```

On approval, await `uninstallExpert()`. Disable duplicate card operations while pending. On error, use the existing `showUiAlert` with a danger tone.

- [ ] **Step 4: Implement the confirmed detail dialog**

Create an accessible modal within ExpertPanel matching the supplied reference structure: avatar; profession and nickname; black/neutral “召唤专家” button; description; three tag pills; “专家帮你做”; up to three full-row quick-prompt buttons. Fetch detail by ID when opening and never render prompt bodies or paths.

- [ ] **Step 5: Wire dialog invocation prompts**

The main dialog button calls `startExpertChat()` without an override, causing first-quick-prompt/description fallback. Each quick-prompt row passes its own text. Both close the panel only after the new bound conversation opens successfully.

- [ ] **Step 6: Apply theme-safe styling**

Use existing CSS variables for light/dark surfaces, borders, text, danger colors and focus rings. Add responsive scrolling, reduced-motion rules, `role="dialog"`, `aria-modal`, labelled controls and focus restoration. Do not introduce blue hard-coded accents.

- [ ] **Step 7: Perform frontend TypeScript and diff checks**

Run frontend TypeScript and `git diff --check`; expected exit 0. Do not run UI automation.

```bash
git add frontend/src/components/ExpertPanel.tsx frontend/src/components/ExpertPanel.css
git commit -m "feat: manage installed experts from expert center"
```

### Task 8: Document and manually inspect the complete flow

**Files:**
- Modify: `docs/18-专家系统架构设计.md`
- Modify: `docs/superpowers/specs/2026-08-12-installed-expert-management-design.md`

- [ ] **Step 1: Update architecture documentation**

Document the trusted installed management service, edit draft lifecycle, revision conflict behavior, recoverable trash location, `installed` binding preservation, one-shot uninstall notices, API/IPC operations, and explicit reuse of `AppDialog` only at the frontend confirmation layer.

- [ ] **Step 2: Walk the code paths without executing tests**

Trace and record each chain:

```text
card → details → prompt selection → conv create → expert bind → bootstrap → Composer
card → edit → edit-session → draft → expert-manager tools → validate → publish → registry refresh
card → AppDialog → DELETE → release sessions → unregister → trash move → unbind → notice → registry refresh
card → open-folder → trusted resolver → platform shell
```

Confirm every renderer operation has both IPC and HTTP fallback routes and that all backend failures use non-2xx structured responses.

- [ ] **Step 3: Run final allowed verification**

Run:

```bash
npx tsc --project tsconfig.electron.json --noEmit
cd frontend && npx tsc -b --pretty false
python3 -m py_compile resources/builtin-skills/expert-manager/scripts/validate_expert.py
node -e "JSON.parse(require('fs').readFileSync('src/agent/builtin_skills/builtin-skills.manifest.generated.json','utf8'))"
git diff --check
```

Expected: every command exits 0. Explicitly report that automated tests and browser automation were not run per user instruction.

- [ ] **Step 4: Commit documentation**

```bash
git add docs/18-专家系统架构设计.md docs/superpowers/specs/2026-08-12-installed-expert-management-design.md
git commit -m "docs: document installed expert lifecycle"
```
