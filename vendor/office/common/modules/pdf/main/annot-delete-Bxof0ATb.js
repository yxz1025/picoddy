"use strict";
Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
const textEdit = require("./text-edit-DdyYKw0w.js");
const SUBTYPE_CODE = {
  highlight: 9,
  underline: 10,
  strikeout: 12,
  note: 1
  // FPDF_ANNOT_TEXT (sticky-note comments)
};
const RECT_TOL = 2;
function annotRect(m, annot) {
  const ptr = m._malloc(16);
  try {
    if (!m._FPDFAnnot_GetRect(annot, ptr)) return null;
    const f = m.HEAPF32;
    return [f[ptr >> 2], f[(ptr >> 2) + 1], f[(ptr >> 2) + 2], f[(ptr >> 2) + 3]];
  } finally {
    m._free(ptr);
  }
}
const rectsClose = (a, b) => {
  const norm = (r) => [
    Math.min(r[0], r[2]),
    Math.min(r[1], r[3]),
    Math.max(r[0], r[2]),
    Math.max(r[1], r[3])
  ];
  const na = norm(a);
  const nb = norm(b);
  return Math.max(...na.map((v, i) => Math.abs(v - nb[i]))) <= RECT_TOL;
};
function annotContents(m, annot) {
  const keyBytes = Buffer.from("Contents\0", "ascii");
  const key = m._malloc(keyBytes.length);
  m.HEAPU8.set(keyBytes, key);
  try {
    const len = m._FPDFAnnot_GetStringValue(annot, key, 0, 0);
    if (len <= 2) return "";
    const buf = m._malloc(len);
    try {
      m._FPDFAnnot_GetStringValue(annot, key, buf, len);
      return Buffer.from(m.HEAPU8.buffer, buf, len - 2).toString("utf16le");
    } finally {
      m._free(buf);
    }
  } finally {
    m._free(key);
  }
}
const cornersClose = (a, b) => Math.abs(Math.min(a[0], a[2]) - Math.min(b[0], b[2])) <= RECT_TOL && Math.abs(Math.max(a[1], a[3]) - Math.max(b[1], b[3])) <= RECT_TOL;
function annotMatches(m, annot, d) {
  if (m._FPDFAnnot_GetSubtype(annot) !== SUBTYPE_CODE[d.subtype]) return false;
  const rect = annotRect(m, annot);
  if (!rect) return false;
  if (d.subtype === "note" ? !cornersClose(rect, d.rect) : !rectsClose(rect, d.rect)) return false;
  return d.contents === void 0 || annotContents(m, annot) === d.contents;
}
function removeByObjNum(m, page, d) {
  const annot = m._EPDFPage_GetAnnotByObjectNumber(page, d.objNum);
  if (!annot) return false;
  const ok = annotMatches(m, annot, d);
  m._FPDFPage_CloseAnnot(annot);
  return ok && !!m._EPDFPage_RemoveAnnotByObjectNumber(page, d.objNum);
}
function removeByMatch(m, page, d) {
  const count = m._FPDFPage_GetAnnotCount(page);
  for (let i = 0; i < count; i++) {
    const annot = m._FPDFPage_GetAnnot(page, i);
    if (!annot) continue;
    const ok = annotMatches(m, annot, d);
    m._FPDFPage_CloseAnnot(annot);
    if (ok) return !!m._FPDFPage_RemoveAnnot(page, i);
  }
  return false;
}
function applyAnnotDeletes(bytes, deletes) {
  return textEdit.chainPdfium(async () => {
    const m = await textEdit.loadPdfium();
    return textEdit.withDocument(m, bytes, async (doc) => {
      const pageCount = m._FPDF_GetPageCount(doc);
      const byPage = /* @__PURE__ */ new Map();
      for (const d of deletes) {
        if (d.pageIndex < 0 || d.pageIndex >= pageCount) continue;
        byPage.set(d.pageIndex, [...byPage.get(d.pageIndex) ?? [], d]);
      }
      let removed = 0;
      for (const [pageIndex, list] of byPage) {
        const page = m._FPDF_LoadPage(doc, pageIndex);
        if (!page) continue;
        try {
          for (const d of list) {
            if (removeByObjNum(m, page, d) || removeByMatch(m, page, d)) removed++;
          }
        } finally {
          m._FPDF_ClosePage(page);
        }
      }
      return removed > 0 ? textEdit.saveDoc(m, doc) : bytes;
    });
  });
}
function removeMatchingAnnots(m, page, deletes) {
  for (const d of deletes) {
    if (!removeByObjNum(m, page, d)) removeByMatch(m, page, d);
  }
}
exports.applyAnnotDeletes = applyAnnotDeletes;
exports.removeMatchingAnnots = removeMatchingAnnots;
