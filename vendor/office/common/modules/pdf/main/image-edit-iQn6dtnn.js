"use strict";
Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
const electron = require("electron");
const textEdit = require("./text-edit-DdyYKw0w.js");
const FPDF_PAGEOBJ_IMAGE = 3;
const FPDF_BITMAP_BGRA = 4;
function collectObjects(m, page) {
  const out = [];
  const bl = m._malloc(4);
  const bb = m._malloc(4);
  const br = m._malloc(4);
  const bt = m._malloc(4);
  const count = m._FPDFPage_CountObjects(page);
  for (let i = 0; i < count; i++) {
    const obj = m._FPDFPage_GetObject(page, i);
    if (!m._FPDFPageObj_GetBounds(obj, bl, bb, br, bt)) continue;
    out.push({
      obj,
      index: i,
      type: m._FPDFPageObj_GetType(obj),
      bounds: [m.HEAPF32[bl >> 2], m.HEAPF32[bb >> 2], m.HEAPF32[br >> 2], m.HEAPF32[bt >> 2]]
    });
  }
  for (const p of [bl, bb, br, bt]) m._free(p);
  return out;
}
const MATCH_TOL = 2;
function matchImage(objects, rect) {
  let best = null;
  let bestD = Infinity;
  for (const o of objects) {
    if (o.type !== FPDF_PAGEOBJ_IMAGE) continue;
    const d = Math.max(
      Math.abs(o.bounds[0] - rect[0]),
      Math.abs(o.bounds[1] - rect[1]),
      Math.abs(o.bounds[2] - rect[2]),
      Math.abs(o.bounds[3] - rect[3])
    );
    if (d <= MATCH_TOL && d < bestD) {
      best = o;
      bestD = d;
    }
  }
  return best;
}
const firstTextIndex = (objects) => objects.find((o) => o.type === textEdit.FPDF_PAGEOBJ_TEXT)?.index;
function decodeImage(b64) {
  const img = electron.nativeImage.createFromBuffer(Buffer.from(b64, "base64"));
  if (img.isEmpty()) throw new Error("could not decode the image data");
  const { width, height } = img.getSize();
  const bgra = Buffer.from(img.toBitmap());
  for (let i = 0; i < bgra.length; i += 4) {
    const a = bgra[i + 3];
    if (a > 0 && a < 255) {
      bgra[i] = Math.min(255, Math.round(bgra[i] * 255 / a));
      bgra[i + 1] = Math.min(255, Math.round(bgra[i + 1] * 255 / a));
      bgra[i + 2] = Math.min(255, Math.round(bgra[i + 2] * 255 / a));
    }
  }
  return { width, height, bgra };
}
function imageMatrix(rect, rotate) {
  const [x1, y1, x2, y2] = rect;
  const w = x2 - x1;
  const h = y2 - y1;
  switch ((rotate % 360 + 360) % 360) {
    case 90:
      return [0, h, -w, 0, x2, y1];
    case 180:
      return [-w, 0, 0, -h, x2, y2];
    case 270:
      return [0, -h, w, 0, x1, y2];
    default:
      return [w, 0, 0, h, x1, y1];
  }
}
function insertImage(m, doc, page, edit) {
  if (edit.kind !== "insertImage") return;
  const { width, height, bgra } = decodeImage(edit.image);
  const bufPtr = m._malloc(bgra.length);
  m.HEAPU8.set(bgra, bufPtr);
  const bmp = m._FPDFBitmap_CreateEx(width, height, FPDF_BITMAP_BGRA, bufPtr, width * 4);
  if (!bmp) {
    m._free(bufPtr);
    throw new Error("FPDFBitmap_CreateEx failed");
  }
  const imgObj = m._FPDFPageObj_NewImageObj(doc);
  const ok = imgObj && m._FPDFImageObj_SetBitmap(0, 0, imgObj, bmp);
  m._FPDFBitmap_Destroy(bmp);
  m._free(bufPtr);
  if (!ok) {
    if (imgObj) m._FPDFPageObj_Destroy(imgObj);
    throw new Error("FPDFImageObj_SetBitmap failed");
  }
  const matPtr = m._malloc(24);
  m.HEAPF32.set(imageMatrix(edit.rect, edit.rotate ?? 0), matPtr >> 2);
  m._FPDFPageObj_SetMatrix(imgObj, matPtr);
  m._free(matPtr);
  const textIdx = edit.layer === "belowText" ? firstTextIndex(collectObjects(m, page)) : void 0;
  if (textIdx !== void 0 && m._FPDFPage_InsertObjectAtIndex) {
    if (!m._FPDFPage_InsertObjectAtIndex(page, imgObj, textIdx)) {
      m._FPDFPageObj_Destroy(imgObj);
      throw new Error("FPDFPage_InsertObjectAtIndex failed");
    }
  } else {
    m._FPDFPage_InsertObject(page, imgObj);
  }
}
function moveToLayer(m, page, obj, layer) {
  if (!m._FPDFPage_RemoveObject(page, obj)) throw new Error("FPDFPage_RemoveObject failed");
  const textIdx = layer === "belowText" ? firstTextIndex(collectObjects(m, page)) : void 0;
  if (textIdx !== void 0 && m._FPDFPage_InsertObjectAtIndex) {
    if (!m._FPDFPage_InsertObjectAtIndex(page, obj, textIdx)) {
      m._FPDFPage_InsertObject(page, obj);
      throw new Error("FPDFPage_InsertObjectAtIndex failed");
    }
  } else {
    m._FPDFPage_InsertObject(page, obj);
  }
}
const QUARTER_TURN_MATS = [
  [1, 0, 0, 1],
  [0, -1, 1, 0],
  [-1, 0, 0, -1],
  [0, 1, -1, 0]
];
function applyImageGeometry(m, obj, bounds, rect, quarterTurns) {
  let [ox1, oy1, ox2, oy2] = bounds;
  const turns = ((quarterTurns ?? 0) % 4 + 4) % 4;
  if (turns) {
    const cx = (ox1 + ox2) / 2;
    const cy = (oy1 + oy2) / 2;
    const [a, b, c, d] = QUARTER_TURN_MATS[turns];
    m._FPDFPageObj_Transform(obj, a, b, c, d, cx - a * cx - c * cy, cy - b * cx - d * cy);
    if (turns % 2 === 1) {
      const w = ox2 - ox1;
      const h = oy2 - oy1;
      [ox1, oy1, ox2, oy2] = [cx - h / 2, cy - w / 2, cx + h / 2, cy + w / 2];
    }
  }
  const [nx1, ny1, nx2, ny2] = rect;
  const ow = ox2 - ox1;
  const oh = oy2 - oy1;
  if (ow > 1e-6 && oh > 1e-6 && (nx1 !== ox1 || ny1 !== oy1 || nx2 !== ox2 || ny2 !== oy2)) {
    const sx = (nx2 - nx1) / ow;
    const sy = (ny2 - ny1) / oh;
    m._FPDFPageObj_Transform(obj, sx, 0, 0, sy, nx1 - sx * ox1, ny1 - sy * oy1);
  }
}
function transformImage(m, page, edit) {
  if (edit.kind !== "transformImage") return;
  const target = matchImage(collectObjects(m, page), edit.oldRect);
  if (!target) throw new Error("the image could not be located on the page");
  if (edit.layer) moveToLayer(m, page, target.obj, edit.layer);
  applyImageGeometry(m, target.obj, target.bounds, edit.rect, edit.quarterTurns);
}
function replaceImage(m, page, edit) {
  if (edit.kind !== "replaceImage") return;
  const target = matchImage(collectObjects(m, page), edit.oldRect);
  if (!target) throw new Error("the image could not be located on the page");
  if (edit.layer) moveToLayer(m, page, target.obj, edit.layer);
  const { width, height, bgra } = decodeImage(edit.image);
  const bufPtr = m._malloc(bgra.length);
  m.HEAPU8.set(bgra, bufPtr);
  const bmp = m._FPDFBitmap_CreateEx(width, height, FPDF_BITMAP_BGRA, bufPtr, width * 4);
  if (!bmp) {
    m._free(bufPtr);
    throw new Error("FPDFBitmap_CreateEx failed");
  }
  const pagesPtr = m._malloc(4);
  m.HEAP32[pagesPtr >> 2] = page;
  const ok = m._FPDFImageObj_SetBitmap(pagesPtr, 1, target.obj, bmp);
  m._free(pagesPtr);
  m._FPDFBitmap_Destroy(bmp);
  m._free(bufPtr);
  if (!ok) throw new Error("FPDFImageObj_SetBitmap failed");
  applyImageGeometry(m, target.obj, target.bounds, edit.rect, edit.quarterTurns);
}
function deleteImage(m, page, edit) {
  if (edit.kind !== "deleteImage") return;
  const target = matchImage(collectObjects(m, page), edit.oldRect);
  if (!target) throw new Error("the image could not be located on the page");
  if (!m._FPDFPage_RemoveObject(page, target.obj)) throw new Error("FPDFPage_RemoveObject failed");
  m._FPDFPageObj_Destroy(target.obj);
}
function applyImageEdits(bytes, edits) {
  return textEdit.chainPdfium(async () => {
    const m = await textEdit.loadPdfium();
    const skipped = [];
    return textEdit.withDocument(m, bytes, async (doc) => {
      const pageCount = m._FPDF_GetPageCount(doc);
      const byPage = /* @__PURE__ */ new Map();
      for (const [editIndex, edit] of edits.entries()) {
        if (edit.pageIndex < 0 || edit.pageIndex >= pageCount) {
          skipped.push({ editIndex, pageIndex: edit.pageIndex, reason: "page does not exist" });
          continue;
        }
        byPage.set(edit.pageIndex, [...byPage.get(edit.pageIndex) ?? [], { edit, editIndex }]);
      }
      let appliedTotal = 0;
      for (const [pageIndex, pageEdits] of byPage) {
        const page = m._FPDF_LoadPage(doc, pageIndex);
        if (!page) throw new Error(`could not load page ${pageIndex + 1}`);
        try {
          let applied = 0;
          for (const { edit, editIndex } of pageEdits) {
            try {
              if (edit.kind === "insertImage") insertImage(m, doc, page, edit);
              else if (edit.kind === "transformImage") transformImage(m, page, edit);
              else if (edit.kind === "replaceImage") replaceImage(m, page, edit);
              else deleteImage(m, page, edit);
              applied++;
            } catch (err) {
              skipped.push({
                editIndex,
                pageIndex,
                reason: err instanceof Error ? err.message : String(err)
              });
            }
          }
          if (applied > 0 && !m._FPDFPage_GenerateContent(page)) {
            throw new Error(`could not regenerate page ${pageIndex + 1}`);
          }
          appliedTotal += applied;
        } finally {
          m._FPDF_ClosePage(page);
        }
      }
      return { bytes: appliedTotal > 0 ? textEdit.saveDoc(m, doc) : bytes, skipped };
    });
  });
}
function listPageImages(bytes) {
  return textEdit.chainPdfium(async () => {
    const m = await textEdit.loadPdfium();
    return textEdit.withDocument(m, bytes, async (doc) => {
      const out = [];
      const pageCount = m._FPDF_GetPageCount(doc);
      for (let pageIndex = 0; pageIndex < pageCount; pageIndex++) {
        const page = m._FPDF_LoadPage(doc, pageIndex);
        if (!page) continue;
        try {
          const objects = collectObjects(m, page);
          const textIdx = firstTextIndex(objects);
          for (const o of objects) {
            if (o.type !== FPDF_PAGEOBJ_IMAGE) continue;
            if (o.bounds[2] - o.bounds[0] < 3 || o.bounds[3] - o.bounds[1] < 3) continue;
            out.push({
              pageIndex,
              rect: o.bounds,
              aboveText: textIdx !== void 0 && o.index > textIdx
            });
          }
        } finally {
          m._FPDF_ClosePage(page);
        }
      }
      return out;
    });
  });
}
const RENDER_MAX_PX = 2400;
function renderImagePng(bytes, pageIndex, rect, scale = 1) {
  return textEdit.chainPdfium(async () => {
    const m = await textEdit.loadPdfium();
    return textEdit.withDocument(m, bytes, async (doc) => {
      const page = m._FPDF_LoadPage(doc, pageIndex);
      if (!page) return null;
      try {
        const target = matchImage(collectObjects(m, page), rect);
        if (!target) return null;
        const side = Math.max(
          target.bounds[2] - target.bounds[0],
          target.bounds[3] - target.bounds[1]
        );
        const k = Math.min(Math.max(1, scale), side > 0 ? RENDER_MAX_PX / side : 1);
        if (k > 1) m._FPDFPageObj_Transform(target.obj, k, 0, 0, k, 0, 0);
        const bmp = m._FPDFImageObj_GetRenderedBitmap(doc, page, target.obj);
        if (!bmp) return null;
        try {
          const w = m._FPDFBitmap_GetWidth(bmp);
          const h = m._FPDFBitmap_GetHeight(bmp);
          const stride = m._FPDFBitmap_GetStride(bmp);
          const buf = m._FPDFBitmap_GetBuffer(bmp);
          if (!w || !h || !buf) return null;
          const tight = Buffer.alloc(w * h * 4);
          for (let row = 0; row < h; row++) {
            tight.set(
              m.HEAPU8.subarray(buf + row * stride, buf + row * stride + w * 4),
              row * w * 4
            );
          }
          const png = electron.nativeImage.createFromBitmap(tight, { width: w, height: h }).toPNG();
          return png.toString("base64");
        } finally {
          m._FPDFBitmap_Destroy(bmp);
        }
      } finally {
        m._FPDF_ClosePage(page);
      }
    });
  });
}
function renderPagePreviewPng(bytes, request) {
  const { pageIndex, excludeRects, excludeAnnots, clip, pxWidth, rotate } = request;
  return textEdit.chainPdfium(async () => {
    const m = await textEdit.loadPdfium();
    return textEdit.withDocument(m, bytes, async (doc) => {
      const page = m._FPDF_LoadPage(doc, pageIndex);
      if (!page) return null;
      try {
        for (const rect of excludeRects) {
          const target = matchImage(collectObjects(m, page), rect);
          if (target && m._FPDFPage_RemoveObject(page, target.obj)) {
            m._FPDFPageObj_Destroy(target.obj);
          }
        }
        if (excludeAnnots && excludeAnnots.length > 0) {
          const { removeMatchingAnnots } = await Promise.resolve().then(() => require("./annot-delete-Bxof0ATb.js"));
          removeMatchingAnnots(m, page, excludeAnnots);
        }
        const baseW = m._FPDF_GetPageWidthF(page);
        const baseH = m._FPDF_GetPageHeightF(page);
        const turns = (rotate % 4 + 4) % 4;
        const dispW = turns % 2 === 1 ? baseH : baseW;
        const dispH = turns % 2 === 1 ? baseW : baseH;
        if (clip.width <= 0 || clip.height <= 0 || pxWidth <= 0) return null;
        const k = pxWidth / clip.width;
        const w = Math.max(1, Math.round(pxWidth));
        const h = Math.max(1, Math.round(clip.height * k));
        const bufPtr = m._malloc(w * h * 4);
        const bmp = m._FPDFBitmap_CreateEx(w, h, FPDF_BITMAP_BGRA, bufPtr, w * 4);
        if (!bmp) {
          m._free(bufPtr);
          return null;
        }
        try {
          m._FPDFBitmap_FillRect(bmp, 0, 0, w, h, 4294967295);
          const flags = excludeAnnots && excludeAnnots.length > 0 ? 1 : 0;
          m._FPDF_RenderPageBitmap(
            bmp,
            page,
            Math.round(-clip.x * k),
            Math.round(-clip.y * k),
            Math.round(dispW * k),
            Math.round(dispH * k),
            turns,
            flags
          );
          const tight = Buffer.from(m.HEAPU8.subarray(bufPtr, bufPtr + w * h * 4));
          const png = electron.nativeImage.createFromBitmap(tight, { width: w, height: h }).toPNG();
          return png.toString("base64");
        } finally {
          m._FPDFBitmap_Destroy(bmp);
          m._free(bufPtr);
        }
      } finally {
        m._FPDF_ClosePage(page);
      }
    });
  });
}
function verifyImageEdits(bytes, edits) {
  return textEdit.chainPdfium(async () => {
    const m = await textEdit.loadPdfium();
    return textEdit.withDocument(m, bytes, async (doc) => {
      const failures = [];
      const pageCount = m._FPDF_GetPageCount(doc);
      const byPage = /* @__PURE__ */ new Map();
      for (const e of edits) {
        if (e.pageIndex < 0 || e.pageIndex >= pageCount) {
          failures.push({ pageIndex: e.pageIndex, reason: "page missing from saved output" });
          continue;
        }
        byPage.set(e.pageIndex, [...byPage.get(e.pageIndex) ?? [], e.rect]);
      }
      for (const [pageIndex, rects] of byPage) {
        const page = m._FPDF_LoadPage(doc, pageIndex);
        if (!page) {
          for (const _ of rects)
            failures.push({ pageIndex, reason: "page unreadable in saved output" });
          continue;
        }
        try {
          const objects = collectObjects(m, page);
          for (const rect of rects) {
            if (!matchImage(objects, rect)) {
              failures.push({ pageIndex, reason: "image missing from saved output" });
            }
          }
        } finally {
          m._FPDF_ClosePage(page);
        }
      }
      return failures;
    });
  });
}
exports.applyImageEdits = applyImageEdits;
exports.listPageImages = listPageImages;
exports.renderImagePng = renderImagePng;
exports.renderPagePreviewPng = renderPagePreviewPng;
exports.verifyImageEdits = verifyImageEdits;
