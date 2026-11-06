import { PromptRuntimeError } from "./diagnostics.ts";
import type {
  CategoryProfile,
  ExpertOperation,
  InteractionMode,
  SessionCategory,
  SkillOperation,
} from "./types.ts";

export function assertCategoryModeAllowed(
  category: SessionCategory,
  mode: InteractionMode,
): void {
  if (category !== "assistant" && mode !== "craft") {
    throw new PromptRuntimeError(
      "CATEGORY_MODE_NOT_ALLOWED",
      400,
      `Category ${category} requires craft mode`,
    );
  }
}

export function resolveCategoryProfile(
  category: SessionCategory,
  operation?: ExpertOperation,
  skillOperation?: SkillOperation,
): CategoryProfile {
  if (category === "assistant") {
    return {
      id: "assistant",
      promptPackId: "category/assistant",
      toolPack: "mode",
    };
  }
  if (category === "subagent") {
    return {
      id: "subagent",
      promptPackId: "category/assistant",
      toolPack: "subagent",
    };
  }
  if (category === "connector-agent") {
    return {
      id: "connector-agent",
      promptPackId: "category/connector-agent",
      toolPack: "connector_agent",
    };
  }
  if (category === "skill_creator") {
    if (skillOperation === "edit") {
      return {
        id: "skill_creator",
        promptPackId: "category/skill-editor",
        toolPack: "skill_creator_edit",
        forcedInvocation: "skill-creator",
      };
    }
    return {
      id: "skill_creator",
      promptPackId: "category/skill-creator",
      toolPack: "skill_creator",
      forcedInvocation: "skill-creator",
    };
  }
  if (!operation) {
    throw new PromptRuntimeError(
      "CATEGORY_MODE_NOT_ALLOWED",
      400,
      "Expert creator requires an explicit create or edit operation",
    );
  }
  return operation === "edit"
    ? {
      id: "expert_creator",
      promptPackId: "category/expert-editor",
      toolPack: "expert_creator_edit",
      forcedInvocation: "expert-manager",
    }
    : {
      id: "expert_creator",
      promptPackId: "category/expert-creator",
      toolPack: "expert_creator_create",
      forcedInvocation: "expert-manager",
    };
}
