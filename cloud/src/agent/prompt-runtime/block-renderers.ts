// Adapted from src/agent/prompt-runtime/block-renderers.ts
// desktop source sha256: 8b4f8de3da0f573242420ba03094ba3e51f5d06a467c8741c794a1fc5fe9389d
// Cloud delta: renderers target the cloud snapshot's explicit run-selection types.

import { renderJsonBlock } from './boundary-encoding.ts';
import type {
  CloudCapabilityContext,
  CloudEnvironmentContext,
  CloudExpertContext,
  CloudInputContext,
  CloudMemoryContext,
  CloudPromptSettingsContext,
  CloudRuntimeProfileContext,
  CloudSkillContext,
  CloudTurnContext,
  CloudWorkspaceContext,
} from './types.ts';

export function renderEnvironmentBlock(value: CloudEnvironmentContext): string {
  return renderJsonBlock('environment', value);
}

export function renderWorkspaceBlock(value: CloudWorkspaceContext): string {
  return renderJsonBlock('workspace', value);
}

export function renderRuntimeProfileBlock(value: CloudRuntimeProfileContext): string {
  return renderJsonBlock('runtime_profile', value);
}

export function renderSettingsBlock(value: CloudPromptSettingsContext): string {
  return renderJsonBlock('user_config', value);
}

export function renderMemoryBlock(value: CloudMemoryContext): string {
  return renderJsonBlock('memory_context', value);
}

export function renderSkillBlock(value: CloudSkillContext): string {
  return renderJsonBlock('skill_context', value);
}

export function renderExpertBlock(value: CloudExpertContext): string {
  return renderJsonBlock('expert_context', value);
}

export function renderCapabilityBlock(value: CloudCapabilityContext): string {
  return renderJsonBlock('capability_context', value);
}

export function renderInputBlock(value: CloudInputContext): string {
  return renderJsonBlock('input_context', value);
}

export function renderTurnPayload(value: CloudTurnContext): string {
  return renderJsonBlock('turn_payload', value);
}
