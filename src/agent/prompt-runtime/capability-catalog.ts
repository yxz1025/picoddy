import { createHash } from "node:crypto";
import type { AgentTool } from "@earendil-works/pi-agent-core";

import { PromptRuntimeError } from "./diagnostics.ts";
import type { CapabilityContext, CapabilityId } from "./types.ts";

export type CapabilityActivation =
  | {
      readonly kind: "tools";
      readonly anyTools?: readonly string[];
      readonly allTools?: readonly string[];
    }
  | { readonly kind: "skill-resources" }
  | { readonly kind: "selected-mcp-tools" };

export interface CapabilityDefinition {
  readonly id: CapabilityId;
  readonly promptPackId: string;
  readonly fragmentPath: string;
  readonly order: number;
  readonly status: "active" | "dormant";
  readonly activation: CapabilityActivation;
}

export interface CapabilityActivationContext {
  readonly tools: readonly AgentTool[];
  readonly skillNames: readonly string[];
  readonly selectedMcpToolNames: ReadonlySet<string>;
}

const tools = (...anyTools: string[]): CapabilityActivation => ({
  kind: "tools",
  anyTools,
});

function active(
  id: CapabilityId,
  order: number,
  fragmentPath: string,
  activation: CapabilityActivation,
): CapabilityDefinition {
  return {
    id,
    promptPackId: `capability/${id}`,
    fragmentPath,
    order,
    status: "active",
    activation,
  };
}

function resource(
  id: CapabilityId,
  order: number,
  fragmentPath: string,
  kind: "skill-resources" | "selected-mcp-tools",
): CapabilityDefinition {
  return active(id, order, fragmentPath, { kind });
}

function dormant(
  id: CapabilityId,
  order: number,
  fragmentPath: string,
): CapabilityDefinition {
  return {
    id,
    promptPackId: `capability/${id}`,
    fragmentPath,
    order,
    status: "dormant",
    activation: tools(),
  };
}

function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== "object" || Object.isFrozen(value)) {
    return value;
  }
  for (const nested of Object.values(value)) deepFreeze(nested);
  return Object.freeze(value);
}

export const CAPABILITY_CATALOG = deepFreeze([
  active(
    "file-read",
    300,
    "capabilities/file-read.md",
    tools("read", "grep", "find", "ls"),
  ),
  active(
    "file-mutation",
    310,
    "capabilities/file-mutation.md",
    tools("write", "edit"),
  ),
  active("shell", 320, "capabilities/shell.md", tools("bash")),
  active(
    "document-processing",
    330,
    "capabilities/document-processing.md",
    tools(
      "read_doc",
      "write_docx",
      "write_xlsx",
      "write_pptx",
      "edit_docx",
      "edit_docx_free",
      "edit_xlsx",
      "edit_pptx",
    ),
  ),
  active(
    "web-research",
    340,
    "capabilities/web-research.md",
    tools("web_search", "web_fetch"),
  ),
  active(
    "knowledge-retrieval",
    350,
    "capabilities/knowledge-retrieval.md",
    tools("rag_index", "rag_query", "rag_refresh", "rag_status"),
  ),
  active(
    "memory",
    360,
    "capabilities/memory.md",
    tools("memory_recall", "memory_write"),
  ),
  active(
    "computer-use",
    370,
    "capabilities/computer-use.md",
    tools(
      "computer",
      "screenshot",
      "mouse_click",
      "mouse_move",
      "key_type",
      "app_focus",
      "cursor_pos",
    ),
  ),
  active(
    "visualization",
    380,
    "capabilities/visualization.md",
    tools("widget_guidelines", "read_me", "show_widget"),
  ),
  active(
    "task-management",
    390,
    "capabilities/task-management.md",
    tools("goal_complete"),
  ),
  active(
    "subagent",
    400,
    "capabilities/subagent.md",
    tools("subagent"),
  ),
  active(
    "user-interaction",
    410,
    "capabilities/user-interaction.md",
    tools("ask_user_question"),
  ),
  active(
    "artifact-delivery",
    420,
    "capabilities/artifact-delivery.md",
    tools("present_files"),
  ),
  active(
    "cloud-connectors",
    430,
    "capabilities/cloud-connectors.md",
    tools("connect_cloud_service", "connector_cli_execute"),
  ),
  resource("skills", 440, "capabilities/skills.md", "skill-resources"),
  resource("mcp", 450, "capabilities/mcp.md", "selected-mcp-tools"),
  active(
    "skill-draft",
    460,
    "capabilities/skill-draft.md",
    tools(
      "skill_draft_init",
      "skill_draft_list",
      "skill_draft_read",
      "skill_draft_write",
      "skill_draft_import_attachment",
      "skill_draft_delete",
      "skill_draft_validate",
    ),
  ),
  active(
    "expert-draft",
    470,
    "capabilities/expert-draft.md",
    tools(
      "expert_draft_list",
      "expert_draft_read",
      "expert_draft_write",
      "expert_draft_delete",
      "expert_draft_validate",
      "expert_draft_publish",
    ),
  ),
  dormant("browser-control", 480, "capabilities/browser-control.md"),
  active("automation", 490, "capabilities/automation.md", tools("automation_update")),
] as const satisfies readonly CapabilityDefinition[]);

export const PROMPTLESS_TOOL_NAMES = deepFreeze([] as const);
const PROMPTLESS_TOOL_NAME_SET = new Set<string>(PROMPTLESS_TOOL_NAMES);

/** 插件工具名（运行时动态注册）：与 MCP 工具一样豁免静态目录校验。 */
const PLUGIN_TOOL_NAME_SET = new Set<string>();

export function registerPluginToolNames(names: Iterable<string>): void {
  for (const name of names) PLUGIN_TOOL_NAME_SET.add(name);
}

export function unregisterPluginToolNames(names: Iterable<string>): void {
  for (const name of names) PLUGIN_TOOL_NAME_SET.delete(name);
}

const CATALOG_REVISION = createHash("sha256")
  .update(JSON.stringify(CAPABILITY_CATALOG))
  .digest("hex");

const FIXED_TOOL_NAMES = new Set(
  CAPABILITY_CATALOG.flatMap((definition) => {
    if (
      definition.status === "dormant" ||
      definition.activation.kind !== "tools"
    ) {
      return [];
    }
    return [
      ...(definition.activation.anyTools ?? []),
      ...(definition.activation.allTools ?? []),
    ];
  }),
);

function uniqueToolNames(toolsInput: readonly AgentTool[]): string[] {
  const seen = new Set<string>();
  const names: string[] = [];
  for (const tool of toolsInput) {
    if (seen.has(tool.name)) continue;
    seen.add(tool.name);
    names.push(tool.name);
  }
  return names;
}

function isActive(
  definition: CapabilityDefinition,
  context: CapabilityActivationContext,
  activeToolNameSet: ReadonlySet<string>,
): boolean {
  if (definition.status === "dormant") return false;

  switch (definition.activation.kind) {
    case "tools": {
      const { anyTools = [], allTools = [] } = definition.activation;
      return (
        anyTools.some((name) => activeToolNameSet.has(name)) ||
        (allTools.length > 0 &&
          allTools.every((name) => activeToolNameSet.has(name)))
      );
    }
    case "skill-resources":
      return context.skillNames.length > 0;
    case "selected-mcp-tools": {
      for (const name of context.selectedMcpToolNames) {
        if (activeToolNameSet.has(name)) return true;
      }
      return false;
    }
  }
}

export function resolveCapabilityContext(
  input: CapabilityActivationContext,
): CapabilityContext {
  const activeToolNames = uniqueToolNames(input.tools);
  const activeToolNameSet = new Set(activeToolNames);
  const groups = [...CAPABILITY_CATALOG]
    .sort((left, right) => left.order - right.order)
    .filter((definition) => isActive(definition, input, activeToolNameSet))
    .map((definition) => definition.id);

  return {
    groups,
    activeToolNames,
    catalogRevision: CATALOG_REVISION,
  };
}

export function assertCapabilityAssignments(
  toolsInput: readonly AgentTool[],
  selectedMcpToolNames: ReadonlySet<string> = new Set(),
): void {
  const unclassified = uniqueToolNames(toolsInput).filter(
    (name) =>
      !FIXED_TOOL_NAMES.has(name) &&
      !selectedMcpToolNames.has(name) &&
      !PROMPTLESS_TOOL_NAME_SET.has(name) &&
      !PLUGIN_TOOL_NAME_SET.has(name),
  );
  if (unclassified.length === 0) return;

  throw new PromptRuntimeError(
    "PROMPT_TOOL_UNCLASSIFIED",
    500,
    `Unclassified tool(s): ${unclassified.join(", ")}. Every tool requires an exact capability assignment.`,
  );
}
