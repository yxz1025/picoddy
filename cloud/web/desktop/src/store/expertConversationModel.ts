import type { ExpertSummary } from "../types/experts";
import type { Conversation } from "./useStore";

export interface ActiveExpertBindingPresentation {
  expertId: string;
  revision: string;
  catalogSource: ExpertSummary["catalogSource"];
}

export function presentActiveExpert(
  conversations: readonly Conversation[],
  createdConversation: Conversation,
  expert: ExpertSummary,
  binding?: ActiveExpertBindingPresentation,
): Conversation[] {
  const expertFields = {
    expertId: binding?.expertId ?? expert.id,
    expertRevision: binding?.revision ?? expert.revision,
    expertCatalogSource: binding?.catalogSource ?? expert.catalogSource,
    expert,
  };
  let found = false;
  const next = conversations.map((conversation) => {
    if (conversation.id !== createdConversation.id) return conversation;
    found = true;
    return {
      ...conversation,
      ...expertFields,
    };
  });

  return found
    ? next
    : [{ ...createdConversation, ...expertFields }, ...next];
}
