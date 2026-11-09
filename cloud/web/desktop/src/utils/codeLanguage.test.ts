import assert from 'node:assert/strict';
import test from 'node:test';
import { codeLanguage } from './codeLanguage.ts';

test('detects source languages across Windows paths and extension casing', () => {
  assert.equal(codeLanguage('C:\\work\\App.TSX'), 'typescript');
  assert.equal(codeLanguage('/tmp/main.py'), 'python');
  assert.equal(codeLanguage('/tmp/config.yml'), 'yaml');
  assert.equal(codeLanguage('/tmp/data.json'), 'json');
  assert.equal(codeLanguage('/tmp/notes.txt'), 'plaintext');
  assert.equal(codeLanguage('/tmp/unknown.xyz'), 'plaintext');
});
