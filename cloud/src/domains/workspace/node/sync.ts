import { createHash, randomUUID } from 'node:crypto';
import type { CloudSandbox } from '../../../platform/sandbox.ts';
import type { Storage } from '../../../platform/storage.ts';

export interface ManifestFile { path: string; size: number; sha256: string }
export interface StoredWorkspaceFile extends ManifestFile { objectKey: string }
export interface WorkspaceSnapshot { scopeId: string; ownerId: string; revision: number; files: StoredWorkspaceFile[] }
export const WORKSPACE_FILE_LIMIT = 25 * 1024 * 1024;
export const WORKSPACE_TOTAL_LIMIT = 100 * 1024 * 1024;

export function validateManifest(input: unknown): ManifestFile[] {
  if (!Array.isArray(input) || input.length > 1000) throw new Error('Workspace file count limit exceeded');
  const seen = new Set<string>();
  let total = 0;
  const files = input.map(file => {
    if (!file || typeof file !== 'object' || typeof file.path !== 'string') throw new Error('Invalid workspace path');
    const parts = file.path.split('/');
    if (!['work', 'output'].includes(parts[0]) || parts.length < 2 || Buffer.byteLength(file.path) > 1024 ||
      parts.some((part: string) => !part || part === '.' || part === '..' || /[\\:\u0000-\u001f\u007f]/.test(part) || /[. ]$/.test(part) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part))) throw new Error('Invalid workspace path');
    if (seen.has(file.path)) throw new Error('Duplicate workspace path');
    seen.add(file.path);
    if (!Number.isSafeInteger(file.size) || file.size < 0 || file.size > WORKSPACE_FILE_LIMIT || (total += file.size) > WORKSPACE_TOTAL_LIMIT) throw new Error('Workspace byte limit exceeded');
    if (typeof file.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(file.sha256)) throw new Error('Invalid workspace hash');
    return { path: file.path, size: file.size, sha256: file.sha256 };
  }).sort((a, b) => a.path.localeCompare(b.path, 'en'));
  for (const file of files) {
    const parts = file.path.split('/');
    for (let i = 1; i < parts.length; i++) {
      if (seen.has(parts.slice(0, i).join('/'))) throw new Error('Workspace file/directory path collision');
    }
  }
  return files;
}

export function verifyWorkspaceBytes(file: ManifestFile, bytes: Uint8Array): void {
  if (bytes.byteLength !== file.size || createHash('sha256').update(bytes).digest('hex') !== file.sha256) throw new Error('WORKSPACE_FILE_CHANGED');
}

export async function restoreWorkspace(snapshot: WorkspaceSnapshot, ownerId: string, storage: Storage, sandbox: CloudSandbox, guard: () => Promise<void>): Promise<void> {
  if (!snapshot || snapshot.ownerId !== ownerId) throw new Error('WORKSPACE_OWNER_MISMATCH');
  validateManifest(snapshot.files);
  for (const file of snapshot.files) {
    if (!file.objectKey.startsWith(`users/${ownerId}/workspaces/${snapshot.scopeId}/`)) throw new Error('WORKSPACE_OBJECT_SCOPE_MISMATCH');
    await guard();
    const bytes = await storage.get(file.objectKey, WORKSPACE_FILE_LIMIT);
    verifyWorkspaceBytes(file, bytes);
    await guard();
    await sandbox.write(`/workspace/${file.path}`, bytes);
  }
}

export async function scanWorkspace(sandbox: CloudSandbox, signal: AbortSignal): Promise<ManifestFile[]> {
  const output = `/workspace/.workspace-manifest-${randomUUID()}.json`;
  try {
    const result = await sandbox.exec(`python /opt/picoddy/runtime/workspace.py ${output}`, signal);
    if (result.exitCode !== 0) throw new Error('WORKSPACE_SCAN_FAILED');
    return validateManifest(JSON.parse(Buffer.from(await sandbox.read(output, 1024 * 1024, signal)).toString('utf8')));
  } finally {
    await sandbox.exec(`rm -f -- ${output}`).catch(() => undefined);
  }
}
