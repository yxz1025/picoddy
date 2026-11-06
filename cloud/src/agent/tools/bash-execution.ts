import type { RunSelection } from '../../cloud/runs/types.ts';
import type { CloudSandbox } from '../../platform/sandbox.ts';
import { resolveCloudToolPolicy } from './contracts.ts';

/** Full access authorizes sandbox shell execution; all runtime restrictions still apply. */
export async function executeBash(
  selection: Pick<RunSelection, 'permission' | 'runtimeProfile' | 'delegation'>,
  command: string,
  dependencies: { guard(): Promise<void>; exec: CloudSandbox['exec'] },
  signal?: AbortSignal,
) {
  signal?.throwIfAborted();
  if (!resolveCloudToolPolicy(selection).includes('bash')) throw new Error('BASH_PERMISSION_DENIED');
  await dependencies.guard();
  signal?.throwIfAborted();
  return dependencies.exec(command, signal);
}
