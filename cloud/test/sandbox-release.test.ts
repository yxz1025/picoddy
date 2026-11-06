import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('local lifecycle and execd use the pinned SDK umbrella release with non-root filesystem routes',async()=>{
  const pkg=JSON.parse(await readFile(new URL('../package.json',import.meta.url),'utf8'));
  const version=pkg.dependencies['@alibaba-group/opensandbox'];
  for(const path of ['../deploy/opensandbox.local.yaml','../deploy/opensandbox.local.toml']){
    const config=await readFile(new URL(path,import.meta.url),'utf8');
    assert.ok(config.includes(`release-${version}@sha256:`), 'Keep SDK, server and execd on the same verified umbrella release');
  }
});
