// Adapted from src/agent/prompt-runtime/sources/base.ts
// desktop source sha256: 0c6c6a31a72c36528497a25d51f6bcbc7d76e905736f3a9c53c2baa6bf7fafbc
// Cloud delta: entry limits are measured in UTF-8 bytes, matching prompt budgets.

import { createHash } from 'node:crypto';

import { utf8ByteLength } from '../prompt-budget.ts';
import type { PromptDiagnostic, SourceRevision } from '../types.ts';

export interface PromptSourceResult<T> {
  value: T;
  revision: SourceRevision;
  diagnostics: PromptDiagnostic[];
}

export function sourceRevision(value: unknown): SourceRevision {
  const serialized = JSON.stringify(value);
  const contentHash = createHash('sha256').update(serialized).digest('hex');
  return {
    revision: contentHash,
    contentHash,
    bytes: utf8ByteLength(serialized),
    truncated: false,
  };
}

export function sourceResult<T>(
  value: T,
  diagnostics: PromptDiagnostic[] = [],
  truncated = false,
): PromptSourceResult<T> {
  return {
    value,
    revision: { ...sourceRevision(value), truncated },
    diagnostics,
  };
}

export function takeWholeEntriesWithinBudget<T>(
  entries: readonly T[],
  budgetBytes: number,
  render: (entry: T) => string,
): { included: T[]; dropped: number; bytes: number } {
  const included: T[] = [];
  let usedBytes = 0;
  for (const entry of entries) {
    const entryBytes = utf8ByteLength(render(entry));
    if (usedBytes + entryBytes > budgetBytes) continue;
    included.push(entry);
    usedBytes += entryBytes;
  }
  return {
    included,
    dropped: entries.length - included.length,
    bytes: usedBytes,
  };
}
