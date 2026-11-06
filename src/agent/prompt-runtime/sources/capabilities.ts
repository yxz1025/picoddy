import {
  resolveCapabilityContext,
  type CapabilityActivationContext,
} from "../capability-catalog.ts";
import type { CapabilityContext, RuntimeProfile } from "../types.ts";

export function capabilityActivationContextFromProfile(
  profile: RuntimeProfile,
): CapabilityActivationContext {
  return {
    tools: profile.tools,
    skillNames: (profile.resources.skills ?? []).map((skill) => skill.name),
    selectedMcpToolNames: new Set(profile.selectedMcpToolNames),
  };
}

export function buildCapabilityContext(
  input: CapabilityActivationContext,
): CapabilityContext {
  return resolveCapabilityContext(input);
}
