import type { InteractionMode, ModeProfile } from "./types.ts";

const MODE_PROFILES: Record<InteractionMode, ModeProfile> = {
  ask: {
    id: "ask",
    promptPackId: "mode/ask",
    toolCapability: "none",
  },
  plan: {
    id: "plan",
    promptPackId: "mode/plan",
    toolCapability: "readonly",
  },
  craft: {
    id: "craft",
    promptPackId: "mode/craft",
    toolCapability: "full",
  },
};

export function resolveModeProfile(mode: InteractionMode): ModeProfile {
  return MODE_PROFILES[mode];
}
