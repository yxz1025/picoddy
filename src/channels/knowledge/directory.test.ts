import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, symlink, realpath, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createDirectorySession, normalizeKnowledgeLink } from './directory.ts';

test('normalizes arbitrary selected folder names and Obsidian links without business-specific paths', () => {
  assert.equal(normalizeKnowledgeLink('[[产品 资料/制度/报销#步骤\\|显示名]]', '产品 资料'), '制度/报销');
  assert.equal(normalizeKnowledgeLink('制度\\报销.md', '知识库A'), '制度/报销.md');
  assert.equal(normalizeKnowledgeLink('![[知识库A/制度/报销]]', '知识库A'), '制度/报销');
  assert.throws(() => normalizeKnowledgeLink('../private.md', '知识库A'), /路径/);
  assert.throws(() => normalizeKnowledgeLink('C:\\private.md', '知识库A'), /路径/);
});

test('reads dynamic root-prefixed maps, bootstraps guidance, and blocks symlink or hidden escapes', async () => {
  const temp = await mkdtemp(join(tmpdir(), 'directory-kb-'));
  const root = join(temp, '随意的库');
  try {
    await mkdir(join(root, '导航'), { recursive: true });
    await mkdir(join(root, '制度'));
    await mkdir(join(root, '.private'));
    await writeFile(join(root, 'AI_README.md'), '先读导航/问题索引.md，再读取命中的正文。');
    await writeFile(join(root, '导航', '问题索引.md'), '[[随意的库/制度/报销|报销流程]]');
    await writeFile(join(root, '制度', '报销.md'), '# 报销\n\n需要电子发票。');
    await writeFile(join(temp, 'outside.md'), 'secret');
    await writeFile(join(root, '.private', 'secret.md'), 'hidden');
    await symlink(join(temp, 'outside.md'), join(root, 'linked.md'));
    const session = await createDirectorySession(await realpath(root), new AbortController().signal);
    assert.ok(session.navigation.includes('问题索引'));
    assert.ok(session.navigation.includes('先读导航'));
    assert.equal(session.sources().length, 0);
    const result = await session.execute({ operation: 'read', path: '[[随意的库/制度/报销|报销流程]]' });
    assert.ok(result.includes('电子发票')); assert.equal(session.sources().at(-1)?.path, '制度/报销.md');
    assert.ok((await session.execute({ operation: 'search', query: '电子发票' })).includes('制度/报销.md'));
    await assert.rejects(() => session.execute({ operation: 'read', path: '../outside.md' }), /路径/);
    await assert.rejects(() => session.execute({ operation: 'read', path: 'linked.md' }), /路径/);
    await assert.rejects(() => session.execute({ operation: 'read', path: '.private/secret.md' }), /路径/);
  } finally { await rm(temp, { recursive: true, force: true }); }
});

test('without maps, arbitrary roots use a listing and read by a unique note name', async () => {
  const temp = await mkdtemp(join(tmpdir(), 'plain-kb-'));
  try {
    await mkdir(join(temp, 'notes'));
    await writeFile(join(temp, 'notes', '说明.md'), '一般知识正文');
    const session = await createDirectorySession(await realpath(temp), new AbortController().signal);
    assert.ok(session.navigation.includes('未发现导航'));
    assert.ok(session.navigation.includes('notes/说明.md'));
    assert.ok((await session.execute({ operation: 'read', path: '[[说明]]' })).includes('一般知识正文'));
  } finally { await rm(temp, { recursive: true, force: true }); }
});

test('a real nested directory matching the root name takes precedence over stripping the prefix', async () => {
  const temp = await mkdtemp(join(tmpdir(), 'same-name-'));
  const root = join(temp, 'KB');
  try {
    await mkdir(join(root, 'KB'), { recursive: true });
    await writeFile(join(root, 'KB', '说明.md'), '嵌套目录正文');
    await writeFile(join(root, '说明.md'), '根目录正文');
    const session = await createDirectorySession(await realpath(root), new AbortController().signal);
    const result = await session.execute({ operation: 'read', path: 'KB/说明.md' });
    assert.ok(result.includes('嵌套目录正文'));
    assert.ok(!result.includes('根目录正文'));
  } finally { await rm(temp, { recursive: true, force: true }); }
});


test('section links locate late headings and empty ranges cannot register citations', async () => {
  const root = await mkdtemp(join(tmpdir(), 'directory-section-'));
  try {
    await writeFile(join(root, 'long.md'), Array(350).fill('intro').join('\n') + '\n## 具体步骤\nactual answer');
    const session = await createDirectorySession(await realpath(root), new AbortController().signal);
    await assert.rejects(() => session.execute({ operation: 'read', path: 'long.md', startLine: 900 }), /为空/);
    assert.equal(session.sources().length, 0);
    const result = await session.execute({ operation: 'read', path: '[[long#具体步骤|步骤]]' });
    assert.ok(result.includes('actual answer'));
    assert.equal(session.sources()[0].line, 351);
  } finally { await rm(root, { recursive: true, force: true }); }
});
