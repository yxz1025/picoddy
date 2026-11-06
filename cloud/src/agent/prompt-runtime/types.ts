// Adapted from src/agent/prompt-runtime/types.ts
// desktop source sha256: b01188077d5ae6eebed697e5f32da7ff472aeb85844dee596c06ea4a7160ed4e
// Cloud delta: the snapshot contains only fields available from a frozen Run;
// Cloud projects desktop mode/category/permission into immutable run-owned values;
// host-workspace types remain intentionally absent from this remote runtime.

export interface PromptDiagnostic {
  code: string;
  severity: 'warning' | 'error';
  sourceId?: string;
  message: string;
}

export interface SourceRevision {
  revision: string;
  contentHash: string;
  bytes: number;
  truncated: boolean;
}

export interface CloudEnvironmentContext {
  productName: 'PiCoddy Cloud';
  platform: 'isolated Linux OpenSandbox';
  executionLocation: 'remote';
  currentDate: string;
  model: {
    id: string;
    name: string;
    provider?: string;
    model?: string;
  };
}

export interface CloudWorkspaceContext {
  cwd: '/workspace';
  inputDir: '/workspace/input';
  outputDir: '/workspace/output';
  freshFilesystemPerRun: true;
  userComputerAccessible: false;
}

export interface CloudRuntimeProfileContext {
  mode: 'ask' | 'plan' | 'craft';
  category: 'assistant' | 'skill_creator' | 'expert_creator';
  permission: 'full' | 'readonly';
}

export interface CloudPromptSettingsContext {
  customInstructions: string;
  language: string;
}

export interface CloudMemoryEntry {
  id: string;
  title: string;
  content: string;
}

export interface CloudMemoryContext {
  trust: 'user-supplied-untrusted';
  entries: CloudMemoryEntry[];
  truncated: boolean;
}

export interface CloudSkillContext {
  selectedOnly: true;
  skills: Array<{
    id: string;
    name: string;
    version: string;
    instructionsPath: string;
  }>;
}

export interface CloudExpertContext {
  trust: 'user-supplied-untrusted';
  id: string;
  name: string;
  instructions: string;
}

export interface CloudCapabilityContext {
  activeToolNames: string[];
  selectedConnectors: Array<{ id: string; name: string }>;
  approvalRequiredFor: string[];
}

export interface CloudInputContext {
  selectedOnly: true;
  files: Array<{
    id: string;
    name: string;
    path: string;
    mimeType: string;
    size: number;
  }>;
}

export interface CloudTurnContext {
  query: string;
  /** Frozen creator input: descriptive data only, never an active expert. */
  referenceExpert?: {
    trust: 'user-supplied-untrusted';
    instructionAuthority: 'none';
    id: string;
    revision: string;
    profile: {
      name: string;
      prompt: string;
      skillIds: string[];
      description: string;
      tags: string[];
      quickPrompts: string[];
      icon: string;
      categoryId: string;
    };
  };
}

export interface CloudPromptContextSnapshot {
  schemaVersion: 2;
  snapshotId: string;
  sessionId: string;
  turnId: string;
  createdAt: string;
  environment: CloudEnvironmentContext;
  workspace: CloudWorkspaceContext;
  runtimeProfile: CloudRuntimeProfileContext;
  settings: CloudPromptSettingsContext;
  memory: CloudMemoryContext;
  skills: CloudSkillContext;
  expert?: CloudExpertContext;
  capabilities: CloudCapabilityContext;
  inputs: CloudInputContext;
  turn: CloudTurnContext;
  sourceRevisions: Record<string, SourceRevision>;
  diagnostics: PromptDiagnostic[];
}

export interface CloudPromptManifest {
  fragments: Array<{ path: string; contentHash: string; bytes: number }>;
  activeTools: string[];
  skillNames: string[];
  schemaVersion: 2;
  snapshotId: string;
  contentHash: string;
  sources: Array<SourceRevision & { id: string }>;
  diagnostics: PromptDiagnostic[];
}

export interface CloudPromptEnvelope {
  snapshotId: string;
  turnId: string;
  systemPrompt: string;
  userPrompt: string;
  snapshot: CloudPromptContextSnapshot;
  manifest: CloudPromptManifest;
}

function freezeValue<T>(value: T): T {
  if (value === null || typeof value !== 'object' || Object.isFrozen(value)) {
    return value;
  }
  for (const nested of Object.values(value)) freezeValue(nested);
  return Object.freeze(value);
}

export function freezePromptSnapshot(
  snapshot: CloudPromptContextSnapshot,
): CloudPromptContextSnapshot {
  return freezeValue(snapshot);
}
