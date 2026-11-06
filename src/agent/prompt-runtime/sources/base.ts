import { createHash } from "node:crypto";

import type {
  PromptDiagnostic,
  SourceRevision,
} from "../types.ts";

export interface PromptSourceResult<T> {
  value: T;
  revision: SourceRevision;
  diagnostics: PromptDiagnostic[];
}

export function sourceRevision(value: unknown): SourceRevision {
  const serialized = JSON.stringify(value);
  return {
    revision: createHash("sha256").update(serialized).digest("hex"),
    contentHash: createHash("sha256").update(serialized).digest("hex"),
    bytes: Buffer.byteLength(serialized),
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
  budget: number,
  render: (entry: T) => string,
): { included: T[]; dropped: number; text: string } {
  const included: T[] = [];
  const rendered: string[] = [];
  let used = 0;
  for (const entry of entries) {
    const text = render(entry);
    if (used + text.length > budget) continue;
    included.push(entry);
    rendered.push(text);
    used += text.length;
  }
  return {
    included,
    dropped: entries.length - included.length,
    text: rendered.join(""),
  };
}
