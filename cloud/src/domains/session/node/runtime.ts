import type { FileEntry } from '@earendil-works/pi-coding-agent';
import { database, type Database } from '../../../infra/db.ts';
import type { Run, Transcript } from '../../../cloud/runs/types.ts';

const MAX_RUNTIME_BYTES = 16 * 1024 * 1024;

/** Restore a compacted prefix plus the raw tail, including interrupted runs. */
export async function loadSessionRuntime(run: Run, db: Database = database): Promise<{
  messages: Transcript; entries?: FileEntry[]; cursor: string;
}> {
  const checkpoint = await db.query<{ entries: FileEntry[]; transcript_cursor: string }>(
    `SELECT entries,transcript_cursor::text FROM session_runtime WHERE owner_id=$1 AND conversation_id=$2
      AND octet_length(entries::text)<=$3`,
    [run.owner_id, run.conversation_id, MAX_RUNTIME_BYTES]);
  const previous = checkpoint.rows[0];
  const args = [run.owner_id, run.conversation_id, run.id, previous?.transcript_cursor ?? '0'];
  const stats = await db.query<{ bytes: string; cursor: string | null }>(
    `SELECT coalesce(sum(octet_length(content::text)),0)::text AS bytes,max(runtime_sequence)::text AS cursor
       FROM messages WHERE owner_id=$1 AND conversation_id=$2 AND (run_id IS NULL OR run_id<>$3)
         AND runtime_sequence>$4`, args);
  if (Number(stats.rows[0].bytes) > MAX_RUNTIME_BYTES) throw new Error('CONTEXT_LIMIT');
  const result = await db.query<{ content: Transcript[number] }>(
    `SELECT content FROM messages WHERE owner_id=$1 AND conversation_id=$2
      AND (run_id IS NULL OR run_id<>$3) AND runtime_sequence>$4 ORDER BY created_at,id`, args);
  return {
    messages: result.rows.map(row => row.content).filter(message => message.role !== 'system'),
    cursor: stats.rows[0].cursor ?? previous?.transcript_cursor ?? '0',
    ...(previous ? { entries: previous.entries } : {}),
  };
}

export async function saveSessionRuntime(run: Run, entries: FileEntry[], cursor: string, db: Database = database): Promise<void> {
  if (!/^\d+$/.test(cursor)) throw new Error('INVALID_RUNTIME_CURSOR');
  const encoded = JSON.stringify(entries);
  if (Buffer.byteLength(encoded) > MAX_RUNTIME_BYTES) throw new Error('SESSION_RUNTIME_TOO_LARGE');
  await db.transaction(async client => {
    const owned = await client.query(
      `SELECT id FROM runs WHERE id=$1 AND owner_id=$2 AND conversation_id=$3
        AND lease_token=$4 AND lease_until>now() AND NOT cancel_requested FOR SHARE`,
      [run.id, run.owner_id, run.conversation_id, run.lease_token]);
    if (!owned.rowCount) throw new Error('RUN_LEASE_LOST');
    await client.query(
      `INSERT INTO session_runtime(conversation_id,owner_id,transcript_cursor,entries)
       VALUES($1,$2,$4::bigint,$3::jsonb)
       ON CONFLICT(conversation_id) DO UPDATE SET transcript_cursor=excluded.transcript_cursor,
         entries=excluded.entries,updated_at=now()
       WHERE session_runtime.owner_id=excluded.owner_id`,
      [run.conversation_id, run.owner_id, encoded, cursor]);
  });
}
