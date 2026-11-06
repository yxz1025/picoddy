const { readFileSync, accessSync } = require('node:fs');
const { join } = require('node:path');
const semver = require('semver');

// These internal imports are needed before the application can finish booting.
const requiredModules = [
  'dist/extensions/mcp/runtime.js',
  'dist/extensions/mcp/oauth.js',
  'dist/extensions/mcp/tools.js',
  'dist/core/auth-storage.js',
  'dist/core/mcp-servers.js',
];

function verifyNativeDependencies(root, reader = {
  read: path => readFileSync(join(root, path), 'utf8'),
  access: path => accessSync(join(root, path)),
}) {
  const manifest = JSON.parse(reader.read('package.json'));
  for (const [name, expected] of Object.entries(manifest.dependencies)) {
    if (!name.startsWith('@earendil-works/')) continue;
    let installed;
    try { installed = JSON.parse(reader.read(join('node_modules', name, 'package.json'))); }
    catch { throw new Error(`NATIVE_DEPENDENCY_MISSING: ${name}; run npm install before packaging`); }
    if (!semver.satisfies(installed.version, expected)) {
      throw new Error(`NATIVE_DEPENDENCY_VERSION_MISMATCH: ${name} expected ${expected}, found ${installed.version}; run npm install before packaging`);
    }
  }
  for (const module of requiredModules) {
    const path = join('node_modules', '@earendil-works/pi-coding-agent', module);
    try { reader.access(path); }
    catch { throw new Error(`NATIVE_DEPENDENCY_MODULE_MISSING: ${path}`); }
  }
}

module.exports = { verifyNativeDependencies };
