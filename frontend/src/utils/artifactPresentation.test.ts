import assert from "node:assert/strict";
import test from "node:test";
import * as artifactPresentation from "./artifactPresentation.ts";
import {
  deliveryBatchFromContent,
  deliveryBatchFromOutput,
  normalizePresentedFile,
  normalizePresentedFiles,
} from "./artifactPresentation.ts";

test("normalizes supported artifacts and routes their renderers", () => {
  assert.equal(normalizePresentedFile({ path: "/tmp/report.PDF" }).kind, "document");
  assert.equal(normalizePresentedFile({ path: "C:\\work\\sales.xlsx" }).kind, "spreadsheet");
  assert.equal(normalizePresentedFile({ path: "/tmp/deck.pptx" }).renderer, "presentation");
  assert.equal(normalizePresentedFile({ path: "/tmp/chart.png" }).thumbnailUrl, "/api/file?path=%2Ftmp%2Fchart.png");
  assert.equal(normalizePresentedFile({ url: "https://example.com/report?q=1" }).kind, "web");
  assert.equal(normalizePresentedFile({ path: "/tmp/app.ts" }).kind, "code");
  assert.equal(normalizePresentedFile({ path: "/tmp/rows.json" }).kind, "data");
  assert.equal(normalizePresentedFile({ path: "/tmp/readme.txt" }).kind, "text");
  assert.equal(normalizePresentedFile({ path: "/tmp/movie.webm" }).kind, "video");
});

test("uses title, filename, then host as display name", () => {
  assert.equal(normalizePresentedFile({ path: "/tmp/a.pdf", title: "月报" }).displayName, "月报");
  assert.equal(normalizePresentedFile({ path: "/tmp/a.pdf" }).displayName, "a.pdf");
  assert.equal(normalizePresentedFile({ path: "C:\\work\\a.pdf" }).displayName, "a.pdf");
  assert.equal(normalizePresentedFile({ url: "https://example.com/" }).displayName, "example.com");
});

test("routes unknown files to external fallback", () => {
  const model = normalizePresentedFile({ path: "/tmp/archive.bin" });
  assert.equal(model.kind, "unknown");
  assert.equal(model.renderer, "unsupported");
  assert.equal(model.previewMode, "external-fallback");
});

test("only treats http and https URLs as browser artifacts", () => {
  assert.equal(normalizePresentedFile({ url: "https://example.com/report?q=1" }).renderer, "browser");
  for (const url of ["file:///tmp/report.pdf", "javascript:alert(1)", "/relative/report.pdf"]) {
    const model = normalizePresentedFile({ url });
    assert.equal(model.kind, "unknown");
    assert.equal(model.renderer, "unsupported");
  }
});

test("keeps renderer support aligned with available previews", () => {
  assert.equal(normalizePresentedFile({ path: "/tmp/page.html" }).kind, "web");
  assert.equal(normalizePresentedFile({ path: "/tmp/page.html" }).renderer, "browser");
  assert.equal(normalizePresentedFile({ path: "/tmp/readme.markdown" }).renderer, "markdown");
  assert.equal(normalizePresentedFile({ path: "/tmp/a.doc" }).renderer, "unsupported");
  assert.equal(normalizePresentedFile({ path: "/tmp/a.odt" }).renderer, "unsupported");
  assert.equal(normalizePresentedFile({ path: "/tmp/a.docx" }).renderer, "docx");
  assert.equal(normalizePresentedFile({ path: "/tmp/a.xls" }).renderer, "unsupported");
  assert.equal(normalizePresentedFile({ path: "/tmp/a.xlsx" }).renderer, "table");
  assert.equal(normalizePresentedFile({ path: "/tmp/a.tsv" }).renderer, "table");
  assert.equal(normalizePresentedFile({ path: "/tmp/a.ppt" }).renderer, "unsupported");
  assert.equal(normalizePresentedFile({ path: "/tmp/a.pptx" }).renderer, "presentation");
});

test("routes text, data, markdown, video and legacy office formats", () => {
  assert.equal(normalizePresentedFile({ path: "/tmp/main.ts" }).renderer, "text");
  assert.equal(normalizePresentedFile({ path: "/tmp/data.json" }).renderer, "text");
  assert.equal(normalizePresentedFile({ path: "/tmp/readme.md" }).renderer, "markdown");
  assert.equal(normalizePresentedFile({ path: "/tmp/demo.mp4" }).renderer, "video");
  assert.equal(normalizePresentedFile({ path: "/tmp/demo.mov" }).renderer, "video");
  assert.equal(normalizePresentedFile({ path: "/tmp/demo.webm" }).renderer, "video");
  assert.equal(normalizePresentedFile({ path: "/tmp/demo.m4v" }).renderer, "unsupported");
  assert.equal(normalizePresentedFile({ path: "/tmp/demo.avi" }).renderer, "unsupported");
  assert.equal(normalizePresentedFile({ path: "/tmp/demo.mkv" }).renderer, "unsupported");
  assert.equal(normalizePresentedFile({ path: "/tmp/legacy.ppt" }).renderer, "unsupported");
});

test("keeps backend text preview whitelist aligned with adapter renderers", () => {
  const textRenderers = [
    "/tmp/example.py",
    "/tmp/example.tsx",
    "/tmp/example.jsx",
    "/tmp/example.go",
    "/tmp/example.rs",
    "/tmp/example.java",
    "/tmp/example.c",
    "/tmp/example.cpp",
    "/tmp/example.cxx",
    "/tmp/example.css",
    "/tmp/example.scss",
    "/tmp/example.sh",
    "/tmp/example.bash",
    "/tmp/example.yaml",
    "/tmp/example.yml",
    "/tmp/example.xml",
    "/tmp/example.toml",
    "/tmp/example.ini",
    "/tmp/example.log",
  ];

  for (const path of textRenderers) {
    assert.equal(normalizePresentedFile({ path }).renderer, "text", path);
  }

  assert.equal(normalizePresentedFile({ path: "/tmp/example.md" }).renderer, "markdown");
  assert.equal(normalizePresentedFile({ path: "/tmp/example.markdown" }).renderer, "markdown");
  assert.equal(normalizePresentedFile({ path: "/tmp/example.csv" }).renderer, "table");
  assert.equal(normalizePresentedFile({ path: "/tmp/example.tsv" }).renderer, "table");
});

test("normalizes lists without mutating source files", () => {
  const files = [{ path: "/tmp/a.csv", size: "2 KB" }];
  const models = normalizePresentedFiles(files);
  assert.equal(models.length, 1);
  assert.equal(models[0].sizeLabel, "2 KB");
  assert.deepEqual(files, [{ path: "/tmp/a.csv", size: "2 KB" }]);
});

test("parses live and persisted batches identically", () => {
  const output = {
    content: [{ type: "text", text: "已交付" }],
    details: {
      files: [{ path: "/tmp/report.pdf" }],
      explanation: "报告已生成",
      problems: ["chart.png 不存在"],
    },
  };
  assert.deepEqual(deliveryBatchFromContent(JSON.stringify(output)), deliveryBatchFromOutput(output));
});

test("returns null for malformed or empty batch payloads", () => {
  assert.equal(deliveryBatchFromContent("not json"), null);
  assert.equal(deliveryBatchFromOutput({ details: { files: [] } }), null);
  assert.deepEqual(deliveryBatchFromOutput({ details: { files: [{ path: "/tmp/a" }, null, 1] } })?.files, [{ path: "/tmp/a" }]);
  assert.equal(deliveryBatchFromOutput({ details: { files: [{ title: "missing source" }, [], { path: "" }, { url: 42 }] } }), null);
});

test("keeps separate outputs as separate batches", () => {
  const first = deliveryBatchFromOutput({ details: { files: [{ path: "/tmp/first.pdf" }] } });
  const second = deliveryBatchFromOutput({ details: { files: [{ path: "/tmp/second.png" }] } });

  assert.equal(first?.files[0].path, "/tmp/first.pdf");
  assert.equal(second?.files[0].path, "/tmp/second.png");
  assert.notDeepEqual(first, second);
});

test("builds artifact card view models without losing preview targets", () => {
  const [image, web] = normalizePresentedFiles([
    { path: "/tmp/封面图.png", title: "封面图", size: "12 KB" },
    { url: "https://example.com/demo", title: "在线演示" },
  ]);

  assert.equal(image.displayName, "封面图");
  assert.equal(image.typeLabel, "PNG");
  assert.equal(image.previewTarget.path, "/tmp/封面图.png");
  assert.equal(image.previewTarget.title, "封面图");
  assert.equal(image.thumbnailUrl, "/api/file?path=%2Ftmp%2F%E5%B0%81%E9%9D%A2%E5%9B%BE.png");
  assert.equal(web.kind, "web");
  assert.equal(web.previewTarget.url, "https://example.com/demo");
  assert.equal(web.previewMode, "internal");
});

test("falls back to the first preview target when the current one is gone", () => {
  assert.equal(typeof artifactPresentation.resolveActivePreviewTarget, "function");
  const previewTargets = [
    { path: "/tmp/current.pdf", title: "当前批次" },
    { url: "https://example.com/demo", title: "Demo" },
  ];

  const resolved = artifactPresentation.resolveActivePreviewTarget?.(previewTargets, {
    path: "/tmp/old.pdf",
    toolName: "present_files",
  });

  assert.deepEqual(resolved, previewTargets[0]);
});

test("creates stable preview list keys even when file names repeat", () => {
  assert.equal(typeof artifactPresentation.previewListItemKey, "function");

  const first = artifactPresentation.previewListItemKey?.({ path: "/tmp/a/report.pdf" }, 0);
  const second = artifactPresentation.previewListItemKey?.({ path: "/tmp/a/report.pdf" }, 1);
  const third = artifactPresentation.previewListItemKey?.({ url: "https://example.com/report" }, 2);

  assert.notEqual(first, second);
  assert.equal(first, "/tmp/a/report.pdf:0");
  assert.equal(second, "/tmp/a/report.pdf:1");
  assert.equal(third, "https://example.com/report:2");
});
