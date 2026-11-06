import { dirname, extname, isAbsolute, resolve, sep } from "node:path";

import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import remarkFrontmatter from "remark-frontmatter";
import remarkRehype from "remark-rehype";
import rehypeRaw from "rehype-raw";
import rehypeKatex from "rehype-katex";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";
import rehypeSlug from "rehype-slug";
import rehypeStringify from "rehype-stringify";
import { isPathWithin } from "../../../platform/path_policy.ts";
import { currentPlatform } from "../../../platform/runtime.ts";

export interface MarkdownPreviewOptions {
  sourcePath: string;
}

export interface MarkdownPreviewResult {
  html: string;
  resourceRoot: string;
}

export function isMarkdownPath(filePath: string): boolean {
  const extension = extname(filePath).toLowerCase();
  return extension === ".md" || extension === ".markdown";
}

export function isAllowedMarkdownPreviewPath(
  filePath: string,
  allowedRoots: string[],
): boolean {
  const target = resolve(filePath);
  return isMarkdownPath(target) && allowedRoots.some((root) =>
    isPathWithin(resolve(root), target, currentPlatform),
  );
}

type HastNode = {
  type?: string;
  tagName?: string;
  properties?: Record<string, unknown>;
  children?: HastNode[];
};

const markdownSanitizeSchema = {
  ...defaultSchema,
  attributes: {
    ...defaultSchema.attributes,
    a: [...(defaultSchema.attributes?.a ?? []), "target", "rel"],
    code: [
      ...(defaultSchema.attributes?.code ?? []),
      ["className", /^language-[\w-]+$/],
    ],
    input: [
      ...(defaultSchema.attributes?.input ?? []),
      "type",
      "checked",
      "disabled",
    ],
    span: [
      ...(defaultSchema.attributes?.span ?? []),
      ["className", /^[\w-]+$/],
      "ariaHidden",
    ],
  },
  protocols: {
    ...defaultSchema.protocols,
    href: ["http", "https", "mailto"],
    src: ["http", "https", "data"],
  },
};

function isRelativeResource(value: string): boolean {
  return (
    value.length > 0 &&
    !isAbsolute(value) &&
    !/^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(value)
  );
}

function rewriteRelativeImages(root: HastNode, sourcePath: string): void {
  const resourceRoot = dirname(sourcePath);
  const visit = (node: HastNode) => {
    if (node.type === "element" && node.tagName === "img" && node.properties) {
      const src = node.properties.src;
      if (typeof src === "string" && isRelativeResource(src)) {
        const hashIndex = src.search(/[?#]/);
        const resource = hashIndex === -1 ? src : src.slice(0, hashIndex);
        const suffix = hashIndex === -1 ? "" : src.slice(hashIndex);
        const resolved = resolve(resourceRoot, resource);
        const insideRoot = resolved === resourceRoot || resolved.startsWith(resourceRoot + sep);
        if (insideRoot) {
          node.properties.src = `/api/file?path=${encodeURIComponent(resolved)}${suffix}`;
        } else {
          delete node.properties.src;
        }
      }
    }
    for (const child of node.children ?? []) visit(child);
  };
  visit(root);
}

export async function renderMarkdownPreview(
  markdown: string,
  options: MarkdownPreviewOptions,
): Promise<MarkdownPreviewResult> {
  const processor = unified()
    .use(remarkParse)
    .use(remarkGfm)
    .use(remarkMath)
    .use(remarkFrontmatter, ["yaml", "toml"])
    .use(remarkRehype, { allowDangerousHtml: true })
    .use(rehypeRaw)
    .use(rehypeKatex)
    .use(rehypeSlug)
    .use(() => (tree: HastNode) => rewriteRelativeImages(tree, options.sourcePath))
    .use(rehypeSanitize, markdownSanitizeSchema as any)
    .use(rehypeStringify);

  const file = await processor.process(markdown);
  return {
    html: String(file),
    resourceRoot: dirname(options.sourcePath),
  };
}
