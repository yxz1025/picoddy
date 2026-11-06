export type RagSearchMode = 'hybrid' | 'bm25';

export interface RagEmbeddingStatus {
  available: boolean;
  model: string;
  reason: string | null;
}

export interface RagCitation {
  documentId: string;
  sourcePath: string;
  sourceName: string;
  version: number;
  chunkIndex: number;
  lineStart: number;
  lineEnd: number;
  page: number | null;
  score: number;
}

export interface RagStoredChunk {
  id: string;
  documentId: string;
  sourcePath: string;
  sourceName: string;
  version: number;
  chunkIndex: number;
  text: string;
  lineStart: number;
  lineEnd: number;
  page: number | null;
  embedding: number[] | null;
}

export interface RagHit extends RagStoredChunk {
  citation: RagCitation;
}

export interface RagQueryResult {
  mode: RagSearchMode;
  hits: RagHit[];
  citations: RagCitation[];
  embedding: RagEmbeddingStatus;
}

export interface RagDocumentSummary {
  id: string;
  sourcePath: string;
  sourceName: string;
  contentHash: string;
  version: number;
  chunks: number;
  embeddingStatus: 'hybrid' | 'bm25';
  embeddingModel: string;
  indexedAt: string;
}

export interface RagStatus {
  documents: number;
  chunks: number;
  vectors: number;
  vectorSearch: boolean;
  embeddingModel: string;
  embedding: RagEmbeddingStatus;
  recentDocuments: RagDocumentSummary[];
}

export interface RagRuntimeChunk {
  chunkIndex: number;
  text: string;
  lineStart: number;
  lineEnd: number;
  page: number | null;
  embedding: number[] | null;
}

export interface RagParsedChunk extends Omit<RagRuntimeChunk, 'embedding'> {}

export interface RagParsedDocument extends Omit<RagRuntimeDocument, 'chunks' | 'embedding'> {
  chunks: RagParsedChunk[];
}

export interface RagRuntimeDocument {
  sourcePath: string;
  sourceName: string;
  contentHash: string;
  size: number;
  modifiedAt: number | null;
  chunks: RagRuntimeChunk[];
  embedding: RagEmbeddingStatus;
}

export interface RagRuntimeIndexResult {
  documents: RagParsedDocument[];
  errors: Array<{ sourcePath: string; code: string }>;
}
