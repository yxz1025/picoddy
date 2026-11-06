import { createHash } from 'node:crypto';

/** Desktop withRetrievedDocuments semantics with explicit diagnostics and no raw logging. */
export async function prepareRetrievedTurn(input: {
  query: string;
  userPrompt: string;
  activeTools: readonly string[];
  retrieve: () => Promise<{ context: string; citations: unknown[]; mode: string }>;
  emit: (type: string, payload: Record<string, unknown>) => Promise<void>;
  signal?: AbortSignal;
}): Promise<string> {
  input.signal?.throwIfAborted();
  if (!input.activeTools.includes('rag_query') || input.query.trim().length < 8) return input.userPrompt;
  let result: Awaited<ReturnType<typeof input.retrieve>>;
  try {
    result = await input.retrieve();
  } catch {
    input.signal?.throwIfAborted();
    await input.emit('diagnostic', { code: 'RAG_RETRIEVAL_UNAVAILABLE', severity: 'warning',
      message: '本轮自动文档检索不可用，继续处理原始请求；未注入知识库片段。' });
    return input.userPrompt;
  }
  input.signal?.throwIfAborted();
  if (!result.context) return input.userPrompt;
  const prompt = `${input.userPrompt}\n\n${result.context}`;
  if (Buffer.byteLength(prompt, 'utf8') > 64_000) {
    await input.emit('diagnostic', { code: 'RAG_CONTEXT_BUDGET_EXCEEDED', severity: 'warning',
      message: '检索片段超出本轮上下文预算，未注入；可以使用 rag_query 显式分段检索。' });
    return input.userPrompt;
  }
  await input.emit('retrieval_manifest', { mode: result.mode, count: result.citations.length,
    contentHash: createHash('sha256').update(prompt).digest('hex'),
    bytes: Buffer.byteLength(prompt, 'utf8') });
  return prompt;
}
