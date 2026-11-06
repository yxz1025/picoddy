import { PromptRuntimeError } from "./diagnostics.ts";

export const PROMPT_BYTE_BUDGETS = Object.freeze({
  fragmentBytes: 12_000,
  coreBytes: 32_000,
  systemBytes: 64_000,
});

export function utf8ByteLength(text: string): number {
  return Buffer.byteLength(text, "utf8");
}

export function composePromptParts(parts: readonly string[]): string {
  // Exact duplicates only: preserve ordering, distinct versions and wording.
  return [...new Set(parts.filter(Boolean))].join("\n\n");
}

export function assertPromptByteBudget(
  scope: string,
  text: string,
  maxBytes: number,
): void {
  const actualBytes = utf8ByteLength(text);
  if (actualBytes <= maxBytes) return;
  throw new PromptRuntimeError(
    "PROMPT_FRAGMENT_BUDGET_EXCEEDED",
    500,
    `Prompt ${scope} exceeds budget: ${actualBytes} bytes (max ${maxBytes} bytes)`,
  );
}
