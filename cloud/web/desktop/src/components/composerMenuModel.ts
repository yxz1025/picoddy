export interface PublicAttachment {
  id: string;
  name: string;
  size: number;
  mimeType: string;
  extension: string;
}

export const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;
export const MAX_ATTACHMENTS_PER_MESSAGE = 10;

const ALLOWED_ATTACHMENT_EXTENSIONS = new Set([
  "pdf",
  "docx",
  "xlsx",
  "csv",
  "pptx",
  "txt",
  "md",
  "markdown",
  "json",
  "ts",
  "tsx",
  "js",
  "jsx",
  "py",
  "java",
  "go",
  "rs",
  "c",
  "cpp",
  "h",
  "css",
  "html",
  "xml",
  "yaml",
  "yml",
  "toml",
  "sql",
  "sh",
  "png",
  "jpg",
  "jpeg",
  "gif",
  "webp",
  "svg",
  "ico",
  "ttf",
  "otf",
  "woff",
  "woff2",
]);

export const ATTACHMENT_INPUT_ACCEPT = Array.from(
  ALLOWED_ATTACHMENT_EXTENSIONS,
  (extension) => `.${extension}`,
).join(",");

const FILE_TYPE_LABELS: Record<string, string> = {
  pdf: "PDF",
  docx: "Word",
  xlsx: "Excel",
  csv: "CSV",
  pptx: "PowerPoint",
  txt: "Text",
  md: "Markdown",
  markdown: "Markdown",
  json: "JSON",
  ts: "TypeScript",
  tsx: "TypeScript",
  js: "JavaScript",
  jsx: "JavaScript",
  py: "Python",
  java: "Java",
  go: "Go",
  rs: "Rust",
  c: "C",
  cpp: "C++",
  h: "C/C++ Header",
  css: "CSS",
  html: "HTML",
  xml: "XML",
  yaml: "YAML",
  yml: "YAML",
  toml: "TOML",
  sql: "SQL",
  sh: "Shell",
  png: "PNG 图片",
  jpg: "JPEG 图片",
  jpeg: "JPEG 图片",
  gif: "GIF 图片",
  webp: "WebP 图片",
  svg: "SVG 矢量图",
  ico: "图标文件",
  ttf: "TrueType 字体",
  otf: "OpenType 字体",
  woff: "Web 字体",
  woff2: "Web 字体",
};

function extensionFromFilename(name: string): string {
  const suffixIndex = name.lastIndexOf(".");
  return suffixIndex < 0 ? "" : name.slice(suffixIndex + 1).toLowerCase();
}

export function canSendComposerMessage(
  text: string,
  attachmentIds: string[],
): boolean {
  return text.trim().length > 0 || attachmentIds.length > 0;
}

export function mergeUniqueSlashCommands<T extends { cmd: string }>(
  preferred: readonly T[],
  fallback: readonly T[],
): T[] {
  const seen = new Set<string>();
  return [...preferred, ...fallback].filter((command) => {
    const key = command.cmd.trim().toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export interface ModelIdentity {
  provider: string;
  id: string;
}

/** 列表中的模型均已通过可用性筛选，状态点统一显示为绿色。 */
export function availableModelStatusColor(_provider: string): string {
  return "#10B981";
}

const SKILL_ICON_HUES = [
  12,
  38,
  82,
  148,
  188,
  218,
  258,
  302,
  338,
] as const;

/** 按技能标识稳定分配色相，保持列表丰富且避免每次打开菜单时颜色跳变。 */
export function skillIconHue(name: string): number {
  let hash = 0;
  for (const character of name.trim().toLowerCase()) {
    hash = (hash * 31 + character.codePointAt(0)!) >>> 0;
  }
  return SKILL_ICON_HUES[hash % SKILL_ICON_HUES.length];
}

export function isModelOptionSelected(
  candidate: ModelIdentity,
  selected: ModelIdentity,
): boolean {
  return candidate.provider === selected.provider &&
    candidate.id === selected.id;
}

export function buildComposerPayload(input: {
  text: string;
  connector?: { id: string; kind: "mcp" | "managed-cli" };
  connectors?: readonly { id: string; kind: "mcp" | "managed-cli" }[];
  attachmentIds: string[];
}): {
  text: string;
  attachmentIds: string[];
  preferredConnectors?: { id: string; kind: "mcp" | "managed-cli" }[];
  preferredConnector?: string;
  preferredConnectorKind?: "mcp" | "managed-cli";
} {
  // 编辑器用零宽边界隔开标签与相邻文字；请求侧恢复成普通空格，
  // 保证 `/skill` 单独发送或后接参数时仍能被运行时 slash 解析。
  const visibleText = input.text
    .replaceAll(SKILL_TOKEN_BOUNDARY, " ")
    .trim();
  const requestText = visibleText ||
    (input.attachmentIds.length > 0 ? "请分析附件内容" : "");
  const payload: {
    text: string;
    attachmentIds: string[];
    preferredConnectors?: { id: string; kind: "mcp" | "managed-cli" }[];
    preferredConnector?: string;
    preferredConnectorKind?: "mcp" | "managed-cli";
  } = {
    text: requestText,
    attachmentIds: [...input.attachmentIds],
  };
  if (input.connectors !== undefined) {
    payload.preferredConnectors = input.connectors.map(({ id, kind }) => ({ id, kind }));
  } else if (input.connector) {
    payload.preferredConnector = input.connector.id;
    payload.preferredConnectorKind = input.connector.kind;
  }
  return payload;
}

/** 技能命令的不可见解析边界，不产生视觉空隙（空隙由 CSS margin 承担）。 */
export const SKILL_TOKEN_BOUNDARY = "\u200B";

/** 中文输入法可能产生全角或数学斜杠；编辑器统一存储为 ASCII `/`。 */
export function normalizeComposerSlashCharacters(value: string): string {
  return value.replace(/[／∕⁄]/g, "/");
}

/** 同正文偏移下附件的稳定次序编码基数（单条最多 10 个附件）。 */
export const ATTACHMENT_LAYOUT_ORDER_RADIX = 100;

export function encodeAttachmentLayout(offset: number, order: number): number {
  return Math.max(0, offset) * ATTACHMENT_LAYOUT_ORDER_RADIX +
    (Math.max(0, order) % ATTACHMENT_LAYOUT_ORDER_RADIX);
}

export function decodeAttachmentLayout(
  position: number,
): { offset: number; order: number } {
  const safe = Math.max(0, position);
  return {
    offset: Math.floor(safe / ATTACHMENT_LAYOUT_ORDER_RADIX),
    order: safe % ATTACHMENT_LAYOUT_ORDER_RADIX,
  };
}

export function isSkillBoundaryText(value: string): boolean {
  return value.length === 0 ||
    [...value].every((character) => character === SKILL_TOKEN_BOUNDARY);
}

export type SlashTriggerMatch =
  | { type: "skill"; query: string }
  | { type: "command"; query: string };

const SLASH_SKILL_IN_TEXT =
  /(?:^|[\s\u200B])\/skill(?:\s+([a-zA-Z0-9_-]*)?)?$/i;
const SLASH_COMMAND_IN_TEXT = /(?:^|[\s\u200B])\/([a-zA-Z0-9_-]*)$/;
const SLASH_SKILL_AFTER_CHIP =
  /^[\u200B]*\/skill(?:\s+([a-zA-Z0-9_-]*)?)?$/i;
const SLASH_COMMAND_AFTER_CHIP = /^[\u200B]*\/([a-zA-Z0-9_-]*)$/;

/** 行首、空白或技能零宽边界后的 `/` 才打开斜杠菜单；普通文字后必须先空格。 */
export function matchSlashTrigger(beforeCaret: string): SlashTriggerMatch | null {
  const skill = beforeCaret.match(SLASH_SKILL_IN_TEXT);
  if (skill) return { type: "skill", query: (skill[1] || "").toLowerCase() };
  const command = beforeCaret.match(SLASH_COMMAND_IN_TEXT);
  if (command) {
    return { type: "command", query: command[1].toLowerCase() };
  }
  return null;
}

/**
 * 光标紧贴技能/文件标签后，当前文本节点里的 `/` 视为合法边界。
 * 仅当节点前缀本身是 `/查询`（可带零宽字符）时命中，避免 `文字/` 误触发。
 */
export function matchSlashTriggerAfterChip(
  nodePrefix: string,
): SlashTriggerMatch | null {
  const skill = nodePrefix.match(SLASH_SKILL_AFTER_CHIP);
  if (skill) return { type: "skill", query: (skill[1] || "").toLowerCase() };
  const command = nodePrefix.match(SLASH_COMMAND_AFTER_CHIP);
  if (command) {
    return { type: "command", query: command[1].toLowerCase() };
  }
  return null;
}

/**
 * 紧贴标签时只用当前节点判断斜杠菜单，避免前面标签的 `/命令`
 * 和后面刚打的字母拼成一段查询（例如 `/data-analysisasdasd`）。
 */
export function resolveSlashTrigger(
  beforeCaret: string,
  nodePrefixAfterChip: string | null,
): SlashTriggerMatch | null {
  if (nodePrefixAfterChip === null) return matchSlashTrigger(beforeCaret);
  const afterChip = matchSlashTriggerAfterChip(nodePrefixAfterChip);
  if (afterChip) return afterChip;
  if (isSkillBoundaryText(nodePrefixAfterChip)) return null;
  return matchSlashTrigger(nodePrefixAfterChip);
}

/** 去掉待替换的斜杠触发词，保留前置空白或技能零宽边界。 */
export function consumeSlashTrigger(
  beforeCaret: string,
  nodePrefix?: string | null,
): string {
  if (nodePrefix && matchSlashTriggerAfterChip(nodePrefix)) {
    const kept = nodePrefix.match(/^[\u200B]*/)?.[0] ?? "";
    return beforeCaret.slice(0, beforeCaret.length - nodePrefix.length) + kept;
  }
  const matched = beforeCaret.match(SLASH_SKILL_IN_TEXT) ??
    beforeCaret.match(SLASH_COMMAND_IN_TEXT);
  if (!matched || matched.index === undefined) return beforeCaret;
  const keepBoundary = /^[\s\u200B]/.test(matched[0]) ? 1 : 0;
  return beforeCaret.slice(0, matched.index + keepBoundary);
}

export function applyComposerSelectionDelete(input: {
  text: string;
  rangeStart: number;
  rangeEnd: number;
  removeAttachmentIds?: readonly string[];
  attachments?: readonly PublicAttachment[];
  anchors?: Readonly<Record<string, number>>;
}): {
  text: string;
  caret: number;
  attachments: PublicAttachment[];
  anchors: Record<string, number>;
} {
  const start = Math.max(0, Math.min(input.rangeStart, input.rangeEnd));
  const end = Math.max(input.rangeStart, input.rangeEnd, start);
  const nextText = input.text.slice(0, start) + input.text.slice(end);
  const delta = end - start;
  const removed = new Set(input.removeAttachmentIds ?? []);
  const nextAttachments: PublicAttachment[] = [];
  const nextAnchors: Record<string, number> = {};
  for (const attachment of input.attachments ?? []) {
    if (removed.has(attachment.id)) continue;
    let offset = input.anchors?.[attachment.id] ?? 0;
    if (offset >= end) offset -= delta;
    else if (offset > start) offset = start;
    nextAttachments.push(attachment);
    nextAnchors[attachment.id] = Math.max(0, offset);
  }
  return {
    text: nextText,
    caret: start,
    attachments: nextAttachments,
    anchors: nextAnchors,
  };
}

/** 剪贴板换行统一成 `\n`，避免 Windows `\r\n` 或旧 Mac `\r` 进编辑器。 */
export function normalizePastedComposerText(value: string): string {
  return normalizeComposerSlashCharacters(
    value.replaceAll("\r\n", "\n").replaceAll("\r", "\n"),
  );
}

/**
 * Large clipboard payloads must not be injected into the model request as one
 * inline user message. 16 KiB leaves useful headroom for the system prompt,
 * tools and conversation history even on providers with a 30K-ish input cap.
 */
export const LARGE_PASTE_ATTACHMENT_BYTES = 16 * 1024;

export interface PreparedPastedComposerContent {
  inlineText: string;
  attachment?: {
    content: string;
    extension: "json" | "txt";
    mimeType: "application/json" | "text/plain";
  };
}

function utf8ByteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

/**
 * Return the end offset of one top-level JSON object/array. This deliberately
 * does not execute or fully parse the payload; it only tracks JSON string and
 * bracket boundaries so a short instruction pasted after the JSON can remain
 * a real user instruction instead of becoming untrusted attachment content.
 */
function topLevelJsonEnd(value: string): number | undefined {
  const start = value.search(/\S/u);
  if (start < 0 || (value[start] !== "{" && value[start] !== "[")) {
    return undefined;
  }
  const stack: string[] = [];
  let inString = false;
  let escaped = false;
  for (let index = start; index < value.length; index++) {
    const char = value[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') {
      inString = true;
      continue;
    }
    if (char === "{" || char === "[") {
      stack.push(char);
      continue;
    }
    if (char !== "}" && char !== "]") continue;
    const opening = stack.pop();
    if (
      !opening ||
      (opening === "{" && char !== "}") ||
      (opening === "[" && char !== "]")
    ) {
      return undefined;
    }
    if (stack.length === 0) return index + 1;
  }
  return undefined;
}

export function preparePastedComposerContent(
  value: string,
  attachmentThresholdBytes = LARGE_PASTE_ATTACHMENT_BYTES,
): PreparedPastedComposerContent {
  const normalized = normalizePastedComposerText(value);
  if (utf8ByteLength(normalized) <= attachmentThresholdBytes) {
    return { inlineText: normalized };
  }

  const jsonEnd = topLevelJsonEnd(normalized);
  if (jsonEnd !== undefined) {
    const trailingInstruction = normalized.slice(jsonEnd).trim();
    return {
      inlineText: trailingInstruction,
      attachment: {
        content: normalized.slice(0, jsonEnd),
        extension: "json",
        mimeType: "application/json",
      },
    };
  }

  return {
    inlineText: "",
    attachment: {
      content: normalized,
      extension: "txt",
      mimeType: "text/plain",
    },
  };
}

/** 在光标处写入正文（含换行），并把光标之后的附件锚点后移。 */
export function insertComposerTextAtCaret(input: {
  text: string;
  caret: number;
  insert: string;
  attachments?: readonly PublicAttachment[];
  anchors?: Readonly<Record<string, number>>;
}): {
  text: string;
  caret: number;
  attachments: PublicAttachment[];
  anchors: Record<string, number>;
} {
  const caret = Math.max(0, Math.min(input.caret, input.text.length));
  const insert = input.insert;
  const nextText = input.text.slice(0, caret) + insert + input.text.slice(caret);
  const nextAttachments: PublicAttachment[] = [];
  const nextAnchors: Record<string, number> = {};
  for (const attachment of input.attachments ?? []) {
    let offset = input.anchors?.[attachment.id] ?? 0;
    if (offset >= caret) offset += insert.length;
    nextAttachments.push(attachment);
    nextAnchors[attachment.id] = Math.max(0, offset);
  }
  return {
    text: nextText,
    caret: caret + insert.length,
    attachments: nextAttachments,
    anchors: nextAnchors,
  };
}

/**
 * 在光标处插入技能命令。可见间距由标签外边距承担，正文只在需要切开
 * `/命令` 时写入零宽边界：前面紧贴非空白则前置边界；后面不是空白或
 * 已有边界时后置边界，避免随后输入 ASCII 把标签粘成 `/命令文字`。
 */
export function insertSkillAtCursor(
  text: string,
  caret: number,
  skillCmd: string,
): { text: string; caret: number } {
  const before = text.slice(0, caret);
  const after = text.slice(caret);
  const prefix = before.length > 0 && !/[\s\u200B]$/.test(before)
    ? SKILL_TOKEN_BOUNDARY
    : "";
  const suffix = after.startsWith(SKILL_TOKEN_BOUNDARY) || /^\s/.test(after)
    ? ""
    : SKILL_TOKEN_BOUNDARY;
  return {
    text: `${before}${prefix}${skillCmd}${suffix}${after}`,
    caret: caret + prefix.length + skillCmd.length + suffix.length,
  };
}

/** 插入文件标签：不改正文，偏移即当前光标，间距由 CSS 外边距承担。 */
export function insertAttachmentGapAtCursor(
  text: string,
  caret: number,
): { text: string; offset: number; caret: number } {
  const at = Math.min(Math.max(0, caret), text.length);
  return { text, offset: at, caret: at };
}

export function validateSelectedFiles(
  files: File[],
  existing: PublicAttachment[],
): string | null {
  if (existing.length + files.length > MAX_ATTACHMENTS_PER_MESSAGE) {
    return `单条消息最多添加 ${MAX_ATTACHMENTS_PER_MESSAGE} 个附件`;
  }

  const selectedFiles = new Set(
    existing.map((attachment) => `${attachment.name}\0${attachment.size}`),
  );
  for (const file of files) {
    const identity = `${file.name}\0${file.size}`;
    if (selectedFiles.has(identity)) {
      return `请勿重复添加文件“${file.name}”`;
    }
    selectedFiles.add(identity);

    if (file.size > MAX_ATTACHMENT_BYTES) {
      return `文件“${file.name}”超过 25 MB`;
    }
    if (!ALLOWED_ATTACHMENT_EXTENSIONS.has(extensionFromFilename(file.name))) {
      return `暂不支持文件“${file.name}”的格式`;
    }
  }

  return null;
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) {
    return `${Number((bytes / 1024).toFixed(1))} KB`;
  }
  return `${Number((bytes / (1024 * 1024)).toFixed(1))} MB`;
}

export function fileTypeLabel(extension: string): string {
  const normalized = extension.replace(/^\./, "").toLowerCase();
  return (FILE_TYPE_LABELS[normalized] ?? normalized.toUpperCase()) || "File";
}

export function skillInitial(skill: {
  displayName?: string;
  name: string;
}): string {
  const label = (skill.displayName || skill.name).trim();
  return Array.from(label)[0] || "?";
}

export interface ComposerToken {
  type: "text" | "tag";
  text: string;
  label?: string;
}

export type ComposerMessagePart =
  | ComposerToken
  | { type: "attachment"; attachment: PublicAttachment };

/** 按纯文本偏移把附件插回技能/正文 token 流，与输入框展示顺序一致。 */
export function interleaveComposerAttachments(
  text: string,
  attachments: readonly PublicAttachment[] = [],
  anchors: Readonly<Record<string, number>> = {},
  knownCommands: ReadonlySet<string> = new Set(),
  displayLabels?: ReadonlyMap<string, string>,
): ComposerMessagePart[] {
  const tokens = tokenizeSkillCommands(text, knownCommands, displayLabels);
  if (attachments.length === 0) return tokens;
  const placed = attachments
    .map((attachment, index) => ({
      attachment,
      offset: Math.max(0, anchors[attachment.id] ?? 0),
      index,
    }))
    .sort((left, right) => left.offset - right.offset || left.index - right.index);
  const parts: ComposerMessagePart[] = [];
  let nextAttachment = 0;
  const flushAttachments = (at: number): void => {
    while (
      nextAttachment < placed.length &&
      placed[nextAttachment].offset <= at
    ) {
      parts.push({
        type: "attachment",
        attachment: placed[nextAttachment].attachment,
      });
      nextAttachment += 1;
    }
  };
  let pos = 0;
  for (const token of tokens) {
    if (token.type === "text") {
      const str = token.text;
      let index = 0;
      while (index < str.length) {
        flushAttachments(pos);
        const upcoming = placed[nextAttachment];
        const remaining = str.length - index;
        if (!upcoming || upcoming.offset >= pos + remaining) {
          parts.push({ type: "text", text: str.slice(index) });
          pos += remaining;
          break;
        }
        const take = upcoming.offset - pos;
        if (take > 0) {
          parts.push({ type: "text", text: str.slice(index, index + take) });
          index += take;
          pos += take;
        }
        flushAttachments(pos);
      }
      continue;
    }
    flushAttachments(pos);
    parts.push(token);
    pos += token.text.length;
  }
  flushAttachments(Number.POSITIVE_INFINITY);
  return parts;
}

/**
 * 把文本切分为普通文字与技能标签两类 token。行首、空白或零宽边界后的
 * `/` 起，按「最长已知命令」识别为 tag；命令后面再跟字母、符号也不拆掉
 * 已识别的标签。路径（如 /usr/local）因不是已知命令，仍保留为正文。
 */
export function tokenizeSkillCommands(
  text: string,
  knownCommands: ReadonlySet<string>,
  displayLabels?: ReadonlyMap<string, string>,
): ComposerToken[] {
  if (text === "") return [];
  const tokens: ComposerToken[] = [];
  const known = new Set(
    Array.from(knownCommands, (command) => command.toLowerCase()),
  );
  const knownList = Array.from(known).sort((left, right) =>
    right.length - left.length
  );
  const labels = new Map(
    Array.from(
      displayLabels ?? [],
      ([command, label]) => [command.toLowerCase(), label] as const,
    ),
  );

  const isCommandBoundary = (index: number): boolean => {
    if (index <= 0) return true;
    const previous = text[index - 1];
    return previous === SKILL_TOKEN_BOUNDARY || /\s/.test(previous);
  };

  let cursor = 0;
  let searchFrom = 0;
  while (searchFrom < text.length) {
    const slashIndex = text.indexOf("/", searchFrom);
    if (slashIndex < 0) break;
    if (!isCommandBoundary(slashIndex)) {
      searchFrom = slashIndex + 1;
      continue;
    }
    const after = text.slice(slashIndex);
    const lower = after.toLowerCase();
    const command = knownList.find((item) => lower.startsWith(item));
    if (!command) {
      searchFrom = slashIndex + 1;
      continue;
    }
    const commandText = after.slice(0, command.length);
    if (slashIndex > cursor) {
      tokens.push({ type: "text", text: text.slice(cursor, slashIndex) });
    }
    const label = labels.get(command);
    tokens.push(
      label
        ? { type: "tag", text: commandText, label }
        : { type: "tag", text: commandText },
    );
    cursor = slashIndex + command.length;
    searchFrom = cursor;
  }
  if (cursor < text.length) {
    tokens.push({ type: "text", text: text.slice(cursor) });
  }
  return tokens;
}

/**
 * 光标紧贴技能标签（起始处、结束处，或中间只有零宽边界）时删除该标签
 * 及两侧解析边界；其间若有普通字符则返回 null。
 */
export function deleteSkillTagAtOffset(
  text: string,
  caret: number,
  knownCommands: ReadonlySet<string>,
): { text: string; caret: number } | null {
  const tokens = tokenizeSkillCommands(text, knownCommands);
  let offset = 0;
  for (const token of tokens) {
    if (token.type !== "tag") {
      offset += token.text.length;
      continue;
    }
    const start = offset;
    const end = offset + token.text.length;
    if (caret > start && caret < end) return null;
    const between = caret > end ? text.slice(end, caret) : "";
    if (
      caret !== start &&
      caret !== end &&
      !isSkillBoundaryText(between)
    ) {
      offset = end;
      continue;
    }
    let from = start;
    let to = Math.max(end, caret);
    if (from > 0 && text[from - 1] === SKILL_TOKEN_BOUNDARY) from -= 1;
    if (to < text.length && text[to] === SKILL_TOKEN_BOUNDARY) to += 1;
    return {
      text: text.slice(0, from) + text.slice(to),
      caret: from,
    };
  }
  return null;
}
