# Built-in Markdown HTML Preview Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Markdown artifact clicks render a complete, safe HTML preview inside the existing Electron right-side panel without relying on an installed Pi plugin or opening an external browser.

**Architecture:** Keep the existing artifact extension routing and `MdPreview` entry point. Add a core Markdown renderer in the Electron/backend side that converts Markdown to sanitized HTML, rewrites approved local image resources, and preserves Mermaid/math/code markers for browser-side enhancement. The frontend requests that HTML, displays it in the existing panel, and runs only the isolated Mermaid enhancement; failures fall back to the current `react-markdown` renderer.

**Tech Stack:** TypeScript, unified/remark/rehype, `remark-gfm`, `remark-math`, `remark-frontmatter`, `rehype-katex`, `rehype-sanitize`, `rehype-stringify`, existing React preview panel, existing `/api/preview` file access.

---

## File map

- Create: `src/domains/preview/node/markdown.ts` — server-side Markdown-to-safe-HTML pipeline and resource rewriting.
- Create: `src/domains/preview/node/markdown.test.ts` — renderer, extensions, security, and resource-path tests.
- Modify: `application.electron.ts` — register the Markdown HTML preview API route and return normalized errors.
- Modify: `frontend/src/components/previews/MdPreview.tsx` — request HTML, render it in the panel, enhance Mermaid, and retain fallback.
- Modify: `frontend/src/components/PreviewPanel.css` — styles for generated HTML, code, math, Mermaid, anchors, and images.
- Modify: `frontend/package.json` — add browser-side Mermaid dependency if not already available.
- Modify: root `package.json` — add backend Markdown pipeline dependencies.
- Modify: `frontend/src/utils/markdownPreview.ts` — small pure helpers for response validation and Mermaid block selection.
- Create: `frontend/src/utils/markdownPreview.test.ts` — frontend response/helper tests.

### Task 1: Add the Markdown rendering dependencies

**Files:**
- Modify: `package.json`
- Modify: `frontend/package.json`

- [ ] **Step 1: Add only the packages required by the agreed pipeline.**

Add the unified parser/transformer packages to the root runtime dependencies: `unified`, `remark-parse`, `remark-gfm`, `remark-math`, `remark-frontmatter`, `remark-rehype`, `rehype-raw`, `rehype-katex`, `rehype-sanitize`, `rehype-slug`, and `rehype-stringify`. Add `mermaid` to the frontend dependencies for in-panel diagram enhancement. Reuse the existing frontend syntax-highlighter dependency rather than adding a second highlighter.

- [ ] **Step 2: Install and verify dependency resolution.**

Run:

```bash
npm install
cd frontend && npm install
```

Expected: both package manifests and lockfiles resolve without peer-dependency errors.

- [ ] **Step 3: Commit the dependency change.**

```bash
git add package.json package-lock.json frontend/package.json frontend/package-lock.json
git commit -m "feat: add built-in markdown html renderer dependencies"
```

## Task 2: Build the backend Markdown-to-HTML pipeline test-first

**Files:**
- Create: `src/domains/preview/node/markdown.test.ts`
- Create: `src/domains/preview/node/markdown.ts`

- [ ] **Step 1: Write failing tests for the public renderer contract.**

Define a pure `renderMarkdownPreview(markdown, options)` contract returning `{ html, title?, resourceRoot }`. Test these behaviors:

```ts
test("renders CommonMark and GFM as HTML", async () => {
  const result = await renderMarkdownPreview(
    "# Title\n\n- [x] done\n\n| A | B |\n|---|---|\n| 1 | 2 |",
    { sourcePath: "/workspace/report.md" },
  );
  assert.match(result.html, /<h1[^>]*id="title"[^>]*>Title<\\/h1>/);
  assert.match(result.html, /type="checkbox"/);
  assert.match(result.html, /<table>/);
});

test("keeps math and Mermaid blocks addressable for browser enhancement", async () => {
  const result = await renderMarkdownPreview(
    "Inline $x^2$\n\n```mermaid\nflowchart LR\nA-->B\n```",
    { sourcePath: "/workspace/report.md" },
  );
  assert.match(result.html, /katex|math/);
  assert.match(result.html, /language-mermaid/);
});

test("sanitizes executable HTML and dangerous links", async () => {
  const result = await renderMarkdownPreview(
    '<script>alert(1)</script>\n\n<a href="javascript:alert(1)">bad</a>',
    { sourcePath: "/workspace/report.md" },
  );
  assert.doesNotMatch(result.html, /<script|javascript:/i);
});

test("rewrites relative images through the approved file route", async () => {
  const result = await renderMarkdownPreview(
    "![chart](images/chart.png)",
    { sourcePath: "/workspace/report.md" },
  );
  assert.match(result.html, /\\/api\\/file\\?path=/);
  assert.match(result.html, /chart\.png/);
});
```

- [ ] **Step 2: Run the focused test and verify it fails for the missing module.**

Run:

```bash
npx tsx --test src/domains/preview/node/markdown.test.ts
```

Expected: FAIL because `markdown.ts` and `renderMarkdownPreview` do not exist yet.

- [ ] **Step 3: Implement the minimal renderer.**

Build a unified pipeline with `remarkParse`, `remarkGfm`, `remarkMath`, and `remarkFrontmatter`; convert through `remarkRehype` with raw HTML enabled; sanitize using an explicit schema that permits normal Markdown tags, safe links, checkbox inputs, KaTeX classes, and Mermaid code classes; add heading IDs with `rehypeSlug`; stringify with `rehypeStringify`.

Before serialization, rewrite only image `src` values that are relative to `sourcePath` into `/api/file?path=<encoded absolute path>`. Reject `..` paths that escape the allowed source directory. Do not rewrite remote `http(s)`, `data`, or `file:` images into unrestricted file access.

- [ ] **Step 4: Run the focused tests and make them pass.**

Run:

```bash
npx tsx --test src/domains/preview/node/markdown.test.ts
```

Expected: PASS for CommonMark/GFM, math/Mermaid markers, sanitization, and relative-resource rewriting.

- [ ] **Step 5: Commit the renderer.**

```bash
git add src/domains/preview/node/markdown.ts src/domains/preview/node/markdown.test.ts
git commit -m "feat: add safe markdown to html renderer"
```

## Task 3: Expose the renderer through the existing API

**Files:**
- Modify: `application.electron.ts`
- Modify: `src/electron/ipc-handlers.ts` only if the generated frontend API route needs a new IPC mapping.

- [ ] **Step 1: Add an API contract test or pure route handler test.**

Cover a valid Markdown path, a missing path, a non-Markdown path, and a path outside the permitted artifact/workspace roots. The successful response must have:

```ts
{ ok: true, html: string, sourcePath: string }
```

The failure response must have `{ ok: false, error: string }` and must not include file contents.

- [ ] **Step 2: Add `GET /api/preview/markdown`.**

Validate and normalize `path`, verify it is a readable Markdown file, call `renderMarkdownPreview`, and return the stable response. Keep the existing `/api/preview` endpoint unchanged for other preview components and as the fallback source.

- [ ] **Step 3: Add the frontend client route.**

Register `/api/preview/markdown` in `frontend/src/api/client.ts` with the same response shape and error normalization used by existing preview calls. If the app routes all requests through IPC, register the corresponding `file.previewMarkdown` handler in `src/electron/ipc-handlers.ts`.

- [ ] **Step 4: Run the backend/API tests and typecheck.**

Run:

```bash
npx tsx --test src/domains/preview/node/markdown.test.ts
npx tsc --project tsconfig.electron.json --noEmit
```

Expected: PASS with no new TypeScript errors.

- [ ] **Step 5: Commit the API integration.**

```bash
git add application.electron.ts src/electron/ipc-handlers.ts frontend/src/api/client.ts
git commit -m "feat: expose built-in markdown html preview api"
```

## Task 4: Render the generated HTML inside the existing panel

**Files:**
- Create: `frontend/src/utils/markdownPreview.ts`
- Create: `frontend/src/utils/markdownPreview.test.ts`
- Modify: `frontend/src/components/previews/MdPreview.tsx`
- Modify: `frontend/src/components/PreviewPanel.css`

- [ ] **Step 1: Write failing frontend helper tests.**

Test response validation and Mermaid block discovery:

```ts
test("accepts only successful HTML preview responses", () => {
  assert.deepEqual(parseMarkdownPreviewResponse({ ok: true, html: "<h1>x</h1>" }), {
    html: "<h1>x</h1>",
  });
  assert.throws(() => parseMarkdownPreviewResponse({ ok: true, html: 1 }));
  assert.throws(() => parseMarkdownPreviewResponse({ ok: false, error: "failed" }));
});
```

- [ ] **Step 2: Run the helper test and verify the expected failure.**

Run:

```bash
npx tsx --test frontend/src/utils/markdownPreview.test.ts
```

Expected: FAIL because the helper module does not exist.

- [ ] **Step 3: Implement `MdPreview` with plugin-free HTML-first rendering.**

On `filePath` change, request `/api/preview/markdown?path=...`. While loading, show the existing loading state. For a successful response, render the sanitized HTML in the Markdown preview container. Use a ref and Mermaid’s browser API to find `language-mermaid` blocks and replace only those blocks with SVG; catch Mermaid failures per block and leave the original code block visible. Load KaTeX CSS and retain the existing theme classes.

If the HTML endpoint fails, request the existing `/api/preview` endpoint and render the returned text through the current `ReactMarkdown` + `remarkGfm` fallback. Keep cancellation guards so switching artifacts cannot update an unmounted or stale preview.

- [ ] **Step 4: Add styles for generated HTML.**

Reuse current Markdown styles and add selectors for generated headings, anchors, tables, task-list inputs, code blocks, KaTeX, Mermaid SVG containers, images, and dark mode. Ensure the generated HTML remains scrollable within `.preview-body` and does not escape the resizable artifact panel.

- [ ] **Step 5: Run frontend helper tests and build.**

Run:

```bash
npx tsx --test frontend/src/utils/markdownPreview.test.ts frontend/src/utils/artifactPresentation.test.ts
cd frontend && npm run build
```

Expected: PASS and a successful Vite/TypeScript build.

- [ ] **Step 6: Commit the panel integration.**

```bash
git add frontend/src/utils/markdownPreview.ts frontend/src/utils/markdownPreview.test.ts frontend/src/components/previews/MdPreview.tsx frontend/src/components/PreviewPanel.css
git commit -m "feat: render markdown html in artifact preview panel"
```

## Task 5: Add regression coverage and verify the end-to-end behavior

**Files:**
- Modify: `frontend/src/utils/artifactPresentation.test.ts` only if a missing routing case is discovered.
- Add or update the existing web-app test location used by the repository for right-panel interactions.

- [ ] **Step 1: Add an interaction regression test.**

Open a `present_files` Markdown artifact, click it, and assert that the right panel requests `/api/preview/markdown`, displays the generated heading, and does not open a browser window. Mock the API only at the network boundary; do not mock `MdPreview` itself.

- [ ] **Step 2: Add renderer regression fixtures.**

Use one fixture containing nested lists, tables, task lists, footnotes, Mermaid, LaTeX, code, relative images, and unsafe HTML. Assert that all supported constructs render or safely degrade without preventing the rest of the document from displaying.

- [ ] **Step 3: Run the complete verification set.**

Run:

```bash
npx tsx --test src/domains/preview/node/markdown.test.ts frontend/src/utils/markdownPreview.test.ts frontend/src/utils/artifactPresentation.test.ts
npx tsc --project tsconfig.electron.json --noEmit
cd frontend && npm run build
git diff --check
```

Expected: all tests pass, the Electron typecheck passes, the frontend builds, and `git diff --check` has no output.

- [ ] **Step 4: Manually verify the acceptance checklist.**

Verify `.md` and `.markdown` files open inside the existing right panel; Mermaid and math failure are isolated; relative images load only from approved paths; PDF/DOCX/table/PPTX/image/video previews remain unchanged; no external browser opens.

- [ ] **Step 5: Commit the completed feature.**

```bash
git add src/domains/preview application.electron.ts src/electron/ipc-handlers.ts frontend/src/api/client.ts frontend/src/components/previews/MdPreview.tsx frontend/src/components/PreviewPanel.css frontend/src/utils/markdownPreview.ts frontend/src/utils/markdownPreview.test.ts package.json package-lock.json frontend/package.json frontend/package-lock.json
git commit -m "feat: make markdown html preview a built-in capability"
```
