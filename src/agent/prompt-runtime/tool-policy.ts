import type { AgentTool } from "@earendil-works/pi-agent-core";

import type { ProtectedPathPolicy } from "../../platform/path_policy.ts";
import type { SessionRoot } from "../session_root.ts";
import {
  type FullToolsOptions,
  getConnectorChildTools,
  getConnectorDelegateTools,
  getExpertDraftTools,
  getFullTools,
  getReadOnlyTools,
  getSkillCreatorTools,
} from "../tools/index.ts";
import { PromptRuntimeError } from "./diagnostics.ts";
import type {
  CategoryProfile,
  ModeProfile,
  SubagentChildRef,
} from "./types.ts";

export interface ToolPolicyFactories {
  getReadOnlyTools(cwd: string): AgentTool[];
  getFullTools(options: FullToolsOptions): AgentTool[];
  getSkillCreatorTools(): AgentTool[];
  getExpertDraftTools(): AgentTool[];
  getConnectorChildTools(): AgentTool[];
  /** 主 agent 工具：当前 ready 连接器的 delegate 工具（同步缓存）。 */
  getConnectorDelegateTools(): AgentTool[];
}

export interface ResolveToolPolicyInput {
  /** Local project MCP selections are authoritative; omit global CLI delegates. */
  projectScoped?: boolean;
  mode: ModeProfile;
  category: CategoryProfile;
  sessionRoot: SessionRoot;
  protectedPathPolicy?: ProtectedPathPolicy;
  selectedMcpTools: AgentTool[];
  subagent?: SubagentChildRef;
}

export interface ResolvedToolPolicy {
  tools: AgentTool[];
  activeToolNames: string[];
  selectedMcpToolNames: string[];
}

const DEFAULT_FACTORIES: ToolPolicyFactories = {
  getReadOnlyTools,
  getFullTools,
  getSkillCreatorTools,
  getExpertDraftTools,
  getConnectorChildTools,
  getConnectorDelegateTools,
};

function uniqueTools(tools: readonly AgentTool[]): AgentTool[] {
  const seen = new Set<string>();
  return tools.filter((tool) => {
    if (seen.has(tool.name)) return false;
    seen.add(tool.name);
    return true;
  });
}

function assertUniqueSelectedMcpTools(
  selectedMcpTools: readonly AgentTool[],
): void {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const tool of selectedMcpTools) {
    if (seen.has(tool.name)) duplicates.add(tool.name);
    seen.add(tool.name);
  }
  if (duplicates.size === 0) return;
  throw new PromptRuntimeError(
    "MCP_SELECTION_INVALID",
    400,
    `Duplicate selected MCP tool name(s): ${[...duplicates].join(", ")}`,
  );
}

function validatedMcpNamesFromFullPack(
  tools: readonly AgentTool[],
  selectedMcpTools: readonly AgentTool[],
): string[] {
  const counts = new Map<string, number>();
  for (const tool of tools) {
    counts.set(tool.name, (counts.get(tool.name) ?? 0) + 1);
  }
  const collisions = selectedMcpTools
    .map((tool) => tool.name)
    .filter((name) => (counts.get(name) ?? 0) > 1);
  if (collisions.length > 0) {
    throw new PromptRuntimeError(
      "MCP_SELECTION_INVALID",
      400,
      `Selected MCP tool name(s) collide with the active base tool pack: ${
        collisions.join(", ")
      }`,
    );
  }
  return selectedMcpTools
    .map((tool) => tool.name)
    .filter((name) => counts.has(name));
}

export function resolveToolPolicy(
  input: ResolveToolPolicyInput,
  factories: ToolPolicyFactories = DEFAULT_FACTORIES,
): ResolvedToolPolicy {
  const { category, mode, sessionRoot, selectedMcpTools } = input;
  let tools: AgentTool[];
  let selectedMcpToolNames: string[] = [];

  switch (category.toolPack) {
    case "subagent": {
      if (!input.subagent) {
        throw new PromptRuntimeError(
          "CATEGORY_MODE_NOT_ALLOWED",
          400,
          "Subagent runtime binding is required",
        );
      }
      const allowed = new Set(input.subagent.allowedToolNames);
      tools = factories.getFullTools({
        cwd: sessionRoot.cwd,
        protectedWorkspace: sessionRoot.protectedWorkspace,
        selectedMcpTools,
        policy: input.protectedPathPolicy,
      }).filter((tool) => allowed.has(tool.name) && tool.name !== "subagent");
      break;
    }
    case "skill_creator":
    case "skill_creator_edit":
      tools = factories.getSkillCreatorTools();
      break;
    case "expert_creator_edit":
      tools = [
        ...factories.getReadOnlyTools(sessionRoot.cwd),
        ...factories.getExpertDraftTools(),
      ];
      break;
    case "expert_creator_create":
      assertUniqueSelectedMcpTools(selectedMcpTools);
      tools = factories.getFullTools({
        cwd: sessionRoot.cwd,
        protectedWorkspace: sessionRoot.protectedWorkspace,
        selectedMcpTools,
        policy: input.protectedPathPolicy,
      });
      selectedMcpToolNames = validatedMcpNamesFromFullPack(
        tools,
        selectedMcpTools,
      );
      break;
    case "connector_agent":
      tools = factories.getConnectorChildTools();
      break;
    case "mode":
      if (mode.toolCapability === "none") {
        tools = [];
      } else if (mode.toolCapability === "readonly") {
        tools = [
          ...factories.getReadOnlyTools(sessionRoot.cwd),
          ...(input.projectScoped ? [] : factories.getConnectorDelegateTools()),
        ];
      } else {
        assertUniqueSelectedMcpTools(selectedMcpTools);
        tools = [
          ...factories.getFullTools({
            cwd: sessionRoot.cwd,
            protectedWorkspace: sessionRoot.protectedWorkspace,
            selectedMcpTools,
            policy: input.protectedPathPolicy,
          }),
          ...(input.projectScoped ? [] : factories.getConnectorDelegateTools()),
        ];
        selectedMcpToolNames = validatedMcpNamesFromFullPack(
          tools,
          selectedMcpTools,
        );
      }
      break;
  }

  const unique = uniqueTools(tools);
  return {
    tools: unique,
    activeToolNames: unique.map((tool) => tool.name),
    selectedMcpToolNames,
  };
}
