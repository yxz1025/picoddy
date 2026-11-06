import { readFile, writeFile, realpath, stat, lstat, mkdir, copyFile, rename, unlink, readdir } from 'node:fs/promises';
import { resolve, dirname, basename, extname } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { editXlsx, editDocxTemplate, editDocxFree, editPptx } from './document-editor.mjs';
import { relative, isAbsolute } from 'node:path';
function isPathWithin(root, path) { const delta = relative(root, path); return !isAbsolute(delta) && delta !== '..' && !delta.startsWith('../'); }

const MAX_FILE = 25 * 1024 * 1024;
function allowed(path, write = false) {
  return ['/workspace/work','/workspace/output', ...(!write ? ['/workspace/input'] : [])].some(root => isPathWithin(root, path));
}
async function sourcePath(value) {
  if (typeof value !== 'string' || !allowed(resolve(value))) throw new Error('文件必须位于当前沙箱工作目录');
  const path = await realpath(value), info = await stat(path);
  if (!allowed(path) || !info.isFile() || info.size > MAX_FILE) throw new Error('文档路径或大小无效');
  return path;
}
async function destinationPath(value) {
  const path = resolve(value);
  if (!allowed(path, true)) throw new Error('输出必须位于 work/output');
  let existing = dirname(path);
  for (;;) {
    try { await lstat(existing); break; } catch (error) { if (error.code !== 'ENOENT') throw error; existing = dirname(existing); }
  }
  const actualAncestor = await realpath(existing);
  if (!allowed(actualAncestor, true) && !(existing === '/workspace' && actualAncestor === '/workspace')) throw new Error('输出目录越界');
  await mkdir(dirname(path), { recursive: true });
  try { if (!allowed(await realpath(path), true) || (await lstat(path)).isSymbolicLink()) throw new Error('输出目标无效'); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  return path;
}
export async function editDocument(operation, args) {
  const source = await sourcePath(args.path), extension = extname(source).toLowerCase();
  const expected = {edit_xlsx:'.xlsx',edit_docx:'.docx',edit_docx_free:'.docx',edit_pptx:'.pptx'}[operation];
  if (!expected || extension !== expected) throw new Error('文档类型与编辑工具不匹配');
  if (args.outFileName && (basename(args.outFileName) !== args.outFileName || args.outFileName.includes('\\') || extname(args.outFileName).toLowerCase() !== expected)) throw new Error('输出文件名无效');
  const target = await destinationPath(args.outFileName ? `/workspace/output/${args.outFileName}` : isPathWithin('/workspace/input', source) ? `/workspace/output/${basename(source)}` : source);
  const versionDir = `/workspace/work/.document-versions/${createHash('sha256').update(target).digest('hex').slice(0,32)}`;
  await destinationPath(`${versionDir}/probe`);
  const versions = (await readdir(versionDir)).map(name => Number(name.match(/^v(\d+)\./)?.[1] ?? 0));
  const version = Math.max(0,...versions)+1, backupPath = `${versionDir}/v${version}${extension}`;
  let backupSource = source;
  try { await lstat(target); backupSource = await sourcePath(target); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  await copyFile(backupSource, backupPath);
  const temporary = `${dirname(target)}/.document-${randomUUID()}${extension}`;
  try {
    await copyFile(source, temporary);
    if (operation === 'edit_xlsx') await editXlsx(temporary, args.changes);
    else if (operation === 'edit_docx') await editDocxTemplate(source, args.vars, temporary);
    else if (operation === 'edit_docx_free') await editDocxFree(temporary, args.ops);
    else await editPptx(temporary, args.ops);
    const size = (await stat(temporary)).size;
    if (!size || size > MAX_FILE) throw new Error('编辑结果超出文件限额');
    await rename(temporary, target);
    return { path: target, version, backupPath, size };
  } finally { await unlink(temporary).catch(() => {}); }
}

export async function executePortableRequest(request, dependencies = {}) {
  if (request.kind === 'document_edit') return editDocument(request.operation, request.arguments);
  throw new Error('未知沙箱操作');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const requestPath = process.argv[2];
  try {
    if (!/^\/workspace\/\.portable-[0-9a-f-]{36}\.json$/.test(requestPath)) throw new Error('请求路径无效');
    const bytes = await readFile(requestPath);
    if (bytes.length > 1024*1024) throw new Error('请求过大');
    const result = await executePortableRequest(JSON.parse(bytes));
    await writeFile(`${requestPath}.out`, JSON.stringify({ ok: true, result }), { mode: 0o600 });
  } catch (error) {
    if (/^\/workspace\/\.portable-[0-9a-f-]{36}\.json$/.test(requestPath)) await writeFile(`${requestPath}.out`, JSON.stringify({ ok: false, code: error.code ?? 'PORTABLE_OPERATION_FAILED', message: '沙箱工具执行失败，请检查输入参数、文件路径或服务状态' }), { mode: 0o600 });
    process.exitCode = 1;
  } finally { if (/^\/workspace\/\.portable-[0-9a-f-]{36}\.json$/.test(requestPath)) await unlink(requestPath).catch(() => {}); }
}
