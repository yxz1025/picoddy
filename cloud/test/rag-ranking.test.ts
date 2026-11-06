import assert from 'node:assert/strict';
import test from 'node:test';

import { rankRagChunks } from '../src/domains/rag/node/ranking.ts';

test('BM25 fallback ranks Chinese and Latin terms without claiming vectors', () => {
  const ranked = rankRagChunks('门店 inventory 风险', [
    {
      id: '1', documentId: 'd1', sourcePath: '/workspace/input/a.md', sourceName: 'a.md',
      version: 1, chunkIndex: 0, text: '门店库存风险与补货建议', lineStart: 1, lineEnd: 1,
      page: null, embedding: null,
    },
    {
      id: '2', documentId: 'd2', sourcePath: '/workspace/input/b.md', sourceName: 'b.md',
      version: 1, chunkIndex: 0, text: 'unrelated inventory export syntax', lineStart: 1, lineEnd: 1,
      page: null, embedding: null,
    },
  ], null, 5);

  assert.equal(ranked.mode, 'bm25');
  assert.equal(ranked.hits[0]?.documentId, 'd1');
  assert.equal(ranked.hits[0]?.citation.score > 0, true);
});

test('hybrid ranking is reported only when a query vector and chunk vectors exist', () => {
  const chunks = [{
    id: '1', documentId: 'd1', sourcePath: '/workspace/input/a.md', sourceName: 'a.md',
    version: 2, chunkIndex: 3, text: 'quarterly sales', lineStart: 10, lineEnd: 12,
    page: 2, embedding: [1, 0],
  }];
  assert.equal(rankRagChunks('sales', chunks, null, 5).mode, 'bm25');
  assert.equal(rankRagChunks('sales', chunks, [1, 0], 5).mode, 'hybrid');
});
