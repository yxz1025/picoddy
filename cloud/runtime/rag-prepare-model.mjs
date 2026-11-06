/** Build/admin-only downloader for the fixed offline RAG model. Never run at application startup. */
import { mkdir, realpath, stat } from 'node:fs/promises';
import path from 'node:path';

const MODEL_ID = 'Xenova/all-MiniLM-L6-v2';
const DEFAULT_MODEL_ROOT = '/opt/picoddy/models';
const ALLOWED_MODEL_ROOTS = ['/opt/picoddy/models', '/models'];

function within(candidate, root) {
  const relative = path.relative(root, candidate);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

if (process.env.RAG_MODEL_PREPARE_ALLOW_NETWORK !== '1') {
  throw new Error('RAG_MODEL_PREPARE_REQUIRES_EXPLICIT_NETWORK_OPT_IN');
}

const requestedRoot = path.resolve(process.env.RAG_MODEL_ROOT || DEFAULT_MODEL_ROOT);
const allowedRoot = ALLOWED_MODEL_ROOTS.find(root => within(requestedRoot, root));
if (!allowedRoot) throw new Error('RAG_MODEL_ROOT_INVALID');
await mkdir(requestedRoot, { recursive: true, mode: 0o755 });
const actualRoot = await realpath(requestedRoot);
if (!within(actualRoot, allowedRoot)) throw new Error('RAG_MODEL_ROOT_INVALID');

const transformers = await import('@xenova/transformers');
transformers.env.allowRemoteModels = true;
transformers.env.allowLocalModels = true;
transformers.env.localModelPath = `${actualRoot}${path.sep}`;
transformers.env.useFSCache = true;
transformers.env.cacheDir = actualRoot;
transformers.env.useBrowserCache = false;
transformers.env.useCustomCache = false;

await transformers.pipeline('feature-extraction', MODEL_ID);
const modelPath = path.join(actualRoot, ...MODEL_ID.split('/'));
const details = await stat(modelPath).catch(() => null);
if (!details?.isDirectory()) throw new Error('RAG_MODEL_PREPARE_INCOMPLETE');
process.stdout.write(JSON.stringify({ model: MODEL_ID, modelPath }));
