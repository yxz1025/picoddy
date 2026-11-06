import assert from "node:assert/strict";
import test from "node:test";

import { parseMarkdownPreviewResponse } from "./markdownPreview.ts";

test("accepts only successful HTML preview responses", () => {
  assert.deepEqual(
    parseMarkdownPreviewResponse({ ok: true, html: "<h1>x</h1>" }),
    { html: "<h1>x</h1>" },
  );
  assert.throws(() => parseMarkdownPreviewResponse({ ok: true, html: 1 }));
  assert.throws(() => parseMarkdownPreviewResponse({ ok: false, error: "failed" }));
});

test("normalizes preview errors", () => {
  assert.throws(
    () => parseMarkdownPreviewResponse({ ok: false, error: "Markdown 预览失败" }),
    /Markdown 预览失败/,
  );
  assert.throws(
    () => parseMarkdownPreviewResponse({ ok: true }),
    /HTML/,
  );
});
