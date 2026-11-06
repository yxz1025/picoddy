import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { Bot, ChevronDown, CircleStop, Menu, PanelRight, Paperclip, Send, Sparkles, Wrench } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import { api, errorMessage } from "../api/client";
import { streamRunEvents } from "../api/stream";
import { extractText, getPiMessageRole } from "../lib/pi-content";
import { clearRunIdempotencyKey, getRunIdempotencyKey } from "../lib/run-key";
import type {
  Approval,
  Connector,
  Conversation,
  Expert,
  Message,
  Model,
  Workspace,
  Run,
  RunEvent,
  RunInput,
  RunStatus,
  Skill,
} from "../types";
import { Button, RetryButton, Spinner, StateBlock } from "./ui";

const TERMINAL_STATUSES = new Set<RunStatus>(["succeeded", "failed", "cancelled", "interrupted"]);
const statusLabels: Record<RunStatus, string> = {
  queued: "排队中",
  provisioning: "准备环境",
  running: "执行中",
  waiting_approval: "等待确认",
  cancelling: "正在取消",
  cleanup_pending: "等待清理",
  succeeded: "已完成",
  failed: "失败",
  cancelled: "已取消",
  interrupted: "已中断",
};

export interface ChatSelection {
  skillIds: string[];
  connectorIds: string[];
  fileIds: string[];
  expertId?: string;
  modelId?: string;
}

interface Props {
  conversation: Conversation | null;
  skills: Skill[];
  connectors: Connector[];
  experts: Expert[];
  models: Model[];
  workspaces: Workspace[];
  selection: ChatSelection;
  onSelectionChange: (next: ChatSelection) => void;
  onOpenSidebar: () => void;
  onOpenInspector: (tab: "files" | "tools" | "activity") => void;
  onWorkspaceChange: (workspaceId: string | null) => Promise<void>;
  onFilesChanged: () => Promise<unknown>;
  onRunState: (run: Run | null, events: RunEvent[], approvals: Approval[]) => void;
}

export function ChatPanel(props: Props) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [run, setRun] = useState<Run | null>(null);
  const [events, setEvents] = useState<RunEvent[]>([]);
  const [approvals, setApprovals] = useState<Approval[]>([]);
  const [draft, setDraft] = useState("");
  const [streamText, setStreamText] = useState("");
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [streamWarning, setStreamWarning] = useState<string | null>(null);
  const [showOptions, setShowOptions] = useState(false);
  const [bindingWorkspace, setBindingWorkspace] = useState(false);
  const [loadNonce, setLoadNonce] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  const eventCursorRef = useRef(0);
  const filesRefreshedRunRef = useRef<string | null>(null);
  const generationRef = useRef(0);
  const conversationId = props.conversation?.id ?? null;

  const isCurrent = useCallback(
    (generation: number, signal?: AbortSignal) => generationRef.current === generation && !signal?.aborted,
    [],
  );

  const reloadMessages = useCallback(async (generation = generationRef.current, signal?: AbortSignal) => {
    if (!conversationId) return [];
    const next = await api.get<Message[]>(`/api/conversations/${conversationId}/messages`, signal);
    if (isCurrent(generation, signal)) setMessages(next);
    return next;
  }, [conversationId, isCurrent]);

  const reloadApprovals = useCallback(async (runId: string, generation = generationRef.current, signal?: AbortSignal) => {
    const next = await api.get<Approval[]>(`/api/runs/${runId}/approvals`, signal);
    if (isCurrent(generation, signal)) setApprovals(next);
    return next;
  }, [isCurrent]);

  const reloadRun = useCallback(async (runId: string, generation = generationRef.current, signal?: AbortSignal) => {
    const next = await api.get<Run>(`/api/runs/${runId}`, signal);
    if (isCurrent(generation, signal)) setRun(next);
    return next;
  }, [isCurrent]);

  useEffect(() => {
    const generation = ++generationRef.current;
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    setRun(null);
    setEvents([]);
    setApprovals([]);
    setMessages([]);
    setStreamText("");
    setStreamWarning(null);
    setSubmitting(false);
    setBindingWorkspace(false);
    setShowOptions(false);
    eventCursorRef.current = 0;
    if (!conversationId) {
      setLoading(false);
      return () => {
        controller.abort();
        if (generationRef.current === generation) generationRef.current += 1;
      };
    }

    void (async () => {
      try {
        const [nextMessages, runs] = await Promise.all([
          api.get<Message[]>(`/api/conversations/${conversationId}/messages`, controller.signal),
          api.get<Run[]>(`/api/runs?conversationId=${encodeURIComponent(conversationId)}`, controller.signal),
        ]);
        if (!isCurrent(generation, controller.signal)) return;
        setMessages(nextMessages);
        const latest = [...runs].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))[0] ?? null;
        setRun(latest);
        if (latest && !TERMINAL_STATUSES.has(latest.status)) {
          await reloadApprovals(latest.id, generation, controller.signal);
        }
      } catch (cause) {
        if (isCurrent(generation, controller.signal)) setError(errorMessage(cause));
      } finally {
        if (isCurrent(generation, controller.signal)) setLoading(false);
      }
    })();
    return () => {
      controller.abort();
      if (generationRef.current === generation) generationRef.current += 1;
    };
  }, [conversationId, isCurrent, loadNonce, reloadApprovals]);

  const reconcile = useCallback(
    async (runId: string, generation = generationRef.current, signal?: AbortSignal) => {
      await Promise.allSettled([
        reloadMessages(generation, signal),
        reloadRun(runId, generation, signal),
        reloadApprovals(runId, generation, signal),
      ]);
    },
    [reloadApprovals, reloadMessages, reloadRun],
  );

  useEffect(() => {
    if (!run || TERMINAL_STATUSES.has(run.status)) return;
    const controller = new AbortController();
    const runId = run.id;
    const generation = generationRef.current;
    void streamRunEvents({
      runId,
      after: eventCursorRef.current,
      signal: controller.signal,
      onEvent: async (event) => {
        if (!isCurrent(generation, controller.signal)) return;
        setStreamWarning(null);
        eventCursorRef.current = Math.max(eventCursorRef.current, Number(event.id) || 0);
        setEvents((current) => {
          if (current.some((item) => item.id === event.id)) return current;
          const next = [...current, event];
          return next.length > 500 ? next.slice(-500) : next;
        });
        if (event.type === "text_delta" && typeof event.payload.text === "string") {
          setStreamText((current) => current + event.payload.text);
        } else if (event.type === "message") {
          setStreamText("");
          await reloadMessages(generation, controller.signal);
          if (!isCurrent(generation, controller.signal)) return;
        } else if (event.type === "status" && typeof event.payload.status === "string") {
          const status = event.payload.status as RunStatus;
          setRun((current) => (current?.id === runId ? { ...current, status } : current));
          if (TERMINAL_STATUSES.has(status)) {
            await reconcile(runId, generation, controller.signal);
            if (!isCurrent(generation, controller.signal)) return;
          }
        } else if (event.type === "approval") {
          await reloadApprovals(runId, generation, controller.signal);
          if (!isCurrent(generation, controller.signal)) return;
        } else if (event.type === "artifact") {
          await props.onFilesChanged().catch(() => undefined);
          if (!isCurrent(generation, controller.signal)) return;
        } else if (event.type === "error") {
          setStreamWarning(typeof event.payload.message === "string" ? event.payload.message : "任务执行出现错误");
        }
      },
      onReconnect: () => reconcile(runId, generation, controller.signal),
      onError: (cause) => {
        if (isCurrent(generation, controller.signal)) setStreamWarning(`${cause.message}，正在恢复…`);
      },
    }).catch((cause) => {
      if (isCurrent(generation, controller.signal) && !(cause instanceof DOMException && cause.name === "AbortError")) {
        setStreamWarning(errorMessage(cause));
      }
    });
    return () => controller.abort();
  }, [isCurrent, props.onFilesChanged, reconcile, reloadApprovals, reloadMessages, run?.id, run?.status]);

  useEffect(() => {
    props.onRunState(run, events, approvals);
  }, [approvals, events, props.onRunState, run]);

  useEffect(() => {
    if (!run || !TERMINAL_STATUSES.has(run.status) || filesRefreshedRunRef.current === run.id) return;
    filesRefreshedRunRef.current = run.id;
    void props.onFilesChanged().catch(() => undefined);
  }, [props.onFilesChanged, run]);

  useEffect(() => {
    const node = listRef.current;
    if (node) node.scrollTo({ top: node.scrollHeight, behavior: "smooth" });
  }, [messages, streamText, approvals]);

  const selectedSummary = useMemo(() => {
    const total = props.selection.skillIds.length + props.selection.connectorIds.length + props.selection.fileIds.length;
    return total ? `已装配 ${total} 项上下文` : "按需装配工具与文件";
  }, [props.selection]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!conversationId || !draft.trim() || submitting) return;
    const generation = generationRef.current;
    const submittedConversationId = conversationId;
    const input: RunInput = {
      prompt: draft.trim(),
      skillIds: props.selection.skillIds,
      connectorIds: props.selection.connectorIds,
      fileIds: props.selection.fileIds,
      ...(props.selection.expertId ? { expertId: props.selection.expertId } : {}),
      ...(props.selection.modelId ? { modelId: props.selection.modelId } : {}),
    };
    const idempotencyKey = getRunIdempotencyKey(submittedConversationId, input);
    setSubmitting(true);
    setError(null);
    setStreamWarning(null);
    try {
      const nextRun = await api.post<Run>(`/api/conversations/${submittedConversationId}/runs`, {
        ...input,
        idempotencyKey,
      });
      clearRunIdempotencyKey(submittedConversationId);
      if (!isCurrent(generation)) return;
      setDraft("");
      setRun(nextRun);
      setEvents([]);
      setApprovals([]);
      setStreamText("");
      eventCursorRef.current = 0;
      await reloadMessages(generation);
    } catch (cause) {
      if (isCurrent(generation)) setError(errorMessage(cause));
    } finally {
      if (isCurrent(generation)) setSubmitting(false);
    }
  }

  async function cancelRun() {
    if (!run) return;
    const generation = generationRef.current;
    const runId = run.id;
    try {
      const next = await api.post<Run>(`/api/runs/${runId}/cancel`);
      if (isCurrent(generation)) setRun(next);
    } catch (cause) {
      if (isCurrent(generation)) setError(errorMessage(cause));
    }
  }

  async function decideApproval(approval: Approval, approved: boolean) {
    const generation = generationRef.current;
    try {
      await api.post(`/api/runs/${approval.runId}/approvals/${approval.id}`, { approved });
      if (!isCurrent(generation)) return;
      await reloadApprovals(approval.runId, generation);
      if (!isCurrent(generation)) return;
      await reloadRun(approval.runId, generation);
    } catch (cause) {
      if (isCurrent(generation)) setError(errorMessage(cause));
    }
  }

  if (!props.conversation) {
    return (
      <main className="chat-panel chat-panel--empty">
        <button className="icon-button mobile-only" onClick={props.onOpenSidebar} aria-label="打开会话栏"><Menu size={20} /></button>
        <div className="empty-hero">
          <img className="empty-hero__orbit picoddy-welcome-icon" src="/icon-128.png" alt="PiCoddy" />
          <span className="eyebrow">你的开源 AI 工作伙伴</span>
          <h2>你好，我是 PiCoddy</h2>
          <p>从一个想法开始，一起把事情做成。</p>
        </div>
      </main>
    );
  }

  const active = run && !TERMINAL_STATUSES.has(run.status);
  return (
    <main className="chat-panel">
      <header className="chat-header">
        <button className="icon-button mobile-only" onClick={props.onOpenSidebar} aria-label="打开会话栏"><Menu size={20} /></button>
        <div className="chat-header__title">
          <span className="eyebrow">当前会话</span>
          <h1>{props.conversation.title}</h1>
        </div>
        <label className="workspace-binding">
          <span>空间</span>
          <select
            value={props.conversation.workspaceId ?? ""}
            disabled={bindingWorkspace || Boolean(active)}
            onChange={(event) => {
              const generation = generationRef.current;
              const workspaceId = event.target.value || null;
              setBindingWorkspace(true);
              setError(null);
              void props.onWorkspaceChange(workspaceId)
                .catch((cause) => { if (isCurrent(generation)) setError(errorMessage(cause)); })
                .finally(() => { if (isCurrent(generation)) setBindingWorkspace(false); });
            }}
            aria-label="绑定会话空间"
          >
            <option value="">无空间</option>
            {props.workspaces.map((workspace) => <option key={workspace.id} value={workspace.id}>{workspace.name}</option>)}
          </select>
        </label>
        <div className="chat-header__status">
          {run ? <span className={`status-pill status-pill--${run.status}`}><i />{statusLabels[run.status]}</span> : <span className="status-pill"><i />就绪</span>}
          <button className="icon-button inspector-trigger" onClick={() => props.onOpenInspector("files")} aria-label="打开文件和工具"><PanelRight size={19} /></button>
        </div>
      </header>

      <div className="message-list" ref={listRef}>
        {run ? <RunProgress status={run.status} /> : null}
        {loading ? <StateBlock kind="loading" title="正在整理会话" detail="读取消息与运行状态" /> : null}
        {error && messages.length === 0 ? <StateBlock kind="error" title="会话加载失败" detail={error} action={<RetryButton onClick={() => setLoadNonce((value) => value + 1)} />} /> : null}
        {!loading && !error && messages.length === 0 && !streamText ? (
          <div className="conversation-starter">
            <span className="conversation-starter__index">NEW / 01</span>
            <h2>今天想推进什么？</h2>
            <p>描述目标即可。需要文件、技能或外部系统时，从右侧工作箱装配。</p>
          </div>
        ) : null}
        {messages.map((message) => <MessageBubble key={message.id} message={message} />)}
        {streamText ? (
          <article className="message message--assistant message--streaming">
            <div className="message__avatar"><Bot size={16} /></div>
            <div className="message__content">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{streamText}</ReactMarkdown>
              <span className="stream-caret" />
            </div>
          </article>
        ) : null}
        {active && !streamText ? <div className="thinking-row"><span /><span /><span /> {statusLabels[run.status]}</div> : null}
        {approvals.filter((item) => item.status === "pending").map((approval) => (
          <section className="approval-card" key={approval.id}>
            <div className="approval-card__icon"><Wrench size={19} /></div>
            <div><span className="eyebrow">需要你的确认</span><h3>{approval.tool}</h3><pre>{JSON.stringify(approval.input, null, 2)}</pre></div>
            <div className="approval-card__actions">
              <Button variant="quiet" onClick={() => void decideApproval(approval, false)}>拒绝</Button>
              <Button variant="primary" onClick={() => void decideApproval(approval, true)}>允许执行</Button>
            </div>
          </section>
        ))}
      </div>

      <footer className="composer-wrap">
        {streamWarning ? <div className="inline-warning">{streamWarning}</div> : null}
        {error && messages.length > 0 ? <div className="inline-error">{error}</div> : null}
        {showOptions ? (
          <div className="run-options">
            <label><span>专家</span><select value={props.selection.expertId ?? ""} onChange={(e) => props.onSelectionChange({ ...props.selection, expertId: e.target.value || undefined })}><option value="">自动</option>{props.experts.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
            <label><span>模型</span><select value={props.selection.modelId ?? ""} onChange={(e) => props.onSelectionChange({ ...props.selection, modelId: e.target.value || undefined })}><option value="">默认模型</option>{props.models.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
            <button onClick={() => props.onOpenInspector("tools")}><Wrench size={15} /> 选择技能 / MCP</button>
            <button onClick={() => props.onOpenInspector("files")}><Paperclip size={15} /> 选择输入文件</button>
          </div>
        ) : null}
        <form className="composer" onSubmit={submit}>
          <textarea
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                event.currentTarget.form?.requestSubmit();
              }
            }}
            placeholder="描述任务，Enter 发送，Shift + Enter 换行…"
            rows={2}
            disabled={Boolean(active)}
          />
          <div className="composer__bar">
            <button type="button" className="composer__context" onClick={() => setShowOptions((value) => !value)}>
              <Sparkles size={15} /><span>{selectedSummary}</span><ChevronDown size={14} />
            </button>
            {active ? (
              <Button type="button" variant="danger" onClick={() => void cancelRun()} disabled={run.status === "cancelling"}>
                <CircleStop size={16} /> {run.status === "cancelling" ? "取消中" : "停止"}
              </Button>
            ) : (
              <Button type="submit" variant="primary" disabled={submitting || !draft.trim()}>
                {submitting ? <Spinner label="提交" /> : <><span>发送</span><Send size={16} /></>}
              </Button>
            )}
          </div>
        </form>
        <small className="composer-note">任务在云端独立环境运行；关闭页面不会取消执行。</small>
      </footer>
    </main>
  );
}

function MessageBubble({ message }: { message: Message }) {
  const text = extractText(message.content);
  const role = getPiMessageRole(message);
  const assistant = role === "assistant";
  const toolResult = role === "toolResult";
  return (
    <article className={`message message--${role}`}>
      <div className="message__avatar">{assistant ? <Bot size={16} /> : toolResult ? <Wrench size={14} /> : <span>你</span>}</div>
      <div className="message__body">
        <div className="message__meta"><strong>{assistant ? "PiCoddy" : toolResult ? "工具结果" : role === "system" ? "系统" : "你"}</strong><time>{new Intl.DateTimeFormat("zh-CN", { hour: "2-digit", minute: "2-digit" }).format(new Date(message.createdAt))}</time></div>
        <div className="message__content">
          {text ? <ReactMarkdown remarkPlugins={[remarkGfm]}>{text}</ReactMarkdown> : <span className="muted">该消息不包含可显示的文本内容</span>}
        </div>
      </div>
    </article>
  );
}

function RunProgress({ status }: { status: RunStatus }) {
  const stages = [
    { key: "queued", label: "已入队" },
    { key: "provisioning", label: "准备环境" },
    { key: "running", label: status === "waiting_approval" ? "等待审批" : "执行任务" },
    { key: "succeeded", label: status === "failed" ? "执行失败" : status === "cancelled" ? "已取消" : status === "interrupted" ? "已中断" : "完成" },
  ];
  const index = status === "queued" ? 0 : status === "provisioning" ? 1 : TERMINAL_STATUSES.has(status) ? 3 : 2;
  return (
    <div className={`run-progress run-progress--${status}`} aria-label={`运行阶段：${statusLabels[status]}`}>
      {stages.map((stage, stageIndex) => (
        <div className={stageIndex < index ? "is-done" : stageIndex === index ? "is-current" : ""} key={stage.key}>
          <i>{stageIndex < index ? "✓" : stageIndex + 1}</i><span>{stage.label}</span>
        </div>
      ))}
    </div>
  );
}
