import type { AgentTool } from "@earendil-works/pi-agent-core";

import type { PermLevel } from "../permissions.ts";
import type {
  ConnectorChildRef,
  ExpertOperation,
  InteractionMode,
  SessionCategory,
  SessionIntent,
  SkillOperation,
  SubagentChildRef,
} from "./types.ts";

export interface PersistedConversationIntent {
  category?: string | null;
  modelProvider?: string | null;
  modelId?: string | null;
  workspacePath?: string | null;
  expertId?: string | null;
  expertRevision?: string | null;
  expertCatalogSource?: string | null;
  expertOperation?: ExpertOperation | null;
  skillOperation?: SkillOperation | null;
  skillTargetName?: string | null;
}

export interface ResolveSessionIntentInput {
  sessionId: string;
  mode: InteractionMode;
  permission: PermLevel;
  selectedSkillNames: string[];
  selectedMcpTools: AgentTool[];
  /** 受管连接器子会话的结构化绑定（隐藏 connector child）。 */
  connector?: ConnectorChildRef;
  subagent?: SubagentChildRef;
}

export interface SessionIntentDependencies {
  loadConversation(sessionId: string): Promise<PersistedConversationIntent>;
}

function categoryOf(value: string | null | undefined): SessionCategory {
  if (
    value === "skill_creator" || value === "expert_creator" ||
    value === "connector-agent"
  ) return value;
  return "assistant";
}

export async function resolveSessionIntent(
  input: ResolveSessionIntentInput,
  dependencies: SessionIntentDependencies,
): Promise<SessionIntent> {
  const persisted = await dependencies.loadConversation(input.sessionId);
  const expertId = persisted.expertId?.trim();
  const connector = input.connector;
  const subagent = input.subagent;
  return {
    sessionId: input.sessionId,
    modelProvider: persisted.modelProvider || "deepseek",
    modelId: persisted.modelId || "deepseek-v4-flash",
    category: connector
      ? "connector-agent"
      : subagent
      ? "subagent"
      : categoryOf(persisted.category),
    interactionMode: input.mode,
    permission: input.permission,
    workspace: { path: persisted.workspacePath },
    ...(expertId
      ? {
        expertBinding: {
          expertId,
          ...(persisted.expertRevision
            ? { revision: persisted.expertRevision }
            : {}),
          ...(persisted.expertCatalogSource
            ? { source: persisted.expertCatalogSource }
            : {}),
        },
      }
      : {}),
    ...(persisted.expertOperation
      ? { expertOperation: persisted.expertOperation }
      : {}),
    ...(persisted.skillOperation
      ? { skillOperation: persisted.skillOperation }
      : {}),
    ...(persisted.skillTargetName
      ? { skillTargetName: persisted.skillTargetName }
      : {}),
    ...(connector ? { connector } : {}),
    ...(subagent ? { subagent } : {}),
    selectedSkillNames: [...input.selectedSkillNames],
    selectedMcpTools: [...input.selectedMcpTools],
  };
}
