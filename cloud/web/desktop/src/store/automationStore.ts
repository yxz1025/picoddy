import { create } from "zustand";
import { apiGet, apiPost, apiPut, apiDelete } from "../api/client";

export type ScheduleType = "cron" | "interval" | "once";
export type ActionType = "prompt" | "skill";
export type RunStatus = "queued" | "running" | "inProgress" | "completed" | "failed" | "timedOut" | "cancelled";
export type PermissionLevel = "readonly" | "default" | "full";

export interface TriggerConfig {
  cron?: string;
  intervalMinutes?: number;
  onceAt?: number;
  path?: string;
  pattern?: string;
}

export interface ActionConfig {
  prompt?: string;
  skill?: string;
}

export interface Automation {
  id: string;
  name: string;
  enabled: boolean;
  workspaceId: string | null;
  triggerType: string;
  triggerConfig: TriggerConfig;
  actionType: ActionType;
  actionConfig: ActionConfig;
  prompt: string | null;
  expertId: string | null;
  permission: PermissionLevel;
  connector: string | null;
  scheduleType: ScheduleType;
  validFrom: number | null;
  validUntil: number | null;
  pushToWxmp: boolean;
  lastRun: number | null;
  nextRun: number | null;
  createdAt: number;
}

export interface AutomationRun {
  id: string;
  automationId: string;
  status: RunStatus;
  sessionId: string | null;
  summary: string | null;
  startedAt: number;
  finishedAt: number | null;
}

export interface CreateAutomationPayload {
  name: string;
  workspaceId?: string | null;
  triggerType: string;
  triggerConfig: TriggerConfig;
  actionType: ActionType;
  actionConfig?: ActionConfig;
  prompt?: string;
  expertId?: string | null;
  permission?: PermissionLevel;
  connector?: string | null;
  scheduleType?: ScheduleType;
  validFrom?: number | null;
  validUntil?: number | null;
  pushToWxmp?: boolean;
}

interface AutomationState {
  automations: Automation[];
  runs: AutomationRun[];
  activeTab: "tasks" | "runs";
  loading: boolean;

  setActiveTab: (tab: "tasks" | "runs") => void;
  loadAutomations: () => Promise<void>;
  createAutomation: (payload: CreateAutomationPayload) => Promise<Automation>;
  updateAutomation: (id: string, patch: Partial<Automation>) => Promise<Automation>;
  deleteAutomation: (id: string) => Promise<void>;
  runAutomation: (id: string) => Promise<{ ok: boolean; runId: string; sessionId: string; status: RunStatus }>;
  loadAllRuns: () => Promise<void>;
  loadRuns: (automationId: string) => Promise<AutomationRun[]>;
}

export const useAutomationStore = create<AutomationState>((set, get) => ({
  automations: [],
  runs: [],
  activeTab: "tasks",
  loading: false,

  setActiveTab: (tab) => set({ activeTab: tab }),

  loadAutomations: async () => {
    set({ loading: true });
    try {
      const list = await apiGet<Automation[]>("/api/automations");
      set({ automations: list });
    } finally {
      set({ loading: false });
    }
  },

  createAutomation: async (payload) => {
    const a = await apiPost<Automation>("/api/automations", payload);
    await get().loadAutomations();
    return a;
  },

  updateAutomation: async (id, patch) => {
    const a = await apiPut<Automation>("/api/automations/" + id, patch);
    await get().loadAutomations();
    return a;
  },

  deleteAutomation: async (id) => {
    await apiDelete("/api/automations/" + id);
    await get().loadAutomations();
  },

  runAutomation: async (id) => {
    const res = await apiPost<{ ok: boolean; runId: string; sessionId: string; status: RunStatus }>("/api/automations/" + id + "/run", {});
    return res;
  },

  loadAllRuns: async () => {
    const { automations } = get();
    const runs: AutomationRun[] = [];
    for (const a of automations) {
      try {
        const rs = await apiGet<AutomationRun[]>("/api/automations/" + a.id + "/runs");
        runs.push(...rs);
      } catch {}
    }
    runs.sort((a, b) => b.startedAt - a.startedAt);
    set({ runs });
  },

  loadRuns: async (automationId) => {
    return apiGet<AutomationRun[]>("/api/automations/" + automationId + "/runs");
  },
}));
