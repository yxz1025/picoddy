import type { RagHit, RagSearchMode, RagStoredChunk } from './types.ts';

const BM25_K1 = 1.5;
const BM25_B = 0.75;

function terms(value: string): string[] {
  const normalized = value.normalize('NFKC').toLocaleLowerCase('und');
  const groups = normalized.match(/[\p{Script=Han}]+|[\p{L}\p{N}_]+/gu) ?? [];
  const output: string[] = [];
  for (const group of groups) {
    if (/^\p{Script=Han}+$/u.test(group)) {
      const characters = [...group];
      output.push(...characters);
      for (let index = 0; index + 1 < characters.length; index += 1) {
        output.push(`${characters[index]}${characters[index + 1]}`);
      }
    } else {
      output.push(group);
    }
  }
  return output;
}

function cosine(left: readonly number[], right: readonly number[]): number | null {
  if (left.length === 0 || left.length !== right.length) return null;
  let dot = 0;
  let leftNorm = 0;
  let rightNorm = 0;
  for (let index = 0; index < left.length; index += 1) {
    const a = left[index];
    const b = right[index];
    if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
    dot += a * b;
    leftNorm += a * a;
    rightNorm += b * b;
  }
  if (leftNorm === 0 || rightNorm === 0) return null;
  return dot / Math.sqrt(leftNorm * rightNorm);
}

export function rankRagChunks(
  query: string,
  chunks: readonly RagStoredChunk[],
  queryEmbedding: readonly number[] | null,
  topK: number,
): { mode: RagSearchMode; hits: RagHit[] } {
  const queryTerms = [...new Set(terms(query))];
  const tokenized = chunks.map(chunk => terms(chunk.text));
  const averageLength = tokenized.length === 0
    ? 1
    : tokenized.reduce((total, tokens) => total + tokens.length, 0) / tokenized.length || 1;
  const documentFrequency = new Map<string, number>();
  for (const tokens of tokenized) {
    for (const term of new Set(tokens)) {
      if (queryTerms.includes(term)) {
        documentFrequency.set(term, (documentFrequency.get(term) ?? 0) + 1);
      }
    }
  }

  const keywordScores = tokenized.map(tokens => {
    const frequencies = new Map<string, number>();
    for (const token of tokens) frequencies.set(token, (frequencies.get(token) ?? 0) + 1);
    let score = 0;
    for (const term of queryTerms) {
      const frequency = frequencies.get(term) ?? 0;
      if (frequency === 0) continue;
      const frequencyInDocuments = documentFrequency.get(term) ?? 0;
      const inverseFrequency = Math.log(
        1 + (chunks.length - frequencyInDocuments + 0.5) / (frequencyInDocuments + 0.5),
      );
      const denominator = frequency + BM25_K1 * (
        1 - BM25_B + BM25_B * tokens.length / averageLength
      );
      score += inverseFrequency * (frequency * (BM25_K1 + 1)) / denominator;
    }
    return score;
  });
  const maxKeyword = Math.max(0, ...keywordScores);

  const vectorScores = chunks.map(chunk =>
    queryEmbedding && chunk.embedding ? cosine(queryEmbedding, chunk.embedding) : null
  );
  const mode: RagSearchMode = vectorScores.some(score => score !== null) ? 'hybrid' : 'bm25';
  const limit = Math.max(1, Math.min(20, Math.floor(topK)));

  return {
    mode,
    hits: chunks.map((chunk, index) => {
      const keyword = maxKeyword > 0 ? keywordScores[index] / maxKeyword : 0;
      const vector = vectorScores[index];
      const score = mode === 'hybrid'
        ? keyword * 0.4 + (vector === null ? 0 : Math.max(0, Math.min(1, (vector + 1) / 2))) * 0.6
        : keyword;
      const rounded = Math.round(score * 1_000_000) / 1_000_000;
      return {
        ...chunk,
        citation: {
          documentId: chunk.documentId,
          sourcePath: chunk.sourcePath,
          sourceName: chunk.sourceName,
          version: chunk.version,
          chunkIndex: chunk.chunkIndex,
          lineStart: chunk.lineStart,
          lineEnd: chunk.lineEnd,
          page: chunk.page,
          score: rounded,
        },
      };
    }).filter(hit => hit.citation.score > 0)
      .sort((left, right) =>
        right.citation.score - left.citation.score ||
        left.sourcePath.localeCompare(right.sourcePath) ||
        left.chunkIndex - right.chunkIndex
      )
      .slice(0, limit),
  };
}
