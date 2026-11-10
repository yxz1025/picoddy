import { CollapsibleSection, ListPagerFooter, timeAgo } from "./SidebarListParts";
import LocalProjectSidebar from "./projects/LocalProjectSidebar";
import { openProjectOverview, useProjectHistory } from "./projects/projectHistory";
import { AppVersion } from "./UpdatePanel";
import { useEffect, useMemo, useState } from "react";
import { useStore } from "../store/useStore";
import {
  CalendarSync,
  CirclePlus,
  FolderClosed,
  FolderInput,
  FolderOpen,
  HatGlasses,
  Puzzle,
  Link,
  LogOut,
  Monitor,
  Moon,
  MoreHorizontal,
  PanelLeft,
  Pin,
  Search,
  Settings,
  Sun,
  Trash2,
  X,
} from "lucide-react";
import "./Sidebar.css";
import { WorkspaceIcon } from "./WorkspaceIcon";
import { PiLogo } from "./PiLogo";
import type { AuthSessionView } from "../api/client";
import { t } from "../utils/i18n";
import {
  collapseSidebarVisible,
  expandSidebarVisible,
  readPinnedConvIds,
  SIDEBAR_LIST_INITIAL,
  sidebarListPagerState,
  sortConvsByPinned,
  togglePinnedConvId,
  writePinnedConvIds,
} from "./sidebarListPaging";

type SidebarConv = {
  id: string;
  title: string;
  status: string;
  updatedAt: number;
  workspaceId?: string;
};

const IS_ELECTRON_MAC = Boolean(
  (window as { electronAPI?: unknown }).electronAPI,
) && /Mac|iPhone|iPad/i.test(navigator.userAgent);

const FEATURE_TABS = [
  {
    id: "project",
    labelKey: "project",
    labelFallback: "项目",
    icon: FolderClosed,
    color: "--text",
  },
  {
    id: "expert",
    panel: "expert" as const,
    labelKey: "experts",
    labelFallback: "专家",
    icon: HatGlasses,
    color: "--text",
  },
  {
    id: "skill",
    panel: "skill" as const,
    labelKey: "skills",
    labelFallback: "技能",
    icon: Puzzle,
    color: "--text",
  },
  {
    id: "connector",
    panel: "connector" as const,
    labelKey: "connectors",
    labelFallback: "连接器",
    icon: Link,
    color: "--text",
  },
  {
    id: "automation",
    labelKey: "automation",
    labelFallback: "🤖 自动化",
    icon: CalendarSync,
    color: "--text",
  },
  {
    id: "workbench",
    labelKey: "workbench",
    labelFallback: "工作台",
    icon: Monitor,
    color: "--text",
  },
];

const STATUS_COLORS: Record<string, string> = {
  idle: "var(--text-4)",
  running: "#3b82f6",
  done: "var(--green)",
  failed: "var(--red)",
  pending: "var(--text-3)",
  planning: "var(--amber)",
};

function PagedConvList({
  convs,
  pinnedIds,
  onTogglePin,
}: {
  convs: SidebarConv[];
  pinnedIds: string[];
  onTogglePin: (id: string) => void;
}) {
  const [visible, setVisible] = useState(SIDEBAR_LIST_INITIAL);
  const ordered = sortConvsByPinned(convs, pinnedIds);
  const pager = sidebarListPagerState(ordered.length, visible);

  return (
    <>
      {ordered.slice(0, pager.shown).map((c) => (
        <ConvItem
          key={c.id}
          c={c}
          pinned={pinnedIds.includes(c.id)}
          onDelete={(id) => useStore.getState().deleteConversation(id)}
          onMove={(cid, wid) => useStore.getState().assignConversation(cid, wid)}
          onTogglePin={onTogglePin}
        />
      ))}
      <ListPagerFooter
        remaining={pager.remaining}
        showMore={pager.showMore}
        showCollapse={pager.showCollapse}
        onExpand={() =>
          setVisible((current) => expandSidebarVisible(current, ordered.length))}
        onCollapse={() => setVisible(collapseSidebarVisible())}
      />
    </>
  );
}

/* ===== 单个会话项（自管理 hover 与菜单）===== */
function ConvItem({
  c,
  pinned,
  onDelete,
  onMove,
  onTogglePin,
}: {
  c: SidebarConv;
  pinned: boolean;
  onDelete: (id: string) => void;
  onMove: (convId: string, wsId: string) => void;
  onTogglePin: (id: string) => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const active = useStore(
    (s) => s.activeCategory === "assistant" && s.currentConvId === c.id,
  );
  const workspaces = useStore((s) => s.workspaces);
  const statusColor = STATUS_COLORS[c.status] || "var(--text-4)";
  const showStatusDot = c.status && c.status !== "idle";

  return (
    <div
      className={`sidebar-conv-item ${active ? "active" : ""} ${
        menuOpen ? "menu-open" : ""
      }`}
      onClick={() => useStore.getState().selectConversation(c.id)}
      onMouseLeave={() => setMenuOpen(false)}
    >
      <div className="sidebar-conv-title">
        {c.title || "新任务"}
      </div>
      {showStatusDot && (
        <span
          className={`sidebar-conv-status ${
            c.status === "running" ? "pulsing" : ""
          }`}
          style={{ background: statusColor }}
          title={c.status}
        />
      )}
      <span className="sidebar-conv-time">{timeAgo(c.updatedAt)}</span>
      <div className="sidebar-conv-actions">
        <button
          type="button"
          className="sidebar-conv-icon-btn"
          title={t("more")}
          onClick={(e) => {
            e.stopPropagation();
            setMenuOpen((v) => !v);
          }}
        >
          <MoreHorizontal size={14} />
        </button>
        <button
          type="button"
          className="sidebar-conv-icon-btn"
          title={t("delete")}
          onClick={(e) => {
            e.stopPropagation();
            onDelete(c.id);
          }}
        >
          <Trash2 size={14} />
        </button>
        <button
          type="button"
          className={`sidebar-conv-icon-btn ${pinned ? "is-pinned" : ""}`}
          title={pinned ? t("unpin") : t("pin")}
          onClick={(e) => {
            e.stopPropagation();
            onTogglePin(c.id);
          }}
        >
          <Pin size={14} fill={pinned ? "currentColor" : "none"} />
        </button>
        {menuOpen && (
          <div
            className="conv-move-menu"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="conv-move-label">
              <FolderInput size={12} /> {t("move_to_space")}
            </div>
            {workspaces.length === 0 && (
              <div
                style={{
                  padding: "4px 8px",
                  fontSize: 12,
                  color: "var(--text-3)",
                }}
              >
                {t("no_space_available")}
              </div>
            )}
            {workspaces.map((w) => (
              <button
                key={w.id}
                className={`conv-move-item ${
                  w.id === c.workspaceId ? "current" : ""
                }`}
                onClick={() => {
                  if (w.id !== c.workspaceId) onMove(c.id, w.id);
                  setMenuOpen(false);
                }}
              >
                <span>
                  <WorkspaceIcon name={w.icon} />
                </span>
                {w.name}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/* ===== 空间项（可折叠，内含该空间的会话）===== */
function WorkspaceItem({
  ws,
  convs,
  pinnedIds,
  onTogglePin,
}: {
  ws: { id: string; name: string; icon: string };
  convs: SidebarConv[];
  pinnedIds: string[];
  onTogglePin: (id: string) => void;
}) {
  const [expanded, setExpanded] = useState(true);
  const FolderStateIcon = expanded ? FolderOpen : FolderClosed;
  const resetToWelcome = useStore((s) => s.resetToWelcome);
  const setComposerWorkspaceId = useStore((s) => s.setComposerWorkspaceId);
  const deleteWorkspace = useStore((s) => s.deleteWorkspace);
  const requestUiConfirm = useStore((s) => s.requestUiConfirm);

  return (
    <div className="ws-item">
      <div
        className={`ws-item-header${expanded ? "" : " is-collapsed"}`}
      >
        <button
          type="button"
          className="ws-item-main"
          onClick={() => setExpanded((v) => !v)}
        >
          <span className="ws-item-icon">
            <FolderStateIcon size={14} />
          </span>
          <span className="ws-item-name">{ws.name}</span>
        </button>
        <span className="ws-item-actions">
          <button
            type="button"
            className="sidebar-conv-icon-btn"
            title={t("delete_space")}
            onClick={() => {
              void (async () => {
                const approved = await requestUiConfirm({
                  title: t("delete_space"),
                  message: t("delete_space_confirm").replace("{name}", ws.name),
                  confirmLabel: t("delete"),
                  cancelLabel: t("cancel"),
                  tone: "danger",
                });
                if (!approved) return;
                await deleteWorkspace(ws.id);
              })();
            }}
          >
            <Trash2 size={13} />
          </button>
          <button
            type="button"
            className="sidebar-conv-icon-btn"
            title={t("new_in_space")}
            onClick={() => {
              resetToWelcome();
              setComposerWorkspaceId(ws.id);
            }}
          >
            <CirclePlus size={14} strokeWidth={2} />
          </button>
        </span>
      </div>

      {expanded && (
        <div className="ws-item-convs">
          {convs.length === 0
            ? <div className="ws-item-empty">{t("no_conversations")}</div>
            : (
              <PagedConvList
                convs={convs}
                pinnedIds={pinnedIds}
                onTogglePin={onTogglePin}
              />
            )}
        </div>
      )}
    </div>
  );
}

interface SidebarProps {
  collapsed?: boolean;
  showInlineToggle?: boolean;
  authSession?: AuthSessionView | null;
  onLogout?: () => Promise<void> | void;
}

function formatAuthSubtitle(
  authSession: AuthSessionView | null | undefined,
): string {
  if (!authSession || authSession.profile.mode === "local") return "本地工作区";
  return authSession.profile.id
    ? `工号 ${authSession.profile.id}`
    : authSession.profile.mobile
    ? `手机 ${authSession.profile.mobile}`
    : authSession.profile.email
    ? `邮箱 ${authSession.profile.email}`
    : authSession.userId;
}

function formatAuthDisplayName(
  authSession: AuthSessionView | null | undefined,
): string {
  return authSession?.profile.username || authSession?.nick || "本地用户";
}

export default function Sidebar({
  collapsed = false,
  showInlineToggle = true,
  authSession,
  onLogout,
}: SidebarProps) {
  const {
    activeCategory,
    setCategory,
    setExpertPanelTab,
    expertPanelTab,
    conversations,
    resetToWelcome,
    toggleSidebar,
    searchQuery,
    theme,
    toggleTheme,
    setShowSettings,
    workspaces,
  } = useStore();

  const hasActiveRequirement = useProjectHistory(s => s.account === (authSession?.userId || "")
    && s.activeRequirementId !== null && s.items.some(item => item.id === s.activeRequirementId));
  const [searchOpen, setSearchOpen] = useState(false);
  const [filterOpen, setFilterOpen] = useState(false);
  const [localSearchQuery, setLocalSearchQuery] = useState("");
  const [filterStatus] = useState("");
  const [filterTime] = useState("");
  const [pinnedIds, setPinnedIds] = useState<string[]>(readPinnedConvIds);

  const togglePinned = (id: string) => {
    setPinnedIds((current) => {
      const next = togglePinnedConvId(current, id);
      writePinnedConvIds(next);
      return next;
    });
  };

  // 点击空白处关闭筛选面板（搜索弹窗有独立遮罩，不在此处理）
  useEffect(() => {
    if (!filterOpen) return;
    const handler = (e: MouseEvent) => {
      const t = e.target as HTMLElement;
      if (t.closest(".sidebar-filter")) return;
      setFilterOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [filterOpen]);

  // 时间过滤辅助
  const timeFilterMs = useMemo(() => {
    if (filterTime === "today") return 86400000;
    if (filterTime === "week") return 604800000;
    if (filterTime === "month") return 2592000000;
    return Infinity;
  }, [filterTime]);

  // 分离 + 过滤：未归入空间的会话（任务）vs 按空间分组的会话
  const { taskConvs, spaceMap } = useMemo(() => {
    const now = Date.now();
    const map = new Map<string, typeof conversations>();
    for (const ws of workspaces) map.set(ws.id, []);
    const tasks: typeof conversations = [];
    for (const c of conversations) {
      if (c.requirementScoped || c.projectScoped) continue;
      // 状态过滤
      if (filterStatus && c.status !== filterStatus) {
        // 未归入空间的任务跳过，空间的也跳过
        if (!c.workspaceId || !map.has(c.workspaceId)) continue;
        // 有空间归属的继续走空间分组
      }
      // 时间过滤
      if (now - (c.updatedAt || 0) > timeFilterMs) {
        if (!c.workspaceId || !map.has(c.workspaceId)) continue;
      }
      if (c.workspaceId && map.has(c.workspaceId)) {
        map.get(c.workspaceId)!.push(c);
      } else {
        tasks.push(c);
      }
    }
    // 统一按最近更新排序
    const sortFn = (
      a: typeof conversations[number],
      b: typeof conversations[number],
    ) => (b.updatedAt || 0) - (a.updatedAt || 0);
    tasks.sort(sortFn);
    for (const [, v] of map) v.sort(sortFn);
    return { taskConvs: tasks, spaceMap: map };
  }, [conversations, workspaces, filterStatus, timeFilterMs]);

  // 各空间的会话计数
  const spaceTotal = workspaces.reduce(
    (sum, ws) => sum + (spaceMap.get(ws.id)?.length || 0),
    0,
  );

  return (
    <aside
      className={`sidebar ${collapsed ? "collapsed" : ""} ${
        IS_ELECTRON_MAC ? "sidebar--mac-inset" : ""
      }`}
    >
      {/* ── 标题栏 ── */}
      <div className="sidebar-header-container">
        <div className="sidebar-top-row">
          <div className="sidebar-top-actions">
            {showInlineToggle && (
              <button
                className="sidebar-icon-btn sidebar-toggle-btn"
                onClick={toggleSidebar}
                title={collapsed ? "展开侧边栏" : "收起侧边栏"}
              >
                <PanelLeft size={17} />
              </button>
            )}
            <button
              className={`sidebar-icon-btn ${searchOpen ? "active" : ""}`}
              title="检索"
              onClick={() => {
                setSearchOpen(true);
                setLocalSearchQuery(searchQuery);
              }}
            >
              <Search size={16} />
            </button>
            {/* 筛选按钮-暂时隐藏 */}
            {/* <div className="sidebar-filter">
              <button
                className={`sidebar-icon-btn ${filterOpen ? "active" : ""}`}
                title="筛选"
                onClick={() => setFilterOpen((v) => !v)}
              >
                <SlidersHorizontal size={16} />
              </button>
              {filterOpen && (
                <div
                  className="sidebar-filter-menu"
                  onClick={(e) => e.stopPropagation()}
                >
                  <div className="filter-section-label">{t("status")}</div>
                  {STATUS_OPTIONS.map(({ key, labelKey }) => (
                    <button
                      key={key || "all-status"}
                      className={`sidebar-filter-item ${
                        filterStatus === key ? "active" : ""
                      }`}
                      onClick={() => setFilterStatus(key)}
                    >
                      <span className="filter-item-label">{t(labelKey)}</span>
                      {filterStatus === key && <Check size={13} />}
                    </button>
                  ))}
                  <div className="filter-section-label">{t("filter_time")}</div>
                  {TIME_OPTIONS.map(({ key, labelKey }) => (
                    <button
                      key={key || "all-time"}
                      className={`sidebar-filter-item ${
                        filterTime === key ? "active" : ""
                      }`}
                      onClick={() => setFilterTime(key)}
                    >
                      <span className="filter-item-label">{t(labelKey)}</span>
                      {filterTime === key && <Check size={13} />}
                    </button>
                  ))}
                  <div className="filter-divider" />
                  <button
                    className="sidebar-filter-reset"
                    onClick={() => {
                      setFilterStatus("");
                      setFilterTime("");
                    }}
                  >
                    <RotateCcw size={12} />
                    {t("reset_filter")}
                  </button>
                </div>
              )}
            </div> */}
          </div>
        </div>
        <div className="sidebar-brand-row">
          <PiLogo size={16} />
          <span className="sidebar-brand-name">PiCoddy</span>
          <span className="sidebar-brand-version"><AppVersion /></span>
        </div>
      </div>

      <nav className="sidebar-nav">
        <button
          className="sidebar-nav-item new-task-btn"
          onClick={() => resetToWelcome()}
        >
          <span className="sidebar-nav-icon">
            <CirclePlus size={17} strokeWidth={2} />
          </span>
          <span className="sidebar-nav-label">{t("new_task")}</span>
        </button>
        {FEATURE_TABS.map((cat) => {
          const Icon = cat.icon;
          const active = cat.panel
            ? activeCategory === "expert" && expertPanelTab === cat.panel
            : activeCategory === cat.id && (cat.id !== "project" || !hasActiveRequirement);
          const label = cat.panel ? cat.labelFallback : cat.id === "project" ? "项目" : t(cat.labelKey);
          return (
            <button
              key={cat.id}
              className={`sidebar-nav-item ${active ? "active" : ""}`}
              onClick={() => {
                if (cat.panel) {
                  setExpertPanelTab(cat.panel);
                }
                if (cat.id === "project") openProjectOverview(authSession?.userId || "");
                setCategory(cat.panel ? "expert" : cat.id);
              }}
            >
              <span className="sidebar-nav-icon" style={{ color: cat.color }}>
                <Icon size={16} />
              </span>
              <span className="sidebar-nav-label">{label}</span>
            </button>
          );
        })}
      </nav>

      {/* ═══════ 检索弹窗（全屏遮罩，对齐 参考设计 截图1） ═══════ */}
      {searchOpen && (
        <div
          className="search-overlay"
          onClick={() => setSearchOpen(false)}
        >
          <div className="search-modal" onClick={(e) => e.stopPropagation()}>
            {/* 搜索框头部 */}
            <div className="search-header">
              <Search size={16} color="var(--text-3)" />
              <input
                className="search-input"
                autoFocus
                value={localSearchQuery}
                onChange={(e) => {
                  setLocalSearchQuery(e.target.value);
                  useStore.setState({ searchQuery: e.target.value });
                  useStore.getState().loadConversations();
                }}
                onKeyDown={(e) => {
                  if (e.key === "Escape") setSearchOpen(false);
                }}
                placeholder={t("search_task")}
              />
              <button
                className="search-close-btn"
                onClick={() => setSearchOpen(false)}
              >
                <X size={16} />
              </button>
            </div>

            {/* 结果列表 */}
            <div className="search-results">
              {localSearchQuery.trim() && conversations.length > 0
                ? (
                  (() => {
                    const q = localSearchQuery.toLowerCase();
                    const hits = conversations.filter((c) => !c.requirementScoped && !c.projectScoped)
                      .filter((c) => (c.title || "").toLowerCase().includes(q))
                      .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
                      .slice(0, 50);
                    if (hits.length === 0) {
                      return (
                        <div className="search-empty">
                          {t("no_matching_tasks")}
                        </div>
                      );
                    }
                    return hits.map((c) => {
                      const ws = c.workspaceId
                        ? workspaces.find((w) => w.id === c.workspaceId)
                        : null;
                      return (
                        <div
                          key={c.id}
                          className="search-result-item"
                          onClick={() => {
                            useStore.getState().selectConversation(c.id);
                            setSearchOpen(false);
                          }}
                        >
                          <div className="search-result-title">
                            {c.title || "新任务"}
                          </div>
                          <div className="search-result-meta">
                            <span className="search-result-time">
                              {timeAgo(c.updatedAt)}
                            </span>
                            {ws && (
                              <>
                                <WorkspaceIcon name={ws.icon} size={12} />
                                <span className="search-result-ws">
                                  {ws.name}
                                </span>
                              </>
                            )}
                          </div>
                        </div>
                      );
                    });
                  })()
                )
                : localSearchQuery.trim()
                ? <div className="search-empty">{t("no_matching_tasks")}</div>
                : (
                  <div className="search-empty">
                    {t("input_keyword_search")}
                  </div>
                )}
            </div>
          </div>
        </div>
      )}

      {/* ═══════ 会话列表区域 ═══════ */}
      <div className="sidebar-list-area">
        <LocalProjectSidebar account={authSession?.userId || ""} />
        {/* ── 任务 (N) ── */}
        <CollapsibleSection label={t("tasks")} count={taskConvs.length}>
          {taskConvs.length === 0
            ? <div className="sidebar-section-empty">{t("no_tasks")}</div>
            : (
              <div className="sidebar-conv-list">
                <PagedConvList
                  convs={taskConvs}
                  pinnedIds={pinnedIds}
                  onTogglePin={togglePinned}
                />
              </div>
            )}
        </CollapsibleSection>

        {/* ── 空间 (M) ── */}
        <CollapsibleSection label={t("spaces")} count={spaceTotal}>
          {workspaces.length === 0
            ? <div className="sidebar-section-empty">{t("no_spaces")}</div>
            : (
              <div className="workspace-list">
                {workspaces.map((ws) => (
                  <WorkspaceItem
                    key={ws.id}
                    ws={ws}
                    convs={spaceMap.get(ws.id) || []}
                    pinnedIds={pinnedIds}
                    onTogglePin={togglePinned}
                  />
                ))}
              </div>
            )}
        </CollapsibleSection>

        {/* 完全空状态 */}
        {taskConvs.length === 0 && workspaces.length === 0 &&
          conversations.length === 0 && (
          <div className="sidebar-conv-empty">{t("no_task_click_above")}</div>
        )}
      </div>

      {/* ── 底部 ── */}
      <div className="sidebar-footer">
        <div className="sidebar-user-avatar">
          {authSession?.avatar
            ? <img src={authSession.avatar} alt="" />
            : (
              <span>
                {(formatAuthDisplayName(authSession) || "Pi").trim().slice(0, 2)
                  .toUpperCase()}
              </span>
            )}
        </div>
        <div className="sidebar-user-info">
          <div className="sidebar-user-name">
            {formatAuthDisplayName(authSession)}
          </div>
          <div className="sidebar-user-plan">
            {formatAuthSubtitle(authSession)}
          </div>
        </div>
        {onLogout && authSession && (
          <button
            className="sidebar-icon-btn"
            onClick={() => void onLogout()}
            title="退出登录"
          >
            <LogOut size={16} />
          </button>
        )}
        <button
          className="sidebar-icon-btn"
          onClick={toggleTheme}
          title={t("toggle_theme")}
        >
          {theme === "dark" ? <Sun size={16} /> : <Moon size={16} />}
        </button>
        <button
          className="sidebar-icon-btn"
          onClick={() => setShowSettings(true)}
          title={t("settings")}
        >
          <Settings size={16} />
        </button>
      </div>
    </aside>
  );
}
