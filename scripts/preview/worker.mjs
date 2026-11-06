import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { startPreview } from './runtime.mjs';

const request = JSON.parse(await readFile(process.env.PREVIEW_REQUEST_PATH, 'utf8'));
// This flag is needed only to bootstrap this Node worker, never for DevTools/browser children.
delete process.env.ELECTRON_RUN_AS_NODE;
let runtime, session, stopping = false;
const send = message => { if (process.connected) process.send(message, () => {}); };
async function stop(failure) {
  if (stopping) return;
  stopping = true;
  const timer = setTimeout(() => process.exit(1), 12000); timer.unref();
  try { await session?.close(); } catch (e) { failure ||= `清理失败：${e.message}`; }
  send({ type: 'end', error: failure || '' });
  process.exitCode = failure ? 1 : 0;
  if (process.connected) process.disconnect();
}
process.once('disconnect', () => void stop());
process.once('SIGTERM', () => void stop());
process.once('SIGINT', () => void stop());
process.on('message', message => {
  if (message?.type === 'stop') void stop();
  if (message?.type === 'capture' && /^[a-f0-9-]{36}$/.test(message.id) && runtime && !stopping) {
    const path = join(request.outputDir, `${message.id}.png`);
    void runtime.screenshot(path).then(() => send({ type: 'capture', id: message.id }), e => send({ type: 'capture', id: message.id, error: String(e) }));
  }
});
try {
  runtime = await startPreview(request, { log: line => send({ type: 'log', line: line.slice(0, 2000) }), onSession: value => { session = value; if (stopping) void session.close(); } });
  if (stopping) await runtime.close();
  else { send({ type: 'ready' }); runtime.failure.catch(e => void stop(e.message)); }
} catch (e) { await stop(e.message); }
