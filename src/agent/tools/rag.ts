// 内置本地 RAG 工具：统一提供索引、检索、刷新和状态能力。

import { Type } from "typebox";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import {
  getRagStatus,
  indexDoc,
  listIndexedDocs,
  refreshIndexedDocs,
  searchChunks,
} from "../../domains/rag/node/store.ts";
import { platformPaths } from "../../platform/paths.ts";

const indexSchema = Type.Object({
  path: Type.String({ description: "要索引的文件或目录路径（支持 ~）" }),
});

export const ragIndexTool: AgentTool<typeof indexSchema, { chunks: number }> = {
  name: "rag_index",
  label: "建立文档索引",
  description: "索引文件或目录，使用本地 BM25 + 向量混合检索。支持 Markdown、文本、代码、DOCX、XLSX、PPTX、PDF 和 HTML。",
  parameters: indexSchema,
  execute: async (_id, p) => {
    try {
      const chunks = await indexDoc(platformPaths.expandHome(p.path));
      return { content: [{ type: "text", text: `✓ 已索引 ${chunks} 个文档片段：${p.path}` }], details: { chunks } };
    } catch (error) {
      return { content: [{ type: "text", text: `❌ 索引失败：${(error as Error).message}` }], details: { chunks: 0 } };
    }
  },
};

const querySchema = Type.Object({
  query: Type.String({ description: "自然语言检索问题" }),
  path: Type.Optional(Type.String({ description: "限定文件或目录（支持 ~ 路径）" })),
  topK: Type.Optional(Type.Number({ minimum: 1, maximum: 20, description: "返回片段数，默认 5" })),
});

export const ragQueryTool: AgentTool<typeof querySchema, { count: number }> = {
  name: "rag_query",
  label: "检索文档",
  description: "在本地文档索引中执行 BM25 + 语义向量混合检索，返回带来源路径和片段位置的结果。",
  parameters: querySchema,
  execute: async (_id, p) => {
    try {
      const chunks = await searchChunks(p.query, p.path, p.topK ?? 5);
      const text = chunks.length === 0
        ? "(没有找到匹配片段，请先使用 rag_index 建立索引)"
        : chunks.map((chunk, index) => `[${index + 1}] ${chunk.docPath}#${chunk.chunkIndex} (${chunk.mode}, ${chunk.score?.toFixed(3)})\n${chunk.text}`).join("\n\n");
      return { content: [{ type: "text", text }], details: { count: chunks.length } };
    } catch (error) {
      return { content: [{ type: "text", text: `❌ 检索失败：${(error as Error).message}` }], details: { count: 0 } };
    }
  },
};

const emptySchema = Type.Object({});

export const ragStatusTool: AgentTool<typeof emptySchema, { documents: number; chunks: number; vectors: number }> = {
  name: "rag_status",
  label: "文档索引状态",
  description: "查看当前项目本地文档索引、片段和向量覆盖状态。",
  parameters: emptySchema,
  execute: async () => {
    const status = getRagStatus();
    const docs = listIndexedDocs();
    return {
      content: [{ type: "text", text: `文档数：${status.documents}\n片段数：${status.chunks}\n向量数：${status.vectors}\n检索：${status.vectorSearch ? "BM25 + 向量" : "FTS5 关键词降级"}\n模型：${status.embeddingModel}\n最近文档：${docs.slice(0, 5).map((doc) => doc.docPath).join("\n") || "无"}` }],
      details: status,
    };
  },
};

export const ragRefreshTool: AgentTool<typeof emptySchema, { chunks: number }> = {
  name: "rag_refresh",
  label: "刷新文档索引",
  description: "增量刷新已跟踪文档，只重新处理发生变化的文件。",
  parameters: emptySchema,
  execute: async () => {
    const chunks = await refreshIndexedDocs();
    return {
      content: [{ type: "text", text: `✓ 已刷新 ${chunks} 个片段` }],
      details: { chunks },
    };
  },
};
