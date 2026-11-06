import type { AgentMessage } from '@earendil-works/pi-agent-core';
import type { WorkspaceSnapshot } from '../../domains/workspace/node/sync.ts';

export interface ResourceSnapshot {
  id: string;
  name: string;
  data: Record<string, any>;
  secret?: string | null;
}
export interface SkillSnapshot {
  id: string;
  name: string;
  version: string;
  files: Array<{ path: string; contentBase64: string }>;
}
export interface FileRow {
  id: string;
  owner_id: string;
  name: string;
  mime_type: string;
  object_key: string;
  size: number;
}

export type CloudRunMode = 'ask' | 'plan' | 'craft';
export type CloudRunCategory = 'assistant' | 'skill_creator' | 'expert_creator';
export type CloudRunPermission = 'full' | 'readonly';

export interface CloudRuntimeProfile {
  mode: CloudRunMode;
  category: CloudRunCategory;
}

export interface CloudPromptSettings {
  customInstructions: string;
  language: string;
}

export interface ReferenceExpertProfileSnapshot {
  name: string;
  prompt: string;
  skillIds: string[];
  description: string;
  tags: string[];
  quickPrompts: string[];
  icon: string;
  categoryId: string;
}

export interface ReferenceExpertSnapshot {
  id: string;
  revision: string;
  profile: ReferenceExpertProfileSnapshot;
}

export interface RunSelection {
  delegation?: { parentRunId: string; role: import('../../domains/delegation/node/policy.ts').DelegationRole; depth: 1; allowedToolNames: string[] };
  workspace: WorkspaceSnapshot;
  skills: SkillSnapshot[];
  connectors: ResourceSnapshot[];
  model: ResourceSnapshot;
  files: FileRow[];
  expert?: ResourceSnapshot;
  /** Public/legacy identifier. It never activates the expert or its skills. */
  referenceExpertId?: string;
  /** Immutable creator-only profile data rendered on the untrusted user turn. */
  referenceExpert?: ReferenceExpertSnapshot;
  memories?: ResourceSnapshot[];
  runtimeProfile: CloudRuntimeProfile;
  permission: CloudRunPermission;
  settings: CloudPromptSettings;
}

export interface Run {
  parent_run_id?: string | null;
  id: string;
  owner_id: string;
  conversation_id: string;
  prompt: string;
  status: string;
  lease_token: string;
  sandbox_id: string | null;
  selection: RunSelection;
}
export type Transcript = AgentMessage[];
export type PromptRun = Pick<Run, 'id' | 'conversation_id' | 'prompt' | 'selection'>;
export type Emit = (type: string, payload: Record<string, unknown>) => Promise<void>;
