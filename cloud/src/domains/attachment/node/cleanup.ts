import { randomUUID } from 'node:crypto';

import type { Database } from '../../../infra/db.ts';
import type { Storage } from '../../../platform/storage.ts';
import { createAttachmentStore } from './store.ts';

export interface CleanupFileDeletionsDependencies {
  database: Database;
  storage: Storage;
  batchSize?: number;
  maxAttempts?: number;
  leaseMs?: number;
  signal?: AbortSignal;
}

export interface CleanupFileDeletionsResult {
  claimed: number;
  deleted: number;
  failed: number;
  exhausted: number;
}

function boundedInteger(
  value: number | undefined,
  fallback: number,
  minimum: number,
  maximum: number,
  name: string,
): number {
  const result = value ?? fallback;
  if (!Number.isSafeInteger(result) || result < minimum || result > maximum) {
    throw new Error(`${name} must be an integer between ${minimum} and ${maximum}`);
  }
  return result;
}

function retryAt(attempt: number): Date {
  const delayMs = Math.min(60 * 60_000, 30_000 * (2 ** Math.min(attempt - 1, 7)));
  return new Date(Date.now() + delayMs);
}

function errorMessage(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).slice(0, 2_000);
}

/**
 * Claims and processes one bounded outbox batch. Failed rows remain durable;
 * rows at maxAttempts stay unleased for inspection and are not claimed again.
 */
export async function cleanupFileDeletions(
  dependencies: CleanupFileDeletionsDependencies,
): Promise<CleanupFileDeletionsResult> {
  const batchSize = boundedInteger(dependencies.batchSize, 25, 1, 100, 'batchSize');
  const maxAttempts = boundedInteger(dependencies.maxAttempts, 5, 1, 100, 'maxAttempts');
  const leaseMs = boundedInteger(dependencies.leaseMs, 60_000, 1_000, 10 * 60_000, 'leaseMs');
  dependencies.signal?.throwIfAborted();

  const store = createAttachmentStore(dependencies.database);
  const leaseToken = randomUUID();
  const jobs = await store.claimDeletions({
    maxAttempts,
    limit: batchSize,
    leaseToken,
    leaseUntil: new Date(Date.now() + leaseMs),
  });
  const result: CleanupFileDeletionsResult = {
    claimed: jobs.length,
    deleted: 0,
    failed: 0,
    exhausted: 0,
  };

  for (const job of jobs) {
    dependencies.signal?.throwIfAborted();
    try {
      await dependencies.storage.remove(job.object_key);
      await store.completeDeletion(job.id, job.lease_token);
      result.deleted += 1;
    } catch (error) {
      const attempt = job.attempts + 1;
      await store.failDeletion(job.id, job.lease_token, errorMessage(error), retryAt(attempt));
      result.failed += 1;
      if (attempt >= maxAttempts) result.exhausted += 1;
    }
  }
  return result;
}
