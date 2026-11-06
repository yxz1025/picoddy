import { parseCommandArgs } from "../../vendor/pi_coding_agent.ts";
import type { PromptTemplate, Skill } from "@earendil-works/pi-coding-agent";

import { PromptRuntimeError } from "./diagnostics.ts";
import type {
  AttachmentContextItem,
  ConnectorContextItem,
  FileReferenceContext,
  TurnIntent,
} from "./types.ts";

export interface ResolveTurnIntentInput {
  turnId: string;
  text: string;
  skills: readonly Skill[];
  promptTemplates: readonly PromptTemplate[];
  attachments: AttachmentContextItem[];
  fileReferences: FileReferenceContext[];
  connectorContext: ConnectorContextItem[];
  referenceExpertId?: string;
  selectedExpertSkills: string[];
  selectedExpertSkillInputs?: TurnIntent["selectedExpertSkillInputs"];
  categoryRuntime?: TurnIntent["categoryRuntime"];
}

function byFoldedName<T extends { name: string }>(
  values: readonly T[],
  name: string,
): T | undefined {
  const folded = name.toLocaleLowerCase("en-US");
  return values.find((value) =>
    value.name.toLocaleLowerCase("en-US") === folded
  );
}

function findSkillByInvocationName<T extends { name: string }>(
  skills: readonly T[],
  requestedName: string,
): T | undefined {
  const direct = byFoldedName(skills, requestedName);
  if (direct) return direct;
  // Backward compatibility for skills installed by the old namespace--slug layout.
  const separator = requestedName.lastIndexOf("--");
  return separator >= 0
    ? byFoldedName(skills, requestedName.slice(separator + 2))
    : undefined;
}

function normalizeBuiltinActionText(text: string): string {
  const subagent = text.match(/^\/subagent(?:\s+([\s\S]*))?$/iu);
  if (!subagent) return text;
  const task = subagent[1]?.trim() ?? "";
  return task
    ? `请使用子代理执行以下独立任务：${task}`
    : "请使用子代理执行一个独立任务；如果任务不明确，请先向我确认。";
}

export function resolveTurnIntent(input: ResolveTurnIntentInput): TurnIntent {
  const text = normalizeBuiltinActionText(input.text);
  const slash = text.match(/^\/([a-zA-Z0-9_-]+)(?:\s+([\s\S]*))?$/u);
  let invocation: TurnIntent["invocation"];

  if (slash) {
    const requestedName = slash[1];
    const remainder = slash[2]?.trim() ?? "";
    const skill = findSkillByInvocationName(input.skills, requestedName);
    if (skill) {
      invocation = {
        kind: "skill",
        name: skill.name,
        instructions: remainder,
      };
    } else {
      const template = byFoldedName(input.promptTemplates, requestedName);
      if (!template) {
        throw new PromptRuntimeError(
          "INVOCATION_NOT_FOUND",
          404,
          `Invocation ${requestedName} is not registered`,
        );
      }
      invocation = {
        kind: "prompt_template",
        name: template.name,
        args: parseCommandArgs(remainder),
      };
    }
  }

  return {
    turnId: input.turnId,
    rawText: text,
    invocation,
    attachments: input.attachments,
    fileReferences: input.fileReferences,
    connectorContext: input.connectorContext,
    referenceExpertId: input.referenceExpertId,
    selectedExpertSkills: input.selectedExpertSkills,
    selectedExpertSkillInputs: input.selectedExpertSkillInputs,
    categoryRuntime: input.categoryRuntime,
  };
}
