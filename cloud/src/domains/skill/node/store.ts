import type { QueryResultRow } from "pg";

import type { Database } from "../../../infra/db.ts";
import type { ParsedSkillPackage } from "./package.ts";

export interface SkillRow extends QueryResultRow {
  id: string;
  name: string;
  data: { description?: string; currentVersion?: string; enabled?: boolean };
  created_at: Date | string;
  updated_at: Date | string;
}

export interface SkillVersionRow extends QueryResultRow {
  version: string;
  description: string;
  files: Array<{ path: string; contentBase64: string }>;
  created_at: Date | string;
}

export interface CurrentSkillVersionRow extends SkillRow {
  version: string;
  description: string;
  files: Array<{ path: string; contentBase64: string }>;
}

export type AddSkillVersionResult =
  | { kind: "updated"; row: SkillRow }
  | { kind: "not_found" }
  | { kind: "version_conflict" }
  | { kind: "name_mismatch" };

export type UpdateSkillResult =
  | { kind: "updated"; row: SkillRow }
  | { kind: "not_found" }
  | { kind: "version_conflict" };

export function createSkillStore(database: Database) {
  return {
    async rollback(ownerId: string, skillId: string, expectedVersion: string, version: string): Promise<SkillRow | undefined> {
      return database.transaction(async client => {
        await client.query('SELECT id FROM users WHERE id=$1 FOR UPDATE', [ownerId]);
        const current = await client.query<SkillRow>("SELECT id,name,data,created_at,updated_at FROM resources WHERE id=$1 AND owner_id=$2 AND kind='skill' AND deleted_at IS NULL FOR UPDATE", [skillId, ownerId]);
        if (!current.rows[0]) return undefined;
        if (current.rows[0].data.currentVersion !== expectedVersion) throw new Error('SKILL_VERSION_CHANGED');
        const target = await client.query('SELECT description FROM skill_versions WHERE skill_id=$1 AND owner_id=$2 AND version=$3', [skillId, ownerId, version]);
        if (!target.rows[0]) return undefined;
        const result = await client.query<SkillRow>(`UPDATE resources SET data=data || $3::jsonb,updated_at=now() WHERE id=$1 AND owner_id=$2
          RETURNING id,name,data,created_at,updated_at`, [skillId, ownerId, JSON.stringify({ currentVersion: version, description: target.rows[0].description })]);
        return result.rows[0];
      });
    },
    async list(ownerId: string): Promise<SkillRow[]> {
      const result = await database.query<SkillRow>(
        `SELECT id,name,data,created_at,updated_at FROM resources
          WHERE owner_id=$1 AND kind='skill' AND deleted_at IS NULL
          ORDER BY created_at DESC,id`,
        [ownerId],
      );
      return result.rows;
    },

    async create(ownerId: string, skill: ParsedSkillPackage): Promise<SkillRow> {
      return database.transaction(async (client) => {
        const resource = await client.query<SkillRow>(
          `INSERT INTO resources(owner_id,kind,name,data)
           VALUES($1,'skill',$2,$3::jsonb)
           RETURNING id,name,data,created_at,updated_at`,
          [ownerId, skill.name, JSON.stringify({
            description: skill.description,
            currentVersion: skill.version,
            enabled: true,
          })],
        );
        const row = resource.rows[0];
        await client.query(
          `INSERT INTO skill_versions(skill_id,owner_id,version,description,files)
           VALUES($1,$2,$3,$4,$5::jsonb)`,
          [row.id, ownerId, skill.version, skill.description, JSON.stringify(skill.files)],
        );
        return row;
      });
    },

    async versions(ownerId: string, skillId: string): Promise<SkillVersionRow[] | undefined> {
      return database.transaction(async (client) => {
        const skill = await client.query(
          `SELECT id FROM resources
            WHERE id=$1 AND owner_id=$2 AND kind='skill' AND deleted_at IS NULL
            FOR SHARE`,
          [skillId, ownerId],
        );
        if (!skill.rows[0]) return undefined;
        const result = await client.query<SkillVersionRow>(
          `SELECT version,description,files,created_at FROM skill_versions
            WHERE skill_id=$1 AND owner_id=$2 ORDER BY created_at DESC,version`,
          [skillId, ownerId],
        );
        return result.rows;
      });
    },

    async currentVersion(
      ownerId: string,
      skillId: string,
    ): Promise<CurrentSkillVersionRow | undefined> {
      const result = await database.query<CurrentSkillVersionRow>(
        `SELECT r.id,r.name,r.data,r.created_at,r.updated_at,
                v.version,v.description,v.files
           FROM resources r
           JOIN skill_versions v
             ON v.skill_id=r.id
            AND v.owner_id=r.owner_id
            AND v.version=r.data->>'currentVersion'
          WHERE r.id=$1 AND r.owner_id=$2 AND r.kind='skill' AND r.deleted_at IS NULL`,
        [skillId, ownerId],
      );
      return result.rows[0];
    },

    async addVersion(
      ownerId: string,
      skillId: string,
      expectedVersion: string,
      skill: ParsedSkillPackage,
    ): Promise<AddSkillVersionResult> {
      return database.transaction(async (client) => {
        const current = await client.query<SkillRow>(
          `SELECT id,name,data,created_at,updated_at FROM resources
            WHERE id=$1 AND owner_id=$2 AND kind='skill' AND deleted_at IS NULL
            FOR UPDATE`,
          [skillId, ownerId],
        );
        const row = current.rows[0];
        if (!row) return { kind: "not_found" };
        if (row.data.currentVersion !== expectedVersion) return { kind: "version_conflict" };
        if (row.name !== skill.name) return { kind: "name_mismatch" };

        await client.query(
          `INSERT INTO skill_versions(skill_id,owner_id,version,description,files)
           VALUES($1,$2,$3,$4,$5::jsonb)`,
          [row.id, ownerId, skill.version, skill.description, JSON.stringify(skill.files)],
        );
        const updated = await client.query<SkillRow>(
          `UPDATE resources SET data=data || $3::jsonb,updated_at=now()
            WHERE id=$1 AND owner_id=$2 AND kind='skill' AND deleted_at IS NULL
            RETURNING id,name,data,created_at,updated_at`,
          [row.id, ownerId, JSON.stringify({
            currentVersion: skill.version,
            description: skill.description,
          })],
        );
        return { kind: "updated", row: updated.rows[0] };
      });
    },

    async updateEnabled(
      ownerId: string,
      skillId: string,
      enabled: boolean,
      expectedVersion: string | undefined,
    ): Promise<UpdateSkillResult> {
      return database.transaction(async (client) => {
        const current = await client.query<SkillRow>(
          `SELECT id,name,data,created_at,updated_at FROM resources
            WHERE id=$1 AND owner_id=$2 AND kind='skill' AND deleted_at IS NULL
            FOR UPDATE`,
          [skillId, ownerId],
        );
        const row = current.rows[0];
        if (!row) return { kind: "not_found" };
        if (expectedVersion !== undefined && row.data.currentVersion !== expectedVersion) {
          return { kind: "version_conflict" };
        }
        const updated = await client.query<SkillRow>(
          `UPDATE resources SET data=jsonb_set(data,'{enabled}',$3::jsonb),updated_at=now()
            WHERE id=$1 AND owner_id=$2 AND kind='skill' AND deleted_at IS NULL
            RETURNING id,name,data,created_at,updated_at`,
          [skillId, ownerId, JSON.stringify(enabled)],
        );
        return { kind: "updated", row: updated.rows[0] };
      });
    },

    async remove(ownerId: string, skillId: string): Promise<boolean> {
      const result = await database.query(
        `UPDATE resources SET
           deleted_at=now(),data=jsonb_set(data,'{enabled}','false'::jsonb),updated_at=now()
          WHERE id=$1 AND owner_id=$2 AND kind='skill' AND deleted_at IS NULL
          RETURNING id`,
        [skillId, ownerId],
      );
      return Boolean(result.rows[0]);
    },
  };
}

export type SkillStore = ReturnType<typeof createSkillStore>;
