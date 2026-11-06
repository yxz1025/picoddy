import { realpath, stat } from 'node:fs/promises';
import { isAbsolute } from 'node:path';
import type { ChannelKnowledgeBinding } from '../types.ts';

export interface KnowledgeSource { path: string; line: number; text: string; score: number }

export async function validateKnowledgeBinding(value: unknown): Promise<ChannelKnowledgeBinding | undefined> {
  if (value === undefined || value === null) return undefined;
  const binding = value as Record<string, unknown>;
  if (typeof binding !== 'object' || !['directory', 'obsidian'].includes(String(binding.kind))) throw new Error('无效的知识库类型');
  if (typeof binding.directory !== 'string' || !binding.directory.trim() || binding.directory.length > 4_096 || !isAbsolute(binding.directory)) throw new Error('请选择有效的知识库目录');
  try {
    const directory = await realpath(binding.directory);
    if (!(await stat(directory)).isDirectory()) throw new Error();
    return { kind: 'directory', directory };
  } catch { throw new Error('知识库目录不存在或无法访问，请重新选择'); }
}

export function knowledgePrompt(question: string, sources: readonly KnowledgeSource[]): string {
  return JSON.stringify({ question, sources: sources.map(({ path, line, text }, index) => ({ id: index + 1, path, line, text })) })
    .replaceAll('<', '\\u003c').replaceAll('>', '\\u003e');
}

export function stripChannelAnswerSources(answer: string): string {
  const body = answer.split(/^\s*(?:#{1,6}\s*)?(?:\*\*)?(?:引用来源|参考来源|资料来源|参考资料|来源|出处)(?:\*\*)?\s*[:：]?(?:\*\*)?\s*$/m)[0].trim();
  return body.replace(/\s*\[\d+\]/g, '').trim();
}

export function renderKnowledgeAnswer(answer: string, sources: readonly KnowledgeSource[]): string {
  const body = answer.split(/^\s*(?:#{1,6}\s*)?(?:\*\*)?(?:引用来源|参考来源|资料来源|参考资料|来源|出处)(?:\*\*)?\s*[:：]?(?:\*\*)?\s*$/m)[0].trim();
  const ids = [...new Set([...body.matchAll(/\[(\d+)\]/g)].map(match => Number(match[1])))];
  if (!ids.length || ids.some(id => id < 1 || id > sources.length)) {
    return '现有资料不足以回答这个问题，请补充问题关键词或相关笔记。';
  }
  return stripChannelAnswerSources(answer);
}
