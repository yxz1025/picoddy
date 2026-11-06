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
  bash: "Bash",
  css: "CSS",
  go: "Go",
  java: "Java",
  javascript: "JavaScript",
  json: "JSON",
  kotlin: "Kotlin",
  markdown: "Markdown",
  python: "Python",
  rust: "Rust",
  sql: "SQL",
  tsx: "TSX",
  typescript: "TypeScript",
  xml: "XML",
  yaml: "YAML",
};

const SUPPORTED_LANGUAGES = new Set(Object.keys(LANGUAGE_LABELS));

async function copyText(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch {
      // Fall back to the legacy copy path when the async clipboard is denied.
    }
  }

  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.select();
  let copied = false;
  try {
    copied = document.execCommand("copy");
  } finally {
    textarea.remove();
  }
  if (!copied) throw new Error("复制失败");
}

export interface CodeBlockProps {
  code: string;
  language?: string;
  streaming: boolean;
}

export default function CodeBlock({ code, language, streaming }: CodeBlockProps) {
  const [copied, setCopied] = useState(false);
  const resetTimer = useRef<number | null>(null);
  const originalLanguage = language?.trim() ?? "";
  const rawLanguage = originalLanguage.toLowerCase();
  const normalizedLanguage = LANGUAGE_ALIASES[rawLanguage] ?? rawLanguage;
  const supported = SUPPORTED_LANGUAGES.has(normalizedLanguage);
  const label = normalizedLanguage
    ? originalLanguage
    : "代码";

  useEffect(
    () => () => {
      if (resetTimer.current !== null) window.clearTimeout(resetTimer.current);
    },
    [],
  );

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
          title={copied ? "已复制" : "复制"}
          aria-label={copied ? "代码已复制" : "复制代码"}
        >
          {copied ? <Check size={14} /> : <Copy size={14} />}
          <span className="code-block-copy-status" aria-live="polite" role="status">
            {copied ? "已复制" : ""}
          </span>
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
          <pre>
            <code>{code}</code>
          </pre>
        )}
      </div>
    </figure>
  );
}
