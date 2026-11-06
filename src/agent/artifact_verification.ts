import { createHash } from "node:crypto";
import { open, stat } from "node:fs/promises";
import { extname } from "node:path";
import Pizzip from "pizzip";

export interface ArtifactRequirement {
  /** All listed extensions are required. Omitted/empty accepts any file type. */
  extensions?: string[];
  description: string;
  /** At least one group must be fully satisfied, in addition to extensions. */
  anyOf?: string[][];
  minFiles?: number;
  /** Opt-in structural checks by extension; file extensions alone select no parser. */
  validators?: Record<string, ArtifactValidator>;
}

export type ArtifactValidator = "html-document" | "json" | "pdf" | "docx" | "xlsx" | "pptx";

export function normalizeExtension(extension: string): string {
  return extension.trim().toLowerCase().replace(/^\./, "").replace(/^htm$/, "html");
}

export interface VerifiedArtifact {
  path: string;
  extension: string;
  digest: string;
  bytes: number;
}

/** Text inference is only a file-delivery hint, never a format contract.
 * Inspect each output clause so a preceding discussion or negation cannot
 * swallow a later explicit request. Code edits and external actions stay out.
 */
export function inferArtifactRequirement(query: string): ArtifactRequirement | undefined {
  for (const clause of query.split(/[。！？\n；;]/)) {
    const actions = [...clause.matchAll(/输出|生成|导出|交付|保存(?:为|成)?|制作|转(?:成|为)|\b(?:create|generate|export|deliver|save as)\b/gi)];
    for (let i = 0; i < actions.length; i++) {
      const action = actions[i];
      const prefix = clause.slice(i ? actions[i - 1].index! + actions[i - 1][0].length : 0, action.index);
      if (/(?:不要|无需|不用|不需要|不必|do not|don't)\s*[^，,]{0,20}$/i.test(prefix)) continue;
      const output = clause.slice(action.index! + action[0].length, actions[i + 1]?.index);
      if (/网址|\bURL\b|链接/i.test(output) && !/文件|下载|\bfile\b|download/i.test(output)) continue;
      // Familiar format names are hints only; arbitrary suffixes and generic
      // file requests work equally well and never form an allowlist.
      if (/文件|可下载|下载链接|\b(?:files?|download|html?|pdf|docx|word|xlsx|excel|pptx?|powerpoint|csv|json|markdown)\b|(?:^|[\s`"'（(])[^\s。！？]+\.[a-z][a-z0-9]{0,15}\b/i.test(output)) {
        return { description: query, extensions: [] };
      }
    }
  }
  return undefined;
}

/** Evaluate a file contract independently from the available content parsers. */
export function checkArtifactRequirement(requirement: ArtifactRequirement, files: VerifiedArtifact[]): string[] {
  const problems: string[] = [];
  const unique = new Map(files.map((file) => [file.path, file]));
  const minimum = requirement.minFiles ?? 1;
  if (!Number.isSafeInteger(minimum) || minimum < 1) throw new Error("文件交付要求的 minFiles 必须为正整数。");
  if (unique.size < minimum) problems.push(`需要交付至少 ${minimum} 个通过验收的本地文件，当前为 ${unique.size} 个。`);
  const available = new Set([...unique.values()].map((file) => normalizeExtension(file.extension)));
  const has = (extension: string) => available.has(normalizeExtension(extension));
  for (const extension of requirement.extensions ?? []) {
    if (!has(extension)) problems.push(`缺少已交付的 .${normalizeExtension(extension)} 文件。`);
  }
  if (requirement.anyOf !== undefined) {
    if (!requirement.anyOf.length || requirement.anyOf.some((group) => !group.length)) {
      throw new Error("文件交付要求的 anyOf 必须包含非空候选组。");
    }
    if (!requirement.anyOf.some((group) => group.every(has))) {
      const choices = requirement.anyOf.map((group) => group.map((ext) => `.${normalizeExtension(ext)}`).join(" 和 ")).join("；或 ");
      problems.push(`尚未满足任一交付组合：${choices}。`);
    }
  }
  return problems;
}

export function isTaskContinuation(query: string): boolean {
  return /^(?:确认|好的?|可以|继续(?:执行|生成|完成|吧)?|按(?:默认|推荐|方案).{0,30}|没有输出.{0,30}|还没.{0,30}|yes|ok|continue)[。！!\s]*$/i.test(query.trim());
}

/** Host-injected context is model input, not a user file-delivery request. */
export function inferTurnArtifactRequirement(
  prompt: string,
  userRequest?: string,
  previousRequests: string[] = [],
): ArtifactRequirement | undefined {
  const query = userRequest ?? prompt;
  const requirement = inferArtifactRequirement(query);
  if (requirement || !isTaskContinuation(query)) return requirement;
  for (const previous of previousRequests.slice(-12).reverse()) {
    const inherited = inferArtifactRequirement(previous);
    if (inherited) return inherited;
  }
  return undefined;
}

/** Any file type gets streaming integrity checks. Parsers are contract opt-ins. */
export async function verifyArtifact(path: string, signal?: AbortSignal, requirement?: ArtifactRequirement): Promise<VerifiedArtifact> {
  signal?.throwIfAborted();
  if (!(await stat(path)).isFile()) throw new Error("不是普通文件");
  const file = await open(path, "r");
  try {
    const before = await file.stat();
    if (!before.isFile() || before.size === 0) throw new Error("不是非空普通文件");
    const extension = normalizeExtension(extname(path));
    const selected = Object.entries(requirement?.validators ?? {})
      .filter(([ext]) => normalizeExtension(ext) === extension).map(([, name]) => name);
    const validators = [...new Set(selected)].map((name) => {
      const validator = Object.hasOwn(CONTENT_VALIDATORS, name) ? CONTENT_VALIDATORS[name] : undefined;
      if (!validator) throw new Error(`未配置结构校验器：${name}`);
      return validator;
    });
    const hash = createHash("sha256");
    const chunks: Buffer[] = [];
    const inspectContent = validators.length > 0;
    // Bound memory while still hashing all bytes, including large media files.
    if (inspectContent && before.size > 32 * 1024 * 1024) {
      throw new Error("文件超过 32 MB 的结构验收上限，请拆分后交付");
    }
    let position = 0;
    while (position < before.size) {
      signal?.throwIfAborted();
      const buffer = Buffer.alloc(Math.min(256 * 1024, before.size - position));
      const { bytesRead } = await file.read(buffer, 0, buffer.length, position);
      if (!bytesRead) throw new Error("读取期间文件被截断");
      const data = buffer.subarray(0, bytesRead);
      hash.update(data);
      if (inspectContent) chunks.push(data);
      position += bytesRead;
    }
    const after = await file.stat();
    const currentPath = await stat(path);
    if (before.size !== after.size || before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs) {
      throw new Error("验收期间文件发生变化，请写入完成后重新交付");
    }
    if (currentPath.dev !== after.dev || currentPath.ino !== after.ino || currentPath.size !== after.size ||
      currentPath.mtimeMs !== after.mtimeMs || currentPath.ctimeMs !== after.ctimeMs) {
      throw new Error("验收期间文件路径被替换，请重新交付");
    }
    const data = Buffer.concat(chunks);
    for (const validate of validators) validate(data);
    signal?.throwIfAborted();
    return { path, extension, digest: hash.digest("hex"), bytes: before.size };
  } finally {
    await file.close();
  }
}

// Parser availability does not restrict which file types may be delivered.
const CONTENT_VALIDATORS: Record<ArtifactValidator, (data: Buffer) => void> = {
  "html-document": (data) => {
    const html = data.toString("utf8");
    if (!/<html(?:\s|>)/i.test(html) || !/<body(?:\s|>)/i.test(html) ||
      !/<\/body\s*>/i.test(html) || !/<\/html\s*>/i.test(html)) {
      throw new Error("HTML 文档缺少完整 html/body 结构，可能尚未写完");
    }
    if (!/<body\b[^>]*>([\s\S]*?)<\/body>/i.exec(html)?.[1].trim()) throw new Error("HTML 正文为空");
  },
  json: (data) => { JSON.parse(data.toString("utf8").replace(/^\uFEFF/, "")); },
  pdf: (data) => {
    if (!data.subarray(0, 1024).includes(Buffer.from("%PDF-")) ||
      !data.subarray(Math.max(0, data.length - 2048)).includes(Buffer.from("%%EOF"))) {
      throw new Error("PDF 文件头或结束标记缺失");
    }
  },
  docx: (data) => verifyOfficeContainer(data, "docx"),
  xlsx: (data) => verifyOfficeContainer(data, "xlsx"),
  pptx: (data) => verifyOfficeContainer(data, "pptx"),
};

function verifyOfficeContainer(data: Buffer, extension: string): void {
  // Reuse the document subsystem's ZIP reader rather than maintaining a ZIP parser.
  let zip = new Pizzip(data);
  let expandedBytes = 0;
  for (const file of Object.values(zip.files)) {
    const bytes = (file as unknown as { _data?: { uncompressedSize?: number } })._data?.uncompressedSize ?? 0;
    expandedBytes += bytes;
    if (expandedBytes > 128 * 1024 * 1024) throw new Error("Office 文件展开后超过结构验收上限，请拆分交付");
  }
  zip = new Pizzip(data, { checkCRC32: true });
  const required = { docx: "word/document.xml", xlsx: "xl/workbook.xml", pptx: "ppt/presentation.xml" }[extension]!;
  if (!zip.file("[Content_Types].xml") || !zip.file(required)?.asText().trim()) {
    throw new Error(`Office 文件缺少 ${required}`);
  }
}
