"use strict";
Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
const node_path = require("node:path");
const node_url = require("node:url");
const node_child_process = require("node:child_process");
const node_fs = require("node:fs");
const HELPER_MAX_BUFFER = 64 * 1024 * 1024;
const HELPER_TIMEOUT_MS = 3e4;
const toRect = (b) => ({
  x0: b[0],
  y0: b[1],
  x1: b[2],
  y1: b[3]
});
function createHelperOcrEngine(helperPath, languages) {
  return (png) => {
    const args = languages && languages.length > 0 ? [languages.join(",")] : [];
    const res = node_child_process.spawnSync(helperPath, args, {
      input: png,
      maxBuffer: HELPER_MAX_BUFFER,
      timeout: HELPER_TIMEOUT_MS
    });
    if (res.status !== 0 || res.stdout == null) return null;
    let parsed;
    try {
      const text = res.stdout.toString("utf8").replace(/^\uFEFF/, "");
      parsed = JSON.parse(text);
    } catch {
      return null;
    }
    if (!Array.isArray(parsed.lines)) return null;
    return {
      lines: parsed.lines.map((l) => ({
        text: l.t,
        confidence: l.c,
        box: toRect(l.b),
        ...l.chars ? { chars: l.chars.map((c) => ({ text: c.t, box: toRect(c.b) })) } : {}
      })),
      ...typeof parsed.paper === "number" ? { paperShare: parsed.paper } : {}
    };
  };
}
function createVisionOcrEngine(helperPath, languages) {
  if (process.platform !== "darwin") return null;
  if (!node_fs.existsSync(helperPath)) return null;
  return createHelperOcrEngine(helperPath, languages);
}
function createWindowsOcrEngine(helperPath, languages) {
  if (process.platform !== "win32") return null;
  if (!node_fs.existsSync(helperPath)) return null;
  return createHelperOcrEngine(helperPath, languages);
}
let ocrEngine;
function ensureOcrEngine() {
  if (ocrEngine !== void 0) return ocrEngine;
  const here = node_path.dirname(node_url.fileURLToPath(require("url").pathToFileURL(__filename).href));
  const helper = process.platform === "darwin" ? "vision-ocr" : "win-ocr.exe";
  const create = process.platform === "darwin" ? createVisionOcrEngine : createWindowsOcrEngine;
  const candidates = [
    ...process.resourcesPath ? [node_path.join(process.resourcesPath, "ocr", helper)] : [],
    node_path.join(here, "../../../../packages/pdf2docx/ocr-helper", helper)
  ];
  ocrEngine = null;
  for (const path of candidates) {
    const engine = create(path);
    if (engine) {
      ocrEngine = engine;
      break;
    }
  }
  return ocrEngine;
}
function ocrPagePng(pngBase64) {
  const engine = ensureOcrEngine();
  if (!engine) return null;
  let png;
  try {
    png = Uint8Array.from(Buffer.from(pngBase64, "base64"));
  } catch {
    return [];
  }
  const result = engine(png, { widthPt: 0, heightPt: 0 });
  if (!result) return [];
  return result.lines.map((l) => ({
    text: l.text,
    confidence: l.confidence,
    box: [l.box.x0, l.box.y0, l.box.x1, l.box.y1],
    ...l.chars ? {
      chars: l.chars.map((c) => ({
        text: c.text,
        box: [c.box.x0, c.box.y0, c.box.x1, c.box.y1]
      }))
    } : {}
  }));
}
exports.ocrPagePng = ocrPagePng;
