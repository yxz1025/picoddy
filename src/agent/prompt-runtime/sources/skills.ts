import {
  formatSkillsForPrompt,
  type Skill,
} from "@earendil-works/pi-coding-agent";

import type { SkillContext } from "../types.ts";

export function buildSkillContext(skills: readonly Skill[], activeToolNames: readonly string[] = ["read"]): SkillContext {
  const active = [...skills];
  return {
    names: active.map((skill) => skill.name),
    formattedList: active.length === 0
      ? ""
      : formatSkillsForPrompt(active, activeToolNames.includes("read") ? "read" : activeToolNames.includes("bash") ? "bash" : "indirect"),
  };
}
