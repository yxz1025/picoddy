import type { Database } from "../../../infra/db.ts";
import { fail } from "../../../shared/errors.ts";
import { createResourceStore, type ResourceTransactionStore } from "./store.ts";
import type {
  PublicResource,
  ResourceDraft,
  ResourceKind,
  ResourceRow,
} from "./types.ts";
import { bodyObject } from "./validation.ts";

export interface ResourcePolicy<TPublic extends PublicResource = PublicResource> {
  readonly kind: ResourceKind;
  readonly lockOwner?: boolean;
  create(
    body: Record<string, unknown>,
    transaction: ResourceTransactionStore,
  ): Promise<ResourceDraft>;
  update(
    existing: ResourceRow,
    patch: Record<string, unknown>,
    transaction: ResourceTransactionStore,
  ): Promise<ResourceDraft>;
  beforeWrite?(
    transaction: ResourceTransactionStore,
    draft: ResourceDraft,
    existingId?: string,
  ): Promise<void>;
  present(row: ResourceRow): TPublic;
}

export interface ResourceCrudService<TPublic extends PublicResource = PublicResource> {
  list(): Promise<TPublic[]>;
  create(input: unknown): Promise<TPublic>;
  update(id: string, input: unknown): Promise<TPublic>;
  remove(id: string): Promise<void>;
}

export interface ResourceServiceDependencies {
  database: Database;
  ownerId: string;
}

export async function assertOwnedIds(
  transaction: ResourceTransactionStore,
  ownerId: string,
  kind: ResourceKind | "skill",
  ids: string[],
  field: string,
): Promise<void> {
  if (!await transaction.hasOwnedIds(ownerId, kind, ids)) {
    fail(400, "INVALID_REFERENCE", `${field} contains an unavailable resource`);
  }
}

export function createResourceCrudService<TPublic extends PublicResource>(
  dependencies: ResourceServiceDependencies,
  policy: ResourcePolicy<TPublic>,
): ResourceCrudService<TPublic> {
  const { database, ownerId } = dependencies;
  const store = createResourceStore(database);

  return {
    async list() {
      return (await store.list(ownerId, policy.kind)).map(policy.present);
    },

    async create(input) {
      const body = bodyObject(input);
      const row = await store.transaction(async (transaction) => {
        if (policy.lockOwner) await transaction.lockOwner(ownerId);
        const draft = await policy.create(body, transaction);
        await policy.beforeWrite?.(transaction, draft);
        return transaction.insert(ownerId, policy.kind, draft);
      });
      return policy.present(row);
    },

    async update(id, input) {
      const patch = bodyObject(input);
      const row = await store.transaction(async (transaction) => {
        if (policy.lockOwner) await transaction.lockOwner(ownerId);
        const existing = await transaction.getForUpdate(ownerId, policy.kind, id);
        if (!existing) fail(404, "NOT_FOUND", "Resource not found");
        const draft = await policy.update(existing, patch, transaction);
        await policy.beforeWrite?.(transaction, draft, id);
        const updated = await transaction.update(ownerId, policy.kind, id, draft);
        if (!updated) fail(404, "NOT_FOUND", "Resource not found");
        return updated;
      });
      return policy.present(row);
    },

    async remove(id) {
      if (!await store.remove(ownerId, policy.kind, id)) {
        fail(404, "NOT_FOUND", "Resource not found");
      }
    },
  };
}
