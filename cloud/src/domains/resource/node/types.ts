import type { QueryResultRow } from "pg";

export type ResourceKind =
  | "expert"
  | "connector"
  | "model"
  | "workspace"
  | "memory"
  | "automation";

export interface ResourceRow extends QueryResultRow {
  id: string;
  name: string;
  data: Record<string, unknown>;
  secret: string | null;
  created_at: Date | string;
  updated_at: Date | string;
}

export interface ResourceDraft {
  name: string;
  data: Record<string, unknown>;
  secret: string | null;
}

export type PublicResource = Record<string, unknown> & {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
};

export function basePublicResource(row: ResourceRow): PublicResource {
  return {
    id: row.id,
    name: row.name,
    ...row.data,
    createdAt: row.created_at instanceof Date
      ? row.created_at.toISOString()
      : new Date(row.created_at).toISOString(),
    updatedAt: row.updated_at instanceof Date
      ? row.updated_at.toISOString()
      : new Date(row.updated_at).toISOString(),
  };
}
