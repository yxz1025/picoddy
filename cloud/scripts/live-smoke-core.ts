import {
  createHash,
  randomBytes as cryptoRandomBytes,
  randomUUID as cryptoRandomUUID,
} from 'node:crypto';

import type { Config } from '../src/config.ts';
import type { CloudSandbox } from '../src/platform/sandbox.ts';
import type { Storage } from '../src/platform/storage.ts';
import {
  restoreWorkspace,
  verifyWorkspaceBytes,
  type ManifestFile,
  type WorkspaceSnapshot,
} from '../src/domains/workspace/node/sync.ts';

const PAYLOAD_BYTES = 4096;
const WORKSPACE_PATH = 'work/smoke.bin';
const PREFLIGHT_VARIABLES = [
  'DATABASE_URL',
  'ENCRYPTION_KEY',
  'SANDBOX_DOMAIN',
  'SANDBOX_API_KEY',
  'SANDBOX_IMAGE',
  'OSS_REGION',
  'OSS_BUCKET',
  'OSS_ACCESS_KEY_ID',
  'OSS_ACCESS_KEY_SECRET',
  'STORAGE_DRIVER',
] as const;

type LiveSmokeStage =
  | 'preflight'
  | 'config'
  | 'storage_create'
  | 'oss_ready'
  | 'oss_put'
  | 'oss_read'
  | 'oss_bounded_read'
  | 'sandbox_create'
  | 'workspace_restore'
  | 'workspace_verify'
  | 'cleanup';

type CleanupStage = 'destroy' | 'reconcile' | 'remove';

class LiveSmokeDiagnosticError extends Error {
  constructor(
    readonly details: {
      stage: LiveSmokeStage;
      cleanup: 'complete' | 'incomplete';
      missing?: readonly string[];
      runId?: string;
      objectKey?: string;
      cleanupFailures?: readonly CleanupStage[];
    },
    readonly underlying: readonly unknown[] = [],
  ) {
    super('LIVE_SANDBOX_OSS_SMOKE_FAILED');
    this.name = 'LiveSmokeDiagnosticError';
  }
}

export interface LiveSmokeDependencies {
  loadConfig(environment: Record<string, string | undefined>): Config;
  createStorage(config: Config): Storage;
  createSandbox(config: Config, runId: string, signal?: AbortSignal): Promise<CloudSandbox>;
  reconcileRunSandboxes(config: Config, runId: string): Promise<void>;
  randomUUID?: () => string;
  randomBytes?: (size: number) => Uint8Array;
}

export interface LiveSmokeResult {
  bytes: number;
  guardChecks: number;
}

export function liveSmokeFailureMessage(error: unknown): string {
  if (!(error instanceof LiveSmokeDiagnosticError)) {
    return 'LIVE_SANDBOX_OSS_SMOKE_FAILED stage=unknown cleanup=unknown';
  }
  const { details } = error;
  const fields = [
    'LIVE_SANDBOX_OSS_SMOKE_FAILED',
    `stage=${details.stage}`,
    `cleanup=${details.cleanup}`,
  ];
  if (details.missing?.length) fields.push(`missing=${details.missing.join(',')}`);
  if (details.runId) fields.push(`runId=${details.runId}`);
  if (details.objectKey) fields.push(`objectKey=${details.objectKey}`);
  if (details.cleanupFailures?.length) {
    fields.push(`cleanupFailures=${details.cleanupFailures.join(',')}`);
  }
  return fields.join(' ');
}

function hash(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function manifestFile(bytes: Uint8Array): ManifestFile {
  return {
    path: WORKSPACE_PATH,
    size: bytes.byteLength,
    sha256: hash(bytes),
  };
}

function missingPreflightVariables(environment: Record<string, string | undefined>): string[] {
  return PREFLIGHT_VARIABLES.filter(name => !environment[name]?.trim());
}

export async function runLiveSandboxOssSmoke(
  environment: Record<string, string | undefined>,
  dependencies: LiveSmokeDependencies,
  signal?: AbortSignal,
): Promise<LiveSmokeResult> {
  const missing = missingPreflightVariables(environment);
  if (missing.length > 0) {
    throw new LiveSmokeDiagnosticError({
      stage: 'preflight', cleanup: 'complete', missing,
    });
  }

  const uuid = dependencies.randomUUID ?? cryptoRandomUUID;
  const makeBytes = dependencies.randomBytes ?? cryptoRandomBytes;
  const runId = uuid();
  const ownerId = uuid();
  const scopeId = uuid();
  const versionId = uuid();
  const objectId = uuid();
  const objectKey = `users/${ownerId}/workspaces/${scopeId}/${versionId}/${objectId}`;
  const payload = new Uint8Array(makeBytes(PAYLOAD_BYTES));
  let config: Config;
  try {
    signal?.throwIfAborted();
    config = dependencies.loadConfig(environment);
    if (config.storageDriver !== 'oss' || !config.oss) {
      throw new Error('LIVE_SMOKE_REQUIRES_OSS');
    }
    if (payload.byteLength < 2) throw new Error('LIVE_SMOKE_PAYLOAD_INVALID');
  } catch (error) {
    throw new LiveSmokeDiagnosticError({
      stage: 'config', cleanup: 'complete', runId, objectKey,
    }, [error]);
  }

  let storage: Storage | undefined;
  let sandbox: CloudSandbox | undefined;
  let putAttempted = false;
  let sandboxCreateAttempted = false;
  let primaryError: unknown;
  let primaryStage: LiveSmokeStage | undefined;
  let stage: LiveSmokeStage = 'storage_create';
  let result: LiveSmokeResult | undefined;
  const cleanupErrors: Array<{ stage: CleanupStage; error: unknown }> = [];

  try {
    signal?.throwIfAborted();
    storage = dependencies.createStorage(config);
    stage = 'oss_ready';
    signal?.throwIfAborted();
    await storage.ready();

    stage = 'oss_put';
    signal?.throwIfAborted();
    putAttempted = true;
    await storage.put(objectKey, payload, 'application/octet-stream');
    const file = manifestFile(payload);
    stage = 'oss_read';
    signal?.throwIfAborted();
    verifyWorkspaceBytes(file, await storage.get(objectKey, payload.byteLength));

    stage = 'oss_bounded_read';
    signal?.throwIfAborted();
    let boundedReadRejected = false;
    try {
      await storage.get(objectKey, payload.byteLength - 1);
    } catch {
      boundedReadRejected = true;
    }
    if (!boundedReadRejected) throw new Error('LIVE_SMOKE_BOUNDED_READ_NOT_ENFORCED');

    stage = 'sandbox_create';
    signal?.throwIfAborted();
    sandboxCreateAttempted = true;
    sandbox = await dependencies.createSandbox(config, runId, signal);
    const snapshot: WorkspaceSnapshot = {
      ownerId,
      scopeId,
      revision: 1,
      files: [{ ...file, objectKey }],
    };
    let guardChecks = 0;
    stage = 'workspace_restore';
    await restoreWorkspace(snapshot, ownerId, storage, sandbox, async () => {
      signal?.throwIfAborted();
      guardChecks += 1;
    });
    stage = 'workspace_verify';
    signal?.throwIfAborted();
    const restored = await sandbox.read(
      `/workspace/${WORKSPACE_PATH}`,
      payload.byteLength,
      signal,
    );
    verifyWorkspaceBytes(file, restored);
    result = { bytes: payload.byteLength, guardChecks };
  } catch (error) {
    primaryError = error;
    primaryStage = stage;
  }

  if (sandbox) {
    try {
      await sandbox.destroy();
    } catch (error) {
      cleanupErrors.push({ stage: 'destroy', error });
    }
  }
  if (sandboxCreateAttempted) {
    try {
      await dependencies.reconcileRunSandboxes(config, runId);
    } catch (error) {
      cleanupErrors.push({ stage: 'reconcile', error });
    }
  }
  if (storage && putAttempted) {
    try {
      await storage.remove(objectKey);
    } catch (error) {
      cleanupErrors.push({ stage: 'remove', error });
    }
  }

  if (primaryError !== undefined || cleanupErrors.length > 0) {
    throw new LiveSmokeDiagnosticError({
      stage: primaryStage ?? 'cleanup',
      cleanup: cleanupErrors.length > 0 ? 'incomplete' : 'complete',
      runId,
      objectKey,
      ...(cleanupErrors.length > 0
        ? { cleanupFailures: cleanupErrors.map(item => item.stage) }
        : {}),
    }, [
      ...(primaryError === undefined ? [] : [primaryError]),
      ...cleanupErrors.map(item => item.error),
    ]);
  }
  if (!result) throw new Error('LIVE_SMOKE_RESULT_MISSING');
  return result;
}
