import { join } from "node:path";

import { resolveBuiltinSkillsDir } from "./builtin_skills/installer.ts";
import { getConversation } from "../domains/session/node/store.ts";

export interface ExpertManagerContext {
  skillRoot: string;
}

export interface ExpertManagerContextDependencies {
  resolveBuiltinDir?: () => Promise<string>;
  getConversation?: typeof getConversation;
}

export async function expertManagerContextForConversation(
  category: string,
  conversationId: string,
  dependencies: ExpertManagerContextDependencies = {},
): Promise<ExpertManagerContext | null> {
  if (category !== "expert_creator") return null;
  const resolveBuiltinDir = dependencies.resolveBuiltinDir ?? resolveBuiltinSkillsDir;
  const readConversation = dependencies.getConversation ?? getConversation;
  const conversation = readConversation(conversationId);
  if (
    conversation?.expertOperation === "edit" &&
    (!conversation.expertTargetId || !conversation.expertTargetRevision || !conversation.expertDraftRoot)
  ) {
    throw new Error("expert edit metadata is incomplete");
  }
  const builtinDir = await resolveBuiltinDir();
  const skillRoot = join(builtinDir, "expert-manager");
  return { skillRoot };
}
