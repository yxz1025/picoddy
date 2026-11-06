import { createRequire } from 'node:module';
import { readFile, realpath } from 'node:fs/promises';
import { isAbsolute, resolve } from 'node:path';
import { git, hash, inside } from './mini-runtime.mjs';
export async function inspectWeb(input) {
  if (!isAbsolute(input.repositoryRoot || '')) throw new Error('Repository must be an absolute path');
  const root = await realpath(input.repositoryRoot);
  if (await realpath((await git(root, ['rev-parse', '--show-toplevel'])).trim()) !== root) throw new Error('Select the Git repository root');
  const base = new URL(input.baseUrl);
  if (!['http:', 'https:'].includes(base.protocol) || base.username || base.password) throw new Error('HTTP(S) test URL without credentials required');
  const entry = new URL(input.entryPath || base.href, base);
  if (entry.origin !== base.origin || entry.username || entry.password) throw new Error('Entry must belong to the configured test domain');
  const cli = createRequire(resolve(root, 'package.json')).resolve('@playwright/test/cli');
  let config;
  for (const name of ['playwright.config.ts', 'playwright.config.mts', 'playwright.config.cts', 'playwright.config.js', 'playwright.config.mjs', 'playwright.config.cjs']) {
    try { config = await inside(root, name); break; } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  if (!config) throw new Error('Create a Playwright config in the repository root, reusing its existing authentication/data fixtures');
  return { root, cli, config, baseUrl: base.href, entryUrl: entry.href, message: 'Playwright and configuration found. No browser or test was started; browser installation, login and URL availability are checked during execution.' };
}
export async function validateWebRequest(request) {
  if (!request || !/^[A-Za-z0-9_-]{1,100}$/.test(request.id || '') || !['web', 'h5', 'microfrontend'].includes(request.target?.kind)) throw new Error('Invalid web test request');
  const verified = await inspectWeb({ ...request.target, repositoryRoot: request.repositoryRoot });
  const commit = request.package?.testSha;
  if (!/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(commit || '') || (await git(verified.root, ['rev-parse', 'HEAD'])).trim() !== commit) throw new Error('Check out the requested test commit');
  if ((await git(verified.root, ['status', '--porcelain'])).trim()) throw new Error('Commit the scripts and use a clean worktree before execution');
  const path = request.package.manifestPath;
  if (typeof path !== 'string' || /^[-/]|^[A-Za-z]:|\\/.test(path) || path.split('/').some(p => !p || p === '..' || p === '.git')) throw new Error('Invalid manifest path');
  const raw = await git(verified.root, ['show', `${commit}:${path}`]);
  if (hash(raw) !== request.package.hash) throw new Error('Test package hash mismatch');
  const pack = JSON.parse(raw);
  if (pack.schemaVersion !== 1 || !Array.isArray(pack.cases) || !pack.cases.length || pack.cases.length > 5000) throw new Error('Invalid test package');
  const seen = new Set();
  for (const row of pack.cases) {
    if (!/^[A-Za-z0-9_-]{1,100}$/.test(row.id) || seen.has(row.id)) throw new Error('Invalid or duplicate case ID');
    seen.add(row.id);
    if (row.automation === 'automated') {
      if (typeof row.file !== 'string' || /^[-/]|^[A-Za-z]:|\\/.test(row.file) || row.file.split('/').some(p => !p || p === '..' || p === '.git')) throw new Error('Invalid script path');
      await inside(verified.root, row.file);
      if ((await git(verified.root, ['cat-file', '-t', `${commit}:${row.file}`])).trim() !== 'blob') throw new Error('Test script is not committed');
    }
  }
  if (!pack.cases.some(c => c.automation === 'automated')) throw new Error('No automated cases');
  if (request.target.versionUrl) {
    const url = new URL(request.target.versionUrl);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(request.businessSha || '')) throw new Error('Version verification requires a valid endpoint and expected full SHA');
  }
  return { ...verified, cases: pack.cases };
}
