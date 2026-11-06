// Ported without behavioral changes from
// src/agent/prompt-runtime/prompt-budget.ts
// desktop source sha256: d3eb68a6fc08c438a3bd0f3f5614a68256f7466e600d09b90c4e793a503cc821

import { PromptRuntimeError } from './diagnostics.ts';

export const PROMPT_BYTE_BUDGETS = Object.freeze({
  fragmentBytes: 12_000,
  settingsBytes: 48_000,
  coreBytes: 32_000,
  systemBytes: 64_000,
});

export function utf8ByteLength(text: string): number {
  return Buffer.byteLength(text, 'utf8');
}

export function composePromptParts(parts: readonly string[]): string {
  return parts.join('\n\n');
}

export function assertPromptByteBudget(
  scope: string,
  text: string,
  maxBytes: number,
): void {
  const actualBytes = utf8ByteLength(text);
  if (actualBytes <= maxBytes) return;
  throw new PromptRuntimeError(
    'PROMPT_FRAGMENT_BUDGET_EXCEEDED',
    500,
    `Prompt ${scope} exceeds budget: ${actualBytes} bytes (max ${maxBytes} bytes)`,
  );
}
