import type {
  AgentTool,
} from "@earendil-works/pi-agent-core";

import type { Skill, PromptTemplate } from "@earendil-works/pi-coding-agent";

export interface PromptResources {
  skills?: Skill[];
  promptTemplates?: PromptTemplate[];
}

import type { PermLevel } from "../permissions.ts";
import type { PermissionDecision } from "../permissions.ts";
import type { SupportedPlatform } from "../../platform/runtime.ts";
import type { SkillRef } from "../experts/runtime_profile.ts";

export type InteractionMode = "ask" | "plan" | "craft";
export type SessionCategory =
  | "assistant"
  | "subagent"
  | "skill_creator"
  | "expert_creator"
  | "connector-agent";
export type ExpertOperation = "create" | "edit";
export type SkillOperation = ExpertOperation;

export interface WorkspaceRef {
  path?: string | null;
  artifactsDir?: string;
}

export interface ExpertBindingRef {
  expertId: string;
  revision?: string;
  source?: string;
}

/** 受管连接器子会话的结构化绑定（只读，来自已校验安装版本的元数据）。 */
export interface ConnectorChildRef {
  connectorId: string;
  /** 已安装版本根目录，子会话只从该目录加载 SKILL.md。 */
  installedVersionRoot: string;
  catalogVersion?: string;
  skillDigest?: string;
}

export type SubagentRole =
  | "scout"
  | "researcher"
  | "reviewer"
  | "verifier"
  | "worker";

export interface SubagentChildRef {
  role: SubagentRole;
  parentSessionId: string;
  parentTurnId?: string;
  allowedToolNames: string[];
  delegationDepth: number;
}

export interface SessionIntent {
  sessionId: string;
  modelProvider: string;
  modelId: string;
  category: SessionCategory;
  interactionMode: InteractionMode;
  permission: PermLevel;
  workspace: WorkspaceRef;
  expertBinding?: ExpertBindingRef;
  expertOperation?: ExpertOperation;
  skillOperation?: SkillOperation;
  skillTargetName?: string;
  /** 连接器子会话的结构化意图；存在时 category 强制为 "connector-agent"。 */
  connector?: ConnectorChildRef;
  /** 标准子代理运行时绑定；存在时 category 强制为 "subagent"。 */
  subagent?: SubagentChildRef;
  selectedSkillNames: string[];
  selectedMcpTools: AgentTool[];
}

export interface AttachmentContextItem {
  id?: string;
  name: string;
  /** Absolute managed attachment path, used by document tools for uploaded files. */
  path?: string;
  mimeType?: string;
  extension?: string;
  size?: number;
  content?: string;
  /**
   * A bounded, deterministic subset produced locally from a large structured
   * attachment. Models should answer from this data before reading the source.
   */
  localExtraction?: AttachmentLocalExtraction;
  /**
   * Large text stays in the managed file and must be read selectively through
   * file/shell tools instead of being copied wholesale into the model prompt.
   */
  contentUnavailableReason?: "binary_asset" | "large_text";
}

export interface AttachmentLocalExtraction {
  kind: "json_fields";
  fields: Array<{
    name: string;
    valueCount: number;
    uniqueValueCount: number;
    values: Array<string | number | boolean | null>;
    truncated: boolean;
  }>;
}

export interface FileReferenceContext {
  path: string;
  content?: string;
}

export interface ConnectorContextItem {
  connectorId: string;
  resourceId?: string;
  title?: string;
  content?: string;
}

export interface SelectedExpertSkillContext {
  name: string;
  source: "builtin" | "user";
  root: string;
  revision: string;
  destination: string;
}

export interface CategoryRuntimeContext {
  kind:
    | "skill_creator"
    | "skill_editor"
    | "expert_creator"
    | "expert_editor"
    | "connector_agent";
  sessionId: string;
  draftId?: string;
  skillRoot?: string;
  expertPluginsDir?: string;
  packagesDir?: string;
  targetId?: string;
  targetRevision?: string;
  targetName?: string;
}

export type TurnInvocation =
  | { kind: "skill"; name: string; instructions: string }
  | { kind: "prompt_template"; name: string; args: string[] };

export interface TurnIntent {
  turnId: string;
  rawText: string;
  invocation?: TurnInvocation;
  attachments: AttachmentContextItem[];
  fileReferences: FileReferenceContext[];
  connectorContext: ConnectorContextItem[];
  referenceExpertId?: string;
  selectedExpertSkills: string[];
  selectedExpertSkillInputs?: SelectedExpertSkillContext[];
  categoryRuntime?: CategoryRuntimeContext;
}

export interface ModeProfile {
  id: InteractionMode;
  promptPackId: string;
  toolCapability: "none" | "readonly" | "full";
}

export interface CategoryProfile {
  id: SessionCategory;
  promptPackId: string;
  toolPack:
    | "mode"
    | "subagent"
    | "skill_creator"
    | "skill_creator_edit"
    | "expert_creator_create"
    | "expert_creator_edit"
    | "connector_agent";
  forcedInvocation?: string;
}

export interface ExpertRuntimeProfileRef {
  expertId: string;
  revision: string;
}

export interface ResolvedPermissionPolicy {
  level: "L1" | "L2" | "L3";
  platform: SupportedPlatform;
  check(toolName: string, args: unknown): Promise<PermissionDecision>;
}

export interface PromptDiagnostic {
  code: string;
  severity: "warning" | "error";
  sourceId?: string;
  message: string;
}

export interface RuntimeProfile {
  session: SessionIntent;
  mode: ModeProfile;
  category: CategoryProfile;
  expert?: ExpertRuntimeProfileRef;
  tools: AgentTool[];
  activeToolNames: string[];
  selectedMcpToolNames: string[];
  resources: PromptResources;
  permissionPolicy: ResolvedPermissionPolicy;
  structuralHash: string;
  diagnostics: PromptDiagnostic[];
}

export interface EnvironmentContext {
  platform: string;
  osVersion?: string;
  currentDate?: string;
  shell?: string;
  modelName?: string;
  productName?: string;
}

export interface WorkspaceContext {
  cwd: string;
  artifactDir?: string;
  protectedWorkspace?: boolean;
  gitStatus?: string;
}

export interface PromptSettingsContext {
  customInstructions: string | null;
  language?: string;
  tone?: string;
  theme?: "light" | "dark" | "system";
}

export interface MemoryContextEntry {
  id: string;
  content: string;
  createdAt: string;
  updatedAt: string;
}

export interface MemoryContext {
  working: MemoryContextEntry[];
  user: MemoryContextEntry[];
}

export interface SkillContext {
  names: string[];
  formattedList?: string;
}

export interface ExpertContext {
  expertId: string;
  revision: string;
  persona: string;
  workflow: string;
  alwaysOnSkills: SkillRef[];
}

export const CAPABILITY_IDS = Object.freeze(
  [
    "file-read",
    "file-mutation",
    "shell",
    "document-processing",
    "web-research",
    "knowledge-retrieval",
    "memory",
    "computer-use",
    "visualization",
    "task-management",
    "subagent",
    "user-interaction",
    "artifact-delivery",
    "cloud-connectors",
    "skills",
    "mcp",
    "skill-draft",
    "expert-draft",
    "browser-control",
    "automation",
  ] as const,
);

export type CapabilityId = (typeof CAPABILITY_IDS)[number];

export interface CapabilityContext {
  groups: CapabilityId[];
  activeToolNames: string[];
  catalogRevision: string;
}

export interface TurnContext {
  query: string;
  attachments: AttachmentContextItem[];
  fileReferences?: FileReferenceContext[];
  connectorContext?: ConnectorContextItem[];
  referenceExpertId?: string;
  selectedExpertSkills?: string[];
  selectedExpertSkillInputs?: SelectedExpertSkillContext[];
  categoryRuntime?: CategoryRuntimeContext;
}

export interface SourceRevision {
  revision: string;
  contentHash: string;
  bytes: number;
  truncated: boolean;
}

export interface PromptContextSnapshot {
  schemaVersion: 2;
  snapshotId: string;
  sessionId: string;
  turnId: string;
  createdAt: string;
  environment: EnvironmentContext;
  workspace: WorkspaceContext;
  settings: PromptSettingsContext;
  memory: MemoryContext;
  skills: SkillContext;
  expert?: ExpertContext;
  capabilities: CapabilityContext;
  turn: TurnContext;
  sourceRevisions: Record<string, SourceRevision>;
  diagnostics: PromptDiagnostic[];
}

export interface PromptFragmentManifest {
  id: string;
  surface: "system" | "turn";
  order: number;
  contentHash: string;
  bytes: number;
}

export interface PromptSourceManifest extends SourceRevision {
  id: string;
}

export interface PromptManifest {
  schemaVersion: 2;
  snapshotId: string;
  contentHash: string;
  route: {
    mode: InteractionMode;
    category: SessionCategory;
    expertId?: string;
  };
  fragments: PromptFragmentManifest[];
  sources: PromptSourceManifest[];
  activeTools: string[];
  skillNames: string[];
  promptTemplateNames: string[];
  permissionSummary: string;
  diagnostics: PromptDiagnostic[];
}

export interface PromptEnvelope {
  snapshotId: string;
  turnId: string;
  systemPrompt: string;
  userPrompt: string;
  tools: AgentTool[];
  activeToolNames: string[];
  resources: PromptResources;
  permissionPolicy: ResolvedPermissionPolicy;
  invocation?: TurnInvocation;
  manifest: PromptManifest;
}

function freezeValue<T>(value: T): T {
  if (value === null || typeof value !== "object" || Object.isFrozen(value)) {
    return value;
  }
  for (const nested of Object.values(value)) freezeValue(nested);
  return Object.freeze(value);
}

export function freezePromptSnapshot(
  snapshot: PromptContextSnapshot,
): PromptContextSnapshot {
  return freezeValue(snapshot);
}
