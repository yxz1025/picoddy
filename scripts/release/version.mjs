import { readFile, writeFile, rename, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import semver from 'semver';

/** Called only after publication succeeds. Old-plan retries must not downgrade source metadata. */
export async function syncPublishedVersion(root, version) {
  if (semver.valid(version) !== version) throw new Error('发布版本无效，无法同步 package.json');
  const files = [];
  for (const name of ['package.json', 'package-lock.json']) {
    const path = join(root, name);
    let text;
    try { text = await readFile(path, 'utf8'); }
    catch (error) { if (name === 'package-lock.json' && error.code === 'ENOENT') continue; throw error; }
    const data = JSON.parse(text);
    if (name === 'package.json' && semver.valid(data.version) && semver.gt(data.version, version)) return;
    data.version = version;
    if (name === 'package-lock.json' && data.packages?.['']) data.packages[''].version = version;
    const indent = text.match(/\n([\t ]+)"/)?.[1] ?? '  ';
    const newline = text.includes('\r\n') ? '\r\n' : '\n';
    const updated = JSON.stringify(data, null, indent).replace(/\n/g, newline) + (text.endsWith('\n') ? newline : '');
    if (updated !== text) files.push({ path, updated });
  }
  for (const { path, updated } of files) {
    const temporary = `${path}.${randomUUID()}.tmp`;
    try { await writeFile(temporary, updated, { flag: 'wx' }); await rename(temporary, path); }
    finally { await rm(temporary, { force: true }); }
  }
}
