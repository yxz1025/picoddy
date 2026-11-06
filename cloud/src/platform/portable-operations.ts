import { randomUUID } from 'node:crypto';
import type { CloudSandbox } from './sandbox.ts';

export async function runPortableOperation(sandbox: CloudSandbox, request: Record<string, unknown>, signal?: AbortSignal): Promise<any> {
  const bytes = Buffer.from(JSON.stringify(request));
  if (bytes.length > 1024*1024) throw new Error('TOOL_REQUEST_TOO_LARGE');
  const path = `/workspace/.portable-${randomUUID()}.json`;
  await sandbox.write(path, bytes);
  try {
    await sandbox.exec(`node /opt/picoddy/runtime/portable-runner.mjs ${path}`, signal);
    const result = JSON.parse(Buffer.from(await sandbox.read(`${path}.out`, 10*1024*1024, signal)).toString());
    if (!result.ok) throw Object.assign(new Error(result.message), { code: result.code });
    return result.result;
  } finally { await sandbox.exec(`rm -f -- ${path} ${path}.out`).catch(() => {}); }
}
