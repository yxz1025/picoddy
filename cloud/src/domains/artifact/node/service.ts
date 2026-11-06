import { createHash, randomUUID } from 'node:crypto';
import { posix } from 'node:path';
import type { Database } from '../../../infra/db.ts';
import type { Storage } from '../../../platform/storage.ts';
import { sandboxPath, type CloudSandbox } from '../../../platform/sandbox.ts';
import type { Run } from '../../../cloud/runs/types.ts';

export interface PresentedFile {
  path?: string; url?: string; title: string; type: string;
  size?: string; bytes?: number; digest?: string; exists?: boolean;
}
export interface PresentationInput {
  files: Array<string | { path: string; title?: string }>;
  explanation?: string;
}
interface DeliveryBatch {
  files: PresentedFile[];
  explanation?: string;
  problems: string[];
}
interface DeliveryReceipt {
  toolCallId: string;
  inputHash: string;
  details: DeliveryBatch;
}
function receiptDetails(receipt: DeliveryReceipt, inputHash: string): DeliveryBatch {
  if (receipt.inputHash !== inputHash) throw new Error('TOOL_CALL_ID_REUSED_WITH_DIFFERENT_INPUT');
  return receipt.details;
}
const MIME: Record<string, string> = {
  md: 'text/markdown', txt: 'text/plain', html: 'text/html', htm: 'text/html',
  csv: 'text/csv', json: 'application/json', pdf: 'application/pdf',
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', svg: 'image/svg+xml',
  gif: 'image/gif', webp: 'image/webp', mp4: 'video/mp4', webm: 'video/webm',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
};
function sizeLabel(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Adapted desktop present_files semantics: ordered, nonempty, all items valid.
 * File verification is performed through OpenSandbox. Durable publication is
 * a cloud boundary; the browser receives opaque authenticated file references,
 * never a worker path or an object-storage key. */
export function createArtifactService(dependencies: {
  database: Database; storage: Storage; maxUploadBytes: number;
}) {
  const { database, storage, maxUploadBytes } = dependencies;
  return {
    async present(run: Run, toolCallId: string, sandbox: CloudSandbox, input: PresentationInput, signal?: AbortSignal): Promise<DeliveryBatch> {
      if (!toolCallId || toolCallId.length > 500) throw new Error('INVALID_TOOL_CALL_ID');
      if (!Array.isArray(input.files) || !input.files.length || input.files.length > 32) {
        throw new Error('present_files requires 1–32 files or URLs');
      }
      const inputHash = createHash('sha256').update(JSON.stringify({
        files: input.files.map(item => typeof item === 'string' ? { path: item } : { path: item.path, title: item.title }),
        explanation: input.explanation,
      })).digest('hex');
      const previous = await database.query<{ payload: DeliveryReceipt }>(
        `SELECT payload FROM events WHERE owner_id=$1 AND run_id=$2 AND type='delivery_batch'
         AND payload->>'toolCallId'=$3 ORDER BY id LIMIT 1`, [run.owner_id, run.id, toolCallId],
      );
      if (previous.rows[0]) return receiptDetails(previous.rows[0].payload, inputHash);
      const files: PresentedFile[] = [];
      const staged: Array<{ id: string; key: string; path: string; name: string; mime: string; bytes: Uint8Array; digest: string }> = [];
      let totalBytes = 0;
      // Verify the complete batch before writing any object or database record.
      for (const item of input.files) {
        signal?.throwIfAborted();
        const raw = (typeof item === 'string' ? item : item.path).trim();
        const title = typeof item === 'string' ? undefined : item.title;
        if (/^https?:\/\//i.test(raw)) {
          const url = new URL(raw);
          const host = url.hostname.toLowerCase();
          if (url.username || url.password || host === 'localhost' || host.endsWith('.localhost') ||
              host === '[::1]' || /^127\./.test(host) || host === '0.0.0.0') {
            throw new Error('Local sandbox URLs cannot be delivered to a browser; publish a file instead');
          }
          files.push({ url: url.href, title: title ?? (url.pathname.split('/').pop() || url.host), type: 'url' });
          continue;
        }
        const path = sandboxPath(raw.startsWith('/') ? raw : `/workspace/output/${raw}`);
        if (!path.startsWith('/workspace/output/')) throw new Error('INVALID_ARTIFACT_PATH');
        const name = posix.basename(path);
        if (name.length > 255 || /[\u0000-\u001f\u007f]/.test(name)) throw new Error('INVALID_ARTIFACT_NAME');
        const bytes = await sandbox.read(path, maxUploadBytes, signal);
        if (!bytes.byteLength || bytes.byteLength > maxUploadBytes) throw new Error('Artifact must be nonempty and within the upload limit');
        totalBytes += bytes.byteLength;
        if (totalBytes > maxUploadBytes) throw new Error('Artifact batch exceeds the upload limit');
        const id = randomUUID();
        const ext = posix.extname(name).slice(1).toLowerCase();
        const digest = createHash('sha256').update(bytes).digest('hex');
        staged.push({ id, key: `${run.owner_id}/artifacts/${run.id}/${id}`, path, name,
          mime: MIME[ext] ?? 'application/octet-stream', bytes, digest });
        files.push({ path: `/cloud-files/${id}/${encodeURIComponent(name)}`, title: title ?? name,
          type: ext || 'other', size: sizeLabel(bytes.byteLength), bytes: bytes.byteLength, digest, exists: true });
      }
      const written: string[] = [];
      let statementsFinished = false;
      try {
        for (const file of staged) {
          signal?.throwIfAborted();
          written.push(file.key);
          await storage.put(file.key, file.bytes, file.mime);
        }
        const result = await database.transaction(async client => {
          signal?.throwIfAborted();
          const owned = await client.query(
            `SELECT id FROM runs WHERE id=$1 AND owner_id=$2 AND lease_token=$3
             AND lease_until>now() AND NOT cancel_requested FOR UPDATE`,
            [run.id, run.owner_id, run.lease_token],
          );
          if (!owned.rowCount) throw new Error('RUN_LEASE_LOST');
          // The run row serializes competing commits. The durable SSE event is
          // also the delivery receipt, so recovery can return the original batch.
          const existing = await client.query<{ payload: DeliveryReceipt }>(
            `SELECT payload FROM events WHERE owner_id=$1 AND run_id=$2 AND type='delivery_batch'
             AND payload->>'toolCallId'=$3 ORDER BY id LIMIT 1`, [run.owner_id, run.id, toolCallId],
          );
          if (existing.rows[0]) return { duplicate: true, details: receiptDetails(existing.rows[0].payload, inputHash) };
          for (const file of staged) {
            signal?.throwIfAborted();
            await client.query(
              `INSERT INTO files(id,owner_id,run_id,name,mime_type,object_key,size,sha256)
               VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,
              [file.id, run.owner_id, run.id, file.name, file.mime, file.key, file.bytes.byteLength, file.digest],
            );
            // Preserve the public artifact event for existing clients.
            await client.query(
              `INSERT INTO events(owner_id,run_id,type,payload) VALUES($1,$2,'artifact',$3::jsonb)`,
              [run.owner_id, run.id, JSON.stringify({ id: file.id, name: file.name, size: file.bytes.byteLength, batchToolCallId: toolCallId })],
            );
          }
          const details = { files, explanation: input.explanation, problems: [] as string[] };
          await client.query(
            `INSERT INTO events(owner_id,run_id,type,payload) VALUES($1,$2,'delivery_batch',$3::jsonb)`,
            [run.owner_id, run.id, JSON.stringify({ toolCallId, inputHash, details,
              sources: staged.map(file => ({ id: file.id, path: file.path, digest: file.digest, bytes: file.bytes.byteLength })) })],
          );
          // A connection failure during COMMIT has an unknown outcome. Never
          // delete objects that might already be referenced by committed rows.
          statementsFinished = true;
          return { duplicate: false, details };
        });
        if (result.duplicate) await Promise.all(written.map(key => storage.remove(key).catch(() => undefined)));
        return result.details;
      } catch (error) {
        if (!statementsFinished) await Promise.all(written.map(key => storage.remove(key).catch(() => undefined)));
        throw error;
      }
    },
  };
}
