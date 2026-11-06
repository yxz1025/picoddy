"use strict";
Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
const node_fs = require("node:fs");
const index$1 = require("./index.js");
const node_os = require("node:os");
const node_path = require("node:path");
const node_module = require("node:module");
const u16 = (b, o) => b.readUInt16BE(o);
const u32 = (b, o) => b.readUInt32BE(o);
function tableOffset(font, tag) {
  const numTables = u16(font, 4);
  for (let i = 0; i < numTables; i++) {
    const rec = 12 + i * 16;
    if (font.toString("latin1", rec, rec + 4) === tag) return u32(font, rec + 8);
  }
  return -1;
}
function cmapSubtable$1(font) {
  const cmap = tableOffset(font, "cmap");
  if (cmap < 0) return null;
  const n = u16(font, cmap + 2);
  let best = null;
  for (let i = 0; i < n; i++) {
    const rec = cmap + 4 + i * 8;
    const platform = u16(font, rec);
    const encoding = u16(font, rec + 2);
    if (platform !== 0 && !(platform === 3 && (encoding === 1 || encoding === 10))) continue;
    const offset = cmap + u32(font, rec + 4);
    const format = u16(font, offset);
    if (format === 12) return { offset, format };
    if (format === 4 && !best) best = { offset, format };
  }
  return best;
}
function glyphId(font, sub, cp) {
  const o = sub.offset;
  if (sub.format === 12) {
    const groups = u32(font, o + 12);
    for (let i = 0; i < groups; i++) {
      const g = o + 16 + i * 12;
      if (cp < u32(font, g)) return 0;
      if (cp <= u32(font, g + 4)) return u32(font, g + 8) + (cp - u32(font, g));
    }
    return 0;
  }
  if (cp > 65535) return 0;
  const segX2 = u16(font, o + 6);
  const ends = o + 14;
  const starts = ends + segX2 + 2;
  const deltas = starts + segX2;
  const rangeOffs = deltas + segX2;
  for (let s = 0; s < segX2; s += 2) {
    if (cp > u16(font, ends + s)) continue;
    if (cp < u16(font, starts + s)) return 0;
    const ro = u16(font, rangeOffs + s);
    if (ro === 0) return cp + font.readInt16BE(deltas + s) & 65535;
    const gi = u16(font, rangeOffs + s + ro + (cp - u16(font, starts + s)) * 2);
    return gi === 0 ? 0 : gi + font.readInt16BE(deltas + s) & 65535;
  }
  return 0;
}
const hasGlyph = (font, sub, cp) => glyphId(font, sub, cp) !== 0;
function fontCoversText(font, text) {
  const chars = [...text.replace(/[\r\n]/g, "")];
  if (chars.length === 0) return true;
  try {
    const sub = cmapSubtable$1(font);
    return sub !== null && chars.every((c) => hasGlyph(font, sub, c.codePointAt(0)));
  } catch {
    return false;
  }
}
const norm$1 = (s) => s.normalize("NFKC").toLowerCase().replace(/[\s\-_]/g, "");
function fontDirs() {
  switch (process.platform) {
    case "darwin":
      return [
        "/System/Library/Fonts",
        "/System/Library/Fonts/Supplemental",
        "/Library/Fonts",
        node_path.join(node_os.homedir(), "Library/Fonts"),
        // On-demand system font assets: PingFang and other CJK faces live here on
        // recent macOS ( <hash>.asset/AssetData/*.ttc ), not under /System/Library/Fonts
        "/System/Library/AssetsV2/com_apple_MobileAsset_Font7",
        "/System/Library/AssetsV2/com_apple_MobileAsset_Font6"
      ];
    case "win32":
      return ["C:\\Windows\\Fonts", node_path.join(node_os.homedir(), "AppData/Local/Microsoft/Windows/Fonts")];
    default:
      return ["/usr/share/fonts", "/usr/local/share/fonts", node_path.join(node_os.homedir(), ".fonts")];
  }
}
const TTC_TAG = 1953784678;
const OTTO_TAG = 1330926671;
const SFNT_FLAVORS = /* @__PURE__ */ new Set([65536, 1953658213, OTTO_TAG]);
function readAt(fd, pos, len) {
  const buf = Buffer.alloc(len);
  if (node_fs.readSync(fd, buf, 0, len, pos) !== len) throw new Error("short read");
  return buf;
}
function parseNames(buf) {
  const out = { ps: [], families: [], subfamilies: [] };
  const count = buf.readUInt16BE(2);
  const strBase = buf.readUInt16BE(4);
  for (let i = 0; i < count; i++) {
    const r = 6 + 12 * i;
    if (r + 12 > buf.length) break;
    const platform = buf.readUInt16BE(r);
    const encoding = buf.readUInt16BE(r + 2);
    const nameId = buf.readUInt16BE(r + 6);
    const list = nameId === 6 ? out.ps : nameId === 1 || nameId === 16 ? out.families : nameId === 2 || nameId === 17 ? out.subfamilies : null;
    if (!list) continue;
    const len = buf.readUInt16BE(r + 8);
    const off = strBase + buf.readUInt16BE(r + 10);
    if (off + len > buf.length) continue;
    let s;
    if (platform === 0 || platform === 3) {
      s = Buffer.from(buf.subarray(off, off + len)).swap16().toString("utf16le");
    } else if (platform === 1 && encoding === 0) {
      s = buf.toString("latin1", off, off + len);
    } else {
      continue;
    }
    if (s && !list.includes(s)) list.push(s);
  }
  return out;
}
function readTableDir(fd, offset) {
  const head = readAt(fd, offset, 12);
  if (!SFNT_FLAVORS.has(head.readUInt32BE(0))) return null;
  const numTables = head.readUInt16BE(4);
  if (numTables === 0 || numTables > 64) return null;
  const dir = readAt(fd, offset + 12, 16 * numTables);
  const tables = /* @__PURE__ */ new Map();
  for (let t = 0; t < numTables; t++) {
    tables.set(dir.toString("latin1", 16 * t, 16 * t + 4), {
      off: dir.readUInt32BE(16 * t + 8),
      len: dir.readUInt32BE(16 * t + 12)
    });
  }
  return tables;
}
function readTable(fd, tables, tag, maxLen) {
  const entry = tables.get(tag);
  if (!entry || entry.len < 2 || entry.len > maxLen) return null;
  return readAt(fd, entry.off, entry.len);
}
function readFaceNames(fd, offset) {
  const tables = readTableDir(fd, offset);
  if (!tables) return null;
  const name = readTable(fd, tables, "name", 1 << 20);
  return name && name.length >= 6 ? parseNames(name) : null;
}
function* fontFiles(dir, depth) {
  let entries;
  try {
    entries = node_fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    const full = node_path.join(dir, e.name);
    let isDir = e.isDirectory();
    let isFile = e.isFile();
    if (e.isSymbolicLink()) {
      try {
        const st = node_fs.statSync(full);
        isDir = st.isDirectory();
        isFile = st.isFile();
      } catch {
        continue;
      }
    }
    if (isDir && depth > 0) yield* fontFiles(full, depth - 1);
    else if (isFile && /\.(ttf|otf|ttc|otc)$/i.test(e.name)) yield full;
  }
}
function faceOffsets(fd) {
  if (readAt(fd, 0, 4).readUInt32BE(0) !== TTC_TAG) return [0];
  const n = readAt(fd, 8, 4).readUInt32BE(0);
  if (n > 64) return [];
  const o = readAt(fd, 12, 4 * n);
  return Array.from({ length: n }, (_, i) => o.readUInt32BE(4 * i));
}
function indexFile(path, index2) {
  let fd;
  try {
    fd = node_fs.openSync(path, "r");
  } catch {
    return;
  }
  try {
    for (const offset of faceOffsets(fd)) {
      let names;
      try {
        names = readFaceNames(fd, offset);
      } catch {
        names = null;
      }
      if (!names) continue;
      const face = {
        path,
        offset,
        style: norm$1([...names.families, ...names.subfamilies].join(" "))
      };
      for (const p of names.ps) if (!index2.byPs.has(norm$1(p))) index2.byPs.set(norm$1(p), face);
      for (const f of names.families) {
        const k = norm$1(f);
        index2.byFamily.set(k, [...index2.byFamily.get(k) ?? [], face]);
      }
    }
  } catch {
  } finally {
    node_fs.closeSync(fd);
  }
}
let index = null;
function getFontIndex() {
  if (!index) {
    index = { byPs: /* @__PURE__ */ new Map(), byFamily: /* @__PURE__ */ new Map() };
    for (const dir of fontDirs()) for (const path of fontFiles(dir, 2)) indexFile(path, index);
  }
  return index;
}
const styleTokens = (ps) => (norm$1(ps).match(
  /semibold|extrabold|bold|italic|oblique|light|thin|medium|heavy|black|regular|w\d/g
) ?? []).map((t) => t === "oblique" ? "italic" : t);
const REGULARISH = ["regular", "medium", "w3", "w4"];
function styleScore(face, want) {
  const have = styleTokens(face.style);
  const wanted = want.length > 0 ? want : REGULARISH;
  const hits = want.filter((t) => have.includes(t)).length;
  const extras = have.filter((t) => !wanted.includes(t)).length;
  const regularBonus = want.length === 0 && have.some((t) => REGULARISH.includes(t)) ? 1 : 0;
  return hits * 4 - extras + regularBonus;
}
const isTruetype = (b) => b.length >= 4 && b.readUInt32BE(0) !== OTTO_TAG;
function extractFace(buf, offset) {
  if (buf.readUInt32BE(0) !== TTC_TAG) return buf;
  const numTables = buf.readUInt16BE(offset + 4);
  let total = 12 + 16 * numTables;
  const entries = [];
  for (let t = 0; t < numTables; t++) {
    const e = offset + 12 + 16 * t;
    const tLen = buf.readUInt32BE(e + 12);
    entries.push({ dirPos: e, tOff: buf.readUInt32BE(e + 8), tLen, newOff: total });
    total += tLen + 3 & -4;
  }
  const out = Buffer.alloc(total);
  buf.copy(out, 0, offset, offset + 12);
  for (let t = 0; t < numTables; t++) {
    const e = entries[t];
    buf.copy(out, 12 + 16 * t, e.dirPos, e.dirPos + 8);
    out.writeUInt32BE(e.newOff, 12 + 16 * t + 8);
    out.writeUInt32BE(e.tLen, 12 + 16 * t + 12);
    buf.copy(out, e.newOff, e.tOff, e.tOff + e.tLen);
  }
  return out;
}
const faceCache = /* @__PURE__ */ new Map();
function findSystemFont(psName, family) {
  const index2 = getFontIndex();
  let face = psName ? index2.byPs.get(norm$1(psName)) : void 0;
  if (!face && family) {
    const candidates = index2.byFamily.get(norm$1(family));
    if (candidates?.length) {
      const want = styleTokens(psName);
      face = [...candidates].sort((a, b) => styleScore(b, want) - styleScore(a, want))[0];
    }
  }
  return face ? faceBytes(face) : null;
}
function faceBytes(face) {
  const key = `${face.path}#${face.offset}`;
  let bytes = faceCache.get(key);
  if (!bytes) {
    try {
      bytes = extractFace(node_fs.readFileSync(face.path), face.offset);
    } catch {
      return null;
    }
    if (faceCache.size >= 4) faceCache.clear();
    faceCache.set(key, bytes);
  }
  return bytes;
}
function cmapSubtable(cmap) {
  const n = cmap.readUInt16BE(2);
  let best = null;
  for (let i = 0; i < n; i++) {
    const rec = 4 + i * 8;
    if (rec + 8 > cmap.length) break;
    const platform = cmap.readUInt16BE(rec);
    const encoding = cmap.readUInt16BE(rec + 2);
    if (platform !== 0 && !(platform === 3 && (encoding === 1 || encoding === 10))) continue;
    const off = cmap.readUInt32BE(rec + 4);
    if (off + 4 > cmap.length) continue;
    const format = cmap.readUInt16BE(off);
    if (format === 12) return { off, format };
    if (format === 4 && !best) best = { off, format };
  }
  return best;
}
function mapsCodepoint(cmap, sub, cp) {
  const o = sub.off;
  if (sub.format === 12) {
    const groups = cmap.readUInt32BE(o + 12);
    for (let i = 0; i < groups; i++) {
      const g = o + 16 + i * 12;
      if (g + 12 > cmap.length) return false;
      if (cp < cmap.readUInt32BE(g)) return false;
      if (cp <= cmap.readUInt32BE(g + 4))
        return cmap.readUInt32BE(g + 8) + (cp - cmap.readUInt32BE(g)) !== 0;
    }
    return false;
  }
  if (cp > 65535) return false;
  const segX2 = cmap.readUInt16BE(o + 6);
  const ends = o + 14;
  const starts = ends + segX2 + 2;
  const deltas = starts + segX2;
  const rangeOffs = deltas + segX2;
  for (let s = 0; s < segX2; s += 2) {
    if (cp > cmap.readUInt16BE(ends + s)) continue;
    if (cp < cmap.readUInt16BE(starts + s)) return false;
    const ro = cmap.readUInt16BE(rangeOffs + s);
    if (ro === 0) return (cp + cmap.readInt16BE(deltas + s) & 65535) !== 0;
    const gi = cmap.readUInt16BE(rangeOffs + s + ro + (cp - cmap.readUInt16BE(starts + s)) * 2);
    return gi !== 0 && (gi + cmap.readInt16BE(deltas + s) & 65535) !== 0;
  }
  return false;
}
const COLOR_FONT_TABLES = ["sbix", "COLR", "CBDT", "CBLC"];
function findFontCovering(text) {
  const cps = [...new Set([...text.replace(/[\r\n]/g, "")].map((c) => c.codePointAt(0)))];
  if (cps.length === 0) return null;
  const index2 = getFontIndex();
  const seen = /* @__PURE__ */ new Set();
  const faces = [];
  for (const face of [...index2.byPs.values(), ...[...index2.byFamily.values()].flat()]) {
    const key = `${face.path}#${face.offset}`;
    if (seen.has(key)) continue;
    seen.add(key);
    faces.push(face);
  }
  faces.sort((a, b) => styleScore(b, []) - styleScore(a, []));
  for (const face of faces) {
    let fd;
    try {
      fd = node_fs.openSync(face.path, "r");
    } catch {
      continue;
    }
    let covers = false;
    try {
      const tables = readTableDir(fd, face.offset);
      if (tables && (tables.has("glyf") || tables.has("CFF ")) && !COLOR_FONT_TABLES.some((t) => tables.has(t))) {
        const cmap = readTable(fd, tables, "cmap", 1 << 22);
        const sub = cmap ? cmapSubtable(cmap) : null;
        covers = sub !== null && cps.every((cp) => mapsCodepoint(cmap, sub, cp));
      }
    } catch {
      covers = false;
    } finally {
      node_fs.closeSync(fd);
    }
    if (!covers) continue;
    const bytes = faceBytes(face);
    if (bytes) return bytes;
  }
  return null;
}
const packagedPath = (fileName) => node_path.join(__dirname, "wasm", fileName);
const req = () => node_module.createRequire(require("url").pathToFileURL(__filename).href);
function pdfiumWasmPath() {
  try {
    return req().resolve("@embedpdf/pdfium/pdfium.wasm");
  } catch {
    return packagedPath("pdfium.wasm");
  }
}
function hbSubsetWasmPath() {
  const r = req();
  try {
    return r.resolve("harfbuzzjs/hb-subset.wasm");
  } catch {
  }
  try {
    const p = node_path.join(node_path.dirname(r.resolve("harfbuzzjs")), "harfbuzz-subset.wasm");
    if (node_fs.existsSync(p)) return p;
  } catch {
  }
  return packagedPath("hb-subset.wasm");
}
const HB_MEMORY_MODE_WRITABLE = 2;
const HB_SUBSET_SETS_LAYOUT_FEATURE_TAG = 6;
let hbPromise = null;
function loadHb() {
  hbPromise ??= (async () => {
    const wasmBytes = node_fs.readFileSync(hbSubsetWasmPath());
    const { instance } = await WebAssembly.instantiate(wasmBytes);
    return instance.exports;
  })();
  return hbPromise;
}
let chain = Promise.resolve();
function subsetTtf(font, text) {
  const run = chain.then(() => subsetTtfInner(font, text));
  chain = run.catch(() => void 0);
  return run;
}
function readCffIndex(b, p) {
  const count = b.readUInt16BE(p);
  if (count === 0) return { items: [], end: p + 2 };
  const offSize = b[p + 2];
  const readOff = (i) => b.readUIntBE(p + 3 + i * offSize, offSize);
  const dataStart = p + 3 + (count + 1) * offSize - 1;
  const items = [];
  for (let i = 0; i < count; i++) items.push([dataStart + readOff(i), dataStart + readOff(i + 1)]);
  return { items, end: dataStart + readOff(count) };
}
function parseCffDict(b, start, end) {
  const ops = /* @__PURE__ */ new Map();
  let operands = [];
  let i = start;
  while (i < end) {
    const b0 = b[i];
    if (b0 <= 21) {
      let op = b0;
      if (b0 === 12) op = 1200 + b[++i];
      ops.set(op, operands);
      operands = [];
      i++;
    } else if (b0 === 28) {
      operands.push(b.readInt16BE(i + 1));
      i += 3;
    } else if (b0 === 29) {
      operands.push(b.readInt32BE(i + 1));
      i += 5;
    } else if (b0 === 30) {
      i++;
      while (i < end && (b[i] & 15) !== 15 && b[i] >> 4 !== 15) i++;
      i++;
      operands.push(NaN);
    } else if (b0 >= 32 && b0 <= 246) {
      operands.push(b0 - 139);
      i++;
    } else if (b0 >= 247 && b0 <= 250) {
      operands.push((b0 - 247) * 256 + b[i + 1] + 108);
      i += 2;
    } else if (b0 >= 251 && b0 <= 254) {
      operands.push(-(b0 - 251) * 256 - b[i + 1] - 108);
      i += 2;
    } else {
      i++;
    }
  }
  return ops;
}
function identityCffCharset(font) {
  if (font.length < 12 || font.readUInt32BE(0) !== 1330926671) return font;
  const numTables = font.readUInt16BE(4);
  let cffOff = -1;
  for (let t = 0; t < numTables; t++) {
    if (font.toString("latin1", 12 + 16 * t, 12 + 16 * t + 4) === "CFF ") {
      cffOff = font.readUInt32BE(12 + 16 * t + 8);
      break;
    }
  }
  if (cffOff < 0) return font;
  const hdrSize = font[cffOff + 2];
  const nameIndex = readCffIndex(font, cffOff + hdrSize);
  const topIndex = readCffIndex(font, nameIndex.end);
  const top = topIndex.items[0];
  if (!top) throw new Error("CFF top DICT missing");
  const ops = parseCffDict(font, top[0], top[1]);
  if (!ops.has(1230)) return font;
  const charsetOff = ops.get(15)?.[0];
  const charStringsOff = ops.get(17)?.[0];
  if (charsetOff === void 0 || charsetOff <= 2 || charStringsOff === void 0)
    throw new Error("CID-keyed CFF without a custom charset");
  const nGlyphs = font.readUInt16BE(cffOff + charStringsOff);
  const cs = cffOff + charsetOff;
  const fmt = font[cs];
  let oldSize;
  if (fmt === 0) {
    oldSize = 1 + 2 * (nGlyphs - 1);
  } else if (fmt === 1 || fmt === 2) {
    const step = fmt === 1 ? 3 : 4;
    let covered = 1;
    let p = cs + 1;
    while (covered < nGlyphs) {
      covered += (fmt === 1 ? font[p + 2] : font.readUInt16BE(p + 2)) + 1;
      p += step;
    }
    oldSize = p - cs;
  } else {
    throw new Error(`unknown CFF charset format ${fmt}`);
  }
  const out = Buffer.from(font);
  if (nGlyphs >= 2 && oldSize >= 5) {
    out[cs] = 2;
    out.writeUInt16BE(1, cs + 1);
    out.writeUInt16BE(nGlyphs - 2, cs + 3);
  } else if (nGlyphs >= 2 && oldSize === 4 && nGlyphs - 2 <= 255) {
    out[cs] = 1;
    out.writeUInt16BE(1, cs + 1);
    out[cs + 3] = nGlyphs - 2;
  } else if (nGlyphs !== 1) {
    throw new Error("CFF charset too small for an in-place identity rewrite");
  }
  return out;
}
async function subsetTtfInner(font, text) {
  const hb = await loadHb();
  const input = hb.hb_subset_input_create_or_fail();
  if (!input) throw new Error("hb_subset_input_create_or_fail failed");
  const fontPtr = hb.malloc(font.byteLength);
  new Uint8Array(hb.memory.buffer).set(font, fontPtr);
  const blob = hb.hb_blob_create(fontPtr, font.byteLength, HB_MEMORY_MODE_WRITABLE, 0, 0);
  const face = hb.hb_face_create(blob, 0);
  hb.hb_blob_destroy(blob);
  let subset = 0;
  let result = 0;
  try {
    const features = hb.hb_subset_input_set(input, HB_SUBSET_SETS_LAYOUT_FEATURE_TAG);
    hb.hb_set_clear(features);
    hb.hb_set_invert(features);
    const unicodes = hb.hb_subset_input_unicode_set(input);
    for (const ch of text) hb.hb_set_add(unicodes, ch.codePointAt(0));
    subset = hb.hb_subset_or_fail(face, input);
    if (!subset) throw new Error("hb_subset_or_fail failed (corrupt font?)");
    result = hb.hb_face_reference_blob(subset);
    const len = hb.hb_blob_get_length(result);
    if (!len) throw new Error("hb-subset produced an empty font");
    const data = hb.hb_blob_get_data(result, 0);
    return Buffer.from(new Uint8Array(hb.memory.buffer).subarray(data, data + len));
  } finally {
    if (result) hb.hb_blob_destroy(result);
    if (subset) hb.hb_face_destroy(subset);
    hb.hb_face_destroy(face);
    hb.hb_subset_input_destroy(input);
    hb.free(fontPtr);
  }
}
const RADICAL_EQUIV = {
  "⺁": "厂",
  "⺂": "乛",
  "⺃": "乚",
  "⺄": "乙",
  "⺅": "亻",
  "⺆": "冂",
  "⺇": "𠘨",
  "⺈": "刀",
  "⺉": "刂",
  "⺊": "卜",
  "⺋": "㔾",
  "⺌": "小",
  "⺍": "小",
  "⺎": "兀",
  "⺏": "尣",
  "⺐": "尢",
  "⺑": "𡯂",
  "⺒": "巳",
  "⺓": "幺",
  "⺔": "彑",
  "⺕": "𫜹",
  "⺖": "忄",
  "⺗": "心",
  "⺘": "扌",
  "⺙": "攵",
  "⺛": "旡",
  "⺜": "日",
  "⺝": "月",
  "⺞": "歺",
  "⺟": "母",
  "⺠": "民",
  "⺡": "氵",
  "⺢": "氺",
  "⺣": "灬",
  "⺤": "爫",
  "⺥": "爫",
  "⺦": "丬",
  "⺧": "牛",
  "⺨": "犭",
  "⺩": "王",
  "⺪": "𤴔",
  "⺫": "目",
  "⺬": "示",
  "⺭": "礻",
  "⺮": "𥫗",
  "⺯": "糹",
  "⺰": "纟",
  "⺱": "罓",
  "⺲": "罒",
  "⺳": "㓁",
  "⺴": "冗",
  "⺵": "𦉫",
  "⺶": "羊",
  "⺷": "𦍌",
  "⺸": "𦍋",
  "⺹": "耂",
  "⺺": "肀",
  "⺻": "聿",
  "⺼": "肉",
  "⺽": "𦥑",
  "⺾": "艹",
  "⺿": "艹",
  "⻀": "艹",
  "⻁": "虎",
  "⻂": "衤",
  "⻃": "覀",
  "⻄": "西",
  "⻅": "见",
  "⻆": "角",
  "⻇": "𧢲",
  "⻈": "讠",
  "⻉": "贝",
  "⻊": "𧾷",
  "⻋": "车",
  "⻌": "辶",
  "⻍": "辶",
  "⻎": "辶",
  "⻏": "邑",
  "⻐": "钅",
  "⻑": "長",
  "⻒": "镸",
  "⻓": "长",
  "⻔": "门",
  "⻕": "𨸏",
  "⻖": "阝",
  "⻗": "雨",
  "⻘": "青",
  "⻙": "韦",
  "⻚": "页",
  "⻛": "风",
  "⻜": "飞",
  "⻝": "食",
  "⻞": "𩙿",
  "⻟": "飠",
  "⻠": "饣",
  "⻡": "𩠐",
  "⻢": "马",
  "⻣": "骨",
  "⻤": "鬼",
  "⻥": "鱼",
  "⻦": "鸟",
  "⻧": "卤",
  "⻨": "麦",
  "⻩": "黄",
  "⻪": "黾",
  "⻫": "斉",
  "⻬": "齐",
  "⻭": "歯",
  "⻮": "齿",
  "⻯": "竜",
  "⻰": "龙",
  "⻱": "龜",
  "⻲": "亀",
  "⻳": "龟",
  "⼀": "一",
  "⼁": "丨",
  "⼂": "丶",
  "⼃": "丿",
  "⼄": "乙",
  "⼅": "亅",
  "⼆": "二",
  "⼇": "亠",
  "⼈": "人",
  "⼉": "儿",
  "⼊": "入",
  "⼋": "八",
  "⼌": "冂",
  "⼍": "冖",
  "⼎": "冫",
  "⼏": "几",
  "⼐": "凵",
  "⼑": "刀",
  "⼒": "力",
  "⼓": "勹",
  "⼔": "匕",
  "⼕": "匚",
  "⼖": "匸",
  "⼗": "十",
  "⼘": "卜",
  "⼙": "卩",
  "⼚": "厂",
  "⼛": "厶",
  "⼜": "又",
  "⼝": "口",
  "⼞": "囗",
  "⼟": "土",
  "⼠": "士",
  "⼡": "夂",
  "⼢": "夊",
  "⼣": "夕",
  "⼤": "大",
  "⼥": "女",
  "⼦": "子",
  "⼧": "宀",
  "⼨": "寸",
  "⼩": "小",
  "⼪": "尢",
  "⼫": "尸",
  "⼬": "屮",
  "⼭": "山",
  "⼮": "巛",
  "⼯": "工",
  "⼰": "己",
  "⼱": "巾",
  "⼲": "干",
  "⼳": "幺",
  "⼴": "广",
  "⼵": "廴",
  "⼶": "廾",
  "⼷": "弋",
  "⼸": "弓",
  "⼹": "彐",
  "⼺": "彡",
  "⼻": "彳",
  "⼼": "心",
  "⼽": "戈",
  "⼾": "戶",
  "⼿": "手",
  "⽀": "支",
  "⽁": "攴",
  "⽂": "文",
  "⽃": "斗",
  "⽄": "斤",
  "⽅": "方",
  "⽆": "无",
  "⽇": "日",
  "⽈": "曰",
  "⽉": "月",
  "⽊": "木",
  "⽋": "欠",
  "⽌": "止",
  "⽍": "歹",
  "⽎": "殳",
  "⽏": "毋",
  "⽐": "比",
  "⽑": "毛",
  "⽒": "氏",
  "⽓": "气",
  "⽔": "水",
  "⽕": "火",
  "⽖": "爪",
  "⽗": "父",
  "⽘": "爻",
  "⽙": "爿",
  "⽚": "片",
  "⽛": "牙",
  "⽜": "牛",
  "⽝": "犬",
  "⽞": "玄",
  "⽟": "玉",
  "⽠": "瓜",
  "⽡": "瓦",
  "⽢": "甘",
  "⽣": "生",
  "⽤": "用",
  "⽥": "田",
  "⽦": "疋",
  "⽧": "疒",
  "⽨": "癶",
  "⽩": "白",
  "⽪": "皮",
  "⽫": "皿",
  "⽬": "目",
  "⽭": "矛",
  "⽮": "矢",
  "⽯": "石",
  "⽰": "示",
  "⽱": "禸",
  "⽲": "禾",
  "⽳": "穴",
  "⽴": "立",
  "⽵": "竹",
  "⽶": "米",
  "⽷": "糸",
  "⽸": "缶",
  "⽹": "网",
  "⽺": "羊",
  "⽻": "羽",
  "⽼": "老",
  "⽽": "而",
  "⽾": "耒",
  "⽿": "耳",
  "⾀": "聿",
  "⾁": "肉",
  "⾂": "臣",
  "⾃": "自",
  "⾄": "至",
  "⾅": "臼",
  "⾆": "舌",
  "⾇": "舛",
  "⾈": "舟",
  "⾉": "艮",
  "⾊": "色",
  "⾋": "艸",
  "⾌": "虍",
  "⾍": "虫",
  "⾎": "血",
  "⾏": "行",
  "⾐": "衣",
  "⾑": "襾",
  "⾒": "見",
  "⾓": "角",
  "⾔": "言",
  "⾕": "谷",
  "⾖": "豆",
  "⾗": "豕",
  "⾘": "豸",
  "⾙": "貝",
  "⾚": "赤",
  "⾛": "走",
  "⾜": "足",
  "⾝": "身",
  "⾞": "車",
  "⾟": "辛",
  "⾠": "辰",
  "⾡": "辵",
  "⾢": "邑",
  "⾣": "酉",
  "⾤": "釆",
  "⾥": "里",
  "⾦": "金",
  "⾧": "長",
  "⾨": "門",
  "⾩": "阜",
  "⾪": "隶",
  "⾫": "隹",
  "⾬": "雨",
  "⾭": "靑",
  "⾮": "非",
  "⾯": "面",
  "⾰": "革",
  "⾱": "韋",
  "⾲": "韭",
  "⾳": "音",
  "⾴": "頁",
  "⾵": "風",
  "⾶": "飛",
  "⾷": "食",
  "⾸": "首",
  "⾹": "香",
  "⾺": "馬",
  "⾻": "骨",
  "⾼": "高",
  "⾽": "髟",
  "⾾": "鬥",
  "⾿": "鬯",
  "⿀": "鬲",
  "⿁": "鬼",
  "⿂": "魚",
  "⿃": "鳥",
  "⿄": "鹵",
  "⿅": "鹿",
  "⿆": "麥",
  "⿇": "麻",
  "⿈": "黃",
  "⿉": "黍",
  "⿊": "黑",
  "⿋": "黹",
  "⿌": "黽",
  "⿍": "鼎",
  "⿎": "鼓",
  "⿏": "鼠",
  "⿐": "鼻",
  "⿑": "齊",
  "⿒": "齒",
  "⿓": "龍",
  "⿔": "龜",
  "⿕": "龠",
  "㇆": "𠃌",
  "㇏": "乀",
  "㇐": "一",
  "㇑": "丨",
  "㇒": "丿",
  "㇓": "丿",
  "㇔": "丶",
  "㇕": "𠃍",
  "㇖": "乛",
  "㇗": "𠃊",
  "㇘": "𠃎",
  "㇙": "𠄌",
  "㇚": "亅",
  "㇛": "𡿨",
  "㇜": "𠃋",
  "㇝": "乀",
  "㇞": "𠃑",
  "㇟": "乚",
  "㇠": "乙",
  "㇡": "𠄎"
};
const RADICAL_RE = /[\u2e80-\u2fdf\u31c0-\u31e3]/;
function foldRadicals(s) {
  return RADICAL_RE.test(s) ? s.replace(/[\u2e80-\u2fdf\u31c0-\u31e3]/g, (ch) => RADICAL_EQUIV[ch] ?? ch) : s;
}
function chainLayers(extents, tieMargin = 0) {
  const assign = [];
  const tails = [];
  for (const r of extents) {
    const allowed = [];
    for (let c = 0; c < tails.length; c++) {
      const t = tails[c];
      const overlap = Math.min(t.right, r.right) - Math.max(t.left, r.left);
      if (overlap > 0.3 * Math.min(t.right - t.left, r.right - r.left)) continue;
      allowed.push({ chain: c, gap: Math.abs(r.left - t.right), size: t.size });
    }
    allowed.sort((a, b) => a.gap - b.gap);
    let pick = allowed[0];
    for (const a of allowed.slice(1)) {
      if (a.gap - allowed[0].gap > tieMargin) break;
      if (a.size > pick.size) pick = a;
    }
    if (!pick) {
      tails.push({ left: r.left, right: r.right, size: 1 });
      assign.push(tails.length - 1);
    } else {
      const t = tails[pick.chain];
      tails[pick.chain] = { left: r.left, right: r.right, size: t.size + 1 };
      assign.push(pick.chain);
    }
  }
  return assign;
}
const FPDF_PAGEOBJ_TEXT = 1;
const FPDF_FONT_TYPE1 = 1;
const FPDF_FONT_TRUETYPE = 2;
let pdfiumPromise = null;
function loadPdfium() {
  pdfiumPromise ??= (async () => {
    const { init } = await Promise.resolve().then(() => require("./index-MbjUHvFF.js"));
    const raw = node_fs.readFileSync(pdfiumWasmPath());
    const wasmBinary = raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength);
    const wrapped = await init({ wasmBinary, thisProgram: "genoffice-pdf" });
    const m = "pdfium" in wrapped ? wrapped.pdfium : wrapped;
    m._PDFiumExt_Init();
    return m;
  })();
  return pdfiumPromise;
}
const FALLBACK_FONT_PATHS = [
  "/System/Library/Fonts/Supplemental/Arial Unicode.ttf",
  "C:\\Windows\\Fonts\\arialuni.ttf",
  "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"
];
const FALLBACK_SYSTEM_FACES = [
  ["ArialMT", "Arial"],
  ["SegoeUI", "Segoe UI"],
  ["Helvetica", "Helvetica"],
  ["MicrosoftYaHei", "Microsoft YaHei"],
  ["SimSun", "SimSun"],
  ["PingFangSC-Regular", "PingFang SC"],
  ["HiraginoSans-W3", "Hiragino Sans"],
  ["YuGothic-Regular", "Yu Gothic"],
  ["MSGothic", "MS Gothic"],
  ["MalgunGothic", "Malgun Gothic"],
  ["AppleSDGothicNeo-Regular", "Apple SD Gothic Neo"],
  ["NotoSansCJKsc-Regular", "Noto Sans CJK SC"],
  ["DejaVuSans", "DejaVu Sans"],
  ["LiberationSans-Regular", "Liberation Sans"]
];
const fallbackPathCache = /* @__PURE__ */ new Map();
function readFallbackPath(p) {
  let bytes = fallbackPathCache.get(p);
  if (bytes === void 0) {
    try {
      bytes = node_fs.readFileSync(p);
    } catch {
      bytes = null;
    }
    fallbackPathCache.set(p, bytes);
  }
  return bytes;
}
function fallbackFontFor(drawn) {
  for (const p of FALLBACK_FONT_PATHS) {
    const bytes = readFallbackPath(p);
    if (bytes && fontCoversText(bytes, drawn)) return bytes;
  }
  for (const [ps, family] of FALLBACK_SYSTEM_FACES) {
    const bytes = findSystemFont(ps, family);
    if (bytes && fontCoversText(bytes, drawn)) return bytes;
  }
  return findFontCovering(drawn);
}
const EDIT_FONT_PATHS = {
  arial: {
    regular: [
      "/System/Library/Fonts/Supplemental/Arial.ttf",
      "C:\\Windows\\Fonts\\arial.ttf",
      "/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf"
    ],
    bold: [
      "/System/Library/Fonts/Supplemental/Arial Bold.ttf",
      "C:\\Windows\\Fonts\\arialbd.ttf",
      "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf"
    ],
    italic: [
      "/System/Library/Fonts/Supplemental/Arial Italic.ttf",
      "C:\\Windows\\Fonts\\ariali.ttf",
      "/usr/share/fonts/truetype/liberation/LiberationSans-Italic.ttf"
    ],
    bolditalic: [
      "/System/Library/Fonts/Supplemental/Arial Bold Italic.ttf",
      "C:\\Windows\\Fonts\\arialbi.ttf",
      "/usr/share/fonts/truetype/liberation/LiberationSans-BoldItalic.ttf"
    ]
  },
  times: {
    regular: [
      "/System/Library/Fonts/Supplemental/Times New Roman.ttf",
      "C:\\Windows\\Fonts\\times.ttf",
      "/usr/share/fonts/truetype/liberation/LiberationSerif-Regular.ttf"
    ],
    bold: [
      "/System/Library/Fonts/Supplemental/Times New Roman Bold.ttf",
      "C:\\Windows\\Fonts\\timesbd.ttf",
      "/usr/share/fonts/truetype/liberation/LiberationSerif-Bold.ttf"
    ],
    italic: [
      "/System/Library/Fonts/Supplemental/Times New Roman Italic.ttf",
      "C:\\Windows\\Fonts\\timesi.ttf",
      "/usr/share/fonts/truetype/liberation/LiberationSerif-Italic.ttf"
    ],
    bolditalic: [
      "/System/Library/Fonts/Supplemental/Times New Roman Bold Italic.ttf",
      "C:\\Windows\\Fonts\\timesbi.ttf",
      "/usr/share/fonts/truetype/liberation/LiberationSerif-BoldItalic.ttf"
    ]
  },
  courier: {
    regular: [
      "/System/Library/Fonts/Supplemental/Courier New.ttf",
      "C:\\Windows\\Fonts\\cour.ttf",
      "/usr/share/fonts/truetype/liberation/LiberationMono-Regular.ttf"
    ],
    bold: [
      "/System/Library/Fonts/Supplemental/Courier New Bold.ttf",
      "C:\\Windows\\Fonts\\courbd.ttf",
      "/usr/share/fonts/truetype/liberation/LiberationMono-Bold.ttf"
    ],
    italic: [
      "/System/Library/Fonts/Supplemental/Courier New Italic.ttf",
      "C:\\Windows\\Fonts\\couri.ttf",
      "/usr/share/fonts/truetype/liberation/LiberationMono-Italic.ttf"
    ],
    bolditalic: [
      "/System/Library/Fonts/Supplemental/Courier New Bold Italic.ttf",
      "C:\\Windows\\Fonts\\courbi.ttf",
      "/usr/share/fonts/truetype/liberation/LiberationMono-BoldItalic.ttf"
    ]
  }
};
const editFontCache = /* @__PURE__ */ new Map();
function loadEditFont(id, style = "regular") {
  const key = `${id}#${style}`;
  let cached = editFontCache.get(key);
  if (cached === void 0) {
    cached = null;
    for (const p of EDIT_FONT_PATHS[id]?.[style] ?? []) {
      try {
        cached = node_fs.readFileSync(p);
        break;
      } catch {
      }
    }
    editFontCache.set(key, cached);
  }
  return cached;
}
function listEditFonts() {
  return Object.keys(EDIT_FONT_PATHS).filter((id) => loadEditFont(id) !== null);
}
function canDrawText(text, font, bold = false, italic = false) {
  const drawn = text.replace(/\n/g, "");
  if (font) {
    const style = bold && italic ? "bolditalic" : bold ? "bold" : italic ? "italic" : "regular";
    for (const s of style === "regular" ? ["regular"] : [style, "regular"]) {
      const bytes = loadEditFont(font, s);
      if (bytes && fontCoversText(bytes, drawn)) return true;
    }
  }
  return fallbackFontFor(drawn) !== null;
}
const norm = (s) => foldRadicals(s).normalize("NFKC").replace(/\s+/g, "");
function foldMap(raw, keepSpaces = false) {
  const units = [];
  const idx = [];
  const end = [];
  let i = 0;
  let inWs = false;
  for (const ch of raw) {
    if (/\s/.test(ch)) {
      if (keepSpaces && !inWs) {
        units.push(" ");
        idx.push(i);
        end.push(i + ch.length);
      }
      inWs = true;
    } else {
      inWs = false;
      for (const u of foldRadicals(ch).normalize("NFKC")) {
        if (/\s/.test(u)) continue;
        units.push(u);
        idx.push(i);
        end.push(i + ch.length);
      }
    }
    i += ch.length;
  }
  idx.push(raw.length);
  return { units, idx, end };
}
function spliceIntoEngine(engineRaw, oldText, newText) {
  const oldK = foldMap(oldText, true);
  const newK = foldMap(newText, true);
  const eng = foldMap(engineRaw);
  let p = 0;
  const maxP = Math.min(oldK.units.length, newK.units.length);
  while (p < maxP && oldK.units[p] === newK.units[p]) p++;
  let s = 0;
  const maxS = maxP - p;
  while (s < maxS && oldK.units[oldK.units.length - 1 - s] === newK.units[newK.units.length - 1 - s])
    s++;
  if (newText.includes("\n")) return spliceLines(engineRaw, eng, newK, p, s, newText);
  const nonSpace = (units) => units.filter((u) => u !== " ").length;
  for (; ; ) {
    const np = nonSpace(oldK.units.slice(0, p));
    const ns = nonSpace(oldK.units.slice(oldK.units.length - s));
    const splitsEng = np > 0 && eng.idx[np] === eng.idx[np - 1] || ns > 0 && eng.idx[eng.units.length - ns] === eng.idx[eng.units.length - ns - 1];
    const splitsNew = p > 0 && newK.idx[p] === newK.idx[p - 1] || s > 0 && newK.idx[newK.units.length - s] === newK.idx[newK.units.length - s - 1];
    if (!splitsEng && !splitsNew) {
      const prefixEndsSpace = p > 0 && oldK.units[p - 1] === " ";
      const suffixStartsSpace = s > 0 && oldK.units[oldK.units.length - s] === " ";
      const engPrefixEnd = p === 0 ? 0 : prefixEndsSpace ? eng.idx[np] : eng.end[np - 1];
      const engSuffixStart = s === 0 ? engineRaw.length : suffixStartsSpace || ns === 0 ? eng.end[eng.units.length - ns - 1] : eng.idx[eng.units.length - ns];
      return engineRaw.slice(0, engPrefixEnd) + newText.slice(newK.idx[p], newK.idx[newK.units.length - s]) + engineRaw.slice(engSuffixStart);
    }
    if (p > 0) p--;
    else if (s > 0) s--;
    else return newText;
  }
}
function spliceLines(engineRaw, eng, newK, p, s, newText) {
  const E = eng.units.length;
  const nsPos = [];
  for (let k2 = 0; k2 < newK.units.length; k2++) if (newK.units[k2] !== " ") nsPos.push(k2);
  const N = nsPos.length;
  const out = [];
  let k = 0;
  let rank = 0;
  let off = 0;
  for (const line of newText.split("\n")) {
    const lineEnd = off + line.length;
    while (k < newK.units.length && newK.idx[k] < off) {
      if (newK.units[k] !== " ") rank++;
      k++;
    }
    const kStart = k;
    const g1 = rank;
    while (k < newK.units.length && newK.idx[k] < lineEnd) {
      if (newK.units[k] !== " ") rank++;
      k++;
    }
    const g2 = rank;
    off = lineEnd + 1;
    const inPrefix = k <= p;
    const inSuffix = kStart >= newK.units.length - s;
    if (g2 === g1 || !inPrefix && !inSuffix) {
      out.push(line);
      continue;
    }
    const shift = inPrefix ? 0 : E - N;
    out.push(engineLineText(engineRaw, eng, nsPos, g1 + shift, g2 + shift, g1) ?? line);
  }
  return out.join("\n");
}
function engineLineText(engineRaw, eng, nsPos, e1, e2, g1) {
  if (e1 > 0 && eng.idx[e1] < eng.end[e1 - 1]) return null;
  if (e2 < eng.units.length && eng.idx[e2] < eng.end[e2 - 1]) return null;
  let out = "";
  for (let e = e1; e < e2; e++) {
    if (e > e1) {
      if (eng.idx[e] < eng.end[e - 1]) continue;
      const gap = engineRaw.slice(eng.end[e - 1], eng.idx[e]);
      out += gap;
      const g = g1 + (e - e1);
      if (!/\s/.test(gap) && nsPos[g] - nsPos[g - 1] > 1) out += " ";
    }
    out += engineRaw.slice(eng.idx[e], eng.end[e]);
  }
  return out;
}
function mergeEngineCodepoints(engineRaw, oldText, newText) {
  const oldU = foldMap(oldText);
  const newU = foldMap(newText);
  const eng = foldMap(engineRaw);
  if (eng.units.length !== oldU.units.length) return newText;
  let p = 0;
  const maxP = Math.min(oldU.units.length, newU.units.length);
  while (p < maxP && oldU.units[p] === newU.units[p]) p++;
  let s = 0;
  const maxS = maxP - p;
  while (s < maxS && oldU.units[oldU.units.length - 1 - s] === newU.units[newU.units.length - 1 - s])
    s++;
  const splits = (fm, i) => i > 0 && i < fm.units.length && fm.idx[i] < fm.end[i - 1];
  while (p > 0 && (splits(eng, p) || splits(newU, p))) p--;
  while (s > 0 && (splits(eng, eng.units.length - s) || splits(newU, newU.units.length - s))) s--;
  const total = newU.units.length;
  const engShift = eng.units.length - total;
  let out = "";
  let k = 0;
  let engEnd = 0;
  for (const ch of newText) {
    if (/\s/.test(ch)) {
      out += ch;
      continue;
    }
    const m = [...ch.normalize("NFKC")].filter((u) => !/\s/.test(u)).length;
    if (m === 0) {
      out += ch;
      continue;
    }
    const inPrefix = k + m <= p;
    const inSuffix = k >= total - s;
    if (inPrefix || inSuffix) {
      const at = inPrefix ? k : k + engShift;
      const rawStart = eng.idx[at];
      const rawEnd = eng.end[at + m - 1];
      out += engineRaw.slice(Math.max(rawStart, engEnd), rawEnd);
      engEnd = Math.max(engEnd, rawEnd);
    } else {
      out += ch;
    }
    k += m;
  }
  return out;
}
function collectTextObjects(m, page, textPage) {
  const out = [];
  const bl = m._malloc(4);
  const bb = m._malloc(4);
  const br = m._malloc(4);
  const bt = m._malloc(4);
  const count = m._FPDFPage_CountObjects(page);
  for (let i = 0; i < count; i++) {
    const obj = m._FPDFPage_GetObject(page, i);
    if (m._FPDFPageObj_GetType(obj) !== FPDF_PAGEOBJ_TEXT) continue;
    const len = m._FPDFTextObj_GetText(obj, textPage, 0, 0);
    let text = "";
    if (len > 2) {
      const buf = m._malloc(len);
      m._FPDFTextObj_GetText(obj, textPage, buf, len);
      text = Buffer.from(m.HEAPU8.buffer, buf, len - 2).toString("utf16le");
      m._free(buf);
    }
    if (!m._FPDFPageObj_GetBounds(obj, bl, bb, br, bt)) continue;
    out.push({
      obj,
      index: i,
      text,
      font: m._FPDFTextObj_GetFont(obj),
      bounds: [m.HEAPF32[bl >> 2], m.HEAPF32[bb >> 2], m.HEAPF32[br >> 2], m.HEAPF32[bt >> 2]]
    });
  }
  for (const p of [bl, bb, br, bt]) m._free(p);
  return out;
}
function overlapArea(a, b) {
  const w = Math.min(a[2], b[2]) - Math.max(a[0], b[0]);
  const h = Math.min(a[3], b[3]) - Math.max(a[1], b[1]);
  return w > 0 && h > 0 ? w * h : 0;
}
const overlapRatio = (o, r) => overlapArea(o, r) / Math.max((o[2] - o[0]) * (o[3] - o[1]), 1e-6);
const rectCoverage = (o, r) => overlapArea(o, r) / Math.max((r[2] - r[0]) * (r[3] - r[1]), 1e-6);
function utf16Ptr(m, str) {
  const bytes = Buffer.from(`${str}\0`, "utf16le");
  const p = m._malloc(bytes.length);
  m.HEAPU8.set(bytes, p);
  return p;
}
function canReuseFont(edit, newText, matches, all) {
  if (matches.length !== 1) return false;
  if (edit.newFontSize !== void 0 || edit.newColor !== void 0 || edit.newFont !== void 0)
    return false;
  const runs = editStyleRuns(edit);
  if (runs && runs.length > 0) return false;
  if (edit.lineXOffsets !== void 0) return false;
  if (edit.newBold || edit.newItalic) return false;
  if (!/^[\x20-\x7e]*$/.test(newText)) return false;
  const font = matches[0].font;
  const charset = /* @__PURE__ */ new Set();
  for (const o of all) if (o.font === font) for (const ch of o.text) charset.add(ch);
  return [...newText].every((ch) => ch === " " || charset.has(ch));
}
function xLayers(objs) {
  const sorted = [...objs].sort((a, b) => a.bounds[0] - b.bounds[0]);
  const heights = sorted.map((o) => o.bounds[3] - o.bounds[1]).sort((a, b) => a - b);
  const tieMargin = (heights[heights.length >> 1] ?? 0) * 0.5;
  const assign = chainLayers(
    sorted.map((o) => ({ left: o.bounds[0], right: o.bounds[2] })),
    tieMargin
  );
  const layers = [];
  sorted.forEach((o, i) => {
    (layers[assign[i]] ??= []).push(o);
  });
  return layers;
}
function indexOfUnits(hay, needle) {
  if (needle.length === 0) return -1;
  outer: for (let i = 0; i + needle.length <= hay.length; i++) {
    for (let j = 0; j < needle.length; j++) if (hay[i + j] !== needle[j]) continue outer;
    return i;
  }
  return -1;
}
const joinX = (objs) => [...objs].sort((a, b) => a.bounds[0] - b.bounds[0]).map((o) => o.text).join("");
function readingOrder(objs) {
  const sorted = [...objs].sort((a, b) => b.bounds[3] - a.bounds[3]);
  const rows = [];
  for (const o of sorted) {
    const row = rows[rows.length - 1];
    const first = row?.[0];
    const overlap = first ? Math.min(first.bounds[3], o.bounds[3]) - Math.max(first.bounds[1], o.bounds[1]) : 0;
    if (first && overlap >= 0.5 * Math.min(first.bounds[3] - first.bounds[1], o.bounds[3] - o.bounds[1])) {
      row.push(o);
    } else rows.push([o]);
  }
  return rows.flatMap((row) => [...row].sort((a, b) => a.bounds[0] - b.bounds[0]));
}
const joinRows = (objs) => readingOrder(objs).map((o) => o.text).join("");
function matchByText(objects, edit) {
  const target = foldMap(edit.oldText);
  if (target.units.length === 0) return null;
  const pad = Math.max(2, edit.fontSize * 0.2);
  const r = [edit.rect[0] - pad, edit.rect[1] - pad, edit.rect[2] + pad, edit.rect[3] + pad];
  const touching = readingOrder(objects.filter((o) => overlapArea(o.bounds, r) > 0));
  if (touching.length === 0) return null;
  const joined = touching.map((o) => o.text).join("");
  const eng = foldMap(joined);
  const objAt = [];
  const rawStartOf = [];
  const rawEndOf = [];
  let rawOff = 0;
  for (const [i, o] of touching.entries()) {
    rawStartOf.push(rawOff);
    rawOff += o.text.length;
    rawEndOf.push(rawOff);
    for (let k = foldMap(o.text).units.length; k > 0; k--) objAt.push(i);
  }
  let best = null;
  let at = indexOfUnits(eng.units, target.units);
  while (at >= 0) {
    const endU2 = at + target.units.length - 1;
    const set2 = touching.slice(objAt[at], objAt[endU2] + 1);
    const b = matchBounds(set2);
    const score = overlapArea(b, edit.rect) / Math.max((b[2] - b[0]) * (b[3] - b[1]), 1e-6);
    if (score > 0 && (!best || score > best.score)) best = { at, score };
    const next = indexOfUnits(eng.units.slice(at + 1), target.units);
    at = next < 0 ? -1 : at + 1 + next;
  }
  if (!best) return null;
  const endU = best.at + target.units.length - 1;
  const set = touching.slice(objAt[best.at], objAt[endU] + 1);
  const setStart = rawStartOf[objAt[best.at]];
  const setEnd = rawEndOf[objAt[endU]];
  const setRaw = joined.slice(setStart, setEnd);
  const rawStart = eng.idx[best.at];
  const rawEnd = eng.end[endU];
  const whole = norm(setRaw) === norm(edit.oldText);
  if (whole) {
    return {
      matches: set,
      newText: edit.newText === "" ? "" : edit.lineLeading !== void 0 ? mergeEngineCodepoints(setRaw, edit.oldText, edit.newText) : spliceIntoEngine(setRaw, edit.oldText, edit.newText),
      whole: true
    };
  }
  if (edit.origin !== void 0 || edit.lineLeading !== void 0) return null;
  const fragment = spliceIntoEngine(joined.slice(rawStart, rawEnd), edit.oldText, edit.newText);
  return {
    matches: set,
    newText: joined.slice(setStart, rawStart) + fragment + joined.slice(rawEnd, setEnd),
    whole: false
  };
}
function matchEdit(objects, edit) {
  if (edit.newText.trim() === "" && edit.newText !== "") edit = { ...edit, newText: "" };
  const oldKey = norm(edit.oldText);
  const matches = objects.filter((o) => overlapRatio(o.bounds, edit.rect) >= 0.5);
  const candidates = [matches];
  if (matches.length > 1) candidates.push(...xLayers(matches));
  for (const set of candidates) {
    if (set.length === 0) continue;
    const streamJoin = set.map((o) => o.text).join("");
    for (const joined of [streamJoin, joinX(set), joinRows(set)]) {
      if (norm(joined) === oldKey) {
        return {
          matches: set,
          // Paragraph rebuilds keep newText's line/space structure (engine text has
          // none at line seams); single-run edits keep the engine's raw text
          newText: edit.newText === "" ? "" : edit.lineLeading !== void 0 ? mergeEngineCodepoints(joined, edit.oldText, edit.newText) : spliceIntoEngine(joined, edit.oldText, edit.newText),
          whole: true
        };
      }
    }
  }
  const container = objects.map((o) => ({ o, cover: rectCoverage(o.bounds, edit.rect) })).filter((c) => c.cover >= 0.5).sort((a, b) => b.cover - a.cover)[0]?.o;
  if (container) {
    const raw = container.text;
    const eng = foldMap(raw);
    const target = foldMap(edit.oldText);
    const at = indexOfUnits(eng.units, target.units);
    if (at >= 0) {
      const rawStart = eng.idx[at];
      const rawEnd = eng.end[at + target.units.length - 1];
      const fragment = spliceIntoEngine(raw.slice(rawStart, rawEnd), edit.oldText, edit.newText);
      return {
        matches: [container],
        newText: raw.slice(0, rawStart) + fragment + raw.slice(rawEnd),
        whole: false
      };
    }
  }
  const rescued = matchByText(objects, edit);
  if (rescued) return rescued;
  return { reason: "the edited text could not be located on the page" };
}
const readHeapU32 = (m, ptr) => m.HEAPU8[ptr] + m.HEAPU8[ptr + 1] * 256 + m.HEAPU8[ptr + 2] * 65536 + m.HEAPU8[ptr + 3] * 16777216;
function embeddedFontData(m, font) {
  if (!font || !m._FPDFFont_GetIsEmbedded(font)) return null;
  const lenPtr = m._malloc(4);
  try {
    if (!m._FPDFFont_GetFontData(font, 0, 0, lenPtr)) return null;
    const len = readHeapU32(m, lenPtr);
    if (!len) return null;
    const buf = m._malloc(len);
    try {
      if (!m._FPDFFont_GetFontData(font, buf, len, lenPtr)) return null;
      return Buffer.from(m.HEAPU8.subarray(buf, buf + len));
    } finally {
      m._free(buf);
    }
  } finally {
    m._free(lenPtr);
  }
}
function fontString(m, read) {
  const len = read(0, 0);
  if (len <= 1) return "";
  const buf = m._malloc(len);
  try {
    read(buf, len);
    return Buffer.from(m.HEAPU8.subarray(buf, buf + len - 1)).toString();
  } finally {
    m._free(buf);
  }
}
async function rebuildFontBytes(m, font, edit, newText) {
  const drawn = newText.replace(/\n/g, "");
  const style = edit.newBold && edit.newItalic ? "bolditalic" : edit.newBold ? "bold" : edit.newItalic ? "italic" : "regular";
  if (edit.newFont) {
    for (const s of style === "regular" ? ["regular"] : [style, "regular"]) {
      const chosen = loadEditFont(edit.newFont, s);
      if (chosen && fontCoversText(chosen, drawn)) return subsetTtf(chosen, drawn);
    }
  } else if (font) {
    if (style !== "regular") {
      const ps2 = fontString(m, (b, l) => m._FPDFFont_GetBaseFontName(font, b, l)).replace(
        /^[A-Z]{6}\+/,
        ""
      );
      const family2 = fontString(m, (b, l) => m._FPDFFont_GetFamilyName(font, b, l));
      if (ps2 || family2) {
        let sys = findSystemFont(`${ps2}-${style}`, family2);
        const original = findSystemFont(ps2, family2);
        const psTokens = (ps2.toLowerCase().match(/bolditalic|bold|italic|oblique/g) ?? []).flatMap(
          (t) => t === "bolditalic" ? ["bold", "italic"] : t === "oblique" ? ["italic"] : [t]
        );
        const wanted = style === "bolditalic" ? ["bold", "italic"] : [style];
        const alreadyStyled = wanted.every((t) => psTokens.includes(t));
        if (!alreadyStyled && sys && original && sys.equals(original)) {
          const stripped = ps2.replace(/bolditalic|bold|italic|oblique/gi, "");
          const alt = findSystemFont(`${stripped}-${style}`, family2);
          sys = alt && !alt.equals(original) ? alt : null;
        }
        if (sys && fontCoversText(sys, drawn)) {
          try {
            return identityCffCharset(await subsetTtf(sys, drawn));
          } catch {
          }
        }
      }
    }
    const embedded = embeddedFontData(m, font);
    if (embedded && fontCoversText(embedded, drawn)) {
      try {
        return identityCffCharset(embedded);
      } catch {
      }
    }
    const ps = fontString(m, (b, l) => m._FPDFFont_GetBaseFontName(font, b, l)).replace(
      /^[A-Z]{6}\+/,
      ""
    );
    const family = fontString(m, (b, l) => m._FPDFFont_GetFamilyName(font, b, l));
    if (ps || family) {
      const sys = findSystemFont(ps, family);
      if (sys && fontCoversText(sys, drawn)) {
        try {
          return identityCffCharset(await subsetTtf(sys, drawn));
        } catch {
        }
      }
    }
  }
  const fallback = fallbackFontFor(drawn);
  if (!fallback) {
    throw new Error("the replacement contains characters no available font can draw");
  }
  const sub = await subsetTtf(fallback, drawn);
  try {
    return identityCffCharset(sub);
  } catch {
    if (isTruetype(sub)) return sub;
    throw new Error("the fallback font for this text could not be embedded");
  }
}
const LINE_GAP = 1.2;
const styleKeyOf = (s) => s ? [
  s.color ? s.color.join(",") : "",
  s.font ?? "",
  s.size ?? "",
  s.bold === void 0 ? "" : s.bold ? 1 : 0,
  s.italic === void 0 ? "" : s.italic ? 1 : 0
].join("|") : "";
const styledBeyondColor = (s) => !!s && (s.font !== void 0 || s.size !== void 0 || s.bold !== void 0 || s.italic !== void 0);
const editStyleRuns = (edit) => edit.styleRuns ?? edit.colorRuns;
function plannedCharStyles(edit, plannedText) {
  const runs = editStyleRuns(edit);
  if (!runs || runs.length === 0) return null;
  const user = foldMap(edit.newText);
  const planned = foldMap(plannedText);
  const off = indexOfUnits(planned.units, user.units);
  if (off < 0) return null;
  const styles = runs.map((r) => ({
    color: r.color,
    font: r.font,
    size: r.size,
    bold: r.bold,
    italic: r.italic
  }));
  const styleAt = (i) => {
    for (const [ri, r] of runs.entries()) if (i >= r.start && i < r.end) return styles[ri];
    return null;
  };
  const out = new Array(plannedText.length).fill(null);
  for (let u = 0; u < user.units.length; u++) {
    const s = styleAt(user.idx[u]);
    if (!s) continue;
    const p = u + off;
    for (let k = planned.idx[p]; k < planned.end[p]; k++) out[k] = s;
  }
  for (let k = 1; k < out.length; k++) {
    if (out[k] === null && plannedText[k] !== "\n" && /\s/.test(plannedText[k])) {
      out[k] = out[k - 1];
    }
  }
  return out.some((s) => s !== null) ? out : null;
}
function matchCharColors(m, matches, targetText) {
  if (matches.length < 2) return null;
  const colPtr = m._malloc(16);
  const byKey = /* @__PURE__ */ new Map();
  const colorOf = /* @__PURE__ */ new Map();
  try {
    for (const t of matches) {
      if (!m._FPDFPageObj_GetFillColor(t.obj, colPtr, colPtr + 4, colPtr + 8, colPtr + 12)) {
        colorOf.set(t, null);
        continue;
      }
      const rgb = [0, 4, 8].map((off) => m.HEAPU8[colPtr + off]);
      const key = rgb.join(",");
      const c = byKey.get(key) ?? rgb;
      byKey.set(key, c);
      colorOf.set(t, c);
    }
  } finally {
    m._free(colPtr);
  }
  if (byKey.size <= 1) return null;
  const engUnits = [];
  const engColors = [];
  for (const t of readingOrder(matches)) {
    const units = foldMap(t.text).units;
    const c = colorOf.get(t) ?? null;
    for (const u of units) {
      engUnits.push(u);
      engColors.push(c);
    }
  }
  const tgt = foldMap(targetText);
  let p = 0;
  const maxP = Math.min(tgt.units.length, engUnits.length);
  while (p < maxP && tgt.units[p] === engUnits[p]) p++;
  let s = 0;
  const maxS = maxP - p;
  while (s < maxS && tgt.units[tgt.units.length - 1 - s] === engUnits[engUnits.length - 1 - s]) s++;
  const shift = engUnits.length - tgt.units.length;
  const out = new Array(targetText.length).fill(null);
  let any = false;
  for (let u = 0; u < tgt.units.length; u++) {
    const c = u < p ? engColors[u] : u >= tgt.units.length - s ? engColors[u + shift] : null;
    if (!c) continue;
    for (let k = tgt.idx[u]; k < tgt.end[u]; k++) out[k] = c;
    any = true;
  }
  return any ? out : null;
}
function overlayStyles(baseColors, over, text) {
  if (!baseColors && !over) return null;
  const out = new Array(text.length).fill(null);
  const colorOnly = /* @__PURE__ */ new Map();
  for (let k = 0; k < text.length; k++) {
    const b = baseColors?.[k] ?? null;
    const o = over?.[k] ?? null;
    if (o) {
      out[k] = o.color === void 0 && b ? { ...o, color: b } : o;
    } else if (b) {
      let s = colorOnly.get(b);
      if (!s) colorOnly.set(b, s = { color: b });
      out[k] = s;
    }
  }
  for (let k = 1; k < out.length; k++) {
    if (out[k] === null && text[k] !== "\n" && /\s/.test(text[k])) out[k] = out[k - 1];
  }
  return out.some((s) => s !== null) ? out : null;
}
function segmentLine(line, styles, advancePt) {
  const whole = [{ text: line, style: null, xPt: 0 }];
  if (!styles) return whole;
  const groups = [];
  let cu = 0;
  for (const ch of line) {
    const s = styles[cu] ?? null;
    const key = styleKeyOf(s);
    const last = groups[groups.length - 1];
    if (last && last.key === key) last.text += ch;
    else groups.push({ text: ch, style: s, key });
    cu += ch.length;
  }
  if (groups.length <= 1) {
    return groups.length ? groups.map((g) => ({ text: g.text, style: g.style, xPt: 0 })) : whole;
  }
  const segs = [];
  let x = 0;
  for (const g of groups) {
    segs.push({ text: g.text, style: g.style, xPt: x });
    for (const ch of g.text) {
      const a = advancePt(ch.codePointAt(0), g.style);
      if (a === null) return whole;
      x += a;
    }
  }
  return segs;
}
class PreserveAbort extends Error {
}
function wsEditClamp(oldText, newText) {
  const o = foldMap(oldText, true);
  const n = foldMap(newText, true);
  let pw = 0;
  const maxPw = Math.min(o.units.length, n.units.length);
  while (pw < maxPw && o.units[pw] === n.units[pw]) pw++;
  if (pw === o.units.length && pw === n.units.length) return null;
  let sw = 0;
  const maxSw = maxPw - pw;
  while (sw < maxSw && o.units[o.units.length - 1 - sw] === n.units[n.units.length - 1 - sw]) sw++;
  const winUnit = (fm, i) => pw < fm.units.length - sw ? fm.units[i] : void 0;
  const headWs = winUnit(o, pw) === " " || winUnit(n, pw) === " ";
  const tailWs = winUnit(o, o.units.length - 1 - sw) === " " || winUnit(n, n.units.length - 1 - sw) === " ";
  if (!headWs && !tailWs) return null;
  const nonSpace = (units, from, to) => {
    let c = 0;
    for (let i = from; i < to; i++) if (units[i] !== " ") c++;
    return c;
  };
  return {
    headNS: headWs ? nonSpace(o.units, 0, pw) - 1 : null,
    tailNS: tailWs ? nonSpace(o.units, o.units.length - sw, o.units.length) - 1 : null
  };
}
function buildKeepPlan(m, textPage, matches, newText, charStyles, newColor, edit) {
  const charsOf = new Map(matches.map((t) => [t.obj, []]));
  const total = m._FPDFText_CountChars(textPage);
  for (let i = 0; i < total; i++) {
    charsOf.get(m._FPDFText_GetTextObject(textPage, i))?.push(i);
  }
  const rectPtr = m._malloc(16);
  const xPtr = m._malloc(8);
  const yPtr = m._malloc(8);
  try {
    const ordered = readingOrder(matches);
    const engUnits = [];
    const unitCount = [];
    const geo = [];
    for (const t of ordered) {
      const chars = charsOf.get(t.obj) ?? [];
      let g = null;
      const cpLen = [...t.text].length;
      const trimmedCpLen = [...t.text.replace(/\s+$/, "")].length;
      if (chars.length > 0 && (chars.length === cpLen || chars.length === trimmedCpLen)) {
        let advW = 0;
        for (const ci of chars) {
          if (!m._FPDFText_GetLooseCharBox(textPage, ci, rectPtr)) {
            advW = NaN;
            break;
          }
          advW += m.HEAPF32[(rectPtr >> 2) + 2] - m.HEAPF32[rectPtr >> 2];
        }
        if (Number.isFinite(advW) && m._FPDFText_GetCharOrigin(textPage, chars[0], xPtr, yPtr)) {
          g = { origX: m.HEAPF64[xPtr >> 3], origY: m.HEAPF64[yPtr >> 3], advW };
        }
      }
      geo.push(g);
      const units = foldMap(t.text).units;
      unitCount.push(units.length);
      engUnits.push(...units);
    }
    const tgt = foldMap(newText);
    let p = 0;
    const maxP = Math.min(tgt.units.length, engUnits.length);
    while (p < maxP && tgt.units[p] === engUnits[p]) p++;
    const ws = wsEditClamp(edit.oldText, edit.newText);
    const oldUnits = ws ? foldMap(edit.oldText).units : [];
    const off = !ws ? -1 : engUnits.length === oldUnits.length ? 0 : indexOfUnits(engUnits, oldUnits);
    if (ws && off >= 0 && ws.headNS !== null) p = Math.min(p, Math.max(0, off + ws.headNS));
    let s = 0;
    const maxS = maxP - p;
    while (s < maxS && tgt.units[tgt.units.length - 1 - s] === engUnits[engUnits.length - 1 - s])
      s++;
    if (ws && off >= 0 && ws.tailNS !== null) {
      const extra = engUnits.length - off - oldUnits.length;
      s = Math.min(s, Math.max(0, extra + ws.tailNS));
    }
    const shift = engUnits.length - tgt.units.length;
    const out = [];
    let a = 0;
    let prevEnd = -1;
    for (const [oi, t] of ordered.entries()) {
      const b = a + unitCount[oi];
      const g = geo[oi];
      const inPrefix = b <= p;
      const inSuffix = a >= engUnits.length - s;
      if (g && b > a && (inPrefix || inSuffix)) {
        const ua = inPrefix ? a : a - shift;
        const startK = tgt.idx[ua];
        const endK = tgt.end[(inPrefix ? b : b - shift) - 1];
        if (startK >= prevEnd && endK > startK && !newText.slice(startK, endK).includes("\n")) {
          let color = newColor ?? null;
          if (!newColor && charStyles) {
            const colorKey = (k) => {
              const c = (charStyles[k] ?? null)?.color;
              return c ? c.join(",") : "";
            };
            const first = charStyles[startK] ?? null;
            color = first?.color ?? null;
            for (let k = startK; k < endK; k++) {
              if (styledBeyondColor(charStyles[k] ?? null) || colorKey(k) !== colorKey(startK)) {
                color = void 0;
                break;
              }
            }
          }
          if (color !== void 0) {
            out.push({ src: t, startK, endK, advW: g.advW, origX: g.origX, origY: g.origY, color });
            prevEnd = endK;
          }
        }
      }
      a = b;
    }
    return out.length > 0 ? out : null;
  } finally {
    for (const ptr of [rectPtr, xPtr, yPtr]) m._free(ptr);
  }
}
async function rebuildRun(m, doc, page, edit, matches, newText, textPage) {
  const anchor = matches.reduce((a, b) => b.bounds[0] < a.bounds[0] ? b : a);
  const matPtr = m._malloc(24);
  const sizePtr = m._malloc(4);
  const colPtr = m._malloc(16);
  const widthPtr = m._malloc(4);
  try {
    m._FPDFPageObj_GetMatrix(anchor.obj, matPtr);
    let matrix = Array.from(m.HEAPF32.subarray(matPtr >> 2, (matPtr >> 2) + 6));
    let fontSize = edit.fontSize;
    if (m._FPDFTextObj_GetFontSize(anchor.obj, sizePtr)) fontSize = m.HEAPF32[sizePtr >> 2];
    if (edit.newFontSize !== void 0 && edit.newFontSize > 0) fontSize = edit.newFontSize;
    if (edit.origin) {
      matrix = [1, 0, 0, 1, edit.origin[0], edit.origin[1]];
      fontSize = edit.newFontSize !== void 0 && edit.newFontSize > 0 ? edit.newFontSize : edit.fontSize;
    }
    const hasColor = m._FPDFPageObj_GetFillColor(
      anchor.obj,
      colPtr,
      colPtr + 4,
      colPtr + 8,
      colPtr + 12
    );
    const color = edit.newColor ? [edit.newColor[0], edit.newColor[1], edit.newColor[2], 255] : hasColor ? [0, 4, 8, 12].map((off) => m.HEAPU8[colPtr + off]) : [0, 0, 0, 255];
    if (color[3] === 0) color[3] = 255;
    const keepColors = edit.newColor ? null : matchCharColors(m, matches, newText);
    const charStyles = overlayStyles(keepColors, plannedCharStyles(edit, newText), newText);
    const styleOverride = edit.newFontSize !== void 0 || edit.newFont !== void 0 || edit.newBold || edit.newItalic;
    const axisAligned = Math.abs(matrix[1]) < 1e-4 && Math.abs(matrix[2]) < 1e-4 && matrix[0] > 0 && matrix[3] > 0;
    const keeps = !styleOverride && axisAligned ? buildKeepPlan(m, textPage, matches, newText, charStyles, edit.newColor, edit) : null;
    const redrawOnly = () => {
      if (!keeps) return newText;
      const parts = [];
      let k = 0;
      for (const kp of [...keeps].sort((a, b) => a.startK - b.startK)) {
        parts.push(newText.slice(k, kp.startK));
        k = kp.endK;
      }
      parts.push(newText.slice(k));
      return parts.join("");
    };
    let font = 0;
    let anyCff = false;
    const loadFont = async (styleEdit, text) => {
      const fontBytes = await rebuildFontBytes(m, anchor.font, styleEdit, text.trim() ? text : "x");
      const fontPtr = m._malloc(fontBytes.length);
      m.HEAPU8.set(fontBytes, fontPtr);
      const f = m._FPDFText_LoadFont(
        doc,
        fontPtr,
        fontBytes.length,
        isTruetype(fontBytes) ? FPDF_FONT_TRUETYPE : FPDF_FONT_TYPE1,
        1
      );
      m._free(fontPtr);
      if (!f) throw new Error("FPDFText_LoadFont failed");
      anyCff = anyCff || !isTruetype(fontBytes);
      return f;
    };
    const loadRebuild = async (text) => {
      font = await loadFont(edit, text);
    };
    await loadRebuild(keeps ? redrawOnly() : newText);
    const faceOf = (s) => ({
      font: s?.font ?? edit.newFont,
      bold: s?.bold ?? !!edit.newBold,
      italic: s?.italic ?? !!edit.newItalic
    });
    const faceKeyOf = (s) => {
      const f = faceOf(s);
      return `${f.font ?? ""}|${f.bold ? 1 : 0}|${f.italic ? 1 : 0}`;
    };
    const baseFaceKey = faceKeyOf(null);
    const sizeOf = (s) => s?.size !== void 0 && s.size > 0 ? s.size : fontSize;
    const styleFonts = /* @__PURE__ */ new Map();
    if (charStyles) {
      const byFace = /* @__PURE__ */ new Map();
      for (let k = 0; k < newText.length; k++) {
        const s = charStyles[k] ?? null;
        if (!s) continue;
        const fk = faceKeyOf(s);
        if (fk === baseFaceKey) continue;
        const e = byFace.get(fk);
        if (e) e.text += newText[k];
        else byFace.set(fk, { style: s, text: newText[k] });
      }
      for (const [fk, { style, text }] of byFace) {
        const face = faceOf(style);
        styleFonts.set(
          fk,
          await loadFont(
            { ...edit, newFont: face.font, newBold: face.bold, newItalic: face.italic },
            text
          )
        );
      }
    }
    const fontFor = (s) => styleFonts.get(faceKeyOf(s)) ?? font;
    const advancePt = (cp, s) => m._FPDFFont_GetGlyphWidth(fontFor(s), cp, 1, widthPtr) ? m.HEAPF32[widthPtr >> 2] * sizeOf(s) : null;
    const lineHeight = edit.lineLeading ?? fontSize * LINE_GAP;
    const [baseX, baseY] = edit.origin ?? [matrix[4], matrix[5]];
    const newObjs = [];
    const moves = [];
    const segAnchors = [];
    let lastKeptObj = 0;
    const makeSeg = (text, x, y, style) => {
      const newObj = m._FPDFPageObj_CreateTextObj(doc, fontFor(style), sizeOf(style));
      const textPtr = utf16Ptr(m, text);
      const ok = m._FPDFText_SetText(newObj, textPtr);
      m._free(textPtr);
      if (!ok) {
        m._FPDFPageObj_Destroy(newObj);
        throw new Error("FPDFText_SetText failed on rebuilt object");
      }
      const lineMatrix = [...matrix];
      lineMatrix[4] = x;
      lineMatrix[5] = y;
      m.HEAPF32.set(lineMatrix, matPtr >> 2);
      m._FPDFPageObj_SetMatrix(newObj, matPtr);
      const c = style?.color ? [style.color[0], style.color[1], style.color[2], 255] : color;
      m._FPDFPageObj_SetFillColor(newObj, c[0], c[1], c[2], c[3]);
      newObjs.push(newObj);
      segAnchors.push(lastKeptObj);
    };
    const buildRedraw = () => {
      let lineStart = 0;
      for (const [lineIdx, line] of newText.split("\n").entries()) {
        const lineStyles = charStyles ? charStyles.slice(lineStart, lineStart + line.length) : null;
        lineStart += line.length + 1;
        if (!line) continue;
        const drop = lineIdx * lineHeight;
        for (const seg of segmentLine(line, lineStyles, advancePt)) {
          if (!seg.text) continue;
          const segX = seg.xPt;
          makeSeg(
            seg.text,
            baseX + (edit.lineXOffsets?.[lineIdx] ?? 0) + matrix[0] * segX - matrix[2] * drop,
            baseY + matrix[1] * segX - matrix[3] * drop,
            seg.style
          );
        }
      }
    };
    const buildPreserved = (plan) => {
      const sorted = [...plan].sort((a, b) => a.startK - b.startK);
      let ki = 0;
      let lineStart = 0;
      const xScale = matrix[0];
      const advOf = (ch, s) => {
        const a = advancePt(ch.codePointAt(0), s);
        if (a !== null) return a * xScale;
        if (/\s/.test(ch)) return sizeOf(s) * xScale * 0.28;
        throw new PreserveAbort();
      };
      for (const [lineIdx, line] of newText.split("\n").entries()) {
        const lineEnd = lineStart + line.length;
        const baseline = baseY - lineIdx * lineHeight * matrix[3];
        let cursor = baseX + (edit.lineXOffsets?.[lineIdx] ?? 0);
        let prev = null;
        let k = lineStart;
        while (k < lineEnd) {
          const keep = ki < sorted.length && sorted[ki].startK === k ? sorted[ki] : null;
          if (keep) {
            if (prev && Math.abs(keep.origY - prev.keep.origY) < 0.5 && keep.origX > prev.keep.origX && /^\s*$/.test(newText.slice(prev.keep.endK, keep.startK))) {
              cursor = prev.placedX + (keep.origX - prev.keep.origX);
            }
            moves.push({
              obj: keep.src.obj,
              dx: cursor - keep.origX,
              dy: baseline - keep.origY,
              color: keep.color
            });
            lastKeptObj = keep.src.obj;
            prev = { keep, placedX: cursor };
            cursor += keep.advW;
            k = keep.endK;
            ki++;
            continue;
          }
          const runEnd = ki < sorted.length ? Math.min(sorted[ki].startK, lineEnd) : lineEnd;
          if (runEnd <= k) throw new PreserveAbort();
          const runText = newText.slice(k, runEnd);
          if (runText.trim()) {
            const runStyles = charStyles ? charStyles.slice(k, runEnd) : null;
            for (const seg of segmentLine(runText, runStyles, advancePt)) {
              if (!seg.text.trim()) continue;
              makeSeg(seg.text, cursor + seg.xPt * xScale, baseline, seg.style);
            }
            prev = null;
          }
          let cu = k;
          for (const ch of runText) {
            cursor += advOf(ch, charStyles?.[cu] ?? null);
            cu += ch.length;
          }
          k = runEnd;
        }
        lineStart = lineEnd + 1;
      }
      if (ki !== sorted.length) throw new PreserveAbort();
    };
    try {
      if (keeps) {
        try {
          buildPreserved(keeps);
        } catch (err) {
          if (!(err instanceof PreserveAbort)) throw err;
          for (const o of newObjs) m._FPDFPageObj_Destroy(o);
          newObjs.length = 0;
          moves.length = 0;
          segAnchors.length = 0;
          lastKeptObj = 0;
          await loadRebuild(newText);
          buildRedraw();
        }
      } else {
        buildRedraw();
      }
    } catch (err) {
      for (const o of newObjs) m._FPDFPageObj_Destroy(o);
      throw err;
    }
    const kept = new Set(moves.map((v) => v.obj));
    for (const v of moves) {
      m._FPDFPageObj_GetMatrix(v.obj, matPtr);
      m.HEAPF32[(matPtr >> 2) + 4] += v.dx;
      m.HEAPF32[(matPtr >> 2) + 5] += v.dy;
      m._FPDFPageObj_SetMatrix(v.obj, matPtr);
      if (v.color) m._FPDFPageObj_SetFillColor(v.obj, v.color[0], v.color[1], v.color[2], 255);
    }
    const removed = matches.filter((t) => !kept.has(t.obj));
    for (const t of removed) {
      m._FPDFPage_RemoveObject(page, t.obj);
      m._FPDFPageObj_Destroy(t.obj);
    }
    if (kept.size > 0 && newObjs.length > 0 && m._FPDFPage_InsertObjectAtIndex) {
      const idxOf = /* @__PURE__ */ new Map();
      const count = m._FPDFPage_CountObjects(page);
      for (let i = 0; i < count; i++) idxOf.set(m._FPDFPage_GetObject(page, i), i);
      const runStart = Math.min(
        ...matches.filter((t) => kept.has(t.obj)).map((t) => idxOf.get(t.obj) ?? 0)
      );
      const groups = [];
      for (const [i, newObj] of newObjs.entries()) {
        const anchor2 = segAnchors[i];
        const at = anchor2 && idxOf.has(anchor2) ? idxOf.get(anchor2) + 1 : runStart;
        const g = groups[groups.length - 1];
        if (g && g.at === at) g.objs.push(newObj);
        else groups.push({ at, objs: [newObj] });
      }
      groups.sort((a, b) => b.at - a.at);
      for (const g of groups) {
        for (const [j, newObj] of g.objs.entries()) {
          m._FPDFPage_InsertObjectAtIndex(page, newObj, g.at + j);
        }
      }
    } else {
      const insertAt = removed.length > 0 ? Math.min(...removed.map((t) => t.index)) : -1;
      for (const [i, newObj] of newObjs.entries()) {
        if (insertAt >= 0 && m._FPDFPage_InsertObjectAtIndex) {
          m._FPDFPage_InsertObjectAtIndex(page, newObj, insertAt + i);
        } else {
          m._FPDFPage_InsertObject(page, newObj);
        }
      }
    }
    return anyCff;
  } finally {
    for (const p of [matPtr, sizePtr, colPtr, widthPtr]) m._free(p);
  }
}
async function relabelOpenTypeFontFiles(bytes) {
  const doc = await index$1.PDFDocument.load(bytes);
  let touched = false;
  for (const [, obj] of doc.context.enumerateIndirectObjects()) {
    if (!(obj instanceof index$1.PDFDict)) continue;
    if (obj.get(index$1.PDFName.of("Type")) !== index$1.PDFName.of("FontDescriptor")) continue;
    const ff = obj.get(index$1.PDFName.of("FontFile"));
    if (!ff) continue;
    const stream = doc.context.lookup(ff);
    if (!(stream instanceof index$1.PDFRawStream)) continue;
    let program;
    try {
      program = index$1.decodePDFRawStream(stream).decode();
    } catch {
      continue;
    }
    if (Buffer.from(program.subarray(0, 4)).toString("latin1") !== "OTTO") continue;
    obj.delete(index$1.PDFName.of("FontFile"));
    obj.set(index$1.PDFName.of("FontFile3"), ff);
    stream.dict.set(index$1.PDFName.of("Subtype"), index$1.PDFName.of("OpenType"));
    touched = true;
  }
  return touched ? doc.save({ useObjectStreams: false }) : bytes;
}
function saveDoc(m, doc) {
  const writer = m._PDFiumExt_OpenFileWriter();
  try {
    if (!m._PDFiumExt_SaveAsCopy(doc, writer)) throw new Error("PDFium SaveAsCopy failed");
    const size = m._PDFiumExt_GetFileWriterSize(writer);
    const buf = m._malloc(size);
    m._PDFiumExt_GetFileWriterData(writer, buf, size);
    const out = Uint8Array.from(m.HEAPU8.subarray(buf, buf + size));
    m._free(buf);
    return out;
  } finally {
    m._PDFiumExt_CloseFileWriter(writer);
  }
}
let applyChain = Promise.resolve();
function chainPdfium(fn) {
  const run = applyChain.then(fn);
  applyChain = run.catch(() => void 0);
  return run;
}
const errMsg = (err) => err instanceof Error ? err.message : String(err);
function applyTextEdits(bytes, edits) {
  return chainPdfium(() => applyTextEditsInner(bytes, edits));
}
function textInsertAxes(rotate = 0) {
  switch ((rotate % 360 + 360) % 360) {
    case 90:
      return [0, 1, -1, 0];
    case 180:
      return [-1, 0, 0, -1];
    case 270:
      return [0, -1, 1, 0];
    default:
      return [1, 0, 0, 1];
  }
}
function applyTextInserts(bytes, inserts) {
  return chainPdfium(async () => {
    const m = await loadPdfium();
    const skipped = [];
    return withDocument(m, bytes, async (doc) => {
      const pageCount = m._FPDF_GetPageCount(doc);
      let appliedTotal = 0;
      let embeddedCff = false;
      const byPage = /* @__PURE__ */ new Map();
      inserts.forEach((input, editIndex) => {
        if (input.pageIndex < 0 || input.pageIndex >= pageCount) {
          skipped.push({ editIndex, pageIndex: input.pageIndex, reason: "page does not exist" });
          return;
        }
        byPage.set(input.pageIndex, [...byPage.get(input.pageIndex) ?? [], { input, editIndex }]);
      });
      for (const [pageIndex, pageInserts] of byPage) {
        const page = m._FPDF_LoadPage(doc, pageIndex);
        if (!page) throw new Error(`could not load page ${pageIndex + 1}`);
        let applied = 0;
        try {
          for (const { input, editIndex } of pageInserts) {
            const text = input.text.trim();
            if (!text) {
              skipped.push({ editIndex, pageIndex, reason: "empty inserted text" });
              continue;
            }
            const pseudoEdit = {
              pageIndex,
              rect: [input.origin[0], input.origin[1], input.origin[0], input.origin[1]],
              oldText: "",
              newText: input.text,
              fontSize: input.fontSize,
              newFontSize: input.fontSize,
              newColor: input.color,
              newFont: input.font,
              newBold: input.bold,
              newItalic: input.italic
            };
            const created = [];
            let font = 0;
            try {
              const fontBytes = await rebuildFontBytes(m, 0, pseudoEdit, input.text);
              const fontPtr = m._malloc(fontBytes.length);
              m.HEAPU8.set(fontBytes, fontPtr);
              font = m._FPDFText_LoadFont(
                doc,
                fontPtr,
                fontBytes.length,
                isTruetype(fontBytes) ? FPDF_FONT_TRUETYPE : FPDF_FONT_TYPE1,
                1
              );
              m._free(fontPtr);
              if (!font) throw new Error("FPDFText_LoadFont failed");
              const matrixPtr = m._malloc(24);
              try {
                const leading = input.lineLeading ?? input.fontSize * LINE_GAP;
                const [a, b, c, d] = textInsertAxes(input.rotate);
                for (const [lineIndex, line] of input.text.split("\n").entries()) {
                  if (!line) continue;
                  const obj = m._FPDFPageObj_CreateTextObj(doc, font, input.fontSize);
                  const textPtr = utf16Ptr(m, line);
                  const ok = m._FPDFText_SetText(obj, textPtr);
                  m._free(textPtr);
                  if (!ok) {
                    m._FPDFPageObj_Destroy(obj);
                    throw new Error("FPDFText_SetText failed on inserted object");
                  }
                  const offset = input.lineXOffsets?.[lineIndex] ?? 0;
                  const drop = lineIndex * leading;
                  m.HEAPF32.set(
                    [
                      a,
                      b,
                      c,
                      d,
                      input.origin[0] + a * offset - c * drop,
                      input.origin[1] + b * offset - d * drop
                    ],
                    matrixPtr >> 2
                  );
                  m._FPDFPageObj_SetMatrix(obj, matrixPtr);
                  m._FPDFPageObj_SetFillColor(
                    obj,
                    input.color[0],
                    input.color[1],
                    input.color[2],
                    255
                  );
                  created.push(obj);
                }
              } finally {
                m._free(matrixPtr);
              }
              for (const obj of created) m._FPDFPage_InsertObject(page, obj);
              embeddedCff = !isTruetype(fontBytes) || embeddedCff;
              applied++;
            } catch (err) {
              for (const obj of created) m._FPDFPageObj_Destroy(obj);
              skipped.push({ editIndex, pageIndex, reason: errMsg(err) });
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
      if (appliedTotal === 0) return { bytes, skipped };
      const saved = saveDoc(m, doc);
      return { bytes: embeddedCff ? await relabelOpenTypeFontFiles(saved) : saved, skipped };
    });
  });
}
function validateTextEdits(bytes, edits) {
  return chainPdfium(() => validateTextEditsInner(bytes, edits));
}
async function withDocument(m, bytes, fn) {
  const docPtr = m._malloc(bytes.length);
  m.HEAPU8.set(bytes, docPtr);
  const doc = m._FPDF_LoadMemDocument(docPtr, bytes.length, 0);
  if (!doc) {
    m._free(docPtr);
    throw new Error("PDFium could not load the document");
  }
  try {
    return await fn(doc);
  } finally {
    m._FPDF_CloseDocument(doc);
    m._free(docPtr);
  }
}
function groupByPage(m, doc, edits, outOfRange) {
  const pageCount = m._FPDF_GetPageCount(doc);
  const byPage = /* @__PURE__ */ new Map();
  for (const e of edits) {
    if (e.pageIndex < 0 || e.pageIndex >= pageCount) {
      outOfRange(e);
      continue;
    }
    byPage.set(e.pageIndex, [...byPage.get(e.pageIndex) ?? [], e]);
  }
  return byPage;
}
async function applyTextEditsInner(bytes, edits) {
  const m = await loadPdfium();
  const skipped = [];
  const skip = (edit, reason) => skipped.push({ pageIndex: edit.pageIndex, oldText: edit.oldText, reason });
  return withDocument(m, bytes, async (doc) => {
    const byPage = groupByPage(m, doc, edits, (e) => skip(e, "page does not exist"));
    let appliedTotal = 0;
    let embeddedCff = false;
    for (const [pageIndex, pageEdits] of byPage) {
      const page = m._FPDF_LoadPage(doc, pageIndex);
      if (!page) throw new Error(`could not load page ${pageIndex + 1}`);
      const textPage = m._FPDFText_LoadPage(page);
      try {
        const objects = collectTextObjects(m, page, textPage);
        const claimed = /* @__PURE__ */ new Set();
        const planned = [];
        for (const edit of pageEdits) {
          const res = matchEdit(objects, edit);
          if ("reason" in res) {
            skip(edit, res.reason);
          } else if (res.matches.some((t) => claimed.has(t.obj))) {
            skip(edit, "overlaps another pending text edit");
          } else {
            for (const t of res.matches) claimed.add(t.obj);
            planned.push({ edit, ...res });
          }
        }
        planned.sort((a, b) => b.matches[0].index - a.matches[0].index);
        let applied = 0;
        for (const { edit, matches, newText, whole } of planned) {
          if (edit.translate) {
            if (!whole) {
              skip(edit, "the text block cannot be moved as one unit");
              continue;
            }
            const [dx, dy] = edit.translate;
            for (const t of matches) m._FPDFPageObj_Transform(t.obj, 1, 0, 0, 1, dx, dy);
            applied++;
            continue;
          }
          if (newText.trim() === "") {
            for (const t of matches) {
              m._FPDFPage_RemoveObject(page, t.obj);
              m._FPDFPageObj_Destroy(t.obj);
            }
            applied++;
            continue;
          }
          const eff = whole ? edit : { ...edit, origin: void 0, lineLeading: void 0, lineXOffsets: void 0 };
          try {
            if (canReuseFont(eff, newText, matches, objects)) {
              const textPtr = utf16Ptr(m, newText);
              const ok = m._FPDFText_SetText(matches[0].obj, textPtr);
              m._free(textPtr);
              if (!ok) throw new Error("FPDFText_SetText failed");
            } else {
              embeddedCff = await rebuildRun(m, doc, page, eff, matches, newText, textPage) || embeddedCff;
            }
            applied++;
          } catch (err) {
            skip(edit, errMsg(err));
          }
        }
        if (applied > 0 && !m._FPDFPage_GenerateContent(page)) {
          throw new Error(`could not regenerate page ${pageIndex + 1}`);
        }
        appliedTotal += applied;
      } finally {
        m._FPDFText_ClosePage(textPage);
        m._FPDF_ClosePage(page);
      }
    }
    if (appliedTotal === 0) return { bytes, skipped };
    const saved = saveDoc(m, doc);
    return { bytes: embeddedCff ? await relabelOpenTypeFontFiles(saved) : saved, skipped };
  });
}
function matchBounds(matches) {
  return matches.slice(1).reduce(
    (u, t) => [
      Math.min(u[0], t.bounds[0]),
      Math.min(u[1], t.bounds[1]),
      Math.max(u[2], t.bounds[2]),
      Math.max(u[3], t.bounds[3])
    ],
    [...matches[0].bounds]
  );
}
async function validateTextEditsInner(bytes, edits) {
  const m = await loadPdfium();
  return withDocument(m, bytes, async (doc) => {
    const results = edits.map(() => ({ reason: null }));
    const indexOf = new Map(edits.map((e, i) => [e, i]));
    const byPage = groupByPage(m, doc, edits, (e) => {
      results[indexOf.get(e)] = { reason: "page does not exist" };
    });
    for (const [pageIndex, pageEdits] of byPage) {
      const page = m._FPDF_LoadPage(doc, pageIndex);
      if (!page) {
        for (const e of pageEdits)
          results[indexOf.get(e)] = { reason: `could not load page ${pageIndex + 1}` };
        continue;
      }
      const textPage = m._FPDFText_LoadPage(page);
      const colPtr = m._malloc(16);
      try {
        const objects = collectTextObjects(m, page, textPage);
        for (const e of pageEdits) {
          const res = matchEdit(objects, e);
          if ("reason" in res) {
            results[indexOf.get(e)] = { reason: res.reason };
            continue;
          }
          if (e.translate && !res.whole) {
            results[indexOf.get(e)] = { reason: "the text block cannot be moved as one unit" };
            continue;
          }
          const b = matchBounds(res.matches);
          const whole = norm(res.matches.map((t) => t.text).join("")) === norm(e.oldText);
          const kept = whole ? matchCharColors(m, res.matches, e.oldText) : null;
          const runs = [];
          if (kept) {
            for (let k = 0; k < kept.length; k++) {
              const c = kept[k];
              if (!c) continue;
              const last = runs[runs.length - 1];
              if (last && last.end === k && last.c === c) last.end = k + 1;
              else runs.push({ start: k, end: k + 1, c });
            }
          }
          const first = readingOrder(res.matches)[0];
          const baseColor = m._FPDFPageObj_GetFillColor(
            first.obj,
            colPtr,
            colPtr + 4,
            colPtr + 8,
            colPtr + 12
          ) ? [m.HEAPU8[colPtr], m.HEAPU8[colPtr + 4], m.HEAPU8[colPtr + 8]] : void 0;
          results[indexOf.get(e)] = {
            reason: null,
            bounds: whole ? b : [e.rect[0], b[1], e.rect[2], b[3]],
            colorRuns: runs.length > 0 ? runs.map((r) => ({
              start: r.start,
              end: r.end,
              color: [r.c[0], r.c[1], r.c[2]]
            })) : void 0,
            baseColor
          };
        }
      } finally {
        m._free(colPtr);
        m._FPDFText_ClosePage(textPage);
        m._FPDF_ClosePage(page);
      }
    }
    return results;
  });
}
function verifyTextEdits(bytes, edits) {
  return chainPdfium(async () => {
    const m = await loadPdfium();
    return withDocument(m, bytes, async (doc) => {
      const failures = [];
      const pageCount = m._FPDF_GetPageCount(doc);
      const byPage = /* @__PURE__ */ new Map();
      for (const e of edits) {
        if (e.pageIndex < 0 || e.pageIndex >= pageCount) {
          failures.push({ pageIndex: e.pageIndex, reason: "page missing from saved output" });
          continue;
        }
        byPage.set(e.pageIndex, [...byPage.get(e.pageIndex) ?? [], e.newText]);
      }
      for (const [pageIndex, texts] of byPage) {
        const page = m._FPDF_LoadPage(doc, pageIndex);
        if (!page) {
          for (const _ of texts)
            failures.push({ pageIndex, reason: "page unreadable in saved output" });
          continue;
        }
        const textPage = m._FPDFText_LoadPage(page);
        try {
          const canon = (s) => norm(s.normalize("NFC"));
          const objects = collectTextObjects(m, page, textPage);
          const pageText = canon(objects.map((o) => o.text).join(""));
          const visualText = canon(joinRows(objects));
          for (const newText of texts) {
            const missing = newText.split("\n").map(canon).filter((l) => l.length > 0 && !pageText.includes(l) && !visualText.includes(l));
            if (missing.length > 0) {
              const snippet = missing[0].slice(0, 20);
              failures.push({
                pageIndex,
                reason: `replacement text missing from saved output ("${snippet}")`
              });
            }
          }
        } finally {
          m._FPDFText_ClosePage(textPage);
          m._FPDF_ClosePage(page);
        }
      }
      return failures;
    });
  });
}
exports.FPDF_PAGEOBJ_TEXT = FPDF_PAGEOBJ_TEXT;
exports.applyTextEdits = applyTextEdits;
exports.applyTextInserts = applyTextInserts;
exports.canDrawText = canDrawText;
exports.chainPdfium = chainPdfium;
exports.fallbackFontFor = fallbackFontFor;
exports.foldMap = foldMap;
exports.listEditFonts = listEditFonts;
exports.loadPdfium = loadPdfium;
exports.mergeEngineCodepoints = mergeEngineCodepoints;
exports.norm = norm;
exports.plannedCharStyles = plannedCharStyles;
exports.saveDoc = saveDoc;
exports.spliceIntoEngine = spliceIntoEngine;
exports.textInsertAxes = textInsertAxes;
exports.validateTextEdits = validateTextEdits;
exports.verifyTextEdits = verifyTextEdits;
exports.withDocument = withDocument;
exports.wsEditClamp = wsEditClamp;
