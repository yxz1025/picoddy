import { createHash } from 'node:crypto';
import type { Database } from '../../../infra/db.ts';
import type { Run } from '../../../cloud/runs/types.ts';
import type { Storage } from '../../../platform/storage.ts';
import { sandboxPath, type CloudSandbox } from '../../../platform/sandbox.ts';
import { object, string } from '../../../shared/validation.ts';

export interface CompletionDeclaration { success: boolean; summary: string; proof: string; status?: 'completed' | 'waiting_for_user' }
interface Receipt { sources?: Array<{ id: string; path: string; digest: string; bytes: number }>; details: { files: Array<{ path?: string }> } }

export function createCompletionService(dependencies: {
  database: Database; storage: Storage; sandbox: CloudSandbox; run: Run; maxBytes: number;
}) {
  const { database, storage, sandbox, run, maxBytes } = dependencies;
  async function guard() {
    const result = await database.query(`SELECT id FROM runs WHERE id=$1 AND owner_id=$2 AND lease_token=$3
      AND lease_until>now() AND NOT cancel_requested AND status='running'`, [run.id, run.owner_id, run.lease_token]);
    if (!result.rows[0]) throw new Error('RUN_LEASE_LOST');
  }
  async function delivery() {
    return (await database.query<{ id: string; payload: Receipt }>(`SELECT id::text,payload FROM events
      WHERE owner_id=$1 AND run_id=$2 AND type='delivery_batch' ORDER BY id DESC LIMIT 1`, [run.owner_id, run.id])).rows[0];
  }
  async function verifyDelivery(signal?: AbortSignal) {
    await guard(); signal?.throwIfAborted();
    const receipt = await delivery();
    if (!receipt) return null;
    const sources = receipt.payload.sources ?? [];
    if (sources.length !== receipt.payload.details.files.filter(file => file.path).length) throw new Error('DELIVERY_RECEIPT_INCOMPLETE');
    let total = 0;
    for (const source of sources) {
      signal?.throwIfAborted(); await guard();
      const path = sandboxPath(source.path);
      if (!path.startsWith('/workspace/output/') || !Number.isSafeInteger(source.bytes) || source.bytes <= 0 || (total += source.bytes) > maxBytes) throw new Error('DELIVERY_INVALID');
      const result = await database.query('SELECT object_key,size,sha256 FROM files WHERE id=$1 AND owner_id=$2 AND run_id=$3', [source.id, run.owner_id, run.id]);
      const file = result.rows[0];
      if (!file || Number(file.size) !== source.bytes || file.sha256 !== source.digest) throw new Error('DELIVERY_CHANGED');
      for (const bytes of [await sandbox.read(path, maxBytes, signal), await storage.get(file.object_key, maxBytes)]) {
        if (bytes.byteLength !== source.bytes || createHash('sha256').update(bytes).digest('hex') !== source.digest) throw new Error('DELIVERY_CHANGED');
      }
    }
    await guard();
    return receipt.id;
  }
  async function get(): Promise<CompletionDeclaration | null> {
    return (await database.query<{ payload: CompletionDeclaration }>("SELECT payload FROM events WHERE owner_id=$1 AND run_id=$2 AND type='goal_declared' ORDER BY id DESC LIMIT 1", [run.owner_id, run.id])).rows[0]?.payload ?? null;
  }
  return {
    get,
    async declare(toolCallId: string, input: unknown, signal?: AbortSignal) {
      string(toolCallId, 'toolCallId', 1, 500);
      const value = object(input);
      if (typeof value.success !== 'boolean') throw new Error('Invalid success');
      const declaration: CompletionDeclaration = { success: value.success, summary: string(value.summary, 'summary', 1, 8000), proof: string(value.proof, 'proof', 1, 8000) };
      if (value.status !== undefined) {
        if (value.status !== 'completed' && value.status !== 'waiting_for_user') throw new Error('Invalid status');
        if (value.status === 'waiting_for_user' && value.success) throw new Error('Waiting cannot be success');
        if (value.status === 'completed' && !value.success) throw new Error('Completed requires success');
        declaration.status = value.status;
      }
      await guard();
      const deliveryId = declaration.success ? await verifyDelivery(signal) : null;
      await database.transaction(async client => {
        const lease = await client.query(`SELECT id FROM runs WHERE id=$1 AND owner_id=$2 AND lease_token=$3 AND lease_until>now()
          AND NOT cancel_requested AND status='running' FOR UPDATE`, [run.id, run.owner_id, run.lease_token]);
        if (!lease.rows[0]) throw new Error('RUN_LEASE_LOST');
        const previous = await client.query("SELECT id FROM events WHERE owner_id=$1 AND run_id=$2 AND type='goal_declared'", [run.owner_id, run.id]);
        if (previous.rows[0]) throw new Error('GOAL_ALREADY_DECLARED');
        const latest = await client.query("SELECT id::text FROM events WHERE owner_id=$1 AND run_id=$2 AND type='delivery_batch' ORDER BY id DESC LIMIT 1", [run.owner_id, run.id]);
        if (declaration.success && (latest.rows[0]?.id ?? null) !== deliveryId) throw new Error('DELIVERY_CHANGED');
        signal?.throwIfAborted();
        await client.query("INSERT INTO events(owner_id,run_id,type,payload) VALUES($1,$2,'goal_declared',$3::jsonb)", [run.owner_id, run.id, JSON.stringify({ ...declaration, toolCallId, deliveryId })]);
      });
      return declaration;
    },
    async verify(signal?: AbortSignal) {
      await guard();
      signal?.throwIfAborted();
      if (run.selection?.delegation) { await verifyDelivery(signal); return; }
      const declaration = await get();
      if (!declaration) {
        if (await delivery()) throw new Error('GOAL_DECLARATION_REQUIRED');
        return;
      }
      // A request for user input finishes this execution turn, not the goal.
      // Keep success=false in the declaration and let the worker persist workspace changes.
      if (!declaration.success && declaration.status === 'waiting_for_user') return;
      if (!declaration.success) throw new Error('GOAL_NOT_COMPLETED');
      await verifyDelivery(signal);
    },
  };
}
