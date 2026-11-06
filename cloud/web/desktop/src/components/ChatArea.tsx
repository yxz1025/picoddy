import { PiLogo } from "./PiLogo";
import { useRequirementInputHistory, RequirementInputHistory } from "./projects/RequirementInputHistory";
import {
  isValidElement,
  memo,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type RefObject,
  type ReactNode,
} from "react";
import { type Message, type WidgetData, useStore } from "../store/useStore";
import { useStreamStore } from "../store/useStreamStore";
import { showItemInFolder } from "../utils/openFile";
import { deliveryBatchFromContent } from "../utils/artifactPresentation";
import "./ChatArea.css";
import "./ComposerPlusMenu.css";
import WidgetRenderer from "./WidgetRenderer";
import {
  downloadWidgetPng,
  downloadWidgetSource,
} from "./widgetExport";
import PresentFilesBatch from "./PresentFilesBatch";
import CodeBlock from "./CodeBlock";
import ConversationExpertControl from "./ConversationExpertControl";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import ToolConfirmDialog from "./ToolConfirmDialog";
import SkillDraftPanel from "./SkillDraftPanel";
import ExpertDraftPanel from './ExpertDraftPanel';
import { interleaveComposerAttachments } from "./composerMenuModel";
import { composerSceneIconId } from "./composerSkillIcons";
import { SLASH_COMMANDS } from "./Composer";
import { useSkillStore } from "../store/useSkillStore";
import { isCreatorFirstUserMessage } from "./skillDraftModel";
import AssistantProcessBundle from "./AssistantProcessBundle";
import {
  formatRunDuration,
  hasAnswerText,
  isSettledRun,
  processItemKey,
  runElapsedMs,
  buildAssistantTimeline,
  type AssistantRunItem,
} from "./assistantRunModel";
import { autoCorrectedToolCallIds } from "./toolActivityModel";
import {
  Check,
  ChevronDown,
  Code2,
  Copy,
  Download,
  Eye,
  Image,
  Layout,
  Loader2,
  MoreHorizontal,
  Share2,
  Sparkles,
  SquareTerminal,
  ThumbsDown,
  ThumbsUp,
  Volume2,
  X,
} from "lucide-react";

type ToolStatus = "running" | "success" | "error";

type ChatRenderItem = AssistantRunItem;

type ConversationRenderItem =
  | { kind: "user"; message: Message }
  | { kind: "assistant-run"; id: string; items: ChatRenderItem[] };

const TOOL_LABELS: Record<string, string> = {
  bash: "运行命令",
  write: "写入文件",
  edit: "编辑文件",
  read: "读取文件",
  memory_write: "保存长期记忆",
  memory_recall: "读取长期记忆",
  web_search: "搜索网页",
  web_fetch: "读取网页",
  screenshot: "查看截图",
  mouse_click: "点击界面",
  key_type: "输入文字",
  skill_draft_init: "创建技能草稿",
  skill_draft_list: "查看技能草稿文件",
  skill_draft_read: "读取技能草稿",
  skill_draft_write: "更新技能草稿",
  skill_draft_import_attachment: "导入技能附件",
  skill_draft_delete: "删除技能草稿文件",
  skill_draft_validate: "检查技能草稿",
};

function toolActivityIcon(toolName?: string) {
  if (
    toolName === "read" ||
    toolName === "skill_draft_read" ||
    toolName === "screenshot"
  ) {
    return Eye;
  }
  return SquareTerminal;
}

function getToolStatus(message: Message): ToolStatus {
  return message.status || (message.isError ? "error" : "success");
}

function parseToolArgs(args?: string): Record<string, unknown> | null {
  if (!args) return null;
  try {
    const parsed = JSON.parse(args);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed
      : null;
  } catch {
    return null;
  }
}

function shortenText(text: string, maxLength = 82): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  return normalized.length > maxLength
    ? `${normalized.slice(0, maxLength - 1)}…`
    : normalized;
}

function getToolDescription(message: Message): string {
  const name = message.toolName || "工具";
  const args = parseToolArgs(message.toolArgs);
  const label = TOOL_LABELS[name] || name.replaceAll("_", " ");

  if (name === "bash") {
    const command =
      typeof args?.command === "string" ? args.command : message.toolArgs || "";
    return command ? `运行 ${shortenText(command)}` : label;
  }

  const detailKeys = [
    "path",
    "filePath",
    "file_path",
    "relativePath",
    "name",
    "query",
    "url",
  ];
  const detail = detailKeys
    .map((key) => args?.[key])
    .find(
      (value): value is string =>
        typeof value === "string" && value.trim().length > 0,
    );

  return detail ? `${label} · ${shortenText(detail, 58)}` : label;
}

function formatToolDuration(messages: Message[]): string {
  const times = messages
    .map((message) => message.createdAt)
    .filter((time) => Number.isFinite(time) && time > 0);
  if (times.length < 2) return "";

  const elapsedSeconds = Math.max(
    1,
    Math.ceil((Math.max(...times) - Math.min(...times)) / 1000),
  );
  if (elapsedSeconds < 60) return `${elapsedSeconds}s`;
  return `${Math.ceil(elapsedSeconds / 60)}m`;
}

function groupToolMessages(messages: Message[]): ChatRenderItem[] {
  const items: ChatRenderItem[] = [];
  let pendingTools: Message[] = [];

  const flushTools = () => {
    if (pendingTools.length === 0) return;
    items.push({
      kind: "tool-group",
      id: `tools-${pendingTools[0].id}`,
      messages: pendingTools,
    });
    pendingTools = [];
  };

  for (const message of messages) {
    if (message.role !== "user" && message.role !== "assistant") {
      // 成功的 present_files / show_widget 单独渲染卡片，不进"已处理"折叠记录
      if (message.toolName === "present_files" && !message.isError) {
        flushTools();
        items.push({
          kind: "present-files",
          id: `present-${message.id}`,
          message,
        });
        continue;
      }
      if (
        message.toolName === "show_widget" &&
        !message.isError &&
        (message.status === "running" || parseWidgetData(message))
      ) {
        flushTools();
        items.push({ kind: "widget", id: `widget-${message.id}`, message });
        continue;
      }
      pendingTools.push(message);
      continue;
    }
    flushTools();
    items.push({ kind: "message", message });
  }
  flushTools();
  return items;
}

/** 一个用户消息之后的 assistant / tool / 卡片属于同一次回答，只显示一个头像。 */
function groupConversationRuns(messages: Message[]): ConversationRenderItem[] {
  const turns: ConversationRenderItem[] = [];
  let pendingRun: ChatRenderItem[] = [];

  const flushRun = () => {
    if (pendingRun.length === 0) return;
    const first = pendingRun[0];
    const id = first.kind === "message" ? first.message.id : first.id;
    turns.push({ kind: "assistant-run", id: `run-${id}`, items: pendingRun });
    pendingRun = [];
  };

  for (const item of groupToolMessages(messages)) {
    if (item.kind === "message" && item.message.role === "user") {
      flushRun();
      turns.push({ kind: "user", message: item.message });
      continue;
    }
    pendingRun.push(item);
  }
  flushRun();
  return turns;
}

/** 解析 show_widget 数据：实时路径读 message.widget，重载路径读 content JSON 的 details.widget */
function parseWidgetData(message: Message): WidgetData | null {
  if (message.widget && message.widget.widget_code) return message.widget;
  if (!message.content) return null;
  try {
    const parsed = JSON.parse(message.content);
    const widget = parsed?.details?.widget;
    if (
      widget &&
      typeof widget.widget_code === "string" &&
      widget.widget_code
    ) {
      return widget as WidgetData;
    }
  } catch {
    /* 实时路径 content 为纯文本，走 message.widget */
  }
  return null;
}

const WIDGET_MODULE_LABELS: Record<string, string> = {
  diagram: "流程图",
  mockup: "原型",
  interactive: "交互",
  chart: "图表",
  art: "装饰",
};

async function copyWidgetCode(code: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(code);
    return;
  }
  const textarea = document.createElement("textarea");
  textarea.value = code;
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.select();
  const copied = document.execCommand("copy");
  textarea.remove();
  if (!copied) throw new Error("复制失败");
}

function themeProperty(variableName: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(variableName);
}

/** 工具消息展开时的展示文本：带 details 的 JSON content 只取其中的 text，避免展示原始 JSON */
function toolMessageDisplayText(content: string): string {
  try {
    const parsed = JSON.parse(content);
    if (parsed && typeof parsed === "object" && parsed.details !== undefined) {
      if (Array.isArray(parsed.content)) {
        return parsed.content
          .filter((c: any) => c.type === "text")
          .map((c: any) => c.text)
          .join("\n");
      }
      return "";
    }
  } catch {
    /* 非 JSON 内容原样展示 */
  }
  return content;
}

/** present_files 交付产物卡片（消息级批次，避免多个批次互相覆盖） */
function PresentFilesCards({ message }: { message: Message }) {
  const { openPreview } = useStore();
  const batch =
    message.deliveryBatch || deliveryBatchFromContent(message.content);
  if (!batch) return null;

  return (
    <PresentFilesBatch
      batch={batch}
      onOpenArtifact={(artifact) =>
        openPreview(artifact.previewTarget, "present_files", batch.files)
      }
      onShowArtifactInFolder={(artifact) => {
        if (artifact.source.path) showItemInFolder(artifact.source.path);
      }}
    />
  );
}

const GENERATION_WAIT_TIPS = [
  "正在生成可视化内容",
  "流程图节点较多，仍在编写",
  "请稍候，这不是卡住",
];

function GenerationWaitCard({ toolName }: { toolName?: string }) {
  const [elapsed, setElapsed] = useState(0);
  const [tipIndex, setTipIndex] = useState(0);
  useEffect(() => {
    const tick = window.setInterval(() => setElapsed((value) => value + 1), 1000);
    const tips = window.setInterval(
      () => setTipIndex((value) => (value + 1) % GENERATION_WAIT_TIPS.length),
      2800,
    );
    return () => {
      window.clearInterval(tick);
      window.clearInterval(tips);
    };
  }, []);
  const title = toolName === "show_widget" ? "正在生成可视化" : "正在继续生成";
  const elapsedLabel = elapsed < 60 ? `${elapsed}s` : `${Math.floor(elapsed / 60)}m${elapsed % 60}s`;
  return (
    <section className="widget-card widget-card-waiting" aria-live="polite" aria-label={title}>
      <div className="widget-card-header">
        <span className="widget-card-title">
          <span className="status-shimmer">{title}</span>
        </span>
        <span className="widget-card-module">{elapsedLabel}</span>
        <button
          type="button"
          className="widget-card-action"
          disabled
          title="生成完成后可复制或下载"
          aria-label="更多操作"
        >
          <MoreHorizontal size={13} />
        </button>
      </div>
      <div className="widget-loading">
        <span className="widget-loading-spinner" aria-hidden="true" />
        <span className="status-shimmer">{GENERATION_WAIT_TIPS[tipIndex]}</span>
      </div>
    </section>
  );
}

/** show_widget 可视化卡片（对标 参考设计 s19 Visualizer）：标题 + widget 渲染 */
function WidgetCard({ message }: { message: Message }) {
  const widget = parseWidgetData(message);
  const [copied, setCopied] = useState(false);
  const [viewMode, setViewMode] = useState<"ui" | "code">("ui");
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const cardRef = useRef<HTMLElement>(null);
  const [exportError, setExportError] = useState("");
  useEffect(() => {
    if (!menuOpen) return;
    const close = (event: MouseEvent) => {
      if (menuRef.current?.contains(event.target as Node)) return;
      setMenuOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [menuOpen]);
  if (message.status === "running" && !widget) {
    return <GenerationWaitCard toolName="show_widget" />;
  }
  if (!widget) return null;
  const moduleLabel = widget.module
    ? (WIDGET_MODULE_LABELS[widget.module] ?? widget.module)
    : "";
  const closeMenu = () => setMenuOpen(false);
  const handleCopy = async () => {
    try {
      await copyWidgetCode(widget.widget_code);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  };
  return (
    <section ref={cardRef} className="widget-card" aria-label="可视化 widget">
      <div className="widget-card-header">
        <span className="widget-card-title">{widget.title || "可视化"}</span>
        {moduleLabel && (
          <span className="widget-card-module">{moduleLabel}</span>
        )}
        <div className="widget-card-menu" ref={menuRef}>
          <button
            type="button"
            className="widget-card-action"
            onClick={() => setMenuOpen((open) => !open)}
            title="更多操作"
            aria-label="更多操作"
            aria-expanded={menuOpen}
          >
            <MoreHorizontal size={13} />
          </button>
          {menuOpen && (
            <div className="widget-card-menu-panel" role="menu">
              <button
                type="button"
                role="menuitem"
                onClick={async () => {
                  setExportError("");
                  try {
                    await downloadWidgetSource(
                      widget.widget_code,
                      widget.title,
                      themeProperty,
                      widget.module,
                    );
                  } catch (error) {
                    setExportError(error instanceof Error ? error.message : "可视化下载失败");
                  }
                  closeMenu();
                }}
              >
                <Download size={13} />
                下载到本地
              </button>
              <button
                type="button"
                role="menuitem"
                title="导出当前主题下的 PNG"
                onClick={async () => {
                  setExportError("");
                  try {
                    await downloadWidgetPng(
                      widget.widget_code,
                      widget.title,
                      themeProperty,
                      widget.module,
                      cardRef.current?.querySelector("iframe"),
                    );
                  } catch (error) {
                    setExportError(error instanceof Error ? error.message : "可视化图片导出失败");
                  }
                  closeMenu();
                }}
              >
                <Image size={13} />
                下载为图片
              </button>
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  void handleCopy();
                  closeMenu();
                }}
              >
                {copied ? <Check size={13} /> : <Copy size={13} />}
                {copied ? "已复制" : "复制代码"}
              </button>
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setViewMode((mode) => (mode === "ui" ? "code" : "ui"));
                  closeMenu();
                }}
              >
                {viewMode === "ui" ? <Code2 size={13} /> : <Layout size={13} />}
                {viewMode === "ui" ? "查看代码" : "显示 UI"}
              </button>
            </div>
          )}
        </div>
      </div>
      {exportError && <div className="widget-error" role="alert">{exportError}</div>}
      {viewMode === "code" ? (
        <pre className="widget-code-view">{widget.widget_code}</pre>
      ) : (
        <WidgetRenderer widget={widget} />
      )}
    </section>
  );
}

function extractFilePath(content: string): string {
  try {
    const parsed = JSON.parse(content);
    const path = parsed?.details?.path || parsed?.path || "";
    if (
      path &&
      /\.(docx|xlsx|pptx|pdf|png|jpg|jpeg|gif|svg|txt|md|html|csv|json)$/i.test(
        path,
      )
    ) {
      return path;
    }
  } catch {
    /* not JSON */
  }
  const match = content.match(/(?:\/|~)[^\s]+\.\w+/i);
  return match ? match[0] : "";
}

function renderContentWithPath(
  content: string,
  onOpenPreview: (path: string) => void,
): React.ReactNode {
  const filePath = extractFilePath(content);
  const lines = content.split("\n");

  return (
    <pre className="tool-card-box-code output">
      {lines.map((line, i) => (
        <span key={i}>
          {i > 0 && "\n"}
          {filePath && line.includes(filePath) ? (
            <>
              {line.slice(0, line.indexOf(filePath))}
              <span
                className="tool-output-path"
                onClick={(e) => {
                  e.stopPropagation();
                  onOpenPreview(filePath);
                }}
                title="点击预览文件"
              >
                {filePath}
              </span>
              {line.slice(line.indexOf(filePath) + filePath.length)}
            </>
          ) : (
            line
          )}
        </span>
      ))}
    </pre>
  );
}

function ToolActivityItem({
  message,
  autoCorrected = false,
  defaultExpanded = false,
}: {
  message: Message;
  autoCorrected?: boolean;
  defaultExpanded?: boolean;
}) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  useEffect(() => setExpanded(defaultExpanded), [defaultExpanded]);
  const { openPreview } = useStore();
  const status = getToolStatus(message);
  const hasDetails = Boolean(message.toolArgs || message.content);
  const statusIcon =
    autoCorrected ? (
      <Check size={12} />
    ) : status === "error" ? (
      <X size={12} />
    ) : status === "running" ? (
      <Loader2 size={12} className="tool-spin" />
    ) : null;

  const filePath = message.content
    ? extractFilePath(String(message.content))
    : "";
  const handlePreviewClick = (path: string) => {
    openPreview(path, message.toolName);
  };

  const Icon = toolActivityIcon(message.toolName);

  return (
    <div
      className={`tool-activity-item ${autoCorrected ? "corrected" : status}`}
    >
      <button
        type="button"
        className="tool-activity-row"
        onClick={() => hasDetails && setExpanded((value) => !value)}
        aria-expanded={hasDetails ? expanded : undefined}
      >
        <Icon
          size={13}
          strokeWidth={1.7}
          className="tool-activity-command-icon"
          aria-hidden="true"
        />
        <span className="tool-activity-description">
          {getToolDescription(message)}
        </span>
        {(autoCorrected || status !== "success") && (
          <span
            className={`tool-activity-status ${
              autoCorrected ? "corrected" : status
            }`}
          >
            {statusIcon}
            <span>
              {autoCorrected
                ? "已自动纠正"
                : status === "running"
                  ? "执行中"
                  : "失败"}
            </span>
          </span>
        )}
        {hasDetails && (
          <ChevronDown
            size={12}
            className={`tool-activity-chevron ${expanded ? "expanded" : ""}`}
            aria-hidden="true"
          />
        )}
      </button>

      {expanded && (
        <div className="tool-activity-details">
          {message.toolArgs && (
            <pre className="tool-card-box-code command">{message.toolArgs}</pre>
          )}
          {message.content &&
            renderContentWithPath(
              toolMessageDisplayText(String(message.content)),
              handlePreviewClick,
            )}
          {filePath && (
            <button
              className="tool-preview-btn"
              onClick={() => handlePreviewClick(filePath)}
            >
              <Eye size={13} strokeWidth={1.7} aria-hidden="true" />
              预览文件
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/** 连续工具调用收拢成轻量的“已处理”思考记录。 */
function ToolActivityGroup({
  messages,
  revealBody = false,
  revealDetails = false,
}: {
  messages: Message[];
  revealBody?: boolean;
  revealDetails?: boolean;
}) {
  const autoCorrectedIds = useMemo(
    () => autoCorrectedToolCallIds(messages),
    [messages],
  );
  const hasRunning = messages.some(
    (message) => getToolStatus(message) === "running",
  );
  const hasError = messages.some(
    (message) =>
      getToolStatus(message) === "error" &&
      !autoCorrectedIds.has(message.id),
  );
  const [headerOpen, setHeaderOpen] = useState(hasRunning);
  const [listOpen, setListOpen] = useState(revealDetails);
  useEffect(() => setListOpen(revealDetails), [revealDetails]);
  useEffect(() => {
    setHeaderOpen(hasRunning);
  }, [hasRunning]);
  const duration = formatToolDuration(messages);
  const allCommands = messages.every((message) => message.toolName === "bash");
  const allSkillDraft = messages.every((message) =>
    message.toolName?.startsWith("skill_draft_"),
  );
  const groupLabel = allCommands
    ? `运行了 ${messages.length} 个命令`
    : allSkillDraft
      ? `处理了 ${messages.length} 项技能草稿`
      : `运行了 ${messages.length} 个操作`;
  const showSummary = revealBody || headerOpen;

  return (
    <section
      className={`tool-process ${hasRunning ? "running" : ""} ${hasError ? "error" : ""} ${revealBody ? "revealed" : ""}`}
      aria-label="思考与工具运行记录"
    >
      {!revealBody && (
        <button
          type="button"
          className="tool-process-header"
          onClick={() => {
            if (headerOpen) setListOpen(false);
            setHeaderOpen((value) => !value);
          }}
          aria-expanded={headerOpen}
        >
          <span>
            {hasRunning ? "处理中" : hasError ? "处理完成，部分失败" : "已处理"}
            {!hasRunning && duration && (
              <span className="tool-process-duration">{duration}</span>
            )}
          </span>
          <ChevronDown
            size={13}
            className={`tool-process-chevron ${headerOpen ? "expanded" : ""}`}
            aria-hidden="true"
          />
        </button>
      )}

      {showSummary && (
        <div className="tool-process-body">
          <button
            type="button"
            className="tool-process-summary"
            onClick={() => setListOpen((value) => !value)}
            aria-expanded={listOpen}
          >
            <SquareTerminal
              size={revealBody ? 14 : 13}
              strokeWidth={1.7}
              aria-hidden="true"
            />
            <span>{groupLabel}</span>
            <ChevronDown
              size={revealBody ? 14 : 12}
              className={`tool-process-summary-chevron${listOpen ? " expanded" : ""}`}
              aria-hidden="true"
            />
          </button>
          {listOpen && (
            <div className="tool-activity-list">
              {messages.map((message) => (
                <ToolActivityItem
                  key={message.id}
                  message={message}
                  autoCorrected={autoCorrectedIds.has(message.id)}
                  defaultExpanded={false}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </section>
  );
}

const MemoizedToolActivityGroup = memo(ToolActivityGroup);

/** 助手消息内容（照 参考设计 AssistantContentRenderer） */
function codeText(node: unknown): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(codeText).join("");
  if (isValidElement(node)) {
    return codeText((node.props as { children?: ReactNode }).children);
  }
  return "";
}

function fencedCodeFromPre(children: ReactNode) {
  const codeNode = (Array.isArray(children) ? children : [children]).find(
    (child) => isValidElement(child) && child.type === "code",
  );
  if (!isValidElement(codeNode)) return null;

  const props = codeNode.props as { className?: string; children?: ReactNode };
  const language = props.className?.match(/(?:^|\s)language-([^\s]+)/)?.[1];
  const code = codeText(props.children).replace(/\n$/, "");
  return { code, language };
}

function AssistantContent({
  content,
  streaming,
}: {
  content: string;
  streaming: boolean;
}) {
  if (streaming) {
    return (
      <div className="assistantTextContent">
        <div className="streaming-plain-text">{content}</div>
        <span className="streaming-cursor" />
      </div>
    );
  }
  return (
    <div className="assistantTextContent">
      <div className="cb-markdown">
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          components={{
            pre({ children }: { children?: ReactNode }) {
              const codeBlock = fencedCodeFromPre(children);
              if (!codeBlock) return <pre>{children}</pre>;
              return <CodeBlock {...codeBlock} streaming={false} />;
            },
            a({ children, ...props }: any) {
              return (
                <a target="_blank" rel="noopener noreferrer" {...props}>
                  {children}
                </a>
              );
            },
          }}
        >
          {content}
        </ReactMarkdown>
      </div>
    </div>
  );
}

const MemoizedPresentFilesCards = memo(PresentFilesCards);
const MemoizedWidgetCard = memo(WidgetCard);

const MemoizedAssistantContent = memo(AssistantContent);

function assistantMessageModifiers(thinking?: string, content?: string): string {
  const hasThinking = Boolean(thinking?.trim());
  const hasResult = hasAnswerText(content);
  return [
    hasThinking ? "has-thinking" : "",
    hasResult ? "has-result" : "",
    hasThinking && !hasResult ? "thinking-only" : "",
  ]
    .filter(Boolean)
    .join(" ");
}

function AssistantThinking({
  content,
  streaming,
  showIcon = true,
  defaultExpanded = false,
}: {
  content: string;
  streaming: boolean;
  showIcon?: boolean;
  defaultExpanded?: boolean;
}) {
  const bodyRef = useRef<HTMLPreElement>(null);
  const hasBody = Boolean(content.trim());
  const [open, setOpen] = useState((streaming || defaultExpanded) && hasBody);
  useEffect(() => {
    if (!streaming) return;
    const element = bodyRef.current;
    if (element) element.scrollTop = element.scrollHeight;
  }, [content, streaming]);
  useEffect(() => {
    setOpen((streaming || defaultExpanded) && hasBody);
  }, [streaming, hasBody, defaultExpanded]);
  if (!streaming && !hasBody) return null;
  const liveLabel = hasBody ? "深度思考" : "思考中";
  return (
    <details
      className={`assistant-thinking${streaming ? " is-streaming" : ""}`}
      open={open}
      onToggle={(event) => {
        if (streaming) return;
        setOpen(event.currentTarget.open);
      }}
    >
      <summary>
        {streaming ? (
          <span className="status-shimmer">{liveLabel}</span>
        ) : (
          <>
            {showIcon && (
              <Sparkles size={14} className="assistant-thinking-icon" aria-hidden="true" />
            )}
            已思考
            <ChevronDown
              size={14}
              className="assistant-thinking-chevron"
              aria-hidden="true"
            />
          </>
        )}
      </summary>
      {hasBody && (
        <div className="assistant-thinking-body-wrapper">
          <pre ref={bodyRef} className="assistant-thinking-body">{content}</pre>
        </div>
      )}
    </details>
  );
}

const MemoizedAssistantThinking = memo(AssistantThinking);

/** 用户消息内的技能/斜杠指令标签：与输入框保持一致的芯片样式。 */
function SkillTag({ text, label }: { text: string; label?: string }) {
  const displayLabel = label || text.replace(/^\//, "");
  const sceneIcon = composerSceneIconId(text);
  return (
    <span
      className="composer-token"
      data-icon={sceneIcon ?? undefined}
      title={displayLabel}
    >
      <span className="composer-chip-lead">
        <span
          className={sceneIcon
            ? "composer-token__scene-icon"
            : "composer-token__skill-icon"}
          aria-hidden="true"
        />
      </span>
      <span className="composer-token__label">{displayLabel}</span>
    </span>
  );
}

function SkillTaggedText({
  text,
  commands,
  labels,
  attachments,
  attachmentAnchors,
}: {
  text: string;
  commands: ReadonlySet<string>;
  labels: ReadonlyMap<string, string>;
  attachments?: Message["attachments"];
  attachmentAnchors?: Message["attachmentAnchors"];
}) {
  return (
    <>
      {interleaveComposerAttachments(
        text,
        attachments,
        attachmentAnchors,
        commands,
        labels,
      ).map((part, index) => {
        if (part.type === "attachment") {
          return (
            <span
              className="composer-attachment-token"
              key={part.attachment.id || index}
              title={part.attachment.name}
            >
              <span
                className="composer-attachment-token__glyph"
                aria-hidden="true"
              />
              <span className="composer-attachment-token__label">
                {part.attachment.name}
              </span>
            </span>
          );
        }
        if (part.type === "tag") {
          return <SkillTag key={index} text={part.text} label={part.label} />;
        }
        return (
          <span key={index} className="user-message-text">
            {part.text}
          </span>
        );
      })}
    </>
  );
}

function ThinkingBubble() {
  return (
    <div className="chatMessageContainer assistantRow">
      <div className="avatarWrapper">
        <div className="assistantAvatar">
          <img
            className="assistantAvatarImage"
            src="/assistant-avatar.png"
            alt=""
          />
        </div>
        <div className="assistantName">PiCoddy</div>
      </div>
      <div className="assistantMessage thinking-only">
        <div className="assistantMessageContent">
          <AssistantThinking content="" streaming />
        </div>
      </div>
    </div>
  );
}

function ActiveStreamThinking() {
  const thinking = useStreamStore((state) => state.activeStream?.thinking ?? "");
  if (!thinking.trim()) return null;
  return <MemoizedAssistantThinking content={thinking} streaming showIcon={false} />;
}

function ActiveStreamMessage({
  scrollRef,
  autoScrollRef,
  nested = false,
}: {
  scrollRef: RefObject<HTMLDivElement | null>;
  autoScrollRef: RefObject<boolean>;
  nested?: boolean;
}) {
  const activeStream = useStreamStore((state) => state.activeStream);

  useEffect(() => {
    if (!activeStream || !autoScrollRef.current) return;
    const frame = requestAnimationFrame(() => {
      const element = scrollRef.current;
      if (element && autoScrollRef.current) {
        element.scrollTop = element.scrollHeight;
      }
    });
    return () => cancelAnimationFrame(frame);
  }, [activeStream?.content, activeStream?.thinking, autoScrollRef, scrollRef]);

  if (!activeStream || (nested && !hasAnswerText(activeStream.content))) return null;
  const body = (
    <div
      className={`assistantMessage streamingMessage ${assistantMessageModifiers(activeStream.thinking, activeStream.content)}`}
    >
      <div className="assistantMessageContent">
        {!nested && <MemoizedAssistantThinking
          content={activeStream.thinking ?? ""}
          streaming={!hasAnswerText(activeStream.content)}
          showIcon={false}
        />}
        {(activeStream.content || !activeStream.thinking) && (
          <MemoizedAssistantContent
            content={activeStream.content}
            streaming
          />
        )}
      </div>
    </div>
  );
  if (nested) return body;
  return (
    <div
      key={activeStream.id}
      className="chatMessageContainer assistantRow"
    >
      <div className="avatarWrapper">
        <div className="assistantAvatar">
          <img
            className="assistantAvatarImage"
            src="/assistant-avatar.png"
            alt=""
          />
        </div>
        <div className="assistantName">PiCoddy</div>
      </div>
      {body}
    </div>
  );
}

function formatTime(timestamp?: number): string {
  if (!timestamp) return "";
  const d = new Date(timestamp);
  const h = String(d.getHours()).padStart(2, "0");
  const m = String(d.getMinutes()).padStart(2, "0");
  return `${h}:${m}`;
}

export default function ChatArea({ showWelcome = true, showHeader = true, renderRunDelivery }: { showWelcome?: boolean; showHeader?: boolean; renderRunDelivery?: (sourceMessageId: string) => import('react').ReactNode } = {}) {
  const messages = useStore((state) => state.messages);
  const hasActiveStream = useStreamStore(
    (state) => state.activeStream !== null,
  );
  const busy = useStore((state) => state.busy);
  const taskStatus = useStore((state) => state.taskStatus);
  const currentConvId = useStore((state) => state.currentConvId);
  const conversations = useStore((state) => state.conversations);
  const requirementInputs = useRequirementInputHistory(currentConvId, !!conversations.find(c => c.id === currentConvId)?.requirementScoped, busy, messages.length);
  const expertNotice = useStore((state) => state.expertNotice);
  const dismissExpertNotice = useStore((state) => state.dismissExpertNotice);
  const scrollRef = useRef<HTMLDivElement>(null);
  const autoScrollRef = useRef(true);
  const fromBottomRef = useRef(0);
  const prevLastRunSettledRef = useRef<boolean | null>(null);
  const lastSeenMessageIdRef = useRef<string | null>(null);
  const conversationTurns = useMemo(
    () => groupConversationRuns(messages),
    [messages],
  );
  const streamInsideLastRun = Boolean(
    hasActiveStream &&
      conversationTurns.at(-1)?.kind === "assistant-run",
  );
  const hasRunningTool = messages.some(
    (message) => message.role === "tool" && message.status === "running",
  );
  const lastRunSettled = Boolean(
    conversationTurns.at(-1)?.kind === "assistant-run" &&
      isSettledRun({
        isLastRun: true,
        busy,
        hasActiveStream,
        hasRunningTool,
      }),
  );
  const hasLiveThinking = useStreamStore((state) => Boolean(state.activeStream?.thinking?.trim()));

  // 与输入框一致的技能/斜杠指令标签识别（仅用于用户消息渲染）
  const skillCommands = useSkillStore((state) => state.skills);
  const slashTagContext = useMemo(() => {
    const commands = new Set<string>();
    const labels = new Map<string, string>();
    for (const skill of skillCommands) {
      if (skill.disabled) continue;
      commands.add(`/${skill.name}`.toLowerCase());
      labels.set(
        `/${skill.name}`.toLowerCase(),
        skill.displayName || skill.name,
      );
    }
    for (const command of SLASH_COMMANDS) {
      commands.add(command.cmd.toLowerCase());
      labels.set(command.cmd.toLowerCase(), command.name);
    }
    return { commands, labels };
  }, [skillCommands]);

  // 功能按钮状态记录
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [ratings, setRatings] = useState<Record<string, "up" | "down">>({});
  const [speakingId, setSpeakingId] = useState<string | null>(null);

  // 复制文字
  const handleCopy = (id: string, text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  // 点赞/踩评
  const handleRate = (id: string, type: "up" | "down") => {
    setRatings(
      (prev) =>
        ({
          ...prev,
          [id]: prev[id] === type ? undefined : type,
        }) as any,
    );
  };

  // 语音朗读 (HTML5 SpeechSynthesis)
  const handleSpeak = (id: string, text: string) => {
    if (speakingId === id) {
      window.speechSynthesis.cancel();
      setSpeakingId(null);
    } else {
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.onend = () => setSpeakingId(null);
      utterance.onerror = () => setSpeakingId(null);
      window.speechSynthesis.speak(utterance);
      setSpeakingId(id);
    }
  };

  // 分享功能
  const handleShare = (text: string) => {
    navigator.clipboard.writeText(text);
    // 可选：静默提示或自定义反馈。这里复制文字后可以直接提示已复制
  };

  // 自动滚动（照 参考设计 useMessageScroll 模式）
  // 用户主动发送新消息时，即使先前在看历史，也重新贴底跟随生成内容。
  const lastMessage = messages.at(-1);
  const lastMessageId = lastMessage?.id ?? null;
  if (lastMessageId !== lastSeenMessageIdRef.current) {
    if (lastMessage?.role === "user") {
      autoScrollRef.current = true;
      fromBottomRef.current = 0;
    }
    lastSeenMessageIdRef.current = lastMessageId;
  }

  useEffect(() => {
    if (!autoScrollRef.current) return;
    const frame = requestAnimationFrame(() => {
      const element = scrollRef.current;
      if (element && autoScrollRef.current) {
        element.scrollTop = element.scrollHeight;
      }
    });
    return () => cancelAnimationFrame(frame);
  }, [messages]);

  useLayoutEffect(() => {
    if (prevLastRunSettledRef.current === null) {
      prevLastRunSettledRef.current = lastRunSettled;
      return;
    }
    const becameSettled = lastRunSettled && !prevLastRunSettledRef.current;
    prevLastRunSettledRef.current = lastRunSettled;
    if (!becameSettled) return;
    const element = scrollRef.current;
    if (!element) return;
    if (autoScrollRef.current || fromBottomRef.current < 80) {
      element.scrollTop = element.scrollHeight;
      autoScrollRef.current = true;
      return;
    }
    element.scrollTop =
      element.scrollHeight - element.clientHeight - fromBottomRef.current;
  }, [lastRunSettled]);

  // 用户向上滚动时暂停自动滚动
  const handleScroll = () => {
    if (!scrollRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = scrollRef.current;
    fromBottomRef.current = scrollHeight - scrollTop - clientHeight;
    autoScrollRef.current = fromBottomRef.current < 80;
  };

  const scrollToBottom = () => {
    if (scrollRef.current) {
      scrollRef.current.scrollTo({
        top: scrollRef.current.scrollHeight,
        behavior: "smooth",
      });
      autoScrollRef.current = true;
    }
  };

  const conv = conversations.find((c) => c.id === currentConvId);
  const isSkillCreator = conv?.category === "skill_creator";
  const isCreatorConversation = isSkillCreator || conv?.category === "expert_creator";
  const showThinking =
    busy &&
    !hasActiveStream &&
    messages.length > 0 &&
    messages[messages.length - 1].role === "user";
  const showScrollBtn = !autoScrollRef.current && messages.length > 0;

  return (
    <div
      className="chat-area-root"
      style={{
        flex: 1,
        display: "flex",
        flexDirection: "column",
        minHeight: 0,
      }}
    >
      {/* 顶栏 */}
      {showHeader && <header className="chat-header">
        <span className="chat-header-title">
          {conv?.title || "新对话"}
        </span>
        {conv &&
          (conv.expertId || conv.category === "expert_creator") && (
            <ConversationExpertControl conversation={conv} busy={busy} />
          )}
      </header>}

      <div
        className={`chat-workspace ${isCreatorConversation ? "chat-workspace--creator" : ""}`}
      >
        {/* 消息流 */}
        <div className="chat-scroll-pane">
        <div ref={scrollRef} onScroll={handleScroll} className="chat-scroll">
          <div
            className="chat-scroll-content"
            style={{
              maxWidth: 900,
              margin: "0 auto",
              padding: "24px 28px 28px",
              display: "flex",
              flexDirection: "column",
              gap: 20,
            }}
          >
            {expertNotice === "uninstalled" && (
              <div className="chat-expert-notice" role="status">
                <span>原专家已卸载，已切换为普通会话</span>
                <button
                  type="button"
                  onClick={dismissExpertNotice}
                  aria-label="关闭提示"
                  title="关闭提示"
                >
                  <X size={14} />
                </button>
              </div>
            )}
            {showWelcome && !isCreatorConversation && messages.length === 0 && !busy && <WelcomeScreen />}

            {conversationTurns.map((turn, turnIndex) => {
              if (turn.kind === "user") {
                const msg = turn.message;
                return (
                  <div
                    key={msg.id}
                    className="chatMessageContainer userRow"
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      alignItems: "flex-end",
                    }}
                  >
                    <div className="userMessageWrapper">
                      {(msg.content || !!msg.attachments?.length) && (
                        <div className="userMessageBubble">
                          {isCreatorFirstUserMessage(conv, messages, msg) && (
                            <div
                              className="creator-message-context"
                              aria-label="技能创建上下文"
                            >
                              <span className="composer-context-token">
                                <span className="composer-context-token__label">
                                  skill-creator
                                </span>
                              </span>
                            </div>
                          )}
                          <SkillTaggedText
                            text={msg.content}
                            commands={slashTagContext.commands}
                            labels={slashTagContext.labels}
                            attachments={msg.attachments}
                            attachmentAnchors={msg.attachmentAnchors}
                          />
                        </div>
                      )}
                    </div>
                    {requirementInputs.find(s => s.messageId === msg.id || s.id === msg.requirementInputId) && <RequirementInputHistory snapshot={requirementInputs.find(s => s.messageId === msg.id || s.id === msg.requirementInputId)!} />}
                    <div className="message-action-row user-actions">
                      <button
                        className="action-btn"
                        onClick={() => handleCopy(msg.id, msg.content)}
                        title="复制内容"
                      >
                        {copiedId === msg.id ? (
                          <Check size={12} className="copied" />
                        ) : (
                          <Copy size={12} />
                        )}
                      </button>
                      {msg.createdAt && (
                        <span className="message-time">
                          {formatTime(msg.createdAt)}
                        </span>
                      )}
                    </div>
                  </div>
                );
              }

              const lastTurn = conversationTurns.at(-1);
              const isLastRun = lastTurn?.kind === "assistant-run" &&
                lastTurn.id === turn.id;
              const settled = isSettledRun({
                isLastRun,
                busy,
                hasActiveStream,
                hasRunningTool,
              });
              const timeline = buildAssistantTimeline(turn.items);
              const tail = timeline.at(-1);
              const activeProcess = !settled && tail?.kind === "process" ? tail : null;
              const entries = activeProcess ? timeline.slice(0, -1) : timeline;
              const finalMessageId = [...timeline].reverse().find(entry => entry.kind === "answer")?.id;
              const previousTurn = conversationTurns[turnIndex - 1];
              const runStartedAt = previousTurn?.kind === "user"
                ? previousTurn.message.createdAt
                : undefined;
              const durationLabel = formatRunDuration(
                runElapsedMs(turn.items, runStartedAt),
              );

              const renderProcess = (items: AssistantRunItem[], active: boolean, key: string) => (
                <AssistantProcessBundle key={key}
                  durationLabel={durationLabel}
                  active={active}
                  defaultExpanded={active}
                  statusLabel={taskStatus?.phase === "model_activity" ? taskStatus.message : hasRunningTool ? "处理中" : hasLiveThinking ? "思考中" : "正在生成"}
                  hasDetails={items.length > 0 || (active && hasLiveThinking)}
                >
                  {items.map((item, index) => {
                    if (item.kind === "tool-group") {
                      return (
                        <MemoizedToolActivityGroup
                          key={processItemKey(item, index)}
                          messages={item.messages}
                          revealBody
                          revealDetails={active}
                        />
                      );
                              }
                              if (
                                item.kind !== "message" ||
                                item.message.role !== "assistant"
                              ) {
                                return null;
                              }
                              const msg = item.message;
                              return (
                                <div
                                  key={processItemKey(item, index)}
                                  className={`assistantMessage ${assistantMessageModifiers(msg.thinking, msg.content)}`}
                                >
                                  <div className="assistantMessageContent">
                                    <MemoizedAssistantThinking
                                      content={msg.thinking ?? ""}
                                      streaming={false}
                                      showIcon
                                      defaultExpanded={false}
                                    />
                                    {hasAnswerText(msg.content) && (
                                      <MemoizedAssistantContent
                                        content={msg.content}
                                        streaming={false}
                                      />
                                    )}
                                  </div>
                                </div>
                              );
                            })}
                            {active && <ActiveStreamThinking />}
                          </AssistantProcessBundle>
              );

              return (
                <div
                  key={turn.id}
                  className="chatMessageContainer assistantRow assistant-run-row"
                >
                  <div className="avatarWrapper">
                    <div className="assistantAvatar">
                      <img
                        className="assistantAvatarImage"
                        src="/assistant-avatar.png"
                        alt=""
                      />
                    </div>
                    <div className="assistantName">PiCoddy</div>
                  </div>
                  <div className="assistant-run-content">
                    <>
                        {previousTurn?.kind === 'user' && renderRunDelivery?.(previousTurn.message.id)}
                        {entries.map((item) => {
                          if (item.kind === "process") return renderProcess(item.items, false, item.id);
                          if (item.kind === "present-files") {
                            return (
                              <MemoizedPresentFilesCards
                                key={item.id}
                                message={item.message}
                              />
                            );
                          }
                          if (item.kind === "widget") {
                            return (
                              <MemoizedWidgetCard
                                key={item.id}
                                message={item.message}
                              />
                            );
                          }
                          const msg = item.message;
                          return (
                            <div
                              key={msg.id}
                              className={`assistantMessage ${assistantMessageModifiers(undefined, msg.content)}`}
                            >
                              <div className="assistantMessageContent">
                                <MemoizedAssistantContent
                                  content={msg.content}
                                  streaming={false}
                                />
                              </div>
                              {settled && msg.id === finalMessageId && (
                                <div className="message-action-row assistant-actions">
                                  <button
                                    className="action-btn"
                                    onClick={() => handleCopy(msg.id, msg.content)}
                                    title="复制内容"
                                  >
                                    {copiedId === msg.id ? (
                                      <Check size={12} className="copied" />
                                    ) : (
                                      <Copy size={12} />
                                    )}
                                  </button>
                                  <button
                                    className={`action-btn ${ratings[msg.id] === "up" ? "active-like" : ""}`}
                                    onClick={() => handleRate(msg.id, "up")}
                                    title="赞同"
                                  >
                                    <ThumbsUp size={12} />
                                  </button>
                                  <button
                                    className={`action-btn ${ratings[msg.id] === "down" ? "active-dislike" : ""}`}
                                    onClick={() => handleRate(msg.id, "down")}
                                    title="反对"
                                  >
                                    <ThumbsDown size={12} />
                                  </button>
                                  <button
                                    className={`action-btn ${speakingId === msg.id ? "active-speak" : ""}`}
                                    onClick={() => handleSpeak(msg.id, msg.content)}
                                    title={
                                      speakingId === msg.id
                                        ? "停止朗读"
                                        : "语音朗读"
                                    }
                                  >
                                    <Volume2 size={12} />
                                  </button>
                                  <button
                                    className="action-btn"
                                    onClick={() => handleShare(msg.content)}
                                    title="复制链接分享"
                                  >
                                    <Share2 size={12} />
                                  </button>
                                  <button className="action-btn" title="更多选项">
                                    <MoreHorizontal size={12} />
                                  </button>
                                  {msg.createdAt && (
                                    <span className="message-time">
                                      {formatTime(msg.createdAt)}
                                    </span>
                                  )}
                                </div>
                              )}
                            </div>
                          );
                        })}
                    </>
                    {isLastRun && streamInsideLastRun && (
                      <ActiveStreamMessage
                        nested
                        scrollRef={scrollRef}
                        autoScrollRef={autoScrollRef}
                      />
                    )}
                    {!settled && renderProcess(activeProcess?.items ?? [], true, activeProcess?.id ?? "active-process")}
                  </div>
                </div>
              );
            })}

            {!streamInsideLastRun && (
              <ActiveStreamMessage
                scrollRef={scrollRef}
                autoScrollRef={autoScrollRef}
              />
            )}

            {/* 内联工具确认卡片 */}
            {busy && taskStatus && taskStatus.phase !== "running" && taskStatus.phase !== "model_activity" && (
              <div className="task-runtime-status" role="status" aria-live="polite">
                {taskStatus.message}
              </div>
            )}
            <ToolConfirmDialog />

            {/* 思考中指示器 */}
            {showThinking && <ThinkingBubble />}
          </div>
        </div>
          {showScrollBtn && (
            <button
              type="button"
              className="chat-scroll-to-bottom"
              onClick={scrollToBottom}
              title="滚动到底部"
            >
              <ChevronDown size={18} color="var(--text-2)" />
            </button>
          )}
        </div>
        {isSkillCreator && currentConvId && (
          <SkillDraftPanel
            key={currentConvId}
            conversationId={currentConvId}
            busy={busy}
            messageCount={messages.length}
          />
        )}
        {conv?.category === 'expert_creator' && currentConvId && <ExpertDraftPanel key={currentConvId} conversationId={currentConvId} busy={busy} messageCount={messages.length}/>}
      </div>
    </div>
  );
}

/** 新建任务欢迎标题 */
function WelcomeScreen() {
  return (
    <div className="welcome-screen">
      <div className="welcome-header">
        <PiLogo size={64} className="welcome-brand-icon" />
        <h1 className="welcome-title">你好，我是 PiCoddy</h1>
        <p className="welcome-subtitle">从一个想法开始，一起把事情做成。</p>
      </div>
    </div>
  );
}
