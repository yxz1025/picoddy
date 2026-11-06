import type { Database } from '../../../infra/db.ts';
import { fail } from '../../../shared/errors.ts';

export interface FileRow {
  id: string;
  run_id: string | null;
  name: string;
  mime_type: string;
  object_key: string;
  size: number | string;
  sha256: string;
  created_at: Date | string;
}

export interface FileDeletionRow {
  id: string;
  object_key: string;
  lease_token: string;
  attempts: number;
}

export interface FileDeletionLease {
  id: string;
  leaseToken: string;
  leaseUntil: Date;
}

const columns = 'id,run_id,name,mime_type,object_key,size,sha256,created_at';
const deletionColumns = 'id,object_key,lease_token,attempts';

/** Desktop attachment store boundary, adapted for owner-scoped durable objects. */
export function createAttachmentStore(database: Database) {
  return {
    async list(ownerId: string) {
      return (await database.query<FileRow>(
        `SELECT ${columns} FROM files WHERE owner_id=$1 ORDER BY created_at DESC,id`, [ownerId],
      )).rows;
    },
    async get(ownerId: string, id: string) {
      const result = await database.query<FileRow>(
        `SELECT ${columns} FROM files WHERE id=$1 AND owner_id=$2`, [id, ownerId],
      );
      if (!result.rows[0]) fail(404, 'NOT_FOUND', 'File not found');
      return result.rows[0];
    },
    async insert(ownerId: string, file: Omit<FileRow, 'run_id' | 'created_at'>) {
      return (await database.query<FileRow>(
        `INSERT INTO files(id,owner_id,name,mime_type,object_key,size,sha256)
         VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING ${columns}`,
        [file.id, ownerId, file.name, file.mime_type, file.object_key, file.size, file.sha256],
      )).rows[0];
    },
    async queueRemoval(ownerId: string, id: string, lease: FileDeletionLease) {
      return database.transaction(async client => {
        // Same lock order as enqueue: owner first, then selected file.
        await client.query('SELECT id FROM users WHERE id=$1 FOR UPDATE', [ownerId]);
        const result = await client.query<FileRow>(
          `SELECT ${columns} FROM files WHERE id=$1 AND owner_id=$2 FOR UPDATE`, [id, ownerId],
        );
        const file = result.rows[0];
        if (!file) fail(404, 'NOT_FOUND', 'File not found');
        const active = await client.query(
          `SELECT id FROM runs WHERE owner_id=$1 AND status=ANY($3::text[])
           AND EXISTS (SELECT 1 FROM jsonb_array_elements(coalesce(selection->'files','[]'::jsonb)) selected
             WHERE selected->>'id'=$2) LIMIT 1`,
          [ownerId, id, ['queued', 'provisioning', 'running', 'waiting_approval', 'cancelling', 'cleanup_pending']],
        );
        if (active.rows[0]) fail(409, 'FILE_IN_ACTIVE_RUN', 'File is referenced by an active run');
        const deletion = await client.query<FileDeletionRow>(
          `INSERT INTO file_deletions(id,object_key,lease_token,lease_until)
           VALUES($1,$2,$3,$4) RETURNING ${deletionColumns}`,
          [lease.id, file.object_key, lease.leaseToken, lease.leaseUntil],
        );
        await client.query('DELETE FROM files WHERE id=$1 AND owner_id=$2', [id, ownerId]);
        return deletion.rows[0];
      });
    },

    async completeDeletion(id: string, leaseToken: string): Promise<void> {
      await database.query(
        'DELETE FROM file_deletions WHERE id=$1 AND lease_token=$2',
        [id, leaseToken],
      );
    },

    async failDeletion(
      id: string,
      leaseToken: string,
      error: string,
      nextAttemptAt: Date,
    ): Promise<void> {
      await database.query(
        `UPDATE file_deletions
            SET attempts=attempts+1,last_error=$3,next_attempt_at=$4,
                lease_token=NULL,lease_until=NULL,updated_at=now()
          WHERE id=$1 AND lease_token=$2`,
        [id, leaseToken, error.slice(0, 2_000), nextAttemptAt],
      );
    },

    async claimDeletions(options: {
      maxAttempts: number;
      limit: number;
      leaseToken: string;
      leaseUntil: Date;
    }): Promise<FileDeletionRow[]> {
      const result = await database.query<FileDeletionRow>(
        `WITH candidates AS (
           SELECT id FROM file_deletions
            WHERE attempts < $1 AND next_attempt_at<=now()
              AND (lease_until IS NULL OR lease_until<=now())
            ORDER BY next_attempt_at,id
            FOR UPDATE SKIP LOCKED
            LIMIT $2
         )
         UPDATE file_deletions AS deletion
            SET lease_token=$3,lease_until=$4,updated_at=now()
           FROM candidates
          WHERE deletion.id=candidates.id
         RETURNING deletion.${deletionColumns.replaceAll(',', ',deletion.')}`,
        [options.maxAttempts, options.limit, options.leaseToken, options.leaseUntil],
      );
      return result.rows;
    },
  };
}
