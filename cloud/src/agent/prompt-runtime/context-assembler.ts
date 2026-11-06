// Adapted from src/agent/prompt-runtime/context-assembler.ts
// desktop source sha256: 9c84bec3fa806a6a2e1462cbbde95308120d9ea1927fd17c9c33e2aa0ca883b3
// Memory selection follows src/agent/prompt-runtime/sources/memory.ts
// desktop source sha256: ba404c61ca72bc78cba49326fcd18a1101dd42d6ad9656fc9934099626e2c532
// Cloud delta: all sources synchronously project one immutable run selection;
// no host cwd, HOME, live settings, plugins, credentials, or network are consulted.

import { randomUUID } from 'node:crypto';

import type { PromptRun as Run } from '../../cloud/runs/types.ts';
import { assertExpertContextBudget } from './expert-budget.ts';
import { encodeJsonForXml } from './boundary-encoding.ts';
import { PROMPT_BYTE_BUDGETS, utf8ByteLength } from './prompt-budget.ts';
import { resolveCloudRuntimeProfile, resolveCloudToolPolicy } from '../tools/contracts.ts';
import { PromptRuntimeError } from './diagnostics.ts';
import { sourceResult, takeWholeEntriesWithinBudget } from './sources/base.ts';
import {
  freezePromptSnapshot,
  type CloudCapabilityContext,
  type CloudEnvironmentContext,
  type CloudExpertContext,
  type CloudInputContext,
  type CloudMemoryContext,
  type CloudMemoryEntry,
  type CloudPromptContextSnapshot,
  type CloudPromptSettingsContext,
  type CloudRuntimeProfileContext,
  type CloudSkillContext,
  type CloudTurnContext,
  type CloudWorkspaceContext,
  type PromptDiagnostic,
} from './types.ts';

const MEMORY_CONTEXT_BYTES = 4_000;
const MAX_CUSTOM_INSTRUCTION_CHARACTERS = 8_000;
const REFERENCE_EXPERT_PROMPT_BYTES = 8_000;
const SAFE_MODEL_PROVIDERS = new Set([
  'openai',
  'anthropic',
  'google',
  'deepseek',
  'moonshot',
  'qwen',
]);

export interface CloudPromptAssemblyOptions {
  snapshotId?: string;
  createdAt?: string;
  activeToolNames?: readonly string[];
}

export function inputPathForCloudFile(file: { id: string; name: string }): string {
  const extension = /\.[a-zA-Z0-9]{1,12}$/.exec(file.name)?.[0] || '';
  return `/workspace/input/${file.id}${extension}`;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function collectEnvironment(run: Run, currentDate: string) {
  const provider = optionalString(run.selection.model.data.provider);
  const model = optionalString(run.selection.model.data.model);
  const value: CloudEnvironmentContext = {
    productName: 'PiCoddy Cloud',
    platform: 'isolated Linux OpenSandbox',
    executionLocation: 'remote',
    currentDate,
    model: {
      id: run.selection.model.id,
      name: run.selection.model.name,
      ...(provider && SAFE_MODEL_PROVIDERS.has(provider) ? { provider } : {}),
      ...(model ? { model } : {}),
    },
  };
  return sourceResult(value);
}

function collectWorkspace() {
  const value: CloudWorkspaceContext = {
    cwd: '/workspace',
    inputDir: '/workspace/input',
    outputDir: '/workspace/output',
    freshFilesystemPerRun: true,
    userComputerAccessible: false,
  };
  return sourceResult(value);
}

function collectRuntimeProfile(run: Run) {
  const value: CloudRuntimeProfileContext = resolveCloudRuntimeProfile(run.selection);
  return sourceResult(value);
}

function collectSettings(run: Run) {
  const stored = run.selection.settings;
  const customInstructions = stored?.customInstructions;
  const language = stored?.language;
  if (typeof customInstructions !== 'string' || typeof language !== 'string') {
    throw new PromptRuntimeError('PROMPT_SOURCE_FAILED', 500, 'Frozen prompt settings are invalid');
  }
  if (customInstructions.length > MAX_CUSTOM_INSTRUCTION_CHARACTERS) {
    throw new PromptRuntimeError(
      'PROMPT_CONTEXT_LIMIT_EXCEEDED',
      400,
      `customInstructions exceeds ${MAX_CUSTOM_INSTRUCTION_CHARACTERS} characters`,
    );
  }
  const value: CloudPromptSettingsContext = { customInstructions, language };
  return sourceResult(value);
}

function collectMemory(run: Run) {
  const diagnostics: PromptDiagnostic[] = [];
  const seen = new Set<string>();
  const entries: CloudMemoryEntry[] = [];
  for (const memory of run.selection.memories ?? []) {
    const content = optionalString(memory.data.content);
    if (!content || seen.has(content)) continue;
    seen.add(content);
    entries.push({ id: memory.id, title: memory.name, content });
  }

  const bounded = takeWholeEntriesWithinBudget(
    entries,
    MEMORY_CONTEXT_BYTES,
    entry => encodeJsonForXml(entry),
  );
  if (bounded.dropped > 0) {
    diagnostics.push({
      code: 'MEMORY_CONTEXT_TRUNCATED',
      severity: 'warning',
      sourceId: 'memory',
      message: `memory omitted ${bounded.dropped} complete entries at ${MEMORY_CONTEXT_BYTES} byte budget`,
    });
  }
  const value: CloudMemoryContext = {
    trust: 'user-supplied-untrusted',
    entries: bounded.included,
    truncated: bounded.dropped > 0,
  };
  return sourceResult(value, diagnostics, bounded.dropped > 0);
}

function collectSkills(run: Run) {
  const value: CloudSkillContext = {
    selectedOnly: true,
    skills: run.selection.skills.map(skill => ({
      id: skill.id,
      name: skill.name,
      version: skill.version,
      instructionsPath: `/workspace/skills/${skill.id}/SKILL.md`,
    })),
  };
  return sourceResult(value);
}

function collectExpert(run: Run) {
  if (!run.selection.expert) return undefined;
  const instructions = typeof run.selection.expert.data.prompt === 'string'
    ? run.selection.expert.data.prompt
    : '';
  const value: CloudExpertContext = {
    trust: 'user-supplied-untrusted',
    id: run.selection.expert.id,
    name: run.selection.expert.name,
    instructions: run.selection.expert.data.skillhubPackage
      ? `${instructions}\n\n专家包完整资源目录：/workspace/experts/${run.selection.expert.id}；已声明技能列在本轮技能清单中。`
      : instructions,
  };
  assertExpertContextBudget(value);
  return sourceResult(value);
}

function collectCapabilities(run: Run, activeToolNames: readonly string[]) {
  const value: CloudCapabilityContext = {
    activeToolNames: [...activeToolNames],
    selectedConnectors: run.selection.connectors.map(connector => ({
      id: connector.id,
      name: connector.name,
    })),
    approvalRequiredFor: [],
  };
  return sourceResult(value);
}

function collectInputs(run: Run) {
  const value: CloudInputContext = {
    selectedOnly: true,
    files: run.selection.files.map(file => ({
      id: file.id,
      name: file.name,
      path: inputPathForCloudFile(file),
      mimeType: file.mime_type,
      size: file.size,
    })),
  };
  return sourceResult(value);
}

function collectTurn(run: Run) {
  const reference = run.selection.referenceExpert;
  if (reference) {
    const value = {
      trust: 'user-supplied-untrusted' as const,
      instructionAuthority: 'none' as const,
      id: reference.id,
      revision: reference.revision,
      profile: reference.profile,
    };
    if (
      utf8ByteLength(value.profile.prompt) > REFERENCE_EXPERT_PROMPT_BYTES ||
      utf8ByteLength(encodeJsonForXml(value)) > PROMPT_BYTE_BUDGETS.fragmentBytes
    ) {
      throw new PromptRuntimeError(
        'PROMPT_CONTEXT_LIMIT_EXCEEDED',
        400,
        'Reference expert exceeds the 8000-byte prompt or 12000-byte encoded profile limit',
      );
    }
  }
  const value: CloudTurnContext = {
    query: run.prompt,
    ...(reference
      ? {
        referenceExpert: {
          trust: 'user-supplied-untrusted',
          instructionAuthority: 'none',
          id: reference.id,
          revision: reference.revision,
          profile: reference.profile,
        },
      }
      : {}),
  };
  return sourceResult(value);
}

export function assembleCloudPromptContext(
  run: Run,
  options: CloudPromptAssemblyOptions = {},
): CloudPromptContextSnapshot {
  const createdAt = options.createdAt ?? new Date().toISOString();
  const environment = collectEnvironment(run, createdAt.slice(0, 10));
  const workspace = collectWorkspace();
  const runtimeProfile = collectRuntimeProfile(run);
  const settings = collectSettings(run);
  const memory = collectMemory(run);
  const skills = collectSkills(run);
  const expert = collectExpert(run);
  const capabilities = collectCapabilities(
    run,
    options.activeToolNames ?? resolveCloudToolPolicy(run.selection),
  );
  const inputs = collectInputs(run);
  const turn = collectTurn(run);
  const diagnostics = [
    ...environment.diagnostics,
    ...workspace.diagnostics,
    ...runtimeProfile.diagnostics,
    ...settings.diagnostics,
    ...memory.diagnostics,
    ...skills.diagnostics,
    ...(expert?.diagnostics ?? []),
    ...capabilities.diagnostics,
    ...inputs.diagnostics,
    ...turn.diagnostics,
  ];

  return freezePromptSnapshot({
    schemaVersion: 2,
    snapshotId: options.snapshotId ?? randomUUID(),
    sessionId: run.conversation_id,
    turnId: run.id,
    createdAt,
    environment: environment.value,
    workspace: workspace.value,
    runtimeProfile: runtimeProfile.value,
    settings: settings.value,
    memory: memory.value,
    skills: skills.value,
    ...(expert ? { expert: expert.value } : {}),
    capabilities: capabilities.value,
    inputs: inputs.value,
    turn: turn.value,
    sourceRevisions: {
      environment: environment.revision,
      workspace: workspace.revision,
      runtimeProfile: runtimeProfile.revision,
      settings: settings.revision,
      memory: memory.revision,
      skills: skills.revision,
      ...(expert ? { expert: expert.revision } : {}),
      capabilities: capabilities.revision,
      inputs: inputs.revision,
      turn: turn.revision,
    },
    diagnostics,
  });
}
