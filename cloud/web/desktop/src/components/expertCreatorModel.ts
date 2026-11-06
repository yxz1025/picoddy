export const EXPERT_MANAGER_SKILL_COMMAND = "/expert-manager";
export const EXPERT_CREATOR_PROMPT =
  "帮我创建一个 XXX 专家，擅长 XXXXX。我的经验是：[请补充你的行业背景、相关经验]";

export interface ExpertComposerBootstrap {
  conversationId: string;
  text: string;
  expertManagerToken: boolean;
}

export function createExpertComposerBootstrap(
  conversationId: string,
  options: { text?: string; expertManagerToken?: boolean } = {},
): ExpertComposerBootstrap {
  return {
    conversationId,
    text: options.text ?? EXPERT_CREATOR_PROMPT,
    expertManagerToken: options.expertManagerToken ?? true,
  };
}

export function takeExpertComposerBootstrap(
  bootstrap: ExpertComposerBootstrap | null,
  conversationId: string | null,
): {
  bootstrap: ExpertComposerBootstrap | null;
  remaining: ExpertComposerBootstrap | null;
} {
  if (!bootstrap || !conversationId || bootstrap.conversationId !== conversationId) {
    return { bootstrap: null, remaining: bootstrap };
  }
  return { bootstrap, remaining: null };
}
