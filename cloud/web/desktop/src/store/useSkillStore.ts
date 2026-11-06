import { create } from "zustand";
import { ApiError, apiDelete, apiGet, apiPost, apiPut, requestCloudJson } from "../api/client";
import type { ExpertSummary } from "../types/experts";
import { useStore } from "./useStore";
import type { Conversation } from "./useStore";
import { presentActiveExpert } from "./expertConversationModel";
import { createExpertComposerBootstrap } from "../components/expertCreatorModel";
import {
  skillHubIdentity,
  skillHubInstallVersion,
  type SkillHubNamespace,
  type SkillHubExpertDetail,
  type SkillHubSkill,
} from "../components/skillHubModel";
import type { ConnectorServiceItem } from "../components/connectorModel";

export interface SkillMeta {
  id?: string;
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
  id?: string;
  revision?: string;
  envConfigured?: boolean;
  headersConfigured?: boolean;
  authorizationConfigured?: boolean;
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
  id?: string;
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
let skillHubAuthPromise: Promise<boolean> | null = null;

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
  showInstalledExperts: boolean;
  mcpConfig: McpConfig | null;
  customMcpConfig: McpConfig | null;
  mcpConnected: McpConnectionInfo[];
  mcpBusyIds: string[];
  mcpEnterpriseError: string | null;
  connectorItems: ConnectorServiceItem[];
  connectorError: string | null;
  connectorErrorCode: string | null;

  loadSkills: () => Promise<boolean>;
  ensureSkillHubAuth: () => Promise<boolean>;
  loadSkillHubSkills: () => Promise<void>;
  loadSkillHubExperts: () => Promise<void>;
  getSkillHubExpertDetail: (expert: SkillHubSkill) => Promise<SkillHubExpertDetail>;
  installSkillHubSkill: (skill: SkillHubSkill) => Promise<SkillMeta>;
  summonSkillHubExpert: (expert: SkillHubSkill, initialPrompt?: string) => Promise<void>;
  setShowInstalledSkills: (show: boolean) => void;
  setShowInstalledExperts: (show: boolean) => void;
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
  disconnectMcp: (serverName: string) => Promise<void>;
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
  showInstalledSkills: false,
  showInstalledExperts: false,
  mcpConfig: null,
  customMcpConfig: null,
  mcpConnected: [],
  mcpBusyIds: [],
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

  ensureSkillHubAuth: () => {
    if (skillHubAuthPromise) return skillHubAuthPromise;
    set({ skillHubAuthChecking: true, skillHubAuthError: null });
    const operation = (async () => {
      try {
        const response = await apiPost<{ authenticated: boolean }>("/api/skillhub/auth/ensure", {});
        if (!response.authenticated) throw new Error("SkillHub 登录失败");
        return true;
      } catch (error) {
        set({ skillHubAuthError: error instanceof Error ? error.message : "SkillHub 登录失败，请重试" });
        return false;
      } finally {
        set({ skillHubAuthChecking: false });
      }
    })();
    skillHubAuthPromise = operation;
    void operation.finally(() => { if (skillHubAuthPromise === operation) skillHubAuthPromise = null; });
    return operation;
  },

  loadSkillHubSkills: async () => {
    set({ skillHubLoading: true, skillHubError: null });
    try {
      if (!await get().ensureSkillHubAuth()) return;
      const [skillHubSkills, skillHubNamespaces] = await Promise.all([
        apiGet<SkillHubSkill[]>("/api/skillhub/skills"),
        apiGet<SkillHubNamespace[]>("/api/skillhub/namespaces"),
      ]);
      set({ skillHubSkills, skillHubNamespaces });
    } catch (error) {
      console.error("[useSkillStore] 加载 SkillHub 失败:", error);
      set({
        skillHubError: error instanceof Error && error.message.trim()
          ? error.message
          : "SkillHub 技能列表加载失败",
      });
    } finally {
      set({ skillHubLoading: false });
    }
  },

  loadSkillHubExperts: async () => {
    set({ skillHubLoading: true, skillHubError: null });
    try {
      if (!await get().ensureSkillHubAuth()) return;
      const [skillHubExperts, skillHubNamespaces] = await Promise.all([
        apiGet<SkillHubSkill[]>("/api/skillhub/experts"),
        get().skillHubNamespaces.length > 0
          ? Promise.resolve(get().skillHubNamespaces)
          : apiGet<SkillHubNamespace[]>("/api/skillhub/namespaces"),
      ]);
      set({ skillHubExperts, skillHubNamespaces });
    } catch (error) {
      console.error("[useSkillStore] 加载 SkillHub 专家失败:", error);
      set({
        skillHubError: error instanceof Error && error.message.trim()
          ? error.message
          : "SkillHub 专家列表加载失败",
      });
    } finally {
      set({ skillHubLoading: false });
    }
  },

  getSkillHubExpertDetail: async (expert) =>
    apiGet<SkillHubExpertDetail>(
      `/api/skillhub/experts/${encodeURIComponent(expert.namespace)}/${encodeURIComponent(expert.slug)}`,
    ),

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
      const installed = await apiPost<SkillMeta>("/api/skillhub/install", {
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

  summonSkillHubExpert: async (expert, initialPrompt) => {
    const identity = skillHubIdentity(expert);
    const version = skillHubInstallVersion(expert);
    if (!version) throw new Error("暂无可下载版本");
    if (get().summoningSkillHubExpertId) throw new Error("正在召唤其他专家");
    set({ summoningSkillHubExpertId: identity });
    try {
      const installed = await apiPost<Expert>("/api/skillhub/experts/install", {
        namespace: expert.namespace,
        slug: expert.slug,
        version,
      });
      await get().loadInstalledExperts();
      await get().startExpertChat(installed.id, installed.name, initialPrompt);
    } finally {
      set({ summoningSkillHubExpertId: null });
    }
  },

  setShowInstalledSkills: (showInstalledSkills) => {
    set({ showInstalledSkills });
  },

  setShowInstalledExperts: (showInstalledExperts) => {
    set({ showInstalledExperts });
  },

  saveSkill: async (name, description, disabled, body, displayName) => {
    // 检查是否已存在，决定是用 POST 还是 PUT
    const existing = get().skills.find((s) => s.name === name);
    let res: SkillMeta;
    if (existing) {
      res = await apiPut<SkillMeta>("/api/skills/" + encodeURIComponent(existing.id ?? name), {
        description,
        disabled,
        body,
        displayName,
        version: existing.version,
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
    const existing = get().skills.find(skill => skill.name === name);
    await apiDelete("/api/skills/" + encodeURIComponent(existing?.id ?? name));
    await get().loadSkills();
  },

  toggleSkill: async (name, disabled) => {
    const existing = get().skills.find((s) => s.name === name);
    if (!existing) return;
    await apiPut<SkillMeta>("/api/skills/" + encodeURIComponent(existing.id ?? name), {
      disabled,
      version: existing.version,
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
      set({ installedExperts: result.experts, installedExpertsError: null });
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
    const expert = await get().getExpert(expertId);
    const { binding } = await apiPut<ExpertAssignmentResponse>(
      `/api/conversations/${encodeURIComponent(conversationId)}/expert`, { expertId },
    );
    useStore.setState(state => ({ conversations: state.conversations.map(conversation =>
      conversation.id === conversationId ? { ...conversation, expertId: binding.expertId,
        expertRevision: binding.revision, expertCatalogSource: binding.catalogSource, expert } : conversation),
    }));
    useStore.getState().setExpertComposerExpert(conversationId, expert);
  },

  clearConversationExpert: async (conversationId) => {
    await apiDelete(`/api/conversations/${encodeURIComponent(conversationId)}/expert`);
    useStore.setState(state => ({ conversations: state.conversations.map(conversation =>
      conversation.id === conversationId ? { ...conversation, expertId: null,
        expertRevision: null, expertCatalogSource: null, expert: null } : conversation),
    }));
    useStore.getState().clearExpertComposerExpert(conversationId);
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

    let binding: ExpertAssignmentResponse['binding'];
    try {
      ({ binding } = await apiPut<ExpertAssignmentResponse>(
        `/api/conversations/${encodeURIComponent(conversation.id)}/expert`, { expertId },
      ));
    } catch (error) {
      await apiDelete(`/api/conv/${encodeURIComponent(conversation.id)}`).catch(() => undefined);
      throw error;
    }
    appStore.setComposerWorkspaceId(null);
    await appStore.loadConversations();
    useStore.setState(state => ({ conversations: presentActiveExpert(state.conversations, conversation, expert, binding) }));
    appStore.setExpertComposerExpert(conversation.id, expert);
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
    const servers = get().customMcpConfig?.mcpServers ?? get().mcpConfig?.mcpServers ?? {};
    const entry = Object.entries(servers).find(([name, config]) =>
      name === serverName || config.id === serverName);
    const name = entry?.[0] ?? serverName;
    const id = entry?.[1].id;
    const identity = id || name;
    set((state) => ({
      mcpBusyIds: state.mcpBusyIds.includes(identity)
        ? state.mcpBusyIds
        : [...state.mcpBusyIds, identity],
    }));
    try {
      const connection = await apiPost<McpConnectionInfo>("/api/mcp/connect", id
        ? { id }
        : { name });
      set((state) => ({
        mcpConnected: [
          ...state.mcpConnected.filter((item) =>
            connection.id ? item.id !== connection.id : item.name !== connection.name),
          connection,
        ],
      }));
      return connection;
    } finally {
      set((state) => ({
        mcpBusyIds: state.mcpBusyIds.filter((item) => item !== identity),
      }));
    }
  },

  disconnectMcp: async (serverName) => {
    const servers = get().customMcpConfig?.mcpServers ?? get().mcpConfig?.mcpServers ?? {};
    const entry = Object.entries(servers).find(([name, config]) =>
      name === serverName || config.id === serverName);
    const name = entry?.[0] ?? serverName;
    const id = entry?.[1].id;
    const identity = id || name;
    set((state) => ({
      mcpBusyIds: state.mcpBusyIds.includes(identity)
        ? state.mcpBusyIds
        : [...state.mcpBusyIds, identity],
    }));
    try {
      await apiPost("/api/mcp/disconnect", id ? { id } : { name });
      set((state) => ({
        mcpConnected: state.mcpConnected.filter((item) =>
          id ? item.id !== id : item.name !== name),
      }));
    } finally {
      set((state) => ({
        mcpBusyIds: state.mcpBusyIds.filter((item) => item !== identity),
      }));
    }
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
    const configured = get().customMcpConfig?.mcpServers?.[serverName];
    if (configured?.id) {
      await requestCloudJson("DELETE", `/api/connectors/${encodeURIComponent(configured.id)}`);
      await get().loadMcp();
      return true;
    }
    const connectors = await requestCloudJson<Array<{ id: string; name: string }>>("GET", "/api/connectors");
    const connector = connectors.find((item) => item.name === serverName);
    if (!connector) throw new Error("连接器不存在，请刷新列表");
    await requestCloudJson("DELETE", `/api/connectors/${encodeURIComponent(connector.id)}`);
    await get().loadMcp();
    return true;
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
