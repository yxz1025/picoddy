import type {
  CapabilityContext,
  EnvironmentContext,
  ExpertContext,
  MemoryContext,
  PromptSettingsContext,
  SkillContext,
  TurnContext,
  WorkspaceContext,
} from "./types.ts";
import { renderJsonBlock } from "./boundary-encoding.ts";

export function renderEnvironmentBlock(value: EnvironmentContext): string {
  return renderJsonBlock("environment", value);
}

export function renderWorkspaceBlock(value: WorkspaceContext): string {
  return renderJsonBlock("workspace", value);
}

export function renderSettingsBlock(value: PromptSettingsContext): string {
  return renderJsonBlock("user_config", value);
}

export function renderMemoryBlock(value: MemoryContext): string {
  return renderJsonBlock("memory_context", value);
}

export function renderSkillBlock(value: SkillContext): string {
  return renderJsonBlock("skill_context", value);
}

export function renderExpertBlock(value: ExpertContext): string {
  return renderJsonBlock("expert_context", value);
}

export function renderCapabilityBlock(value: CapabilityContext): string {
  return renderJsonBlock("capability_context", value);
}

export function renderTurnPayload(value: TurnContext): string {
  return renderJsonBlock("turn_payload", value);
}
