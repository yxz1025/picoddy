import { CAPABILITY_CATALOG } from "./capability-catalog.ts";
import { PromptRuntimeError } from "./diagnostics.ts";
import type { CapabilityId } from "./types.ts";

export type PromptSurface = "system" | "turn";

export interface PromptPackDefinition {
  id: string;
  surface: PromptSurface;
  order: number;
  fragmentPath: string;
}

export interface LoadedPromptFragment extends PromptPackDefinition {
  content: string;
  contentHash: string;
  bytes: number;
}

const CORE: readonly PromptPackDefinition[] = [
  {
    id: "core/identity",
    surface: "system",
    order: 10,
    fragmentPath: "core/product-identity.md",
  },
  {
    id: "core/instruction-priority",
    surface: "system",
    order: 20,
    fragmentPath: "core/instruction-priority.md",
  },
  {
    id: "core/communication",
    surface: "system",
    order: 30,
    fragmentPath: "core/communication.md",
  },
  {
    id: "core/file-safety",
    surface: "system",
    order: 40,
    fragmentPath: "core/file-safety.md",
  },
  {
    id: "core/tool-use",
    surface: "system",
    order: 50,
    fragmentPath: "core/tool-use.md",
  },
  {
    id: "core/agent-loop",
    surface: "system",
    order: 60,
    fragmentPath: "core/agent-loop.md",
  },
  {
    id: "core/error-recovery",
    surface: "system",
    order: 70,
    fragmentPath: "core/error-recovery.md",
  },
];

const MEMORY_CONTEXT: PromptPackDefinition = {
  id: "context/memory",
  surface: "system",
  order: 80,
  fragmentPath: "context/memory.md",
};

const CATEGORY: Record<string, PromptPackDefinition> = {
  assistant: {
    id: "category/assistant",
    surface: "system",
    order: 100,
    fragmentPath: "categories/assistant.md",
  },
  subagent: {
    id: "category/assistant",
    surface: "system",
    order: 100,
    fragmentPath: "categories/assistant.md",
  },
  skill_creator: {
    id: "category/skill-creator",
    surface: "system",
    order: 101,
    fragmentPath: "categories/skill-creator.md",
  },
  skill_editor: {
    id: "category/skill-editor",
    surface: "system",
    order: 102,
    fragmentPath: "categories/skill-editor.md",
  },
  expert_creator: {
    id: "category/expert-creator",
    surface: "system",
    order: 103,
    fragmentPath: "categories/expert-creator.md",
  },
  expert_editor: {
    id: "category/expert-editor",
    surface: "system",
    order: 104,
    fragmentPath: "categories/expert-editor.md",
  },
  "connector-agent": {
    id: "category/connector-agent",
    surface: "system",
    order: 105,
    fragmentPath: "categories/connector-agent.md",
  },
};

const MODE: Record<string, PromptPackDefinition> = {
  ask: {
    id: "mode/ask",
    surface: "system",
    order: 200,
    fragmentPath: "modes/ask.md",
  },
  plan: {
    id: "mode/plan",
    surface: "system",
    order: 201,
    fragmentPath: "modes/plan.md",
  },
  craft: {
    id: "mode/craft",
    surface: "system",
    order: 202,
    fragmentPath: "modes/craft.md",
  },
};

const RESULT: PromptPackDefinition = {
  id: "core/result-presentation",
  surface: "system",
  order: 900,
  fragmentPath: "core/result-presentation.md",
};

export interface PromptPackSelectionInput {
  mode: "ask" | "plan" | "craft";
  category:
    | "assistant"
    | "subagent"
    | "skill_creator"
    | "skill_editor"
    | "expert_creator"
    | "expert_editor"
    | "connector-agent";
  capabilityGroups: readonly CapabilityId[];
  hasMemoryContext: boolean;
}

function capabilityPromptPack(
  id: CapabilityId,
): PromptPackDefinition {
  const definition = CAPABILITY_CATALOG.find(
    (candidate) => candidate.id === id && candidate.status === "active",
  );
  if (!definition) {
    throw new PromptRuntimeError(
      "PROMPT_CAPABILITY_UNKNOWN",
      500,
      `Unknown or dormant prompt capability: ${id}`,
    );
  }
  return {
    id: definition.promptPackId,
    surface: "system",
    order: definition.order,
    fragmentPath: definition.fragmentPath,
  };
}

function sortDefinitions(
  definitions: readonly PromptPackDefinition[],
): PromptPackDefinition[] {
  return [...definitions].sort(
    (left, right) =>
      left.order - right.order || left.id.localeCompare(right.id),
  );
}

export function listAllPromptPackDefinitions(
  options: { includeDormant?: boolean } = {},
): PromptPackDefinition[] {
  const capabilities = CAPABILITY_CATALOG
    .filter((definition) =>
      options.includeDormant || definition.status === "active"
    )
    .map((definition) => ({
      id: definition.promptPackId,
      surface: "system" as const,
      order: definition.order,
      fragmentPath: definition.fragmentPath,
    }));
  return sortDefinitions([
    ...CORE,
    MEMORY_CONTEXT,
    ...new Map(Object.values(CATEGORY).map(definition => [definition.id, definition])).values(),
    ...Object.values(MODE),
    ...capabilities,
    RESULT,
  ]);
}

export function selectPromptPackDefinitions(
  input: PromptPackSelectionInput,
): PromptPackDefinition[] {
  const capabilityDefinitions = input.capabilityGroups.map(
    capabilityPromptPack,
  );
  const uniqueCapabilities = [
    ...new Map(
      capabilityDefinitions.map((definition) => [definition.id, definition]),
    ).values(),
  ];
  return sortDefinitions([
    ...CORE,
    ...(input.hasMemoryContext ? [MEMORY_CONTEXT] : []),
    CATEGORY[input.category],
    MODE[input.mode],
    ...uniqueCapabilities,
    RESULT,
  ]);
}
