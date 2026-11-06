import type {
  SkillDraftMetadata,
  SkillDraftStore,
} from "../domains/skill-draft/node/store.ts";

export type SkillDraftResolver = (
  conversationId: string,
) => Promise<SkillDraftMetadata>;

export interface SkillCreatorContext {
  draft: SkillDraftMetadata;
}

async function getSkillDraftStore(): Promise<SkillDraftStore> {
  const { skillDraftStore } = await import(
    "../domains/skill-draft/node/store.ts"
  );
  return skillDraftStore;
}

async function resolveDefaultDraft(
  conversationId: string,
): Promise<SkillDraftMetadata> {
  return await (await getSkillDraftStore()).getOrCreateForConversation(
    conversationId,
  );
}

export async function creatorContextForConversation(
  category: string,
  conversationId: string,
  resolveDraft: SkillDraftResolver = resolveDefaultDraft,
): Promise<SkillCreatorContext | null> {
  if (category !== "skill_creator") return null;

  const draft = await resolveDraft(conversationId);
  return { draft };
}
