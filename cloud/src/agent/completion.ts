import type { Agent } from '@earendil-works/pi-agent-core';

/** Adapted from desktop completion_boundary.ts. Block every member of a mixed
 * batch, not just the declaration, so siblings cannot mutate before rejection. */
export function installCompletionBoundary(agent: Agent, accepted: () => boolean | Promise<boolean>): void {
  const before = agent.beforeToolCall;
  agent.beforeToolCall = async (context, signal) => {
    if (await accepted()) return { block: true, reason: 'Completion accepted; business tools are frozen.' };
    const calls = context.assistantMessage.content.filter(part => part.type === 'toolCall');
    if (calls.some(call => call.name === 'goal_complete') && calls.length !== 1) {
      return { block: true, reason: 'goal_complete must be the only call in its batch; perform other operations first.' };
    }
    return before?.(context, signal);
  };
}

/** A model may stop after publishing files without invoking the completion tool.
 * Give it at most two explicit repair turns; never manufacture evidence or bypass verification. */
export async function verifyWithCompletionRepair(
  verify: () => Promise<void>,
  repair: () => Promise<void>,
  signal: AbortSignal,
): Promise<void> {
  for (let attempt = 0; ; attempt++) {
    signal.throwIfAborted();
    try { await verify(); return; }
    catch (error) {
      if (!(error instanceof Error) || error.message !== 'GOAL_DECLARATION_REQUIRED' || attempt >= 2) throw error;
    }
    signal.throwIfAborted();
    await repair();
  }
}

export const COMPLETION_REPAIR_MESSAGE = {
  customType: 'cloud-completion-repair',
  display: false,
  content: 'Files have been published, but this run has no accepted goal_complete declaration. Before ending, call goal_complete alone with an honest summary and specific verification evidence from this run. Do not recreate or republish unchanged files. If checks fail, correct the actual problem and republish changed files before declaring success. Do not invent proof or claim success when verification has failed.',
};
