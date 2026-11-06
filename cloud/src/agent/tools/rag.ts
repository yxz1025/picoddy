import { Type } from 'typebox';
import type { AgentTool } from '@earendil-works/pi-agent-core';

import type { Database } from '../../infra/db.ts';
import { database } from '../../infra/db.ts';
import type { CloudSandbox } from '../../platform/sandbox.ts';
import type { Run } from '../../cloud/runs/types.ts';
import { createRagService } from '../../domains/rag/node/service.ts';

function failure(error: unknown, details: Record<string, unknown>) {
  const code = error instanceof Error && /^[A-Z0-9_]+$/.test(error.message)
    ? error.message : 'RAG_OPERATION_FAILED';
  return {
    content: [{ type: 'text' as const, text: `❌ RAG 操作失败：${code}` }],
    details: { ...details, error: code },
    isError: true,
  };
}

export function createRagTools(
  run: Run,
  sandbox: CloudSandbox,
  ragDatabase: Database = database,
): AgentTool<any>[] {
  const service = createRagService({ database: ragDatabase, sandbox, run });
  const indexSchema = Type.Object({
    path: Type.String({ minLength: 1, maxLength: 1024, description: '要索引的 /workspace 文件或目录' }),
  });
  const querySchema = Type.Object({
    query: Type.String({ minLength: 1, maxLength: 4000, description: '自然语言检索问题' }),
    path: Type.Optional(Type.String({ minLength: 1, maxLength: 1024, description: '限定 /workspace 文件或目录' })),
    topK: Type.Optional(Type.Integer({ minimum: 1, maximum: 20, description: '返回片段数，默认 5' })),
  });
  const emptySchema = Type.Object({});

  return [
    {
      name: 'rag_index',
      label: '建立文档索引',
      description: '在任务沙箱中解析文件或目录，建立当前会话私有的 BM25 + 可选离线 MiniLM 混合索引。支持文本、代码、DOCX、XLSX、PPTX、PDF 和 HTML。',
      parameters: indexSchema,
      async execute(_id, input, signal) {
        try {
          const result = await service.index(input as { path: string }, signal);
          const partial = result.errors.length > 0 ? `；${result.errors.length} 个文件未索引` : '';
          return {
            content: [{ type: 'text' as const, text: `✓ 已索引 ${result.chunks} 个文档片段${partial}` }],
            details: result,
            isError: result.documents.length === 0 && result.errors.length > 0,
          };
        } catch (error) {
          return failure(error, { chunks: 0, documents: [], errors: [] });
        }
      },
    },
    {
      name: 'rag_query',
      label: '检索文档',
      description: '检索当前会话私有文档索引，返回带文档版本、行号或页码的结构化引用；离线向量不可用时明确使用 BM25。',
      parameters: querySchema,
      async execute(_id, input, signal) {
        try {
          const result = await service.query(input as { query: string; path?: string; topK?: number }, signal);
          const text = result.hits.length === 0
            ? '(没有找到匹配片段，请先使用 rag_index 建立索引)'
            : result.hits.map((hit, index) => {
              const location = hit.page === null
                ? `lines ${hit.lineStart}-${hit.lineEnd}`
                : `page ${hit.page}, lines ${hit.lineStart}-${hit.lineEnd}`;
              return `[${index + 1}] ${hit.sourcePath}#${hit.chunkIndex} v${hit.version} (${location}; ${result.mode}; ${hit.citation.score.toFixed(3)})\n${hit.text}`;
            }).join('\n\n');
          return {
            content: [{ type: 'text' as const, text }],
            details: {
              count: result.hits.length,
              mode: result.mode,
              citations: result.citations,
              embedding: result.embedding,
            },
          };
        } catch (error) {
          return failure(error, { count: 0, mode: 'bm25', citations: [] });
        }
      },
    },
    {
      name: 'rag_refresh',
      label: '刷新文档索引',
      description: '重新解析当前沙箱内仍可访问的已跟踪文档；内容未变化时保留现有索引版本。',
      parameters: emptySchema,
      async execute(_id, _input, signal) {
        try {
          const result = await service.refresh(signal);
          const partial = result.errors.length > 0 ? `；${result.errors.length} 个来源当前不可用` : '';
          return {
            content: [{ type: 'text' as const, text: `✓ 已刷新 ${result.chunks} 个片段${partial}` }],
            details: result,
            isError: result.documents.length === 0 && result.errors.length > 0,
          };
        } catch (error) {
          return failure(error, { chunks: 0, documents: [], errors: [] });
        }
      },
    },
    {
      name: 'rag_status',
      label: '文档索引状态',
      description: '查看当前会话的私有文档、片段、向量覆盖和离线 embedding 状态。',
      parameters: emptySchema,
      async execute(_id, _input, signal) {
        try {
          const status = await service.status(signal);
          const mode = status.vectorSearch ? 'BM25 + 离线向量' : `BM25 降级（${status.embedding.reason ?? 'NO_VECTORS'}）`;
          return {
            content: [{ type: 'text' as const, text:
              `文档数：${status.documents}\n片段数：${status.chunks}\n向量数：${status.vectors}\n检索：${mode}\n模型：${status.embeddingModel}\n最近文档：${status.recentDocuments.map(document => document.sourcePath).join('\n') || '无'}` }],
            details: status,
          };
        } catch (error) {
          return failure(error, { documents: 0, chunks: 0, vectors: 0, vectorSearch: false });
        }
      },
    },
  ];
}
