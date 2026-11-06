export type PromptRuntimeErrorCode =
  | "CATEGORY_MODE_NOT_ALLOWED"
  | "PROMPT_SOURCE_FAILED"
  | "PROMPT_FRAGMENT_INVALID"
  | "PROMPT_FRAGMENT_BUDGET_EXCEEDED"
  | "PROMPT_CAPABILITY_UNKNOWN"
  | "PROMPT_TOOL_UNCLASSIFIED"
  | "PROMPT_TOOL_METADATA_INVALID"
  | "PROMPT_CONTEXT_LIMIT_EXCEEDED"
  | "INVOCATION_NOT_FOUND"
  | "MCP_SELECTION_INVALID";

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
    this.name = "PromptRuntimeError";
    this.code = code;
    this.status = status;
  }
}
