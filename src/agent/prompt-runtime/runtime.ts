import { ContextAssembler, type SnapshotSource } from "./context-assembler.ts";
import { PromptRuntimeError } from "./diagnostics.ts";
import { buildPromptEnvelope } from "./envelope-builder.ts";
import { loadPromptFragments } from "./fragment-loader.ts";
import { selectPromptPackDefinitions } from "./prompt-packs.ts";
import type {
  PromptEnvelope,
  RuntimeProfile,
  TurnIntent,
} from "./types.ts";

export interface BuildPromptRuntimeEnvelopeInput {
  profile: RuntimeProfile;
  turn: TurnIntent;
  sources: readonly SnapshotSource[];
  promptRoot: string;
  createdAt?: string;
  snapshotId?: string;
}

/** Build the only immutable prompt snapshot consumed by one queued turn */
export async function buildPromptRuntimeEnvelope(
  input: BuildPromptRuntimeEnvelopeInput,
): Promise<PromptEnvelope> {
  let invocation = input.turn.invocation;
  const forced = input.profile.category.forcedInvocation;
  if (forced) {
    const skill = (input.profile.resources.skills ?? []).find(
      (candidate) => candidate.name === forced,
    );
    if (!skill) {
      throw new PromptRuntimeError(
        "INVOCATION_NOT_FOUND",
        500,
        `Required category skill ${forced} is not registered`,
      );
    }
    invocation = { kind: "skill", name: skill.name, instructions: "" };
  }

  const snapshot = await new ContextAssembler(input.sources).assemble({
    sessionId: input.profile.session.sessionId,
    turnId: input.turn.turnId,
    createdAt: input.createdAt,
    snapshotId: input.snapshotId,
  });
  const category = input.profile.category.toolPack === "expert_creator_edit"
    ? "expert_editor"
    : input.profile.category.toolPack === "skill_creator_edit"
    ? "skill_editor"
    : input.profile.category.id;
  const definitions = selectPromptPackDefinitions({
    mode: input.profile.mode.id,
    category,
    capabilityGroups: snapshot.capabilities.groups,
    hasMemoryContext:
      snapshot.memory.working.length > 0 || snapshot.memory.user.length > 0,
  });
  const fragments = await loadPromptFragments(input.promptRoot, definitions);
  return buildPromptEnvelope({
    profile: input.profile,
    snapshot,
    fragments,
    invocation,
  });
}
