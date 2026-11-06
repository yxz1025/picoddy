// 本地混合 RAG：SQLite FTS5 + sqlite-vec + 本地 embedding。
// sqlite-vec 和 embedding 都是可选加速层，任一层不可用时仍保留 FTS5 检索。

import { createHash } from "node:crypto";
import { readdirSync, statSync } from "node:fs";
import { basename, extname, join, resolve } from "node:path";
import { getDb } from "../../../infra/db.ts";
import { readDoc } from "../../doc/node/reader.ts";
import { platformPaths } from "../../../platform/paths.ts";
import { embedTexts, ragEmbeddingModel } from "./embedding.ts";
import * as sqliteVec from "sqlite-vec";

const CHUNK_SIZE = 800;
const CHUNK_OVERLAP = 100;
const DEFAULT_TOP_K = 5;
const VECTOR_DIMENSIONS = 384;
const INDEXABLE_EXTENSIONS = new Set([
  ".txt", ".md", ".markdown", ".json", ".csv", ".docx", ".xlsx", ".pptx", ".pdf",
  ".html", ".htm", ".ts", ".tsx", ".js", ".jsx", ".py", ".java", ".go", ".rs",
  ".css", ".xml", ".yaml", ".yml", ".toml", ".sql",
]);

let vectorReady: boolean | null = null;

function ensureFtsBackfill(): void {
  const db = getDb();
  // Preserve indexes created by the retired implementation until the next
  // edit. New writes always populate FTS5 directly.
  db.exec(`
    INSERT INTO doc_chunks_fts (chunk_id, doc_path, chunk_index, text)
    SELECT c.id, c.doc_path, c.chunk_index, c.text
      FROM doc_chunks c
     WHERE NOT EXISTS (
       SELECT 1 FROM doc_chunks_fts f WHERE f.chunk_id = c.id
     );
  `);
}

function uuid(): string { return crypto.randomUUID(); }

function hashText(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

function splitText(text: string, size = CHUNK_SIZE, overlap = CHUNK_OVERLAP): string[] {
  const chunks: string[] = [];
  const paras = text.split(/\n\s*\n/);
  let buf = "";
  for (const paragraph of paras) {
    if ((buf + paragraph).length > size && buf) {
      chunks.push(buf);
      buf = buf.slice(-overlap) + "\n\n" + paragraph;
    } else {
      buf += (buf ? "\n\n" : "") + paragraph;
    }
    while (buf.length > size * 1.5) {
      chunks.push(buf.slice(0, size));
      buf = buf.slice(size - overlap);
    }
  }
  if (buf) chunks.push(buf);
  return chunks.filter((chunk) => chunk.trim());
}

function normalizePath(path: string): string {
  return resolve(platformPaths.expandHome(path));
}

function ensureVectorIndex(): boolean {
  if (vectorReady !== null) return vectorReady;
  try {
    const db = getDb();
    ensureFtsBackfill();
    // sqlite-vec ships platform-specific optional packages. Loading it is
    // deliberately isolated so unsupported architectures use FTS5 only.
    sqliteVec.load(db);
    db.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS doc_chunk_vectors
      USING vec0(chunk_id TEXT PRIMARY KEY, embedding FLOAT[${VECTOR_DIMENSIONS}]);
    `);
    vectorReady = true;
  } catch (error) {
    console.warn(`[rag] sqlite-vec 不可用，降级为 FTS5：${String(error)}`);
    vectorReady = false;
  }
  return vectorReady;
}

function listFiles(path: string): string[] {
  const target = normalizePath(path);
  const stat = statSync(target);
  if (stat.isFile()) return [target];
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === "node_modules" || entry.name === ".git" || entry.name === "dist") continue;
      const child = join(dir, entry.name);
      if (entry.isDirectory()) walk(child);
      else if (INDEXABLE_EXTENSIONS.has(extname(entry.name).toLowerCase())) files.push(child);
    }
  };
  walk(target);
  return files;
}

export interface Chunk {
  id: string;
  docPath: string;
  chunkIndex: number;
  text: string;
  score?: number;
  mode?: "hybrid" | "fts5";
}

export interface RagStatus {
  documents: number;
  chunks: number;
  vectors: number;
  embeddingModel: string;
  vectorSearch: boolean;
}

async function indexSingleDoc(path: string, tracked = false): Promise<number> {
  const normalizedPath = normalizePath(path);
  const { text } = await readDoc(normalizedPath);
  if (!text.trim()) return 0;
  const contentHash = hashText(text);
  const db = getDb();
  const previous = db.prepare("SELECT content_hash FROM doc_documents WHERE doc_path = ?").get(normalizedPath) as { content_hash?: string } | undefined;
  if (previous?.content_hash === contentHash) {
    if (tracked) db.prepare("UPDATE doc_documents SET tracked = 1 WHERE doc_path = ?").run(normalizedPath);
    return Number(db.prepare("SELECT COUNT(*) AS count FROM doc_chunks WHERE doc_path = ?").get(normalizedPath)?.count ?? 0);
  }

  const chunks = splitText(text);
  const embeddings = await embedTexts(chunks).catch((error) => {
    console.warn(`[rag] embedding 不可用，当前文档使用 FTS5：${String(error)}`);
    return [] as Float32Array[];
  });
  db.prepare("DELETE FROM doc_chunks_fts WHERE doc_path = ?").run(normalizedPath);
  db.prepare("DELETE FROM doc_chunks WHERE doc_path = ?").run(normalizedPath);
  if (vectorReady) {
    const oldChunkIds = db.prepare("SELECT id FROM doc_chunks WHERE doc_path = ?").all(normalizedPath) as Array<{ id: string }>;
    for (const row of oldChunkIds) {
      db.prepare("DELETE FROM doc_chunk_vectors WHERE chunk_id = ?").run(row.id);
    }
  }

  const now = Date.now();
  const insertChunk = db.prepare("INSERT INTO doc_chunks (id, doc_path, chunk_index, text, keywords, embedding, content_hash, line_start, line_end, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)");
  const insertFts = db.prepare("INSERT INTO doc_chunks_fts (chunk_id, doc_path, chunk_index, text) VALUES (?, ?, ?, ?)");
  const insertVector = vectorReady ? db.prepare("INSERT INTO doc_chunk_vectors (chunk_id, embedding) VALUES (?, ?)") : null;
  for (let index = 0; index < chunks.length; index++) {
    const id = `${normalizedPath}#${index}`;
    const lineStart = text.slice(0, text.indexOf(chunks[index])).split("\n").length;
    const lineEnd = lineStart + chunks[index].split("\n").length - 1;
    const embedding = embeddings[index] ? Buffer.from(embeddings[index].buffer) : null;
    insertChunk.run(id, normalizedPath, index, chunks[index], "", embedding, contentHash, lineStart, lineEnd, now);
    insertFts.run(id, normalizedPath, index, chunks[index]);
    if (insertVector && embeddings[index]) insertVector.run(id, embeddings[index]);
  }
  const stat = statSync(normalizedPath);
  db.prepare("INSERT INTO doc_documents (doc_path, content_hash, file_size, modified_at, indexed_at, tracked) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(doc_path) DO UPDATE SET content_hash=excluded.content_hash, file_size=excluded.file_size, modified_at=excluded.modified_at, indexed_at=excluded.indexed_at, tracked=excluded.tracked")
    .run(normalizedPath, contentHash, stat.size, stat.mtimeMs, now, tracked ? 1 : 0);
  return chunks.length;
}

export async function indexDoc(path: string): Promise<number> {
  ensureVectorIndex();
  let total = 0;
  for (const file of listFiles(path)) total += await indexSingleDoc(file, true);
  return total;
}

export async function refreshIndexedDocs(): Promise<number> {
  const db = getDb();
  const rows = db.prepare("SELECT doc_path FROM doc_documents WHERE tracked = 1").all() as Array<{ doc_path: string }>;
  let total = 0;
  for (const row of rows) {
    try { total += await indexSingleDoc(row.doc_path, true); } catch { /* deleted files are cleaned below */ }
  }
  return total;
}

export function listIndexedDocs(): { docPath: string; count: number; latestAt: number }[] {
  return getDb().prepare("SELECT doc_path as docPath, COUNT(*) as count, MAX(created_at) as latestAt FROM doc_chunks GROUP BY doc_path ORDER BY latestAt DESC").all() as unknown as { docPath: string; count: number; latestAt: number }[];
}

export function deleteIndex(docPath: string): void {
  const path = normalizePath(docPath);
  const db = getDb();
  const chunkIds = db.prepare("SELECT id FROM doc_chunks WHERE doc_path = ?").all(path) as Array<{ id: string }>;
  db.prepare("DELETE FROM doc_chunks_fts WHERE doc_path = ?").run(path);
  db.prepare("DELETE FROM doc_chunks WHERE doc_path = ?").run(path);
  if (ensureVectorIndex()) {
    // vec0 does not consistently support filtered DELETE statements across
    // extension versions, so delete by the stable primary key instead.
    for (const row of chunkIds) {
      db.prepare("DELETE FROM doc_chunk_vectors WHERE chunk_id = ?").run(row.id);
    }
  }
  db.prepare("DELETE FROM doc_documents WHERE doc_path = ?").run(path);
}

export function getRagStatus(): RagStatus {
  const db = getDb();
  return {
    documents: Number(db.prepare("SELECT COUNT(*) AS count FROM doc_documents").get()?.count ?? 0),
    chunks: Number(db.prepare("SELECT COUNT(*) AS count FROM doc_chunks").get()?.count ?? 0),
    vectors: vectorReady ? Number(db.prepare("SELECT COUNT(*) AS count FROM doc_chunk_vectors").get()?.count ?? 0) : 0,
    embeddingModel: ragEmbeddingModel,
    vectorSearch: ensureVectorIndex(),
  };
}

export async function searchChunks(query: string, docPath?: string, topK = DEFAULT_TOP_K): Promise<Chunk[]> {
  const db = getDb();
  ensureFtsBackfill();
  const limit = Math.max(1, Math.min(20, Math.floor(topK)));
  const normalizedPath = docPath ? normalizePath(docPath) : undefined;
  const ftsQuery = query.trim().replaceAll(/["']/g, " ").trim() || "*";
  let rows: Array<{ chunk_id: string; doc_path: string; chunk_index: number; text: string; score: number }> = [];
  try {
    rows = (normalizedPath
      ? db.prepare("SELECT chunk_id, doc_path, chunk_index, text, bm25(doc_chunks_fts) AS score FROM doc_chunks_fts WHERE doc_chunks_fts MATCH ? AND doc_path = ? ORDER BY score LIMIT ?").all(ftsQuery, normalizedPath, limit * 4)
      : db.prepare("SELECT chunk_id, doc_path, chunk_index, text, bm25(doc_chunks_fts) AS score FROM doc_chunks_fts WHERE doc_chunks_fts MATCH ? ORDER BY score LIMIT ?").all(ftsQuery, limit * 4)) as unknown as typeof rows;
  } catch {
    rows = (normalizedPath
      ? db.prepare("SELECT id AS chunk_id, doc_path, chunk_index, text, 0 AS score FROM doc_chunks WHERE doc_path = ? AND text LIKE ? LIMIT ?").all(normalizedPath, `%${query}%`, limit * 4)
      : db.prepare("SELECT id AS chunk_id, doc_path, chunk_index, text, 0 AS score FROM doc_chunks WHERE text LIKE ? LIMIT ?").all(`%${query}%`, limit * 4)) as unknown as typeof rows;
  }
  const keywordScores = new Map(rows.map((row) => [row.chunk_id, 1 / (1 + Math.max(0, row.score))]));
  const vectorScores = new Map<string, number>();
  if (ensureVectorIndex()) {
    try {
      const [queryVector] = await embedTexts([query]);
      const vectorRows = db.prepare("SELECT chunk_id, distance FROM doc_chunk_vectors WHERE embedding MATCH ? AND k = ?").all(queryVector, limit * 4) as Array<{ chunk_id: string; distance: number }>;
      for (const row of vectorRows) vectorScores.set(row.chunk_id, Math.max(0, 1 - row.distance));
    } catch (error) {
      console.warn(`[rag] 向量检索失败，使用 FTS5：${String(error)}`);
    }
  }
  const candidates = new Map<string, Chunk & { score: number }>();
  for (const row of rows) {
    candidates.set(row.chunk_id, { id: row.chunk_id, docPath: row.doc_path, chunkIndex: row.chunk_index, text: row.text, score: (keywordScores.get(row.chunk_id) ?? 0) * 0.4 + (vectorScores.get(row.chunk_id) ?? 0) * 0.6 });
  }
  for (const [id, score] of vectorScores) {
    if (candidates.has(id)) continue;
    const row = db.prepare("SELECT id, doc_path, chunk_index, text FROM doc_chunks WHERE id = ?").get(id) as { id: string; doc_path: string; chunk_index: number; text: string } | undefined;
    if (row && (!normalizedPath || row.doc_path === normalizedPath)) candidates.set(id, { id: row.id, docPath: row.doc_path, chunkIndex: row.chunk_index, text: row.text, score: score * 0.6 });
  }
  return [...candidates.values()].sort((a, b) => b.score - a.score).slice(0, limit).map((chunk) => ({ ...chunk, mode: vectorScores.size > 0 ? "hybrid" : "fts5" }));
}
