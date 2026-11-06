import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('runtime embedding helper is pinned to local-only Xenova assets', async () => {
  const source = await readFile(new URL('../runtime/rag-embedding.mjs', import.meta.url), 'utf8');

  assert.match(source, /Xenova\/all-MiniLM-L6-v2/);
  assert.match(source, /\/opt\/picoddy\/models\/Xenova\/all-MiniLM-L6-v2/);
  assert.match(source, /env\.allowRemoteModels = false/);
  assert.match(source, /env\.useFSCache = false/);
  assert.match(source, /env\.useBrowserCache = false/);
  assert.match(source, /local_files_only: true/);
  assert.doesNotMatch(source, /env\.allowRemoteModels = true/);
});

test('model preparation requires explicit build-time network opt-in', async () => {
  const source = await readFile(new URL('../runtime/rag-prepare-model.mjs', import.meta.url), 'utf8');

  assert.match(source, /RAG_MODEL_PREPARE_ALLOW_NETWORK/);
  assert.match(source, /RAG_MODEL_PREPARE_REQUIRES_EXPLICIT_NETWORK_OPT_IN/);
  assert.match(source, /env\.allowRemoteModels = true/);
  assert.match(source, /env\.cacheDir = actualRoot/);
});
