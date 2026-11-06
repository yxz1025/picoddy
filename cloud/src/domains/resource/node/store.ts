import type { PoolClient, QueryResultRow } from "pg";

import type { Database } from "../../../infra/db.ts";
import type { ResourceDraft, ResourceKind, ResourceRow } from "./types.ts";

interface Queryable {
  query<T extends QueryResultRow = QueryResultRow>(
    sql: string,
    values?: readonly unknown[],
  ): Promise<{ rows: T[]; rowCount: number | null }>;
}

export interface ResourceTransactionStore {
  lockOwner(ownerId: string): Promise<void>;
  hasOwnedIds(ownerId: string, kind: ResourceKind | "skill", ids: string[]): Promise<boolean>;
  hasOwnedConversation(ownerId: string, id: string): Promise<boolean>;
  getForUpdate(ownerId: string, kind: ResourceKind, id: string): Promise<ResourceRow | undefined>;
  clearModelDefaults(ownerId: string, excludeId?: string): Promise<void>;
  insert(ownerId: string, kind: ResourceKind, draft: ResourceDraft): Promise<ResourceRow>;
  update(ownerId: string, kind: ResourceKind, id: string, draft: ResourceDraft): Promise<ResourceRow | undefined>;
}

function transactionStore(client: Queryable): ResourceTransactionStore {
  return {
    async lockOwner(ownerId) {
      await client.query("SELECT id FROM users WHERE id=$1 FOR UPDATE", [ownerId]);
    },

    async hasOwnedIds(ownerId, kind, ids) {
      if (ids.length === 0) return true;
      const result = await client.query<{ id: string }>(
        `SELECT id FROM resources
          WHERE owner_id=$1 AND kind=$2 AND id=ANY($3::uuid[]) AND deleted_at IS NULL`,
        [ownerId, kind, ids],
      );
      return result.rows.length === ids.length;
    },
    async hasOwnedConversation(ownerId, id) {
      const result = await client.query('SELECT id FROM conversations WHERE owner_id=$1 AND id=$2', [ownerId, id]);
      return result.rows.length === 1;
    },

    async getForUpdate(ownerId, kind, id) {
      const result = await client.query<ResourceRow>(
        `SELECT id,name,data,secret,created_at,updated_at FROM resources
          WHERE id=$1 AND owner_id=$2 AND kind=$3 AND deleted_at IS NULL FOR UPDATE`,
        [id, ownerId, kind],
      );
      return result.rows[0];
    },

    async clearModelDefaults(ownerId, excludeId) {
      if (excludeId) {
        await client.query(
          `UPDATE resources SET data=jsonb_set(data,'{isDefault}','false'::jsonb),updated_at=now()
            WHERE owner_id=$1 AND kind='model' AND id<>$2 AND deleted_at IS NULL`,
          [ownerId, excludeId],
        );
        return;
      }
      await client.query(
        `UPDATE resources SET data=jsonb_set(data,'{isDefault}','false'::jsonb),updated_at=now()
          WHERE owner_id=$1 AND kind='model' AND deleted_at IS NULL`,
        [ownerId],
      );
    },

    async insert(ownerId, kind, draft) {
      const result = await client.query<ResourceRow>(
        `INSERT INTO resources(owner_id,kind,name,data,secret)
         VALUES($1,$2,$3,$4::jsonb,$5)
         RETURNING id,name,data,secret,created_at,updated_at`,
        [ownerId, kind, draft.name, JSON.stringify(draft.data), draft.secret],
      );
      return result.rows[0];
    },

    async update(ownerId, kind, id, draft) {
      const result = await client.query<ResourceRow>(
        `UPDATE resources SET name=$4,data=$5::jsonb,secret=$6,updated_at=now()
          WHERE id=$1 AND owner_id=$2 AND kind=$3 AND deleted_at IS NULL
          RETURNING id,name,data,secret,created_at,updated_at`,
        [id, ownerId, kind, draft.name, JSON.stringify(draft.data), draft.secret],
      );
      return result.rows[0];
    },
  };
}

export function createResourceStore(database: Database) {
  return {
    async list(ownerId: string, kind: ResourceKind): Promise<ResourceRow[]> {
      const result = await database.query<ResourceRow>(
        `SELECT id,name,data,secret,created_at,updated_at FROM resources
          WHERE owner_id=$1 AND kind=$2 AND deleted_at IS NULL ORDER BY created_at DESC,id`,
        [ownerId, kind],
      );
      return result.rows;
    },

    transaction<T>(work: (store: ResourceTransactionStore) => Promise<T>): Promise<T> {
      return database.transaction((client: PoolClient) => work(transactionStore(client)));
    },

    async remove(ownerId: string, kind: ResourceKind, id: string): Promise<boolean> {
      const result = await database.query(
        `UPDATE resources SET deleted_at=now(),updated_at=now()
          WHERE id=$1 AND owner_id=$2 AND kind=$3 AND deleted_at IS NULL RETURNING id`,
        [id, ownerId, kind],
      );
      return Boolean(result.rows[0]);
    },
  };
}

export type ResourceStore = ReturnType<typeof createResourceStore>;
