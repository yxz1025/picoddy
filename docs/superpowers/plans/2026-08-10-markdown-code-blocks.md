# Markdown Code Highlighting and Copy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render assistant fenced code blocks with language-aware Prism highlighting and an accessible copy button while keeping streaming responses lightweight.

**Architecture:** Keep `ReactMarkdown` as the parser and replace only its `pre` renderer with a focused `CodeBlock` component. Register a bounded PrismLight language set, render plain code during streaming or for unknown languages, and use project CSS variables for theme-aware token colors.

**Tech Stack:** React 19, TypeScript, react-markdown 10, react-syntax-highlighter PrismLight, lucide-react, CSS variables.

**Workspace safety:** `ChatArea.tsx`, `ChatArea.css`, and `engine.ts` already contain uncommitted work. Preserve all existing edits and do not create commits unless the user separately requests them.

---

### Task 1: Add the direct highlighting dependency

**Files:**
- Modify: `frontend/package.json`
- Modify: `frontend/package-lock.json`

- [ ] **Step 1: Install the runtime package and TypeScript declarations**

Run:

```bash
cd frontend
npm install react-syntax-highlighter
npm install --save-dev @types/react-syntax-highlighter
```

Expected: `react-syntax-highlighter` appears in `dependencies`, its type package appears in `devDependencies`, and the lockfile records both packages.

- [ ] **Step 2: Confirm dependency ownership**

Run `cd frontend && npm ls react-syntax-highlighter @types/react-syntax-highlighter`.

Expected: both packages resolve directly below `frontend`, with no reliance on `@earendil-works/pi-coding-agent`.

### Task 2: Build the focused `CodeBlock` component

**Files:**
- Create: `frontend/src/components/CodeBlock.tsx`

- [ ] **Step 1: Register only supported Prism grammars**

Import React state/timer hooks, `PrismLight`, `Copy`, `Check`, and the following modules:

```typescript
import { useEffect, useRef, useState } from "react";
import { Check, Copy } from "lucide-react";
import { PrismLight as SyntaxHighlighter } from "react-syntax-highlighter";
import bash from "react-syntax-highlighter/dist/esm/languages/prism/bash";
import css from "react-syntax-highlighter/dist/esm/languages/prism/css";
import go from "react-syntax-highlighter/dist/esm/languages/prism/go";
import java from "react-syntax-highlighter/dist/esm/languages/prism/java";
import javascript from "react-syntax-highlighter/dist/esm/languages/prism/javascript";
import json from "react-syntax-highlighter/dist/esm/languages/prism/json";
import kotlin from "react-syntax-highlighter/dist/esm/languages/prism/kotlin";
import markdown from "react-syntax-highlighter/dist/esm/languages/prism/markdown";
import python from "react-syntax-highlighter/dist/esm/languages/prism/python";
import rust from "react-syntax-highlighter/dist/esm/languages/prism/rust";
import sql from "react-syntax-highlighter/dist/esm/languages/prism/sql";
import tsx from "react-syntax-highlighter/dist/esm/languages/prism/tsx";
import typescript from "react-syntax-highlighter/dist/esm/languages/prism/typescript";
import xml from "react-syntax-highlighter/dist/esm/languages/prism/markup";
import yaml from "react-syntax-highlighter/dist/esm/languages/prism/yaml";
```

Register each canonical name exactly once:

```typescript
SyntaxHighlighter.registerLanguage("bash", bash);
SyntaxHighlighter.registerLanguage("css", css);
SyntaxHighlighter.registerLanguage("go", go);
SyntaxHighlighter.registerLanguage("java", java);
SyntaxHighlighter.registerLanguage("javascript", javascript);
SyntaxHighlighter.registerLanguage("json", json);
SyntaxHighlighter.registerLanguage("kotlin", kotlin);
SyntaxHighlighter.registerLanguage("markdown", markdown);
SyntaxHighlighter.registerLanguage("python", python);
SyntaxHighlighter.registerLanguage("rust", rust);
SyntaxHighlighter.registerLanguage("sql", sql);
SyntaxHighlighter.registerLanguage("tsx", tsx);
SyntaxHighlighter.registerLanguage("typescript", typescript);
SyntaxHighlighter.registerLanguage("xml", xml);
SyntaxHighlighter.registerLanguage("yaml", yaml);
```

- [ ] **Step 2: Normalize language aliases and labels**

Use these exact mappings:

```typescript
const LANGUAGE_ALIASES: Record<string, string> = {
  cjs: "javascript",
  html: "xml",
  js: "javascript",
  jsx: "javascript",
  kt: "kotlin",
  md: "markdown",
  py: "python",
  sh: "bash",
  shell: "bash",
  ts: "typescript",
  yml: "yaml",
};

const LANGUAGE_LABELS: Record<string, string> = {
  bash: "Bash", css: "CSS", go: "Go", java: "Java",
  javascript: "JavaScript", json: "JSON", kotlin: "Kotlin",
  markdown: "Markdown", python: "Python", rust: "Rust", sql: "SQL",
  tsx: "TSX", typescript: "TypeScript", xml: "XML", yaml: "YAML",
};

const SUPPORTED_LANGUAGES = new Set(Object.keys(LANGUAGE_LABELS));
```

Normalize with lowercase and alias lookup. Preserve the original tag as the visible fallback label when unsupported.

- [ ] **Step 3: Implement exact-copy behavior with fallback**

Use this helper:

```typescript
async function copyText(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.select();
  const copied = document.execCommand("copy");
  textarea.remove();
  if (!copied) throw new Error("复制失败");
}
```

The button copies the `code` prop verbatim, sets `copied=true`, and resets after 1500 ms. Store the timeout in a ref and clear it on unmount.

- [ ] **Step 4: Implement streaming and fallback rendering**

Complete the component with this contract and render structure:

```typescript
export interface CodeBlockProps {
  code: string;
  language?: string;
  streaming: boolean;
}

export default function CodeBlock({ code, language, streaming }: CodeBlockProps) {
  const [copied, setCopied] = useState(false);
  const resetTimer = useRef<number | null>(null);
  const rawLanguage = language?.trim().toLowerCase() ?? "";
  const normalizedLanguage = LANGUAGE_ALIASES[rawLanguage] ?? rawLanguage;
  const supported = SUPPORTED_LANGUAGES.has(normalizedLanguage);
  const label = normalizedLanguage
    ? LANGUAGE_LABELS[normalizedLanguage] ?? language
    : "代码";

  useEffect(() => () => {
    if (resetTimer.current !== null) window.clearTimeout(resetTimer.current);
  }, []);

  const handleCopy = async () => {
    try {
      await copyText(code);
      setCopied(true);
      if (resetTimer.current !== null) window.clearTimeout(resetTimer.current);
      resetTimer.current = window.setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  };

  return (
    <figure className="code-block">
      <figcaption className="code-block-header">
        <span className="code-block-language">{label}</span>
        <button
          type="button"
          className={copied ? "code-block-copy copied" : "code-block-copy"}
          onClick={handleCopy}
          aria-label={copied ? "代码已复制" : "复制代码"}
        >
          {copied ? <Check size={13} /> : <Copy size={13} />}
          <span>{copied ? "已复制" : "复制"}</span>
        </button>
      </figcaption>
      <div className="code-block-content">
        {!streaming && supported ? (
          <SyntaxHighlighter
            language={normalizedLanguage}
            useInlineStyles={false}
            PreTag="div"
            CodeTag="code"
          >
            {code}
          </SyntaxHighlighter>
        ) : (
          <pre><code>{code}</code></pre>
        )}
      </div>
    </figure>
  );
}
```

Use plain `<pre><code>` while streaming, when language is absent, or when it is unsupported. Do not use `dangerouslySetInnerHTML`.

### Task 3: Route fenced Markdown through `CodeBlock`

**Files:**
- Modify: `frontend/src/components/ChatArea.tsx:509-540`

- [ ] **Step 1: Import React node helpers and `CodeBlock`**

Merge `isValidElement` and `type ReactNode` into the existing React import, then import `CodeBlock` from `./CodeBlock`.

- [ ] **Step 2: Add a fenced-code extractor before `AssistantContent`**

```typescript
function fencedCodeFromPre(children: ReactNode): {
  code: string;
  language?: string;
} | null {
  if (!isValidElement(children) || children.type !== "code") return null;
  const props = children.props as { className?: string; children?: ReactNode };
  const language = /(?:^|\s)language-([\w-]+)/.exec(props.className ?? "")?.[1];
  return {
    code: String(props.children ?? "").replace(/\n$/, ""),
    language,
  };
}
```

This removes the single parser-added trailing newline while leaving all other whitespace untouched.

- [ ] **Step 3: Override only the `pre` renderer**

Replace the current custom `code` renderer with:

```tsx
pre({ children, ...props }: any) {
  const block = fencedCodeFromPre(children);
  if (!block) return <pre {...props}>{children}</pre>;
  return (
    <CodeBlock
      code={block.code}
      language={block.language}
      streaming={streaming}
    />
  );
},
```

Do not override `code`; inline code remains a normal React Markdown `<code>` node.

### Task 4: Style the code card and Prism tokens

**Files:**
- Modify: `frontend/src/components/ChatArea.css:127-141`

- [ ] **Step 1: Isolate inline code styling**

Replace the broad `.cb-markdown code` selector with:

```css
.cb-markdown :not(pre) > code {
  font-family: var(--mono);
  font-size: 12px;
  background: var(--bg-subtle);
  border: 1px solid var(--border-soft);
  padding: 2px 5px;
  border-radius: 4px;
  color: var(--accent);
}
```

Keep `.cb-markdown pre` as the native fallback for nonstandard Markdown output.

- [ ] **Step 2: Add code-card layout styles**

Add the complete card layout:

```css
.code-block {
  margin: 12px 0;
  overflow: hidden;
  border: 1px solid var(--border-strong);
  border-radius: 12px;
  background: var(--code-bg);
  color: var(--code-text);
  box-shadow: var(--shadow-sm);
}

.code-block-header {
  min-height: 34px;
  padding: 4px 8px 4px 12px;
  display: flex;
  align-items: center;
  gap: 8px;
  border-bottom: 1px solid var(--border-strong);
  background: var(--bg-subtle);
}

.code-block-language {
  flex: 1;
  color: var(--text-3);
  font-family: var(--mono);
  font-size: 11px;
  line-height: 1;
}

.code-block-copy {
  height: 26px;
  padding: 0 8px;
  display: inline-flex;
  align-items: center;
  gap: 5px;
  border: 1px solid transparent;
  border-radius: 7px;
  background: transparent;
  color: var(--text-3);
  font-size: 11px;
}

.code-block-copy:hover,
.code-block-copy:focus-visible {
  border-color: var(--border);
  background: var(--bg-active);
  color: var(--text);
  outline: none;
}

.code-block-copy.copied { color: var(--green); }

.code-block-content {
  overflow-x: auto;
  padding: 14px 16px;
  font-family: var(--mono);
  font-size: 12.5px;
  line-height: 1.62;
}

.code-block-content > div,
.code-block-content pre {
  margin: 0;
  padding: 0;
  border: 0;
  border-radius: 0;
  background: transparent;
  box-shadow: none;
}

.code-block-content code {
  min-width: max-content;
  display: block;
  padding: 0;
  border: 0;
  background: transparent;
  color: inherit;
  font: inherit;
  white-space: pre;
}
```

- [ ] **Step 3: Add theme-variable Prism token colors**

Add these complete token rules; existing variables provide both themes:

```css
.code-block .token.comment,
.code-block .token.prolog,
.code-block .token.doctype,
.code-block .token.cdata { color: var(--text-3); }

.code-block .token.punctuation,
.code-block .token.operator { color: var(--code-text); }

.code-block .token.property,
.code-block .token.tag,
.code-block .token.constant,
.code-block .token.symbol,
.code-block .token.deleted { color: var(--red); }

.code-block .token.boolean,
.code-block .token.number,
.code-block .token.variable,
.code-block .token.regex,
.code-block .token.important { color: var(--amber); }

.code-block .token.selector,
.code-block .token.attr-name,
.code-block .token.string,
.code-block .token.char,
.code-block .token.builtin,
.code-block .token.inserted { color: var(--green); }

.code-block .token.atrule,
.code-block .token.attr-value,
.code-block .token.keyword { color: var(--accent); }

.code-block .token.function,
.code-block .token.class-name { color: var(--blue-accent); }

.code-block .token.italic { font-style: italic; }
.code-block .token.bold,
.code-block .token.important { font-weight: 650; }
```

### Task 5: Require language-tagged fenced output

**Files:**
- Modify: `src/agent/engine.ts:121-127`

- [ ] **Step 1: Extend `<result_presentation>` without changing `<visualization>`**

Add after the existing Markdown rule:

```text
- 多行代码、配置、脚本、SQL、XML、JSON、YAML 必须使用 Markdown fenced code block，并填写准确语言标识（如 Java、XML、YAML、SQL 对应的 fenced language）；禁止把多行代码裸放在普通段落中
- 类名、方法名、字段名、命令参数等短代码使用单反引号；Visualizer 的 SVG/HTML 继续通过 show_widget 展示，不在正文重复源码，除非用户明确要求
```

Use the exact two rules above; do not embed literal triple-backtick examples in the TypeScript template string.

### Task 6: Verify without adding unit tests

**Files:**
- No new test files, per user instruction.

- [ ] **Step 1: Run type and production-build checks**

Run `npx tsc --project tsconfig.electron.json --noEmit`, then `cd frontend && npm run build`.

Expected: both commands exit 0. Record the existing bundle-size warning separately.

- [ ] **Step 2: Run frontend lint**

Run `cd frontend && npm run lint`.

Expected: exit 0 and no warning originating from `CodeBlock.tsx` or the modified Markdown renderer.

- [ ] **Step 3: Run browser smoke scenarios**

Render fenced Java, XML, YAML, SQL, an unknown language, and a block with no language. Verify supported languages contain `.token` spans only after streaming completes; unknown and absent languages render plain code; copy returns exact code without fences; theme switching updates colors; inline code remains unchanged; and no console error occurs.

- [ ] **Step 4: Inspect final scope**

Run:

```bash
git diff --check
git diff -- frontend/package.json frontend/package-lock.json frontend/src/components/CodeBlock.tsx frontend/src/components/ChatArea.tsx frontend/src/components/ChatArea.css src/agent/engine.ts
```

Expected: no whitespace errors, no unrelated edits, and no `dangerouslySetInnerHTML` in `CodeBlock.tsx`.
