import { readFile, writeFile, access } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const root = '/opt/picoddy/node_modules';
const packages = { gitlab: ['@masuratech/gitlab-mcp-server', '1.0.0'], jenkins: ['@kud/mcp-jenkins', '2.3.0'] };
export async function executeBuiltinRequest(request, deps = {}) {
  if (request.operation === 'installation') {
    const entry = packages[request.id];
    if (!entry) throw new Error('Unknown builtin');
    const manifest = JSON.parse(await readFile(`${root}/${entry[0]}/package.json`, 'utf8'));
    if (manifest.name !== entry[0] || manifest.version !== entry[1]) throw new Error('Builtin version mismatch');
    await access(`${root}/${entry[0]}/dist/index.js`);
    return { installed: true };
  }
  throw new Error('Unsupported builtin operation');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const path = process.argv[2];
    if (!/^\/workspace\/\.builtin-[0-9a-f-]{36}\.json$/.test(path)) throw new Error('Invalid request path');
    const bytes = await readFile(path);
    if (bytes.length > 128 * 1024) throw new Error('Request too large');
    const result = await executeBuiltinRequest(JSON.parse(bytes));
    await writeFile(`${path}.out`, JSON.stringify(result), { mode: 0o600 });
  } catch { process.stderr.write('Builtin operation failed\n'); process.exitCode = 1; }
}
