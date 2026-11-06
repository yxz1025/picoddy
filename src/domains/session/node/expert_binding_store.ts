// Session-level expert binding persistence.
//
// The binding deliberately lives on the conversations row for the current
// single-expert-per-session model.  Keeping this small store injectable makes
// the persistence contract testable without opening the user's database.

import type { DatabaseSync } from "node:sqlite";

import type {
  ExpertBinding,
  ExpertCatalogSource,
} from "../../../agent/experts/types.ts";
import { getDb } from "../../../infra/db.ts";

export interface ExpertBindingRecord {
  expertId: string | null;
  expertRevision: string | null;
  expertCatalogSource: ExpertCatalogSource | null;
}

export interface ExpertBindingStore {
  /** Returns the nullable binding columns, or null if the conversation is absent. */
  get(conversationId: string): ExpertBindingRecord | null;
  /** Updates all binding columns atomically for an existing conversation. */
  set(conversationId: string, binding: ExpertBinding | null): void;
  /** Copies the complete binding from one existing conversation to another. */
  copy(sourceConversationId: string, targetConversationId: string): void;
}

function asRecord(row: Record<string, unknown> | undefined): ExpertBindingRecord | null {
  if (!row) return null;
  const source = row.expertCatalogSource;
  return {
    expertId: (row.expertId as string | null | undefined) ?? null,
    expertRevision: (row.expertRevision as string | null | undefined) ?? null,
    expertCatalogSource:
      source === "builtin" || source === "installed" || source === "catalog"
        ? source
        : null,
  };
}

function assertOneChange(result: { changes: number | bigint }, operation: string): void {
  if (Number(result.changes) !== 1) {
    throw new Error(`${operation} failed: expected exactly one conversation row to change`);
  }
}

/** Creates an isolated expert-binding store over the supplied DatabaseSync. */
export function createExpertBindingStore(db: DatabaseSync): ExpertBindingStore {
  return {
    get(conversationId) {
      const row = db.prepare(
        `SELECT
           expert_id AS expertId,
           expert_revision AS expertRevision,
           expert_catalog_source AS expertCatalogSource
         FROM conversations
         WHERE id = ?`,
      ).get(conversationId) as Record<string, unknown> | undefined;
      return asRecord(row);
    },

    set(conversationId, binding) {
      const result = db.prepare(
        `UPDATE conversations
         SET expert_id = ?, expert_revision = ?, expert_catalog_source = ?, updated_at = updated_at
         WHERE id = ?`,
      ).run(
        binding?.expertId ?? null,
        binding?.revision ?? null,
        binding?.catalogSource ?? null,
        conversationId,
      );
      assertOneChange(result, "expert binding update");
    },

    copy(sourceConversationId, targetConversationId) {
      // Validate both rows before the UPDATE.  Without this check, an absent
      // source would silently copy NULLs into the target.
      const source = this.get(sourceConversationId);
      if (!source) {
        throw new Error(`expert binding source conversation not found: ${sourceConversationId}`);
      }
      if (!this.get(targetConversationId)) {
        throw new Error(`expert binding target conversation not found: ${targetConversationId}`);
      }

      const result = db.prepare(
        `UPDATE conversations
         SET expert_id = ?, expert_revision = ?, expert_catalog_source = ?, updated_at = updated_at
         WHERE id = ?`,
      ).run(
        source.expertId,
        source.expertRevision,
        source.expertCatalogSource,
        targetConversationId,
      );
      assertOneChange(result, "expert binding copy");
    },
  };
}

/** Production helper backed by the application's singleton database. */
export function getConversationExpertBinding(
  conversationId: string,
): ExpertBindingRecord | null {
  return createExpertBindingStore(getDb()).get(conversationId);
}

/** Production helper backed by the application's singleton database. */
export function setConversationExpertBinding(
  conversationId: string,
  binding: ExpertBinding | null,
): void {
  createExpertBindingStore(getDb()).set(conversationId, binding);
}

/** Production helper backed by the application's singleton database. */
export function copyConversationExpertBinding(
  sourceConversationId: string,
  targetConversationId: string,
): void {
  createExpertBindingStore(getDb()).copy(sourceConversationId, targetConversationId);
}
