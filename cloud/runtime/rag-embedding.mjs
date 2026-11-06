/** Trusted, local-only Xenova embedding adapter executed inside OpenSandbox. */
import { constants as fsConstants } from 'node:fs';
import { lstat, open, realpath, stat, unlink } from 'node:fs/promises';
import path from 'node:path';

const WORKSPACE = '/workspace';
const MODEL_ID = 'Xenova/all-MiniLM-L6-v2';
const DEFAULT_MODEL_PATH = '/opt/picoddy/models/Xenova/all-MiniLM-L6-v2';
const ALLOWED_MODEL_ROOTS = ['/opt/picoddy/models', '/models'];
const MAX_TEXTS = 1_000;
const MAX_TEXT_BYTES = 16_384;
const MAX_TOTAL_TEXT_BYTES = 6 * 1024 * 1024;
const MAX_REQUEST_BYTES = 8 * 1024 * 1024;
const MAX_RESPONSE_BYTES = 16 * 1024 * 1024;
const VECTOR_DIMENSIONS = 384;

let extractorPromise;

function workspaceFile(value, kind) {
  if (typeof value !== 'string') throw new Error(`RAG_${kind.toUpperCase()}_PATH_INVALID`);
  const candidate = path.resolve(value);
  const expected = new RegExp(`^\\.rag-${kind}-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\\.json$`);
  if (path.dirname(candidate) !== WORKSPACE || !expected.test(path.basename(candidate))) {
    throw new Error(`RAG_${kind.toUpperCase()}_PATH_INVALID`);
  }
  return candidate;
}

function within(candidate, root) {
  const relative = path.relative(root, candidate);
  return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative);
}

async function modelLocation() {
  const configured = path.resolve(process.env.RAG_MODEL_PATH || DEFAULT_MODEL_PATH);
  const root = ALLOWED_MODEL_ROOTS.find(item => within(configured, item));
  if (!root) throw new Error('RAG_MODEL_PATH_INVALID');
  let actual;
  try {
    actual = await realpath(configured);
    const details = await stat(actual);
    if (!details.isDirectory()) throw new Error('LOCAL_MINILM_NOT_INSTALLED');
  } catch (error) {
    if (error?.message === 'LOCAL_MINILM_NOT_INSTALLED') throw error;
    if (error?.code === 'ENOENT') throw new Error('LOCAL_MINILM_NOT_INSTALLED');
    throw new Error('LOCAL_MINILM_LOAD_FAILED');
  }
  if (!within(actual, root)) throw new Error('RAG_MODEL_PATH_INVALID');
  return { root, modelRef: path.relative(root, actual).split(path.sep).join('/') };
}

async function loadExtractor() {
  if (extractorPromise) return extractorPromise;
  extractorPromise = (async () => {
    const location = await modelLocation();
    let transformers;
    try {
      transformers = await import('@xenova/transformers');
    } catch {
      throw new Error('LOCAL_MINILM_RUNTIME_NOT_INSTALLED');
    }
    transformers.env.allowRemoteModels = false;
    transformers.env.allowLocalModels = true;
    transformers.env.localModelPath = `${location.root}${path.sep}`;
    transformers.env.useFSCache = false;
    transformers.env.useBrowserCache = false;
    transformers.env.useCustomCache = false;
    try {
      return await transformers.pipeline('feature-extraction', location.modelRef, {
        local_files_only: true,
      });
    } catch {
      throw new Error('LOCAL_MINILM_LOAD_FAILED');
    }
  })();
  extractorPromise.catch(() => { extractorPromise = undefined; });
  return extractorPromise;
}

function embeddingFailure(error) {
  const allowed = new Set([
    'RAG_MODEL_PATH_INVALID',
    'LOCAL_MINILM_NOT_INSTALLED',
    'LOCAL_MINILM_RUNTIME_NOT_INSTALLED',
    'LOCAL_MINILM_LOAD_FAILED',
    'LOCAL_MINILM_INVALID_VECTOR',
  ]);
  return {
    available: false,
    model: MODEL_ID,
    reason: error instanceof Error && allowed.has(error.message)
      ? error.message
      : 'LOCAL_MINILM_LOAD_FAILED',
  };
}

function validateTexts(value) {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_TEXTS) {
    throw new Error('RAG_EMBEDDING_TEXTS_INVALID');
  }
  let total = 0;
  return value.map(item => {
    if (typeof item !== 'string' || !item.trim()) throw new Error('RAG_EMBEDDING_TEXTS_INVALID');
    const bytes = Buffer.byteLength(item, 'utf8');
    if (bytes > MAX_TEXT_BYTES) throw new Error('RAG_EMBEDDING_TEXT_TOO_LARGE');
    total += bytes;
    if (total > MAX_TOTAL_TEXT_BYTES) throw new Error('RAG_EMBEDDING_BUDGET_EXCEEDED');
    return item;
  });
}

function validateVectors(value, expected) {
  if (!Array.isArray(value) || value.length !== expected) throw new Error('LOCAL_MINILM_INVALID_VECTOR');
  return value.map(vector => {
    if (!Array.isArray(vector) || vector.length !== VECTOR_DIMENSIONS ||
        vector.some(number => typeof number !== 'number' || !Number.isFinite(number))) {
      throw new Error('LOCAL_MINILM_INVALID_VECTOR');
    }
    return vector;
  });
}

async function execute(request) {
  const operation = request?.operation;
  if (operation === 'embedding_status') {
    try {
      await loadExtractor();
      return { embedding: { available: true, model: MODEL_ID, reason: null } };
    } catch (error) {
      return { embedding: embeddingFailure(error) };
    }
  }
  if (operation === 'embed') {
    const texts = validateTexts(request?.arguments?.texts);
    try {
      const extractor = await loadExtractor();
      const output = await extractor(texts, { pooling: 'mean', normalize: true });
      const vectors = validateVectors(output.tolist(), texts.length);
      return {
        embedding: { available: true, model: MODEL_ID, reason: null },
        vectors,
      };
    } catch (error) {
      return { embedding: embeddingFailure(error), vectors: null };
    }
  }
  throw new Error('RAG_OPERATION_INVALID');
}

async function readRequest(requestPath) {
  const flags = fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW || 0);
  const handle = await open(requestPath, flags);
  try {
    const details = await handle.stat();
    if (!details.isFile() || details.size > MAX_REQUEST_BYTES) throw new Error('RAG_REQUEST_INVALID');
    return JSON.parse(await handle.readFile({ encoding: 'utf8' }));
  } finally {
    await handle.close();
  }
}

async function writeResponse(responsePath, value) {
  const encoded = Buffer.from(JSON.stringify(value));
  if (encoded.length > MAX_RESPONSE_BYTES) throw new Error('RAG_RESPONSE_BUDGET_EXCEEDED');
  const flags = fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_EXCL |
    (fsConstants.O_NOFOLLOW || 0);
  const handle = await open(responsePath, flags, 0o600);
  try {
    await handle.writeFile(encoded);
  } catch (error) {
    await handle.close();
    await unlink(responsePath).catch(() => undefined);
    throw error;
  }
  await handle.close();
}

async function deleteResponse(value) {
  const target = workspaceFile(value, 'response');
  try {
    const details = await lstat(target);
    if (!details.isFile() || details.isSymbolicLink()) throw new Error('RAG_RESPONSE_PATH_INVALID');
    await unlink(target);
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
}

async function main() {
  if (process.argv.length === 4 && process.argv[2] === '--delete-response') {
    await deleteResponse(process.argv[3]);
    return;
  }
  if (process.argv.length !== 3) throw new Error('RAG_REQUEST_PATH_INVALID');
  const requestPath = workspaceFile(process.argv[2], 'request');
  try {
    if (await realpath(requestPath) !== requestPath) throw new Error('RAG_REQUEST_PATH_INVALID');
    const request = await readRequest(requestPath);
    const responsePath = workspaceFile(request?.responsePath, 'response');
    await writeResponse(responsePath, await execute(request));
    process.stdout.write(JSON.stringify({ responsePath }));
  } finally {
    await unlink(requestPath).catch(() => undefined);
  }
}

await main();
