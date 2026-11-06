import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

test('workspace scanner rejects unreadable directory inventories instead of returning destructive partial manifests', async () => {
  const script = fileURLToPath(new URL('../runtime/workspace.py', import.meta.url));
  const { stdout } = await promisify(execFile)('python3', ['-B', '-c', `
import importlib.util, sys, tempfile
from pathlib import Path
from unittest.mock import patch
spec = importlib.util.spec_from_file_location('workspace', sys.argv[1])
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
def denied(*args, **kwargs):
    if kwargs.get('onerror'):
        kwargs['onerror'](PermissionError('denied'))
    return iter([])
with tempfile.TemporaryDirectory(prefix='cloud-workspace-test-') as tmp:
    root = Path(tmp)
    (root / 'work').mkdir()
    with patch.object(module.os, 'walk', denied):
        try:
            module.inventory(root)
            print('PARTIAL_MANIFEST')
        except PermissionError:
            print('REJECTED')
`, script]);
  assert.equal(stdout.trim(), 'REJECTED');
});
