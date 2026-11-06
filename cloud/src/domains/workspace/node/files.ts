import { randomUUID } from 'node:crypto';
import type { QueryResultRow } from 'pg';
import type { Database } from '../../../infra/db.ts';
import { fail } from '../../../shared/errors.ts';
import type { Run } from '../../../cloud/runs/types.ts';
import type { Storage } from '../../../platform/storage.ts';
import type { CloudSandbox } from '../../../platform/sandbox.ts';
import { scanWorkspace, validateManifest, verifyWorkspaceBytes, WORKSPACE_FILE_LIMIT, type WorkspaceSnapshot, type StoredWorkspaceFile } from './sync.ts';

interface Queryable {
  query<T extends QueryResultRow = QueryResultRow>(sql: string, values?: unknown[]): Promise<{ rows: T[]; rowCount: number | null }>;
}

/** Called under the submission's owner lock: every new run freezes a complete manifest. */
export async function snapshotWorkspace(client: Queryable, ownerId: string, conversation: { id: string; workspace_id: string | null }): Promise<WorkspaceSnapshot> {
  const scopeId = conversation.workspace_id ?? conversation.id;
  if (conversation.workspace_id) {
    const available = await client.query("SELECT id FROM resources WHERE id=$1 AND owner_id=$2 AND kind='workspace' AND deleted_at IS NULL", [scopeId, ownerId]);
    if (!available.rows[0]) fail(400, 'WORKSPACE_UNAVAILABLE', 'Workspace is unavailable');
  }
  await client.query(`INSERT INTO workspace_heads(id,owner_id,workspace_id,conversation_id) VALUES($1,$2,$3,$4) ON CONFLICT(id) DO NOTHING`,
    [scopeId, ownerId, conversation.workspace_id, conversation.workspace_id ? null : conversation.id]);
  const result = await client.query('SELECT revision,manifest FROM workspace_heads WHERE id=$1 AND owner_id=$2', [scopeId, ownerId]);
  if (!result.rows[0]) fail(404, 'NOT_FOUND', 'Workspace not found');
  const files = result.rows[0].manifest as StoredWorkspaceFile[];
  validateManifest(files);
  return { scopeId, ownerId, revision: result.rows[0].revision, files };
}

async function lease(client: Queryable, run: Run): Promise<void> {
  const result = await client.query(`SELECT id FROM runs WHERE id=$1 AND owner_id=$2 AND lease_token=$3
    AND lease_until>now() AND NOT cancel_requested AND status='running' FOR UPDATE`, [run.id, run.owner_id, run.lease_token]);
  if (!result.rows[0]) throw new Error('RUN_CANCELLED_OR_LEASE_LOST');
}

export async function persistWorkspace(input: {
  database: Database; storage: Storage; sandbox: CloudSandbox; run: Run; signal: AbortSignal; guard: () => Promise<void>;
}): Promise<{ status: 'unchanged' | 'committed' | 'conflict'; versionId?: string; revision: number }> {
  const { database, storage, sandbox, run, signal, guard } = input;
  const snapshot = run.selection.workspace;
  if (!snapshot || snapshot.ownerId !== run.owner_id) throw new Error('WORKSPACE_OWNER_MISMATCH');
  await guard();
  const manifest = await scanWorkspace(sandbox, signal);
  const old = validateManifest(snapshot.files);
  if (JSON.stringify(old) === JSON.stringify(manifest)) return { status: 'unchanged', revision: snapshot.revision };
  const versionId = randomUUID();
  const files = manifest.map(file => ({ ...file, objectKey: `users/${run.owner_id}/workspaces/${snapshot.scopeId}/${versionId}/${randomUUID()}` }));
  // Register every planned object before uploading: even interrupted uploads have a durable owner.
  await database.transaction(async client => {
    await client.query('SELECT id FROM users WHERE id=$1 FOR UPDATE', [run.owner_id]);
    await lease(client, run);
    const count = await client.query('SELECT count(*)::int AS count FROM workspace_versions WHERE owner_id=$1 AND scope_id=$2', [run.owner_id, snapshot.scopeId]);
    if (count.rows[0].count >= 100) fail(409, 'WORKSPACE_VERSION_LIMIT', 'Workspace version retention limit reached');
    await client.query(`INSERT INTO workspace_versions(id,owner_id,scope_id,run_id,expected_revision,status,manifest)
      VALUES($1,$2,$3,$4,$5,'staging',$6::jsonb)`, [versionId, run.owner_id, snapshot.scopeId, run.id, snapshot.revision, JSON.stringify(files)]);
  });
  for (const file of files) {
    signal.throwIfAborted(); await guard();
    const bytes = await sandbox.read(`/workspace/${file.path}`, Math.max(1, WORKSPACE_FILE_LIMIT), signal);
    verifyWorkspaceBytes(file, bytes);
    await storage.put(file.objectKey, bytes, 'application/octet-stream');
  }
  signal.throwIfAborted();
  return database.transaction(async client => {
    await client.query('SELECT id FROM users WHERE id=$1 FOR UPDATE', [run.owner_id]);
    await lease(client, run);
    const head = await client.query('SELECT revision FROM workspace_heads WHERE id=$1 AND owner_id=$2 FOR UPDATE', [snapshot.scopeId, run.owner_id]);
    if (!head.rows[0]) throw new Error('WORKSPACE_UNAVAILABLE');
    const conflict = head.rows[0].revision !== snapshot.revision;
    const revision = conflict ? head.rows[0].revision : snapshot.revision + 1;
    await client.query('UPDATE workspace_versions SET status=$3,committed_revision=$4 WHERE id=$1 AND owner_id=$2',
      [versionId, run.owner_id, conflict ? 'conflict' : 'committed', conflict ? null : revision]);
    if (!conflict) await client.query('UPDATE workspace_heads SET revision=$3,manifest=$4::jsonb,updated_at=now() WHERE id=$1 AND owner_id=$2',
      [snapshot.scopeId, run.owner_id, revision, JSON.stringify(files)]);
    await client.query("INSERT INTO events(owner_id,run_id,type,payload) VALUES($1,$2,'workspace_sync',$3::jsonb)",
      [run.owner_id, run.id, JSON.stringify({ status: conflict ? 'conflict' : 'committed', revision, versionId })]);
    return { status: conflict ? 'conflict' : 'committed', versionId, revision };
  });
}

export function createWorkspaceFilesService(database: Database, ownerId: string) {
  async function owned(client: Queryable, scopeId: string) {
    const result = await client.query(`SELECT h.revision,h.manifest FROM workspace_heads h WHERE h.id=$1 AND h.owner_id=$2
      AND (h.workspace_id IS NULL OR EXISTS(SELECT 1 FROM resources r WHERE r.id=h.workspace_id AND r.owner_id=$2 AND r.deleted_at IS NULL))`, [scopeId, ownerId]);
    if (!result.rows[0]) fail(404, 'NOT_FOUND', 'Workspace files not found');
    return result.rows[0];
  }
  return {
    async list(scopeId: string) {
      const head = await owned(database, scopeId);
      return { revision: head.revision, files: validateManifest(head.manifest) };
    },
    async versions(scopeId: string) {
      await owned(database, scopeId);
      return (await database.query(`SELECT id,status,expected_revision AS "expectedRevision",committed_revision AS revision,created_at AS "createdAt"
        FROM workspace_versions WHERE scope_id=$1 AND owner_id=$2 AND status<>'staging' ORDER BY created_at DESC,id LIMIT 100`, [scopeId, ownerId])).rows;
    },
    async file(scopeId: string, path: string, versionId?: string): Promise<StoredWorkspaceFile> {
      const head = await owned(database, scopeId);
      let manifest = head.manifest as StoredWorkspaceFile[];
      if (versionId) {
        const version = await database.query("SELECT manifest FROM workspace_versions WHERE id=$1 AND scope_id=$2 AND owner_id=$3 AND status<>'staging'", [versionId, scopeId, ownerId]);
        if (!version.rows[0]) fail(404, 'NOT_FOUND', 'Workspace version not found');
        manifest = version.rows[0].manifest;
      }
      const file = manifest.find(file => file.path === path);
      if (!file) fail(404, 'NOT_FOUND', 'Workspace file not found');
      return file;
    },
    async restore(scopeId: string, versionId: string, expectedRevision: number) {
      if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0) fail(400, 'INVALID_REVISION', 'expectedRevision is required');
      return database.transaction(async client => {
        await client.query('SELECT id FROM users WHERE id=$1 FOR UPDATE', [ownerId]);
        const head = await owned(client, scopeId);
        if (head.revision !== expectedRevision) fail(409, 'WORKSPACE_REVISION_CONFLICT', 'Workspace changed; refresh before restoring');
        const version = await client.query("SELECT manifest FROM workspace_versions WHERE id=$1 AND scope_id=$2 AND owner_id=$3 AND status<>'staging'", [versionId, scopeId, ownerId]);
        if (!version.rows[0]) fail(404, 'NOT_FOUND', 'Workspace version not found');
        // Previous heads already have an immutable version. Restoring moves the head with a new revision.
        await client.query('UPDATE workspace_heads SET revision=revision+1,manifest=$3::jsonb,updated_at=now() WHERE id=$1 AND owner_id=$2', [scopeId, ownerId, JSON.stringify(version.rows[0].manifest)]);
        return { revision: expectedRevision + 1 };
      });
    },
    async download(scopeId: string, path: string, storage: Storage, versionId?: string) {
      const file = await this.file(scopeId, path, versionId);
      validateManifest([file]);
      if (!file.objectKey.startsWith(`users/${ownerId}/workspaces/${scopeId}/`)) fail(409, 'FILE_INTEGRITY_FAILED', 'Invalid file scope');
      const bytes = await storage.get(file.objectKey, WORKSPACE_FILE_LIMIT);
      try { verifyWorkspaceBytes(file, bytes); }
      catch { fail(409, 'FILE_INTEGRITY_FAILED', 'Stored workspace file failed integrity verification'); }
      return { name: file.path.split('/').at(-1)!, bytes };
    },
  };
}
