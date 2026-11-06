import { useEffect, useMemo, useRef, useState } from "react";
import {
  Check,
  Edit,
  Eye,
  Folder,
  HatGlasses,
  Link,
  MessageCircle,
  MoreHorizontal,
  Pencil,
  Plus,
  Puzzle,
  RefreshCw,
  Search,
  Send,
  Trash2,
  X,
} from "lucide-react";
import {
  type McpConfig,
  ExpertCreatorNavigationError,
  SkillCreatorNavigationError,
  type Expert,
  type SkillMeta,
  useSkillStore,
} from "../store/useSkillStore";
import { ApiError } from "../api/client";
import CloudSkillImport from "./CloudSkillImport";
import {
  filterSkillHubSkills,
  isSkillHubInstalled,
  resolveLocalSkillVersion,
  skillHubCategories,
  skillHubIdentity,
  skillHubInstallVersion,
  skillHubNamespaceDisplayName,
  skillVersionLabel,
  type SkillHubExpertDetail,
  type SkillHubSkill,
} from "./skillHubModel";
import {
  cardControlFor,
  connectorLoadErrorLabel,
  viewFor,
  type ConnectorPrimaryAction,
  type ConnectorServiceItem,
} from "./connectorModel";
import ConnectorActionLoader from "./ConnectorActionLoader";
import McpOAuthControls from "./McpOAuthControls";
import BuiltinNpmMcpCard from "./BuiltinNpmMcpCard";
import FigmaConnectorCard from "./FigmaConnectorCard";
import ConnectorCard from "./ConnectorCard";
import { useStore } from "../store/useStore";
import "./ExpertPanel.css";

function formatExpertError(error: unknown, fallback: string): string {
  if (error instanceof ApiError) {
    return error.code
      ? `${error.message}（${error.code}）`
      : error.message;
  }
  if (error instanceof Error && error.message.trim()) return error.message;
  return fallback;
}

type SkillDetailTarget =
  | { kind: "hub"; skill: SkillHubSkill }
  | { kind: "local"; skill: SkillMeta };

const getAvatarStyle = (id: string) => {
  let hash = 0;
  for (let i = 0; i < id.length; i++) {
    hash = id.charCodeAt(i) + ((hash << 5) - hash);
  }
  const hues = [200, 220, 260, 280, 320, 340, 150, 180];
  const hue = hues[Math.abs(hash) % hues.length];
  return {
    background:
      `linear-gradient(135deg, hsl(${hue}, 70%, 55%) 0%, hsl(${hue}, 75%, 45%) 100%)`,
    color: "#ffffff",
    borderRadius: "50%",
    boxShadow:
      "inset 0 1px 1px rgba(255,255,255,0.2), 0 2px 4px rgba(0,0,0,0.06)",
  };
};

function SkillHubCatalogChrome({
  categories,
  selected,
  onSelect,
  loading,
  error,
  itemCount,
  itemLabel,
  onRetry,
}: {
  categories: Array<{ slug: string; displayName: string }>;
  selected: string;
  onSelect: (slug: string) => void;
  loading: boolean;
  error: string | null;
  itemCount: number;
  itemLabel: "技能" | "专家";
  onRetry: () => void;
}) {
  return (
    <>
      <div className="ep-sub-tabs">
        {categories.map((category) => (
          <button
            key={category.slug}
            className={`ep-sub-tab-btn ${selected === category.slug ? "active" : ""}`}
            onClick={() => onSelect(category.slug)}
          >
            {category.displayName}
          </button>
        ))}
      </div>
      {loading && itemCount === 0 && (
        <div className="ep-empty-view skillhub-state" role="status">
          <RefreshCw className="is-spinning" size={17} />
          正在加载 SkillHub {itemLabel}…
        </div>
      )}
      {error && (
        <div className="skillhub-error-banner" role="alert">
          <span>{error}</span>
          <button
            type="button"
            className="skillhub-retry-btn"
            disabled={loading}
            onClick={onRetry}
          >
            <RefreshCw className={loading ? "is-spinning" : ""} size={14} />
            重试
          </button>
        </div>
      )}
    </>
  );
}

export default function ExpertPanel() {
  const {
    skills,
    skillHubSkills,
    skillHubExperts,
    skillHubNamespaces,
    skillHubLoading,
    skillHubError,
    skillHubAuthError,
    skillHubAuthChecking,
    ensureSkillHubAuth,
    installingSkillHubIds,
    summoningSkillHubExpertId,
    installedSkillHubNames,
    installedExperts,
    installedExpertsError,
    installedExpertsLoading,
    loadSkills,
    loadSkillHubSkills,
    loadSkillHubExperts,
    getSkillHubExpertDetail,
    installSkillHubSkill,
    summonSkillHubExpert,
    saveSkill,
    deleteSkill,
    toggleSkill,
    loadExperts,
    loadInstalledExperts,
    startExpertChat,
    startExpertEdit,
    startSkillEdit,
    openExpertFolder,
    uninstallExpert,
    getExpert,
    startExpertCreatorChat,
    startSkillCreatorChat,
    showInstalledSkills: installedOnly,
    setShowInstalledSkills: setInstalledOnly,
    showInstalledExperts,
    setShowInstalledExperts,
    customMcpConfig,
    mcpConnected,
    mcpBusyIds,
    loadMcp,
    saveMcp,
    connectMcp,
    disconnectMcp,
    uninstallMcp,
    connectorItems,
    connectorError,
    connectorErrorCode,
    loadConnectors,
    activateConnector,
    reauthorizeConnector,
    repairConnector,
  } = useSkillStore();
  const {
    projectTapdAuthorization,
    returnFromProjectTapdAuthorization,
    expertPanelTab: activeTab,
    requestUiConfirm,
    showUiAlert,
    resetToWelcome,
    addComposerConnector,
  } = useStore();

  const [searchQuery, setSearchQuery] = useState("");
  const [pendingExpertId, setPendingExpertId] = useState<string | null>(null);
  const [pendingExpertOperationId, setPendingExpertOperationId] = useState<
    string | null
  >(null);
  const [expertStartError, setExpertStartError] = useState<string | null>(null);
  const [creatingExpert, setCreatingExpert] = useState(false);
  const pendingExpertRef = useRef<string | null>(null);
  const pendingExpertOperationRef = useRef<string | null>(null);
  const expertMenuRef = useRef<HTMLDivElement | null>(null);
  const expertMenuButtonRefs = useRef<Record<string, HTMLButtonElement | null>>(
    {},
  );
  const [openExpertMenuId, setOpenExpertMenuId] = useState<string | null>(null);
  const [detailExpert, setDetailExpert] = useState<Expert | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const detailRequestRef = useRef(0);
  const detailReturnFocusRef = useRef<HTMLElement | null>(null);
  const detailCloseRef = useRef<HTMLButtonElement | null>(null);
  const [marketDetailExpert, setMarketDetailExpert] = useState<SkillHubExpertDetail | null>(null);
  const [marketDetailLoading, setMarketDetailLoading] = useState(false);
  const [marketDetailError, setMarketDetailError] = useState<string | null>(null);
  const marketDetailRequestRef = useRef(0);
  const marketDetailReturnFocusRef = useRef<HTMLElement | null>(null);
  const marketDetailCloseRef = useRef<HTMLButtonElement | null>(null);
  const [skillDetail, setSkillDetail] = useState<SkillDetailTarget | null>(null);
  const skillDetailReturnFocusRef = useRef<HTMLElement | null>(null);
  const skillDetailCloseRef = useRef<HTMLButtonElement | null>(null);
  const creatingExpertRef = useRef(false);
  const expertCreatorNavigationIntentRef = useRef(0);
  const [creatingSkill, setCreatingSkill] = useState(false);
  const [skillCreatorError, setSkillCreatorError] = useState<string | null>(
    null,
  );
  const creatingSkillRef = useRef(false);
  const creatorMountedRef = useRef(true);
  const creatorNavigationIntentRef = useRef(0);
  const skillHubLoadStartedRef = useRef(false);
  const expertHubLoadStartedRef = useRef(false);
  const [selectedSubCategory, setSelectedSubCategory] = useState("全部");

  // 技能表单模态框状态
  const [modalOpen, setModalOpen] = useState(false);
  const [pendingSkillOperationId, setPendingSkillOperationId] = useState<
    string | null
  >(null);
  const pendingSkillOperationRef = useRef<string | null>(null);
  const [formName, setFormName] = useState("");
  const [formDisplayName, setFormDisplayName] = useState("");
  const [formDesc, setFormDesc] = useState("");
  const [formBody, setFormBody] = useState("");

  // MCP模态框状态
  const [mcpModalOpen, setMcpModalOpen] = useState(false);
  const [mcpSearchQuery, setMcpSearchQuery] = useState("");
  const [isEditingMcpConfig, setIsEditingMcpConfig] = useState(false);
  const [mcpConfigText, setMcpConfigText] = useState("");
  const [mcpErrorAlert, setMcpErrorAlert] = useState<string | null>(null);

  useEffect(() => {
    loadSkills();
    loadExperts();
    loadInstalledExperts();
    loadMcp();
    loadConnectors();
    return () => {
      creatorMountedRef.current = false;
      creatorNavigationIntentRef.current += 1;
      expertCreatorNavigationIntentRef.current += 1;
    };
  }, []);

  useEffect(() => {
    if (activeTab !== "skill" || skillHubLoadStartedRef.current) return;
    skillHubLoadStartedRef.current = true;
    void loadSkillHubSkills();
  }, [activeTab, loadSkillHubSkills]);

  useEffect(() => {
    if (activeTab !== "expert" || expertHubLoadStartedRef.current) return;
    expertHubLoadStartedRef.current = true;
    void loadSkillHubExperts();
  }, [activeTab, loadSkillHubExperts]);

  useEffect(() => {
    if (!openExpertMenuId) return;

    const handlePointerDown = (event: PointerEvent) => {
      if (!expertMenuRef.current?.contains(event.target as Node)) {
        setOpenExpertMenuId(null);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setOpenExpertMenuId(null);
        expertMenuButtonRefs.current[openExpertMenuId]?.focus();
        return;
      }
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        const menuItems = Array.from(
          expertMenuRef.current?.querySelectorAll<HTMLElement>(
            '[role="menuitem"]',
          ) ?? [],
        );
        if (menuItems.length === 0) return;
        const currentIndex = menuItems.indexOf(
          document.activeElement as HTMLElement,
        );
        const offset = event.key === "ArrowDown" ? 1 : -1;
        const nextIndex = currentIndex < 0
          ? 0
          : (currentIndex + offset + menuItems.length) % menuItems.length;
        menuItems[nextIndex]?.focus();
      }
    };

    document.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);
    const frame = window.requestAnimationFrame(() => {
      expertMenuRef.current?.querySelector<HTMLElement>('[role="menuitem"]')
        ?.focus();
    });
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
      window.cancelAnimationFrame(frame);
    };
  }, [openExpertMenuId]);

  useEffect(() => {
    if (!detailExpert) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeExpertDetail();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [detailExpert]);

  useEffect(() => {
    if (!detailExpert) return;
    const frame = window.requestAnimationFrame(() => detailCloseRef.current?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, [detailExpert?.id]);

  useEffect(() => {
    if (!marketDetailExpert) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeMarketExpertDetail();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    const frame = window.requestAnimationFrame(() => marketDetailCloseRef.current?.focus());
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.cancelAnimationFrame(frame);
    };
  }, [marketDetailExpert?.id]);

  const skillDetailKey = skillDetail
    ? skillDetail.kind === "hub"
      ? skillHubIdentity(skillDetail.skill)
      : skillDetail.skill.name
    : "";

  const closeSkillDetail = () => {
    setSkillDetail(null);
    window.requestAnimationFrame(() => skillDetailReturnFocusRef.current?.focus());
  };

  useEffect(() => {
    if (!skillDetail) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeSkillDetail();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    const frame = window.requestAnimationFrame(() => skillDetailCloseRef.current?.focus());
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.cancelAnimationFrame(frame);
    };
  }, [skillDetailKey]);

  const closeExpertDetail = () => {
    setDetailExpert(null);
    setDetailError(null);
    window.requestAnimationFrame(() => detailReturnFocusRef.current?.focus());
  };

  const handleViewExpert = async (expert: Expert, trigger?: HTMLElement) => {
    setOpenExpertMenuId(null);
    detailReturnFocusRef.current =
      trigger ?? expertMenuButtonRefs.current[expert.id];
    setDetailExpert(expert);
    setDetailError(null);
    setDetailLoading(true);
    const requestId = ++detailRequestRef.current;
    try {
      const detail = await getExpert(expert.id);
      if (detailRequestRef.current === requestId) setDetailExpert(detail);
    } catch (error) {
      if (detailRequestRef.current === requestId) {
        setDetailError(formatExpertError(error, "无法加载专家详情，请重试"));
      }
    } finally {
      if (detailRequestRef.current === requestId) setDetailLoading(false);
    }
  };

  const handleStartExpertChat = async (
    expertId: string,
    expertName: string,
    initialPrompt?: string,
  ): Promise<boolean> => {
    if (pendingExpertRef.current || pendingExpertOperationRef.current) return false;
    pendingExpertRef.current = expertId;
    pendingExpertOperationRef.current = expertId;
    setPendingExpertId(expertId);
    setPendingExpertOperationId(expertId);
    setExpertStartError(null);
    try {
      await startExpertChat(expertId, expertName, initialPrompt);
      return true;
    } catch (error) {
      setExpertStartError(
        formatExpertError(error, "专家对话创建失败，请重试"),
      );
      return false;
    } finally {
      pendingExpertRef.current = null;
      pendingExpertOperationRef.current = null;
      setPendingExpertId(null);
      setPendingExpertOperationId(null);
    }
  };

  const handleStartExpertFromDetail = async (initialPrompt?: string) => {
    if (!detailExpert) return;
    const opened = await handleStartExpertChat(
      detailExpert.id,
      detailExpert.name,
      initialPrompt,
    );
    if (opened) closeExpertDetail();
  };

  const handleStartExpertEdit = async (expert: Expert) => {
    if (pendingExpertOperationRef.current) return;
    setOpenExpertMenuId(null);
    pendingExpertOperationRef.current = expert.id;
    setPendingExpertOperationId(expert.id);
    try {
      await startExpertEdit(expert);
    } catch (error) {
      await showUiAlert({
        title: "修改专家失败",
        message: formatExpertError(error, "无法打开专家修改会话，请重试"),
        tone: "danger",
      });
    } finally {
      pendingExpertOperationRef.current = null;
      setPendingExpertOperationId(null);
    }
  };

  const handleStartSkillEdit = async (skill: SkillMeta) => {
    if (pendingSkillOperationRef.current) return;
    setOpenExpertMenuId(null);
    pendingSkillOperationRef.current = skill.name;
    setPendingSkillOperationId(skill.name);
    try {
      await startSkillEdit(skill);
    } catch (error) {
      await showUiAlert({
        title: "修改技能失败",
        message: formatExpertError(error, "无法打开技能修改会话，请重试"),
        tone: "danger",
      });
    } finally {
      pendingSkillOperationRef.current = null;
      setPendingSkillOperationId(null);
    }
  };

  const handleOpenExpertFolder = async (expert: Expert) => {
    if (pendingExpertOperationRef.current) return;
    setOpenExpertMenuId(null);
    pendingExpertOperationRef.current = expert.id;
    setPendingExpertOperationId(expert.id);
    try {
      await openExpertFolder(expert.id);
    } catch (error) {
      await showUiAlert({
        title: "打开文件夹失败",
        message: formatExpertError(error, "无法打开专家文件夹，请重试"),
        tone: "danger",
      });
    } finally {
      pendingExpertOperationRef.current = null;
      setPendingExpertOperationId(null);
    }
  };

  const handleUninstallExpert = async (expert: Expert) => {
    if (pendingExpertOperationRef.current) return;
    setOpenExpertMenuId(null);
    pendingExpertOperationRef.current = expert.id;
    setPendingExpertOperationId(expert.id);
    const approved = await requestUiConfirm({
      title: "卸载专家",
      message: `确定卸载专家「${expert.name}」？\n历史消息将保留，相关会话会切换为普通会话。`,
      confirmLabel: "确认卸载",
      cancelLabel: "取消",
      tone: "danger",
    });
    if (!approved) {
      pendingExpertOperationRef.current = null;
      setPendingExpertOperationId(null);
      return;
    }

    try {
      await uninstallExpert(expert.id);
      if (detailExpert?.id === expert.id) closeExpertDetail();
    } catch (error) {
      await showUiAlert({
        title: "卸载专家失败",
        message: formatExpertError(error, "无法卸载专家，请重试"),
        tone: "danger",
      });
    } finally {
      pendingExpertOperationRef.current = null;
      setPendingExpertOperationId(null);
    }
  };

  const handleStartExpertCreator = async () => {
    if (creatingExpertRef.current) return;
    const originConversationId = useStore.getState().currentConvId;
    const navigationIntent = ++expertCreatorNavigationIntentRef.current;
    creatingExpertRef.current = true;
    setCreatingExpert(true);
    setExpertStartError(null);
    try {
      await startExpertCreatorChat();
    } catch (error) {
      if (error instanceof ExpertCreatorNavigationError) {
        const currentConversationId = useStore.getState().currentConvId;
        const canRecover = creatorMountedRef.current &&
          expertCreatorNavigationIntentRef.current === navigationIntent &&
          (currentConversationId === originConversationId ||
            currentConversationId === null ||
            currentConversationId === error.conversationId);
        if (!canRecover) return;
        try {
          await useStore.getState().selectConversation(error.conversationId);
          return;
        } catch {
          setExpertStartError(
            "专家创建会话已创建，但暂时无法打开。请从侧栏选择“创建专家”会话继续。",
          );
        }
      } else if (
        creatorMountedRef.current &&
        expertCreatorNavigationIntentRef.current === navigationIntent
      ) {
        setExpertStartError(
          formatExpertError(error, "专家创建会话创建失败，请重试"),
        );
      }
    } finally {
      creatingExpertRef.current = false;
      if (
        creatorMountedRef.current &&
        expertCreatorNavigationIntentRef.current === navigationIntent
      ) {
        setCreatingExpert(false);
      }
    }
  };

  const handleStartSkillCreator = async () => {
    if (creatingSkillRef.current) return;
    const originConversationId = useStore.getState().currentConvId;
    const navigationIntent = ++creatorNavigationIntentRef.current;
    creatingSkillRef.current = true;
    setCreatingSkill(true);
    setSkillCreatorError(null);
    try {
      await startSkillCreatorChat();
    } catch (error) {
      if (error instanceof SkillCreatorNavigationError) {
        const currentConversationId = useStore.getState().currentConvId;
        const canRecover = creatorMountedRef.current &&
          creatorNavigationIntentRef.current === navigationIntent &&
          (
            currentConversationId === originConversationId ||
            currentConversationId === null ||
            currentConversationId === error.conversationId
          );
        if (!canRecover) return;
        try {
          await useStore.getState().selectConversation(error.conversationId);
          return;
        } catch {
          const latestConversationId = useStore.getState().currentConvId;
          if (
            creatorMountedRef.current &&
            creatorNavigationIntentRef.current === navigationIntent &&
            (
              latestConversationId === originConversationId ||
              latestConversationId === null ||
              latestConversationId === error.conversationId
            )
          ) {
            setSkillCreatorError(
              "技能创建会话已创建，但暂时无法打开。请从侧栏选择“创建技能”会话继续。",
            );
          }
        }
      } else if (
        creatorMountedRef.current &&
        creatorNavigationIntentRef.current === navigationIntent
      ) {
        const message = error instanceof Error ? error.message : String(error);
        setSkillCreatorError(message || "技能创建会话创建失败，请重试");
      }
    } finally {
      creatingSkillRef.current = false;
      if (
        creatorMountedRef.current &&
        creatorNavigationIntentRef.current === navigationIntent
      ) {
        setCreatingSkill(false);
      }
    }
  };

  const handleInstallSkillHub = async (skill: SkillHubSkill) => {
    try {
      await installSkillHubSkill(skill);
    } catch (error) {
      await showUiAlert({
        title: "SkillHub 安装失败",
        message: formatExpertError(error, "技能安装失败，请重试"),
      });
    }
  };

  const handleViewSkillHubSkill = (skill: SkillHubSkill, trigger?: HTMLElement) => {
    skillDetailReturnFocusRef.current = trigger ?? null;
    setSkillDetail({ kind: "hub", skill });
  };

  const handleViewLocalSkill = (skill: SkillMeta, trigger?: HTMLElement) => {
    skillDetailReturnFocusRef.current = trigger ?? null;
    setSkillDetail({ kind: "local", skill });
  };

  const closeMarketExpertDetail = () => {
    marketDetailRequestRef.current += 1;
    setMarketDetailExpert(null);
    setMarketDetailLoading(false);
    setMarketDetailError(null);
    window.requestAnimationFrame(() => marketDetailReturnFocusRef.current?.focus());
  };

  const handleViewSkillHubExpert = async (
    expert: SkillHubSkill,
    trigger?: HTMLElement,
  ) => {
    marketDetailReturnFocusRef.current = trigger ?? null;
    setMarketDetailExpert({
      ...expert,
      ownerDisplayName: "",
      subscriptionCount: 0,
      avatarPath: "",
      tags: [],
      quickPrompts: [],
    });
    setMarketDetailError(null);
    setMarketDetailLoading(true);
    const requestId = ++marketDetailRequestRef.current;
    try {
      const detail = await getSkillHubExpertDetail(expert);
      if (marketDetailRequestRef.current === requestId) setMarketDetailExpert(detail);
    } catch (error) {
      if (marketDetailRequestRef.current === requestId) {
        setMarketDetailError(formatExpertError(error, "无法加载专家详情，请重试"));
      }
    } finally {
      if (marketDetailRequestRef.current === requestId) setMarketDetailLoading(false);
    }
  };

  const handleSummonSkillHubExpert = async (expert: SkillHubSkill, initialPrompt?: string) => {
    try {
      setExpertStartError(null);
      await summonSkillHubExpert(expert, initialPrompt);
    } catch (error) {
      setExpertStartError(formatExpertError(error, "专家召唤失败，请重试"));
    }
  };

  // 技能分类
  const categories = useMemo(
    () => skillHubCategories(skillHubNamespaces),
    [skillHubNamespaces],
  );

  const filteredSkillHubSkills = useMemo(
    () => filterSkillHubSkills(
      skillHubSkills,
      selectedSubCategory,
      searchQuery,
    ),
    [skillHubSkills, selectedSubCategory, searchQuery],
  );

  const filteredSkillHubExperts = useMemo(
    () => filterSkillHubSkills(skillHubExperts, selectedSubCategory, searchQuery),
    [skillHubExperts, selectedSubCategory, searchQuery],
  );

  // 过滤后的已安装技能列表 (用于我安装的)
  const filteredInstalledSkills = useMemo(() => {
    return skills.filter((s) => {
      const query = searchQuery.toLowerCase();
      const dispName = s.displayName || s.name;
      return dispName.toLowerCase().includes(query) ||
        s.description.toLowerCase().includes(query);
    });
  }, [skills, searchQuery]);

  // “我的专家”只展示已注册 marketplace 包，并按搜索过滤。
  const filteredInstalledExperts = useMemo(() => {
    return installedExperts.filter((exp) => {
      const query = searchQuery.toLowerCase();
      return exp.name.toLowerCase().includes(query) ||
        (exp.nickname || "").toLowerCase().includes(query) ||
        exp.description.toLowerCase().includes(query);
    });
  }, [installedExperts, searchQuery]);

  // 保存技能表单
  const handleSaveForm = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(formName)) {
      await showUiAlert("技能标识名只能包含小写字母、数字和单个连字符");
      return;
    }
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(formDisplayName)) {
      await showUiAlert("技能触发名称只能包含小写字母、数字和单个连字符");
      return;
    }
    try {
      await saveSkill(
        formName,
        formDesc,
        false,
        formBody,
        formDisplayName,
      );
      setModalOpen(false);
    } catch (err: any) {
      await showUiAlert({
        title: "保存失败",
        message: err.message || "请稍后重试。",
        tone: "danger",
      });
    }
  };

  // ==================== MCP相关逻辑 ====================

  // 打开MCP管理模态框
  const handleOpenMcpModal = () => {
    setIsEditingMcpConfig(false);
    setMcpSearchQuery("");
    setMcpErrorAlert(null);
    setMcpModalOpen(true);
  };

  // 切换MCP配置编辑模式
  const handleToggleMcpConfigMode = () => {
    if (!isEditingMcpConfig) {
      setMcpConfigText(
        JSON.stringify(customMcpConfig || { mcpServers: {} }, null, 2),
      );
      setMcpErrorAlert(null);
    }
    setIsEditingMcpConfig(!isEditingMcpConfig);
  };

  // 保存MCP JSON配置文本
  const handleSaveMcpConfigText = async () => {
    try {
      const parsed = JSON.parse(mcpConfigText) as McpConfig;
      if (!parsed.mcpServers || typeof parsed.mcpServers !== "object") {
        throw new Error("配置对象中必须包含 mcpServers 属性");
      }
      const ok = await saveMcp(parsed);
      if (ok) {
        setIsEditingMcpConfig(false);
        setMcpErrorAlert(null);
      } else {
        setMcpErrorAlert("后端保存失败，请检查终端日志！");
      }
    } catch (err: any) {
      setMcpErrorAlert("JSON 解析有误: " + err.message);
    }
  };

  // 卸载MCP服务器
  const handleUninstallMcp = async (serverName: string) => {
    if (
      await requestUiConfirm({
        title: "卸载 MCP 服务器",
        message: `确认卸载并删除 MCP 服务器「${serverName}」？`,
        confirmLabel: "确认卸载",
        tone: "danger",
      })
    ) {
      await uninstallMcp(serverName);
    }
  };

  // ==================== 受管连接器逻辑 ====================

  // 本地产生的操作中连接器 id：防止重复点击；后端状态才是权威（busy 由 connectorItems 驱动）。
  const [runningConnectorOps, setRunningConnectorOps] = useState<
    Record<string, boolean>
  >({});
  const [connectorNotice, setConnectorNotice] = useState<{
    connectorId: string;
    kind: "install" | "authorize";
    dismissed: boolean;
  } | null>(null);

  // 后端忙碌状态（installing/authorizing）下轮询刷新，等待安装/授权收敛。
  const busyConnectorIds = connectorItems
    .filter((item) => viewFor(item).busy)
    .map((item) => item.id)
    .join(",");

  useEffect(() => {
    if (!busyConnectorIds) return;
    const timer = setInterval(() => void loadConnectors(), 1500);
    return () => clearInterval(timer);
  }, [busyConnectorIds, loadConnectors]);

  const runConnectorOp = async (id: string, op: () => Promise<void>) => {
    if (runningConnectorOps[id]) return;
    setRunningConnectorOps((prev) => ({ ...prev, [id]: true }));
    try {
      await op();
    } catch (err) {
      console.error(`[connector] ${id} 操作失败:`, err);
    } finally {
      await loadConnectors();
      setRunningConnectorOps((prev) => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
    }
  };

  // 点击“＋”：安装连接器依赖，随后自动进入授权流程
  const handleActivateConnector = async (item: ConnectorServiceItem) => {
    setConnectorNotice({ connectorId: item.id, kind: "install", dismissed: false });
    try {
      await runConnectorOp(item.id, () => activateConnector(item.id));
    } finally {
      setConnectorNotice((current) =>
        current?.connectorId === item.id ? null : current
      );
    }
  };

  const handleConnectorAction = async (
    item: ConnectorServiceItem,
    action: ConnectorPrimaryAction,
  ) => {
    switch (action) {
      case "activate":
        await handleActivateConnector(item);
        break;
      case "repair":
        setConnectorNotice({ connectorId: item.id, kind: "install", dismissed: false });
        try {
          await runConnectorOp(item.id, () => repairConnector(item.id));
        } finally {
          setConnectorNotice((current) =>
            current?.connectorId === item.id ? null : current
          );
        }
        break;
      case "reauthorize":
        setConnectorNotice({ connectorId: item.id, kind: "authorize", dismissed: false });
        try {
          await runConnectorOp(item.id, () => reauthorizeConnector(item.id));
        } finally {
          setConnectorNotice((current) =>
            current?.connectorId === item.id ? null : current
          );
        }
        break;
    }
  };

  const handleOpenConnectorConversation = (item: ConnectorServiceItem) => {
    resetToWelcome({ preserveComposerConnectors: true });
    addComposerConnector({
      id: item.id,
      displayName: item.displayName,
      icon: item.icon,
      kind: "managed-cli",
    });
  };

  const filteredConnectorItems = useMemo(() => {
    const query = searchQuery.trim().toLocaleLowerCase();
    if (!query) return connectorItems;
    return connectorItems.filter((item) =>
      `${item.displayName}\n${item.description}`.toLocaleLowerCase().includes(query)
    );
  }, [connectorItems, searchQuery]);

  // 过滤后的连接器/MCP服务器列表
  const filteredMcpServers = useMemo(() => {
    const servers = Object.entries(customMcpConfig?.mcpServers || {});
    if (!mcpSearchQuery) return servers;
    const query = mcpSearchQuery.toLowerCase();
    return servers.filter(([name]) => name.toLowerCase().includes(query));
  }, [customMcpConfig, mcpSearchQuery]);


  return (
    <div className="expert-panel">
      {projectTapdAuthorization && <div className="skillhub-state" role="status">
        <span>在 TAPD 详情完成授权并确认连接后，将返回原项目。</span>
        <button type="button" className="skillhub-retry-btn" onClick={() => { returnFromProjectTapdAuthorization(); window.dispatchEvent(new Event('project-tapd-auth-error')); }}>返回项目</button>
      </div>}
      {skillHubAuthChecking && <div className="skillhub-state" role="status">正在检查技能市场登录状态…</div>}
      {skillHubAuthError && (
        <div className="skillhub-error-banner" role="alert">
          <span>{skillHubAuthError}</span>
          <button className="skillhub-retry-btn" disabled={skillHubAuthChecking} onClick={() => {
            void ensureSkillHubAuth().then((ok) => {
              if (!ok) return;
              if (activeTab === "expert") void loadSkillHubExperts();
              if (activeTab === "skill") void loadSkillHubSkills();
            });
          }}>重试</button>
        </div>
      )}
      {/* ── 顶部控制栏 ── */}
      <div className="ep-header">
        <h1 className="ep-page-title">
          {activeTab === "expert" ? <HatGlasses size={18} /> : activeTab === "skill" ? <Puzzle size={18} /> : <Link size={18} />}
          <span>{activeTab === "expert" ? "专家" : activeTab === "skill" ? "技能" : "连接器"}</span>
        </h1>

        <div className="ep-controls">
          {activeTab === "expert" && (
            <>
              <div className="ep-search-wrapper">
                <Search size={14} className="ep-search-icon" />
                <input
                  type="search"
                  placeholder={showInstalledExperts ? "搜索我的专家" : "搜索专家"}
                  aria-label={showInstalledExperts ? "搜索我的专家" : "搜索专家"}
                  value={searchQuery}
                  onChange={(event) => setSearchQuery(event.target.value)}
                  className="ep-search-input"
                />
              </div>
              <button
                className={`ep-btn ep-btn-secondary ${showInstalledExperts ? "active" : ""}`}
                aria-label={`我的专家 ${installedExperts.length}`}
                title={`我的专家 ${installedExperts.length}`}
                onClick={() => {
                  setShowInstalledExperts(!showInstalledExperts);
                  setSelectedSubCategory("全部");
                }}
              >
                <HatGlasses size={14} />
                <span className="ep-btn-label">我的专家</span>
                <span className="ep-badge">{installedExperts.length}</span>
              </button>
              <button
                className="ep-btn ep-btn-primary"
                disabled={creatingExpert}
                aria-label={creatingExpert ? "创建中…" : "添加专家"}
                title={creatingExpert ? "创建中…" : "添加专家"}
                onClick={() => void handleStartExpertCreator()}
              >
                <Plus size={14} />
                <span className="ep-btn-label">{creatingExpert ? "创建中…" : "添加专家"}</span>
              </button>
            </>
          )}
          {activeTab === "skill" && (
            <>
              <CloudSkillImport />
              <div className="ep-search-wrapper">
                <Search size={14} className="ep-search-icon" />
                <input
                  type="text"
                  placeholder="搜索技能"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="ep-search-input"
                />
              </div>

              <button
                className={`ep-btn ep-btn-secondary ${
                  installedOnly ? "active" : ""
                }`}
                aria-label={`我安装的 ${skills.length}`}
                title={`我安装的 ${skills.length}`}
                onClick={() => {
                  setInstalledOnly(!installedOnly);
                  setSelectedSubCategory("全部");
                }}
              >
                <Puzzle size={14} />
                <span className="ep-btn-label">我安装的</span>
                <span className="ep-badge">{skills.length}</span>
              </button>

              <button
                className="ep-btn ep-btn-primary"
                disabled={creatingSkill}
                aria-label={creatingSkill ? "创建中…" : "添加技能"}
                title={creatingSkill ? "创建中…" : "添加技能"}
                onClick={() => void handleStartSkillCreator()}
              >
                <Plus size={14} />
                <span className="ep-btn-label">{creatingSkill ? "创建中…" : "添加技能"}</span>
              </button>
            </>
          )}

          {activeTab === "connector" && (
            <>
              <div className="ep-search-wrapper">
                <Search size={14} className="ep-search-icon" />
                <input
                  type="search"
                  placeholder="搜索连接器"
                  aria-label="搜索连接器"
                  value={searchQuery}
                  onChange={(event) => setSearchQuery(event.target.value)}
                  className="ep-search-input"
                />
              </div>
              <button
                className="ep-btn ep-btn-primary"
                aria-label="自定义连接器"
                title="自定义连接器"
                onClick={handleOpenMcpModal}
              >
                <Plus size={14} />
                <span className="ep-btn-label">自定义连接器</span>
              </button>
            </>
          )}
        </div>
      </div>

      {connectorNotice && !connectorNotice.dismissed && (
        <div className="connector-install-notice" role="status" aria-live="polite">
          <ConnectorActionLoader
            size={20}
            label={connectorNotice.kind === "authorize"
              ? "正在等待连接器授权"
              : "正在安装连接器"}
          />
          <span>
            {connectorNotice.kind === "authorize"
              ? "连接器依赖已安装，请在浏览器中完成授权…"
              : "首次使用或更新需要安装连接器依赖，正在安装中，请稍后…"}
          </span>
          <button
            type="button"
            aria-label="关闭安装提示"
            onClick={() => setConnectorNotice((current) =>
              current ? { ...current, dismissed: true } : current
            )}
          >
            <X size={16} />
          </button>
        </div>
      )}

      {/* ── 主内容区 ── */}
      <div className="ep-body scrollable">
        {/* ==================== 专家 TAB ==================== */}
        {activeTab === "expert" && !showInstalledExperts && (
          <div className="ep-tab-pane animate-fade-in">
            <SkillHubCatalogChrome
              categories={categories}
              selected={selectedSubCategory}
              onSelect={setSelectedSubCategory}
              loading={skillHubLoading}
              error={skillHubError}
              itemCount={skillHubExperts.length}
              itemLabel="专家"
              onRetry={() => void loadSkillHubExperts()}
            />
            {expertStartError && <div className="ep-expert-error" role="alert">{expertStartError}</div>}
            <div className="ep-grid expert-grid ep-installed-expert-grid expert-market-grid">
              {filteredSkillHubExperts.map((expert) => {
                const identity = skillHubIdentity(expert);
                const displayName = expert.displayName || expert.slug;
                return (
                  <article
                    key={identity}
                    className="ep-card expert-card installed-expert-card expert-market-card"
                    role="button"
                    tabIndex={0}
                    aria-label={`查看${displayName}详情`}
                    onClick={() => void handleViewSkillHubExpert(expert)}
                    onKeyDown={(event) => {
                      if (event.target !== event.currentTarget) return;
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        void handleViewSkillHubExpert(expert, event.currentTarget);
                      }
                    }}
                  >
                    <div className="expert-card-top">
                      <div className="expert-card-left">
                        <div className="expert-avatar expert-market-avatar" style={getAvatarStyle(identity)}>
                          {displayName.charAt(0) || "专"}
                        </div>
                        <div className="expert-name-group">
                          <div className="expert-name-row">
                            <span className="expert-name">{displayName}</span>
                          </div>
                          <div className="expert-nickname">
                            {skillHubNamespaceDisplayName(expert.namespace, skillHubNamespaces)}
                          </div>
                        </div>
                      </div>
                      <button
                        type="button"
                        className="expert-market-summon"
                        disabled={summoningSkillHubExpertId !== null || !skillHubInstallVersion(expert)}
                        onClick={(event) => {
                          event.stopPropagation();
                          void handleSummonSkillHubExpert(expert);
                        }}
                      >
                        {summoningSkillHubExpertId === identity ? "召唤中…" : "召唤"}
                      </button>
                    </div>
                    <div className="expert-desc">{expert.summary}</div>
                  </article>
                );
              })}
            </div>
            {!skillHubLoading && !skillHubError && !skillHubAuthChecking && !skillHubAuthError && filteredSkillHubExperts.length === 0 && (
              <div className="ep-empty-view">暂无匹配的专家</div>
            )}
          </div>
        )}
        {activeTab === "expert" && showInstalledExperts && (
          <div className="ep-tab-pane ep-my-experts-pane">
            <div className="ep-my-experts-heading">
              <div>
                <h1>我的专家</h1>
                <p>管理已安装的个人专家</p>
              </div>
              <button
                type="button"
                className="ep-refresh-installed"
                disabled={installedExpertsLoading}
                onClick={() => void loadInstalledExperts()}
              >
                <RefreshCw
                  size={14}
                  className={installedExpertsLoading ? "is-spinning" : ""}
                />
                刷新
              </button>
            </div>

            {expertStartError && (
              <div className="ep-expert-error" role="alert">
                {expertStartError}
              </div>
            )}
            {installedExpertsError && (
              <div className="ep-expert-error" role="alert">
                {installedExpertsError}
              </div>
            )}
            <div className="ep-grid expert-grid ep-installed-expert-grid">
              {filteredInstalledExperts.map((exp) => {
                const visibleTags = (exp.tags ?? []).filter((tag) =>
                  tag.trim() !== "我的专家"
                );
                return (
                <article
                  key={exp.id}
                  className={`ep-card hub-card installed-expert-card${
                    openExpertMenuId === exp.id ? " is-menu-open" : ""
                  }`}
                  role="button"
                  tabIndex={0}
                  aria-label={`查看${exp.name}详情`}
                  onClick={(event) => {
                    void handleViewExpert(exp, event.currentTarget);
                  }}
                  onKeyDown={(event) => {
                    if (event.target !== event.currentTarget) return;
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      void handleViewExpert(exp, event.currentTarget);
                    }
                  }}
                >
                  <div className="hub-card-top">
                    <div className="skill-hub-heading">
                      <div
                        className="expert-avatar skill-hub-avatar"
                        style={exp.icon ? {} : getAvatarStyle(exp.id)}
                      >
                        {exp.icon
                          ? (
                            <img
                              src={exp.icon}
                              alt={exp.name}
                              style={{
                                width: "100%",
                                height: "100%",
                                borderRadius: "50%",
                                objectFit: "cover",
                              }}
                            />
                          )
                          : (
                            exp.name ? exp.name.charAt(0) : "专"
                          )}
                      </div>
                      <div className="skill-title-row">
                        <span className="skill-title">{exp.name}</span>
                        {exp.nickname && (
                          <div className="expert-nickname">{exp.nickname}</div>
                        )}
                      </div>
                    </div>
                    <div
                      className="expert-card-actions"
                      ref={openExpertMenuId === exp.id ? expertMenuRef : undefined}
                      onClick={(event) => event.stopPropagation()}
                    >
                      <button
                        type="button"
                        className="personal-expert-summon"
                        disabled={pendingExpertId !== null || pendingExpertOperationId !== null || !exp.available}
                        onClick={() => void handleStartExpertChat(exp.id, exp.name)}
                      >
                        {pendingExpertId === exp.id ? "打开中…" : "召唤"}
                      </button>
                      <button
                        type="button"
                        className="personal-expert-edit"
                        aria-label={`编辑${exp.name}`}
                        disabled={pendingExpertOperationId !== null}
                        onClick={() => void handleStartExpertEdit(exp)}
                      >
                        <Pencil size={15} />
                      </button>
                      <button
                        type="button"
                        className="expert-menu-trigger"
                        aria-label={`打开${exp.name}操作菜单`}
                        aria-haspopup="menu"
                        aria-expanded={openExpertMenuId === exp.id}
                        disabled={pendingExpertOperationId !== null}
                        ref={(element) => {
                          expertMenuButtonRefs.current[exp.id] = element;
                        }}
                        onClick={(event) => {
                          event.stopPropagation();
                          setOpenExpertMenuId((current) =>
                            current === exp.id ? null : exp.id,
                          );
                        }}
                      >
                        <MoreHorizontal size={17} />
                      </button>
                      {openExpertMenuId === exp.id && (
                        <div className="expert-card-menu" role="menu">
                          <button
                            type="button"
                            role="menuitem"
                            onClick={(event) => {
                              event.stopPropagation();
                              void handleViewExpert(exp);
                            }}
                          >
                            <Eye size={14} />
                            <span>查看专家</span>
                          </button>
                          <button
                            type="button"
                            role="menuitem"
                            disabled={pendingExpertOperationId !== null}
                            onClick={(event) => {
                              event.stopPropagation();
                              void handleOpenExpertFolder(exp);
                            }}
                          >
                            <Folder size={14} />
                            <span>打开文件夹</span>
                          </button>
                          <button
                            type="button"
                            role="menuitem"
                            className="expert-card-menu-danger"
                            disabled={pendingExpertOperationId !== null}
                            onClick={(event) => {
                              event.stopPropagation();
                              void handleUninstallExpert(exp);
                            }}
                          >
                            <Trash2 size={14} />
                            <span>卸载专家</span>
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                  <div className="skill-desc">{exp.description}</div>
                  {visibleTags.length > 0 && (
                    <div className="hub-card-bottom">
                      <span className="category-tag">{visibleTags[0]}</span>
                    </div>
                  )}
                </article>
                );
              })}
            </div>
            {!installedExpertsLoading && filteredInstalledExperts.length === 0 &&
              searchQuery.trim() && (
              <div className="ep-installed-search-empty">
                没有找到匹配“{searchQuery.trim()}”的专家
              </div>
            )}
          </div>
        )}

        {/* ==================== 技能 TAB ==================== */}
        {activeTab === "skill" && (
          <div className="ep-tab-pane animate-fade-in">
            {skillCreatorError && (
              <div className="ep-expert-error" role="alert">
                {skillCreatorError}
              </div>
            )}
            {!installedOnly
              ? (
                <>
                  <SkillHubCatalogChrome
                    categories={categories}
                    selected={selectedSubCategory}
                    onSelect={setSelectedSubCategory}
                    loading={skillHubLoading}
                    error={skillHubError}
                    itemCount={skillHubSkills.length}
                    itemLabel="技能"
                    onRetry={() => void loadSkillHubSkills()}
                  />

                  {!skillHubLoading && !skillHubError && !skillHubAuthChecking && !skillHubAuthError &&
                    skillHubSkills.length === 0 && (
                    <div className="ep-empty-view">SkillHub 暂无可用技能</div>
                  )}

                  <div className="ep-grid skill-hub-grid">
                    {filteredSkillHubSkills.map((skill) => {
                      const identity = skillHubIdentity(skill);
                      const installedName = installedSkillHubNames[identity];
                      const installed = isSkillHubInstalled(
                        skill,
                        skills.map((item) => item.name),
                        installedName,
                      );
                      const installedSkill = skills.find((item) =>
                        [installedName, skill.slug]
                          .filter(Boolean)
                          .some((name) =>
                            item.name.toLocaleLowerCase() ===
                              name!.toLocaleLowerCase()
                          )
                      );
                      const enabled = installedSkill
                        ? !installedSkill.disabled
                        : false;
                      const installing = installingSkillHubIds.includes(identity);
                      const version = skillHubInstallVersion(skill);
                      return (
                        <div
                          key={identity}
                          className={`ep-card hub-card skill-hub-card ${
                            installed ? "installed" : ""
                          }`}
                          role="button"
                          tabIndex={0}
                          aria-label={`查看${skill.displayName || skill.slug}详情`}
                          onClick={(event) => {
                            handleViewSkillHubSkill(skill, event.currentTarget);
                          }}
                          onKeyDown={(event) => {
                            if (event.target !== event.currentTarget) return;
                            if (event.key === "Enter" || event.key === " ") {
                              event.preventDefault();
                              handleViewSkillHubSkill(skill, event.currentTarget);
                            }
                          }}
                        >
                          <div className="hub-card-top">
                            <div className="skill-hub-heading">
                              <div
                                className="expert-avatar skill-hub-avatar"
                                style={getAvatarStyle(identity)}
                              >
                                {(skill.displayName || skill.slug).charAt(0) || "技"}
                              </div>
                              <div className="skill-title-row">
                                <span className="skill-title">
                                  {skill.displayName || skill.slug}
                                </span>
                                {installed && (
                                  <span
                                    className={`status-tag ${
                                      enabled ? "enabled" : "disabled"
                                    }`}
                                  >
                                    {enabled ? "已启用" : "已禁用"}
                                  </span>
                                )}
                              </div>
                            </div>
                            <button
                              type="button"
                              className={`install-icon-btn ${
                                installed ? "installed" : ""
                              }`}
                              disabled={installed || installing || !version}
                              onClick={(event) => {
                                event.stopPropagation();
                                void handleInstallSkillHub(skill);
                              }}
                              title={installedSkill?.builtin
                                ? "内置技能由系统管理"
                                : installed
                                ? "已安装，可在“我安装的”中管理"
                                : installing
                                ? "正在安装"
                                : version
                                ? "点击安装"
                                : "暂无可安装版本"}
                            >
                              {installing
                                ? <RefreshCw className="is-spinning" size={14} />
                                : installed
                                ? <Check size={14} />
                                : <Plus size={14} />}
                            </button>
                          </div>
                          <div className="skill-desc">{skill.summary}</div>
                          <div className="hub-card-bottom">
                            <span className="category-tag">
                              {skillHubNamespaceDisplayName(
                                skill.namespace,
                                skillHubNamespaces,
                              )}
                            </span>
                          </div>
                        </div>
                      );
                    })}
                    {skillHubSkills.length > 0 &&
                      filteredSkillHubSkills.length === 0 && (
                      <div className="ep-empty-view">暂无匹配的技能套件</div>
                    )}
                  </div>
                </>
              )
              : (
                <>
                  {/* ── 我安装的技能管理 ── */}
                  <div className="ep-section-header">
                    <span className="ep-section-title">我安装的管理控制台</span>
                  </div>
                  <div className="ep-grid installed-list">
                    {filteredInstalledSkills.map((skillMeta) => {
                      return (
                        <div
                          key={skillMeta.name}
                          className={`installed-item ${
                            skillMeta.disabled ? "disabled-item" : ""
                          }`}
                          role="button"
                          tabIndex={0}
                          aria-label={`查看${skillMeta.displayName || skillMeta.name}详情`}
                          onClick={(event) => {
                            handleViewLocalSkill(skillMeta, event.currentTarget);
                          }}
                          onKeyDown={(event) => {
                            if (event.target !== event.currentTarget) return;
                            if (event.key === "Enter" || event.key === " ") {
                              event.preventDefault();
                              handleViewLocalSkill(skillMeta, event.currentTarget);
                            }
                          }}
                        >
                          <div className="installed-item-main">
                            <div className="installed-item-title-row">
                              <span className="installed-item-title">
                                {skillMeta.displayName || skillMeta.name}
                              </span>
                              {/* 技能名称 */}
                              {/* <span className="installed-item-tag">
                                {skillMeta.name}
                              </span> */}
                              {skillMeta.builtin && (
                                <span className="builtin-tag">内置</span>
                              )}
                            </div>
                            <div className="installed-item-desc">
                              {skillMeta.description || "无描述"}
                            </div>
                          </div>

                          <div
                            className="installed-item-actions"
                            onClick={(event) => event.stopPropagation()}
                          >
                            {/* 启用/禁用 开关 */}
                            <label
                              className="switch"
                              title={skillMeta.builtin
                                ? "内置技能由系统管理"
                                : skillMeta.disabled
                                ? "已禁用，点击启用"
                                : "已启用，点击禁用"}
                            >
                              <input
                                type="checkbox"
                                checked={!skillMeta.disabled}
                                disabled={skillMeta.builtin}
                                onChange={() =>
                                  toggleSkill(
                                    skillMeta.name,
                                    !skillMeta.disabled,
                                  )}
                              />
                              <span className="slider round"></span>
                            </label>

                            {/* 编辑（仅自定义技能；内置技能不提供编辑入口） */}
                            {!skillMeta.builtin && (
                              <button
                                className="ep-action-icon-btn"
                                title="编辑技能（会话重写）"
                                disabled={pendingSkillOperationId !== null}
                                onClick={() => handleStartSkillEdit(skillMeta)}
                              >
                                <Edit size={14} />
                              </button>
                            )}

                            {/* 删除 (仅非内置技能) */}
                            {!skillMeta.builtin && (
                                <button
                                  className="ep-action-icon-btn ep-action-danger"
                                  title="删除技能"
                                  onClick={async () => {
                                    if (
                                      await requestUiConfirm({
                                        title: "删除技能",
                                        message: `确认删除技能「${
                                          skillMeta.displayName ||
                                          skillMeta.name
                                        }」？`,
                                        confirmLabel: "确认删除",
                                        tone: "danger",
                                      })
                                    ) {
                                      deleteSkill(skillMeta.name);
                                    }
                                  }}
                                >
                                  <Trash2 size={14} />
                                </button>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                    {filteredInstalledSkills.length === 0 && (
                      <div className="ep-empty-view">
                        暂无安装的自定义技能，请从上面安装或点击添加。
                      </div>
                    )}
                </>
              )}
          </div>
        )}

        {/* ==================== 连接器 (MCP) TAB ==================== */}
        {activeTab === "connector" && (
          <div className="ep-tab-pane connector-pane animate-fade-in">
            <div className="ep-grid connector-grid">
              <FigmaConnectorCard query={searchQuery} />
              <BuiltinNpmMcpCard id="gitlab" query={searchQuery} />
              <BuiltinNpmMcpCard id="jenkins" query={searchQuery} />
              {filteredConnectorItems.map((item) => {
                const running = !!runningConnectorOps[item.id];
                const control = running
                  ? { kind: "busy" as const }
                  : cardControlFor(item);
                const ready = item.state === "ready";
                const controlLabel = control.kind === "install"
                  ? "安装连接器"
                  : control.kind === "reauthorize"
                  ? "重新授权连接器"
                  : control.kind === "repair"
                  ? "修复连接器"
                  : control.kind === "conversation"
                  ? "使用此连接器新建任务"
                  : "正在处理连接器";
                return <ConnectorCard key={item.id} name={item.displayName} icon={<img src={item.icon} alt="" />} description={item.description} status={ready ? '已连接，可在会话中使用' : control.kind === 'reauthorize' ? '授权已过期' : control.kind === 'repair' ? '连接需要修复' : running ? '正在处理…' : '未连接'} actionLabel={controlLabel} busy={control.kind === 'busy'} closeOnAction={control.kind === 'conversation'} onAction={() => {
                  if (control.kind === 'conversation') { handleOpenConnectorConversation(item); return; }
                  if ('action' in control) void handleConnectorAction(item, control.action);
                }} />;
              })}
              {filteredConnectorItems.length === 0 && !["tapd 管理需求任务缺陷迭代", "figma desktop 设计 原型 交互 组件 桌面", "gitlab", "jenkins"].some(label => label.includes(searchQuery.trim().toLowerCase())) && (
                <div className="ep-empty-view">
                  {connectorItems.length === 0
                    ? connectorLoadErrorLabel(connectorErrorCode, connectorError) ?? "暂无可用连接器"
                    : "没有匹配的连接器"}
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {detailExpert && (
        <div
          className="ep-expert-detail-overlay"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) closeExpertDetail();
          }}
        >
          <section
            className="ep-expert-detail-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="ep-expert-detail-title"
            aria-describedby="ep-expert-detail-description"
          >
            <button
              type="button"
              className="ep-expert-detail-close"
              aria-label="关闭专家详情"
              ref={detailCloseRef}
              onClick={closeExpertDetail}
            >
              <X size={18} />
            </button>
            <div className="ep-expert-detail-hero">
              <div
                className="ep-expert-detail-avatar expert-avatar"
                style={detailExpert.icon ? {} : getAvatarStyle(detailExpert.id)}
              >
                {detailExpert.icon
                  ? (
                    <img
                      src={detailExpert.icon}
                      alt={detailExpert.name}
                    />
                  )
                  : detailExpert.name.charAt(0) || "专"}
              </div>
              <div className="ep-expert-detail-heading">
                <span className="ep-expert-detail-kicker">
                  {detailExpert.categoryId || "个人专家"}
                </span>
                <h2 id="ep-expert-detail-title">{detailExpert.name}</h2>
                {detailExpert.nickname && (
                  <p>{detailExpert.nickname}</p>
                )}
              </div>
              <button
                type="button"
                className="ep-expert-detail-invoke"
                disabled={
                  detailLoading ||
                  !detailExpert.available ||
                  pendingExpertOperationId !== null
                }
                onClick={() => void handleStartExpertFromDetail()}
              >
                {pendingExpertId === detailExpert.id ? "打开中…" : "召唤专家"}
              </button>
            </div>

            {detailLoading && (
              <div className="ep-expert-detail-loading" aria-live="polite">
                正在加载详情…
              </div>
            )}
            {detailError && (
              <div className="ep-expert-detail-error" role="alert">
                {detailError}
              </div>
            )}
            <p
              id="ep-expert-detail-description"
              className="ep-expert-detail-description"
            >
              {detailExpert.description || "暂无专家介绍"}
            </p>

            {detailExpert.tags.length > 0 && (
              <div className="ep-expert-detail-tags" aria-label="专家标签">
                {detailExpert.tags.slice(0, 3).map((tag) => (
                  <span key={tag} className="expert-tag-pill">{tag}</span>
                ))}
              </div>
            )}

            <div className="ep-expert-detail-prompts">
              <div className="ep-expert-detail-section-title">专家帮你做</div>
              {detailExpert.quickPrompts.filter((prompt) => prompt.trim()).slice(
                0,
                3,
              ).map((prompt) => (
                <button
                  type="button"
                  className="ep-expert-detail-prompt"
                  key={prompt}
                  disabled={
                    detailLoading ||
                    !detailExpert.available ||
                    pendingExpertOperationId !== null
                  }
                  onClick={() => void handleStartExpertFromDetail(prompt)}
                >
                  <span>{prompt}</span>
                  <span aria-hidden="true">↗</span>
                </button>
              ))}
              {!detailExpert.quickPrompts.some((prompt) => prompt.trim()) && (
                <p className="ep-expert-detail-empty-prompt">
                  召唤专家后，将使用专家介绍作为首次输入提示。
                </p>
              )}
            </div>
          </section>
        </div>
      )}

      {marketDetailExpert && (
        <div
          className="ep-expert-detail-overlay ep-market-detail-overlay"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) closeMarketExpertDetail();
          }}
        >
          <section
            className="ep-expert-detail-dialog ep-market-detail-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="ep-market-detail-title"
            aria-describedby="ep-market-detail-description"
          >
            <div className="ep-market-detail-header">
              <div
                className="ep-market-detail-avatar expert-avatar"
                style={getAvatarStyle(skillHubIdentity(marketDetailExpert))}
              >
                <span className="ep-market-detail-avatar-letter">
                  {marketDetailExpert.displayName.charAt(0) || "专"}
                </span>
              </div>
              <div className="ep-market-detail-heading">
                <div className="ep-market-detail-title-row">
                  <h2 id="ep-market-detail-title">{marketDetailExpert.displayName}</h2>
                  {marketDetailExpert.ownerDisplayName && (
                    <span>{marketDetailExpert.ownerDisplayName}</span>
                  )}
                </div>
                <button
                  type="button"
                  className="ep-market-detail-invoke"
                  disabled={summoningSkillHubExpertId !== null || !skillHubInstallVersion(marketDetailExpert)}
                  onClick={() => void handleSummonSkillHubExpert(marketDetailExpert)}
                >
                  <Send size={14} />
                  {summoningSkillHubExpertId === skillHubIdentity(marketDetailExpert) ? "召唤中…" : "召唤专家"}
                </button>
              </div>
              <div className="ep-market-detail-meta">
                <div className="ep-market-detail-usage">
                  {marketDetailExpert.downloadCount.toLocaleString("zh-CN")}次使用
                </div>
                <button
                  type="button"
                  className="ep-expert-detail-close"
                  aria-label="关闭专家详情"
                  ref={marketDetailCloseRef}
                  onClick={closeMarketExpertDetail}
                >
                  <X size={16} />
                </button>
              </div>
            </div>

            {marketDetailLoading && (
              <div className="ep-expert-detail-loading" aria-live="polite">正在加载详情…</div>
            )}
            {marketDetailError && (
              <div className="ep-expert-detail-error" role="alert">{marketDetailError}</div>
            )}

            <p id="ep-market-detail-description" className="ep-market-detail-description">
              {marketDetailExpert.summary || "暂无专家介绍"}
            </p>

            {marketDetailExpert.tags.length > 0 && (
              <div className="ep-market-detail-tags" aria-label="专家标签">
                {marketDetailExpert.tags.slice(0, 6).map((tag) => (
                  <span key={tag}>{tag}</span>
                ))}
              </div>
            )}

            <div className="ep-market-detail-prompts">
              <div className="ep-market-detail-section-title">
                <span aria-hidden="true">💡</span> 专家帮你做
              </div>
              {marketDetailExpert.quickPrompts.slice(0, 3).map((prompt) => (
                <button
                  type="button"
                  className="ep-market-detail-prompt"
                  key={prompt}
                  disabled={summoningSkillHubExpertId !== null || !skillHubInstallVersion(marketDetailExpert)}
                  onClick={() => void handleSummonSkillHubExpert(marketDetailExpert, prompt)}
                >
                  <span>“{prompt}”</span>
                  <MessageCircle size={16} aria-hidden="true" />
                </button>
              ))}
              {!marketDetailLoading && marketDetailExpert.quickPrompts.length === 0 && (
                <p className="ep-expert-detail-empty-prompt">暂无快捷提问，召唤后可直接与专家对话。</p>
              )}
            </div>
          </section>
        </div>
      )}

      {skillDetail && (() => {
        const hubSkill = skillDetail.kind === "hub" ? skillDetail.skill : null;
        const localSkill = skillDetail.kind === "local"
          ? skills.find((item) => item.name === skillDetail.skill.name) ??
            skillDetail.skill
          : null;
        const hubIdentity = hubSkill ? skillHubIdentity(hubSkill) : "";
        const hubInstalled = hubSkill
          ? isSkillHubInstalled(
            hubSkill,
            skills.map((item) => item.name),
            installedSkillHubNames[hubIdentity],
          )
          : false;
        const hubInstalling = hubSkill
          ? installingSkillHubIds.includes(hubIdentity)
          : false;
        const hubVersion = hubSkill ? skillHubInstallVersion(hubSkill) : null;
        const localVersion = localSkill
          ? resolveLocalSkillVersion(
            localSkill,
            skillHubSkills,
            installedSkillHubNames,
          )
          : null;
        const title = hubSkill
          ? hubSkill.displayName || hubSkill.slug
          : localSkill?.displayName || localSkill?.name || "技能";
        const description = hubSkill
          ? hubSkill.summary || "暂无技能介绍"
          : localSkill?.description || "无描述";
        const avatarId = hubIdentity || localSkill?.name || title;
        return (
          <div
            className="ep-expert-detail-overlay ep-market-detail-overlay"
            onMouseDown={(event) => {
              if (event.target === event.currentTarget) closeSkillDetail();
            }}
          >
            <section
              className="ep-expert-detail-dialog ep-market-detail-dialog ep-skill-detail-dialog"
              role="dialog"
              aria-modal="true"
              aria-labelledby="ep-skill-detail-title"
              aria-describedby="ep-skill-detail-description"
            >
              <div className="ep-market-detail-header">
                <div
                  className="ep-market-detail-avatar expert-avatar"
                  style={getAvatarStyle(avatarId)}
                >
                  <span className="ep-market-detail-avatar-letter">
                    {title.charAt(0) || "技"}
                  </span>
                </div>
                <div className="ep-market-detail-heading">
                  <div className="ep-market-detail-title-row">
                    <h2 id="ep-skill-detail-title">{title}</h2>
                    {localSkill?.builtin && <span>内置</span>}
                  </div>
                  {hubSkill
                    ? (
                      <button
                        type="button"
                        className="ep-market-detail-invoke"
                        disabled={hubInstalled || hubInstalling || !hubVersion}
                        onClick={() => void handleInstallSkillHub(hubSkill)}
                      >
                        {hubInstalling
                          ? "安装中…"
                          : hubInstalled
                          ? "已安装"
                          : "安装技能"}
                      </button>
                    )
                    : localSkill && !localSkill.builtin
                    ? (
                      <button
                        type="button"
                        className="ep-market-detail-invoke"
                        disabled={pendingSkillOperationId !== null}
                        onClick={() => {
                          closeSkillDetail();
                          handleStartSkillEdit(localSkill);
                        }}
                      >
                        编辑技能
                      </button>
                    )
                    : <span className="ep-skill-detail-builtin-note">系统内置技能</span>}
                </div>
                <div className="ep-market-detail-meta">
                  <div className="ep-market-detail-usage">
                    版本 {skillVersionLabel(hubSkill ? hubVersion : localVersion)}
                  </div>
                  <button
                    type="button"
                    className="ep-expert-detail-close"
                    aria-label="关闭技能详情"
                    ref={skillDetailCloseRef}
                    onClick={closeSkillDetail}
                  >
                    <X size={16} />
                  </button>
                </div>
              </div>

              <p
                id="ep-skill-detail-description"
                className="ep-market-detail-description"
              >
                {description}
              </p>

              <div className="ep-skill-detail-footer">
                <div className="ep-market-detail-tags" aria-label="技能信息">
                  {hubSkill && (
                    <span>
                      {skillHubNamespaceDisplayName(
                        hubSkill.namespace,
                        skillHubNamespaces,
                      )}
                    </span>
                  )}
                  {hubSkill && (
                    <span>
                      {hubSkill.downloadCount.toLocaleString("zh-CN")}次使用
                    </span>
                  )}
                  {localSkill && <span>{localSkill.name}</span>}
                </div>
                {localSkill && (
                  <label
                    className="switch"
                    title={localSkill.builtin
                      ? "内置技能由系统管理"
                      : localSkill.disabled
                      ? "已禁用，点击启用"
                      : "已启用，点击禁用"}
                  >
                    <input
                      type="checkbox"
                      checked={!localSkill.disabled}
                      disabled={localSkill.builtin}
                      onChange={() =>
                        void toggleSkill(
                          localSkill.name,
                          !localSkill.disabled,
                        )}
                    />
                    <span className="slider round"></span>
                  </label>
                )}
              </div>
            </section>
          </div>
        );
      })()}

      {/* ── 技能添加模态框 ── */}
      {modalOpen && (
        <div className="ep-modal-overlay">
          <div className="ep-modal">
            <div className="ep-modal-header">
              <h3>添加自定义技能</h3>
              <button
                className="ep-modal-close"
                onClick={() => setModalOpen(false)}
              >
                <X size={18} />
              </button>
            </div>
            <form onSubmit={handleSaveForm} className="ep-modal-body">
              <div className="form-group">
                <label>技能唯一标识 (Alphanumeric/唯一)</label>
                <input
                  type="text"
                  required
                  placeholder="例如: translation-helper"
                  value={formName}
                  onChange={(e) => setFormName(e.target.value)}
                  className="form-control"
                />
              </div>

              <div className="form-group">
                <label>技能触发名称 (Agent Skills name)</label>
                <input
                  type="text"
                  required
                  placeholder="例如: translation-helper"
                  value={formDisplayName}
                  onChange={(e) => setFormDisplayName(e.target.value)}
                  className="form-control"
                />
              </div>

              <div className="form-group">
                <label>描述</label>
                <input
                  type="text"
                  placeholder="简述该技能在什么情况下会被激活..."
                  value={formDesc}
                  onChange={(e) => setFormDesc(e.target.value)}
                  className="form-control"
                />
              </div>

              <div className="form-group flex-fill-grow">
                <label>技能提示词正文 (Markdown 格式)</label>
                <textarea
                  required
                  placeholder="# 技能指令要求\n在此写下技能的详细运作规范..."
                  value={formBody}
                  onChange={(e) => setFormBody(e.target.value)}
                  className="form-control textarea-body"
                />
              </div>

              <div className="ep-modal-footer">
                <button
                  type="button"
                  className="ep-btn ep-btn-secondary"
                  onClick={() => setModalOpen(false)}
                >
                  取消
                </button>
                <button type="submit" className="ep-btn ep-btn-primary">
                  保存
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── MCP 服务管理模态框 ── */}
      {mcpModalOpen && (
        <div className="ep-modal-overlay">
          <div className="ep-modal mcp-modal">
            <div className="ep-modal-header">
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <Puzzle size={18} />
                <h3>手动添加的连接器</h3>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <button
                  className="ep-btn ep-btn-secondary"
                  onClick={handleToggleMcpConfigMode}
                >
                  配置 MCP
                </button>
                <button
                  className="ep-modal-close"
                  onClick={() => setMcpModalOpen(false)}
                >
                  <X size={18} />
                </button>
              </div>
            </div>

            {isEditingMcpConfig
              ? (
                /* JSON 代码编辑视图 */
                <div className="ep-modal-body mcp-editor-body">
                  <div className="mcp-config-path-label">
                    这里只编辑手动添加的 MCP 配置，内置连接器由系统管理。
                  </div>
                  {mcpErrorAlert && (
                    <div className="mcp-error-alert">
                      {mcpErrorAlert}
                    </div>
                  )}
                  <textarea
                    className="form-control mcp-json-textarea"
                    value={mcpConfigText}
                    onChange={(e) => {
                      setMcpConfigText(e.target.value);
                      setMcpErrorAlert(null);
                    }}
                    placeholder="请输入 JSON 配置..."
                  />
                  <div className="ep-modal-footer">
                    <button
                      className="ep-btn ep-btn-secondary"
                      onClick={() => setIsEditingMcpConfig(false)}
                    >
                      取消
                    </button>
                    <button
                      className="ep-btn ep-btn-primary"
                      onClick={handleSaveMcpConfigText}
                    >
                      保存
                    </button>
                  </div>
                </div>
              )
              : (
                /* 服务器列表视图 */
                <div className="ep-modal-body mcp-list-body">
                  <div className="mcp-list-controls">
                    <div className="ep-search-wrapper" style={{ flex: 1 }}>
                      <Search size={14} className="ep-search-icon" />
                      <input
                        type="text"
                        placeholder="搜索服务器..."
                        value={mcpSearchQuery}
                        onChange={(e) => setMcpSearchQuery(e.target.value)}
                        className="ep-search-input"
                        style={{ width: "100%" }}
                      />
                    </div>
                    <button
                      className="ep-btn ep-btn-secondary"
                      onClick={() =>
                        window.open(
                          "https://github.com/modelcontextprotocol/servers",
                        )}
                    >
                      MCP Hub
                    </button>
                  </div>

                  <div className="mcp-servers-list scrollable">
                    {filteredMcpServers.length > 0
                      ? (
                        filteredMcpServers.map(([name, srv]) => {
                          const connInfo = mcpConnected.find((c) =>
                            (srv.id && c.id === srv.id) || c.name === name
                          );
                          const isConnected = !!connInfo;
                          const connectorIdentity = srv.id || name;
                          const connectionBusy = mcpBusyIds.includes(connectorIdentity);
                          const connectorEnabled = srv.enabled !== false && srv.disabled !== true;
                          const tools = connInfo?.tools || [];
                          return (
                            <div key={name} className="mcp-server-item">
                              <div className="mcp-server-item-header">
                                <div className="mcp-server-info-title">
                                  <span
                                    className={`mcp-status-indicator ${
                                      isConnected ? "connected" : "disconnected"
                                    }`}
                                  />
                                  <span className="mcp-server-name">
                                    {srv.displayName || name}
                                  </span>
                                  <span className="mcp-server-type-tag">
                                    {srv.command
                                      ? "stdio"
                                      : "sse"}
                                  </span>
                                </div>
                                {!srv.managedBy && (
                                  <button
                                    className="ep-action-icon-btn ep-action-danger"
                                    onClick={() => handleUninstallMcp(name)}
                                    title="删除服务器"
                                  >
                                    <Trash2 size={13} />
                                  </button>
                                )}
                              </div>

                              <div className="mcp-server-details">
                                {srv.url && !srv.command && !srv.managedBy && !srv.authProvider && !srv.auth && !srv.provider && !srv.authorizationConfigured && !Object.keys({ ...srv.staticHeaders, ...srv.headers }).some(key => key.toLowerCase() === "authorization") && <McpOAuthControls id={srv.id} name={name} onConnected={() => { void useSkillStore.getState().loadMcp(); }} />}

                                {srv.command && (
                                  <div className="mcp-detail-row">
                                    <span className="mcp-detail-label">
                                      命令:
                                    </span>
                                    <span className="mcp-detail-value">
                                      {srv.command} {srv.args?.join(" ")}
                                    </span>
                                  </div>
                                )}
                                {srv.url && (
                                  <div className="mcp-detail-row">
                                    <span className="mcp-detail-label">
                                      URL:
                                    </span>
                                    <span className="mcp-detail-value">
                                      {srv.url}
                                    </span>
                                  </div>
                                )}
                                <div className="mcp-detail-row">
                                  <span className="mcp-detail-label">连接状态:</span>
                                  <span className="mcp-detail-value">
                                    {connectionBusy
                                      ? isConnected ? "正在断开…" : "正在连接…"
                                      : isConnected ? "最近探测成功" : "未进行连接测试"}
                                  </span>
                                  <button
                                    type="button"
                                    className="ep-btn ep-btn-secondary"
                                    disabled={connectionBusy || !connectorEnabled}
                                    onClick={() => {
                                      void (async () => {
                                        try {
                                          if (isConnected) await disconnectMcp(connectorIdentity);
                                          else await connectMcp(connectorIdentity);
                                          await loadMcp();
                                        } catch (error) {
                                          await showUiAlert({
                                            title: isConnected ? "断开失败" : "连接测试失败",
                                            message: error instanceof Error ? error.message : "请稍后重试。",
                                            tone: "danger",
                                          });
                                        }
                                      })();
                                    }}
                                  >
                                    {connectionBusy
                                      ? isConnected ? "断开中…" : "连接中…"
                                      : isConnected ? "断开" : "测试连接"}
                                  </button>
                                </div>
                                <div className="mcp-detail-row">
                                  <span className="mcp-detail-label">
                                    工具数量:
                                  </span>
                                  <span className="mcp-detail-value">
                                    {tools.length} 个
                                  </span>
                                </div>
                                {tools.length > 0 && (
                                  <div className="mcp-tools-badges">
                                    {tools.map((t) => (
                                      <span
                                        key={t}
                                        className="mcp-tool-badge"
                                        title={t}
                                      >
                                        {t.replace(`mcp_${name}_`, "")}
                                      </span>
                                    ))}
                                  </div>
                                )}
                              </div>
                            </div>
                          );
                        })
                      )
                      : (
                        <div className="mcp-empty-state">
                          <Puzzle size={40} className="mcp-empty-icon" />
                          <div className="mcp-empty-text">暂无 MCP 服务器</div>
                          <div className="mcp-empty-subtext">
                            点击右上角配置按钮或连接器卡片一键添加
                          </div>
                          <button
                            className="ep-btn ep-btn-primary"
                            onClick={() => handleToggleMcpConfigMode()}
                          >
                            配置
                          </button>
                        </div>
                      )}
                  </div>
                </div>
              )}
          </div>
        </div>
      )}
      {summoningSkillHubExpertId && (
        <div className="expert-summon-overlay" role="status" aria-live="polite">
          <div className="expert-summon-dialog">
            <span className="expert-summon-spinner" aria-hidden="true" />
            <strong>正在召唤专家…</strong>
          </div>
        </div>
      )}
    </div>
  );
}
