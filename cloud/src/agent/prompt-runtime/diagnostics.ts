// Ported from src/agent/prompt-runtime/diagnostics.ts
// desktop source sha256: 479194c5c94899f66632d48e972ecfe551c8f8421f716fd6e8b4fab036adeff7
// Cloud keeps the desktop codes used by this runtime subset.

export type PromptRuntimeErrorCode =
  | 'PROMPT_SOURCE_FAILED'
  | 'PROMPT_FRAGMENT_INVALID'
  | 'PROMPT_FRAGMENT_BUDGET_EXCEEDED'
  | 'PROMPT_CONTEXT_LIMIT_EXCEEDED'
  | 'MODE_UNSUPPORTED'
  | 'CATEGORY_UNSUPPORTED'
  | 'PERMISSION_UNSUPPORTED'
  | 'PROMPT_TOOL_UNCLASSIFIED';

export class PromptRuntimeError extends Error {
  readonly code: PromptRuntimeErrorCode;
  readonly status: number;

  constructor(
    code: PromptRuntimeErrorCode,
    status: number,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'PromptRuntimeError';
    this.code = code;
    this.status = status;
  }
}
