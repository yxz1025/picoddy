import { createHash, randomUUID } from 'node:crypto';
import type { Database } from '../../../infra/db.ts';
import type { Storage } from '../../../platform/storage.ts';
import { fail } from '../../../shared/errors.ts';
import { object } from '../../../shared/validation.ts';
import { createAttachmentStore, type FileRow } from './store.ts';

function publicFile(row: FileRow) {
  return {
    id: row.id, runId: row.run_id, name: row.name, mimeType: row.mime_type,
    size: Number(row.size), sha256: row.sha256,
    createdAt: new Date(row.created_at).toISOString(),
  };
}

export function createAttachmentService(dependencies: {
  database: Database; storage: Storage; maxUploadBytes: number;
}) {
  const { storage, maxUploadBytes } = dependencies;
  const store = createAttachmentStore(dependencies.database);
  return {
    async list(ownerId: string) { return (await store.list(ownerId)).map(publicFile); },
    async upload(ownerId: string, input: unknown) {
      const body = object(input);
      if (typeof body.name !== 'string' || !body.name.trim() || body.name.length > 255 ||
          /[\\/\u0000-\u001f\u007f]/.test(body.name)) {
        fail(400, 'INVALID_FILENAME', 'name must be a safe filename of at most 255 characters');
      }
      if (typeof body.mimeType !== 'string' || body.mimeType.length > 255 ||
          !/^[\x20-\x7e]+$/.test(body.mimeType) ||
          !/^[\w!#$&^_.+-]+\/[\w!#$&^_.+-]+(?:\s*;.*)?$/.test(body.mimeType)) {
        fail(400, 'INVALID_MIME_TYPE', 'mimeType is invalid');
      }
      if (typeof body.contentBase64 !== 'string' || body.contentBase64.length % 4 !== 0 ||
          !/^(?:[A-Za-z\d+/]{4})*(?:[A-Za-z\d+/]{2}==|[A-Za-z\d+/]{3}=)?$/.test(body.contentBase64)) {
        fail(400, 'INVALID_BASE64', 'contentBase64 must be canonical base64');
      }
      const bytes = Buffer.from(body.contentBase64, 'base64');
      if (bytes.byteLength > maxUploadBytes) fail(413, 'UPLOAD_TOO_LARGE', 'File exceeds the configured upload limit');
      const id = randomUUID();
      const objectKey = `users/${ownerId}/files/${id}`;
      await storage.put(objectKey, bytes, body.mimeType);
      try {
        return publicFile(await store.insert(ownerId, {
          id, name: body.name.trim(), mime_type: body.mimeType, object_key: objectKey,
          size: bytes.byteLength, sha256: createHash('sha256').update(bytes).digest('hex'),
        }));
      } catch (error) {
        await storage.remove(objectKey).catch(() => undefined);
        throw error;
      }
    },
    async download(ownerId: string, id: string) {
      const row = await store.get(ownerId, id);
      const size = Number(row.size);
      if (!Number.isSafeInteger(size) || size < 0 || size > maxUploadBytes) {
        fail(413, 'FILE_TOO_LARGE', 'File exceeds the configured read limit');
      }
      const bytes = await storage.get(row.object_key, maxUploadBytes);
      if (bytes.byteLength !== size || createHash('sha256').update(bytes).digest('hex') !== row.sha256) {
        fail(409, 'FILE_INTEGRITY_FAILED', 'Stored file does not match its published version');
      }
      return { file: publicFile(row), bytes };
    },
    async remove(ownerId: string, id: string) {
      const lease = {
        id: randomUUID(),
        leaseToken: randomUUID(),
        leaseUntil: new Date(Date.now() + 60_000),
      };
      const deletion = await store.queueRemoval(ownerId, id, lease);
      try {
        await storage.remove(deletion.object_key);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        await store.failDeletion(
          deletion.id,
          deletion.lease_token,
          message,
          new Date(Date.now() + 30_000),
        ).catch(() => undefined);
        return;
      }
      await store.completeDeletion(deletion.id, deletion.lease_token).catch(() => undefined);
    },
  };
}
