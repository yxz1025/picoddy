import { randomUUID } from 'node:crypto';
import type { Config } from '../config.ts';
import { createSandbox, reconcileRunSandboxes, type CloudSandbox } from './sandbox.ts';

export type BuiltinOperation = { operation: 'installation'; id: 'gitlab' | 'jenkins' };
export async function runBuiltinInSandbox(config: Config, request: BuiltinOperation): Promise<Record<string, any>> {
  const id = randomUUID(), path = `/workspace/.builtin-${id}.json`;
  const signal = AbortSignal.timeout(60000);
  let sandbox: CloudSandbox | undefined;
  try {
    sandbox = await createSandbox({ ...config, sandboxTimeoutSeconds: 60 }, id, signal);
    await sandbox.write(path, Buffer.from(JSON.stringify(request)));
    const result = await sandbox.exec(`node /opt/picoddy/builtin-runner.mjs ${path}`, signal);
    if (result.exitCode !== 0) throw new Error('内置连接器沙箱操作失败，请检查执行镜像和网络');
    return JSON.parse(Buffer.from(await sandbox.read(`${path}.out`, 512 * 1024, signal)).toString());
  } finally {
    try { await sandbox?.destroy(); }
    finally { await reconcileRunSandboxes(config, id); }
  }
}

const checks = new Map<string, { expires: number; result: Promise<boolean> }>();
export async function builtinInstalled(config: Config, id: 'gitlab' | 'jenkins', force = false) {
  const key = `${config.sandboxDomain}:${config.sandboxImage}:${id}`;
  const old = checks.get(key);
  if (!force && old && old.expires > Date.now()) return old.result;
  const result = runBuiltinInSandbox(config, { operation: 'installation', id }).then(value => value.installed === true, () => false);
  checks.set(key, { expires: Date.now() + 60000, result });
  return result;
}
