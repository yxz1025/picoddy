import { loadConfig } from '../src/config.ts';
import {
  createSandbox,
  reconcileRunSandboxes,
} from '../src/platform/sandbox.ts';
import { createStorage } from '../src/platform/storage.ts';
import {
  liveSmokeFailureMessage,
  runLiveSandboxOssSmoke,
} from './live-smoke-core.ts';

const controller = new AbortController();
const abort = () => {
  if (!controller.signal.aborted) controller.abort(new Error('LIVE_SMOKE_CANCELLED'));
};
process.once('SIGINT', abort);
process.once('SIGTERM', abort);

try {
  const result = await runLiveSandboxOssSmoke(process.env, {
    loadConfig,
    createStorage,
    createSandbox,
    reconcileRunSandboxes,
  }, controller.signal);
  process.stdout.write(
    `LIVE_SANDBOX_OSS_SMOKE_PASS bytes=${result.bytes} guardChecks=${result.guardChecks} cleanup=complete\n`,
  );
} catch (error) {
  process.stderr.write(`${liveSmokeFailureMessage(error)}\n`);
  process.exitCode = 1;
} finally {
  process.removeListener('SIGINT', abort);
  process.removeListener('SIGTERM', abort);
}
