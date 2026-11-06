export function deriveWorkspaceSelection(
  currentConversationId: string | null,
  conversationWorkspaceId: string | null | undefined,
  composerWorkspaceId: string | null,
): string | null {
  return currentConversationId
    ? conversationWorkspaceId ?? null
    : composerWorkspaceId;
}

export type WorkspaceActivationTarget =
  | { kind: "composer" }
  | { kind: "conversation"; conversationId: string };

export function resolveWorkspaceActivationTarget(
  currentConversationId: string | null,
): WorkspaceActivationTarget {
  return currentConversationId
    ? { kind: "conversation", conversationId: currentConversationId }
    : { kind: "composer" };
}
