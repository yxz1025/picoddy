import {
  type CSSProperties,
  type DragEvent as ReactDragEvent,
  Fragment,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import {
  type PermLevel,
  type RunMode,
  useStore,
} from "../store/useStore";
import {
  ChevronDown,
  CircleAlert,
  FolderInput,
  FolderOpen,
  Plus,
  Search,
  Settings2,
  Shield,
  Sparkles,
  Zap,
} from "lucide-react";
import ComposerPlusMenu from "./ComposerPlusMenu";
import ComposerConnectors from "./ComposerConnectors";
import { EXPERT_MANAGER_SKILL_COMMAND } from "./expertCreatorModel";
import {
  type Expert,
  type SkillMeta,
  useSkillStore,
} from "../store/useSkillStore";
import { usePluginStore } from "../store/usePluginStore";
import { deletePendingAttachment, uploadAttachments } from "../api/attachments";
import { pickDirectory } from "../api/client";
import {
  availableModelStatusColor,
  buildComposerPayload,
  canSendComposerMessage,
  applyComposerSelectionDelete,
  type ComposerToken,
  consumeSlashTrigger,
  deleteSkillTagAtOffset,
  insertSkillAtCursor,
  insertAttachmentGapAtCursor,
  insertComposerTextAtCaret,
  isSkillBoundaryText,
  isModelOptionSelected,
  matchSlashTrigger,
  resolveSlashTrigger,
  mergeUniqueSlashCommands,
  normalizeComposerSlashCharacters,
  preparePastedComposerContent,
  type PublicAttachment,
  SKILL_TOKEN_BOUNDARY,
  skillIconHue,
  skillInitial,
  tokenizeSkillCommands,
  validateSelectedFiles,
} from "./composerMenuModel";
import { composerSceneIconId } from "./composerSkillIcons";
import {
  COMPOSER_SKILL_EVENT,
  DOCUMENT_PROCESSING_COMMAND,
  DOCUMENT_PROCESSING_LABEL,
  isDocumentProcessingCapability,
} from "./documentProcessingModel";
import {
  applyWelcomeSkillToComposer,
  COMPOSER_CLEAR_DRAFT_EVENT,
  COMPOSER_SKILL_REMOVED_EVENT,
  WELCOME_FIXED_SKILLS,
} from "./welcomeSkillSelectionModel";
import { resolveModelSelection } from "./modelSelectionModel";
import { creatorComposerContext } from "./skillDraftModel";

interface CombinedOption {
  key: string;
  mode: RunMode;
  permission: PermLevel;
  title: string;
  badge?: string;
  desc: string;
  icon: any;
}

const CLIPBOARD_IMAGE_EXTENSIONS: Readonly<Record<string, string>> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
  "image/svg+xml": "svg",
  "image/x-icon": "ico",
  "image/vnd.microsoft.icon": "ico",
};

const SUPPORTED_CLIPBOARD_IMAGE_EXTENSION = /\.(?:png|jpe?g|gif|webp|svg|ico)$/i;

function clipboardImageFiles(clipboardData: DataTransfer): File[] {
  const itemFiles = Array.from(clipboardData.items)
    .filter((item) => item.kind === "file" && item.type.startsWith("image/"))
    .flatMap((item) => {
      const file = item.getAsFile();
      return file ? [file] : [];
    });
  const files = itemFiles.length > 0
    ? itemFiles
    : Array.from(clipboardData.files).filter((file) =>
      file.type.startsWith("image/")
    );
  const timestamp = Date.now();
  return files.map((file, index) => {
    if (SUPPORTED_CLIPBOARD_IMAGE_EXTENSION.test(file.name)) return file;
    const extension = CLIPBOARD_IMAGE_EXTENSIONS[file.type.toLowerCase()];
    if (!extension) return file;
    return new File(
      [file],
      `clipboard-image-${timestamp}-${index + 1}.${extension}`,
      { type: file.type, lastModified: file.lastModified },
    );
  });
}

const COMBINED_OPTIONS: CombinedOption[] = [
  {
    key: "default",
    mode: "craft",
    permission: "default",
    title: "默认权限",
    badge: "写需确认",
    desc: "智能放行只读操作，修改文件与终端指令需弹窗授权",
    icon: Shield,
  },
  {
    key: "full",
    mode: "craft",
    permission: "full",
    title: "完全访问",
    badge: "自动运行",
    desc: "常用写操作与指令自动执行，高危系统命令安全拦截",
    icon: Zap,
  },
];

export interface SlashCommand {
  cmd: string;
  name: string;
  desc: string;
  icon: string;
  category: "skill" | "mode" | "action";
  action: (text: string, setText: (t: string) => void) => void;
}

export const SLASH_COMMANDS: SlashCommand[] = [
  {
    cmd: "/ego-browser",
    name: "ego-browser 浏览器自动化",
    desc: "使用 Chromium 浏览器环境进行网页自动化、截图、表单与数据抓取",
    icon: "🌐",
    category: "skill",
    action: (_, setText) =>
      setText("请使用 ego-browser 帮我打开网站并进行自动化操作："),
  },
  {
    cmd: "/ppt-generator-pro",
    name: "PPT 高级制作技能",
    desc: "AI 自动生成高质量 PPT 图片与演示，支持智能转场与交互播放",
    icon: "🎞️",
    category: "skill",
    action: (_, setText) =>
      setText("请使用 ppt-generator-pro 帮我生成一套高保真演示幻灯片："),
  },
  {
    cmd: "/weekly-report",
    name: "工作周报生成技能",
    desc: "搜集 Git 提交与项目进展，生成结构化 Word 周报",
    icon: "📝",
    category: "skill",
    action: (_, setText) =>
      setText("请帮我整理并生成一份本周工作周报 Word 文档"),
  },
  {
    cmd: "/data-analysis",
    name: "数据分析技能",
    desc: "读取表格数据 (xlsx/csv) 并生成分析图表摘要",
    icon: "📊",
    category: "skill",
    action: (_, setText) => setText("请帮我读取并分析桌面上的数据表格文件"),
  },
  {
    cmd: "/presentation",
    name: "PPT 演示生成技能",
    desc: "根据主题生成多页 PPT 演示文稿",
    icon: "🎨",
    category: "skill",
    action: (_, setText) =>
      setText("请帮我根据最近项目成果制作一份 PPT 演示文稿"),
  },
  {
    cmd: "/modern-web-guidance",
    name: "现代 Web 规范指南",
    desc: "针对 HTML/CSS/React 提供现代前端最佳实践与 API 规范",
    icon: "🚀",
    category: "skill",
    action: (_, setText) =>
      setText("请按照现代 Web 最佳实践为我设计前端界面与组件："),
  },
  {
    cmd: "/chrome-extensions",
    name: "Chrome 扩展开发技能",
    desc: "构建与发布 Manifest V3 标准的 Chrome 浏览器插件",
    icon: "🧩",
    category: "skill",
    action: (_, setText) =>
      setText("请帮我设计一个 Manifest V3 的 Chrome 浏览器扩展："),
  },
  {
    cmd: "/polish-writing",
    name: "文档润色技能",
    desc: "润色和优化文本文档结构与用词",
    icon: "✍️",
    category: "skill",
    action: (_, setText) => setText("请帮我润色和优化以下文档内容："),
  },
  {
    cmd: "/doc-qa",
    name: "文档问答技能",
    desc: "针对文档内容进行精准问答与引用",
    icon: "❓",
    category: "skill",
    action: (_, setText) => setText("请结合文档回答我以下问题："),
  },
  {
    cmd: "/brainstorm",
    name: "Brainstorm (Superpowers)",
    desc: "发散思考模式：从多角度评估 3-5 种潜在方案，对比可行性与优缺点",
    icon: "🧠",
    category: "mode",
    action: (_, setText) => {
      setText("/brainstorm ");
    },
  },
  {
    cmd: "/plan",
    name: "Plan (Superpowers 方案)",
    desc: "方案拆解模式：制定模块架构与分步执行清单",
    icon: "📋",
    category: "mode",
    action: (_, setText) => {
      useStore.getState().setMode("plan");
      setText("/plan ");
    },
  },
  {
    cmd: "/implement",
    name: "Implement (Superpowers)",
    desc: "精准落地模式：高效编写代码或生成工件，同步进行验证",
    icon: "⚡",
    category: "mode",
    action: (_, setText) => {
      useStore.getState().setMode("craft");
      setText("/implement ");
    },
  },
  {
    cmd: "/subagent",
    name: "派发子代理 (pi-subagents)",
    desc: "在后台独立上下文派发子任务，不占用当前主窗口",
    icon: "🤖",
    category: "action",
    action: (_, setText) => {
      setText("/subagent 请在后台帮我执行以下独立任务：");
    },
  },
  {
    cmd: "/goal",
    name: "Goal (目标强校验模式)",
    desc: "目标驱动模式：持续推演并验证，直到调用 goal_complete 凭据闭环",
    icon: "🎯",
    category: "mode",
    action: (_, setText) => {
      setText("/goal ");
    },
  },
  {
    cmd: "/craft",
    name: "Craft 模式",
    desc: "切换到 Craft 直接执行模式 (读写与命令)",
    icon: "🛠️",
    category: "mode",
    action: (_, setText) => {
      useStore.getState().setMode("craft");
      setText("");
    },
  },
  {
    cmd: "/ask",
    name: "Ask 模式",
    desc: "切换到 Ask 纯文本问答模式",
    icon: "💬",
    category: "mode",
    action: (_, setText) => {
      useStore.getState().setMode("ask");
      setText("");
    },
  },
];

function getActiveOptionKey(permission: PermLevel): string {
  if (permission === "full" || permission === "L3") return "full";
  return "default";
}

// ── contenteditable 行内技能标签：纯文本模型与 DOM 的偏移换算 ──

interface EditorContextToken {
  id: "skill-creator" | "expert-manager" | "selected-expert";
  label: string;
  removeLabel: string;
  title?: string;
}

interface PendingChipCaretTarget {
  chipKey: string;
  offset: number;
}

const CARET_ANCHOR_SENTINEL = "\u200B";

function isContextTokenElement(element: HTMLElement): boolean {
  return element.classList?.contains("composer-context-token") ?? false;
}

function isAttachmentTokenElement(element: HTMLElement): boolean {
  return element.classList?.contains("composer-attachment-token") ?? false;
}

function isCaretAnchorElement(element: HTMLElement | null): boolean {
  return element?.classList?.contains(
    "composer-token__text--caret-anchor",
  ) ?? false;
}

function caretAnchorModelText(value: string): string {
  return value.split(CARET_ANCHOR_SENTINEL).join("");
}

function textNodeModelText(node: Node, endOffset?: number): string {
  const value = (node.textContent ?? "").slice(0, endOffset);
  return isCaretAnchorElement(node.parentElement)
    ? caretAnchorModelText(value)
    : value;
}

function caretAnchorTextNode(anchor: HTMLElement): Text | null {
  return Array.from(anchor.childNodes).find(
    (node): node is Text => node.nodeType === Node.TEXT_NODE,
  ) ?? null;
}

function caretAnchorRawOffset(value: string, modelOffset: number): number {
  let remaining = Math.max(0, modelOffset);
  let fallback = 0;
  for (let index = 0; index < value.length; index += 1) {
    if (value[index] === CARET_ANCHOR_SENTINEL) {
      fallback = index + 1;
      continue;
    }
    if (remaining === 0) return Math.max(index, fallback);
    remaining -= 1;
  }
  return value.length;
}

function setRangeInCaretAnchor(
  range: Range,
  anchor: HTMLElement,
  modelOffset = 0,
): boolean {
  const textNode = caretAnchorTextNode(anchor);
  if (!textNode) return false;
  range.setStart(
    textNode,
    caretAnchorRawOffset(textNode.data, modelOffset),
  );
  return true;
}

function isZeroLengthTokenElement(element: HTMLElement): boolean {
  return isContextTokenElement(element) || isAttachmentTokenElement(element);
}

/** Chromium 删掉一行最后一个字符时会留下 `...\n<br>`；两者只表示一个换行。 */
function isDuplicateTrailingBreak(node: Node): boolean {
  if (
    node.nodeType !== Node.ELEMENT_NODE ||
    (node as HTMLElement).tagName !== "BR"
  ) {
    return false;
  }
  const previous = node.previousSibling;
  return previous?.nodeType === Node.TEXT_NODE &&
    textNodeModelText(previous).endsWith("\n");
}

/** 节点在纯文本模型中的长度（<br> 计 1 个换行符；上下文/附件标签不计入文本）。 */
function nodeTextLength(node: Node): number {
  if (node.nodeType === Node.TEXT_NODE) return textNodeModelText(node).length;
  const element = node as HTMLElement;
  if (element.tagName === "BR") return isDuplicateTrailingBreak(node) ? 0 : 1;
  if (isZeroLengthTokenElement(element)) return 0;
  if (isCaretAnchorElement(element)) {
    return caretAnchorModelText(element.textContent ?? "").length;
  }
  if (element.classList?.contains("composer-token")) {
    return element.dataset.cmd?.length ?? 0;
  }
  return node.textContent?.length ?? 0;
}

/** 读取编辑器当前纯文本（<br> 归一化为换行符；上下文标签跳过，技能标签只取命令文本）。 */
function plainTextOf(editor: HTMLElement): string {
  let out = "";
  const walk = (node: Node): void => {
    if (node.nodeType === Node.TEXT_NODE) {
      out += textNodeModelText(node);
      return;
    }
    const element = node as HTMLElement;
    if (element.tagName === "BR") {
      if (!isDuplicateTrailingBreak(node)) out += "\n";
      return;
    }
    if (isZeroLengthTokenElement(element)) return;
    if (element.classList?.contains("composer-token")) {
      const command = element.dataset.cmd ?? "";
      if (out.length > 0 && !/[\s\u200B]$/.test(out)) {
        out += SKILL_TOKEN_BOUNDARY;
      }
      out += command;
      return;
    }
    for (const child of Array.from(node.childNodes)) walk(child);
  };
  walk(editor);
  return out;
}

/** 指定 DOM 位点在纯文本模型中的偏移。 */
function rangePointOffset(
  editor: HTMLElement,
  container: Node,
  offset: number,
): number {
  if (!editor.contains(container) && container !== editor) {
    return plainTextOf(editor).length;
  }
  let sum = 0;
  if (container === editor) {
    for (let index = 0; index < offset; index += 1) {
      sum += nodeTextLength(editor.childNodes[index]);
    }
    return sum;
  }
  let node: Node | null = container;
  while (node && node !== editor) {
    const parent: ParentNode | null = node.parentNode;
    if (!parent) break;
    for (
      let sibling = parent.firstChild;
      sibling && sibling !== node;
      sibling = sibling.nextSibling
    ) {
      sum += nodeTextLength(sibling);
    }
    node = parent;
  }
  if (container.nodeType === Node.TEXT_NODE) {
    sum += textNodeModelText(container, offset).length;
  } else {
    for (
      let index = 0;
      index < offset && index < container.childNodes.length;
      index += 1
    ) {
      sum += nodeTextLength(container.childNodes[index]);
    }
  }
  return sum;
}

/** 光标（选区起点）在纯文本模型中的偏移。 */
function caretOffset(editor: HTMLElement): number {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) {
    return plainTextOf(editor).length;
  }
  const range = selection.getRangeAt(0);
  return rangePointOffset(editor, range.startContainer, range.startOffset);
}

/** 输入区溢出时把光标滚进视野，避免最后一行回车后光标跑到滚动区域外。 */
function scrollComposerCaretIntoView(editor: HTMLElement): void {
  if (editor.scrollHeight <= editor.clientHeight) return;
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) return;
  const range = selection.getRangeAt(0);
  if (!editor.contains(range.startContainer) && range.startContainer !== editor) {
    return;
  }
  if (caretOffset(editor) >= plainTextOf(editor).length) {
    editor.scrollTop = editor.scrollHeight;
    return;
  }
  const probe = range.cloneRange();
  probe.collapse(true);
  const rects = probe.getClientRects();
  const rect = rects.length > 0 ? rects[0] : probe.getBoundingClientRect();
  if (!rect || (rect.width === 0 && rect.height === 0 && rect.top === 0)) {
    editor.scrollTop = editor.scrollHeight;
    return;
  }
  const editorRect = editor.getBoundingClientRect();
  const pad = 6;
  if (rect.bottom > editorRect.bottom - pad) {
    editor.scrollTop += rect.bottom - editorRect.bottom + pad;
  } else if (rect.top < editorRect.top + pad) {
    editor.scrollTop -= editorRect.top - rect.top + pad;
  }
}

function isChipElement(element: HTMLElement | null): boolean {
  if (!element) return false;
  return isContextTokenElement(element) ||
    isAttachmentTokenElement(element) ||
    (element.classList?.contains("composer-token") ?? false);
}

function isSelectableComposerChip(element: HTMLElement | null): boolean {
  if (!element) return false;
  return isChipElement(element);
}

function lastZeroWidthRun(node: Node): Node {
  let current = node;
  let sibling = node.nextSibling;
  while (
    sibling &&
    sibling.nodeType === Node.ELEMENT_NODE &&
    isZeroLengthTokenElement(sibling as HTMLElement)
  ) {
    current = sibling;
    sibling = sibling.nextSibling;
  }
  return current;
}

function firstTextNode(node: Node): Text | null {
  if (node.nodeType === Node.TEXT_NODE) return node as Text;
  for (const child of Array.from(node.childNodes)) {
    const found = firstTextNode(child);
    if (found) return found;
  }
  return null;
}

function lastTextNode(node: Node): Text | null {
  if (node.nodeType === Node.TEXT_NODE) return node as Text;
  for (let index = node.childNodes.length - 1; index >= 0; index -= 1) {
    const found = lastTextNode(node.childNodes[index]);
    if (found) return found;
  }
  return null;
}

function createCaretAnchor(): HTMLElement {
  const anchor = document.createElement("span");
  anchor.className = "composer-token__text composer-token__text--caret-anchor";
  anchor.appendChild(document.createTextNode(CARET_ANCHOR_SENTINEL));
  return anchor;
}

function ensureCaretAnchorBefore(editor: HTMLElement, node: Node): HTMLElement {
  const previous = node.previousSibling as HTMLElement | null;
  if (previous && isCaretAnchorElement(previous)) return previous;
  const anchor = createCaretAnchor();
  editor.insertBefore(anchor, node);
  return anchor;
}

function ensureCaretAnchorAfter(editor: HTMLElement, node: Node): HTMLElement {
  const next = node.nextSibling as HTMLElement | null;
  if (next && isCaretAnchorElement(next)) return next;
  const anchor = createCaretAnchor();
  editor.insertBefore(anchor, node.nextSibling);
  return anchor;
}

/** 标签是否位于编辑器首行或显式换行后的行首。 */
function chipStartsEditorLine(editor: HTMLElement, chip: Node): boolean {
  let previous = chip.previousSibling;
  while (
    previous?.nodeType === Node.ELEMENT_NODE &&
    isCaretAnchorElement(previous as HTMLElement)
  ) {
    previous = previous.previousSibling;
  }
  if (!previous) return chip.parentNode === editor;
  if (
    previous.nodeType === Node.ELEMENT_NODE &&
    (previous as HTMLElement).tagName === "BR"
  ) {
    return true;
  }
  if (previous.nodeType === Node.TEXT_NODE) {
    return textNodeModelText(previous)
      .replaceAll(SKILL_TOKEN_BOUNDARY, "")
      .endsWith("\n");
  }
  const element = previous as HTMLElement;
  if (element.classList?.contains("composer-token__text")) {
    return (element.textContent ?? "")
      .replaceAll(SKILL_TOKEN_BOUNDARY, "")
      .endsWith("\n");
  }
  return false;
}

function setRangeInEditableText(range: Range, node: Node, atStart: boolean): boolean {
  const textNode = atStart ? firstTextNode(node) : lastTextNode(node);
  if (!textNode) return false;
  const skip = atStart && textNode.data.startsWith("\u200B") ? 1 : 0;
  range.setStart(
    textNode,
    atStart ? Math.min(skip, textNode.data.length) : textNode.data.length,
  );
  return true;
}

function shouldPrefixSkillBoundary(editor: HTMLElement, data: string): boolean {
  if (!data || !/^\S/.test(data)) return false;
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) return false;
  const range = selection.getRangeAt(0);
  if (!range.collapsed) return false;
  const container = range.startContainer;
  const parent = container.nodeType === Node.TEXT_NODE
    ? container.parentElement
    : container as HTMLElement;
  if (!parent || !editor.contains(parent)) return false;
  const chip = chipImmediatelyBefore(
    parent.classList?.contains("composer-token__text") ? parent : container,
  );
  if (!chip?.classList.contains("composer-token")) return false;
  if (container.nodeType !== Node.TEXT_NODE) return true;
  const before = textNodeModelText(container, range.startOffset);
  if (before.includes(SKILL_TOKEN_BOUNDARY)) return false;
  return before.length === 0;
}

function skipEmptyCaretAnchors(start: Node | null): Node | null {
  let current = start;
  while (
    current &&
    current.nodeType === Node.ELEMENT_NODE &&
    isCaretAnchorElement(current as HTMLElement) &&
    nodeTextLength(current) === 0
  ) {
    current = current.nextSibling;
  }
  return current;
}

function setRangeAfterInlineToken(range: Range, node: Node): void {
  const end = lastZeroWidthRun(node);
  const next = skipEmptyCaretAnchors(end.nextSibling) as HTMLElement | null;
  if (next && isCaretAnchorElement(next) && setRangeInCaretAnchor(range, next)) {
    return;
  }
  if (next && !isChipElement(next) && setRangeInEditableText(range, next, true)) {
    return;
  }
  const editor = end.parentElement;
  if (editor) {
    const anchor = ensureCaretAnchorAfter(editor, end);
    if (setRangeInCaretAnchor(range, anchor)) return;
  }
  range.setStartAfter(end);
}

function setRangeBeforeInlineToken(range: Range, node: Node): void {
  const previous = node.previousSibling as HTMLElement | null;
  if (
    previous &&
    isCaretAnchorElement(previous) &&
    setRangeInCaretAnchor(range, previous)
  ) {
    return;
  }
  if (
    previous &&
    !isChipElement(previous) &&
    setRangeInEditableText(range, previous, false)
  ) {
    return;
  }
  const editor = node.parentElement;
  if (editor) {
    const anchor = ensureCaretAnchorBefore(editor, node);
    if (setRangeInCaretAnchor(range, anchor)) return;
  }
  range.setStartBefore(node);
}

function chipFromNode(editor: HTMLElement, node: Node | null): HTMLElement | null {
  let current: Node | null = node;
  while (current && current !== editor) {
    if (
      current.nodeType === Node.ELEMENT_NODE &&
      isChipElement(current as HTMLElement)
    ) {
      return current as HTMLElement;
    }
    current = current.parentNode;
  }
  return null;
}

function isInvisibleBoundaryElement(element: HTMLElement): boolean {
  return element.classList.contains("composer-token__text") &&
    isSkillBoundaryText(element.textContent ?? "");
}

function isLineBreakNode(node: Node): boolean {
  if (node.nodeType === Node.ELEMENT_NODE && (node as HTMLElement).tagName === "BR") {
    return true;
  }
  if (node.nodeType === Node.TEXT_NODE) {
    return (node.textContent ?? "").includes("\n");
  }
  const element = node as HTMLElement;
  if (isChipElement(element) || isSkippableChipBoundary(element)) return false;
  return (element.textContent ?? "").includes("\n");
}

function isSkippableChipBoundary(element: HTMLElement): boolean {
  if (element.tagName === "BR") return false;
  if (isInvisibleBoundaryElement(element)) return true;
  return isCaretAnchorElement(element) && nodeTextLength(element) === 0;
}

/** 换行是硬边界：不能用 previousElementSibling，否则会跨过正文里的 `\n`。 */
function previousChipElement(start: Node | null): HTMLElement | null {
  let current = start;
  while (current) {
    if (isLineBreakNode(current)) return null;
    if (current.nodeType !== Node.ELEMENT_NODE) {
      if ((current.textContent ?? "") === "") {
        current = current.previousSibling;
        continue;
      }
      return null;
    }
    const element = current as HTMLElement;
    if (isSkippableChipBoundary(element)) {
      current = current.previousSibling;
      continue;
    }
    if (isChipElement(element)) return element;
    return null;
  }
  return null;
}

function nextChipElement(start: Node | null): HTMLElement | null {
  let current = start;
  while (current) {
    if (isLineBreakNode(current)) return null;
    if (current.nodeType !== Node.ELEMENT_NODE) {
      if ((current.textContent ?? "") === "") {
        current = current.nextSibling;
        continue;
      }
      return null;
    }
    const element = current as HTMLElement;
    if (isSkippableChipBoundary(element)) {
      current = current.nextSibling;
      continue;
    }
    if (isChipElement(element)) return element;
    return null;
  }
  return null;
}

function chipBeforeCaret(
  editor: HTMLElement,
  container: Node,
  offset: number,
): HTMLElement | null {
  const inside = chipFromNode(editor, container);
  if (inside) return inside;
  if (container.nodeType === Node.TEXT_NODE) {
    const parent = container.parentElement;
    if (!parent) return null;
    const textBeforeCaret = container.textContent?.slice(0, offset) ?? "";
    if (isCaretAnchorElement(parent)) {
      const modelBefore = caretAnchorModelText(textBeforeCaret);
      const modelAll = caretAnchorModelText(parent.textContent ?? "");
      if (textBeforeCaret.includes("\n")) return null;
      return modelBefore.length === 0 && modelAll.length === 0
        ? previousChipElement(parent.previousSibling)
        : null;
    }
    if (textBeforeCaret.includes("\n")) return null;
    if (
      container === parent.firstChild &&
      isSkillBoundaryText(textBeforeCaret)
    ) {
      return previousChipElement(parent.previousSibling);
    }
    return null;
  }
  if (container === editor) {
    for (let index = offset - 1; index >= 0; index -= 1) {
      const node = editor.childNodes[index];
      if (node.nodeType !== Node.ELEMENT_NODE) {
        if (isLineBreakNode(node)) return null;
        continue;
      }
      const element = node as HTMLElement;
      if (element.tagName === "BR") return null;
      if (element.classList.contains("composer-token__text--caret-anchor")) {
        if (caretAnchorModelText(element.textContent ?? "").length > 0) {
          return null;
        }
        continue;
      }
      if (isChipElement(element)) return element;
      return null;
    }
    return null;
  }
  const element = container as HTMLElement;
  if (element.classList?.contains("composer-token__text--caret-anchor")) {
    const modelAll = caretAnchorModelText(element.textContent ?? "");
    return modelAll.length === 0
      ? previousChipElement(element.previousSibling)
      : null;
  }
  return null;
}

function chipAfterCaret(
  editor: HTMLElement,
  container: Node,
  offset: number,
): HTMLElement | null {
  if (container.nodeType === Node.TEXT_NODE) {
    const parent = container.parentElement;
    if (!parent) return null;
    const length = container.textContent?.length ?? 0;
    if (offset < length) return null;
    return nextChipElement(parent.nextSibling);
  }
  if (container === editor) {
    for (let index = offset; index < editor.childNodes.length; index += 1) {
      const node = editor.childNodes[index];
      if (node.nodeType !== Node.ELEMENT_NODE) continue;
      const element = node as HTMLElement;
      if (element.classList.contains("composer-token__text--caret-anchor")) {
        continue;
      }
      if (isChipElement(element)) return element;
      return null;
    }
    return null;
  }
  return nextChipElement((container as HTMLElement).nextSibling);
}

function caretAnchorAtCaret(
  editor: HTMLElement,
  container: Node,
  offset: number,
): HTMLElement | null {
  if (container.nodeType === Node.TEXT_NODE) {
    const parent = container.parentElement;
    return isCaretAnchorElement(parent) ? parent : null;
  }
  if (isCaretAnchorElement(container as HTMLElement)) {
    return container as HTMLElement;
  }
  if (container === editor && offset === 0) {
    const first = editor.firstElementChild as HTMLElement | null;
    return isCaretAnchorElement(first) ? first : null;
  }
  return null;
}

/** 行首空锚点上退格时浏览器会拆出空行；前面已有正文或标签时不能拦。 */
function isEmptyLeadingCaretAnchor(
  editor: HTMLElement,
  container: Node,
  offset: number,
): boolean {
  const anchor = caretAnchorAtCaret(editor, container, offset);
  if (!anchor || !editor.contains(anchor)) return false;
  if (caretAnchorModelText(anchor.textContent ?? "").length > 0) return false;
  if (
    previousChipElement(anchor.previousSibling)
  ) {
    return false;
  }
  let previous: Node | null = anchor.previousSibling;
  while (previous) {
    if (nodeTextLength(previous) > 0) return false;
    if (
      previous.nodeType === Node.ELEMENT_NODE &&
      isChipElement(previous as HTMLElement)
    ) {
      return false;
    }
    previous = previous.previousSibling;
  }
  return true;
}

/**
 * 行首退格应删掉换行并停在上一行真正的末尾。
 * 仅看模型里的 `\n` 不够：浏览器可能用 <br>/<div> 折行，重建时过期的
 * pendingChipCaret 还会把光标吸到最后一个标签后面。
 */
function isComposerBlockElement(node: Node): boolean {
  if (node.nodeType !== Node.ELEMENT_NODE) return false;
  const tag = (node as HTMLElement).tagName;
  return tag === "DIV" || tag === "P";
}

function isIgnorableLineNode(node: Node): boolean {
  if (node.nodeType === Node.TEXT_NODE) {
    return textNodeModelText(node).length === 0;
  }
  if (node.nodeType !== Node.ELEMENT_NODE) return true;
  return isSkippableChipBoundary(node as HTMLElement);
}

function hasLineBreakBeforeNode(editor: HTMLElement, node: Node): boolean {
  let current: Node | null = node;
  while (current && current !== editor) {
    let previous = current.previousSibling;
    while (previous) {
      if (isIgnorableLineNode(previous)) {
        previous = previous.previousSibling;
        continue;
      }
      return isLineBreakNode(previous) || isComposerBlockElement(previous);
    }
    const parent: Node | null = current.parentNode;
    if (parent && parent !== editor && isComposerBlockElement(parent)) {
      current = parent;
      continue;
    }
    current = parent;
  }
  return false;
}

function caretIsAtLineStart(editor: HTMLElement, range: Range): boolean {
  if (!range.collapsed) return false;
  if (!editor.contains(range.startContainer) && range.startContainer !== editor) {
    return false;
  }
  const caret = rangePointOffset(editor, range.startContainer, range.startOffset);
  if (caret <= 0) return false;
  if (plainTextOf(editor)[caret - 1] === "\n") return true;

  const container = range.startContainer;
  const offset = range.startOffset;
  if (container.nodeType === Node.TEXT_NODE) {
    const before = (container as Text).data.slice(0, offset);
    if (before.endsWith("\n")) return true;
    if (textNodeModelText(container, offset).length > 0) return false;
    return hasLineBreakBeforeNode(editor, container);
  }
  if (container === editor) {
    for (let index = offset - 1; index >= 0; index -= 1) {
      const node = editor.childNodes[index];
      if (isIgnorableLineNode(node)) continue;
      return isLineBreakNode(node) || isComposerBlockElement(node);
    }
    return false;
  }
  const element = container as HTMLElement;
  if (isComposerBlockElement(element) && offset === 0) {
    return hasLineBreakBeforeNode(editor, element) || Boolean(element.previousSibling);
  }
  if (isCaretAnchorElement(element) && nodeTextLength(element) === 0) {
    return hasLineBreakBeforeNode(editor, element);
  }
  return hasLineBreakBeforeNode(editor, container);
}

/** 直接从 contenteditable DOM 删除当前行前的换行，避免模型偏移被行内标签吸走。 */
function deleteLineBreakBeforeCaret(
  editor: HTMLElement,
  range: Range,
): boolean {
  const selection = window.getSelection();
  if (!selection || !range.collapsed) return false;

  const place = (node: Node, offset: number): boolean => {
    const next = document.createRange();
    next.setStart(node, offset);
    next.collapse(true);
    selection.removeAllRanges();
    selection.addRange(next);
    return true;
  };

  const deleteTrailingNewline = (
    text: Text,
    rawOffset = text.data.length,
  ): boolean => {
    if (rawOffset <= 0 || text.data[rawOffset - 1] !== "\n") return false;
    text.deleteData(rawOffset - 1, 1);
    const duplicateBreak = text.nextSibling;
    if (
      duplicateBreak?.nodeType === Node.ELEMENT_NODE &&
      (duplicateBreak as HTMLElement).tagName === "BR"
    ) {
      duplicateBreak.remove();
    }
    return place(text, rawOffset - 1);
  };

  const deleteBreakNode = (breakNode: Node): boolean => {
    if (
      breakNode.nodeType !== Node.ELEMENT_NODE ||
      (breakNode as HTMLElement).tagName !== "BR"
    ) {
      return false;
    }
    const previous = breakNode.previousSibling;
    breakNode.parentNode?.removeChild(breakNode);
    if (!previous) return place(editor, 0);
    const point = lastPointInNode(previous);
    if ("afterChip" in point) {
      const next = document.createRange();
      setRangeAfterInlineToken(next, point.afterChip);
      next.collapse(true);
      selection.removeAllRanges();
      selection.addRange(next);
      return true;
    }
    return place(point.node, point.offset);
  };

  const container = range.startContainer;
  if (container.nodeType === Node.TEXT_NODE) {
    if (deleteTrailingNewline(container as Text, range.startOffset)) return true;
  } else {
    const before = container.childNodes[range.startOffset - 1];
    if (before?.nodeType === Node.TEXT_NODE) {
      if (deleteTrailingNewline(before as Text)) return true;
    }
    if (before && deleteBreakNode(before)) return true;
  }

  let current: Node | null = container;
  while (current && current !== editor) {
    let previous = current.previousSibling;
    while (previous && isIgnorableLineNode(previous)) {
      previous = previous.previousSibling;
    }
    if (previous?.nodeType === Node.TEXT_NODE) {
      if (deleteTrailingNewline(previous as Text)) return true;
    }
    if (previous && deleteBreakNode(previous)) return true;
    current = current.parentNode;
  }
  return false;
}

function lastPointInNode(node: Node): { node: Node; offset: number } | { afterChip: HTMLElement } {
  if (node.nodeType === Node.TEXT_NODE) {
    return { node, offset: (node as Text).data.length };
  }
  if (isChipElement(node as HTMLElement)) {
    return { afterChip: node as HTMLElement };
  }
  const lastText = lastTextNode(node);
  if (lastText) return { node: lastText, offset: lastText.data.length };
  const last = node.lastChild;
  if (last) return lastPointInNode(last);
  return { node, offset: node.childNodes.length };
}

function previousLineEndPoint(
  editor: HTMLElement,
  range: Range,
): { node: Node; offset: number } | { afterChip: HTMLElement } | null {
  const container = range.startContainer;
  const offset = range.startOffset;
  if (container.nodeType === Node.TEXT_NODE) {
    const before = (container as Text).data.slice(0, offset);
    const newlineAt = before.lastIndexOf("\n");
    if (newlineAt >= 0) return { node: container, offset: newlineAt };
  }

  let current: Node | null = container.nodeType === Node.TEXT_NODE || offset === 0
    ? container
    : container.childNodes[Math.max(0, offset - 1)] ?? container;

  while (current && current !== editor) {
    let previous = current.previousSibling;
    while (previous) {
      if (isIgnorableLineNode(previous)) {
        previous = previous.previousSibling;
        continue;
      }
      if (isLineBreakNode(previous) || isComposerBlockElement(previous)) {
        let end: Node | null = previous.previousSibling;
        while (end && isIgnorableLineNode(end)) end = end.previousSibling;
        if (!end) return { node: previous, offset: 0 };
        return lastPointInNode(end);
      }
      return lastPointInNode(previous);
    }
    const parent: Node | null = current.parentNode;
    if (parent && parent !== editor && isComposerBlockElement(parent)) {
      let end: Node | null = parent.previousSibling;
      while (end && isIgnorableLineNode(end)) end = end.previousSibling;
      if (!end) return null;
      return lastPointInNode(end);
    }
    current = parent;
  }
  return null;
}

function previousLineEndOffset(editor: HTMLElement, range: Range): number {
  const caret = rangePointOffset(editor, range.startContainer, range.startOffset);
  const plain = plainTextOf(editor);
  if (caret > 0 && plain[caret - 1] === "\n") return caret - 1;
  const point = previousLineEndPoint(editor, range);
  if (!point) return Math.max(0, caret - 1);
  if ("afterChip" in point) {
    return nodeTextOffset(editor, point.afterChip) +
      nodeTextLength(point.afterChip);
  }
  return rangePointOffset(editor, point.node, point.offset);
}

function placeAtPreviousLineEnd(
  editor: HTMLElement,
  range: Range,
): boolean {
  const point = previousLineEndPoint(editor, range);
  const selection = window.getSelection();
  if (!selection) return false;
  const next = document.createRange();
  if (point && "afterChip" in point) {
    setRangeAfterInlineToken(next, point.afterChip);
  } else if (point) {
    const maxOffset = point.node.nodeType === Node.TEXT_NODE
      ? (point.node as Text).data.length
      : point.node.childNodes.length;
    next.setStart(point.node, Math.min(point.offset, maxOffset));
  } else {
    return false;
  }
  next.collapse(true);
  selection.removeAllRanges();
  selection.addRange(next);
  normalizeEditorCaret(editor);
  return true;
}

/** 同一父节点内位于光标之前的正文；浏览器常把新输入切成独立文本节点。 */
function modelTextBeforeCaretInParent(
  parent: HTMLElement,
  container: Node,
  offset: number,
): string {
  let prefix = "";
  for (const child of Array.from(parent.childNodes)) {
    if (child === container) break;
    prefix += textNodeModelText(child);
  }
  return prefix + textNodeModelText(container, offset);
}

/**
 * 文件标签长度为 0，删掉标签后最后一个可见字符时浏览器会把光标甩到标签前。
 * 自行删掉该字符并把光标留在标签后，对齐技能/场景标签的退格。
 */
function deleteLastVisibleCharAfterChip(editor: HTMLElement): boolean {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) return false;
  const range = selection.getRangeAt(0);
  if (!range.collapsed) return false;
  const container = range.startContainer;
  if (container.nodeType !== Node.TEXT_NODE) return false;
  const offset = range.startOffset;
  if (offset <= 0) return false;
  const parent = container.parentElement;
  if (!parent || !editor.contains(parent)) return false;
  const prefix = modelTextBeforeCaretInParent(parent, container, offset);
  if (prefix.length !== 1 || prefix.includes("\n")) return false;
  const chip = chipImmediatelyBefore(
    parent.classList?.contains("composer-token__text") ? parent : container,
  );
  if (!chip || !editor.contains(chip)) return false;
  const text = container as Text;
  let deleteAt = offset - 1;
  while (deleteAt >= 0 && text.data[deleteAt] === CARET_ANCHOR_SENTINEL) {
    deleteAt -= 1;
  }
  if (deleteAt < 0) return false;
  text.deleteData(deleteAt, 1);
  const next = document.createRange();
  setRangeAfterInlineToken(next, chip);
  next.collapse(true);
  selection.removeAllRanges();
  selection.addRange(next);
  return true;
}

/** 斜杠菜单用：标签后可直接 `/`。跳过空锚点和零宽边界，但不跨过换行。 */
function chipImmediatelyBeforeForSlash(node: Node): HTMLElement | null {
  let current: Node | null = node.previousSibling;
  if (!current && node.parentElement && node.parentElement.parentElement) {
    current = node.parentElement.previousSibling;
  }
  while (current) {
    if (current.nodeType !== Node.ELEMENT_NODE) {
      if (
        current.nodeType === Node.TEXT_NODE &&
        (current.textContent ?? "") === ""
      ) {
        current = current.previousSibling;
        continue;
      }
      return null;
    }
    const element = current as HTMLElement;
    if (element.tagName === "BR") return null;
    if (
      isInvisibleBoundaryElement(element) ||
      isCaretAnchorElement(element)
    ) {
      current = current.previousSibling;
      continue;
    }
    return isChipElement(element) ? element : null;
  }
  return null;
}

function chipImmediatelyBefore(node: Node): HTMLElement | null {
  let current: Node | null = node.previousSibling;
  if (!current && node.parentElement && node.parentElement.parentElement) {
    current = node.parentElement.previousSibling;
  }
  while (current) {
    if (current.nodeType !== Node.ELEMENT_NODE) {
      if (
        current.nodeType === Node.TEXT_NODE &&
        (current.textContent ?? "") === ""
      ) {
        current = current.previousSibling;
        continue;
      }
      return null;
    }
    const element = current as HTMLElement;
    if (element.tagName === "BR" || isLineBreakNode(current)) return null;
    if (isSkippableChipBoundary(element)) {
      current = current.previousSibling;
      continue;
    }
    return isChipElement(element) ? element : null;
  }
  return null;
}

function editorSlashNodePrefix(editor: HTMLElement): string | null {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) return null;
  const range = selection.getRangeAt(0);
  if (!range.collapsed || !editor.contains(range.startContainer)) return null;
  const container = range.startContainer;
  const parent = container.nodeType === Node.TEXT_NODE
    ? container.parentElement
    : container as HTMLElement;
  if (!parent || !editor.contains(parent)) return null;
  const from = parent.classList?.contains("composer-token__text")
    ? parent
    : container;
  if (!chipImmediatelyBeforeForSlash(from)) return null;
  if (container.nodeType === Node.TEXT_NODE) {
    return textNodeModelText(container, range.startOffset);
  }
  if (isCaretAnchorElement(parent)) {
    return caretAnchorModelText(parent.textContent ?? "");
  }
  return "";
}

function currentSlashTrigger(
  editor: HTMLElement,
  beforeCaret: string,
): ReturnType<typeof matchSlashTrigger> {
  return resolveSlashTrigger(beforeCaret, editorSlashNodePrefix(editor));
}

/** 把输入法产生的全角/数学斜杠原位归一化，字符长度不变，因此不移动选区。 */
function normalizeEditorSlashCharacters(editor: HTMLElement): void {
  const walker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT);
  let node = walker.nextNode();
  while (node) {
    if (!chipFromNode(editor, node)) {
      const value = node.textContent ?? "";
      const normalized = normalizeComposerSlashCharacters(value);
      if (normalized !== value) node.textContent = normalized;
    }
    node = walker.nextNode();
  }
}

function chipHighlightedBySelection(range: Range, chip: Node): boolean {
  try {
    const chipRange = document.createRange();
    chipRange.selectNode(chip);
    const endsAfterChipStarts =
      range.compareBoundaryPoints(Range.START_TO_END, chipRange) > 0;
    const startsBeforeChipEnds =
      range.compareBoundaryPoints(Range.END_TO_START, chipRange) < 0;
    return startsBeforeChipEnds && endsAfterChipStarts;
  } catch {
    return false;
  }
}

function analyzeComposerSelection(editor: HTMLElement): {
  collapsed: boolean;
  start: number;
  end: number;
  removeAttachmentIds: string[];
  removeContextIds: string[];
} {
  const empty = {
    collapsed: true,
    start: 0,
    end: 0,
    removeAttachmentIds: [] as string[],
    removeContextIds: [] as string[],
  };
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) {
    const offset = plainTextOf(editor).length;
    return { ...empty, start: offset, end: offset };
  }
  const range = selection.getRangeAt(0);
  if (
    !editor.contains(range.commonAncestorContainer) &&
    range.commonAncestorContainer !== editor
  ) {
    const offset = caretOffset(editor);
    return { ...empty, start: offset, end: offset };
  }
  if (range.collapsed) {
    const offset = rangePointOffset(
      editor,
      range.startContainer,
      range.startOffset,
    );
    return { ...empty, start: offset, end: offset };
  }

  let start = rangePointOffset(editor, range.startContainer, range.startOffset);
  let end = rangePointOffset(editor, range.endContainer, range.endOffset);
  if (start > end) {
    const swap = start;
    start = end;
    end = swap;
  }

  const startChip = chipFromNode(editor, range.startContainer);
  const endChip = chipFromNode(editor, range.endContainer);
  if (startChip && isSelectableComposerChip(startChip)) {
    start = Math.min(start, nodeTextOffset(editor, startChip));
  }
  if (endChip && isSelectableComposerChip(endChip)) {
    end = Math.max(
      end,
      nodeTextOffset(editor, endChip) + nodeTextLength(endChip),
    );
  }

  const removeAttachmentIds: string[] = [];
  const removeContextIds: string[] = [];
  for (const child of Array.from(editor.childNodes)) {
    const element = child as HTMLElement;
    try {
      if (!range.intersectsNode(element)) continue;
    } catch {
      continue;
    }
    if (isAttachmentTokenElement(element)) {
      const id = element.dataset.attachmentId;
      if (id) removeAttachmentIds.push(id);
    }
    if (isContextTokenElement(element)) {
      const id = element.dataset.contextId;
      if (id) removeContextIds.push(id);
    }
  }
  return {
    collapsed: false,
    start,
    end,
    removeAttachmentIds,
    removeContextIds,
  };
}

function composerSelectionHasDeletableContent(analyzed: {
  start: number;
  end: number;
  removeAttachmentIds: string[];
  removeContextIds: string[];
}): boolean {
  return analyzed.start !== analyzed.end ||
    analyzed.removeAttachmentIds.length > 0 ||
    analyzed.removeContextIds.length > 0;
}

function normalizeEditorCaret(editor: HTMLElement): void {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) return;
  const range = selection.getRangeAt(0);
  if (!range.collapsed || !editor.contains(range.startContainer)) return;
  const inside = chipFromNode(editor, range.startContainer);
  if (inside) {
    const next = document.createRange();
    setRangeAfterInlineToken(next, inside);
    next.collapse(true);
    selection.removeAllRanges();
    selection.addRange(next);
    return;
  }
  if (range.startContainer !== editor) return;
  const previous = editor.childNodes[range.startOffset - 1];
  if (
    previous?.nodeType === Node.ELEMENT_NODE &&
    isChipElement(previous as HTMLElement)
  ) {
    const next = document.createRange();
    setRangeAfterInlineToken(next, previous);
    next.collapse(true);
    selection.removeAllRanges();
    selection.addRange(next);
    return;
  }
  const following = editor.childNodes[range.startOffset];
  if (
    following?.nodeType === Node.ELEMENT_NODE &&
    isChipElement(following as HTMLElement)
  ) {
    const next = document.createRange();
    setRangeBeforeInlineToken(next, following);
    next.collapse(true);
    selection.removeAllRanges();
    selection.addRange(next);
  }
}

function placeCaretAfterChip(
  editor: HTMLElement,
  target: PendingChipCaretTarget,
): boolean {
  const chip = findComposerChip(editor, target.chipKey);
  if (!chip || nodeTextOffset(editor, chip) !== target.offset) {
    return false;
  }
  const selection = window.getSelection();
  if (!selection) return false;
  const range = document.createRange();
  setRangeAfterInlineToken(range, chip);
  range.collapse(true);
  selection.removeAllRanges();
  selection.addRange(range);
  return true;
}

/** 把光标恢复到纯文本模型中的指定偏移。 */
function setCaretOffset(editor: HTMLElement, offset: number): void {
  const selection = window.getSelection();
  if (!selection) return;
  const range = document.createRange();
  let remaining = Math.min(offset, plainTextOf(editor).length);
  const place = (node: Node, insideOffset: number): boolean => {
    for (const child of Array.from(node.childNodes)) {
      const length = nodeTextLength(child);
      const childElement = child as HTMLElement;
      if (length === 0 && isZeroLengthTokenElement(childElement)) continue;
      if (insideOffset <= length) {
        if (isCaretAnchorElement(childElement)) {
          return setRangeInCaretAnchor(range, childElement, insideOffset);
        }
        if (child.nodeType === Node.TEXT_NODE) {
          if (insideOffset === length) {
            const from =
              child.parentNode &&
              child.parentNode !== editor &&
              (child.parentNode as HTMLElement).classList.contains(
                "composer-token__text",
              )
                ? child.parentNode
                : child;
            const next = (from as Node).nextSibling as HTMLElement | null;
            if (next && isChipElement(next)) {
              setRangeBeforeInlineToken(range, next);
            } else {
              range.setStart(child, length);
            }
          } else {
            range.setStart(child, insideOffset);
          }
          return true;
        }
        if (childElement.classList?.contains("composer-token__text")) {
          return place(child, insideOffset);
        }
        if (childElement.classList?.contains("composer-token")) {
          if (insideOffset === 0) {
            setRangeBeforeInlineToken(range, childElement);
            return true;
          }
          setRangeAfterInlineToken(range, childElement);
          return true;
        }
        if (insideOffset === 0) {
          range.setStartBefore(child);
          return true;
        }
        if (insideOffset === length) {
          setRangeAfterInlineToken(range, child);
          return true;
        }
        return place(child, insideOffset);
      }
      insideOffset -= length;
    }
    return false;
  };
  if (place(editor, remaining)) {
    range.collapse(true);
  } else {
    const last = editor.lastChild;
    if (last && isChipElement(last as HTMLElement)) {
      setRangeAfterInlineToken(range, last);
      range.collapse(true);
    } else {
      range.selectNodeContents(editor);
      range.collapse(false);
    }
  }
  selection.removeAllRanges();
  selection.addRange(range);
  normalizeEditorCaret(editor);
}

/** 指定节点在编辑器纯文本模型中的起始偏移。 */
function nodeTextOffset(root: HTMLElement, node: Node): number {
  let sum = 0;
  let current: Node | null = node;
  while (current && current !== root) {
    const parent: ParentNode | null = current.parentNode;
    if (!parent) break;
    for (
      let sibling = parent.firstChild;
      sibling && sibling !== current;
      sibling = sibling.nextSibling
    ) {
      sum += nodeTextLength(sibling);
    }
    current = parent;
  }
  return sum;
}

function composerChipKey(editor: HTMLElement, chip: HTMLElement): string | null {
  if (isAttachmentTokenElement(chip)) {
    return chip.dataset.attachmentId
      ? `a:${chip.dataset.attachmentId}`
      : null;
  }
  if (isContextTokenElement(chip)) {
    return chip.dataset.contextId ? `c:${chip.dataset.contextId}` : null;
  }
  if (chip.classList.contains("composer-token")) {
    return `s:${chip.dataset.cmd ?? ""}:${nodeTextOffset(editor, chip)}`;
  }
  return null;
}

function findComposerChip(
  editor: HTMLElement,
  key: string,
): HTMLElement | null {
  for (const child of Array.from(editor.children)) {
    const element = child as HTMLElement;
    if (composerChipKey(editor, element) === key) return element;
  }
  return null;
}

function paintPendingDeleteChip(
  editor: HTMLElement,
  key: string | null,
): void {
  for (const child of Array.from(
    editor.querySelectorAll(".is-pending-delete"),
  )) {
    child.classList.remove("is-pending-delete");
  }
  if (!key) return;
  findComposerChip(editor, key)?.classList.add("is-pending-delete");
}

function paintSelectedComposerChips(
  editor: HTMLElement,
  selection: Selection | null = window.getSelection(),
): void {
  for (const chip of Array.from(
    editor.querySelectorAll(".is-selection-selected"),
  )) {
    chip.classList.remove("is-selection-selected");
  }
  if (!selection || selection.rangeCount === 0) return;
  const range = selection.getRangeAt(0);
  if (range.collapsed) return;
  for (const chip of Array.from(
    editor.querySelectorAll(
      ".composer-token, .composer-attachment-token, .composer-context-token",
    ),
  )) {
    if (chipHighlightedBySelection(range, chip)) {
      chip.classList.add("is-selection-selected");
    }
  }
}

function attachmentMarks(
  attachments: readonly PublicAttachment[],
  anchors: Readonly<Record<string, number>>,
): Array<{ id: string; offset: number }> {
  return attachments
    .map((attachment, index) => ({
      id: attachment.id,
      offset: Math.max(0, anchors[attachment.id] ?? 0),
      index,
    }))
    .sort((left, right) => left.offset - right.offset || left.index - right.index)
    .map(({ id, offset }) => ({ id, offset }));
}

function liveAttachmentState(
  editor: HTMLElement,
  attachments: readonly PublicAttachment[],
): {
  attachments: PublicAttachment[];
  anchors: Record<string, number>;
  removed: PublicAttachment[];
} {
  const read = readAttachmentAnchors(editor);
  const nextAttachments: PublicAttachment[] = [];
  const anchors: Record<string, number> = {};
  const removed: PublicAttachment[] = [];
  for (const attachment of attachments) {
    if (attachment.id in read) {
      nextAttachments.push(attachment);
      anchors[attachment.id] = read[attachment.id];
    } else {
      removed.push(attachment);
    }
  }
  return { attachments: nextAttachments, anchors, removed };
}

function readAttachmentAnchors(editor: HTMLElement): Record<string, number> {
  const out: Record<string, number> = {};
  let pos = 0;
  for (const child of Array.from(editor.childNodes)) {
    const element = child as HTMLElement;
    if (isAttachmentTokenElement(element)) {
      const id = element.dataset.attachmentId;
      if (id) out[id] = pos;
      continue;
    }
    pos += nodeTextLength(child);
  }
  return out;
}

/** 标签结构签名：记录上下文/附件位置/技能 token 序列，普通打字不触发重建。 */
function structureSignature(
  tokens: ComposerToken[],
  contextTokens: EditorContextToken[] = [],
  attachments: Array<{ id: string; offset: number }> = [],
): string {
  const contextParts = contextTokens.map((token) =>
    `c:${token.id}:${token.label}`,
  );
  const attachmentParts = attachments.map((item) => `a:${item.id}:${item.offset}`);
  const tokenParts = tokens.map((token) =>
    token.type === "tag"
      ? `t:${token.text.toLowerCase()}:${token.label ?? ""}`
      : "p"
  );
  return [...contextParts, ...attachmentParts, ...tokenParts].join("|");
}

function pushMergedTextPart(parts: string[], length: number): number {
  if (length <= 0) return 0;
  if (parts[parts.length - 1] !== "p") parts.push("p");
  return length;
}

function editorStructureSignature(editor: HTMLElement): string {
  const contextParts: string[] = [];
  const attachmentParts: string[] = [];
  const tokenParts: string[] = [];
  let pos = 0;
  for (const child of Array.from(editor.childNodes)) {
    const element = child as HTMLElement;
    if (isContextTokenElement(element)) {
      contextParts.push(
        `c:${element.dataset.contextId ?? ""}:${element.dataset.label ?? ""}`,
      );
      continue;
    }
    if (isAttachmentTokenElement(element)) {
      attachmentParts.push(`a:${element.dataset.attachmentId ?? ""}:${pos}`);
      continue;
    }
    if (element.classList?.contains("composer-token")) {
      tokenParts.push(
        `t:${(element.dataset.cmd ?? "").toLowerCase()}:${element.dataset.label ?? ""}`,
      );
      pos += nodeTextLength(child);
      continue;
    }
    if (element.tagName === "BR") {
      pos += pushMergedTextPart(tokenParts, 1);
      continue;
    }
    if (
      isCaretAnchorElement(element) ||
      child.nodeType === Node.TEXT_NODE ||
      element.classList?.contains("composer-token__text")
    ) {
      pos += pushMergedTextPart(tokenParts, nodeTextLength(child));
    }
  }
  return [...contextParts, ...attachmentParts, ...tokenParts].join("|");
}

function appendComposerChipLead(
  tag: HTMLElement,
  removeClassName: string,
  removeLabel: string,
  glyph?: HTMLElement,
): void {
  const lead = document.createElement("span");
  lead.className = "composer-chip-lead";
  if (glyph) lead.appendChild(glyph);
  const remove = document.createElement("span");
  remove.className = removeClassName;
  remove.setAttribute("role", "button");
  remove.setAttribute("aria-label", removeLabel);
  remove.textContent = "×";
  lead.appendChild(remove);
  tag.appendChild(lead);
}

function appendContextToken(editor: HTMLElement, token: EditorContextToken): void {
  const tag = document.createElement("span");
  tag.className = `composer-context-token composer-context-token--${token.id}`;
  tag.contentEditable = "false";
  tag.dataset.contextId = token.id;
  tag.dataset.label = token.label;
  if (token.title) tag.title = token.title;

  const glyph = document.createElement("span");
  glyph.className = "composer-token__skill-icon";
  glyph.setAttribute("aria-hidden", "true");
  appendComposerChipLead(
    tag,
    "composer-context-token__remove",
    token.removeLabel,
    glyph,
  );

  const label = document.createElement("span");
  label.className = "composer-context-token__label";
  label.textContent = token.label;
  tag.appendChild(label);

  editor.appendChild(tag);
}

function appendAttachmentToken(
  editor: HTMLElement,
  attachment: PublicAttachment,
): void {
  const tag = document.createElement("span");
  tag.className = "composer-attachment-token";
  tag.contentEditable = "false";
  tag.dataset.attachmentId = attachment.id;
  tag.title = attachment.name;

  const glyph = document.createElement("span");
  glyph.className = "composer-attachment-token__glyph";
  glyph.setAttribute("aria-hidden", "true");
  appendComposerChipLead(
    tag,
    "composer-attachment-token__remove",
    `删除附件 ${attachment.name}`,
    glyph,
  );

  const label = document.createElement("span");
  label.className = "composer-attachment-token__label";
  label.textContent = attachment.name;
  tag.appendChild(label);

  editor.appendChild(tag);
}

function appendTextSpan(editor: HTMLElement, text: string): void {
  if (text === "") return;
  const span = document.createElement("span");
  span.className = "composer-token__text";
  span.textContent = text;
  editor.appendChild(span);
}

function appendSkillToken(editor: HTMLElement, token: ComposerToken): void {
  const tag = document.createElement("span");
  tag.className = "composer-token";
  tag.contentEditable = "false";
  tag.dataset.cmd = token.text;
  tag.dataset.label = token.label ?? "";
  const sceneIcon = composerSceneIconId(token.text);
  const glyph = document.createElement("span");
  glyph.setAttribute("aria-hidden", "true");
  if (sceneIcon) {
    tag.dataset.icon = sceneIcon;
    glyph.className = "composer-token__scene-icon";
  } else {
    glyph.className = "composer-token__skill-icon";
  }
  appendComposerChipLead(
    tag,
    "composer-token__remove",
    `移除技能 ${token.text}`,
    glyph,
  );
  const label = document.createElement("span");
  label.className = "composer-token__label";
  label.textContent = token.label || token.text.replace(/^\//, "");
  tag.appendChild(label);
  editor.appendChild(tag);
}

/** 按 token 重建编辑器 DOM（上下文、附件按偏移插入、技能标签与正文）。 */
function rebuildEditorDOM(
  editor: HTMLElement,
  tokens: ComposerToken[],
  contextTokens: EditorContextToken[] = [],
  editorAttachments: readonly PublicAttachment[] = [],
  attachmentAnchors: Readonly<Record<string, number>> = {},
): void {
  editor.textContent = "";
  for (const contextToken of contextTokens) {
    appendContextToken(editor, contextToken);
  }
  const placed = editorAttachments
    .map((attachment, index) => ({
      attachment,
      offset: Math.max(0, attachmentAnchors[attachment.id] ?? 0),
      index,
    }))
    .sort((left, right) => left.offset - right.offset || left.index - right.index);
  let nextAttachment = 0;
  const flushAttachments = (at: number): void => {
    while (
      nextAttachment < placed.length &&
      placed[nextAttachment].offset <= at
    ) {
      appendAttachmentToken(editor, placed[nextAttachment].attachment);
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
          appendTextSpan(editor, str.slice(index));
          pos += remaining;
          break;
        }
        const take = upcoming.offset - pos;
        if (take > 0) {
          appendTextSpan(editor, str.slice(index, index + take));
          index += take;
          pos += take;
        }
        flushAttachments(pos);
      }
      continue;
    }
    flushAttachments(pos);
    appendSkillToken(editor, token);
    pos += token.text.length;
  }
  flushAttachments(Number.POSITIVE_INFINITY);
  for (const child of Array.from(editor.childNodes)) {
    if (isChipElement(child as HTMLElement)) {
      if (chipStartsEditorLine(editor, child)) {
        ensureCaretAnchorBefore(editor, child);
      }
      ensureCaretAnchorAfter(editor, child);
    }
  }
}

export default function Composer({ sendDisabled = false, processing = false, testingPublishField }: { sendDisabled?: boolean; processing?: boolean; testingPublishField?: string } = {}) {
  const {
    sendMessage,
    abortGeneration,
    busy,
    theme,
    mode,
    setMode,
    permission,
    setPermission,
    currentConvId,
    conversations,
    messages,
    workspaces,
    composerWorkspaceId,
    activateWorkspace,
    resetToWelcome,
    openWorkspaceCreator,
    setCategory,
    setExpertPanelTab,
    consumeExpertComposerBootstrap,
    expertComposerBootstrap,
    expertComposerExperts,
    setExpertComposerExpert,
    clearExpertComposerExpert,
    composerConnectors: activeConnectors,
    addComposerConnector: addActiveConnector,
    removeComposerConnector,
  } = useStore();
  const [text, setText] = useState("");
  useEffect(() => {
    const receive = (event: Event) => {
      const detail = (event as CustomEvent<{ conversationId: string; text: string }>).detail;
      if (busy || detail?.conversationId !== currentConvId || typeof detail.text !== 'string') return;
      setText(previous => previous.trim() ? `${previous}\n\n${detail.text}` : detail.text);
    };
    window.addEventListener('picoddy:preview-compose', receive);
    return () => window.removeEventListener('picoddy:preview-compose', receive);
  }, [busy, currentConvId]);
  const [attachments, setAttachments] = useState<PublicAttachment[]>([]);
  const [attachmentAnchors, setAttachmentAnchors] = useState<
    Record<string, number>
  >({});
  const [uploading, setUploading] = useState(false);
  const [sending, setSending] = useState(false);
  const [attachmentError, setAttachmentError] = useState<string | null>(null);
  const [isFileDragActive, setIsFileDragActive] = useState(false);
  const [slashQuery, setSlashQuery] = useState<string | null>(null);
  const [slashSkillQuery, setSlashSkillQuery] = useState<string | null>(null);
  const [slashIndex, setSlashIndex] = useState(0);
  const [showExpertManagerToken, setShowExpertManagerToken] = useState(false);
  const [isComposing, setIsComposing] = useState(false);
  const {
    skills,
    experts,
    loading,
    loadSkills,
    mcpConfig,
    mcpConnected,
    mcpEnterpriseError,
    connectMcp,
    startExpertChat,
  } = useSkillStore();
  const activePluginCapability = usePluginStore((state) => state.activeCapability);
  const attachmentsRef = useRef<PublicAttachment[]>([]);
  const sendingAttachmentsRef = useRef<PublicAttachment[]>([]);
  const fileDragDepthRef = useRef(0);
  const mountedRef = useRef(true);


  const uploadInFlightRef = useRef(false);
  const sendInFlightRef = useRef(false);
  const currentConversation = conversations.find(
    (conversation) => conversation.id === currentConvId,
  );
  const isSkillCreator = currentConversation?.category === "skill_creator";
  const isExpertCreator = currentConversation?.category === "expert_creator";
  const isCreatorConversation = isSkillCreator || isExpertCreator;
  const skillCreatorContext = creatorComposerContext(currentConversation, messages);
  const expertComposerExpert = isExpertCreator && currentConvId
    ? expertComposerExperts[currentConvId]
    : undefined;
  const skillCreatorContextLabel = skillCreatorContext?.label;
  const expertComposerExpertName = expertComposerExpert?.name;
  const editorContextTokens = useMemo<EditorContextToken[]>(() => {
    const contextTokens: EditorContextToken[] = [];
    if (skillCreatorContextLabel) {
      contextTokens.push({
        id: "skill-creator",
        label: skillCreatorContextLabel,
        removeLabel: "移除 skill-creator 标签并退出技能创建流程",
        title: "当前技能创建流程上下文",
      });
    }
    if (isExpertCreator && showExpertManagerToken) {
      contextTokens.push({
        id: "expert-manager",
        label: EXPERT_MANAGER_SKILL_COMMAND.slice(1),
        removeLabel: "移除 expert-manager 标签",
        title: "当前专家创建流程使用的 expert-manager 上下文",
      });
    }
    if (expertComposerExpertName) {
      contextTokens.push({
        id: "selected-expert",
        label: expertComposerExpertName,
        removeLabel: `移除专家 ${expertComposerExpertName}`,
      });
    }
    return contextTokens;
  }, [
    expertComposerExpertName,
    isExpertCreator,
    showExpertManagerToken,
    skillCreatorContextLabel,
  ]);

  const runningSubAgent = conversations.find(
    (c) => Boolean(currentConvId) && c.parentId === currentConvId && c.status === "running",
  );
  const [showModeMenu, setShowModeMenu] = useState(false);
  const [showWsPicker, setShowWsPicker] = useState(false);
  const editorRef = useRef<HTMLDivElement>(null);
  const slashMenuListRef = useRef<HTMLDivElement>(null);
  const composingRef = useRef(false);
  const skipImeEnterRef = useRef(false);
  const pendingCaretRef = useRef<number | null>(null);
  const pendingChipCaretRef = useRef<PendingChipCaretTarget | null>(null);
  const pendingDeleteKeyRef = useRef<string | null>(null);
  const lastFocusedCaretRef = useRef(0);
  const renderedStructureRef = useRef("");
  const modeMenuRef = useRef<HTMLDivElement>(null);
  const mouseSelectingRef = useRef(false);
  const mouseDownChipRef = useRef<HTMLElement | null>(null);
  const attachmentAnchorsRef = useRef<Record<string, number>>({});
  const attachmentCleanupRef = useRef(new Map<string, PublicAttachment>());
  const attachmentCleanupInFlightRef = useRef(new Set<string>());
  attachmentAnchorsRef.current = attachmentAnchors;

  const replaceAttachments = (next: PublicAttachment[]) => {
    attachmentsRef.current = next;
    setAttachments(next);
  };

  const queueAttachmentCleanup = (
    removed: readonly PublicAttachment[],
  ): void => {
    for (const attachment of removed) {
      attachmentCleanupRef.current.set(attachment.id, attachment);
    }
    for (const [id] of attachmentCleanupRef.current) {
      if (attachmentCleanupInFlightRef.current.has(id)) continue;
      attachmentCleanupInFlightRef.current.add(id);
      void deletePendingAttachment(id).then(() => {
        attachmentCleanupRef.current.delete(id);
      }).catch((error) => {
        if (mountedRef.current) {
          setAttachmentError((error as Error).message || "附件删除失败");
        }
      }).finally(() => {
        attachmentCleanupInFlightRef.current.delete(id);
      });
    }
  };

  useEffect(() => {
    mountedRef.current = true;
    const cleanupQueue = attachmentCleanupRef.current;
    const cleanupInFlight = attachmentCleanupInFlightRef.current;
    return () => {
      mountedRef.current = false;
      const sendingIds = new Set(
        sendingAttachmentsRef.current.map((attachment) => attachment.id),
      );
      const pending = attachmentsRef.current.filter(
        (attachment) => !sendingIds.has(attachment.id),
      );
      for (const attachment of cleanupQueue.values()) {
        if (!sendingIds.has(attachment.id)) pending.push(attachment);
      }
      attachmentsRef.current = [];
      cleanupQueue.clear();
      cleanupInFlight.clear();
      new Map(pending.map((attachment) => [attachment.id, attachment]))
        .forEach((attachment) => {
          void deletePendingAttachment(attachment.id).catch(() => undefined);
        });
    };
  }, []);

  useEffect(() => {
    if (!attachmentError) return;
    const timer = window.setTimeout(() => {
      setAttachmentError(null);
    }, 2800);
    return () => window.clearTimeout(timer);
  }, [attachmentError]);

  useEffect(() => {
    setSlashQuery(null);
    setSlashSkillQuery(null);
    setShowModeMenu(false);
    pendingChipCaretRef.current = null;
    pendingDeleteKeyRef.current = null;
    setShowExpertManagerToken(currentConversation?.category === "expert_creator");
  }, [currentConvId, currentConversation?.category]);

  useEffect(() => {
    if (isExpertCreator && skills.length === 0) void loadSkills();
  }, [isExpertCreator, loadSkills, skills.length]);

  useEffect(() => {
    if (
      (slashQuery !== null || slashSkillQuery !== null) &&
      skills.length === 0
    ) {
      void loadSkills();
    }
  }, [loadSkills, skills.length, slashQuery, slashSkillQuery]);

  useEffect(() => {
    const bootstrap = consumeExpertComposerBootstrap(currentConvId);
    if (bootstrap === null) return;
    pendingCaretRef.current = bootstrap.text.length;
    setText(bootstrap.text);
    setShowExpertManagerToken(bootstrap.expertManagerToken);
  }, [consumeExpertComposerBootstrap, currentConvId, expertComposerBootstrap]);

  // 可渲染为行内标签的命令集：已启用技能 + 全部斜杠指令（含内置技能）
  const knownSkillCommands = useMemo(() => {
    const commands = new Set<string>();
    for (const skill of skills) {
      if (!skill.disabled) commands.add(`/${skill.name}`.toLowerCase());
    }
    for (const command of SLASH_COMMANDS) {
      commands.add(command.cmd.toLowerCase());
    }
    for (const skill of WELCOME_FIXED_SKILLS) {
      commands.add(skill.command.toLowerCase());
    }
    return commands;
  }, [skills]);

  const skillDisplayLabels = useMemo(() => {
    const labels = new Map<string, string>();
    for (const skill of skills) {
      if (!skill.disabled) {
        labels.set(
          `/${skill.name}`.toLowerCase(),
          skill.displayName || skill.name,
        );
      }
    }
    for (const command of SLASH_COMMANDS) {
      labels.set(command.cmd.toLowerCase(), command.name);
    }
    for (const skill of WELCOME_FIXED_SKILLS) {
      labels.set(skill.command.toLowerCase(), skill.label);
    }
    return labels;
  }, [skills]);

  const databaseSkillSlashCommands = useMemo<SlashCommand[]>(
    () => skills
      .filter((skill) => !skill.disabled)
      .map((skill) => ({
        cmd: `/${skill.name}`,
        name: skill.displayName || skill.name,
        desc: skill.description || `/${skill.name}`,
        icon: skillInitial(skill),
        category: "skill" as const,
        action: () => undefined,
      })),
    [skills],
  );

  const completeSlashCommands = useMemo(
    () => mergeUniqueSlashCommands(databaseSkillSlashCommands, SLASH_COMMANDS),
    [databaseSkillSlashCommands],
  );

  const expertSkillsInText = useMemo(() => {
    if (!isExpertCreator) return [];
    const namesByCommand = new Map(
      skills
        .filter((skill) => !skill.disabled)
        .map((skill) => [`/${skill.name}`.toLowerCase(), skill.name]),
    );
    const selected: string[] = [];
    const seen = new Set<string>();
    for (const token of tokenizeSkillCommands(
      text,
      knownSkillCommands,
      skillDisplayLabels,
    )) {
      if (token.type !== "tag") continue;
      const name = namesByCommand.get(token.text.toLowerCase());
      if (!name || seen.has(name.toLowerCase())) continue;
      seen.add(name.toLowerCase());
      selected.push(name);
    }
    return selected;
  }, [isExpertCreator, knownSkillCommands, skillDisplayLabels, skills, text]);

  // 纯文本模型 ↔ 编辑器 DOM 的调和：标签结构变化或正文与模型不一致时重建 DOM
  const reconcileEditor = useCallback((plain: string, caret: number | null) => {
    const editor = editorRef.current;
    if (!editor || composingRef.current) return;
    const restoreChipCaret = (): boolean => {
      const target = pendingChipCaretRef.current;
      pendingChipCaretRef.current = null;
      if (!target || !placeCaretAfterChip(editor, target)) return false;
      lastFocusedCaretRef.current = target.offset;
      return true;
    };
    const tokens = tokenizeSkillCommands(
      plain,
      knownSkillCommands,
      skillDisplayLabels,
    );
    const signature = structureSignature(
      tokens,
      editorContextTokens,
      attachmentMarks(attachments, attachmentAnchors),
    );
    const structureUnchanged = signature === renderedStructureRef.current &&
      editorStructureSignature(editor) === signature;
    if (structureUnchanged && plainTextOf(editor) === plain) {
      if (!restoreChipCaret() && caret !== null) {
        setCaretOffset(editor, caret);
        lastFocusedCaretRef.current = caret;
      }
      return;
    }
    rebuildEditorDOM(
      editor,
      tokens,
      editorContextTokens,
      attachments,
      attachmentAnchors,
    );
    renderedStructureRef.current = signature;
    // When a picker is clicked the editor loses focus before the context
    // token/skill state is reconciled.  Reading caretOffset at that point
    // returns the selection owned by the picker (usually position 0), which
    // makes the next rebuild jump to the beginning.  The focused-caret ref is
    // deliberately kept while the editor is active, so use it as the stable
    // fallback whenever no explicit caret was queued.
    const restore = caret ?? lastFocusedCaretRef.current;
    if (!restoreChipCaret()) {
      setCaretOffset(editor, restore);
      lastFocusedCaretRef.current = restore;
    }
    paintPendingDeleteChip(editor, pendingDeleteKeyRef.current);
    scrollComposerCaretIntoView(editor);
  }, [
    attachmentAnchors,
    attachments,
    editorContextTokens,
    knownSkillCommands,
    skillDisplayLabels,
  ]);

  const [editorEpoch, setEditorEpoch] = useState(0);
  // Run before passive bootstrap effects queue text and its caret together.
  // A passive reconciliation could consume that caret against the old text.
  useLayoutEffect(() => {
    const caret = pendingCaretRef.current;
    pendingCaretRef.current = null;
    if (caret !== null) editorRef.current?.focus();
    reconcileEditor(text, caret);
  }, [text, editorEpoch, reconcileEditor]);

  useEffect(() => {
    const rememberFocusedCaret = () => {
      const editor = editorRef.current;
      if (!editor) return;
      const selection = window.getSelection();
      const selectionInEditor = Boolean(
        selection &&
          (editor.contains(selection.anchorNode) ||
            editor.contains(selection.focusNode)),
      );
      paintSelectedComposerChips(
        editor,
        selectionInEditor ? selection : null,
      );
      if (document.activeElement !== editor) return;
      if (composingRef.current) return;
      if (mouseSelectingRef.current) return;
      if (!selection || selection.rangeCount === 0) return;
      if (!editor.contains(selection.anchorNode)) return;
      normalizeEditorCaret(editor);
      lastFocusedCaretRef.current = caretOffset(editor);
      const range = selection.rangeCount > 0 ? selection.getRangeAt(0) : null;
      if (!range || !pendingDeleteKeyRef.current) return;
      const chip = chipBeforeCaret(editor, range.startContainer, range.startOffset);
      const key = chip ? composerChipKey(editor, chip) : null;
      if (key !== pendingDeleteKeyRef.current) {
        pendingDeleteKeyRef.current = null;
        paintPendingDeleteChip(editor, null);
      }
    };
    document.addEventListener("selectionchange", rememberFocusedCaret);
    return () => {
      document.removeEventListener("selectionchange", rememberFocusedCaret);
    };
  }, []);

  useEffect(() => {
    const finishMouseSelect = () => {
      if (!mouseSelectingRef.current) return;
      mouseSelectingRef.current = false;
      const editor = editorRef.current;
      const chip = mouseDownChipRef.current;
      mouseDownChipRef.current = null;
      if (!editor) return;
      const selection = window.getSelection();
      if (!selection || selection.rangeCount === 0) return;
      const range = selection.getRangeAt(0);
      if (!range.collapsed) {
        paintSelectedComposerChips(editor, selection);
        lastFocusedCaretRef.current = Math.min(
          rangePointOffset(editor, range.startContainer, range.startOffset),
          rangePointOffset(editor, range.endContainer, range.endOffset),
        );
        return;
      }
      if (chip && editor.contains(chip) && isSelectableComposerChip(chip)) {
        const next = document.createRange();
        setRangeAfterInlineToken(next, chip);
        next.collapse(true);
        selection.removeAllRanges();
        selection.addRange(next);
      } else {
        normalizeEditorCaret(editor);
      }
      lastFocusedCaretRef.current = caretOffset(editor);
    };
    document.addEventListener("mouseup", finishMouseSelect);
    return () => {
      document.removeEventListener("mouseup", finishMouseSelect);
    };
  }, []);

  useEffect(() => {
    if (!showModeMenu) return;
    const handler = (e: MouseEvent) => {
      if (
        modeMenuRef.current && !modeMenuRef.current.contains(e.target as Node)
      ) {
        setShowModeMenu(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [showModeMenu]);

  const clearPendingDeleteChip = () => {
    pendingDeleteKeyRef.current = null;
    const editor = editorRef.current;
    if (editor) paintPendingDeleteChip(editor, null);
  };

  const setSlashMenuTrigger = (
    trigger: ReturnType<typeof matchSlashTrigger>,
  ): void => {
    if (trigger?.type === "skill") {
      setSlashSkillQuery(trigger.query);
      setSlashQuery(null);
      setSlashIndex(0);
      return;
    }
    if (trigger?.type === "command") {
      setSlashQuery(trigger.query);
      setSlashSkillQuery(null);
      setSlashIndex(0);
      return;
    }
    setSlashQuery(null);
    setSlashSkillQuery(null);
  };

  const pruneMissingAttachments = (editor: HTMLElement) => {
    const live = liveAttachmentState(editor, attachmentsRef.current);
    if (live.removed.length > 0) {
      replaceAttachments(live.attachments);
      queueAttachmentCleanup(live.removed);
    }
    const previous = attachmentAnchorsRef.current;
    const anchorsChanged = live.attachments.some(
      (attachment) => previous[attachment.id] !== live.anchors[attachment.id],
    ) || Object.keys(previous).length !== Object.keys(live.anchors).length;
    if (anchorsChanged) setAttachmentAnchors(live.anchors);
    return live;
  };

  const pruneMissingContextTokens = (editor: HTMLElement) => {
    const live = new Set<string>();
    for (const node of Array.from(
      editor.querySelectorAll(".composer-context-token"),
    )) {
      const id = (node as HTMLElement).dataset.contextId;
      if (id) live.add(id);
    }
    for (const token of editorContextTokens) {
      if (live.has(token.id)) continue;
      if (token.id === "skill-creator") {
        resetToWelcome();
      } else if (token.id === "expert-manager") {
        setShowExpertManagerToken(false);
      } else if (token.id === "selected-expert" && currentConvId) {
        clearExpertComposerExpert(currentConvId);
      }
    }
  };

  const commitComposerSelectionDelete = (
    editor: HTMLElement,
    insertText = "",
  ): { text: string; caret: number } | null => {
    const analyzed = analyzeComposerSelection(editor);
    if (!composerSelectionHasDeletableContent(analyzed)) {
      return null;
    }
    clearPendingDeleteChip();
    const result = applyComposerSelectionDelete({
      text: plainTextOf(editor),
      rangeStart: analyzed.start,
      rangeEnd: analyzed.end,
      removeAttachmentIds: analyzed.removeAttachmentIds,
      attachments: attachmentsRef.current,
      anchors: attachmentAnchorsRef.current,
    });
    const removedAttachments = attachmentsRef.current.filter((attachment) =>
      analyzed.removeAttachmentIds.includes(attachment.id)
    );
    queueAttachmentCleanup(removedAttachments);
    replaceAttachments(result.attachments);
    setAttachmentAnchors(result.anchors);
    for (const contextId of analyzed.removeContextIds) {
      if (contextId === "skill-creator") {
        resetToWelcome();
      } else if (contextId === "expert-manager") {
        setShowExpertManagerToken(false);
      } else if (contextId === "selected-expert" && currentConvId) {
        clearExpertComposerExpert(currentConvId);
      }
    }
    const normalizedInsertText = normalizeComposerSlashCharacters(insertText);
    const nextText = result.text.slice(0, result.caret) +
      normalizedInsertText +
      result.text.slice(result.caret);
    const nextCaret = result.caret + normalizedInsertText.length;
    pendingCaretRef.current = nextCaret;
    setText(nextText);
    setSlashMenuTrigger(matchSlashTrigger(nextText.slice(0, nextCaret)));
    if (analyzed.removeContextIds.length > 0) {
      setEditorEpoch((epoch) => epoch + 1);
    }
    return { text: nextText, caret: nextCaret };
  };

  const handleFilesSelected = async (
    files: File[],
    preferredInsertAt?: number,
  ) => {
    console.log("[Composer] handleFilesSelected called, files:", files.length, "busy:", busy, "uploadInFlight:", uploadInFlightRef.current);
    if (busy || sendInFlightRef.current || uploadInFlightRef.current) {
      setAttachmentError(
        uploadInFlightRef.current
          ? "附件正在上传，请稍候"
          : "当前任务进行中，暂时无法添加附件",
      );
      return;
    }
    clearPendingDeleteChip();
    const editor = editorRef.current;
    const insertAt = typeof preferredInsertAt === "number" &&
        Number.isFinite(preferredInsertAt)
      ? Math.max(0, Math.floor(preferredInsertAt))
      : !editor
      ? text.length
      : document.activeElement === editor
      ? caretOffset(editor)
      : lastFocusedCaretRef.current;
    const validationError = validateSelectedFiles(
      files,
      attachmentsRef.current,
    );
    if (validationError) {
      setAttachmentError(validationError);
      return;
    }

    uploadInFlightRef.current = true;
    setUploading(true);
    setAttachmentError(null);
    try {
      const uploaded = await uploadAttachments(files);
      if (!mountedRef.current) {
        uploaded.forEach((attachment) => {
          void deletePendingAttachment(attachment.id).catch(() => undefined);
        });
        return;
      }
      replaceAttachments([...attachmentsRef.current, ...uploaded]);
      const liveText = editorRef.current ? plainTextOf(editorRef.current) : text;
      const liveCaret = Math.min(Math.max(0, insertAt), liveText.length);
      const gap = insertAttachmentGapAtCursor(liveText, liveCaret);
      setText(gap.text);
      setAttachmentAnchors((current) => {
        const next = { ...current };
        for (const attachment of uploaded) {
          next[attachment.id] = gap.offset;
        }
        return next;
      });
      const lastUploaded = uploaded.at(-1);
      pendingChipCaretRef.current = lastUploaded
        ? { chipKey: `a:${lastUploaded.id}`, offset: gap.offset }
        : null;
      pendingCaretRef.current = gap.caret;
      editorRef.current?.focus();
    } catch (error) {
      if (mountedRef.current) {
        setAttachmentError((error as Error).message || "附件上传失败");
      }
    } finally {
      uploadInFlightRef.current = false;
      if (mountedRef.current) setUploading(false);
    }
  };

  const isFileDrag = (event: ReactDragEvent<HTMLElement>): boolean =>
    Array.from(event.dataTransfer.types).includes("Files");

  const handleFileDragEnter = (event: ReactDragEvent<HTMLDivElement>) => {
    if (!isFileDrag(event)) return;
    event.preventDefault();
    event.stopPropagation();
    fileDragDepthRef.current += 1;
    event.dataTransfer.dropEffect =
      busy || sendInFlightRef.current || uploadInFlightRef.current
        ? "none"
        : "copy";
    setIsFileDragActive(true);
  };

  const handleFileDragOver = (event: ReactDragEvent<HTMLDivElement>) => {
    if (!isFileDrag(event)) return;
    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect =
      busy || sendInFlightRef.current || uploadInFlightRef.current
        ? "none"
        : "copy";
  };

  const handleFileDragLeave = (event: ReactDragEvent<HTMLDivElement>) => {
    if (!isFileDrag(event)) return;
    event.preventDefault();
    event.stopPropagation();
    fileDragDepthRef.current = Math.max(0, fileDragDepthRef.current - 1);
    if (fileDragDepthRef.current === 0) setIsFileDragActive(false);
  };

  const handleFileDrop = (event: ReactDragEvent<HTMLDivElement>) => {
    if (!isFileDrag(event)) return;
    event.preventDefault();
    event.stopPropagation();
    fileDragDepthRef.current = 0;
    setIsFileDragActive(false);

    const files = Array.from(event.dataTransfer.files);
    if (files.length === 0) {
      setAttachmentError("未检测到可上传的文件");
      return;
    }
    void handleFilesSelected(files);
  };

  const handleDeleteAttachment = async (attachment: PublicAttachment) => {
    setAttachmentError(null);
    clearPendingDeleteChip();
    try {
      await deletePendingAttachment(attachment.id);
      if (mountedRef.current) {
        replaceAttachments(
          attachmentsRef.current.filter((item) => item.id !== attachment.id),
        );
        setAttachmentAnchors((current) => {
          const next = { ...current };
          delete next[attachment.id];
          return next;
        });
      }
    } catch (error) {
      pendingChipCaretRef.current = null;
      if (mountedRef.current) {
        setAttachmentError((error as Error).message || "附件删除失败");
      }
    }
  };

  const handleSend = async () => {
    if (sendInFlightRef.current) return;
    if (busy) {
      await abortGeneration();
      return;
    }
    if (sendDisabled || uploadInFlightRef.current) return;
    const attachmentIds = attachmentsRef.current.map((attachment) =>
      attachment.id
    );
    if (!canSendComposerMessage(text, attachmentIds)) return;
    clearPendingDeleteChip();

    const payload = buildComposerPayload({
      text,
      connectors: activeConnectors,
      attachmentIds,
    });
    const submittedAttachments = [...attachmentsRef.current];
    sendingAttachmentsRef.current = submittedAttachments;
    sendInFlightRef.current = true;
    setSending(true);
    // Clear the visible draft immediately; keep the submitted snapshot for retry.
    attachmentsRef.current = [];
    setAttachments([]);
    setAttachmentAnchors({});
    setText("");
    const restoreSubmittedDraft = () => {
      if (!mountedRef.current) {
        submittedAttachments.forEach((attachment) => {
          void deletePendingAttachment(attachment.id).catch(() => undefined);
        });
        return;
      }
      attachmentsRef.current = submittedAttachments;
      setAttachments(submittedAttachments);
      setAttachmentAnchors(attachmentAnchors);
      setText(text);
    };
    try {
      const sent = await sendMessage(payload.text, {
        attachmentIds: payload.attachmentIds,
        attachments: submittedAttachments,
        preferredConnectors: payload.preferredConnectors,
        preferredConnector: payload.preferredConnector,
        preferredConnectorKind: payload.preferredConnectorKind,
        displayText: text,
        attachmentAnchors,
        selectedSkillNames: isExpertCreator
          ? expertSkillsInText
          : undefined,
        selectedExpertId: isExpertCreator
          ? expertComposerExpert?.id
          : undefined,
        ...(testingPublishField ? { testingPublishField } : {}),
      });
      if (!sent) {
        restoreSubmittedDraft();
        return;
      }
      if (!mountedRef.current) return;

      if (isExpertCreator && currentConvId) {
        clearExpertComposerExpert(currentConvId);
        setShowExpertManagerToken(false);
      }
      setAttachmentError(null);
    } catch (error) {
      restoreSubmittedDraft();
      if (mountedRef.current) setAttachmentError(error instanceof Error ? error.message : "发送失败，请重试");
    } finally {
      sendingAttachmentsRef.current = [];
      sendInFlightRef.current = false;
      if (mountedRef.current) setSending(false);
    }
  };

  const handleDynamicSkill = (skill: SkillMeta) => {
    if (busy || sendInFlightRef.current) return;
    if (isSkillCreator) return;
    const editor = editorRef.current;
    const selection = window.getSelection();
    const selectionInEditor = Boolean(
      editor && selection && selection.rangeCount > 0 &&
        (editor.contains(selection.anchorNode) ||
          editor.contains(selection.focusNode)),
    );
    const liveText = editor ? plainTextOf(editor) : text;
    const caret = editor
      ? (selectionInEditor ? caretOffset(editor) : lastFocusedCaretRef.current)
      : liveText.length;
    const cmd = `/${skill.name}`;
    clearPendingDeleteChip();
    const inserted = insertSkillAtCursor(liveText, caret, cmd);
    pendingCaretRef.current = inserted.caret;
    setText(inserted.text);
  };

  const handleDocumentProcessingSelected = () => {
    if (busy || sendInFlightRef.current) return;
    handleDynamicSkill({
      name: DOCUMENT_PROCESSING_COMMAND.slice(1),
      displayName: DOCUMENT_PROCESSING_LABEL,
      description: "统一处理文档上传、解析、检索、生成与预览",
      body: "",
      disabled: false,
      builtin: true,
      path: "",
    });
  };

  const handleWelcomeSkillSelected = (event: Event) => {
    const detail = (event as CustomEvent<{
      command?: string;
      label?: string;
      companionCommands?: string[];
      prompt?: string;
    }>).detail;
    const command = detail?.command?.trim();
    if (!command || !command.startsWith("/")) return;
    if (busy || sendInFlightRef.current || isSkillCreator) return;

    const liveText = editorRef.current ? plainTextOf(editorRef.current) : text;
    const applied = applyWelcomeSkillToComposer(liveText, {
      command,
      label: detail?.label ?? command,
      companionCommands: detail?.companionCommands,
      prompt: detail?.prompt,
    });
    if (!applied) return;
    clearPendingDeleteChip();
    pendingCaretRef.current = applied.caret;
    setSlashQuery(null);
    setSlashSkillQuery(null);
    setText(applied.text);
  };

  useEffect(() => {
    if (!isDocumentProcessingCapability(activePluginCapability ?? "")) return;
    if (text.toLowerCase().includes(DOCUMENT_PROCESSING_COMMAND)) return;
    handleDocumentProcessingSelected();
    // The plugin selection is an external one-shot activation. Removing the
    // composer tag must not immediately add it back on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activePluginCapability]);

  useEffect(() => {
    window.addEventListener(COMPOSER_SKILL_EVENT, handleWelcomeSkillSelected);
    return () => window.removeEventListener(
      COMPOSER_SKILL_EVENT,
      handleWelcomeSkillSelected,
    );
  }, [text, busy, isSkillCreator]);

  useEffect(() => {
    const handleClearDraft = () => {
      if (busy || sendInFlightRef.current || uploadInFlightRef.current) return;
      const pending = [...attachmentsRef.current];
      attachmentsRef.current = [];
      setAttachments([]);
      setAttachmentAnchors({});
      pending.forEach((attachment) => {
        void deletePendingAttachment(attachment.id).catch(() => undefined);
      });
      setAttachmentError(null);
      pendingCaretRef.current = 0;
      setText("");
    };
    window.addEventListener(COMPOSER_CLEAR_DRAFT_EVENT, handleClearDraft);
    return () => {
      window.removeEventListener(COMPOSER_CLEAR_DRAFT_EVENT, handleClearDraft);
    };
  }, [busy]);

  const handleSelectExpertForCreation = (expert: Expert) => {
    if (!currentConvId || busy || sendInFlightRef.current) return;
    // Selecting an expert moves focus into the picker. Preserve the editor's
    // last caret so adding the expert context token does not reset it.
    const editor = editorRef.current;
    if (editor && document.activeElement === editor) {
      lastFocusedCaretRef.current = caretOffset(editor);
    }
    pendingCaretRef.current = lastFocusedCaretRef.current;
    setExpertComposerExpert(currentConvId, expert);
  };

  // 新会话使用 Composer 选择；已有会话使用持久化的会话绑定。
  const activeWorkspaceId = currentConversation?.workspaceId ??
    (currentConvId ? null : composerWorkspaceId);
  const activeWs = activeWorkspaceId
    ? workspaces.find((w) => w.id === activeWorkspaceId)
    : null;
  const wsLabel = activeWs?.name || "选择工作空间";

  // 底部空间行常驻：新会话预选空间，已有会话允许切换持久化的空间绑定。
  const showBottomBar = true;

  const handleSelectWorkspace = (id: string | null) => {
    setShowWsPicker(false);
    void activateWorkspace(id);
  };

  const activeKey = getActiveOptionKey(permission);
  const activeOpt = COMBINED_OPTIONS.find((o) => o.key === activeKey) ||
    COMBINED_OPTIONS[0];
  const ActiveIcon = activeOpt.icon;
  const permissionAccent = isCreatorConversation
    ? "var(--text)"
    : "var(--accent)";

  const filteredSlashCmds = slashQuery !== null
    ? (isExpertCreator
      ? mergeUniqueSlashCommands(
        databaseSkillSlashCommands,
        SLASH_COMMANDS.filter((command) =>
          command.category !== "skill" && command.category !== "mode"
        ),
      )
      : completeSlashCommands).filter(
      (command) =>
        (command.cmd.toLowerCase().includes("/" + slashQuery) ||
          command.name.toLowerCase().includes(slashQuery)),
    )
    : [];

  const filteredSkillSlashCmds: SlashCommand[] = slashSkillQuery !== null
    ? skills
      .filter((skill) => !skill.disabled)
      .filter((skill) => {
        const query = slashSkillQuery.trim().toLowerCase();
        return !query || skill.name.toLowerCase().includes(query) ||
          (skill.displayName || "").toLowerCase().includes(query);
      })
      .map((skill) => ({
        cmd: `/${skill.name}`,
        name: skill.displayName || skill.name,
        desc: skill.description || `/${skill.name}`,
        icon: skillInitial(skill),
        category: "skill" as const,
        action: () => undefined,
      }))
    : [];
  const visibleSlashCmds = slashSkillQuery !== null
    ? filteredSkillSlashCmds
    : filteredSlashCmds;

  useLayoutEffect(() => {
    const list = slashMenuListRef.current;
    if (!list || visibleSlashCmds.length === 0) return;
    const item = list.querySelector(`[data-slash-index="${slashIndex}"]`);
    if (!(item instanceof HTMLElement)) return;
    const listRect = list.getBoundingClientRect();
    const itemRect = item.getBoundingClientRect();
    if (itemRect.bottom > listRect.bottom) {
      list.scrollTop += itemRect.bottom - listRect.bottom;
    } else if (itemRect.top < listRect.top) {
      list.scrollTop -= listRect.top - itemRect.top;
    }
  }, [slashIndex, visibleSlashCmds.length]);

  const handleSelectSlashCmd = (cmd: SlashCommand) => {
    if (cmd.category === "skill") {
      const editor = editorRef.current;
      const liveText = editor ? plainTextOf(editor) : text;
      const selection = window.getSelection();
      const selectionInEditor = Boolean(
        editor &&
          selection &&
          selection.rangeCount > 0 &&
          (editor.contains(selection.anchorNode) ||
            editor.contains(selection.focusNode)),
      );
      const currentCaret = editor
        ? (selectionInEditor
          ? caretOffset(editor)
          : lastFocusedCaretRef.current)
        : liveText.length;
      const at = Math.max(0, Math.min(currentCaret, liveText.length));
      const beforeCaret = liveText.slice(0, at);
      const afterCaret = liveText.slice(at);
      const prefix = consumeSlashTrigger(
        beforeCaret,
        selectionInEditor && editor ? editorSlashNodePrefix(editor) : null,
      );
      const inserted = insertSkillAtCursor(
        `${prefix}${afterCaret}`,
        prefix.length,
        cmd.cmd,
      );
      pendingCaretRef.current = inserted.caret;
      lastFocusedCaretRef.current = inserted.caret;
      setText(inserted.text);
    } else {
      cmd.action(text, setText);
    }
    setSlashQuery(null);
    setSlashSkillQuery(null);
  };

  // ── contenteditable 编辑器事件 ──

  /** 用户输入：纯文本同步 + 斜杠触发词检测；仅结构变化时安排重建。 */
  const handleEditorInput = () => {
    const editor = editorRef.current;
    if (!editor) return;
    clearPendingDeleteChip();
    if (!composingRef.current) normalizeEditorSlashCharacters(editor);
    const live = pruneMissingAttachments(editor);
    pruneMissingContextTokens(editor);
    const plain = plainTextOf(editor);
    const liveCaret = caretOffset(editor);
    lastFocusedCaretRef.current = liveCaret;
    const beforeCaret = plain.slice(0, liveCaret);
    const tokens = tokenizeSkillCommands(
      plain,
      knownSkillCommands,
      skillDisplayLabels,
    );
    const signature = structureSignature(
      tokens,
      editorContextTokens,
      attachmentMarks(live.attachments, live.anchors),
    );
    if (
      signature !== renderedStructureRef.current ||
      editorStructureSignature(editor) !== signature
    ) {
      pendingCaretRef.current = caretOffset(editor);
      if (plain === text) setEditorEpoch((epoch) => epoch + 1);
    }
    setText(plain);
    setSlashMenuTrigger(currentSlashTrigger(editor, beforeCaret));
    requestAnimationFrame(() => {
      const live = editorRef.current;
      if (live) scrollComposerCaretIntoView(live);
    });
  };

  /** 光标紧贴标签时：第一下退格进入待删，第二下确认后整颗删除。 */
  const deleteAdjacentTag = (editor: HTMLElement): "arm" | "delete" | false => {
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) return false;
    const range = selection.getRangeAt(0);
    const container = range.startContainer;
    const offset = range.startOffset;
    const chipBefore = chipBeforeCaret(editor, container, offset);
    if (!chipBefore) return false;
    const key = composerChipKey(editor, chipBefore);
    if (!key) return false;
    if (pendingDeleteKeyRef.current !== key) {
      pendingDeleteKeyRef.current = key;
      paintPendingDeleteChip(editor, key);
      return "arm";
    }
    pendingDeleteKeyRef.current = null;
    paintPendingDeleteChip(editor, null);
    const previousChip = previousChipElement(chipBefore.previousSibling);
    const previousKey = previousChip
      ? composerChipKey(editor, previousChip)
      : null;
    pendingChipCaretRef.current = previousChip && previousKey
      ? {
        chipKey: previousKey,
        offset: nodeTextOffset(editor, previousChip),
      }
      : null;
    if (isAttachmentTokenElement(chipBefore)) {
      const attachmentId = chipBefore.dataset.attachmentId;
      const attachment = attachmentsRef.current.find(
        (item) => item.id === attachmentId,
      );
      if (!attachment) {
        pendingChipCaretRef.current = null;
        return false;
      }
      pendingCaretRef.current = caretOffset(editor);
      void handleDeleteAttachment(attachment);
      return "delete";
    }
    if (isContextTokenElement(chipBefore)) {
      const contextId = chipBefore.dataset.contextId;
      if (contextId === "skill-creator") {
        resetToWelcome();
      } else if (contextId === "expert-manager") {
        setShowExpertManagerToken(false);
      } else if (contextId === "selected-expert" && currentConvId) {
        clearExpertComposerExpert(currentConvId);
      }
      pendingCaretRef.current = caretOffset(editor);
      setEditorEpoch((epoch) => epoch + 1);
      return "delete";
    }
    if (!chipBefore.classList.contains("composer-token")) return false;
    const command = chipBefore.dataset.cmd?.trim();
    const deleted = deleteSkillTagAtOffset(
      text,
      caretOffset(editor),
      knownSkillCommands,
    );
    if (!deleted) {
      pendingChipCaretRef.current = null;
      return false;
    }
    pendingCaretRef.current = deleted.caret;
    setText(deleted.text);
    if (command) {
      window.dispatchEvent(
        new CustomEvent(COMPOSER_SKILL_REMOVED_EVENT, {
          detail: { command },
        }),
      );
    }
    return "delete";
  };

  const handleEditorKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (
      composingRef.current ||
      e.nativeEvent.isComposing ||
      e.keyCode === 229
    ) {
      return;
    }
    if (e.key === "Enter" && skipImeEnterRef.current) {
      e.preventDefault();
      skipImeEnterRef.current = false;
      return;
    }
    const editor = editorRef.current;
    if ((e.key === "Backspace" || e.key === "Delete") && editor) {
      const selection = window.getSelection();
      if (
        selection &&
        selection.rangeCount > 0 &&
        !selection.getRangeAt(0).collapsed
      ) {
        if (commitComposerSelectionDelete(editor)) {
          e.preventDefault();
        }
        return;
      }
    }
    if (e.key === "Backspace" && editor) {
      const selection = window.getSelection();
      const range = selection && selection.rangeCount > 0
        ? selection.getRangeAt(0)
        : null;
      if (range?.collapsed && caretIsAtLineStart(editor, range)) {
        e.preventDefault();
        pendingChipCaretRef.current = null;
        if (deleteLineBreakBeforeCaret(editor, range)) {
          handleEditorInput();
          setSlashQuery(null);
          setSlashSkillQuery(null);
          return;
        }
        const plain = plainTextOf(editor);
        const caret = caretOffset(editor);
        if (caret > 0 && plain[caret - 1] === "\n") {
          const applied = applyComposerSelectionDelete({
            text: plain,
            rangeStart: caret - 1,
            rangeEnd: caret,
            attachments: attachmentsRef.current,
            anchors: attachmentAnchorsRef.current,
          });
          pendingCaretRef.current = previousLineEndOffset(editor, range);
          replaceAttachments(applied.attachments);
          setAttachmentAnchors(applied.anchors);
          setText(applied.text);
          setSlashQuery(null);
          setSlashSkillQuery(null);
          setSlashMenuTrigger(
            matchSlashTrigger(applied.text.slice(0, applied.caret)),
          );
          return;
        }
        placeAtPreviousLineEnd(editor, range);
        lastFocusedCaretRef.current = caretOffset(editor);
        setSlashQuery(null);
        setSlashSkillQuery(null);
        return;
      }
      const result = deleteAdjacentTag(editor);
      if (result) {
        e.preventDefault();
        setSlashQuery(null);
        setSlashSkillQuery(null);
        return;
      }
      if (
        range?.collapsed &&
        isEmptyLeadingCaretAnchor(editor, range.startContainer, range.startOffset)
      ) {
        e.preventDefault();
        return;
      }
      if (deleteLastVisibleCharAfterChip(editor)) {
        e.preventDefault();
        handleEditorInput();
        return;
      }
    }
    if (e.key === "ArrowLeft" && editor && !e.shiftKey) {
      const selection = window.getSelection();
      if (selection && selection.rangeCount > 0) {
        const range = selection.getRangeAt(0);
        if (range.collapsed) {
          const chip = chipBeforeCaret(
            editor,
            range.startContainer,
            range.startOffset,
          );
          if (chip) {
            e.preventDefault();
            clearPendingDeleteChip();
            const next = document.createRange();
            setRangeBeforeInlineToken(next, chip);
            next.collapse(true);
            selection.removeAllRanges();
            selection.addRange(next);
            lastFocusedCaretRef.current = caretOffset(editor);
            return;
          }
        }
      }
    }
    if (e.key === "ArrowRight" && editor && !e.shiftKey) {
      const selection = window.getSelection();
      if (selection && selection.rangeCount > 0) {
        const range = selection.getRangeAt(0);
        if (range.collapsed) {
          const chip = chipAfterCaret(
            editor,
            range.startContainer,
            range.startOffset,
          );
          if (chip) {
            e.preventDefault();
            clearPendingDeleteChip();
            const next = document.createRange();
            setRangeAfterInlineToken(next, chip);
            next.collapse(true);
            selection.removeAllRanges();
            selection.addRange(next);
            lastFocusedCaretRef.current = caretOffset(editor);
            return;
          }
        }
      }
    }
    if (e.key !== "Backspace") clearPendingDeleteChip();
    if (
      (slashQuery !== null || slashSkillQuery !== null) &&
      visibleSlashCmds.length > 0
    ) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSlashIndex((prev) => (prev + 1) % visibleSlashCmds.length);
        return;
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setSlashIndex((prev) =>
          (prev - 1 + visibleSlashCmds.length) % visibleSlashCmds.length
        );
        return;
      } else if (
        (e.key === "Enter" || e.key === "Tab") && !e.shiftKey
      ) {
        e.preventDefault();
        handleSelectSlashCmd(visibleSlashCmds[slashIndex]);
        return;
      } else if (e.key === "Escape") {
        setSlashQuery(null);
        setSlashSkillQuery(null);
        return;
      }
    }
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (!sendInFlightRef.current) void handleSend();
      return;
    }
    if (e.key === "Enter" && e.shiftKey) {
      // contenteditable 换行会插入 <div>，textContent 丢换行；统一用 <br>
      e.preventDefault();
      document.execCommand("insertLineBreak");
      requestAnimationFrame(() => {
        const live = editorRef.current;
        if (live) scrollComposerCaretIntoView(live);
      });
    }
  };

  const handleEditorPaste = (e: React.ClipboardEvent<HTMLDivElement>) => {
    e.preventDefault();
    const clipboardImages = clipboardImageFiles(e.clipboardData);
    const preparedPaste = preparePastedComposerContent(
      e.clipboardData.getData("text/plain"),
    );
    const pasted = preparedPaste.inlineText;
    const editor = editorRef.current;
    let pastedCaret: number | undefined;
    let attachmentInsertAt: number | undefined;
    if (editor) {
      const replaced = commitComposerSelectionDelete(editor, pasted);
      if (replaced) {
        pastedCaret = replaced.caret;
        attachmentInsertAt = replaced.caret - pasted.length;
      } else {
        const insertAt = caretOffset(editor);
        const inserted = insertComposerTextAtCaret({
          text: plainTextOf(editor),
          caret: insertAt,
          insert: pasted,
          attachments: attachmentsRef.current,
          anchors: attachmentAnchorsRef.current,
        });
        pastedCaret = inserted.caret;
        attachmentInsertAt = insertAt;
        pendingCaretRef.current = inserted.caret;
        replaceAttachments(inserted.attachments);
        setAttachmentAnchors(inserted.anchors);
        setText(inserted.text);
        setSlashMenuTrigger(
          matchSlashTrigger(inserted.text.slice(0, inserted.caret)),
        );
      }
    } else if (pasted) {
      document.execCommand("insertText", false, pasted);
    }
    const pastedAttachment = preparedPaste.attachment
      ? new File(
        [preparedPaste.attachment.content],
        `pasted-content-${Date.now()}.${preparedPaste.attachment.extension}`,
        { type: preparedPaste.attachment.mimeType },
      )
      : undefined;
    const files = [
      ...(pastedAttachment ? [pastedAttachment] : []),
      ...clipboardImages,
    ];
    if (files.length > 0) {
      void handleFilesSelected(
        files,
        pastedAttachment ? attachmentInsertAt : pastedCaret,
      );
    }
  };

  const handleEditorCut = (e: React.ClipboardEvent<HTMLDivElement>) => {
    const editor = editorRef.current;
    if (!editor) return;
    const analyzed = analyzeComposerSelection(editor);
    if (analyzed.collapsed) return;
    e.preventDefault();
    e.clipboardData.setData(
      "text/plain",
      plainTextOf(editor).slice(analyzed.start, analyzed.end),
    );
    commitComposerSelectionDelete(editor);
  };

  const handleEditorBeforeInput = (e: React.FormEvent<HTMLDivElement>) => {
    if (composingRef.current) return;
    const editor = editorRef.current;
    if (!editor) return;
    const native = e.nativeEvent as InputEvent;
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) return;
    const collapsed = selection.getRangeAt(0).collapsed;
    const inputType = native.inputType ?? "";
    const inserting = inputType === "insertText" ||
      inputType === "insertReplacementText";
    const deleting = inputType.startsWith("delete");
    if (
      collapsed &&
      inserting &&
      native.data &&
      shouldPrefixSkillBoundary(editor, native.data)
    ) {
      e.preventDefault();
      document.execCommand(
        "insertText",
        false,
        `${SKILL_TOKEN_BOUNDARY}${native.data}`,
      );
      return;
    }
    if (collapsed) return;
    if (!inserting && !deleting) return;
    if (
      !commitComposerSelectionDelete(
        editor,
        inserting ? (native.data ?? "") : "",
      )
    ) {
      return;
    }
    e.preventDefault();
  };

  const handleCompositionStart = () => {
    composingRef.current = true;
    setIsComposing(true);
    clearPendingDeleteChip();
  };

  const handleCompositionEnd = () => {
    composingRef.current = false;
    skipImeEnterRef.current = true;
    window.setTimeout(() => {
      skipImeEnterRef.current = false;
    }, 0);
    setIsComposing(false);
    const editor = editorRef.current;
    if (!editor) return;
    normalizeEditorSlashCharacters(editor);
    const plain = plainTextOf(editor);
    const tokens = tokenizeSkillCommands(
      plain,
      knownSkillCommands,
      skillDisplayLabels,
    );
    const live = pruneMissingAttachments(editor);
    const signature = structureSignature(
      tokens,
      editorContextTokens,
      attachmentMarks(live.attachments, live.anchors),
    );
    if (
      signature !== renderedStructureRef.current ||
      editorStructureSignature(editor) !== signature
    ) {
      pendingCaretRef.current = caretOffset(editor);
    }
    setText(plain);
    setSlashMenuTrigger(
      currentSlashTrigger(editor, plain.slice(0, caretOffset(editor))),
    );
    setEditorEpoch((epoch) => epoch + 1);
  };

  const handleEditorMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement;
    const editor = editorRef.current;
    if (!editor) return;
    const removeEl = target.closest(
      ".composer-token__remove, .composer-context-token__remove, .composer-attachment-token__remove",
    );
    if (removeEl) return;
    mouseSelectingRef.current = true;
    const chip = target.closest(
      ".composer-token, .composer-attachment-token, .composer-context-token",
    ) as HTMLElement | null;
    mouseDownChipRef.current = chip && editor.contains(chip) &&
        isSelectableComposerChip(chip)
      ? chip
      : null;
    const key = chip && editor.contains(chip)
      ? composerChipKey(editor, chip)
      : null;
    if (pendingDeleteKeyRef.current && pendingDeleteKeyRef.current !== key) {
      clearPendingDeleteChip();
    }
  };

  const handleEditorBlur = () => {
    clearPendingDeleteChip();
    const editor = editorRef.current;
    if (editor) paintSelectedComposerChips(editor, null);
  };

  /** 点击标签上的 × 删除整个技能标签。 */
  const handleEditorClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement;
    const editor = editorRef.current;
    if (!editor) return;
    const removeEl = target.closest(
      ".composer-token__remove, .composer-context-token__remove, .composer-attachment-token__remove",
    );
    if (!removeEl) {
      return;
    }
    clearPendingDeleteChip();
    const attachmentEl = removeEl.closest(
      ".composer-attachment-token",
    ) as HTMLElement | null;
    if (attachmentEl) {
      if (busy || sending) return;
      e.preventDefault();
      const attachmentId = attachmentEl.dataset.attachmentId;
      const attachment = attachmentsRef.current.find(
        (item) => item.id === attachmentId,
      );
      if (attachment) void handleDeleteAttachment(attachment);
      return;
    }
    const contextEl = removeEl.closest(
      ".composer-context-token",
    ) as HTMLElement | null;
    if (contextEl) {
      if (busy || sending) return;
      e.preventDefault();
      const contextId = contextEl.dataset.contextId;
      if (contextId === "skill-creator") {
        resetToWelcome();
      } else if (contextId === "expert-manager") {
        setShowExpertManagerToken(false);
      } else if (contextId === "selected-expert" && currentConvId) {
        clearExpertComposerExpert(currentConvId);
      }
      pendingCaretRef.current = caretOffset(editor);
      setEditorEpoch((epoch) => epoch + 1);
      return;
    }
    const tagEl = removeEl.closest(".composer-token") as HTMLElement | null;
    if (!tagEl) return;
    e.preventDefault();
    const deleted = deleteSkillTagAtOffset(
      text,
      nodeTextOffset(editor, tagEl),
      knownSkillCommands,
    );
    if (!deleted) return;
    pendingCaretRef.current = deleted.caret;
    setText(deleted.text);
    const command = tagEl.dataset.cmd?.trim();
    if (command) {
      window.dispatchEvent(
        new CustomEvent(COMPOSER_SKILL_REMOVED_EVENT, {
          detail: { command },
        }),
      );
    }
  };

  const editorPlaceholder = busy
    ? "PiCoddy 思考中…"
    : isSkillCreator
    ? "请帮我创建一个可以实现「……」的 skill"
    : isExpertCreator
    ? "请描述你要创建的专家、擅长领域和相关经验"
    : "今天帮你做些什么？@ 引用对话文件，/ 调用技能与指令";

  return (
    <>
    <div
      className="composer-root"
      onDragEnter={handleFileDragEnter}
      onDragOver={handleFileDragOver}
      onDragLeave={handleFileDragLeave}
      onDrop={handleFileDrop}
      style={{
        flexShrink: 0,
        padding: "8px 28px 16px",
        background: "linear-gradient(to top, var(--bg) 65%, transparent)",
      }}
    >
      <div style={{ maxWidth: 860, margin: "0 auto", position: "relative" }}>
        {/* ── 输入框 + 工具栏（始终显示）── */}
        <div
          className={`composer-shell${isFileDragActive ? " composer-shell--file-drag" : ""}`}
          style={{
            background: isCreatorConversation && theme === "dark"
              ? "var(--bg-subtle)"
              : "var(--bg)",
            border: "1px solid var(--border-strong)",
            borderRadius: isCreatorConversation ? 22 : 16,
            boxShadow: "var(--shadow-md)",
            display: "flex",
            flexDirection: "column",
            position: "relative",
          }}
        >
          {isFileDragActive && (
            <div className="composer-file-drop-overlay" aria-hidden="true">
              <span className="composer-file-drop-overlay__title">
                {busy || sending || uploading
                  ? "当前暂时无法添加附件"
                  : "松开鼠标添加文件"}
              </span>
              <span className="composer-file-drop-overlay__hint">
                单个文件最大 25 MB，最多添加 10 个
              </span>
            </div>
          )}
          {/* ── 斜杠技能菜单 (Slash Skill Menu) ── */}
          {(slashQuery !== null || slashSkillQuery !== null) &&
            visibleSlashCmds.length > 0 && (
            <div
              ref={slashMenuListRef}
              style={{
                position: "absolute",
                bottom: "calc(100% + 8px)",
                left: 0,
                right: 0,
                background: "var(--bg)",
                backdropFilter: "blur(16px) saturate(180%)",
                WebkitBackdropFilter: "blur(16px) saturate(180%)",
                border: "1px solid var(--border-strong)",
                borderRadius: 14,
                boxShadow: "0 12px 36px rgba(0,0,0,0.35)",
                padding: 6,
                zIndex: 99999,
                maxHeight: 300,
                overflowY: "auto",
              }}
            >
              <div
                style={{
                  fontSize: "var(--font-footnote)",
                  color: "var(--text-3)",
                  padding: "6px 10px 6px",
                  borderBottom: "1px solid var(--border)",
                  marginBottom: 4,
                  display: "flex",
                  justifyContent: "space-between",
                }}
              >
                <span>⚡ 快捷技能与系统指令</span>
                <span>Tab / Enter 选中 · Esc 退出</span>
              </div>
              {visibleSlashCmds.map((cmd, idx) => {
                const isFirstOfCategory = idx === 0 ||
                  visibleSlashCmds[idx - 1].category !== cmd.category;
                const categoryLabel = cmd.category === "skill"
                  ? "🎯 内置技能 (Skills)"
                  : "🎛️ 系统模式 (Modes)";

                return (
                  <Fragment key={cmd.cmd}>
                    {isFirstOfCategory && (
                      <div
                        style={{
                          fontSize: "var(--font-footnote)",
                          fontWeight: 600,
                          color: "var(--text-3)",
                          padding: "6px 10px 2px",
                          textTransform: "uppercase",
                          letterSpacing: "0.5px",
                        }}
                      >
                        {categoryLabel}
                      </div>
                    )}
                    <div
                      data-slash-index={idx}
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => handleSelectSlashCmd(cmd)}
                      onMouseEnter={() => setSlashIndex(idx)}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 10,
                        padding: "8px 10px",
                        borderRadius: 8,
                        cursor: "pointer",
                        background: idx === slashIndex
                          ? "var(--bg-hover)"
                          : "transparent",
                        transition: "background 0.1s ease",
                      }}
                    >
                      <span
                        className={cmd.category === "skill"
                          ? "composer-plus__skill-glyph"
                          : undefined}
                        style={cmd.category === "skill"
                          ? {
                            "--skill-icon-hue": skillIconHue(
                              cmd.cmd.replace(/^\//, ""),
                            ),
                          } as CSSProperties
                          : { fontSize: "var(--font-section)" }}
                      >
                        {cmd.icon}
                      </span>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div
                          style={{
                            fontSize: "var(--font-caption)",
                            fontWeight: 600,
                            color: idx === slashIndex
                              ? "var(--accent)"
                              : "var(--text)",
                            display: "flex",
                            gap: 6,
                            alignItems: "center",
                          }}
                        >
                          <span>{cmd.cmd}</span>
                          <span
                            style={{
                              fontSize: "var(--font-footnote)",
                              color: "var(--text-3)",
                              fontWeight: "normal",
                            }}
                          >
                            ({cmd.name})
                          </span>
                        </div>
                        <div
                          style={{
                            fontSize: "var(--font-footnote)",
                            color: "var(--text-3)",
                            whiteSpace: "nowrap",
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                          }}
                        >
                          {cmd.desc}
                        </div>
                      </div>
                      {idx === slashIndex && (
                        <span
                          style={{
                            fontSize: "var(--font-footnote)",
                            color: "var(--accent)",
                            fontWeight: 500,
                          }}
                        >
                          ↵ 选择
                        </span>
                      )}
                    </div>
                  </Fragment>
                );
              })}
            </div>
          )}

          {runningSubAgent && (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                padding: "8px 16px",
                background: "var(--bg-sidebar)",
                borderBottom: "1px solid var(--border)",
                fontSize: "var(--font-footnote)",
                color: "var(--text-2)",
              }}
            >
              <Sparkles size={13} style={{ color: "var(--accent)" }} />
              <span>正在调用子智能体：</span>
              <strong style={{ color: "var(--text)", fontWeight: 600 }}>
                {runningSubAgent.title.replace("子任务: ", "")}
              </strong>
              <span
                style={{
                  marginLeft: "auto",
                  fontSize: "var(--font-footnote)",
                  color: "var(--text-3)",
                }}
              >
                处理中...
              </span>
            </div>
          )}
          <div style={{ position: "relative" }}>
            <div className="composer-editor-row">
              <div className="composer-editor-field">
                <div
                  ref={editorRef}
                  contentEditable={!sending}
                  onInput={handleEditorInput}
                  onBeforeInput={handleEditorBeforeInput}
                  onKeyDown={handleEditorKeyDown}
                  onPaste={handleEditorPaste}
                  onCut={handleEditorCut}
                  onCompositionStart={handleCompositionStart}
                  onCompositionEnd={handleCompositionEnd}
                  onMouseDown={handleEditorMouseDown}
                  onClick={handleEditorClick}
                  onBlur={handleEditorBlur}
                  className="composer-editor"
                  data-empty={text === "" && !isComposing ? "true" : undefined}
                  data-busy={busy ? "true" : undefined}
                  data-placeholder={editorPlaceholder}
                  style={{
                    width: "100%",
                    minHeight: 63,
                    maxHeight: 210,
                    overflowY: "auto",
                    border: "none",
                    outline: "none",
                    background: "transparent",
                    fontFamily: "inherit",
                    fontSize: "var(--font-body)",
                    lineHeight: 1.5,
                    padding: "0 4px 4px",
                    color: "var(--text)",
                    whiteSpace: "pre-wrap",
                    wordBreak: "break-word",
                    caretColor: "var(--text)",
                  }}
                />
              </div>
            </div>
          </div>
          {/* ── 工具栏 ── */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 4,
              padding: "8px 16px 12px",
            }}
          >
            <div
              style={{ display: "inline-flex", alignItems: "center", gap: 4 }}
              onFocusCapture={() => setShowModeMenu(false)}
            >
              <ComposerPlusMenu
                mode={mode}
                experts={experts}
                skills={skills.filter((skill) => !skill.disabled)}
                mcpConfig={mcpConfig}
                connected={mcpConnected}
                enterpriseConnectorError={mcpEnterpriseError}
                loading={loading}
                modeLocked={isCreatorConversation}
                allowSkillSelection={!isSkillCreator}
                selectedSkillNames={expertSkillsInText}
                skillSelectionLocked={busy || sending}
                onFilesSelected={(files) => void handleFilesSelected(files)}
                onDocumentProcessingSelected={handleDocumentProcessingSelected}
                onModeSelected={(nextMode) => {
                  if (!isCreatorConversation) setMode(nextMode);
                }}
                onExpertSelected={async (expert) => {
                  if (busy || sendInFlightRef.current) return;
                  if (isExpertCreator) {
                    handleSelectExpertForCreation(expert);
                    return;
                  }
                  await startExpertChat(expert.id, expert.name);
                }}
                onSkillSelected={handleDynamicSkill}
                selectedConnectorNames={activeConnectors.filter(item => item.kind === "mcp").map(item => item.id)}
                onConnectorSelected={async (connectorName) => {
                  if (busy || sendInFlightRef.current) return;
                  const selected = activeConnectors.find(item => item.kind === "mcp" && item.id === connectorName);
                  if (selected) { removeComposerConnector(selected); return; }
                  const connector = await connectMcp(connectorName);
                  if (!mountedRef.current) return;
                  addActiveConnector({
                    id: connector.name,
                    displayName: connector.displayName || connector.name,
                    kind: "mcp",
                  });
                }}
                onOpenConnectorManager={() => {
                  if (busy || sendInFlightRef.current) return;
                  setExpertPanelTab("connector");
                  setCategory("expert");
                }}
              />
              <ComposerConnectors
                connectors={activeConnectors}
                disabled={busy || sending}
                onRemove={removeComposerConnector}
                onManage={() => { setExpertPanelTab("connector"); setCategory("expert"); }}
              />
            </div>

            {/* 合并后的单一下拉框（模式与权限一体） */}
            {(
              <div style={{ position: "relative" }} ref={modeMenuRef}>
                  <button
                    onClick={() => setShowModeMenu(!showModeMenu)}
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 5,
                      padding: "5px 9px",
                      border: "1px solid transparent",
                      borderRadius: 7,
                      background: "transparent",
                      color: mode === "craft"
                        ? (permission === "full" || permission === "L3"
                          ? permissionAccent
                          : "var(--text)")
                        : "var(--text-2)",
                      fontSize: "var(--font-footnote)",
                      fontWeight: 500,
                    }}
                  >
                    <ActiveIcon size={14} />
                    <span>{activeOpt.title}</span>
                    <svg
                      width="10"
                      height="10"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2.5"
                    >
                      <path d="m6 9 6 6 6-6" />
                    </svg>
                  </button>
                  {showModeMenu && (
                    <div
                      style={{
                        position: "absolute",
                        bottom: "calc(100% + 10px)",
                        left: 0,
                        background: "var(--bg)",
                        backdropFilter: "blur(16px) saturate(180%)",
                        WebkitBackdropFilter: "blur(16px) saturate(180%)",
                        border: "1px solid var(--border-strong)",
                        borderRadius: 12,
                        boxShadow: "0 12px 36px rgba(0,0,0,0.45)",
                        padding: 6,
                        minWidth: 270,
                        zIndex: 99999,
                      }}
                    >
                      {COMBINED_OPTIONS.map((opt) => {
                        const OptIcon = opt.icon;
                        const isActive = opt.key === activeKey;
                        return (
                          <div
                            key={opt.key}
                            onClick={() => {
                              setMode(opt.mode);
                              setPermission(opt.permission);
                              setShowModeMenu(false);
                            }}
                            style={{
                              padding: "8px 10px",
                              borderRadius: 8,
                              cursor: "pointer",
                              display: "flex",
                              gap: 10,
                              alignItems: "flex-start",
                              background: isActive
                                ? "var(--bg-hover)"
                                : "transparent",
                            }}
                            onMouseEnter={(e) =>
                              e.currentTarget.style.background =
                                "var(--bg-hover)"}
                            onMouseLeave={(e) =>
                              e.currentTarget.style.background = isActive
                                ? "var(--bg-hover)"
                                : "transparent"}
                          >
                            <span
                              style={{
                                marginTop: 2,
                                color: isActive
                                  ? permissionAccent
                                  : "var(--text-2)",
                              }}
                            >
                              <OptIcon size={15} />
                            </span>
                            <div style={{ flex: 1 }}>
                              <div
                                style={{
                                  display: "flex",
                                  alignItems: "center",
                                  justifyContent: "space-between",
                                }}
                              >
                                <span
                                  style={{
                                    fontSize: "var(--font-caption)",
                                    fontWeight: 600,
                                    color: isActive
                                      ? permissionAccent
                                      : "var(--text)",
                                  }}
                                >
                                  {opt.title}
                                </span>
                                {opt.badge && (
                                  <span
                                    style={{
                                      fontSize: "var(--font-footnote)",
                                      padding: "1px 5px",
                                      borderRadius: 4,
                                      background: opt.permission === "full"
                                        ? "rgba(239,68,68,0.12)"
                                        : opt.permission === "default"
                                        ? (isCreatorConversation
                                          ? "var(--bg-active)"
                                          : "var(--accent-soft)")
                                        : "var(--bg-sidebar)",
                                      color: opt.permission === "full"
                                        ? "#ef4444"
                                        : opt.permission === "default"
                                        ? (isCreatorConversation
                                          ? "var(--text)"
                                          : "var(--accent)")
                                        : "var(--text-3)",
                                      fontWeight: 500,
                                    }}
                                  >
                                    {opt.badge}
                                  </span>
                                )}
                              </div>
                              <div
                                style={{
                                  fontSize: "var(--font-footnote)",
                                  color: "var(--text-3)",
                                  marginTop: 2,
                                }}
                              >
                                {opt.desc}
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
              </div>
            )}

            <div style={{ flex: 1 }} />

            {/* 模型选择（对齐 参考设计 截图2） */}
            <ModelPicker />

            {/* 麦克风 */}
            <button
              title="语音输入"
              style={{
                width: 30,
                height: 30,
                border: "none",
                borderRadius: 7,
                background: "transparent",
                color: "var(--text-2)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
                <path d="M19 10v1a7 7 0 0 1-14 0v-1" />
                <line x1="12" y1="19" x2="12" y2="23" />
                <line x1="8" y1="23" x2="16" y2="23" />
              </svg>
            </button>

            {/* 发送/停止按钮 */}
            <button
              className="composer-send-button"
              onClick={() => void handleSend()}
              disabled={(!busy && (sendDisabled || processing)) || sending ||
                (!busy &&
                  (uploading ||
                    !canSendComposerMessage(
                      text,
                      attachments.map((attachment) => attachment.id),
                    )))}
              aria-label={sending
                ? "正在发送"
                : busy
                ? "停止生成"
                : processing
                ? "正在处理"
                : uploading
                ? "附件上传中"
                : "发送"}
              style={{
                width: 30,
                height: 30,
                flexShrink: 0,
                border: "none",
                borderRadius: 999,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                opacity: sending || (!busy && (
                    uploading ||
                    (!text.trim() && attachments.length === 0)
                  ))
                  ? 0.5
                  : 1,
              }}
            >
              {busy
                ? (
                  <svg
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    fill="currentColor"
                  >
                    <rect x="6" y="6" width="12" height="12" rx="2" />
                  </svg>
                )
                : processing
                ? (
                  <svg
                    className="composer-send-spinner"
                    width="16"
                    height="16"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.4"
                    strokeLinecap="round"
                  >
                    <path d="M12 3a9 9 0 1 0 9 9" />
                  </svg>
                )
                : (
                  <svg
                    width="16"
                    height="16"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.3"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M12 19V5M5 12l7-7 7 7" />
                  </svg>
                )}
            </button>
          </div>
        </div>

        {/* ── 底部空间上下文行 ── */}
        {showBottomBar && (
          <div className="composer-bottom-bar">
            <WsPickerDropdown
              label={wsLabel}
              hasSelection={!!activeWorkspaceId}
              open={showWsPicker}
              onToggle={() => setShowWsPicker(!showWsPicker)}
              onClose={() => setShowWsPicker(false)}
              workspaces={workspaces}
              currentId={activeWorkspaceId}
              onSelect={handleSelectWorkspace}
              onManage={() => {
                setShowWsPicker(false);
                openWorkspaceCreator();
              }}
            />
          </div>
        )}

        <div className="composer-ai-hint">
          内容由 AI 生成，请核实重要信息
        </div>
      </div>
    </div>
    {attachmentError
      ? createPortal(
        <div className="composer-attachment-toast" role="status" aria-live="polite">
          <CircleAlert size={16} aria-hidden="true" />
          <span>{attachmentError}</span>
        </div>,
        document.body,
      )
      : null}
    </>
  );
}

/* ===== 工作空间下拉（对齐 参考设计 截图）===== */
function WsPickerDropdown({
  label,
  hasSelection,
  open,
  onToggle,
  onClose,
  workspaces,
  currentId,
  onSelect,
  onManage,
}: {
  label: string;
  hasSelection: boolean;
  open: boolean;
  onToggle: () => void;
  onClose: () => void;
  workspaces: { id: string; name: string; icon: string; dirPath: string }[];
  currentId: string | null;
  onSelect: (id: string | null) => void;
  onManage: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState("");

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open, onClose]);

  useEffect(() => {
    if (open) setQuery("");
  }, [open]);

  const filtered = query.trim()
    ? workspaces.filter((w) =>
      w.name.toLowerCase().includes(query.toLowerCase()) ||
      w.dirPath.toLowerCase().includes(query.toLowerCase())
    )
    : workspaces;

  return (
    <div ref={ref} style={{ position: "relative" }}>
      <button
        onClick={onToggle}
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 5,
          padding: "5px 10px",
          border: "1px solid var(--border)",
          borderRadius: 7,
          background: "transparent",
          color: hasSelection ? "var(--accent)" : "var(--text-2)",
          fontSize: "var(--font-footnote)",
          fontWeight: 500,
          transition: "all .12s",
        }}
      >
        <FolderOpen size={14} />
        <span>{label}</span>
        <ChevronDown
          size={11}
          style={{
            transition: "transform .15s",
            transform: open ? "rotate(180deg)" : "none",
          }}
        />
      </button>

      {open && (
        <div className="ws-picker-dropdown">
          {/* 搜索 */}
          <div className="ws-picker-search">
            <Search size={13} className="ws-picker-search-icon" />
            <input
              className="ws-picker-search-input"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="搜索工作空间"
              autoFocus
            />
          </div>

          {/* 空间列表 */}
          <div className="ws-picker-list">
            {filtered.length === 0 && query.trim() && (
              <div className="ws-picker-empty">无匹配结果</div>
            )}
            {filtered.map((w) => (
              <button
                key={w.id}
                className={`ws-picker-item ${
                  w.id === currentId ? "active" : ""
                }`}
                onClick={() => onSelect(w.id)}
              >
                <FolderOpen size={15} className="ws-picker-item-icon" />
                <div className="ws-picker-item-text">
                  <span className="ws-picker-item-name">{w.name}</span>
                  {w.dirPath && (
                    <span className="ws-picker-item-path">{w.dirPath}</span>
                  )}
                </div>
                {w.id === currentId && <CheckMark />}
              </button>
            ))}
          </div>

          {/* 底部操作 */}
          <div className="ws-picker-actions">
            <button className="ws-picker-action-btn" onClick={onManage}>
              <Plus size={13} />新建工作空间
            </button>
            <button
              className="ws-picker-action-btn ws-picker-browse"
              onClick={async () => {
                try {
                  const data = (window as any).electronAPI?.platform === "win32"
                    ? await pickDirectory()
                    : await (await fetch("/api/pick-dir")).json();
                  if (data.cancelled || !data.path) return;
                  useStore.getState().openWorkspaceCreator({
                    source: "local-directory",
                    name: data.name ||
                      data.path.split(/[\\/]/).filter(Boolean).pop() ||
                      "新空间",
                    dirPath: data.path,
                    icon: "folder",
                  });
                  onClose();
                } catch (e) {
                  console.error("[pick-dir] error:", e);
                }
              }}
            >
              <FolderInput size={13} />打开本地文件夹
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function CheckMark() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="ws-picker-check"
    >
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}

/* ===== 模型选择器（对齐 参考设计 / PiCoddy 动态模型）===== */

function ModelPicker() {
  const { modelId, modelProvider, settings, apiKeys, setShowSettings } =
    useStore();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // 从 settings.providers 动态扁平化已填 API Key 或配置有模型的真实可用模型项
  const availableModels: Array<
    { id: string; provider: string; name: string; providerName: string }
  > = [];
  if (settings.providers && settings.providers.length > 0) {
    for (const p of settings.providers) {
      // 只要具备 Key、属于 Ollama 本地服务，或者用户在该渠道下添加了模型 ID，则一律输出到可用模型列表
      const hasKeyOrModels = (p.id === "ollama") || !!apiKeys[p.id] || (p.id === "openai" && settings.openaiSubscription === true) ||
        (p.apiKey && p.apiKey.trim().length > 0) ||
        (p.models && p.models.length > 0);
      if (hasKeyOrModels && p.models && p.models.length > 0) {
        for (const m of p.models) {
          availableModels.push({
            id: m.id,
            provider: p.id,
            name: m.name || m.id,
            providerName: p.name || p.id,
          });
        }
      }
    }
  }

  // 兜底列表（当尚未填写任何 API Key 时）
  const fallbackList = [
    {
      id: "deepseek-v4-flash",
      provider: "deepseek",
      name: "DeepSeek V4 Flash",
      providerName: "DeepSeek",
    },
    {
      id: "glm-4-flash",
      provider: "zhipu",
      name: "GLM-4 Flash (免费极速)",
      providerName: "智谱 AI",
    },
    {
      id: "moonshot-v1-8k",
      provider: "moonshot",
      name: "Kimi 8K",
      providerName: "Kimi",
    },
    {
      id: "gpt-4o",
      provider: "openai",
      name: "GPT-4o",
      providerName: "OpenAI",
    },
  ];

  const modelList = availableModels.length > 0 ? availableModels : fallbackList;

  // 当前选中的模型
  const current = resolveModelSelection(modelList, {
    id: modelId,
    provider: modelProvider,
  });

  const displayName = current?.name || "未配置模型";

  useLayoutEffect(() => {
    if (!current) return;
    if (isModelOptionSelected(current, { id: modelId, provider: modelProvider })) {
      return;
    }
    useStore.getState().setModel(current.provider, current.id);
  }, [current, modelId, modelProvider]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const handleSelect = (m: (typeof modelList)[number]) => {
    useStore.getState().setModel(m.provider, m.id);
    setOpen(false);
  };

  return (
    <div ref={ref} style={{ position: "relative" }}>
      <button
        onClick={() => setOpen(!open)}
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 4,
          padding: "5px 8px",
          border: "1px solid transparent",
          borderRadius: 7,
          background: "transparent",
          color: "var(--text-2)",
          fontSize: "var(--font-footnote)",
          fontWeight: 500,
        }}
      >
        <Sparkles size={14} />
        <span>{displayName}</span>
        <ChevronDown
          size={11}
          style={{
            transition: "transform .15s",
            transform: open ? "rotate(180deg)" : "none",
          }}
        />
      </button>

      {open && (
        <div className="model-picker-dropdown">
          {/* Max 模式 */}
          <div className="model-picker-header">
            <Zap size={13} className="model-picker-header-icon" />
            <span className="model-picker-header-title">Max 模式 (全开)</span>
            <label className="model-picker-toggle">
              <input type="checkbox" defaultChecked />
              <span className="toggle-slider" />
            </label>
          </div>

          {/* 推荐模型 */}
          <div className="model-picker-section-title">
            <Sparkles size={13} /> 可用大模型列表 ({modelList.length})
          </div>

          {/* 模型列表 */}
          <div
            className="model-picker-list"
            style={{ maxHeight: 240, overflowY: "auto" }}
          >
            {modelList.map((m) => {
              const active = isModelOptionSelected(m, {
                id: modelId,
                provider: modelProvider,
              });
              return (
                <button
                  key={`${m.provider}-${m.id}`}
                  className={`model-item ${active ? "active" : ""}`}
                  onClick={() => handleSelect(m)}
                >
                  <span
                    className="model-item-dot"
                    style={{
                      background: availableModelStatusColor(m.provider),
                    }}
                  />
                  <span className="model-item-name">{m.name}</span>
                  <span
                    className="model-item-price"
                    style={{ fontSize: "var(--font-footnote)", color: "var(--text-3)" }}
                  >
                    {m.providerName}
                  </span>
                  {active && <CheckMark />}
                </button>
              );
            })}
          </div>

          {/* 配置自定义模型 */}
          <button
            className="model-custom-btn"
            onClick={() => {
              setOpen(false);
              setShowSettings(true);
            }}
          >
            <Settings2 size={13} />
            配置模型与 API 渠道
          </button>
        </div>
      )}
    </div>
  );
}
