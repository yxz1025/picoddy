# Expert Session Runtime Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the existing expert catalog and UI into a reliable session-level expert runtime that preserves the core system prompt, validates bindings, survives restart, and supports safe switch/deactivation.

**Architecture:** Keep one Pi Agent harness per conversation and model an expert as an additive `ExpertRuntimeProfile`. A registry owns catalog metadata, a resolver owns prompt sources/cache, a binding service owns SQLite state and runtime invalidation, and the prompt assembler appends a bounded `<expert_specialization>` block without changing tool permissions.

**Tech Stack:** TypeScript, Electron IPC, SQLite (`node:sqlite` `DatabaseSync` through the existing DB layer), Pi Agent Core, React 19, Zustand, Node test runner with `tsx`.

---

## Workspace and scope rules

- Preserve unrelated working-tree changes, including `.claude/`.
- Implement Phase 1 plus the cache/security essentials from Phase 2 of `docs/18-专家系统架构设计.md`.
- Do not implement expert marketplace installation, expert editing, multiple active experts, automatic expert routing, or dynamic tool/MCP permission expansion.
- Expert-declared tools and skills are hints only. `toolsForConversation`, permission hooks, and user-selected MCP tools remain authoritative.
- Keep `src/agent/experts.ts` as a compatibility facade so existing imports do not break in one large migration.
- Run the focused test after every red/green cycle, then run the complete verification set in Task 9.

## File map

**Create**

- `src/agent/experts/types.ts` — canonical expert summary, manifest, binding, prompt-resolution, and runtime-profile types.
- `src/agent/experts/registry.ts` — normalize built-in/catalog data, validate IDs, expose summaries and manifests.
- `src/agent/experts/prompt_resolver.ts` — trusted-source fetch, revisioned cache, size/hash validation, and fallback order.
- `src/agent/experts/runtime_profile.ts` — build a bounded expert specialization block and validate capability hints.
- `src/agent/experts/binding_service.ts` — validate and persist assign/clear operations, then refresh the in-memory provider.
- `src/agent/experts/observability.ts` — emit bounded structured expert lifecycle events without prompt contents.
- `src/agent/experts/registry.test.ts`
- `src/agent/experts/prompt_resolver.test.ts`
- `src/agent/experts/runtime_profile.test.ts`
- `src/agent/experts/binding_service.test.ts`
- `src/domains/session/node/expert_binding_store.ts`
- `src/domains/session/node/expert_binding_store.test.ts`
- `frontend/src/components/ConversationExpertControl.tsx`
- `frontend/src/types/experts.ts` — shared expert DTOs used by both Zustand stores and UI components.

**Modify**

- `src/agent/experts.ts` — compatibility re-exports and current catalog bootstrap.
- `src/agent/engine.ts` — accept `expertAddon`; never use expert text as `basePrompt`.
- `src/agent/provider.ts` — load runtime profile and implement `reloadProfile`.
- `src/infra/db.ts` — add `expert_revision` and `expert_catalog_source` migrations.
- `src/domains/session/node/store.ts` — expose expert fields, binding helpers, and fork inheritance.
- `application.electron.ts` — route expert operations through the binding service.
- `src/electron/ipc-handlers.ts`
- `src/electron/preload.cjs`
- `frontend/src/api/client.ts`
- `frontend/src/store/useStore.ts`
- `frontend/src/store/useSkillStore.ts`
- `frontend/src/components/ChatArea.tsx`
- `frontend/src/components/ChatArea.css`

## Task 1: Canonical expert types and registry

**Files:**

- Create: `src/agent/experts/types.ts`
- Create: `src/agent/experts/registry.ts`
- Create: `src/agent/experts/registry.test.ts`
- Modify: `src/agent/experts.ts`

- [ ] **Step 1: Write failing registry tests**

Create tests that prove the registry returns safe summaries, preserves stable IDs, rejects invalid IDs, deduplicates catalog entries, and never exposes prompt text from `list()`:

```typescript
import assert from "node:assert/strict";
import test from "node:test";
import { createExpertRegistry } from "./registry.ts";

test("registry exposes summaries without prompt bodies", () => {
  const registry = createExpertRegistry({
    builtins: [{
      id: "software-company",
      name: "软件公司专家",
      categoryId: "engineering",
      description: "架构设计",
      icon: "🏗️",
      revision: "r1",
      catalogSource: "builtin",
      prompt: { inline: "secret prompt", maxBytes: 131072 },
      guidelines: ["考虑扩展性"],
      capabilityHints: { preferredTools: ["read"], bundledSkills: [] },
      tags: [],
      quickPrompts: [],
    }],
    catalog: [],
  });

  const summary = registry.list()[0];
  assert.equal(summary.id, "software-company");
  assert.equal("prompt" in summary, false);
  assert.equal(registry.get("../escape"), undefined);
});

test("builtins win deterministic id collisions", () => {
  const builtin = makeManifest("same", "builtin");
  const catalog = makeManifest("same", "catalog");
  const registry = createExpertRegistry({ builtins: [builtin], catalog: [catalog] });
  assert.equal(registry.get("same")?.catalogSource, "builtin");
  assert.equal(registry.diagnostics().length, 1);
});
```

Define `makeManifest` in the test with all required fields; do not use `as any` for the manifest itself.

- [ ] **Step 2: Run the tests and confirm red state**

Run:

```bash
node --import tsx --test src/agent/experts/registry.test.ts
```

Expected: failure because `types.ts` and `registry.ts` do not exist.

- [ ] **Step 3: Define the canonical contracts**

Implement these names in `types.ts`:

```typescript
export type ExpertCatalogSource = "builtin" | "catalog";
export type ExpertPromptSource = "cache" | "remote" | "inline";

export interface ExpertSummary {
  id: string;
  name: string;
  nickname?: string;
  categoryId: string;
  description: string;
  icon: string;
  tags: string[];
  quickPrompts: string[];
  badge?: string;
  catalogSource: ExpertCatalogSource;
  revision: string;
  available: boolean;
}

export interface ExpertManifest extends ExpertSummary {
  prompt: {
    inline?: string;
    remotePath?: string;
    sha256?: string;
    maxBytes: number;
  };
  guidelines: string[];
  capabilityHints: {
    preferredTools: string[];
    bundledSkills: string[];
  };
  outputPolicy?: string[];
  riskNotes?: string[];
}

export interface ExpertBinding {
  expertId: string;
  revision: string;
  catalogSource: ExpertCatalogSource;
}
```

Use `^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$` as the accepted expert ID pattern.

- [ ] **Step 4: Implement a deterministic registry**

`createExpertRegistry({ builtins, catalog })` must return:

```typescript
export interface ExpertRegistry {
  list(): ExpertSummary[];
  get(id: string): ExpertManifest | undefined;
  diagnostics(): readonly ExpertRegistryDiagnostic[];
}
```

Normalize optional arrays to empty arrays, return copies rather than mutable internal objects, load built-ins first, and record catalog collisions instead of overwriting them.

- [ ] **Step 5: Adapt the existing catalog through the facade**

Keep these compatibility exports in `src/agent/experts.ts`:

```typescript
export const expertRegistry = createExpertRegistry({
  builtins: normalizedBuiltins,
  catalog: normalizedCatalog,
});

export const BUILTIN_EXPERTS = expertRegistry.list();
export const getExpert = (id: string) => expertRegistry.get(id);
```

Map existing `systemPrompt` to `prompt.inline`, `promptFile` to `prompt.remotePath`, `updatedAt` to `revision`, and current `skills`/`preferred_tools` data to `capabilityHints`. Use a stable fallback revision derived from the manifest content when `updatedAt` is absent.

- [ ] **Step 6: Run tests and type-check**

Run:

```bash
node --import tsx --test src/agent/experts/registry.test.ts
npx tsc --project tsconfig.electron.json --noEmit
```

Expected: both commands exit 0.

- [ ] **Step 7: Commit the registry slice**

```bash
git add src/agent/experts.ts src/agent/experts/types.ts src/agent/experts/registry.ts src/agent/experts/registry.test.ts
git commit -m "refactor: define expert registry contracts"
```

## Task 2: Trusted prompt resolver and revisioned cache

**Files:**

- Create: `src/agent/experts/prompt_resolver.ts`
- Create: `src/agent/experts/prompt_resolver.test.ts`
- Create: `src/agent/experts/observability.ts`
- Modify: `src/agent/experts.ts`

- [ ] **Step 1: Write failing resolver tests**

Cover exact fallback order and validation:

```typescript
test("uses matching verified cache before remote", async () => {
  const io = fakeIo({ cached: "cached prompt", remote: "remote prompt" });
  const result = await resolveExpertPrompt(manifest(), io);
  assert.deepEqual(result, {
    text: "cached prompt",
    revision: "r1",
    promptSource: "cache",
  });
  assert.equal(io.fetchCalls, 0);
});

test("falls back to inline when remote and cache fail", async () => {
  const io = fakeIo({ fetchError: new Error("offline") });
  const result = await resolveExpertPrompt(manifest({ inline: "inline prompt" }), io);
  assert.equal(result.promptSource, "inline");
  assert.equal(result.text, "inline prompt");
});

test("rejects oversized remote bodies", async () => {
  const io = fakeIo({ remote: "x".repeat(20) });
  await assert.rejects(
    resolveExpertPrompt(manifest({ maxBytes: 10, inline: undefined }), io),
    /EXPERT_PROMPT_TOO_LARGE/,
  );
});
```

Also test SHA-256 mismatch, non-text content type, absolute/escaping remote path, and atomic cache write invocation.

- [ ] **Step 2: Run the resolver test and confirm red state**

```bash
node --import tsx --test src/agent/experts/prompt_resolver.test.ts
```

Expected: module-not-found failure.

- [ ] **Step 3: Implement injected I/O contracts**

Use an injected boundary so tests never access the network or user cache:

```typescript
export interface ExpertPromptIo {
  readVerifiedCache(expertId: string, revision: string): Promise<string | null>;
  fetchTrusted(path: string, options: { timeoutMs: number; maxBytes: number }): Promise<{
    text: string;
    contentType: string;
  }>;
  writeVerifiedCache(
    expertId: string,
    revision: string,
    value: { text: string; sha256: string; fetchedAt: string },
  ): Promise<void>;
}

export interface ResolvedExpertPrompt {
  text: string;
  revision: string;
  promptSource: ExpertPromptSource;
}
```

`resolveExpertPrompt()` must validate cached text size, only accept relative catalog paths beginning with `/plugins/`, enforce `text/plain` or `text/markdown`, apply a 10-second timeout, compute SHA-256, and use inline content only after cache/remote fail.

- [ ] **Step 4: Implement production cache I/O**

Store data at:

```text
<appData>/expert_prompts/<expertId>/<revision>/prompt.md
<appData>/expert_prompts/<expertId>/<revision>/metadata.json
```

Validate `expertId` and `revision` before path construction. Write temporary sibling files and rename them into place. Build remote URLs only from the fixed existing COS base and the validated relative path.

Add a structured logger with a replaceable sink:

```typescript
export function logExpertEvent(
  event: string,
  fields: Record<string, string | number | boolean | null | undefined>,
  sink: (line: string) => void = console.info,
): void {
  sink(JSON.stringify({ event, timestamp: new Date().toISOString(), ...fields }));
}
```

Emit `expert.prompt.cache_hit`, `expert.prompt.remote_loaded`, and `expert.prompt.fallback` with expert ID, revision, prompt source, duration, result, and error code. Never pass prompt text to the logger.

- [ ] **Step 5: Replace the old prompt loader facade**

Keep `getExpertSystemPrompt(expertId)` temporarily, but implement it through the registry and resolver:

```typescript
export async function getExpertSystemPrompt(expertId: string): Promise<string> {
  const profile = await resolveExpertPromptById(expertId);
  return profile?.text ?? "";
}
```

Add the richer `resolveExpertPromptById()` export for the provider and binding service.

- [ ] **Step 6: Verify resolver behavior**

```bash
node --import tsx --test src/agent/experts/prompt_resolver.test.ts
npx tsc --project tsconfig.electron.json --noEmit
```

Expected: all resolver tests pass and type-check exits 0.

- [ ] **Step 7: Commit the resolver slice**

```bash
git add src/agent/experts.ts src/agent/experts/observability.ts src/agent/experts/prompt_resolver.ts src/agent/experts/prompt_resolver.test.ts
git commit -m "feat: resolve expert prompts with verified fallback"
```

## Task 3: Runtime profile and additive prompt assembly

**Files:**

- Create: `src/agent/experts/runtime_profile.ts`
- Create: `src/agent/experts/runtime_profile.test.ts`
- Modify: `src/agent/engine.ts`
- Modify: `src/agent/provider.ts`

- [ ] **Step 1: Write the prompt regression tests**

The test must reproduce the current defect and prove the fix:

```typescript
test("expert specialization augments rather than replaces core prompt", () => {
  const prompt = assembleSystemPromptSections({
    core: "CORE_FILE_SAFETY",
    custom: "CUSTOM",
    memory: "MEMORY",
    skills: "SKILLS",
    expert: "<expert_specialization id=\"architect\">ARCH</expert_specialization>",
    mode: "MODE_PLAN",
  });

  assert.match(prompt, /CORE_FILE_SAFETY/);
  assert.match(prompt, /<expert_specialization/);
  assert.ok(prompt.indexOf("CORE_FILE_SAFETY") < prompt.indexOf("<expert_specialization"));
  assert.ok(prompt.indexOf("<expert_specialization") < prompt.indexOf("MODE_PLAN"));
});

test("runtime profile filters unavailable capability hints", () => {
  const profile = buildExpertRuntimeProfile({
    manifest: manifest(),
    resolvedPrompt: resolved("ARCH"),
    availableTools: new Set(["read"]),
    availableSkills: new Set(["arch-design"]),
  });
  assert.deepEqual(profile.preferredTools, ["read"]);
  assert.deepEqual(profile.bundledSkills, ["arch-design"]);
  assert.match(profile.addon, /cannot override system safety/);
});
```

- [ ] **Step 2: Run the tests and confirm red state**

```bash
node --import tsx --test src/agent/experts/runtime_profile.test.ts
```

Expected: failure because `expertAddon` and the runtime profile do not exist.

- [ ] **Step 3: Implement `ExpertRuntimeProfile`**

Export:

```typescript
export interface ExpertRuntimeProfile extends ExpertBinding {
  promptSource: ExpertPromptSource;
  preferredTools: string[];
  bundledSkills: string[];
  addon: string;
}
```

Escape XML attribute values, strip ASCII control characters except newline/tab, bound the final expert block to 128 KiB, and include the fixed boundary statement that expert instructions cannot override system safety, permissions, selected tools, workspace boundaries, or user intent.

The generated block must contain, in order: resolved role prompt, `behavior_guidelines`, filtered `capability_hints`, optional `output_policy`, optional `risk_notes`, then `expert_boundaries`. Empty optional sections are omitted. Capability filtering only removes unknown names; it never installs or enables anything.

- [ ] **Step 4: Add `expertAddon` to prompt assembly**

Change the engine contract to:

```typescript
export function buildSystemPrompt(options: {
  sessionId?: string;
  basePrompt?: string;
  expertAddon?: string;
  modeAddon?: string;
} = {}): string
```

Extract and export this pure seam so section ordering can be tested without requiring the installed Skills directory:

```typescript
export function assembleSystemPromptSections(sections: {
  core: string;
  custom: string;
  memory: string;
  skills: string;
  expert: string;
  mode: string;
}): string {
  return sections.core + sections.custom + sections.memory + sections.skills +
    sections.expert + sections.mode;
}
```

Return sections in this order:

```typescript
return (options.basePrompt ?? systemPromptForPlatform(currentPlatform)) +
  customPromptSection +
  loadMemoryPrompt(options.sessionId) +
  loadSkillsPrompt() +
  (options.expertAddon ?? "") +
  (options.modeAddon ?? "");
```

- [ ] **Step 5: Load the runtime profile in the provider**

Replace `initialSystemPrompt`/`basePrompt: expertPrompt` with an `expertAddon` captured for the session entry. Creator context must remain an independent addon and must not be concatenated into expert text. The `buildPrompt` callback must call:

```typescript
buildSystemPrompt({
  sessionId,
  expertAddon: entry?.expertAddon ?? initialExpertAddon,
  modeAddon: `${creatorAddon}${entry?.modeAddon ?? ""}`,
})
```

Add `expertAddon` to `SessionEntry` so future profile reloads have an explicit location.

- [ ] **Step 6: Verify the regression**

```bash
node --import tsx --test src/agent/experts/runtime_profile.test.ts
npx tsc --project tsconfig.electron.json --noEmit
```

Expected: tests and type-check pass; the resulting prompt contains both core and expert sections exactly once.

- [ ] **Step 7: Commit the prompt slice**

```bash
git add src/agent/experts/runtime_profile.ts src/agent/experts/runtime_profile.test.ts src/agent/engine.ts src/agent/provider.ts
git commit -m "fix: append expert profile to core prompt"
```

## Task 4: Persist expert revision and expose conversation state

**Files:**

- Modify: `src/infra/db.ts`
- Modify: `src/domains/session/node/store.ts`
- Create: `src/domains/session/node/expert_binding_store.ts`
- Create: `src/domains/session/node/expert_binding_store.test.ts`

- [ ] **Step 1: Write failing store tests**

Use `new DatabaseSync(":memory:")` and a focused injected store. Prove that reads expose nullable expert fields and copying a binding preserves all values:

```typescript
test("copy inherits expert binding and revision", () => {
  const db = createExpertBindingTestDb();
  const store = createExpertBindingStore(db);
  const source = seedConversation(db, {
    expertId: "software-company",
    expertRevision: "r1",
    expertCatalogSource: "catalog",
  });
  const fork = seedConversation(db, {});
  store.copy(source.id, fork.id);
  const row = store.get(fork.id);
  assert.equal(row.expertId, "software-company");
  assert.equal(row.expertRevision, "r1");
  assert.equal(row.expertCatalogSource, "catalog");
});
```

- [ ] **Step 2: Run the store test and confirm red state**

```bash
node --import tsx --test src/domains/session/node/expert_binding_store.test.ts
```

Expected: module-not-found failure.

- [ ] **Step 3: Add idempotent migrations**

Add:

```typescript
addColumn("conversations", "expert_revision", "TEXT");
addColumn("conversations", "expert_catalog_source", "TEXT");
```

Do not rebuild or destructively migrate existing conversation rows.

- [ ] **Step 4: Extend the conversation model and queries**

Add nullable `expertId`, `expertRevision`, and `expertCatalogSource` to `Conversation`. Select them in `listConversations`, expose a focused `getConversation(id)`, and add:

```typescript
export function setConversationExpert(
  id: string,
  binding: ExpertBinding | null,
): void;
```

Implement `createExpertBindingStore(db)` with `get`, `set`, and `copy`; the default exported helpers delegate to `getDb()`. The setter must update all three columns together and throw when `changes !== 1`.

- [ ] **Step 5: Preserve binding on fork**

After `createConversation`, call the focused binding store's `copy(srcId, newId)`. Also preserve the source model and workspace values already selected by the fork query. Do not infer expert state from `category`.

- [ ] **Step 6: Verify persistence**

```bash
node --import tsx --test src/domains/session/node/expert_binding_store.test.ts
npx tsc --project tsconfig.electron.json --noEmit
```

Expected: tests and type-check pass.

- [ ] **Step 7: Commit the persistence slice**

```bash
git add src/infra/db.ts src/domains/session/node/store.ts src/domains/session/node/expert_binding_store.ts src/domains/session/node/expert_binding_store.test.ts
git commit -m "feat: persist expert session revision"
```

## Task 5: Safe provider profile reload

**Files:**

- Modify: `src/agent/provider.ts`
- Create: `src/agent/provider_profile_reload.test.ts`

- [ ] **Step 1: Write failing lifecycle tests**

Extract the cache/generation decision into a small exported test seam if direct `LocalPiProvider` construction would require real models. Cover:

```typescript
test("profile reload keeps listeners and allows lazy recreation", async () => {
  const fixture = createProviderFixture({ idle: true });
  const unsubscribe = await fixture.provider.onEvent("s1", fixture.listener);
  await fixture.provider.reloadProfile("s1");
  assert.equal(fixture.hasSession("s1"), false);
  assert.equal(fixture.hasListener("s1", fixture.listener), true);
  assert.equal(fixture.isDisposed("s1"), false);
  unsubscribe();
});

test("profile reload rejects queued or initializing sessions", async () => {
  const fixture = createProviderFixture({ queued: true });
  await assert.rejects(fixture.provider.reloadProfile("s1"), /EXPERT_SWITCH_BUSY/);
});
```

- [ ] **Step 2: Run the lifecycle test and confirm red state**

```bash
node --import tsx --test src/agent/provider_profile_reload.test.ts
```

Expected: `reloadProfile` is missing.

- [ ] **Step 3: Extend the provider contract**

Add:

```typescript
reloadProfile(sessionId: string): Promise<void>;
```

Do not implement this by calling `dispose()`, because `dispose()` permanently inserts the ID into `disposedSessions` and deletes listeners.

- [ ] **Step 4: Implement idle-only reload**

`reloadProfile` must:

1. Reject when initialization or a prompt queue exists.
2. Increment `sessionGenerations`.
3. Abort/wait only for an existing idle harness.
4. Remove `sessions[sessionId]` without clearing `sessionListeners`.
5. Leave `disposedSessions`, SQLite messages, and Core JSONL untouched.
6. Let the next prompt call `createSession()` and reload the DB binding.

Use a typed error code `EXPERT_SWITCH_BUSY` for races detected inside the provider.
Emit `expert.runtime.reloaded` after invalidation and `expert.runtime.reload_failed` on failure; fields must not include prompt content.

- [ ] **Step 5: Verify lifecycle behavior**

```bash
node --import tsx --test src/agent/provider_profile_reload.test.ts
npx tsc --project tsconfig.electron.json --noEmit
```

Expected: lifecycle tests and type-check pass.

- [ ] **Step 6: Commit the provider slice**

```bash
git add src/agent/provider.ts src/agent/provider_profile_reload.test.ts
git commit -m "feat: reload idle expert session profiles"
```

## Task 6: Binding service and structured errors

**Files:**

- Create: `src/agent/experts/binding_service.ts`
- Create: `src/agent/experts/binding_service.test.ts`
- Modify: `application.electron.ts`

- [ ] **Step 1: Write failing service tests**

Inject registry, resolver, store, and runtime dependencies. Test missing conversation, missing expert, running conversation, unavailable prompt, successful assignment, clear, and compensation after reload failure:

```typescript
test("reload failure restores the old binding", async () => {
  const fixture = bindingFixture({
    oldBinding: { expertId: "old", revision: "r0", catalogSource: "builtin" },
    reloadError: new Error("reload failed"),
  });

  await assert.rejects(
    fixture.service.assignExpert("s1", "new"),
    /EXPERT_BINDING_FAILED/,
  );
  assert.deepEqual(fixture.store.current(), fixture.oldBinding);
});

test("running conversations reject without writes", async () => {
  const fixture = bindingFixture({ status: "running" });
  await assert.rejects(
    fixture.service.assignExpert("s1", "architect"),
    /EXPERT_SWITCH_BUSY/,
  );
  assert.equal(fixture.store.writeCount, 0);
});
```

- [ ] **Step 2: Run the service test and confirm red state**

```bash
node --import tsx --test src/agent/experts/binding_service.test.ts
```

Expected: module-not-found failure.

- [ ] **Step 3: Implement typed domain errors**

```typescript
export type ExpertBindingErrorCode =
  | "INVALID_EXPERT_ID"
  | "CONVERSATION_NOT_FOUND"
  | "EXPERT_NOT_FOUND"
  | "EXPERT_SWITCH_BUSY"
  | "EXPERT_UNAVAILABLE"
  | "EXPERT_BINDING_FAILED";

export class ExpertBindingError extends Error {
  constructor(
    readonly code: ExpertBindingErrorCode,
    readonly status: 400 | 404 | 409 | 422 | 500,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
  }
}
```

- [ ] **Step 4: Implement assign and clear orchestration**

`assignExpert()` must validate conversation/expert/status, pre-resolve the prompt, save `{ expertId, revision, catalogSource }`, call `provider.reloadProfile()`, and restore the old binding on reload failure. `clearExpert()` follows the same idle check, writes `null`, reloads, and compensates on failure.

After successful assign/clear, emit `expert.binding.changed` with conversation ID, old/new expert ID, revision, and catalog source. On failure emit the same event with `result: "error"` and the typed error code; do not log the resolved prompt.

- [ ] **Step 5: Replace direct SQL in the API**

Add routes:

```text
PUT    /api/conversations/:id/expert
DELETE /api/conversations/:id/expert
GET    /api/experts/:id
```

Return `{ error, code }` for `ExpertBindingError`. Keep `POST /api/conv/:id/expert` as a compatibility adapter that calls the same service; it must no longer execute direct SQL.

- [ ] **Step 6: Verify service and API compilation**

```bash
node --import tsx --test src/agent/experts/binding_service.test.ts
npx tsc --project tsconfig.electron.json --noEmit
```

Expected: all service tests pass and type-check exits 0.

- [ ] **Step 7: Commit the binding slice**

```bash
git add src/agent/experts/binding_service.ts src/agent/experts/binding_service.test.ts application.electron.ts
git commit -m "feat: validate expert conversation bindings"
```

## Task 7: IPC and frontend data contracts

**Files:**

- Modify: `src/electron/ipc-handlers.ts`
- Modify: `src/electron/preload.cjs`
- Modify: `frontend/src/api/client.ts`
- Create: `frontend/src/types/experts.ts`
- Modify: `frontend/src/store/useStore.ts`
- Modify: `frontend/src/store/useSkillStore.ts`

- [ ] **Step 1: Extend IPC routes**

Expose and allowlist:

```text
expert.list
expert.get
expert.assign
expert.clear
```

Map assign to `PUT /api/conversations/:id/expert`, clear to `DELETE`, and get to `GET /api/experts/:id`. Keep the existing preload namespace compatible while adding `get`, `assign`, and `clear` methods.

- [ ] **Step 2: Update the API client routing table**

Replace the legacy frontend route with:

```typescript
route("PUT", "/api/conversations/:id/expert", {
  invoke: "expert.assign",
  mapReq: (_p, body, params) => ({
    sessionId: params.id,
    expertId: body?.expertId,
  }),
});
route("DELETE", "/api/conversations/:id/expert", {
  invoke: "expert.clear",
  mapReq: (_p, _body, params) => ({ sessionId: params.id }),
});
```

- [ ] **Step 3: Align frontend types**

Define `ExpertSummary` in `frontend/src/types/experts.ts`; both stores and components import it from there to avoid a circular dependency between `useStore` and `useSkillStore`. Remove `systemPrompt` from the frontend DTO. Add `categoryId`, `quickPrompts`, `catalogSource`, `revision`, and `available`. Add these fields to `Conversation`:

```typescript
expertId?: string | null;
expertRevision?: string | null;
expertCatalogSource?: "builtin" | "catalog" | null;
expert?: ExpertSummary | null;
```

- [ ] **Step 4: Add store actions**

Add to `useSkillStore`:

```typescript
assignConversationExpert(conversationId: string, expertId: string): Promise<void>;
clearConversationExpert(conversationId: string): Promise<void>;
```

Both actions call the new endpoint and then await `useStore.getState().loadConversations()`. Update `startExpertChat()` to use `PUT`; preserve its existing cleanup compensation when a newly created conversation cannot be bound.

- [ ] **Step 5: Run frontend type checks**

```bash
cd frontend
npx tsc --noEmit -p tsconfig.app.json
npm run lint
```

Expected: type-check exits 0; lint has no new errors.

- [ ] **Step 6: Commit the transport slice**

```bash
git add src/electron/ipc-handlers.ts src/electron/preload.cjs frontend/src/api/client.ts frontend/src/types/experts.ts frontend/src/store/useStore.ts frontend/src/store/useSkillStore.ts
git commit -m "feat: expose expert binding contracts"
```

## Task 8: Conversation expert control

**Files:**

- Create: `frontend/src/components/ConversationExpertControl.tsx`
- Modify: `frontend/src/components/ChatArea.tsx`
- Modify: `frontend/src/components/ChatArea.css`
- Modify: `frontend/src/components/ExpertPanel.tsx`

- [ ] **Step 1: Build a focused header control**

The component receives:

```typescript
interface ConversationExpertControlProps {
  conversation: Conversation;
  busy: boolean;
}
```

Behavior:

- Show nothing when no conversation is selected.
- With an expert, show avatar/name and an “已激活” label.
- Clicking opens a keyboard-accessible list of available experts plus “停用专家”.
- Disable changes while `busy` or conversation status is `running`/`pending`.
- Call `assignConversationExpert` or `clearConversationExpert`.
- Show the backend error message in `role="alert"`; do not optimistically change expert state before the request succeeds.

- [ ] **Step 2: Mount it in the chat header**

Place `ConversationExpertControl` after the conversation title in `ChatArea`. Preserve the existing sidebar toggle and ellipsis behavior.

- [ ] **Step 3: Add scoped styles**

Use existing CSS variables only. Include:

```css
.conversation-expert-control { position: relative; flex: 0 0 auto; }
.conversation-expert-trigger { display: inline-flex; align-items: center; gap: 6px; }
.conversation-expert-menu { position: absolute; right: 0; top: calc(100% + 8px); z-index: 30; }
.conversation-expert-option[aria-selected="true"] { background: var(--hover); }
.conversation-expert-error { color: var(--red); }
```

Match the existing header height and narrow-window behavior. The menu must remain usable without relying on hover.

- [ ] **Step 4: Keep ExpertPanel behavior consistent**

Disable unavailable experts, keep duplicate-click protection, and surface structured backend messages. Starting a new expert chat still creates the conversation first and deletes it if binding fails.

- [ ] **Step 5: Build and lint the frontend**

```bash
cd frontend
npm run build
npm run lint
```

Expected: build exits 0; lint reports no new errors.

- [ ] **Step 6: Commit the UI slice**

```bash
git add frontend/src/components/ConversationExpertControl.tsx frontend/src/components/ChatArea.tsx frontend/src/components/ChatArea.css frontend/src/components/ExpertPanel.tsx
git commit -m "feat: show and switch conversation experts"
```

## Task 9: End-to-end verification and documentation alignment

**Files:**

- Modify only if verification exposes a defect in the scoped files above.
- Review: `docs/18-专家系统架构设计.md`

- [ ] **Step 1: Run all focused expert tests**

```bash
node --import tsx --test \
  src/agent/experts/registry.test.ts \
  src/agent/experts/prompt_resolver.test.ts \
  src/agent/experts/runtime_profile.test.ts \
  src/agent/experts/binding_service.test.ts \
  src/agent/provider_profile_reload.test.ts \
  src/domains/session/node/expert_binding_store.test.ts
```

Expected: all tests pass with zero failures.

- [ ] **Step 2: Run complete static verification**

```bash
npx tsc --project tsconfig.electron.json --noEmit
cd frontend && npx tsc --noEmit -p tsconfig.app.json
cd frontend && npm run build
cd frontend && npm run lint
git diff --check
```

Expected: all commands exit 0. Existing lint warnings may remain, but no new warning may originate from the expert-system files.

- [ ] **Step 3: Run API integration smoke checks**

With an authenticated local application session, verify:

1. `GET /api/experts` never returns `prompt` or `systemPrompt`.
2. Assigning an unknown expert returns `404 EXPERT_NOT_FOUND` and leaves the conversation unchanged.
3. Assigning a valid expert returns its revision/catalog source.
4. Clearing the expert returns the conversation to nullable expert fields.
5. A running conversation returns `409 EXPERT_SWITCH_BUSY`.

- [ ] **Step 4: Run UI smoke checks**

Verify these flows in both light and dark themes:

1. Expert Center → 召唤 → new conversation shows the expert badge.
2. First message retains core tool/Visualizer rules and uses the expert specialization.
3. Switch an idle conversation; the next turn uses the new expert.
4. Reload the app; the same expert is restored.
5. Clear the expert; the next turn has no `<expert_specialization>`.
6. Fork a conversation; the branch inherits expert ID and revision.

- [ ] **Step 5: Check architecture conformance**

Confirm each acceptance criterion in `docs/18-专家系统架构设计.md` section 20. If implementation intentionally differs, update the document with the actual final contract before claiming completion.

- [ ] **Step 6: Commit final verification fixes**

If verification required changes:

```bash
git add src/agent/experts src/agent/experts.ts src/agent/engine.ts src/agent/provider.ts \
  src/infra/db.ts src/domains/session/node/store.ts \
  application.electron.ts src/electron/ipc-handlers.ts src/electron/preload.cjs \
  frontend/src/api/client.ts frontend/src/store/useStore.ts frontend/src/store/useSkillStore.ts \
  frontend/src/components/ConversationExpertControl.tsx \
  frontend/src/components/ChatArea.tsx frontend/src/components/ChatArea.css \
  frontend/src/components/ExpertPanel.tsx docs/18-专家系统架构设计.md
git commit -m "fix: close expert runtime verification gaps"
```

If no changes were required, do not create an empty commit.
