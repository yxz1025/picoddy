import { constants } from 'node:fs';
import { lstat, open, readFile, readdir, realpath } from 'node:fs/promises';
import path from 'node:path';
import type { KnowledgeSource } from './obsidian.ts';

export class KnowledgeDirectoryError extends Error {
  readonly publicMessage = '知识库目录或索引无法读取，请在电脑端检查所选文件夹、文件权限和索引链接。';
}

/** Strip a matching root name dynamically; no product, business or machine path is hardcoded. */
export function normalizeKnowledgeLink(input: string, rootName: string, stripRoot = true): string {
  let value = input.trim().replace(/^!?(\[\[)/, '').replace(/\]\]$/, '');
  const markdown = value.match(/^\[[^\]]*\]\(([^)]+)\)$/);
  if (markdown) value = markdown[1];
  value = value.split('|')[0].replace(/\\+$/, '').split('#')[0];
  try { value = decodeURIComponent(value); } catch { throw new KnowledgeDirectoryError('无效的笔记路径编码'); }
  value = value.replaceAll('\\', '/');
  if (/^[a-z][a-z0-9+.-]*:/i.test(value) || value.startsWith('/') || path.win32.isAbsolute(value)) throw new KnowledgeDirectoryError('不允许绝对笔记路径');
  let parts = value.split('/');
  if (stripRoot && parts.length > 1 && parts[0] === rootName) parts = parts.slice(1);
  if (!parts.length || parts.some(part => !part || part.startsWith('.'))) throw new KnowledgeDirectoryError('无效的笔记路径');
  return parts.join('/');
}

export interface DirectoryRequest { operation: 'read' | 'search' | 'list'; path?: string; query?: string; startLine?: number; lineCount?: number }
const MAX_FILES = 5_000;
const MAX_READ_BYTES = 1024 * 1024;
const STOP_TERMS = new Set(['怎么', '如何', '什么', '哪些', '需要', '请问', '一下']);
function searchTerms(query: string) {
  const terms = new Set<string>();
  for (const token of query.toLowerCase().match(/[a-z0-9_-]+|\p{Script=Han}+/gu) ?? []) {
    if (/\p{Script=Han}/u.test(token) && token.length > 2) {
      for (let n = 0; n < token.length - 1; n++) terms.add(token.slice(n, n + 2));
    } else terms.add(token);
  }
  return [...terms].filter(token => !STOP_TERMS.has(token)).slice(0, 50);
}

export async function createDirectorySession(directory: string, signal: AbortSignal) {
  const root = await realpath(directory).catch(() => { throw new KnowledgeDirectoryError('知识库目录不存在'); });
  if (root !== path.resolve(directory)) throw new KnowledgeDirectoryError('知识库目录路径已变化');
  const rootIdentity = await lstat(root);
  const rootName = path.basename(root);
  const inventory: string[] = [];
  let entries = 0; let readBytes = 0; let outputChars = 0; let calls = 0;
  const sources: KnowledgeSource[] = [];
  const checked = async (relative: string, file = true) => {
    signal.throwIfAborted();
    const segments = relative.split('/');
    let target = root;
    for (const segment of segments) {
      if (!segment || segment.startsWith('.')) throw new KnowledgeDirectoryError('无效的笔记路径');
      target = path.join(target, segment);
      const info = await lstat(target);
      if (info.isSymbolicLink()) throw new KnowledgeDirectoryError('笔记路径不能使用符号链接');
    }
    const canonical = await realpath(target);
    if (canonical !== target || !canonical.startsWith(root + path.sep)) throw new KnowledgeDirectoryError('笔记路径不能越出知识库');
    if (file && !['.md', '.markdown'].includes(path.extname(canonical).toLowerCase())) throw new KnowledgeDirectoryError('只允许读取 Markdown 笔记路径');
    return canonical;
  };
  const walk = async (relative: string, depth: number): Promise<void> => {
    signal.throwIfAborted();
    if (depth > 32) throw new KnowledgeDirectoryError('目录层级过深');
    const target = relative ? await checked(relative, false) : root;
    for (const entry of await readdir(target, { withFileTypes: true })) {
      if (++entries > 25_000) throw new KnowledgeDirectoryError('知识库条目过多，请选择较小目录');
      if (entry.name.startsWith('.') || entry.isSymbolicLink() || entry.name === 'node_modules') continue;
      const child = relative ? `${relative}/${entry.name}` : entry.name;
      if (entry.isDirectory()) await walk(child, depth + 1);
      else if (entry.isFile() && /\.(?:md|markdown)$/i.test(entry.name)) {
        inventory.push(child);
        if (inventory.length > MAX_FILES) throw new KnowledgeDirectoryError('知识库超过 5000 篇笔记，请选择较小目录');
      }
    }
  };
  await walk('', 0); inventory.sort((a, b) => a.localeCompare(b));
  const locate = (input: string) => {
    // Prefer a real vault-relative target. Only use stripped root prefixes if no exact target exists.
    const candidates = [...new Set([normalizeKnowledgeLink(input, rootName, false), normalizeKnowledgeLink(input, rootName)])];
    for (const candidate of candidates) {
      for (const name of [candidate, `${candidate}.md`, `${candidate}.markdown`]) if (inventory.includes(name)) return name;
    }
    const shortened = candidates.at(-1)!;
    if (!shortened.includes('/')) {
      const matches = inventory.filter(file => path.posix.basename(file, path.posix.extname(file)) === shortened);
      if (matches.length === 1) return matches[0];
      if (matches.length > 1) throw new KnowledgeDirectoryError('笔记路径存在同名文件，请使用完整相对路径');
    }
    throw new KnowledgeDirectoryError('笔记路径不存在或不可读取');
  };
  const textOf = async (relative: string) => {
    const target = await checked(relative);
    const expected = await lstat(target);
    const handle = await open(target, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    try {
      const opened = await handle.stat();
      const currentRoot = await lstat(root);
      if (opened.dev !== expected.dev || opened.ino !== expected.ino || !opened.isFile()
        || currentRoot.dev !== rootIdentity.dev || currentRoot.ino !== rootIdentity.ino
        || await checked(relative) !== target) throw new KnowledgeDirectoryError('笔记路径读取期间已变化');
      const size = opened.size;
      if (size > MAX_READ_BYTES || readBytes + size > 32 * MAX_READ_BYTES) throw new KnowledgeDirectoryError('知识库读取超过本轮上限');
      const text = await readFile(handle, { encoding: 'utf8', signal });
      readBytes += Buffer.byteLength(text);
      if (Buffer.byteLength(text) > MAX_READ_BYTES || readBytes > 32 * MAX_READ_BYTES) throw new KnowledgeDirectoryError('笔记读取时超出上限');
      signal.throwIfAborted();
      return text;
    } finally { await handle.close(); }
  };
  const limitOutput = (text: string, maxChars = 12_000) => {
    const remaining = 48_000 - outputChars;
    if (remaining <= 0) throw new KnowledgeDirectoryError('本轮读取输出已达上限，请根据已读内容回答');
    const output = text.slice(0, Math.min(maxChars, remaining)); outputChars += output.length;
    return output + (output.length < text.length ? '\n[输出已截断，可指定 startLine 和 lineCount 继续读取]' : '');
  };
  const read = async (relative: string, startLine = 1, lineCount = 300, maxChars = 12_000, register = true, heading?: string) => {
    const lines = (await textOf(relative)).split(/\r?\n/);
    let start = Math.max(1, Math.floor(startLine));
    if (heading && startLine === 1) {
      const section = decodeURIComponent(heading).trim();
      const found = lines.findIndex(line => line.replace(/^#{1,6}\s+/, '').replace(/\s+#+$/, '').trim() === section);
      if (found < 0) throw new KnowledgeDirectoryError('笔记章节不存在，请读取目录或搜索标题');
      start = found + 1;
    }
    if (start > lines.length || !lines.slice(start - 1).join('\n').trim()) throw new KnowledgeDirectoryError('请求的笔记片段为空');
    const count = Math.max(1, Math.min(300, Math.floor(lineCount)));
    const text = limitOutput(lines.slice(start - 1, start - 1 + count).join('\n'), maxChars);
    if (!register) return `${relative}:${start}\n${text}`;
    let index = sources.findIndex(source => source.path === relative && source.line === start);
    if (index < 0) { index = sources.length; sources.push({ path: relative, line: start, text, score: 1 }); }
    return `[${index + 1}] ${relative}:${start}\n${text}${start - 1 + count < lines.length ? `\n[共 ${lines.length} 行，可继续分段读取]` : ''}`;
  };
  const guidance = inventory.filter(file => /^(AI_README|README|AGENTS)\.md$/i.test(file));
  const maps = inventory.filter(file => file.split('/').length <= 3 && /索引|地图|导航|目录|术语|index|glossary|map/i.test(path.posix.basename(file)) && !guidance.includes(file));
  const chosen = [...guidance, ...maps].slice(0, 6);
  const navigation: string[] = [];
  for (const file of chosen) navigation.push(await read(file, 1, 180, 3_000, false));
  if (!chosen.length) navigation.push(`未发现导航文件，请先 list 或 search 再读取正文。\n${inventory.slice(0, 60).join('\n')}`);
  return {
    navigation: navigation.join('\n\n'),
    sources: () => sources.map(source => ({ ...source })),
    async execute(request: DirectoryRequest, toolSignal?: AbortSignal): Promise<string> {
      signal.throwIfAborted(); toolSignal?.throwIfAborted();
      if (++calls > 16) throw new KnowledgeDirectoryError('本轮知识库工具调用已达上限');
      if (request.operation === 'read') {
        if (!request.path) throw new KnowledgeDirectoryError('请提供笔记路径');
        const heading = request.path.split('|')[0].match(/#([^\]]+)/)?.[1];
        return read(locate(request.path), request.startLine, request.lineCount, 12_000, true, heading);
      }
      if (request.operation === 'list') {
        const folder = request.path ? normalizeKnowledgeLink(request.path, rootName) : '';
        const matches = inventory.filter(file => !folder || file.startsWith(`${folder}/`));
        return limitOutput(matches.slice(0, 100).join('\n') || '没有匹配的笔记');
      }
      if (request.operation !== 'search' || !request.query?.trim()) throw new KnowledgeDirectoryError('请提供有效查询词');
      const tokens = searchTerms(request.query);
      const hits: { path: string; score: number }[] = [];
      for (const file of inventory) {
        signal.throwIfAborted(); toolSignal?.throwIfAborted();
        const body = (await textOf(file)).toLowerCase();
        const name = file.toLowerCase();
        const score = tokens.reduce((sum, token) => sum + (name.includes(token) ? 5 : 0) + (body.includes(token) ? 1 : 0), 0);
        if (score) hits.push({ path: file, score });
      }
      return limitOutput(hits.sort((a, b) => b.score - a.score).slice(0, 20).map(hit => hit.path).join('\n') || '没有找到匹配笔记，请换用索引中的术语。');
    },
  };
}
