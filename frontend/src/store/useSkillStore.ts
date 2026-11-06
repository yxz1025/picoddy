import { create } from "zustand";
import { ApiError, apiDelete, apiGet, apiPost, apiPut } from "../api/client";
import type { ExpertSummary } from "../types/experts";
import { useStore } from "./useStore";
import type { Conversation } from "./useStore";
import { presentActiveExpert } from "./expertConversationModel";
import { createExpertComposerBootstrap } from "../components/expertCreatorModel";
import {
  skillHubIdentity,
  skillHubInstallVersion,
  type SkillHubNamespace,
  type SkillHubSkill,
} from "../components/skillHubModel";
import type { ConnectorServiceItem } from "../components/connectorModel";

let clawHubRequestId = 0;

export interface SkillMeta {
  name: string; // 标识名
  displayName?: string; // 显示名
  description: string;
  body: string;
  disabled: boolean;
  builtin: boolean;
  path: string;
  version?: string;
}

/** Backwards-compatible export for existing expert panel imports. */
export type Expert = ExpertSummary;

interface ExpertAssignmentResponse {
  ok: true;
  binding: {
    expertId: string;
    revision: string;
    catalogSource: ExpertSummary["catalogSource"];
  };
  expert: Expert | null;
}

export interface McpServerConfig {
  enabled?: boolean;
  exposure?: "direct" | "deferred" | "codemode" | "hidden";
  toolExposure?: Record<string, "direct" | "deferred" | "codemode" | "hidden">;
  oauth?: Record<string, unknown>;
  auth?: { provider: string };
  staticHeaders?: Record<string, string>;
  headers?: Record<string, string>;
  authProvider?: string;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
  type?: "stdio" | "sse" | "http";
  disabled?: boolean;
  provider?: string;
  managedBy?: "builtin";
  displayName?: string;
  description?: string;
}

export interface McpConfig {
  mcpServers: Record<string, McpServerConfig>;
}

export interface McpConnectionInfo {
  name: string;
  displayName?: string;
  toolCount: number;
  tools: string[];
}

export class SkillCreatorNavigationError extends Error {
  readonly conversationId: string;

  constructor(
    conversationId: string,
    options?: ErrorOptions,
  ) {
    super(
      "技能创建会话已创建，但未能打开；可从侧栏恢复该会话",
      options,
    );
    this.name = "SkillCreatorNavigationError";
    this.conversationId = conversationId;
  }
}

export class ExpertCreatorNavigationError extends Error {
  readonly conversationId: string;

  constructor(conversationId: string, options?: ErrorOptions) {
    super("专家创建会话已创建，但未能打开；可从侧栏恢复该会话", options);
    this.name = "ExpertCreatorNavigationError";
    this.conversationId = conversationId;
  }
}

let skillCreatorChatPromise: Promise<string> | null = null;
let expertCreatorChatPromise: Promise<string> | null = null;

interface InstalledExpertsResponse {
  experts: Expert[];
  diagnostics: Array<{ code: string; source?: string; message: string }>;
  refreshed: boolean;
}

interface SkillState {
  skills: SkillMeta[];
  skillHubSkills: SkillHubSkill[];
  skillHubExperts: SkillHubSkill[];
  skillHubNamespaces: SkillHubNamespace[];
  skillHubLoading: boolean;
  skillHubError: string | null;
  skillHubAuthError: string | null;
  skillHubAuthChecking: boolean;
  installingSkillHubIds: string[];
  summoningSkillHubExpertId: string | null;
  installedSkillHubNames: Record<string, string>;
  experts: Expert[];
  expertsError: string | null;
  installedExperts: Expert[];
  installedExpertsError: string | null;
  installedExpertsLoading: boolean;
  loading: boolean;
  showInstalledSkills: boolean;
  mcpConfig: McpConfig | null;
  customMcpConfig: McpConfig | null;
  mcpConnected: McpConnectionInfo[];
  mcpEnterpriseError: string | null;
  connectorItems: ConnectorServiceItem[];
  connectorError: string | null;
  connectorErrorCode: string | null;

  loadSkills: () => Promise<boolean>;
  loadSkillHubSkills: (query?: string, cursor?: string) => Promise<void>;
  clawHubCursor: string | null;
  clawHubQuery: string;
  clawHubLoading: boolean;
  clawHubError: string | null;
  installSkillHubSkill: (skill: SkillHubSkill) => Promise<SkillMeta>;
  setShowInstalledSkills: (show: boolean) => void;
  saveSkill: (
    name: string,
    description: string,
    disabled: boolean,
    body: string,
    displayName?: string,
  ) => Promise<SkillMeta>;
  deleteSkill: (name: string) => Promise<void>;
  toggleSkill: (name: string, disabled: boolean) => Promise<void>;
  loadExperts: () => Promise<void>;
  loadInstalledExperts: () => Promise<void>;
  getExpert: (id: string) => Promise<Expert>;
  assignConversationExpert: (conversationId: string, expertId: string) => Promise<void>;
  clearConversationExpert: (conversationId: string) => Promise<void>;
  startExpertChat: (
    expertId: string,
    expertName: string,
    initialPrompt?: string,
  ) => Promise<void>;
  startExpertEdit: (expert: Expert) => Promise<string>;
  startSkillEdit: (skill: SkillMeta) => Promise<string>;
  openExpertFolder: (expertId: string) => Promise<void>;
  uninstallExpert: (
    expertId: string,
  ) => Promise<{ affectedConversationIds: string[] }>;
  startSkillCreatorChat: () => Promise<string>;
  startExpertCreatorChat: () => Promise<string>;
  loadMcp: () => Promise<void>;
  connectMcp: (serverName: string) => Promise<McpConnectionInfo>;
  saveMcp: (config: McpConfig) => Promise<boolean>;
  uninstallMcp: (serverName: string) => Promise<boolean>;
  loadConnectors: () => Promise<void>;
  activateConnector: (id: string) => Promise<void>;
  cancelConnector: (id: string) => Promise<void>;
  reauthorizeConnector: (id: string) => Promise<void>;
  logoutConnector: (id: string) => Promise<void>;
  uninstallConnector: (id: string) => Promise<void>;
  repairConnector: (id: string) => Promise<void>;
  updateConnector: (id: string) => Promise<void>;
}

export const useSkillStore = create<SkillState>((set, get) => ({
  skills: [],
  skillHubSkills: [],
  skillHubExperts: [],
  skillHubNamespaces: [],
  skillHubLoading: false,
  skillHubError: null,
  skillHubAuthError: null,
  skillHubAuthChecking: false,
  installingSkillHubIds: [],
  summoningSkillHubExpertId: null,
  installedSkillHubNames: {},
  experts: [],
  expertsError: null,
  installedExperts: [],
  installedExpertsError: null,
  installedExpertsLoading: false,
  loading: false,
  clawHubCursor: null,
  clawHubQuery: "",
  clawHubLoading: false,
  clawHubError: null,
  showInstalledSkills: false,
  mcpConfig: null,
  customMcpConfig: null,
  mcpConnected: [],
  mcpEnterpriseError: null,
  connectorItems: [],
  connectorError: null,
  connectorErrorCode: null,

  loadSkills: async () => {
    set({ loading: true });
    try {
      const list = await apiGet<SkillMeta[]>("/api/skills");
      set({ skills: list });
      return true;
    } catch (e) {
      console.error("[useSkillStore] 加载技能失败:", e);
      return false;
    } finally {
      set({ loading: false });
    }
  },

  loadSkillHubSkills: async (query = "", cursor = "") => {
    const q = query.trim();
    const requestId = ++clawHubRequestId;
    set({ clawHubLoading: true, clawHubError: null, clawHubQuery: q, ...(!cursor ? { skillHubSkills: [], clawHubCursor: null } : {}) });
    try {
      const page = await apiGet<{ items: SkillHubSkill[]; nextCursor: string | null }>(`/api/clawhub/skills?${new URLSearchParams({ q, cursor })}`);
      if (requestId !== clawHubRequestId) return;
      set(state => ({ skillHubSkills: cursor ? [...new Map([...state.skillHubSkills, ...page.items].map(skill => [skillHubIdentity(skill), skill])).values()] : page.items, clawHubCursor: page.nextCursor }));
    } catch (error) {
      if (requestId === clawHubRequestId) set({ clawHubError: error instanceof Error ? error.message : "ClawHub 技能列表加载失败" });
    } finally { if (requestId === clawHubRequestId) set({ clawHubLoading: false }); }
  },

  installSkillHubSkill: async (skill) => {
    const identity = skillHubIdentity(skill);
    const version = skillHubInstallVersion(skill);
    if (!version) throw new Error("暂无可安装版本");
    if (get().installingSkillHubIds.includes(identity)) {
      throw new Error("该技能正在安装");
    }
    set((state) => ({
      installingSkillHubIds: [...state.installingSkillHubIds, identity],
    }));
    try {
      const installed = await apiPost<SkillMeta>("/api/clawhub/install", {
        namespace: skill.namespace,
        slug: skill.slug,
        version,
      });
      set((state) => ({
        installedSkillHubNames: {
          ...state.installedSkillHubNames,
          [identity]: installed.name,
        },
      }));
      await get().loadSkills();
      return installed;
    } finally {
      set((state) => ({
        installingSkillHubIds: state.installingSkillHubIds.filter(
          (item) => item !== identity,
        ),
      }));
    }
  },

  setShowInstalledSkills: (showInstalledSkills) => {
    set({ showInstalledSkills });
  },

  saveSkill: async (name, description, disabled, body, displayName) => {
    // 检查是否已存在，决定是用 POST 还是 PUT
    const existing = get().skills.find((s) => s.name === name);
    let res: SkillMeta;
    if (existing) {
      res = await apiPut<SkillMeta>("/api/skills/" + name, {
        description,
        disabled,
        body,
        displayName,
      });
    } else {
      res = await apiPost<SkillMeta>("/api/skills", {
        name,
        description,
        disabled,
        body,
        displayName,
      });
    }
    await get().loadSkills();
    return res;
  },

  deleteSkill: async (name) => {
    await apiDelete("/api/skills/" + name);
    await get().loadSkills();
  },

  toggleSkill: async (name, disabled) => {
    const existing = get().skills.find((s) => s.name === name);
    if (!existing) return;
    await apiPut<SkillMeta>("/api/skills/" + name, {
      description: existing.description,
      disabled,
      body: existing.body,
      displayName: existing.displayName || existing.name,
    });
    await get().loadSkills();
  },

  loadExperts: async () => {
    try {
      const list = await apiGet<Expert[]>("/api/experts");
      set({ experts: list, expertsError: null });
    } catch (e) {
      console.error("[useSkillStore] 加载专家失败:", e);
      set({
        expertsError: e instanceof Error && e.message.trim()
          ? e.message
          : "专家列表加载失败，请重试",
      });
    }
  },

  loadInstalledExperts: async () => {
    set({ installedExpertsLoading: true });
    try {
      const result = await apiGet<InstalledExpertsResponse>(
        "/api/experts/installed",
      );
      const catalog = await apiGet<Expert[]>("/api/experts");
      const available = new Map([...catalog.filter(expert => expert.catalogSource === "builtin"), ...result.experts].map(expert => [expert.id, expert]));
      set({ installedExperts: [...available.values()], installedExpertsError: null });
    } catch (error) {
      console.error("[useSkillStore] 加载已安装专家失败:", error);
      set({
        installedExpertsError: error instanceof Error && error.message.trim()
          ? error.message
          : "已安装专家加载失败，请重试",
      });
    } finally {
      set({ installedExpertsLoading: false });
    }
  },

  getExpert: async (id) => {
    return await apiGet<Expert>(`/api/experts/${encodeURIComponent(id)}`);
  },

  assignConversationExpert: async (conversationId, expertId) => {
    await apiPut(`/api/conversations/${encodeURIComponent(conversationId)}/expert`, { expertId });
    await useStore.getState().loadConversations();
  },

  clearConversationExpert: async (conversationId) => {
    await apiDelete(`/api/conversations/${encodeURIComponent(conversationId)}/expert`);
    await useStore.getState().loadConversations();
  },

  startExpertChat: async (expertId, expertName, initialPrompt) => {
    const appStore = useStore.getState();
    const listedExpert = get().experts.find((expert) => expert.id === expertId);
    const expert = listedExpert ?? await get().getExpert(expertId);
    const workspaceId = appStore.composerWorkspaceId;
    const conversation = await apiPost<Conversation>("/api/conv", {
      title: `${expertName}会话`,
      workspaceId,
      modelProvider: appStore.modelProvider,
      modelId: appStore.modelId,
    });

    let assignment: ExpertAssignmentResponse;
    try {
      assignment = await apiPut<ExpertAssignmentResponse>(
        `/api/conversations/${encodeURIComponent(conversation.id)}/expert`,
        { expertId },
      );
    } catch (error) {
      try {
        await apiDelete(`/api/conv/${conversation.id}`);
      } catch (cleanupError) {
        console.error(
          "[useSkillStore] 清理未绑定的专家会话失败:",
          cleanupError,
        );
      }
      throw error;
    }
    const activeExpert = assignment.expert ?? expert;
    appStore.setComposerWorkspaceId(null);
    await appStore.loadConversations();
    useStore.setState((state) => ({
      conversations: presentActiveExpert(
        state.conversations,
        conversation,
        activeExpert,
        assignment.binding,
      ),
    }));
    useStore.setState({
      expertComposerBootstrap: createExpertComposerBootstrap(
        conversation.id,
        {
          text: initialPrompt?.trim() ||
            expert.quickPrompts.find((prompt) => prompt.trim()) ||
            expert.description,
          expertManagerToken: false,
        },
      ),
    });
    await appStore.selectConversation(conversation.id);
  },

  startSkillCreatorChat: () => {
    if (skillCreatorChatPromise) return skillCreatorChatPromise;

    const operation = (async () => {
      const workspaceId = useStore.getState().composerWorkspaceId;
      const conversation = await apiPost<Conversation>("/api/conv", {
        title: "创建技能",
        category: "skill_creator",
        workspaceId,
        modelProvider: useStore.getState().modelProvider,
        modelId: useStore.getState().modelId,
      });

      useStore.setState((state) => ({
        conversations: [
          conversation,
          ...state.conversations.filter((item) => item.id !== conversation.id),
        ],
      }));

      const appStore = useStore.getState();
      if (appStore.composerWorkspaceId === workspaceId) {
        appStore.setComposerWorkspaceId(null);
      }

      try {
        await appStore.selectConversation(conversation.id);
      } catch (cause) {
        throw new SkillCreatorNavigationError(
          conversation.id,
          { cause },
        );
      }

      await useStore.getState().loadConversations();
      return conversation.id;
    })();

    skillCreatorChatPromise = operation.finally(() => {
      skillCreatorChatPromise = null;
    });
    return skillCreatorChatPromise;
  },

  startExpertCreatorChat: () => {
    if (expertCreatorChatPromise) return expertCreatorChatPromise;

    const operation = (async () => {
      const workspaceId = useStore.getState().composerWorkspaceId;
      const conversation = await apiPost<Conversation>("/api/conv", {
        title: "创建专家",
        category: "expert_creator",
        expertOperation: "create",
        workspaceId,
        modelProvider: useStore.getState().modelProvider,
        modelId: useStore.getState().modelId,
      });

      useStore.setState((state) => ({
        conversations: [
          conversation,
          ...state.conversations.filter((item) => item.id !== conversation.id),
        ],
        expertComposerBootstrap: createExpertComposerBootstrap(conversation.id),
      }));

      const appStore = useStore.getState();
      if (appStore.composerWorkspaceId === workspaceId) {
        appStore.setComposerWorkspaceId(null);
      }
      try {
        await appStore.selectConversation(conversation.id);
      } catch (cause) {
        throw new ExpertCreatorNavigationError(conversation.id, { cause });
      }
      await useStore.getState().loadConversations();
      return conversation.id;
    })();

    expertCreatorChatPromise = operation.finally(() => {
      expertCreatorChatPromise = null;
    });
    return expertCreatorChatPromise;
  },

  startExpertEdit: async (expert) => {
    const workspaceId = useStore.getState().composerWorkspaceId;
    const result = await apiPost<
      Conversation | { conversation?: Conversation; session?: Conversation }
    >(`/api/experts/${encodeURIComponent(expert.id)}/edit-session`, {
      workspaceId,
      modelProvider: useStore.getState().modelProvider,
      modelId: useStore.getState().modelId,
    });
    const conversation = "conversation" in result && result.conversation
      ? result.conversation
      : "session" in result && result.session
      ? result.session
      : result as Conversation;

    useStore.setState((state) => ({
      conversations: [
        conversation,
        ...state.conversations.filter((item) => item.id !== conversation.id),
      ],
      expertComposerBootstrap: createExpertComposerBootstrap(
        conversation.id,
        {
          text: `帮我修改专家：[${expert.id}]，增加/优化[请补充你希望新增/优化的技能或知识领域等]方面的能力`,
          expertManagerToken: true,
        },
      ),
    }));

    const appStore = useStore.getState();
    try {
      await appStore.selectConversation(conversation.id);
    } catch (cause) {
      throw new ExpertCreatorNavigationError(conversation.id, { cause });
    }
    await useStore.getState().loadConversations();
    return conversation.id;
  },

  startSkillEdit: async (skill) => {
    const workspaceId = useStore.getState().composerWorkspaceId;
    const result = await apiPost<
      Conversation | { conversation?: Conversation; session?: Conversation }
    >(`/api/skills/${encodeURIComponent(skill.name)}/edit-session`, {
      workspaceId,
      modelProvider: useStore.getState().modelProvider,
      modelId: useStore.getState().modelId,
    });
    const conversation = "conversation" in result && result.conversation
      ? result.conversation
      : "session" in result && result.session
      ? result.session
      : result as Conversation;

    useStore.setState((state) => ({
      conversations: [
        conversation,
        ...state.conversations.filter((item) => item.id !== conversation.id),
      ],
      expertComposerBootstrap: createExpertComposerBootstrap(
        conversation.id,
        {
          text: `帮我修改技能：[${skill.name}]，具体修改内容：请补充`,
          expertManagerToken: false,
        },
      ),
    }));

    const appStore = useStore.getState();
    try {
      await appStore.selectConversation(conversation.id);
    } catch (cause) {
      throw new SkillCreatorNavigationError(conversation.id, { cause });
    }
    await useStore.getState().loadConversations();
    return conversation.id;
  },

  openExpertFolder: async (expertId) => {
    await apiPost(`/api/experts/${encodeURIComponent(expertId)}/open-folder`);
  },

  uninstallExpert: async (expertId) => {
    const result = await apiDelete<{
      affectedConversationIds?: string[];
    }>(`/api/experts/${encodeURIComponent(expertId)}`);

    set((state) => ({
      installedExperts: state.installedExperts.filter(
        (expert) => expert.id !== expertId,
      ),
    }));
    await get().loadInstalledExperts();
    await get().loadExperts();
    await useStore.getState().loadConversations();
    return {
      affectedConversationIds: Array.isArray(result?.affectedConversationIds)
        ? result.affectedConversationIds
        : [],
    };
  },

  loadMcp: async () => {
    try {
      const res = await apiGet<
        {
          config: McpConfig;
          availableConfig: McpConfig;
          connected: McpConnectionInfo[];
        }
      >("/api/mcp");
      set({
        mcpConfig: res.availableConfig,
        customMcpConfig: res.config,
        mcpConnected: res.connected,
        mcpEnterpriseError: null,
      });
    } catch (e) {
      console.error("[useSkillStore] 加载 MCP 失败:", e);
      set({
        mcpEnterpriseError: e instanceof Error ? e.message : "连接器加载失败",
      });
    }
  },

  connectMcp: async (serverName) => {
    const connection = await apiPost<McpConnectionInfo>("/api/mcp/connect", {
      name: serverName,
    });
    set((state) => ({
      mcpConnected: [
        ...state.mcpConnected.filter((item) => item.name !== connection.name),
        connection,
      ],
    }));
    return connection;
  },

  saveMcp: async (config) => {
    try {
      await apiPost("/api/mcp", config);
      await get().loadMcp();
      return true;
    } catch (e) {
      console.error("[useSkillStore] 保存 MCP 失败:", e);
      return false;
    }
  },

  uninstallMcp: async (serverName) => {
    const current = get().customMcpConfig || { mcpServers: {} };
    const mcpServers = { ...current.mcpServers };
    delete mcpServers[serverName];
    const updated = { ...current, mcpServers };
    return get().saveMcp(updated);
  },

  loadConnectors: async () => {
    try {
      const items = await apiGet<ConnectorServiceItem[]>("/api/connectors");
      set({ connectorItems: items, connectorError: null, connectorErrorCode: null });
    } catch (e) {
      console.error("[useSkillStore] 加载连接器失败:", e);
      const code = e instanceof ApiError ? e.code : undefined;
      set({
        connectorError: e instanceof Error ? e.message : "连接器加载失败",
        connectorErrorCode: code ?? null,
      });
    }
  },

  activateConnector: async (id) => {
    await apiPost(`/api/connectors/${encodeURIComponent(id)}/activate`);
    await get().loadConnectors();
  },
  cancelConnector: async (id) => {
    await apiPost(`/api/connectors/${encodeURIComponent(id)}/cancel`);
    await get().loadConnectors();
  },
  reauthorizeConnector: async (id) => {
    await apiPost(`/api/connectors/${encodeURIComponent(id)}/reauthorize`);
    await get().loadConnectors();
  },
  logoutConnector: async (id) => {
    await apiPost(`/api/connectors/${encodeURIComponent(id)}/logout`);
    await get().loadConnectors();
  },
  uninstallConnector: async (id) => {
    await apiDelete(`/api/connectors/${encodeURIComponent(id)}`);
    await get().loadConnectors();
  },
  repairConnector: async (id) => {
    await apiPost(`/api/connectors/${encodeURIComponent(id)}/repair`);
    await get().loadConnectors();
  },
  updateConnector: async (id) => {
    await apiPost(`/api/connectors/${encodeURIComponent(id)}/update`);
    await get().loadConnectors();
  },
}));
