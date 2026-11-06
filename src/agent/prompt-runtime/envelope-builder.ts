import {
  renderCapabilityBlock,
  renderEnvironmentBlock,
  renderExpertBlock,
  renderMemoryBlock,
  renderSettingsBlock,
  renderSkillBlock,
  renderTurnPayload,
  renderWorkspaceBlock,
} from "./block-renderers.ts";
import { substituteArgs } from "../../vendor/pi_coding_agent.ts";
import { PromptRuntimeError } from "./diagnostics.ts";
import { buildPromptManifest } from "./manifest.ts";
import {
  assertPromptByteBudget,
  composePromptParts,
  PROMPT_BYTE_BUDGETS,
} from "./prompt-budget.ts";
import type { LoadedPromptFragment } from "./prompt-packs.ts";
import type {
  PromptContextSnapshot,
  PromptEnvelope,
  RuntimeProfile,
} from "./types.ts";

export function buildPromptEnvelope(input: {
  profile: RuntimeProfile;
  snapshot: PromptContextSnapshot;
  fragments: readonly LoadedPromptFragment[];
  invocation?: PromptEnvelope["invocation"];
}): PromptEnvelope {
  const systemFragments = input.fragments
    .filter((fragment) => fragment.surface === "system")
    .map((fragment) => fragment.content);
  const dynamicBlocks = [
    renderEnvironmentBlock(input.snapshot.environment),
    renderWorkspaceBlock(input.snapshot.workspace),
    renderSettingsBlock(input.snapshot.settings),
    renderMemoryBlock(input.snapshot.memory),
    renderSkillBlock(input.snapshot.skills),
    ...(input.snapshot.expert
      ? [renderExpertBlock(input.snapshot.expert)]
      : []),
    renderCapabilityBlock(input.snapshot.capabilities),
  ];
  const turnFragments = input.fragments
    .filter((fragment) => fragment.surface === "turn")
    .map((fragment) => fragment.content);
  let templatePrompt = "";
  if (input.invocation?.kind === "prompt_template") {
    const template = (input.profile.resources.promptTemplates ?? []).find(
      (candidate) => candidate.name === input.invocation?.name,
    );
    if (!template) {
      throw new PromptRuntimeError(
        "INVOCATION_NOT_FOUND",
        404,
        `Prompt template ${input.invocation.name} is not registered`,
      );
    }
    templatePrompt = substituteArgs(
      template.content,
      input.invocation.args,
    );
  }
  const userPrompt = composePromptParts([
    templatePrompt,
    ...turnFragments,
    renderTurnPayload(input.snapshot.turn),
  ]);
  const systemPrompt = composePromptParts([...systemFragments, ...dynamicBlocks]);
  assertPromptByteBudget(
    "rendered system prompt",
    systemPrompt,
    PROMPT_BYTE_BUDGETS.systemBytes,
  );

  return {
    snapshotId: input.snapshot.snapshotId,
    turnId: input.snapshot.turnId,
    systemPrompt,
    userPrompt,
    tools: [...input.profile.tools],
    activeToolNames: [...input.profile.activeToolNames],
    resources: input.profile.resources,
    permissionPolicy: input.profile.permissionPolicy,
    invocation: input.invocation,
    manifest: buildPromptManifest(input),
  };
}
