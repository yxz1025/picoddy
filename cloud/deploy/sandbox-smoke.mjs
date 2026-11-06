import { randomUUID } from 'node:crypto';
import { loadConfig } from '../src/config.ts';
import { createSandbox } from '../src/platform/sandbox.ts';
let sandbox;
try {
  sandbox = await createSandbox(loadConfig(), randomUUID(), AbortSignal.timeout(120000));
  const expected = Buffer.from('部署验证\n\0\xff\n', 'utf8');
  await sandbox.write('/workspace/work/deploy-check.bin', expected);
  const actual = await sandbox.read('/workspace/work/deploy-check.bin', 1024, AbortSignal.timeout(15000));
  if (!expected.equals(Buffer.from(actual))) throw new Error();
  const result = await sandbox.exec('test -r /opt/picoddy/runtime/workspace.py && python --version', AbortSignal.timeout(15000));
  if (result.exitCode !== 0) throw new Error();
  console.log('OpenSandbox 命令与文件读写验证通过');
} catch {
  console.error('OpenSandbox 验证失败，请检查执行服务日志、镜像和网络（未输出凭证）。');
  process.exitCode = 1;
} finally {
  if (sandbox) {
    try { await sandbox.destroy(); console.log('临时沙箱已清理'); }
    catch { console.error('临时沙箱清理失败，请在 OpenSandbox 检查残留实例。'); process.exitCode = 1; }
  }
}
