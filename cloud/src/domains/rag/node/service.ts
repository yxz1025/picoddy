import { randomUUID } from 'node:crypto';

import type { Database } from '../../../infra/db.ts';
import { sandboxPath, type CloudSandbox } from '../../../platform/sandbox.ts';
import type { Run } from '../../../cloud/runs/types.ts';
import { renderJsonBlock } from '../../../agent/prompt-runtime/boundary-encoding.ts';
import { rankRagChunks } from './ranking.ts';
import { createRagStore } from './store.ts';
import type {
  RagDocumentSummary,
  RagEmbeddingStatus,
  RagParsedDocument,
  RagQueryResult,
  RagRuntimeDocument,
  RagRuntimeIndexResult,
  RagStatus,
} from './types.ts';

const PARSER_RUNTIME = '/opt/picoddy/runtime/rag.py';
const EMBEDDING_RUNTIME = '/opt/picoddy/runtime/rag-embedding.mjs';
const EMBEDDING_MODEL = 'Xenova/all-MiniLM-L6-v2';
const MAX_RUNTIME_RESPONSE_BYTES = 16 * 1024 * 1024;
const MAX_QUERY_CHARACTERS = 4_000;
const DEFAULT_PROMPT_CHARACTERS = 16_000;

interface RuntimeEnvelope {
  responsePath: string;
}

function cleanQuery(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error('RAG_QUERY_REQUIRED');
  const query = value.trim();
  if (query.length > MAX_QUERY_CHARACTERS) throw new Error('RAG_QUERY_TOO_LARGE');
  return query;
}

function queryLimit(value: unknown): number {
  if (value === undefined) return 5;
  if (!Number.isSafeInteger(value) || Number(value) < 1 || Number(value) > 20) {
    throw new Error('RAG_TOP_K_INVALID');
  }
  return Number(value);
}

function contextLimit(value: unknown): number {
  if (value === undefined) return DEFAULT_PROMPT_CHARACTERS;
  if (!Number.isSafeInteger(value) || Number(value) < 1_000 || Number(value) > 64_000) {
    throw new Error('RAG_MAX_CHARACTERS_INVALID');
  }
  return Number(value);
}

function controlledPath(value: unknown): string {
  if (typeof value !== 'string' || !value.trim() || value.length > 1024) {
    throw new Error('RAG_PATH_INVALID');
  }
  const path = sandboxPath(value.trim());
  if (path === '/workspace') throw new Error('RAG_PATH_MUST_SELECT_A_FILE_OR_DIRECTORY');
  return path;
}

function embeddingStatus(value: unknown): RagEmbeddingStatus {
  if (!value || typeof value !== 'object') {
    return { available: false, model: EMBEDDING_MODEL, reason: 'LOCAL_MINILM_NOT_INSTALLED' };
  }
  const item = value as Record<string, unknown>;
  return {
    available: item.available === true,
    model: typeof item.model === 'string' ? item.model : EMBEDDING_MODEL,
    reason: item.available === true ? null :
      typeof item.reason === 'string' ? item.reason : 'LOCAL_MINILM_NOT_INSTALLED',
  };
}

function validateParsedDocument(value: unknown, requestedPaths: readonly string[]): RagParsedDocument {
  if (!value || typeof value !== 'object') throw new Error('RAG_RUNTIME_INVALID_DOCUMENT');
  const item = value as Record<string, unknown>;
  const sourcePath = controlledPath(item.sourcePath);
  if (!requestedPaths.some(path => sourcePath === path || sourcePath.startsWith(`${path}/`))) {
    throw new Error('RAG_RUNTIME_PATH_ESCAPE');
  }
  if (typeof item.sourceName !== 'string' || !item.sourceName || item.sourceName.length > 255) {
    throw new Error('RAG_RUNTIME_INVALID_NAME');
  }
  if (typeof item.contentHash !== 'string' || !/^[a-f0-9]{64}$/.test(item.contentHash)) {
    throw new Error('RAG_RUNTIME_INVALID_HASH');
  }
  if (!Number.isSafeInteger(item.size) || Number(item.size) < 0) throw new Error('RAG_RUNTIME_INVALID_SIZE');
  if (!Array.isArray(item.chunks) || item.chunks.length > 1_000) {
    throw new Error('RAG_RUNTIME_CHUNK_LIMIT');
  }
  const chunks = item.chunks.map((raw, expectedIndex) => {
    if (!raw || typeof raw !== 'object') throw new Error('RAG_RUNTIME_INVALID_CHUNK');
    const chunk = raw as Record<string, unknown>;
    if (chunk.chunkIndex !== expectedIndex || typeof chunk.text !== 'string' ||
        !chunk.text.trim() || Buffer.byteLength(chunk.text, 'utf8') > 16_384) {
      throw new Error('RAG_RUNTIME_INVALID_CHUNK');
    }
    const lineStart = Number(chunk.lineStart);
    const lineEnd = Number(chunk.lineEnd);
    const page = chunk.page === null ? null : Number(chunk.page);
    if (!Number.isSafeInteger(lineStart) || lineStart < 1 ||
        !Number.isSafeInteger(lineEnd) || lineEnd < lineStart ||
        (page !== null && (!Number.isSafeInteger(page) || page < 1))) {
      throw new Error('RAG_RUNTIME_INVALID_POSITION');
    }
    return {
      chunkIndex: expectedIndex,
      text: chunk.text,
      lineStart,
      lineEnd,
      page,
    };
  });
  const modifiedAt = item.modifiedAt === null ? null : Number(item.modifiedAt);
  if (modifiedAt !== null && (!Number.isFinite(modifiedAt) || modifiedAt < 0)) {
    throw new Error('RAG_RUNTIME_INVALID_MODIFIED_AT');
  }
  return {
    sourcePath,
    sourceName: item.sourceName,
    contentHash: item.contentHash,
    size: Number(item.size),
    modifiedAt,
    chunks,
  };
}

function validateVectors(value: unknown, count: number): number[][] | null {
  if (!Array.isArray(value) || value.length !== count) return null;
  const vectors = value as unknown[];
  if (vectors.some(vector => !Array.isArray(vector) || vector.length !== 384 ||
      vector.some(number => typeof number !== 'number' || !Number.isFinite(number)))) {
    return null;
  }
  return vectors as number[][];
}

export function createRagService(dependencies: {
  database: Database;
  sandbox: CloudSandbox;
  run: Run;
}) {
  const { sandbox, run } = dependencies;
  const store = createRagStore(dependencies.database);

  async function invokeRuntime<T>(
    runtime: string,
    operation: string,
    arguments_: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<T> {
    signal?.throwIfAborted();
    const id = randomUUID();
    const requestPath = `/workspace/.rag-request-${id}.json`;
    const responsePath = `/workspace/.rag-response-${id}.json`;
    await sandbox.write(requestPath, Buffer.from(JSON.stringify({
      operation, arguments: arguments_, responsePath,
    })));
    const command = runtime.endsWith('.mjs') ? 'node' : 'python';
    const result = await sandbox.exec(`${command} ${runtime} ${requestPath}`, signal);
    if (result.exitCode !== 0) throw new Error('RAG_SANDBOX_RUNTIME_FAILED');
    let envelope: RuntimeEnvelope;
    try {
      envelope = JSON.parse(result.stdout) as RuntimeEnvelope;
    } catch {
      throw new Error('RAG_SANDBOX_RUNTIME_INVALID_RESPONSE');
    }
    if (envelope.responsePath !== responsePath) throw new Error('RAG_SANDBOX_RUNTIME_PATH_MISMATCH');
    const bytes = await sandbox.read(responsePath, MAX_RUNTIME_RESPONSE_BYTES, signal);
    try {
      return JSON.parse(new TextDecoder().decode(bytes)) as T;
    } catch {
      throw new Error('RAG_SANDBOX_RUNTIME_INVALID_JSON');
    } finally {
      await sandbox.exec(`${command} ${runtime} --delete-response ${responsePath}`).catch(() => undefined);
    }
  }

  async function runtimeEmbeddingStatus(signal?: AbortSignal): Promise<RagEmbeddingStatus> {
    try {
      const result = await invokeRuntime<{ embedding: unknown }>(
        EMBEDDING_RUNTIME, 'embedding_status', {}, signal,
      );
      return embeddingStatus(result.embedding);
    } catch (error) {
      signal?.throwIfAborted();
      return { available: false, model: EMBEDDING_MODEL, reason: 'RAG_RUNTIME_UNAVAILABLE' };
    }
  }

  async function parseAndReplace(paths: string[], signal?: AbortSignal) {
    await store.assertWritableRun(run);
    signal?.throwIfAborted();
    const raw = await invokeRuntime<RagRuntimeIndexResult>(PARSER_RUNTIME, 'index', { paths }, signal);
    if (!raw || !Array.isArray(raw.documents) || !Array.isArray(raw.errors)) {
      throw new Error('RAG_RUNTIME_INVALID_INDEX_RESULT');
    }
    const parsed = raw.documents.map(value => validateParsedDocument(value, paths));
    const texts = parsed.flatMap(document => document.chunks.map(chunk => chunk.text));
    let embedding: RagEmbeddingStatus = {
      available: false, model: EMBEDDING_MODEL, reason: 'RAG_EMBEDDING_RUNTIME_UNAVAILABLE',
    };
    let vectors: number[][] | null = null;
    if (texts.length > 0) {
      try {
        const result = await invokeRuntime<{ embedding: unknown; vectors?: unknown }>(
          EMBEDDING_RUNTIME, 'embed', { texts }, signal,
        );
        embedding = embeddingStatus(result.embedding);
        vectors = embedding.available ? validateVectors(result.vectors, texts.length) : null;
        if (embedding.available && !vectors) {
          embedding = {
            available: false,
            model: embedding.model,
            reason: 'LOCAL_MINILM_INVALID_VECTOR',
          };
        }
      } catch (error) {
        signal?.throwIfAborted();
        embedding = {
          available: false, model: EMBEDDING_MODEL, reason: 'RAG_EMBEDDING_RUNTIME_UNAVAILABLE',
        };
      }
    }
    let vectorIndex = 0;
    const documents: RagRuntimeDocument[] = parsed.map(document => ({
      ...document,
      embedding,
      chunks: document.chunks.map(chunk => ({
        ...chunk,
        embedding: vectors?.[vectorIndex++] ?? null,
      })),
    }));
    signal?.throwIfAborted();
    const summaries = documents.length > 0 ? await store.replaceDocuments(run, documents) : [];
    return {
      chunks: summaries.reduce((total, document) => total + document.chunks, 0),
      documents: summaries,
      errors: raw.errors.map(error => ({
        sourcePath: typeof error?.sourcePath === 'string' ? error.sourcePath : '',
        code: typeof error?.code === 'string' ? error.code : 'RAG_PARSE_FAILED',
      })),
    };
  }

  async function query(input: { query: string; path?: string; topK?: number }, signal?: AbortSignal): Promise<RagQueryResult> {
    signal?.throwIfAborted();
    const queryText = cleanQuery(input.query);
    const path = input.path === undefined ? undefined : controlledPath(input.path);
    const topK = queryLimit(input.topK);
    const chunks = await store.chunks(run.owner_id, run.conversation_id, path);
    let embedding: RagEmbeddingStatus = {
      available: false, model: EMBEDDING_MODEL, reason: 'LOCAL_MINILM_NOT_INSTALLED',
    };
    let vector: number[] | null = null;
    if (chunks.some(chunk => chunk.embedding)) {
      try {
        const result = await invokeRuntime<{ embedding: unknown; vectors?: unknown }>(
          EMBEDDING_RUNTIME, 'embed', { texts: [queryText] }, signal,
        );
        embedding = embeddingStatus(result.embedding);
        vector = embedding.available ? validateVectors(result.vectors, 1)?.[0] ?? null : null;
        if (embedding.available && !vector) {
          embedding = { available: false, model: embedding.model, reason: 'LOCAL_MINILM_INVALID_VECTOR' };
        }
      } catch (error) {
        signal?.throwIfAborted();
        embedding = { available: false, model: EMBEDDING_MODEL, reason: 'RAG_RUNTIME_UNAVAILABLE' };
      }
    }
    const ranked = rankRagChunks(queryText, chunks, vector, topK);
    return {
      mode: ranked.mode,
      hits: ranked.hits,
      citations: ranked.hits.map(hit => hit.citation),
      embedding,
    };
  }

  return {
    async index(input: { path: string }, signal?: AbortSignal) {
      return parseAndReplace([controlledPath(input.path)], signal);
    },

    query,

    async refresh(signal?: AbortSignal) {
      const tracked = await store.documents(run.owner_id, run.conversation_id);
      if (tracked.length === 0) return { chunks: 0, documents: [] as RagDocumentSummary[], errors: [] };
      const refreshed: RagDocumentSummary[] = [];
      const errors: Array<{ sourcePath: string; code: string }> = [];
      for (let start = 0; start < tracked.length; start += 16) {
        signal?.throwIfAborted();
        const result = await parseAndReplace(
          tracked.slice(start, start + 16).map(document => document.sourcePath), signal,
        );
        refreshed.push(...result.documents);
        errors.push(...result.errors);
      }
      return {
        chunks: refreshed.reduce((total, document) => total + document.chunks, 0),
        documents: refreshed,
        errors,
      };
    },

    async status(signal?: AbortSignal): Promise<RagStatus> {
      const [counts, documents, embedding] = await Promise.all([
        store.status(run.owner_id, run.conversation_id),
        store.documents(run.owner_id, run.conversation_id),
        runtimeEmbeddingStatus(signal),
      ]);
      return {
        ...counts,
        vectorSearch: embedding.available && counts.vectors > 0,
        embeddingModel: embedding.model,
        embedding,
        recentDocuments: documents.slice(0, 5),
      };
    },

    async retrieveForPrompt(
      prompt: string,
      options: { topK?: number; maxCharacters?: number } = {},
      signal?: AbortSignal,
    ) {
      const retrievalQuery = prompt.trim().slice(0, MAX_QUERY_CHARACTERS);
      if (!retrievalQuery) {
        return { context: '', mode: 'bm25' as const, citations: [], hits: [] };
      }
      const maxCharacters = contextLimit(options.maxCharacters);
      const topK = queryLimit(options.topK);
      const result = await query({ query: retrievalQuery, topK }, signal);
      const included: typeof result.hits = [];
      let context = '';
      for (const hit of result.hits) {
        let text = hit.text.slice(0, maxCharacters);
        let candidate = '';
        while (text.length > 0) {
          candidate = renderJsonBlock('retrieved_documents', {
            trust: 'untrusted-retrieved-document',
            mode: result.mode,
            hits: [...included.map(item => ({ citation: item.citation, text: item.text })), {
              citation: hit.citation,
              text,
            }],
          });
          if (candidate.length <= maxCharacters) break;
          text = text.slice(0, Math.max(0, text.length - Math.max(1, candidate.length - maxCharacters)));
        }
        if (!text || candidate.length > maxCharacters) break;
        included.push({ ...hit, text });
        context = candidate;
      }
      return {
        context,
        mode: result.mode,
        citations: included.map(hit => hit.citation),
        hits: included,
      };
    },
  };
}

export type RagService = ReturnType<typeof createRagService>;
