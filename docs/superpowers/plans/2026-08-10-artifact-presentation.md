# WorkBuddy-style Artifact Presentation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 `present_files` 结果呈现为按文件类型区分、可点击并统一进入右侧预览的 WorkBuddy-style 卡片，同时保证多批次和历史重载稳定。

**Architecture:** 新增无 React 依赖的文件类型适配器，将 `PresentedFile` 归一化为 `ArtifactViewModel`，由聊天卡片与右侧预览共同消费。每条 `present_files` 工具消息独立持有交付批次；全局 `presentedFiles` 仅表示右侧面板当前批次。

**Tech Stack:** Electron 43、React 19、TypeScript 6、Zustand 5、Vite 8、lucide-react、Node.js `node:test`、`tsx`.

---

## 实施前约束

- 设计基线：`docs/17-交付物展示设计.md`。
- 当前工作区已有未提交的 `ChatArea.tsx`、`ChatArea.css`、`ArtifactPanel.tsx`、`PreviewPanel.tsx`、`useStore.ts` 等改动。编辑前逐文件执行 `git diff -- <file>`，在现有改动上工作，禁止覆盖或回退。
- 遵循 `CLAUDE.md`：修改时不加载 `superpowers/using-superpowers`；不用 Express；如新增 IPC，必须同步 `client.ts`、`preload.cjs`、`ipc-handlers.ts`。
- 先复用已有 `/api/file?path=...` 提供图片和视频源，不预防性新增主进程协议。若视频实际不支持 Range/MIME，则降级为系统应用打开。

## 文件边界

**Create**

- `frontend/src/utils/artifactPresentation.ts`：协议类型、批次解析、文件分类、预览路由。
- `frontend/src/utils/artifactPresentation.test.ts`：纯逻辑单元测试。
- `frontend/src/components/ArtifactCard.tsx`：单个类型化交付卡片。
- `frontend/src/components/PresentFilesBatch.tsx`：交付批次容器。
- `frontend/src/components/PresentFilesBatch.css`：卡片类型色调、缩略图、响应式。
- `frontend/src/components/previews/TextPreview.tsx`：代码、数据、TXT 原样预览。
- `frontend/src/components/previews/VideoPreview.tsx`：本地视频预览。

**Modify**

- `frontend/src/store/useStore.ts`：消息级批次与当前预览批次。
- `frontend/src/components/ChatArea.tsx`：接入批次组件，移除全局回退。
- `frontend/src/components/ChatArea.css`：移除迁出的交付卡片旧样式。
- `frontend/src/components/ArtifactPanel.tsx`：仅消费当前交付批次。
- `frontend/src/components/PreviewPanel.tsx`：统一 renderer 路由。
- `frontend/src/components/PreviewPanel.css`：文本与视频样式。
- `frontend/src/components/previews/UnsupportedPreview.tsx`：统一降级提示。

---

### Task 1: 建立统一文件类型适配器

**Files:**

- Create: `frontend/src/utils/artifactPresentation.ts`
- Create: `frontend/src/utils/artifactPresentation.test.ts`

- [ ] **Step 1: 先写失败测试**

```ts
import assert from "node:assert/strict";
import test from "node:test";
import {
  deliveryBatchFromContent,
  deliveryBatchFromOutput,
  normalizePresentedFile,
} from "./artifactPresentation.ts";

test("normalizes supported artifacts", () => {
  assert.equal(normalizePresentedFile({ path: "/tmp/report.PDF" }).kind, "document");
  assert.equal(normalizePresentedFile({ path: "C:\\work\\sales.xlsx" }).kind, "spreadsheet");
  assert.equal(normalizePresentedFile({ path: "/tmp/deck.pptx" }).renderer, "presentation");
  assert.equal(
    normalizePresentedFile({ path: "/tmp/chart.png" }).thumbnailUrl,
    "/api/file?path=%2Ftmp%2Fchart.png",
  );
  assert.equal(normalizePresentedFile({ url: "https://example.com/report?q=1" }).kind, "web");
});

test("uses title, filename, then host as display name", () => {
  assert.equal(normalizePresentedFile({ path: "/tmp/a.pdf", title: "月报" }).displayName, "月报");
  assert.equal(normalizePresentedFile({ path: "/tmp/a.pdf" }).displayName, "a.pdf");
  assert.equal(normalizePresentedFile({ url: "https://example.com/" }).displayName, "example.com");
});

test("routes unknown files to external fallback", () => {
  const model = normalizePresentedFile({ path: "/tmp/archive.bin" });
  assert.equal(model.kind, "unknown");
  assert.equal(model.renderer, "unsupported");
  assert.equal(model.previewMode, "external-fallback");
});

test("parses live and persisted batches identically", () => {
  const output = {
    content: [{ type: "text", text: "已交付" }],
    details: {
      files: [{ path: "/tmp/report.pdf" }],
      explanation: "报告已生成",
      problems: ["chart.png 不存在"],
    },
  };
  assert.deepEqual(deliveryBatchFromContent(JSON.stringify(output)), deliveryBatchFromOutput(output));
});
```

- [ ] **Step 2: 运行测试确认红灯**

Run:

```bash
npx tsx --test frontend/src/utils/artifactPresentation.test.ts
```

Expected: FAIL，提示找不到 `artifactPresentation.ts`。

- [ ] **Step 3: 实现最小适配器**

```ts
export interface PresentedFile {
  path?: string;
  url?: string;
  title?: string;
  type?: string;
  icon?: string;
  size?: string;
  exists?: boolean;
}

export interface DeliveryBatch {
  files: PresentedFile[];
  explanation?: string;
  problems: string[];
}

export interface PreviewTarget extends PresentedFile {
  toolName?: string;
}

export type ArtifactKind =
  | "web" | "image" | "document" | "spreadsheet" | "presentation"
  | "video" | "code" | "data" | "text" | "unknown";

export type PreviewRenderer =
  | "browser" | "image" | "pdf" | "docx" | "table"
  | "presentation" | "markdown" | "text" | "video" | "unsupported";

export interface ArtifactViewModel {
  key: string;
  source: PresentedFile;
  kind: ArtifactKind;
  displayName: string;
  typeLabel: string;
  extension: string;
  sizeLabel?: string;
  tone: ArtifactKind;
  renderer: PreviewRenderer;
  previewMode: "internal" | "external-fallback";
  previewTarget: PreviewTarget;
  thumbnailUrl?: string;
}

const GROUPS = {
  image: ["png", "jpg", "jpeg", "gif", "svg", "webp"],
  document: ["pdf", "docx"],
  spreadsheet: ["xlsx", "xls", "csv", "tsv"],
  presentation: ["pptx", "ppt"],
  video: ["mp4", "mov", "webm"],
  code: ["py", "js", "ts", "tsx", "jsx", "go", "rs", "java", "c", "cpp", "css", "sh"],
  data: ["json", "yaml", "yml", "xml"],
  text: ["md", "txt"],
} as const;

function extensionOf(value: string): string {
  const clean = value.split(/[?#]/, 1)[0];
  const name = clean.split(/[\\/]/).pop() ?? "";
  return name.includes(".") ? name.split(".").pop()!.toLowerCase() : "";
}

function classify(extension: string, isUrl: boolean): ArtifactKind {
  if (isUrl) return "web";
  for (const [kind, extensions] of Object.entries(GROUPS)) {
    if ((extensions as readonly string[]).includes(extension)) return kind as ArtifactKind;
  }
  return "unknown";
}

function rendererFor(kind: ArtifactKind, extension: string): PreviewRenderer {
  if (kind === "web") return "browser";
  if (kind === "image") return "image";
  if (extension === "pdf") return "pdf";
  if (extension === "docx") return "docx";
  if (kind === "spreadsheet" && ["xlsx", "csv", "tsv"].includes(extension)) return "table";
  if (kind === "presentation" && extension === "pptx") return "presentation";
  if (kind === "video") return "video";
  if (extension === "md") return "markdown";
  if (kind === "text" || kind === "code" || kind === "data") return "text";
  return "unsupported";
}

export function normalizePresentedFile(file: PresentedFile): ArtifactViewModel {
  const raw = file.path || file.url || "";
  const isUrl = Boolean(file.url);
  const extension = isUrl ? "" : extensionOf(raw || file.type || "");
  const kind = classify(extension, isUrl);
  const renderer = rendererFor(kind, extension);
  const displayName = file.title
    || (file.path ? file.path.split(/[\\/]/).pop() : undefined)
    || (file.url ? new URL(file.url).host : "")
    || "未命名交付物";
  return {
    key: `${file.path || file.url || displayName}:${file.title || ""}`,
    source: file,
    kind,
    displayName,
    typeLabel: kind === "web" ? "网页" : (extension ? extension.toUpperCase() : "文件"),
    extension,
    sizeLabel: file.size,
    tone: kind,
    renderer,
    previewMode: renderer === "unsupported" ? "external-fallback" : "internal",
    previewTarget: { ...file },
    thumbnailUrl: kind === "image" && file.path
      ? `/api/file?path=${encodeURIComponent(file.path)}`
      : undefined,
  };
}

export function normalizePresentedFiles(files: PresentedFile[]): ArtifactViewModel[] {
  return files.map(normalizePresentedFile);
}

function batchFromUnknown(value: unknown): DeliveryBatch | null {
  if (!value || typeof value !== "object") return null;
  const details = (value as { details?: unknown }).details;
  if (!details || typeof details !== "object") return null;
  const raw = details as { files?: unknown; explanation?: unknown; problems?: unknown };
  if (!Array.isArray(raw.files) || raw.files.length === 0) return null;
  return {
    files: raw.files.filter((file): file is PresentedFile => Boolean(file && typeof file === "object")),
    explanation: typeof raw.explanation === "string" ? raw.explanation : undefined,
    problems: Array.isArray(raw.problems)
      ? raw.problems.filter((item): item is string => typeof item === "string")
      : [],
  };
}

export function deliveryBatchFromOutput(output: unknown): DeliveryBatch | null {
  return batchFromUnknown(output);
}

export function deliveryBatchFromContent(content: string): DeliveryBatch | null {
  try {
    return batchFromUnknown(JSON.parse(content));
  } catch {
    return null;
  }
}
```

- [ ] **Step 4: 运行测试确认绿灯**

Run:

```bash
npx tsx --test frontend/src/utils/artifactPresentation.test.ts
```

Expected: 4 tests passed，0 failed。

- [ ] **Step 5: 提交**

```bash
git add frontend/src/utils/artifactPresentation.ts frontend/src/utils/artifactPresentation.test.ts
git commit -m "feat: add artifact presentation model"
```

---

### Task 2: 将交付批次绑定到工具消息

**Files:**

- Modify: `frontend/src/store/useStore.ts`
- Modify: `frontend/src/utils/artifactPresentation.test.ts`

- [ ] **Step 1: 增加多批次隔离测试**

```ts
test("keeps separate outputs as separate batches", () => {
  const first = deliveryBatchFromOutput({ details: { files: [{ path: "/tmp/first.pdf" }] } });
  const second = deliveryBatchFromOutput({ details: { files: [{ path: "/tmp/second.png" }] } });
  assert.equal(first?.files[0].path, "/tmp/first.pdf");
  assert.equal(second?.files[0].path, "/tmp/second.png");
  assert.notDeepEqual(first, second);
});
```

- [ ] **Step 2: 运行测试建立协议基线**

Run: `npx tsx --test frontend/src/utils/artifactPresentation.test.ts`

Expected: 5 tests passed。

- [ ] **Step 3: 在 store 使用统一类型**

在 `useStore.ts` 顶部加入：

```ts
import {
  deliveryBatchFromOutput,
  type DeliveryBatch,
  type PresentedFile,
  type PreviewTarget,
} from "../utils/artifactPresentation";

export type { DeliveryBatch, PresentedFile, PreviewTarget } from "../utils/artifactPresentation";
```

删除原 `PresentedFile`、`PreviewTarget`，给 `Message` 增加：

```ts
deliveryBatch?: DeliveryBatch;
```

- [ ] **Step 4: 扩展预览打开签名**

```ts
openPreview: (
  target: string | PreviewTarget,
  toolName?: string,
  batchFiles?: PresentedFile[],
) => void;
```

实现：

```ts
openPreview: (target, toolName, batchFiles) => {
  const previewFile: PreviewTarget = typeof target === "string"
    ? { path: target, toolName }
    : { ...target, toolName: target.toolName ?? toolName };
  set({
    previewFile,
    ...(batchFiles ? { presentedFiles: batchFiles } : {}),
    showArtifacts: true,
    panelMode: "preview" as const,
  });
},
```

- [ ] **Step 5: 在 `tool_execution_end` 写入消息级批次**

在 `outputStr` 后计算：

```ts
const deliveryBatch = !ev.isError && ev.toolName === "present_files"
  ? deliveryBatchFromOutput(ev.output)
  : null;
```

工具消息 map 分支加入：

```ts
deliveryBatch: deliveryBatch ?? undefined,
```

原 `present_files` patch 改为：

```ts
if (deliveryBatch) {
  const first = deliveryBatch.files[0];
  patch.presentedFiles = deliveryBatch.files;
  patch.previewFile = { ...first, toolName: "present_files" };
  patch.showArtifacts = true;
  patch.panelMode = "preview";
}
```

- [ ] **Step 6: 验证并提交**

Run:

```bash
npx tsx --test frontend/src/utils/artifactPresentation.test.ts
cd frontend && npx tsc -b --pretty false
```

Expected: 5 tests passed；TypeScript exit 0。

```bash
git add frontend/src/store/useStore.ts frontend/src/utils/artifactPresentation.test.ts
git commit -m "fix: bind delivered files to tool messages"
```

---

### Task 3: 实现类型化卡片与批次容器

**Files:**

- Create: `frontend/src/components/ArtifactCard.tsx`
- Create: `frontend/src/components/PresentFilesBatch.tsx`
- Create: `frontend/src/components/PresentFilesBatch.css`
- Modify: `frontend/src/components/ChatArea.tsx`
- Modify: `frontend/src/components/ChatArea.css`

- [ ] **Step 1: 增加卡片模型测试**

```ts
test("provides visible card labels and tones", () => {
  const model = normalizePresentedFile({ path: "/tmp/sales.xlsx", size: "12 KB" });
  assert.equal(model.typeLabel, "XLSX");
  assert.equal(model.tone, "spreadsheet");
  assert.equal(model.sizeLabel, "12 KB");
  assert.equal(model.previewTarget.path, "/tmp/sales.xlsx");
});
```

Run: `npx tsx --test frontend/src/utils/artifactPresentation.test.ts`

Expected: 6 tests passed。

- [ ] **Step 2: 创建 `ArtifactCard.tsx`**

实现以下明确结构：

```tsx
<article className={`artifact-card artifact-card--${artifact.tone}`}>
  <button type="button" className="artifact-card-main" onClick={() => onOpen(artifact)}>
    <span className="artifact-card-visual" aria-hidden="true">
      {artifact.thumbnailUrl && !thumbnailFailed
        ? <img src={artifact.thumbnailUrl} alt="" onError={() => setThumbnailFailed(true)} />
        : <TypeIcon size={22} />}
    </span>
    <span className="artifact-card-copy">
      <strong title={artifact.displayName}>{artifact.displayName}</strong>
      <span>{artifact.typeLabel}{artifact.sizeLabel ? ` · ${artifact.sizeLabel}` : ""}</span>
    </span>
  </button>
  {artifact.source.path && (
    <button
      type="button"
      className="artifact-card-folder"
      onClick={() => onShowInFolder(artifact.source.path!)}
      aria-label={`在文件夹中显示 ${artifact.displayName}`}
    >
      <FolderOpen size={14} />
    </button>
  )}
</article>
```

`TypeIcon` 使用 lucide-react 映射：web→`Globe2`、image→`ImageIcon`、document/text→`FileText`、spreadsheet→`FileSpreadsheet`、presentation→`Presentation`、video→`Video`、code→`Code2`、data→`Database`、unknown→`Paperclip`。

- [ ] **Step 3: 创建 `PresentFilesBatch.tsx`**

```tsx
export default function PresentFilesBatch({ batch, onOpen, onShowInFolder }: Props) {
  const artifacts = normalizePresentedFiles(batch.files);
  return (
    <section className="present-files-section" aria-label="交付物">
      <header className="present-files-header">
        <strong>交付物</strong>
        <span>{artifacts.length} 项</span>
      </header>
      {batch.explanation && <p className="present-files-explanation">{batch.explanation}</p>}
      {batch.problems.length > 0 && (
        <div className="present-files-warning" role="status">
          {batch.problems.map((problem) => <div key={problem}>{problem}</div>)}
        </div>
      )}
      <div className="present-files-grid">
        {artifacts.map((artifact) => (
          <ArtifactCard
            key={artifact.key}
            artifact={artifact}
            onOpen={onOpen}
            onShowInFolder={onShowInFolder}
          />
        ))}
      </div>
    </section>
  );
}
```

- [ ] **Step 4: 创建卡片 CSS**

至少包含以下规则：

```css
.present-files-section { width: calc(100% - 40px); margin: 4px 0 8px 40px; }
.present-files-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(210px, 1fr)); gap: 8px; margin-top: 8px; }
.artifact-card { display: flex; min-width: 0; border: 1px solid var(--border-soft); border-radius: 11px; background: var(--bg-subtle); overflow: hidden; }
.artifact-card-main { display: flex; flex: 1; min-width: 0; align-items: center; gap: 10px; padding: 10px; border: 0; background: transparent; color: inherit; text-align: left; cursor: pointer; }
.artifact-card-main:focus-visible, .artifact-card-folder:focus-visible { outline: 2px solid var(--accent); outline-offset: -2px; }
.artifact-card-visual { width: 38px; height: 38px; display: grid; place-items: center; flex: none; border-radius: 8px; color: var(--artifact-tone); overflow: hidden; }
.artifact-card-visual img { width: 100%; height: 100%; object-fit: cover; }
.artifact-card-copy { display: flex; flex-direction: column; min-width: 0; gap: 3px; }
.artifact-card-copy strong { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.artifact-card--web { --artifact-tone: #4b83e6; }
.artifact-card--image { --artifact-tone: #9a62d6; }
.artifact-card--document, .artifact-card--text { --artifact-tone: #4c78d0; }
.artifact-card--spreadsheet { --artifact-tone: #2f9b62; }
.artifact-card--presentation { --artifact-tone: #d8793b; }
.artifact-card--video { --artifact-tone: #cf4f78; }
.artifact-card--code, .artifact-card--data { --artifact-tone: #6f7785; }
.artifact-card--unknown { --artifact-tone: #858585; }
@media (max-width: 760px) { .present-files-grid { grid-template-columns: 1fr; } }
```

- [ ] **Step 5: 在 `ChatArea` 接入消息自己的批次**

```tsx
function PresentFilesCards({ message }: { message: Message }) {
  const { openPreview } = useStore();
  const batch = message.deliveryBatch
    ?? (message.content ? deliveryBatchFromContent(message.content) : null);
  if (!batch) return null;
  return (
    <PresentFilesBatch
      batch={batch}
      onOpen={(artifact) =>
        openPreview(artifact.previewTarget, "present_files", batch.files)}
      onShowInFolder={showItemInFolder}
    />
  );
}
```

删除原 `parsePresentedFiles()` 和内联卡片；从 `ChatArea.css` 仅删除旧 `.present-files-*`、`.present-file-*` 区块，保留当前 widget 未提交改动。

- [ ] **Step 6: 验证并提交**

Run:

```bash
npx tsx --test frontend/src/utils/artifactPresentation.test.ts
cd frontend && npm run build
```

Expected: 6 tests passed；frontend build exit 0。

```bash
git add frontend/src/components/ArtifactCard.tsx frontend/src/components/PresentFilesBatch.tsx frontend/src/components/PresentFilesBatch.css frontend/src/components/ChatArea.tsx frontend/src/components/ChatArea.css frontend/src/utils/artifactPresentation.test.ts
git commit -m "feat: render typed artifact cards in chat"
```

---

### Task 4: 收口当前批次与首项打开行为

**Files:**

- Modify: `frontend/src/components/ArtifactPanel.tsx`
- Modify: `frontend/src/components/ChatArea.tsx`
- Modify: `frontend/src/store/useStore.ts`

- [ ] **Step 1: 定位重复自动预览**

Run:

```bash
rg -n "Agent 生成文件时自动打开|toolName === \"present_files\"|presentedFiles" frontend/src/components/ChatArea.tsx frontend/src/store/useStore.ts
```

Expected: 找到 `ChatArea` 通用消息扫描 effect 和 store 的 `present_files` 分支。

- [ ] **Step 2: 删除 `ChatArea` 通用消息扫描 effect**

完整删除注释为“Agent 生成文件时自动打开预览面板”的 `useEffect`。自动打开只由 `tool_execution_end` 的 `present_files` 分支负责。

- [ ] **Step 3: 让 `ArtifactPanel` 只消费当前批次**

```ts
const previewFiles: PreviewFile[] = (presentedFiles ?? []).map((file) => ({
  ...file,
  toolName: "present_files",
}));

const activePreviewFile = previewFile && previewFiles.some((file) =>
  (file.path && file.path === previewFile.path)
  || (file.url && file.url === previewFile.url)
)
  ? previewFile
  : previewFiles[0] ?? null;
```

删除扫描全部工具消息及正则猜测文件路径的 fallback。

- [ ] **Step 4: 保持历史加载不自动弹面板**

`selectConversation` 继续清空 `presentedFiles`，加载历史消息后不自动恢复右栏。用户点击历史卡片时，Task 3 的 `openPreview(..., batch.files)` 恢复对应批次。

- [ ] **Step 5: 验证并提交**

Run: `cd frontend && npx tsc -b --pretty false && npm run build`

Expected: TypeScript、Vite exit 0。

```bash
git add frontend/src/components/ArtifactPanel.tsx frontend/src/components/ChatArea.tsx frontend/src/store/useStore.ts
git commit -m "fix: scope artifact preview to delivery batches"
```

---

### Task 5: 统一右侧预览路由

**Files:**

- Create: `frontend/src/components/previews/TextPreview.tsx`
- Create: `frontend/src/components/previews/VideoPreview.tsx`
- Modify: `frontend/src/components/PreviewPanel.tsx`
- Modify: `frontend/src/components/PreviewPanel.css`
- Modify: `frontend/src/components/previews/UnsupportedPreview.tsx`
- Modify: `frontend/src/utils/artifactPresentation.test.ts`

- [ ] **Step 1: 增加 renderer 路由测试**

```ts
test("routes text, data, video and unsupported formats", () => {
  assert.equal(normalizePresentedFile({ path: "/tmp/main.ts" }).renderer, "text");
  assert.equal(normalizePresentedFile({ path: "/tmp/data.json" }).renderer, "text");
  assert.equal(normalizePresentedFile({ path: "/tmp/readme.md" }).renderer, "markdown");
  assert.equal(normalizePresentedFile({ path: "/tmp/demo.mp4" }).renderer, "video");
  assert.equal(normalizePresentedFile({ path: "/tmp/legacy.ppt" }).renderer, "unsupported");
});
```

Run: `npx tsx --test frontend/src/utils/artifactPresentation.test.ts`

Expected: 7 tests passed。

- [ ] **Step 2: 创建原始文本预览**

```tsx
export default function TextPreview({ filePath }: { filePath: string }) {
  const [state, setState] = useState<{ loading: boolean; text?: string; error?: string }>({ loading: true });
  useEffect(() => {
    let cancelled = false;
    setState({ loading: true });
    fetch(`/api/preview?path=${encodeURIComponent(filePath)}`)
      .then((response) => response.json())
      .then((data) => {
        if (!cancelled) setState(data.error
          ? { loading: false, error: data.error }
          : { loading: false, text: data.text ?? "" });
      })
      .catch((error: Error) => {
        if (!cancelled) setState({ loading: false, error: error.message });
      });
    return () => { cancelled = true; };
  }, [filePath]);
  if (state.loading) return <div className="preview-loading">加载中...</div>;
  if (state.error) return <div className="preview-error">预览失败: {state.error}</div>;
  return <pre className="preview-plain-text">{state.text}</pre>;
}
```

文件顶部导入 `useEffect`、`useState`。

- [ ] **Step 3: 创建视频预览**

```tsx
export default function VideoPreview({ filePath }: { filePath: string }) {
  return (
    <div className="preview-video">
      <video controls preload="metadata" src={`/api/file?path=${encodeURIComponent(filePath)}`}>
        当前格式无法在应用内播放。
      </video>
    </div>
  );
}
```

- [ ] **Step 4: 让 `PreviewPanel` 使用统一 renderer**

`PreviewFile` 改为：

```ts
export interface PreviewFile extends PresentedFile {
  toolName?: string;
}
```

删除本地 `extOf()`、`selectRenderer()`，使用 `const artifact = normalizePresentedFile(activeFile)`，在 `preview-body` 中显式分支：

```tsx
{artifact.renderer === "browser" && <BrowserPreview filePath={activeFile.path} url={activeFile.url} />}
{artifact.renderer === "image" && <ImagePreview filePath={activeFile.path ?? ""} />}
{artifact.renderer === "pdf" && <PdfPreview filePath={activeFile.path ?? ""} />}
{artifact.renderer === "docx" && <DocxPreview filePath={activeFile.path ?? ""} />}
{artifact.renderer === "table" && <TablePreview filePath={activeFile.path ?? ""} />}
{artifact.renderer === "presentation" && <PptxPreview filePath={activeFile.path ?? ""} />}
{artifact.renderer === "markdown" && <MdPreview filePath={activeFile.path ?? ""} />}
{artifact.renderer === "text" && <TextPreview filePath={activeFile.path ?? ""} />}
{artifact.renderer === "video" && <VideoPreview filePath={activeFile.path ?? ""} />}
{artifact.renderer === "unsupported" && (
  <UnsupportedPreview filePath={activeFile.path ?? ""} typeLabel={artifact.typeLabel} />
)}
```

列表 key 使用 `normalizePresentedFile(file).key`，名称使用 `displayName`。

- [ ] **Step 5: 收口 UnsupportedPreview**

Props 改为：

```ts
interface UnsupportedPreviewProps {
  filePath: string;
  typeLabel: string;
}
```

显示：

```tsx
<div className="preview-unsupported-ext">
  {typeLabel} · 暂不支持内置预览
</div>
```

保留已有“用默认应用打开”和“复制路径”。

- [ ] **Step 6: 增加文本、视频样式**

```css
.preview-plain-text {
  box-sizing: border-box;
  width: 100%;
  min-height: 100%;
  margin: 0;
  padding: 18px;
  overflow: auto;
  color: var(--text-1);
  background: var(--bg);
  font: 12px/1.6 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  white-space: pre;
}
.preview-video { width: 100%; height: 100%; display: grid; place-items: center; background: #111; }
.preview-video video { width: 100%; max-height: 100%; object-fit: contain; }
```

- [ ] **Step 7: 验证并提交**

Run:

```bash
npx tsx --test frontend/src/utils/artifactPresentation.test.ts
cd frontend && npm run build
```

Expected: 7 tests passed；frontend build exit 0。

```bash
git add frontend/src/components/PreviewPanel.tsx frontend/src/components/PreviewPanel.css frontend/src/components/previews/TextPreview.tsx frontend/src/components/previews/VideoPreview.tsx frontend/src/components/previews/UnsupportedPreview.tsx frontend/src/utils/artifactPresentation.test.ts
git commit -m "feat: route artifacts to typed previews"
```

---

### Task 6: 端到端验证与交付

**Files:**

- Modify only if verification exposes a defect: files listed in Tasks 1–5

- [ ] **Step 1: 运行完整静态验证**

```bash
npx tsx --test frontend/src/utils/artifactPresentation.test.ts
npx tsc --project tsconfig.electron.json --noEmit
cd frontend && npm run lint && npm run build
```

Expected:

- 7 tests passed，0 failed。
- Electron TypeScript exit 0。
- oxlint 0 errors。
- frontend build exit 0。

- [ ] **Step 2: 启动应用**

Terminal 1:

```bash
cd frontend && npm run dev
```

Terminal 2:

```bash
npm run electron:dev
```

- [ ] **Step 3: 验证单批次类型展示**

让 Agent 一次 `present_files` 交付 HTML/URL、PNG、PDF、DOCX、XLSX、PPTX、TS、JSON、MP4 和未知扩展名文件。

Expected:

- 卡片顺序与参数数组一致，首项自动打开。
- 图片显示缩略图；其余显示类型图标、标签、名称与大小。
- 点击每项都在右侧打开对应预览。
- 未支持格式显示系统应用降级。
- 部分无效文件只产生批次警告，不影响有效卡片。

- [ ] **Step 4: 验证多批次和历史重载**

同一会话再交付一个不同文件，随后切换会话再切回。

Expected:

- 第一批卡片不变成第二批数据。
- 第二批成功时只自动打开第二批首项。
- 切回历史会话不强制弹出右栏。
- 点击历史卡片后，右栏切换到其所属批次。

- [ ] **Step 5: 验证响应式、键盘和失败降级**

Expected:

- 窄屏回落单列，无水平溢出。
- Tab 可聚焦主卡片和文件夹按钮；Enter/Space 可打开。
- 长文件名省略且可通过 title 查看完整名称。
- 缩略图失败时回落类型图标。
- 视频若因 Range/MIME 无法播放，将对应 renderer 改为 `unsupported`，保留系统打开，不扩张协议。

- [ ] **Step 6: 复查工作区和差异**

```bash
git status --short
git diff --check
git diff -- frontend/src/utils/artifactPresentation.ts frontend/src/store/useStore.ts frontend/src/components/ArtifactCard.tsx frontend/src/components/PresentFilesBatch.tsx frontend/src/components/PresentFilesBatch.css frontend/src/components/ChatArea.tsx frontend/src/components/ChatArea.css frontend/src/components/ArtifactPanel.tsx frontend/src/components/PreviewPanel.tsx frontend/src/components/PreviewPanel.css frontend/src/components/previews/TextPreview.tsx frontend/src/components/previews/VideoPreview.tsx frontend/src/components/previews/UnsupportedPreview.tsx
```

Expected: `git diff --check` exit 0；没有回退用户原有未提交改动。

- [ ] **Step 7: 仅在验证阶段产生修正时提交**

```bash
git add frontend/src
git commit -m "fix: harden artifact presentation flow"
```

若没有额外修正，跳过该提交，不创建空 commit。

---

## 最终验收清单

- [ ] `present_files` 是唯一自动打开交付预览的工具。
- [ ] 首项自动打开，数组顺序表达优先级。
- [ ] 图片、文档、表格、PPT、代码、数据、文本、视频、网页和未知格式均有明确卡片语义。
- [ ] 所有卡片点击统一进入右侧预览。
- [ ] 不支持内置预览的格式可用系统默认应用打开。
- [ ] 每条工具消息拥有独立交付批次，多批次不串数据。
- [ ] 历史重载恢复卡片，但不强制弹出预览。
- [ ] 缩略图失败、部分交付失败和未知格式均有可用降级。
- [ ] Node 单元测试、Electron TypeScript、oxlint 和 frontend build 全部通过。

