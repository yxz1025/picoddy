import { renderExpertBlock } from './block-renderers.ts';
import { PromptRuntimeError } from './diagnostics.ts';
import { PROMPT_BYTE_BUDGETS, utf8ByteLength } from './prompt-budget.ts';
import type { CloudExpertContext } from './types.ts';

export function assertExpertContextBudget(value: CloudExpertContext): void {
  if (utf8ByteLength(value.instructions) > 8_000 ||
      utf8ByteLength(renderExpertBlock(value)) > PROMPT_BYTE_BUDGETS.fragmentBytes) {
    throw new PromptRuntimeError('PROMPT_CONTEXT_LIMIT_EXCEEDED', 400,
      'Expert instructions exceed the 8000-byte input or 12000-byte encoded context limit; shorten the instructions.');
  }
}
