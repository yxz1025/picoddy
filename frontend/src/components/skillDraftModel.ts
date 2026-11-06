import type { SkillDraft } from "../api/skillDrafts";

export type DraftInstallState = "empty" | "invalid" | "ready" | "installed";

export const SKILL_CREATOR_COMMAND = "/skill-creator";

export function creatorConversation(
  conversation?: { category?: string } | null,
): boolean {
  return conversation?.category === "skill_creator";
}

type CreatorMessageRef = { id: string; role: string };

export function creatorComposerContext(
  conversation?: { category?: string } | null,
  messages: readonly CreatorMessageRef[] = [],
): { command: string; label: string } | null {
  return creatorConversation(conversation) &&
    !messages.some((message) => message.role === "user")
    ? { command: SKILL_CREATOR_COMMAND, label: "skill-creator" }
    : null;
}

export function isCreatorFirstUserMessage(
  conversation: { category?: string } | null | undefined,
  messages: readonly CreatorMessageRef[],
  message: CreatorMessageRef,
): boolean {
  if (!creatorConversation(conversation) || message.role !== "user") return false;
  return messages.find((item) => item.role === "user")?.id === message.id;
}

export function shouldShowSkillDraftPanel(
  draft?: {
    status: "editing" | "valid" | "installed";
    revisionOf?: string;
    validation?: { valid: boolean };
  } | null,
): boolean {
  if (!draft) return false;
  if (draft.status === "installed" || draft.revisionOf) return true;
  return draft.status === "valid" && draft.validation?.valid === true;
}

export function draftInstallState(
  draft?: Pick<SkillDraft, "status"> & {
    validation?: Pick<NonNullable<SkillDraft["validation"]>, "valid">;
  },
): DraftInstallState {
  if (!draft) return "empty";
  if (draft.status === "installed") return "installed";
  if (draft.status === "valid" && draft.validation?.valid) return "ready";
  return "invalid";
}
