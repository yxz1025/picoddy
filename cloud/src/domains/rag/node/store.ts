import { randomUUID } from 'node:crypto';
import type { PoolClient, QueryResultRow } from 'pg';

import type { Database } from '../../../infra/db.ts';
import type { Run } from '../../../cloud/runs/types.ts';
import type {
  RagDocumentSummary,
  RagRuntimeDocument,
  RagStoredChunk,
} from './types.ts';

const MAX_CONVERSATION_CHUNKS = 10_000;
const MAX_CONVERSATION_TEXT_BYTES = 20 * 1024 * 1024;

interface DocumentRow extends QueryResultRow {
  id: string;
  source_path: string;
  source_name: string;
  content_hash: string;
  version: number;
  chunk_count: number;
  embedding_status: 'hybrid' | 'bm25';
  embedding_model: string;
  indexed_at: Date | string;
}

interface ChunkRow extends QueryResultRow {
  id: string;
  document_id: string;
  source_path: string;
  source_name: string;
  version: number;
  chunk_index: number;
  text: string;
  line_start: number;
  line_end: number;
  page: number | null;
  embedding: Array<number | string> | null;
}

function documentSummary(row: DocumentRow): RagDocumentSummary {
  return {
    id: row.id,
    sourcePath: row.source_path,
    sourceName: row.source_name,
    contentHash: row.content_hash,
    version: Number(row.version),
    chunks: Number(row.chunk_count),
    embeddingStatus: row.embedding_status,
    embeddingModel: row.embedding_model,
    indexedAt: new Date(row.indexed_at).toISOString(),
  };
}

function writableRunSql(lock: boolean): string {
  return `SELECT id FROM runs
    WHERE id=$1 AND owner_id=$2 AND conversation_id=$3 AND lease_token=$4
      AND lease_until>now() AND NOT cancel_requested
      AND status IN ('provisioning','running','waiting_approval')${lock ? ' FOR UPDATE' : ''}`;
}

function requiresReplacement(previous: DocumentRow | undefined, document: RagRuntimeDocument): boolean {
  if (!previous || previous.content_hash !== document.contentHash) return true;
  const incomingHybrid = document.embedding.available &&
    document.chunks.some(chunk => chunk.embedding !== null);
  return incomingHybrid && (
    previous.embedding_status !== 'hybrid' || previous.embedding_model !== document.embedding.model
  );
}

export function createRagStore(database: Database) {
  async function assertWritableRun(run: Run, client?: PoolClient): Promise<void> {
    const values = [run.id, run.owner_id, run.conversation_id, run.lease_token];
    const result = client
      ? await client.query(writableRunSql(true), values)
      : await database.query(writableRunSql(false), values);
    if (!result.rowCount) throw new Error('RUN_LEASE_LOST');
  }

  return {
    assertWritableRun,

    async replaceDocuments(run: Run, documents: RagRuntimeDocument[]): Promise<RagDocumentSummary[]> {
      return database.transaction(async client => {
        await assertWritableRun(run, client);
        const existingResult = await client.query<DocumentRow>(
          `SELECT id,source_path,source_name,content_hash,version,chunk_count,
                  embedding_status,embedding_model,indexed_at
             FROM rag_documents
            WHERE owner_id=$1 AND conversation_id=$2
            FOR UPDATE`,
          [run.owner_id, run.conversation_id],
        );
        const existing = new Map(existingResult.rows.map(row => [row.source_path, row]));
        const usage = await client.query<{ document_id: string; chunks: string; bytes: string }>(
          `SELECT document_id,count(*)::text AS chunks,
                  coalesce(sum(octet_length(text)),0)::text AS bytes
             FROM rag_chunks WHERE owner_id=$1 AND conversation_id=$2
            GROUP BY document_id`,
          [run.owner_id, run.conversation_id],
        );
        const usageByDocument = new Map(usage.rows.map(row => [row.document_id, {
          chunks: Number(row.chunks), bytes: Number(row.bytes),
        }]));
        let totalChunks = usage.rows.reduce((sum, row) => sum + Number(row.chunks), 0);
        let totalBytes = usage.rows.reduce((sum, row) => sum + Number(row.bytes), 0);

        for (const document of documents) {
          const previous = existing.get(document.sourcePath);
          if (!requiresReplacement(previous, document)) continue;
          const previousUsage = previous ? usageByDocument.get(previous.id) : undefined;
          totalChunks -= previousUsage?.chunks ?? 0;
          totalBytes -= previousUsage?.bytes ?? 0;
          totalChunks += document.chunks.length;
          totalBytes += document.chunks.reduce(
            (sum, chunk) => sum + Buffer.byteLength(chunk.text, 'utf8'), 0,
          );
        }
        if (totalChunks > MAX_CONVERSATION_CHUNKS) throw new Error('RAG_CHUNK_BUDGET_EXCEEDED');
        if (totalBytes > MAX_CONVERSATION_TEXT_BYTES) throw new Error('RAG_TEXT_BUDGET_EXCEEDED');

        const summaries: RagDocumentSummary[] = [];
        for (const document of documents) {
          const previous = existing.get(document.sourcePath);
          const embeddingStatus = document.embedding.available &&
              document.chunks.some(chunk => chunk.embedding)
            ? 'hybrid' : 'bm25';
          if (previous && !requiresReplacement(previous, document)) {
            const preserveHybrid = previous.embedding_status === 'hybrid';
            const refreshed = await client.query<DocumentRow>(
              `UPDATE rag_documents SET indexed_by_run_id=$4,indexed_at=now(),updated_at=now(),
                      source_size=$5,source_modified_at=$6,
                      embedding_status=CASE WHEN $7 THEN embedding_status ELSE 'bm25' END,
                      embedding_model=CASE WHEN $7 THEN embedding_model ELSE $8 END,
                      embedding_error=CASE WHEN $7 THEN embedding_error ELSE $9 END
                WHERE id=$3 AND owner_id=$1 AND conversation_id=$2
                RETURNING id,source_path,source_name,content_hash,version,chunk_count,
                          embedding_status,embedding_model,indexed_at`,
              [run.owner_id, run.conversation_id, previous.id, run.id, document.size,
                document.modifiedAt === null ? null : new Date(document.modifiedAt),
                preserveHybrid, document.embedding.model, document.embedding.reason],
            );
            summaries.push(documentSummary(refreshed.rows[0]));
            continue;
          }

          const documentId = previous?.id ?? randomUUID();
          const next = previous
            ? await client.query<DocumentRow>(
              `UPDATE rag_documents SET source_name=$4,content_hash=$5,version=version+1,
                      source_size=$6,source_modified_at=$7,chunk_count=$8,
                      embedding_status=$9,embedding_model=$10,embedding_error=$11,
                      indexed_by_run_id=$12,indexed_at=now(),updated_at=now()
                WHERE id=$3 AND owner_id=$1 AND conversation_id=$2
                RETURNING id,source_path,source_name,content_hash,version,chunk_count,
                          embedding_status,embedding_model,indexed_at`,
              [run.owner_id, run.conversation_id, documentId, document.sourceName,
                document.contentHash, document.size,
                document.modifiedAt === null ? null : new Date(document.modifiedAt),
                document.chunks.length, embeddingStatus, document.embedding.model,
                document.embedding.reason, run.id],
            )
            : await client.query<DocumentRow>(
              `INSERT INTO rag_documents(
                    id,owner_id,conversation_id,source_path,source_name,content_hash,version,
                    source_size,source_modified_at,chunk_count,embedding_status,embedding_model,
                    embedding_error,indexed_by_run_id)
               VALUES($1,$2,$3,$4,$5,$6,1,$7,$8,$9,$10,$11,$12,$13)
               RETURNING id,source_path,source_name,content_hash,version,chunk_count,
                         embedding_status,embedding_model,indexed_at`,
              [documentId, run.owner_id, run.conversation_id, document.sourcePath,
                document.sourceName, document.contentHash, document.size,
                document.modifiedAt === null ? null : new Date(document.modifiedAt),
                document.chunks.length, embeddingStatus, document.embedding.model,
                document.embedding.reason, run.id],
            );
          const saved = next.rows[0];
          await client.query(
            'DELETE FROM rag_chunks WHERE document_id=$1 AND owner_id=$2 AND conversation_id=$3',
            [documentId, run.owner_id, run.conversation_id],
          );
          for (const chunk of document.chunks) {
            await client.query(
              `INSERT INTO rag_chunks(
                 id,document_id,owner_id,conversation_id,document_version,chunk_index,text,
                 line_start,line_end,page,embedding)
               VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::double precision[])`,
              [randomUUID(), documentId, run.owner_id, run.conversation_id, saved.version,
                chunk.chunkIndex, chunk.text, chunk.lineStart, chunk.lineEnd, chunk.page,
                chunk.embedding],
            );
          }
          summaries.push(documentSummary(saved));
        }
        return summaries;
      });
    },

    async chunks(ownerId: string, conversationId: string, path?: string): Promise<RagStoredChunk[]> {
      const result = await database.query<ChunkRow>(
        `SELECT c.id,c.document_id,d.source_path,d.source_name,c.document_version AS version,
                c.chunk_index,c.text,c.line_start,c.line_end,c.page,c.embedding
           FROM rag_chunks c JOIN rag_documents d
             ON d.id=c.document_id AND d.owner_id=c.owner_id AND d.conversation_id=c.conversation_id
          WHERE c.owner_id=$1 AND c.conversation_id=$2
            AND ($3::text IS NULL OR d.source_path=$3 OR
                 left(d.source_path,length($3)+1)=$3 || '/')
          ORDER BY d.source_path,c.chunk_index LIMIT ${MAX_CONVERSATION_CHUNKS}`,
        [ownerId, conversationId, path ?? null],
      );
      return result.rows.map(row => ({
        id: row.id,
        documentId: row.document_id,
        sourcePath: row.source_path,
        sourceName: row.source_name,
        version: Number(row.version),
        chunkIndex: Number(row.chunk_index),
        text: row.text,
        lineStart: Number(row.line_start),
        lineEnd: Number(row.line_end),
        page: row.page === null ? null : Number(row.page),
        embedding: row.embedding?.map(Number) ?? null,
      }));
    },

    async documents(ownerId: string, conversationId: string): Promise<RagDocumentSummary[]> {
      const result = await database.query<DocumentRow>(
        `SELECT id,source_path,source_name,content_hash,version,chunk_count,
                embedding_status,embedding_model,indexed_at
           FROM rag_documents WHERE owner_id=$1 AND conversation_id=$2
          ORDER BY indexed_at DESC,id`,
        [ownerId, conversationId],
      );
      return result.rows.map(documentSummary);
    },

    async status(ownerId: string, conversationId: string) {
      const result = await database.query<{
        documents: string; chunks: string; vectors: string;
      }>(
        `SELECT count(DISTINCT d.id)::text AS documents,count(c.id)::text AS chunks,
                count(c.embedding)::text AS vectors
           FROM rag_documents d LEFT JOIN rag_chunks c
             ON c.document_id=d.id AND c.owner_id=d.owner_id AND c.conversation_id=d.conversation_id
          WHERE d.owner_id=$1 AND d.conversation_id=$2`,
        [ownerId, conversationId],
      );
      const row = result.rows[0] ?? { documents: '0', chunks: '0', vectors: '0' };
      return { documents: Number(row.documents), chunks: Number(row.chunks), vectors: Number(row.vectors) };
    },
  };
}

export type RagStore = ReturnType<typeof createRagStore>;
