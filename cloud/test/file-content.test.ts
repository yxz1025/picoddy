import assert from 'node:assert/strict';
import test from 'node:test';
import * as content from '../src/transport/http/file-content.ts';

test('single byte ranges support bounded, open and suffix requests and reject invalid ranges', () => {
  assert.deepEqual(content.byteRange('bytes=2-5', 10), { start: 2, end: 5 });
  assert.deepEqual(content.byteRange('bytes=7-', 10), { start: 7, end: 9 });
  assert.deepEqual(content.byteRange('bytes=-3', 10), { start: 7, end: 9 });
  assert.deepEqual(content.byteRange('bytes=0-100', 10), { start: 0, end: 9 });
  assert.equal(content.byteRange(undefined, 10), undefined);
  for (const value of ['bytes=10-', 'bytes=4-2', 'bytes=-0', 'bytes=0-1,3-4', 'bytes=x-y', 'bytes=9007199254740993-']) {
    assert.throws(() => content.byteRange(value, 10));
  }
  assert.throws(() => content.byteRange('bytes=0-', 0));
});

test('inline MIME is derived from a safe extension, never the uploader supplied MIME', () => {
  assert.equal(content.inlineMime('report.PDF'), 'application/pdf');
  assert.equal(content.inlineMime('video.mp4'), 'video/mp4');
  for (const filename of ['active.html', 'active.svg', 'report.docx', 'payload.js', 'unknown']) {
    assert.equal(content.inlineMime(filename), 'text/plain; charset=utf-8');
  }
});
