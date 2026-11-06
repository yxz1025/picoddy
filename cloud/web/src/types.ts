export type EntityId = string;

export interface User {
  id: EntityId;
  email: string;
  name: string;
}

export interface Conversation {
  id: EntityId;
  title: string;
  workspaceId?: EntityId | null;
  createdAt: string;
  updatedAt: string;
}

export interface Message {
  id: EntityId;
  role?: "user" | "assistant" | "toolResult" | "system";
  content: unknown;
  createdAt: string;
}

export type RunStatus =
  | "queued"
  | "provisioning"
  | "running"
  | "waiting_approval"
  | "cancelling"
  | "cleanup_pending"
  | "succeeded"
  | "failed"
  | "cancelled"
  | "interrupted";

export interface Run {
  id: EntityId;
  conversationId: EntityId;
  status: RunStatus;
  prompt?: string;
  error?: { code?: string; message?: string } | string | null;
  usage?: Partial<Usage> | null;
  createdAt: string;
  updatedAt: string;
}

export interface RunEvent {
  id: number | string;
  runId: EntityId;
  type:
    | "text_delta"
    | "message"
    | "tool_start"
    | "tool_end"
    | "status"
    | "approval"
    | "error"
    | string;
  payload: Record<string, unknown>;
  createdAt: string;
}

export interface Approval {
  id: EntityId;
  runId: EntityId;
  toolCallId?: string;
  tool: string;
  input: unknown;
  status: "pending" | "approved" | "rejected" | string;
  createdAt: string;
  decidedAt?: string | null;
}

export interface BaseResource {
  id: EntityId;
  name: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface Skill extends BaseResource {
  description?: string;
  version: string;
  enabled: boolean;
}

export interface SkillVersion {
  version: string;
  createdAt?: string;
  description?: string;
}

export interface Expert extends BaseResource {
  prompt: string;
  skillIds: EntityId[];
}

export interface Connector extends BaseResource {
  transport: "stdio" | "http";
  command?: string;
  args?: string[];
  url?: string;
  envConfigured?: boolean | Record<string, boolean>;
  headersConfigured?: boolean | Record<string, boolean>;
}

export interface Model extends BaseResource {
  provider: string;
  model: string;
  baseUrl?: string;
  apiKeyConfigured?: boolean;
}

export interface CloudFile {
  id: EntityId;
  name: string;
  mimeType: string;
  size: number;
  sha256?: string;
  runId?: EntityId | null;
  createdAt: string;
}

export interface Workspace extends BaseResource {
  description: string;
}

export interface Memory {
  id: EntityId;
  title: string;
  content: string;
  workspaceId?: EntityId | null;
  createdAt?: string;
  updatedAt?: string;
}

export interface Automation extends BaseResource {
  prompt: string;
  cron: string;
  timezone: string;
  skillIds: EntityId[];
  connectorIds: EntityId[];
  modelId?: EntityId | null;
  enabled: boolean;
}

export interface Usage {
  runs: number;
  inputTokens: number;
  outputTokens: number;
  cost: number | null;
}

export interface RunInput {
  prompt: string;
  skillIds: EntityId[];
  connectorIds: EntityId[];
  fileIds: EntityId[];
  expertId?: EntityId;
  modelId?: EntityId;
}

export type InspectorTab = "files" | "tools" | "activity";
export type SettingsSection =
  | "skills"
  | "models"
  | "connectors"
  | "experts"
  | "workspaces"
  | "memories"
  | "automations"
  | "usage";
