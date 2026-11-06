import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile, readdir } from 'node:fs/promises';

test('Docker build stage includes top-level modules statically imported by tests', async () => {
  const dockerfile = await readFile(new URL('../Dockerfile', import.meta.url), 'utf8');
  const buildStage = dockerfile.split(/\nFROM /)[0].split('RUN npm run build')[0];
  const copied = new Set([...buildStage.matchAll(/^COPY\s+(\S+)\s+/gm)].map(match => match[1]));
  for (const filename of await readdir(new URL('./', import.meta.url))) {
    if (!filename.endsWith('.ts')) continue;
    const source = await readFile(new URL(filename, import.meta.url), 'utf8');
    for (const match of source.matchAll(/(?:from\s*|import\s*\()(['"])\.\.\/([^/'"]+)\//g)) {
      assert.ok(copied.has(match[2]), `${filename} imports ${match[2]}, missing from Docker build stage`);
    }
  }
});
