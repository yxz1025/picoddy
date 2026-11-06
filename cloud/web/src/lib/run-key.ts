import { randomUUID } from "./uuid";
import type { RunInput } from "../types";

export function createRunFingerprint(input: RunInput): string {
  return JSON.stringify({
    prompt: input.prompt.trim(),
    skillIds: [...input.skillIds].sort(),
    connectorIds: [...input.connectorIds].sort(),
    fileIds: [...input.fileIds].sort(),
    expertId: input.expertId ?? null,
    modelId: input.modelId ?? null,
  });
}

interface StoredRunKey {
  fingerprint: string;
  key: string;
}

function storageKey(conversationId: string): string {
  return `picoddy:run:${conversationId}`;
}

export function getRunIdempotencyKey(conversationId: string, input: RunInput): string {
  const fingerprint = createRunFingerprint(input);
  const key = storageKey(conversationId);
  try {
    const stored = JSON.parse(sessionStorage.getItem(key) ?? "null") as StoredRunKey | null;
    if (stored?.fingerprint === fingerprint && stored.key) return stored.key;
  } catch {
    sessionStorage.removeItem(key);
  }
  const next = { fingerprint, key: randomUUID() };
  sessionStorage.setItem(key, JSON.stringify(next));
  return next.key;
}

export function clearRunIdempotencyKey(conversationId: string): void {
  sessionStorage.removeItem(storageKey(conversationId));
}
