import { useEffect, useRef, useState } from "react";
import {
  BookOpen,
  Calendar,
  ChevronDown,
  ChevronLeft,
  ClipboardList,
  Clock,
  Film,
  HatGlasses,
  HeartPulse,
  History,
  Image as ImageIcon,
  Lightbulb,
  MessageCircle,
  Moon,
  Newspaper,
  Pause,
  Pencil,
  Phone,
  Play,
  Plus,
  Puzzle,
  RotateCcw,
  ShieldCheck,
  Trash2,
  Users,
  X,
  Zap,
} from "lucide-react";
import {
  type ActionType,
  type Automation,
  type AutomationRun,
  type PermissionLevel,
  type ScheduleType,
  useAutomationStore,
} from "../store/automationStore";
import { useStore } from "../store/useStore";
import { apiGet, apiPost, apiPut } from "../api/client";
import "./AutomationPanel.css";

const TEMPLATES = [
  {
    id: "ai-news",
    icon: Newspaper,
    name: "每日 AI 新闻推送",
    desc: "关注当天 AI 领域的重要动态，侧重 AI coding 与具身智能。",
    prompt:
      "帮我整理今天 AI 领域的重要动态，重点关注 AI coding、具身智能和大模型进展。用中文输出 3-5 条要点，每条包含标题、摘要和来源。",
    cron: "0 9 * * *",
  },
  {
    id: "english",
    icon: BookOpen,
    name: "每日 5 个英语单词",
    desc: "每天推荐 5 个高频实用英语单词，包含词义、音标、例句。",
    prompt:
      "推荐 5 个高频实用英语单词，包含词义、音标、例句和记忆技巧。用表格形式输出。",
    cron: "0 9 * * *",
  },
  {
    id: "bedtime",
    icon: Moon,
    name: "每日儿童睡前故事",
    desc: "生成 3-5 分钟可读的温和睡前故事，情节完整并附简短道理。",
    prompt:
      "写一个适合儿童的睡前故事，时长 3-5 分钟，情节温和完整，结尾附一句简单的道理。",
    cron: "0 20 * * *",
  },
  {
    id: "weekly",
    icon: ClipboardList,
    name: "每周工作周报",
    desc: "每周五汇总仓库 PR 与 Issue 进展，输出关键变更与待办。",
    prompt:
      "帮我生成本周工作周报，包括：本周完成的主要工作、关键进展、遇到的问题、下周计划。用 Markdown 格式输出。",
    cron: "0 17 * * 5",
  },
  {
    id: "movie",
    icon: Film,
    name: "经典电影推荐",
    desc: "推荐一部高分经典电影，简要介绍剧情梗概、亮点与推荐理由。",
    prompt:
      "推荐一部经典高分电影，包含：片名、导演、年份、剧情梗概、亮点和推荐理由。",
    cron: "0 19 * * 6",
  },
  {
    id: "history",
    icon: History,
    name: "历史上的今天",
    desc: "从科技、电影、音乐等领域挑选一件今天发生过的有趣事件。",
    prompt:
      "从科技、电影、音乐或历史领域，挑选一件历史上的今天发生的有趣事件，简要介绍背景和意义。",
    cron: "0 8 * * *",
  },
  {
    id: "why",
    icon: Lightbulb,
    name: "每日一个为什么",
    desc: "每天抛出一个有趣问题，先提问再解答，语气轻松、通俗易懂。",
    prompt: "每天提出一个有趣的科普问题，先给出问题，再用通俗易懂的语言解答。",
    cron: "0 12 * * *",
  },
  {
    id: "family",
    icon: Phone,
    name: "父母联系提醒",
    desc: "每周日 10:00 提醒你给家人打电话或发消息，简单问候。",
    prompt: "提醒我给家人打电话或发消息，简单问候并关心他们的近况。",
    cron: "0 10 * * 0",
  },
  {
    id: "health",
    icon: HeartPulse,
    name: "体检预约提醒",
    desc: "在指定时间提醒确认体检时间、准备证件和注意事项。",
    prompt: "提醒我确认体检时间，列出需要准备的证件和注意事项。",
    cron: "0 9 1 * *",
  },
  {
    id: "interview",
    icon: MessageCircle,
    name: "面试准备提醒",
    desc: "工作日每 2 小时提醒复习大模型面试内容，并生成 3 道练习题。",
    prompt: "帮我复习大模型/AI 相关面试内容，生成 3 道练习题并给出参考答案。",
    cron: "0 */2 * * 1-5",
  },
  {
    id: "meeting",
    icon: Users,
    name: "会议前准备",
    desc: "在会议开始前提醒整理议题、目标、待确认问题和关键资料。",
    prompt: "帮我整理会议前的准备事项：议题、目标、待确认问题和关键资料清单。",
    cron: "0 9 * * 1",
  },
  {
    id: "wallpaper",
    icon: ImageIcon,
    name: "可爱萌宠手机壁纸",
    desc: "随机挑选一种风格，生成一张 9:16 的可爱萌宠手机壁纸。",
    prompt: "生成一张 9:16 比例的可爱萌宠手机壁纸，风格清新、色彩柔和。",
    cron: "0 10 * * *",
  },
];

const CRON_PRESETS = [
  { label: "每天", cron: "0 9 * * *" },
  { label: "每周一", cron: "0 9 * * 1" },
  { label: "每月 1 日", cron: "0 9 1 * *" },
  { label: "自定义", cron: "custom" },
];

const FREQ_LABELS: Record<string, string> = {
  "0 9 * * *": "每天 09:00",
  "0 8 * * *": "每天 08:00",
  "0 12 * * *": "每天 12:00",
  "0 17 * * 5": "每周五 17:00",
  "0 9 * * 1": "每周一 09:00",
  "0 10 * * 0": "每周日 10:00",
  "0 19 * * 6": "每周六 19:00",
  "0 9 1 * *": "每月 1 日 09:00",
  "0 */2 * * 1-5": "工作日每 2 小时",
  "0 20 * * *": "每天 20:00",
};

function formatFrequency(a: Automation): string {
  if (a.triggerType !== "cron") return "文件监听";
  if (a.scheduleType === "once") {
    return a.triggerConfig.onceAt
      ? "单次: " + new Date(a.triggerConfig.onceAt).toLocaleString("zh-CN")
      : "单次";
  }
  if (a.scheduleType === "interval") {
    const m = a.triggerConfig.intervalMinutes ?? 30;
    return `每 ${m < 60 ? m + " 分钟" : m / 60 + " 小时"}`;
  }
  return FREQ_LABELS[a.triggerConfig.cron || ""] || a.triggerConfig.cron || "-";
}

function formatTime(ts: number | null): string {
  if (!ts) return "从未";
  return new Date(ts).toLocaleString("zh-CN");
}

function statusText(status: string) {
  if (status === "queued") return "等待执行";
  if (status === "completed") return "已完成";
  if (status === "running" || status === "inProgress") return "运行中";
  if (status === "timedOut") return "已超时";
  if (status === "cancelled") return "已取消";
  return "失败";
}

const isActiveRun = (run: AutomationRun) =>
  run.status === "queued" || run.status === "running" || run.status === "inProgress";

export default function AutomationPanel() {
  const {
    automations,
    activeTab,
    setActiveTab,
    loadAutomations,
    updateAutomation,
    deleteAutomation,
    runAutomation,
    loadAllRuns,
    runs,
  } = useAutomationStore();
  const { workspaces, requestUiConfirm, showUiAlert } = useStore();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editingAutomation, setEditingAutomation] = useState<Automation | null>(null);
  const [drawerPrefill, setDrawerPrefill] = useState<
    Partial<{ name: string; prompt: string; cron: string }>
  >({});
  const [runRecords, setRunRecords] = useState<Record<string, AutomationRun[]>>(
    {},
  );
  const [addMenuOpen, setAddMenuOpen] = useState(false);
  const [showTemplates, setShowTemplates] = useState(false);
  const addMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    loadAutomations();
  }, [loadAutomations]);

  useEffect(() => {
    if (activeTab === "runs") {
      setShowTemplates(false);
      loadAllRuns();
    }
  }, [activeTab, loadAllRuns]);

  useEffect(() => {
    if (!addMenuOpen) return;
    const handlePointer = (event: PointerEvent) => {
      if (!addMenuRef.current?.contains(event.target as Node)) {
        setAddMenuOpen(false);
      }
    };
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setAddMenuOpen(false);
    };
    document.addEventListener("pointerdown", handlePointer);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("pointerdown", handlePointer);
      document.removeEventListener("keydown", handleKey);
    };
  }, [addMenuOpen]);

  useEffect(() => {
    const hasActive = runs.some(isActiveRun) ||
      Object.values(runRecords).some((records) => records.some(isActiveRun));
    if (!hasActive) return;
    const timer = window.setInterval(async () => {
      if (activeTab === "runs") await loadAllRuns();
      const expandedIds = Object.keys(runRecords);
      if (expandedIds.length > 0) {
        const refreshed = await Promise.all(expandedIds.map(async (id) =>
          [id, await useAutomationStore.getState().loadRuns(id)] as const
        ));
        setRunRecords(Object.fromEntries(refreshed));
      }
    }, 2_000);
    return () => window.clearInterval(timer);
  }, [activeTab, loadAllRuns, runRecords, runs]);

  const handleToggle = async (id: string, enabled: boolean) => {
    await updateAutomation(id, { enabled });
  };

  const handleRun = async (id: string) => {
    try {
      await runAutomation(id);
      const records = await useAutomationStore.getState().loadRuns(id);
      setRunRecords((previous) => ({ ...previous, [id]: records }));
      if (activeTab === "runs") await loadAllRuns();
      await showUiAlert({
        title: "任务已触发",
        message: "任务已进入队列，可在运行记录或自动化会话中查看进度。",
        tone: "success",
      });
    } catch (error) {
      await showUiAlert({
        title: "无法立即运行",
        message: error instanceof Error ? error.message : "该自动化任务正在运行",
        tone: "danger",
      });
    }
  };

  const handleDelete = async (id: string, name: string) => {
    if (
      !(await requestUiConfirm({
        title: "删除自动化",
        message: `确认删除自动化「${name}」？`,
        confirmLabel: "确认删除",
        tone: "danger",
      }))
    ) return;
    await deleteAutomation(id);
  };

  const toggleRuns = async (id: string) => {
    if (runRecords[id]) {
      const next = { ...runRecords };
      delete next[id];
      setRunRecords(next);
      return;
    }
    const rs = await useAutomationStore.getState().loadRuns(id);
    setRunRecords((prev) => ({ ...prev, [id]: rs }));
  };

  const openDrawer = (prefill?: typeof drawerPrefill) => {
    setEditingAutomation(null);
    setDrawerPrefill(prefill || {});
    setDrawerOpen(true);
  };

  const openBlankAutomation = () => {
    setAddMenuOpen(false);
    setShowTemplates(false);
    openDrawer();
  };

  const openTemplatePicker = () => {
    setAddMenuOpen(false);
    setActiveTab("tasks");
    setShowTemplates(true);
  };

  const pickingFromTemplate = showTemplates && automations.length > 0;

  return (
    <div className="automation-panel">
      <div
        className={`auto-header${pickingFromTemplate ? " auto-header--templates" : ""}`}
      >
        {pickingFromTemplate
          ? (
            <div className="auto-templates-nav">
              <button
                type="button"
                className="auto-templates-back"
                aria-label="返回"
                onClick={() => setShowTemplates(false)}
              >
                <ChevronLeft size={20} />
              </button>
              <h2 className="auto-templates-title">从模板添加</h2>
            </div>
          )
          : (
            <>
        <div className="auto-tabs">
        <button
          className={activeTab === "tasks" ? "active" : ""}
          onClick={() => {
            setShowTemplates(false);
            setActiveTab("tasks");
          }}
        >
          定时任务
        </button>
        <button
          className={activeTab === "runs" ? "active" : ""}
          onClick={() => setActiveTab("runs")}
        >
          运行记录
        </button>
      </div>
 {activeTab === "tasks" && (
        <div className="auto-new-wrap" ref={addMenuRef}>
          <button
            type="button"
            className="auto-new-btn"
            aria-haspopup="menu"
            aria-expanded={addMenuOpen}
            onClick={() => setAddMenuOpen((open) => !open)}
          >
            <Plus size={16} />添加自动化
            <ChevronDown size={14} />
          </button>
          {addMenuOpen && (
            <div className="auto-new-menu" role="menu">
               <button
                type="button"
                role="menuitem"
                onClick={openBlankAutomation}
              >
                添加自动化
              </button>
              <button
                type="button"
                role="menuitem"
                onClick={openTemplatePicker}
              >
                通过模版添加
              </button>

            </div>
          )}
        </div>
        )}
            </>
          )}
      </div>

      <div className="auto-body">
      {activeTab === "tasks"
        ? showTemplates || automations.length === 0
          ? (
            <TemplateGrid
              showTitle={!pickingFromTemplate}
              onSelect={(template) =>
                openDrawer({
                  name: template.name,
                  prompt: template.prompt,
                  cron: template.cron,
                })}
            />
          )
          : (
            <div className="auto-list">
              {automations.map((a) => (
                <AutoCard
                  key={a.id}
                  automation={a}
                  runs={runRecords[a.id] || []}
                  onToggle={handleToggle}
                  onRun={handleRun}
                  onDelete={handleDelete}
                  onEdit={(automation) => { setEditingAutomation(automation); setDrawerOpen(true); }}
                  onToggleRuns={toggleRuns}
                />
              ))}
            </div>
          )
        : <RunsList runs={runs} automations={automations} />}
      </div>

      {drawerOpen && (
        <AutomationDrawer
          automation={editingAutomation}
          prefill={drawerPrefill}
          workspaces={workspaces}
          onClose={() => setDrawerOpen(false)}
          onSaved={() => {
            setDrawerOpen(false);
            setEditingAutomation(null);
            setShowTemplates(false);
            loadAutomations();
          }}
        />
      )}
    </div>
  );
}

function TemplateGrid({
  onSelect,
  showTitle = true,
}: {
  onSelect: (template: (typeof TEMPLATES)[number]) => void;
  showTitle?: boolean;
}) {
  return (
    <>
      {showTitle && <div className="auto-section-title">自动化任务模版</div>}
      <div className="auto-template-grid">
        {TEMPLATES.map((t) => (
          <div
            key={t.id}
            className="auto-template-card"
            onClick={() => onSelect(t)}
          >
            <div className="auto-template-head">
              <span className="auto-template-icon">
                <t.icon size={18} />
              </span>
              <span className="auto-template-name">{t.name}</span>
            </div>
            <div className="auto-template-desc">{t.desc}</div>
          </div>
        ))}
      </div>
    </>
  );
}

function AutoCard({
  automation: a,
  runs,
  onToggle,
  onRun,
  onDelete,
  onEdit,
  onToggleRuns,
}: {
  automation: Automation;
  runs: AutomationRun[];
  onToggle: (id: string, enabled: boolean) => void;
  onRun: (id: string) => void;
  onDelete: (id: string, name: string) => void;
  onEdit: (automation: Automation) => void;
  onToggleRuns: (id: string) => void;
}) {
  const action = a.actionType === "skill"
    ? `技能: ${a.actionConfig.skill || ""}`
    : "自定义提示词";
  return (
    <div className="auto-card">
      <div className="auto-card-main">
        <div className="auto-card-meta">
          <div className="auto-card-title-row">
            <span className="auto-card-name">{a.name}</span>
            <span className={`auto-badge ${a.enabled ? "on" : "off"}`}>
              {a.enabled ? "已启用" : "已停用"}
            </span>
            {a.scheduleType === "once" && (
              <span className="auto-badge once">单次</span>
            )}
          </div>
          <div className="auto-card-row">
            <Clock size={14} />频率: {formatFrequency(a)}
          </div>
          <div className="auto-card-row">
            <Zap size={14} />动作: {action}
          </div>
          <div className="auto-card-row">
            <Calendar size={14} />下次: {formatTime(a.nextRun)} ｜ 上次:{" "}
            {formatTime(a.lastRun)}
          </div>
          {runs.length > 0 && (
            <div className="auto-card-runs">
              <div className="auto-runs-label">运行记录：</div>
              {runs.slice(0, 10).map((r) => (
                <div
                  key={r.id}
                  className={`auto-run-line ${r.sessionId ? "clickable" : ""}`}
                  onClick={r.sessionId
                    ? () => useStore.getState().selectConversation(r.sessionId!)
                    : undefined}
                  title={r.sessionId ? "点击回到对话" : ""}
                >
                  {new Date(r.startedAt).toLocaleString("zh-CN")} ·{" "}
                  {statusText(r.status)} {r.summary ? "· " + r.summary : ""}
                  {r.sessionId && (
                    <span className="auto-run-link">查看会话</span>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="auto-card-actions">
          <button title="编辑任务" aria-label={`编辑 ${a.name}`} onClick={() => onEdit(a)}>
            <Pencil size={15} />
          </button>
          <button
            title={a.enabled ? "停用" : "启用"}
            onClick={() => onToggle(a.id, !a.enabled)}
          >
            {a.enabled ? <Pause size={15} /> : <Play size={15} />}
          </button>
          <button title="立即运行" onClick={() => onRun(a.id)}>
            <Play size={15} />
          </button>
          <button title="运行记录" onClick={() => onToggleRuns(a.id)}>
            <RotateCcw size={15} />
          </button>
          <button
            title="删除"
            className="danger"
            onClick={() => onDelete(a.id, a.name)}
          >
            <Trash2 size={15} />
          </button>
        </div>
      </div>
    </div>
  );
}

function RunsList(
  { runs, automations }: { runs: AutomationRun[]; automations: Automation[] },
) {
  if (runs.length === 0) {
    return (
      <div className="auto-empty-state">
        <div className="auto-empty-icon">
          <ClipboardList size={28} />
        </div>
        <div className="auto-empty-title">暂无运行记录</div>
      </div>
    );
  }
  const nameOf = (id: string) =>
    automations.find((a) => a.id === id)?.name || "已删除的任务";
  return (
    <div className="auto-runs-list">
      {runs.map((r) => (
        <div
          key={r.id}
          className={`auto-run-card ${r.sessionId ? "clickable" : ""}`}
          onClick={r.sessionId
            ? () => useStore.getState().selectConversation(r.sessionId!)
            : undefined}
          title={r.sessionId ? "点击回到对话" : ""}
        >
          <div>
            <div className="auto-run-name">{nameOf(r.automationId)}</div>
            <div className="auto-run-meta">
              {new Date(r.startedAt).toLocaleString("zh-CN")} ·{" "}
              {statusText(r.status)} {r.summary ? "· " + r.summary : ""}
            </div>
          </div>
          {r.sessionId && <span className="auto-run-link">查看会话</span>}
        </div>
      ))}
    </div>
  );
}

interface AutomationDrawerProps {
  automation: Automation | null;
  prefill: Partial<{ name: string; prompt: string; cron: string }>;
  workspaces: { id: string; name: string }[];
  onClose: () => void;
  onSaved: () => void;
}

function AutomationDrawer(
  { automation, prefill, workspaces, onClose, onSaved }: AutomationDrawerProps,
) {
  const showUiAlert = useStore((state) => state.showUiAlert);
  const [name, setName] = useState(automation?.name || prefill.name || "");
  const [prompt, setPrompt] = useState(automation?.prompt || prefill.prompt || automation?.actionConfig.prompt || "");
  const [workspaceId, setWorkspaceId] = useState("");
  const [connector, setConnector] = useState(automation?.connector || "");
  const [expertId, setExpertId] = useState(automation?.expertId || "");
  const [permission, setPermission] = useState<PermissionLevel>(automation?.permission || "default");
  const [toolMode, setToolMode] = useState<
    "auto" | "skill" | "expert" | "permission"
  >(automation?.actionType === "skill" ? "skill" : automation?.expertId ? "expert" : automation?.permission === "full" ? "permission" : "auto");
  const [scheduleType, setScheduleType] = useState<ScheduleType>(
    automation?.scheduleType || "cron",
  );
  const [cron, setCron] = useState(automation?.triggerConfig.cron || prefill.cron || "0 9 * * *");
  const [interval, setInterval] = useState(Math.max(5, automation?.triggerConfig.intervalMinutes || 30));
  const [intervalUnit, setIntervalUnit] = useState<"minutes" | "hours">(
    "minutes",
  );
  const [onceAt, setOnceAt] = useState(automation?.triggerConfig.onceAt ? new Date(automation.triggerConfig.onceAt).toISOString().slice(0,16) : "");
  const [validFrom, setValidFrom] = useState(automation?.validFrom ? new Date(automation.validFrom).toISOString().slice(0,10) : "");
  const [validUntil, setValidUntil] = useState(automation?.validUntil ? new Date(automation.validUntil).toISOString().slice(0,10) : "");
  const [pushToWxmp, setPushToWxmp] = useState(automation?.pushToWxmp || false);
  const [skills, setSkills] = useState<{ name: string }[]>([]);
  const [experts, setExperts] = useState<{ id: string; name: string }[]>([]);
  const [connectors, setConnectors] = useState<string[]>([]);
  const [skill, setSkill] = useState(automation?.actionConfig.skill || "");

  useEffect(() => { if (automation?.workspaceId) setWorkspaceId(automation.workspaceId); }, [automation]);

  useEffect(() => {
    apiGet<any>("/api/skills").then((s) => setSkills(s || [])).catch(() =>
      setSkills([])
    );
    apiGet<any>("/api/experts").then((e) => setExperts(e || [])).catch(() =>
      setExperts([])
    );
    apiGet<any>("/api/mcp").then((m) =>
      setConnectors(Object.keys(m?.availableConfig?.mcpServers || {}))
    ).catch(() => setConnectors([]));
  }, []);

  const handleSave = async () => {
    if (!name.trim()) {
      await showUiAlert("请输入名称");
      return;
    }
    if (toolMode === "skill" && !skill) {
      await showUiAlert("请选择技能");
      return;
    }
    if (toolMode !== "skill" && !prompt.trim()) {
      await showUiAlert("请输入提示词");
      return;
    }

    let triggerConfig: {
      cron?: string;
      intervalMinutes?: number;
      onceAt?: number;
    } = {};
    if (scheduleType === "cron") {
      if (!cron.trim()) {
        await showUiAlert("请输入 Cron 表达式");
        return;
      }
      triggerConfig = { cron: cron.trim() };
    } else if (scheduleType === "interval") {
      let minutes = interval;
      if (intervalUnit === "hours") minutes *= 60;
      if (!minutes || minutes < 5) {
        await showUiAlert("间隔至少 5 分钟");
        return;
      }
      triggerConfig = { intervalMinutes: minutes };
    } else if (scheduleType === "once") {
      if (!onceAt) {
        await showUiAlert("请选择执行时间");
        return;
      }
      const ts = new Date(onceAt).getTime();
      if (ts <= Date.now()) {
        await showUiAlert("执行时间必须晚于当前时间");
        return;
      }
      triggerConfig = { onceAt: ts };
    }

    const actionType: ActionType = toolMode === "skill" ? "skill" : "prompt";
    const actionConfig = toolMode === "skill" ? { skill } : {};

    const payload = {
      name: name.trim(),
      workspaceId: workspaceId || null,
      triggerType: "cron",
      triggerConfig,
      actionType,
      actionConfig,
      prompt: prompt.trim() || null,
      expertId: toolMode === "expert" ? expertId || null : null,
      permission: toolMode === "permission" ? permission : "default",
      connector: connector || null,
      scheduleType,
      validFrom: validFrom ? new Date(validFrom).getTime() : null,
      validUntil: validUntil
        ? new Date(validUntil).getTime() + 24 * 60 * 60 * 1000 - 1
        : null,
      pushToWxmp,
    };

    if (automation) await apiPut(`/api/automations/${automation.id}`, payload);
    else await apiPost("/api/automations", payload);
    onSaved();
  };

  return (
    <div
      className="auto-drawer-overlay"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="auto-drawer">
        <div className="auto-drawer-head">
          <div className="auto-drawer-title">{automation ? "编辑自动化任务" : "添加自动化任务"}</div>
          <button className="auto-drawer-close" onClick={onClose}>
            <X size={18} />
          </button>
        </div>
        <div className="auto-drawer-body">
          <Field label="名称">
            <input
              className="auto-input"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="任务名称"
            />
          </Field>
          <Field label="工作空间（可选）">
            <AutoSelect
              value={workspaceId}
              onChange={(e) => setWorkspaceId(e.target.value)}
            >
              <option value="">不指定工作空间</option>
              {workspaces.map((w) => (
                <option key={w.id} value={w.id}>{w.name}</option>
              ))}
            </AutoSelect>
          </Field>
          <Field label="提示词">
            <textarea
              className="auto-textarea"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="要让 Agent 自动执行的提示词..."
            />
          </Field>
          <div className="auto-tool-bar">
            <ToolBtn
              active={toolMode === "auto"}
              onClick={() => setToolMode("auto")}
              icon={<Zap size={14} />}
            >
              Auto
            </ToolBtn>
            <ToolBtn
              active={toolMode === "skill"}
              onClick={() => setToolMode("skill")}
              icon={<Puzzle size={14} />}
            >
              技能
            </ToolBtn>
            <ToolBtn
              active={toolMode === "expert"}
              onClick={() => setToolMode("expert")}
              icon={<HatGlasses size={14} />}
            >
              召唤专家
            </ToolBtn>
            <ToolBtn
              active={toolMode === "permission"}
              onClick={() => setToolMode("permission")}
              icon={<ShieldCheck size={14} />}
            >
              完全访问权限
            </ToolBtn>
          </div>
          {toolMode === "skill" && (
            <Field label="选择技能">
              <AutoSelect
                value={skill}
                onChange={(e) => setSkill(e.target.value)}
              >
                <option value="">请选择</option>
                {skills.map((s) => (
                  <option key={s.name} value={s.name}>{s.name}</option>
                ))}
              </AutoSelect>
            </Field>
          )}
          {toolMode === "expert" && (
            <Field label="选择专家">
              <AutoSelect
                value={expertId}
                onChange={(e) => setExpertId(e.target.value)}
              >
                <option value="">请选择</option>
                {experts.map((e) => (
                  <option key={e.id} value={e.id}>{e.name}</option>
                ))}
              </AutoSelect>
            </Field>
          )}
          {toolMode === "permission" && (
            <Field label="权限级别">
              <AutoSelect
                value={permission}
                onChange={(e) =>
                  setPermission(e.target.value as PermissionLevel)}
              >
                <option value="readonly">只读 (L1)</option>
                <option value="default">默认 (L2)</option>
                <option value="full">完全访问 (L3)</option>
              </AutoSelect>
            </Field>
          )}
          <Field label="连接器（勾选即授权该连接器在任务中免确认使用）">
            <AutoSelect
              value={connector}
              onChange={(e) => setConnector(e.target.value)}
            >
              <option value="">不授权连接器</option>
              {connectors.map((c) => <option key={c} value={c}>{c}</option>)}
            </AutoSelect>
          </Field>
          <Field label="执行频率">
            <div className="auto-schedule-tabs">
              <button
                className={scheduleType === "cron" ? "active" : ""}
                onClick={() => setScheduleType("cron")}
              >
                周期
              </button>
              <button
                className={scheduleType === "interval" ? "active" : ""}
                onClick={() => setScheduleType("interval")}
              >
                按间隔
              </button>
              <button
                className={scheduleType === "once" ? "active" : ""}
                onClick={() => setScheduleType("once")}
              >
                单次
              </button>
            </div>
            {scheduleType === "cron" && (
              <>
                <div className="auto-cron-chips">
                  {CRON_PRESETS.map((p) => (
                    <button
                      key={p.label}
                      className={cron === p.cron && p.cron !== "custom"
                        ? "active"
                        : ""}
                      onClick={() => p.cron !== "custom" && setCron(p.cron)}
                    >
                      {p.label}
                    </button>
                  ))}
                </div>
                <input
                  className="auto-input mono"
                  value={cron}
                  onChange={(e) => setCron(e.target.value)}
                  placeholder="分 时 日 月 周"
                />
              </>
            )}
            {scheduleType === "interval" && (
              <div className="auto-interval-row">
                <input
                  className="auto-input"
                  type="number"
                  min={5}
                  value={interval}
                  onChange={(e) => setInterval(parseInt(e.target.value, 10))}
                />
                <AutoSelect
                  value={intervalUnit}
                  onChange={(e) => setIntervalUnit(e.target.value as any)}
                >
                  <option value="minutes">分钟</option>
                  <option value="hours">小时</option>
                </AutoSelect>
              </div>
            )}
            {scheduleType === "once" && (
              <input
                className="auto-input"
                type="datetime-local"
                value={onceAt}
                onChange={(e) => setOnceAt(e.target.value)}
              />
            )}
          </Field>
          <Field label="生效日期范围（可选，留空表示始终生效）">
            <div className="auto-date-row">
              <input
                className="auto-input"
                type="date"
                value={validFrom}
                onChange={(e) => setValidFrom(e.target.value)}
              />
              <input
                className="auto-input"
                type="date"
                value={validUntil}
                onChange={(e) => setValidUntil(e.target.value)}
              />
            </div>
          </Field>
          <label className="auto-push-row">
            <input
              type="checkbox"
              checked={pushToWxmp}
              onChange={(e) => setPushToWxmp(e.target.checked)}
            />
            <span>推送到 PiCoddy 微信小程序</span>
          </label>
        </div>
        <div className="auto-drawer-foot">
          <button className="auto-btn secondary" onClick={onClose}>取消</button>
          <button className="auto-btn primary" onClick={handleSave}>
            保存
          </button>
        </div>
      </div>
    </div>
  );
}

function Field(
  { label, children }: { label: string; children: React.ReactNode },
) {
  return (
    <div className="auto-field">
      <label className="auto-field-label">{label}</label>
      {children}
    </div>
  );
}

function AutoSelect(
  props: React.SelectHTMLAttributes<HTMLSelectElement>,
) {
  const { className, children, ...rest } = props;
  return (
    <div className="auto-select-wrap">
      <select
        className={className ? `auto-select ${className}` : "auto-select"}
        {...rest}
      >
        {children}
      </select>
      <ChevronDown
        className="auto-select-chevron"
        size={14}
        strokeWidth={2}
        aria-hidden
      />
    </div>
  );
}

function ToolBtn(
  { active, onClick, icon, children }: {
    active: boolean;
    onClick: () => void;
    icon: React.ReactNode;
    children: React.ReactNode;
  },
) {
  return (
    <button
      className={`auto-tool-btn ${active ? "active" : ""}`}
      onClick={onClick}
    >
      {icon}
      {children}
    </button>
  );
}
