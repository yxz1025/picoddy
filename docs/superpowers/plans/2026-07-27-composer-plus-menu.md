# Composer Plus Menu Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement a WorkBuddy-style Composer “＋” menu with cross-platform native file selection, persistent attachments, and working mode, expert, skill, and MCP connector actions.

**Architecture:** Keep menu presentation in a focused React component, keep pending-message state in Composer, and reuse the existing application and skill stores. Add a small attachment domain service that owns validation, disk storage, SQLite metadata, message association, and model-context extraction; HTTP handlers remain thin adapters.

**Tech Stack:** React 19, TypeScript 6, Zustand, Deno 2, `node:sqlite`, existing `readDoc`, CSS, Playwright.

**Repository note:** This workspace has no `.git` metadata, so commit steps are documented as checkpoints but cannot be executed until the directory is placed in a Git repository.

---

## File Map

**Create**

- `src/domains/attachment/node/store.ts` — attachment persistence and message association.
- `src/domains/attachment/node/service.ts` — upload validation, private-file storage, deletion, and document-context extraction.
- `src/domains/attachment/node/service_test.ts` — backend attachment regression tests.
- `frontend/src/api/attachments.ts` — multipart upload and attachment deletion client.
- `frontend/src/components/composerMenuModel.ts` — pure menu/type/formatting logic.
- `frontend/src/components/composerMenuModel_test.ts` — Deno-testable frontend model tests.
- `frontend/src/components/ComposerPlusMenu.tsx` — accessible root menu and submenus.
- `frontend/src/components/ComposerPlusMenu.css` — WorkBuddy-like menu and attachment-chip styling.
- `scripts/test_composer_plus_menu.py` — Playwright interaction and screenshot verification.

**Modify**

- `src/infra/db.ts` — attachment tables and indexes.
- `src/domains/session/node/store.ts` — message creation returns ID and message reads include attachment metadata.
- `main.ts` — attachment endpoints and prompt attachment/connector processing.
- `frontend/src/store/useStore.ts` — attachment message type, richer send payload, and ExpertPanel tab routing.
- `frontend/src/store/useSkillStore.ts` — use existing expert/skill/MCP loaders from Composer menu.
- `frontend/src/components/Composer.tsx` — menu integration, pending tags, uploads, and send payload.
- `frontend/src/components/ChatArea.tsx` — historical user-message attachment chips.
- `frontend/src/components/ExpertPanel.tsx` — consume requested tab from global store.

---

### Task 1: Attachment Database and Store

**Files:**

- Modify: `src/infra/db.ts`
- Create: `src/domains/attachment/node/store.ts`
- Test: `src/domains/attachment/node/service_test.ts`

- [ ] **Step 1: Write the failing persistence test**

Create a temporary `HOME`, dynamically import the database and attachment store, insert an attachment, associate it with a message, and assert ordered metadata:

```ts
Deno.test("attachment metadata persists and associates with a message", async () => {
  const oldHome = Deno.env.get("HOME");
  const home = await Deno.makeTempDir({ prefix: "pi-a-attachment-" });
  Deno.env.set("HOME", home);
  try {
    const { getDb, closeDb } = await import("../../../infra/db.ts");
    const store = await import("./store.ts");
    const db = getDb();
    const now = Date.now();
    db.prepare(
      "INSERT INTO conversations (id,title,category,status,created_at,updated_at) VALUES (?,?,?,?,?,?)",
    ).run("c1", "test", "assistant", "idle", now, now);
    db.prepare(
      "INSERT INTO messages (id,conversation_id,role,content,created_at) VALUES (?,?,?,?,?)",
    ).run("m1", "c1", "user", "analyze", now);

    store.insertAttachment({
      id: "a1",
      name: "report.xlsx",
      filePath: `${home}/report.xlsx`,
      mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      extension: "xlsx",
      size: 42,
    });
    store.attachToMessage("m1", ["a1"]);

    const rows = store.listMessageAttachments("m1");
    if (rows.length !== 1 || rows[0].name !== "report.xlsx") {
      throw new Error(`unexpected attachments: ${JSON.stringify(rows)}`);
    }
    closeDb();
  } finally {
    oldHome === undefined ? Deno.env.delete("HOME") : Deno.env.set("HOME", oldHome);
    await Deno.remove(home, { recursive: true });
  }
});
```

- [ ] **Step 2: Run the test and verify RED**

Run:

```bash
/Users/xiaozhongyuan/.deno/bin/deno test \
  --allow-read --allow-write --allow-env --allow-sys \
  src/domains/attachment/node/service_test.ts
```

Expected: FAIL because the attachment tables/store do not exist.

- [ ] **Step 3: Add attachment tables**

Add to `initDb()`:

```sql
CREATE TABLE IF NOT EXISTS attachments (
  id TEXT PRIMARY KEY,
  original_name TEXT NOT NULL,
  file_path TEXT NOT NULL,
  mime_type TEXT NOT NULL DEFAULT '',
  extension TEXT NOT NULL DEFAULT '',
  size INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS message_attachments (
  message_id TEXT NOT NULL,
  attachment_id TEXT NOT NULL,
  position INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (message_id, attachment_id),
  FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE CASCADE,
  FOREIGN KEY (attachment_id) REFERENCES attachments(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_message_attachments_message
  ON message_attachments(message_id, position);
```

- [ ] **Step 4: Implement the focused store**

Export these exact functions:

```ts
export interface AttachmentRecord {
  id: string;
  name: string;
  filePath: string;
  mimeType: string;
  extension: string;
  size: number;
}

export function insertAttachment(record: AttachmentRecord): void;
export function getAttachment(id: string): AttachmentRecord | undefined;
export function attachToMessage(messageId: string, attachmentIds: string[]): void;
export function listMessageAttachments(messageId: string): AttachmentRecord[];
export function isAttachmentLinked(id: string): boolean;
export function deleteAttachmentRecord(id: string): void;
```

Use parameterized SQL only. Preserve caller order with `position`.

- [ ] **Step 5: Run the test and verify GREEN**

Run the Step 2 command. Expected: `1 passed | 0 failed`.

- [ ] **Step 6: Record checkpoint**

Checkpoint: “attachment schema and persistence store”.

---

### Task 2: Secure Upload and Context Service

**Files:**

- Create: `src/domains/attachment/node/service.ts`
- Modify: `src/domains/attachment/node/service_test.ts`

- [ ] **Step 1: Add failing tests for validation and storage**

Cover:

```ts
Deno.test("saveUploadedFiles stores allowed files under the private attachment root", async () => {
  const result = await saveUploadedFiles([
    new File(["# Skill"], "SKILL.md", { type: "text/markdown" }),
  ]);
  if (result[0].name !== "SKILL.md" || result[0].extension !== "md") {
    throw new Error(JSON.stringify(result));
  }
  if (!result[0].filePath.includes("/.pi-a/attachments/")) {
    throw new Error("file escaped attachment root");
  }
});

Deno.test("saveUploadedFiles rejects unsupported and oversized files", async () => {
  await assertRejects(() => saveUploadedFiles([new File(["x"], "payload.exe")]));
  const large = new File([new Uint8Array(25 * 1024 * 1024 + 1)], "large.txt");
  await assertRejects(() => saveUploadedFiles([large]));
});
```

Use a local `assertRejects` helper to avoid adding test dependencies.

- [ ] **Step 2: Run tests and verify RED**

Expected: FAIL because `saveUploadedFiles` is absent.

- [ ] **Step 3: Implement validation constants and upload**

Export:

```ts
export const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;
export const MAX_ATTACHMENTS_PER_MESSAGE = 10;
export const ALLOWED_ATTACHMENT_EXTENSIONS = new Set([
  "pdf", "docx", "xlsx", "csv", "pptx", "txt", "md", "markdown", "json",
  "ts", "tsx", "js", "jsx", "py", "java", "go", "rs", "c", "cpp", "h",
  "css", "html", "xml", "yaml", "yml", "toml", "sql", "sh",
]);

export async function saveUploadedFiles(files: File[]): Promise<AttachmentRecord[]>;
export async function deleteUnlinkedAttachment(id: string): Promise<boolean>;
export async function buildAttachmentContext(ids: string[]): Promise<string>;
```

Rules:

- Reject zero files and more than 10 files.
- Extract extension from the final suffix and lowercase it.
- Reject names containing NUL and extensions outside the allowlist.
- Generate UUID directory and sanitize display filename with `basename`.
- Write beneath `~/.pi-a/attachments`.
- Insert metadata only after a successful file write.
- On database failure, remove the just-written file.
- `buildAttachmentContext` calls `readDoc`; throw when `kind === "error"`.
- Wrap each document in `<referenced_file name="..." attachment_id="...">`.

- [ ] **Step 4: Run backend attachment tests**

Expected: all service tests pass.

- [ ] **Step 5: Record checkpoint**

Checkpoint: “secure attachment upload and document context”.

---

### Task 3: HTTP Endpoints and Message Association

**Files:**

- Modify: `src/domains/session/node/store.ts`
- Modify: `main.ts`
- Test: `src/domains/attachment/node/service_test.ts`

- [ ] **Step 1: Write the failing message-read regression test**

Create a message with two linked attachments, call the session store’s `getMessages("c1")`, and assert:

```ts
if (messages[0].attachments?.map((a) => a.name).join(",") !== "one.md,two.csv") {
  throw new Error("message attachments were not returned in order");
}
```

- [ ] **Step 2: Run the test and verify RED**

Expected: FAIL because messages do not expose attachments.

- [ ] **Step 3: Return message IDs and attachment metadata**

Change `appendMessage` to return its generated message ID. Extend the returned message DTO with:

```ts
attachments: Array<{
  id: string;
  name: string;
  size: number;
  mimeType: string;
  extension: string;
}>;
```

Populate attachments through `listMessageAttachments(messageId)`.

- [ ] **Step 4: Add thin attachment routes**

In `handleApi`:

```ts
if (path === "/api/attachments" && req.method === "POST") {
  const form = await req.formData();
  const files = form.getAll("files").filter((v): v is File => v instanceof File);
  const attachments = await saveUploadedFiles(files);
  return json({ attachments: attachments.map(toPublicAttachment) });
}

if (path.startsWith("/api/attachments/") && req.method === "DELETE") {
  const id = decodeURIComponent(path.split("/")[3] || "");
  const deleted = await deleteUnlinkedAttachment(id);
  return json({ ok: deleted });
}
```

Return status `400` for validation failures and `409` when an attachment is already linked.

- [ ] **Step 5: Extend `/api/prompt`**

Before `appendMessage`:

```ts
const attachmentIds = Array.isArray(b.attachmentIds)
  ? b.attachmentIds.filter((id: unknown): id is string => typeof id === "string")
  : [];
if (attachmentIds.length > MAX_ATTACHMENTS_PER_MESSAGE) {
  return jsonError("单条消息最多添加 10 个附件", 400);
}
const attachmentContext = await buildAttachmentContext(attachmentIds);
```

Then:

```ts
const messageId = appendMessage(b.sessionId, "user", b.text);
attachToMessage(messageId, attachmentIds);
const connectorContext = b.preferredConnector
  ? `\n<preferred_connector name="${escapeXml(String(b.preferredConnector))}">本次任务优先使用该连接器提供的 MCP 工具。</preferred_connector>\n`
  : "";
processedText = `${attachmentContext}${connectorContext}${processedText}`;
```

Do not store generated XML in the user-visible message content.

- [ ] **Step 6: Run tests and Deno type-check**

Run:

```bash
/Users/xiaozhongyuan/.deno/bin/deno test --allow-read --allow-write --allow-env --allow-sys src/domains/attachment/node/service_test.ts
/Users/xiaozhongyuan/.deno/bin/deno check main.ts src/domains/session/node/store.ts
```

Expected: tests pass and both modules check successfully.

- [ ] **Step 7: Record checkpoint**

Checkpoint: “attachment HTTP and conversation persistence”.

---

### Task 4: Frontend Attachment Client and Pure Menu Model

**Files:**

- Create: `frontend/src/api/attachments.ts`
- Create: `frontend/src/components/composerMenuModel.ts`
- Create: `frontend/src/components/composerMenuModel_test.ts`
- Modify: `frontend/src/store/useStore.ts`

- [ ] **Step 1: Write failing pure-model tests**

Test:

```ts
Deno.test("buildComposerMessage prefixes skill without changing visible text", () => {
  const payload = buildComposerPayload({
    text: "分析销售趋势",
    skillName: "data-analysis",
    connectorName: "excel-mcp",
    attachmentIds: ["a1"],
  });
  if (payload.text !== "/data-analysis 分析销售趋势") throw new Error(payload.text);
  if (payload.preferredConnector !== "excel-mcp") throw new Error("connector missing");
  if (payload.attachmentIds[0] !== "a1") throw new Error("attachment missing");
});

Deno.test("validateSelectedFiles enforces count and size", () => {
  const error = validateSelectedFiles(
    Array.from({ length: 11 }, (_, i) => new File(["x"], `${i}.txt`)),
    [],
  );
  if (!error?.includes("10")) throw new Error(String(error));
});
```

- [ ] **Step 2: Run tests and verify RED**

Run:

```bash
/Users/xiaozhongyuan/.deno/bin/deno test frontend/src/components/composerMenuModel_test.ts
```

Expected: FAIL because the model module is absent.

- [ ] **Step 3: Implement pure types and functions**

Export:

```ts
export interface PublicAttachment {
  id: string;
  name: string;
  size: number;
  mimeType: string;
  extension: string;
}

export function buildComposerPayload(input: {
  text: string;
  skillName?: string;
  connectorName?: string;
  attachmentIds: string[];
}): {
  text: string;
  attachmentIds: string[];
  preferredConnector?: string;
};

export function validateSelectedFiles(files: File[], existing: PublicAttachment[]): string | null;
export function formatFileSize(bytes: number): string;
export function fileTypeLabel(extension: string): string;
```

- [ ] **Step 4: Add multipart client**

Implement:

```ts
export async function uploadAttachments(files: File[]): Promise<PublicAttachment[]> {
  const form = new FormData();
  files.forEach((file) => form.append("files", file));
  const response = await fetch("/api/attachments", { method: "POST", body: form });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "附件上传失败");
  return data.attachments;
}

export async function deletePendingAttachment(id: string): Promise<void>;
```

- [ ] **Step 5: Extend Store payload and Message**

Add `attachments?: PublicAttachment[]` to `Message`. Change `sendMessage` to accept:

```ts
sendMessage: (
  text: string,
  options?: { attachmentIds?: string[]; preferredConnector?: string },
) => Promise<void>;
```

Pass those fields to `/api/prompt`.

- [ ] **Step 6: Run pure tests and frontend build**

Expected: model tests pass; `npm run build` succeeds.

- [ ] **Step 7: Record checkpoint**

Checkpoint: “frontend attachment client and composer payload”.

---

### Task 5: Accessible WorkBuddy-Style Multi-Level Menu

**Files:**

- Create: `frontend/src/components/ComposerPlusMenu.tsx`
- Create: `frontend/src/components/ComposerPlusMenu.css`
- Modify: `frontend/src/components/Composer.tsx`

- [ ] **Step 1: Add a failing Playwright smoke assertion**

Create the first version of `scripts/test_composer_plus_menu.py` and assert:

```py
plus = page.get_by_role("button", name="添加内容")
plus.click()
menu = page.get_by_role("menu", name="添加内容")
assert menu.is_visible()
assert menu.get_by_text("添加文件").is_visible()
assert menu.get_by_text("模式").is_visible()
assert menu.get_by_text("专家").is_visible()
assert menu.get_by_text("技能").is_visible()
assert menu.get_by_text("连接器").is_visible()
```

- [ ] **Step 2: Run the browser test and verify RED**

Use the webapp-testing server helper after running `--help`. Expected: FAIL because the “＋” button has no behavior.

- [ ] **Step 3: Implement `ComposerPlusMenu`**

Props:

```ts
interface ComposerPlusMenuProps {
  mode: RunMode;
  experts: Expert[];
  skills: SkillMeta[];
  mcpConfig: McpConfig | null;
  connected: McpConnectionInfo[];
  loading: boolean;
  onFilesSelected(files: File[]): void;
  onModeSelected(mode: RunMode): void;
  onExpertSelected(expert: Expert): void;
  onSkillSelected(skill: SkillMeta): void;
  onConnectorSelected(connector: McpConnectionInfo): void;
  onOpenConnectorManager(): void;
}
```

Requirements:

- Root button label: `aria-label="添加内容"`.
- Root menu: `role="menu" aria-label="添加内容"`.
- Submenus: `role="menu"` and descriptive labels.
- Hidden multiple file input is triggered only from “添加文件”.
- Root item icons: `Paperclip`, `Feather`, `Badge`, `Hammer`, `Link2`.
- Chevron appears on all items except “添加文件”.
- Root menu width 220 px; rows 44 px; submenu min/max 260/340 px.
- Reposition submenu based on `getBoundingClientRect()` and viewport width.
- Close on outside pointerdown and Escape.

- [ ] **Step 4: Integrate dynamic loaders**

When the root menu first opens, call:

```ts
void Promise.all([loadSkills(), loadExperts(), loadMcp()]);
```

Filter disabled skills before passing them to the submenu.

- [ ] **Step 5: Run the Playwright smoke assertion**

Expected: root menu assertion passes.

- [ ] **Step 6: Record checkpoint**

Checkpoint: “accessible multi-level plus menu”.

---

### Task 6: Composer Tags, Upload Flow, and Actions

**Files:**

- Modify: `frontend/src/components/Composer.tsx`
- Modify: `frontend/src/components/ComposerPlusMenu.css`
- Modify: `frontend/src/store/useStore.ts`
- Modify: `frontend/src/components/ExpertPanel.tsx`

- [ ] **Step 1: Extend Playwright test with attachment and skill assertions**

Use `set_input_files` on the hidden input:

```py
page.locator('input[type="file"]').set_input_files({
    "name": "SKILL.md",
    "mimeType": "text/markdown",
    "buffer": b"# Test Skill",
})
assert page.get_by_text("SKILL.md").is_visible()
```

Then open Skill submenu, select `data-analysis`, and assert the `/data-analysis` chip.

- [ ] **Step 2: Run and verify RED**

Expected: FAIL because tags and upload state are not connected.

- [ ] **Step 3: Implement pending attachment state**

In Composer:

```ts
const [attachments, setAttachments] = useState<PublicAttachment[]>([]);
const [uploading, setUploading] = useState(false);
const [attachmentError, setAttachmentError] = useState<string | null>(null);
const [activeConnector, setActiveConnector] = useState<McpConnectionInfo | null>(null);
```

On file selection:

1. Run `validateSelectedFiles`.
2. Set `uploading`.
3. Call `uploadAttachments`.
4. Append returned metadata.
5. Render error text on failure.
6. Always clear uploading.

On tag delete, call `deletePendingAttachment(id)` and remove the tag only after success.

- [ ] **Step 4: Implement send behavior**

Build payload with `buildComposerPayload`, then:

```ts
await sendMessage(payload.text, {
  attachmentIds: payload.attachmentIds,
  preferredConnector: payload.preferredConnector,
});
setAttachments([]);
setActiveSkillTag(null);
setActiveConnector(null);
```

Disable send while uploading. Permit attachment-only messages by using a visible fallback text such as `请分析附件内容` only in the request payload, while keeping the visible message content empty plus attachment chips.

- [ ] **Step 5: Wire mode, expert, skill, and connector actions**

- Mode calls `setMode`.
- Expert awaits `startExpertChat(expert.id, expert.name)`.
- Skill sets `ActiveSkillTag` from dynamic metadata.
- Connected MCP sets `activeConnector`.
- Unconnected/disabled MCP sets global `expertPanelTab = "connector"` and `activeCategory = "expert"`.

Add to `useStore`:

```ts
expertPanelTab: "expert" | "skill" | "connector";
setExpertPanelTab(tab: "expert" | "skill" | "connector"): void;
```

Initialize ExpertPanel local state from the store value and react to subsequent changes.

- [ ] **Step 6: Run Playwright interaction test**

Expected: attachment and skill chips appear; selecting an expert creates and selects a new conversation; connector routing opens the connector tab.

- [ ] **Step 7: Record checkpoint**

Checkpoint: “composer tags and all five menu actions”.

---

### Task 7: Historical Attachment Rendering

**Files:**

- Modify: `frontend/src/components/ChatArea.tsx`
- Modify: `frontend/src/components/ComposerPlusMenu.css`
- Test: `scripts/test_composer_plus_menu.py`

- [ ] **Step 1: Add failing history assertion**

After sending a message with `SKILL.md`, reload/select the conversation and assert a read-only attachment chip with the same filename remains visible.

- [ ] **Step 2: Run and verify RED**

Expected: FAIL because ChatArea ignores message attachments.

- [ ] **Step 3: Render message attachments**

For user messages with `attachments?.length`, render:

```tsx
<div className="message-attachment-list">
  {message.attachments.map((attachment) => (
    <div className="message-attachment-chip" key={attachment.id}>
      <FileText size={14} />
      <span>{attachment.name}</span>
      <small>{formatFileSize(attachment.size)}</small>
    </div>
  ))}
</div>
```

Do not expose server paths or attachment IDs in visible UI.

- [ ] **Step 4: Run history assertion**

Expected: attachment remains visible after conversation reload.

- [ ] **Step 5: Record checkpoint**

Checkpoint: “attachment conversation history”.

---

### Task 8: Full Verification and Visual QA

**Files:**

- Modify as required by discovered defects only.
- Test: all new test files and existing build/check commands.

- [ ] **Step 1: Run all backend and pure frontend tests**

```bash
/Users/xiaozhongyuan/.deno/bin/deno test \
  --allow-read --allow-write --allow-env --allow-sys \
  src/domains/attachment/node/service_test.ts \
  frontend/src/components/composerMenuModel_test.ts \
  src/agent/models_init_default_test.ts \
  src/agent/models_test.ts
```

Expected: zero failed tests.

- [ ] **Step 2: Run static verification**

```bash
/Users/xiaozhongyuan/.deno/bin/deno check main.ts src/agent/sidecar.ts
cd frontend && npm run build && npm run lint
```

Expected: all commands exit `0`.

- [ ] **Step 3: Run Playwright end-to-end flow**

Verify:

- Root and all submenus.
- Escape and outside-click dismissal.
- Attachment upload and deletion.
- Dynamic skill selection.
- Mode selection.
- Expert new-conversation action.
- Connected and unconnected MCP behavior.
- Attachment send and historical reload.

- [ ] **Step 4: Capture light and dark screenshots**

Save temporary screenshots under `/tmp/pi-a-plus-menu-light.png` and `/tmp/pi-a-plus-menu-dark.png`. Inspect them for clipping, overlap, insufficient contrast, and incorrect submenu direction.

- [ ] **Step 5: Run cleanup checks**

```bash
rg -n '\\[DEBUG-' main.ts src frontend/src
```

Expected: no diagnostic instrumentation.

- [ ] **Step 6: Record final checkpoint**

Checkpoint: “verified Composer plus menu and attachment system”.
