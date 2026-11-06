import type { ExpertRuntimeProfile } from "../../experts/runtime_profile.ts";
import type { ExpertContext } from "../types.ts";

export function buildExpertContext(
  profile: ExpertRuntimeProfile,
): ExpertContext {
  return {
    expertId: profile.expertId,
    revision: profile.revision,
    persona: profile.persona.content,
    workflow: profile.workflow.items.join("\n"),
    alwaysOnSkills: profile.alwaysOnSkills,
  };
}
