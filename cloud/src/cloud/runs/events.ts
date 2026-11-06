import { query } from '../../infra/db.ts';
import type { Run } from './types.ts';

/** A lost lease cannot append events or deliver further tools. */
export async function assertLease(run: Run): Promise<void> {
  const result = await query(`SELECT cancel_requested FROM runs r WHERE id=$1 AND owner_id=$2 AND lease_token=$3 AND lease_until>now()
    AND EXISTS(SELECT 1 FROM users u WHERE u.id=r.owner_id AND u.disabled_at IS NULL)
    AND (r.parent_run_id IS NULL OR EXISTS(SELECT 1 FROM runs p WHERE p.id=r.parent_run_id AND p.owner_id=r.owner_id AND p.lease_until>now() AND NOT p.cancel_requested AND p.status='running'))`, [run.id, run.owner_id, run.lease_token]);
  if (!result.rows[0] || result.rows[0].cancel_requested) throw new Error('RUN_CANCELLED_OR_LEASE_LOST');
}

export async function emitRun(run: Run, type: string, payload: Record<string, unknown>): Promise<void> {
  const encoded = JSON.stringify(payload);
  if (Buffer.byteLength(encoded) > 256 * 1024) throw new Error('EVENT_TOO_LARGE');
  const result = await query(`INSERT INTO events(owner_id,run_id,type,payload)
    SELECT r.owner_id,r.id,$4,$5::jsonb FROM runs r
    WHERE r.id=$1 AND r.owner_id=$2 AND r.lease_token=$3 AND r.lease_until>now()
      AND EXISTS(SELECT 1 FROM users u WHERE u.id=r.owner_id AND u.disabled_at IS NULL)`,
  [run.id, run.owner_id, run.lease_token, type, encoded]);
  if (result.rowCount !== 1) throw new Error('RUN_LEASE_LOST');
  if (run.parent_run_id && (type === 'status' || type === 'approval')) {
    await query(`INSERT INTO events(owner_id,run_id,type,payload) SELECT r.owner_id,r.id,$3,$4::jsonb FROM runs r
      WHERE r.id=$1 AND r.owner_id=$2 AND r.lease_until>now() AND NOT r.cancel_requested
        AND EXISTS(SELECT 1 FROM users u WHERE u.id=r.owner_id AND u.disabled_at IS NULL)`, [run.parent_run_id,run.owner_id,
      type === 'status' ? 'subagent.lifecycle' : 'approval', JSON.stringify(type === 'status'
        ? { childRunId:run.id,childSessionId:run.conversation_id,role:run.selection.delegation?.role,...payload }
        : {...payload,runId:run.id})]);
  }
}
