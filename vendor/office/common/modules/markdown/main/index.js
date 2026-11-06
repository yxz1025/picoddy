var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// ../../../../private/tmp/nami-office-markdown-runtime-entry.ts
var nami_office_markdown_runtime_entry_exports = {};
__export(nami_office_markdown_runtime_entry_exports, {
  configureMarkdownRuntime: () => configureMarkdownRuntime,
  createMarkdownView: () => createMarkdownView,
  discardMarkdownChanges: () => discardMarkdownChanges,
  requestMarkdownClose: () => requestMarkdownClose,
  requestMarkdownSave: () => requestMarkdownSave
});
module.exports = __toCommonJS(nami_office_markdown_runtime_entry_exports);

// apps/markdown/src/main/markdown-main.ts
var import_node_fs7 = require("node:fs");
var import_promises5 = require("node:fs/promises");
var import_node_os4 = require("node:os");
var import_node_path10 = require("node:path");
var import_node_url2 = require("node:url");
var import_electron2 = require("electron");

// packages/electron-utils/src/context-menu.ts
var INSTALLED = Symbol.for("genoffice.context-menu-installed");

// packages/electron-utils/src/dialog-memory.ts
var import_node_path = require("node:path");
var lastUsedDirectoryByDialog = /* @__PURE__ */ new WeakMap();
function withRememberedDirectory(dialog2, options, fallbackDir) {
  const lastDir = lastUsedDirectoryByDialog.get(dialog2) ?? fallbackDir;
  if (!lastDir) return options;
  if (options.defaultPath === void 0) return { ...options, defaultPath: lastDir };
  if ((0, import_node_path.basename)(options.defaultPath) === options.defaultPath) {
    return { ...options, defaultPath: (0, import_node_path.join)(lastDir, options.defaultPath) };
  }
  return options;
}
async function showOpenDialogWithMemory(dialog2, parent, options, fallbackDir) {
  const withDir = withRememberedDirectory(dialog2, options, fallbackDir);
  const result = parent ? await dialog2.showOpenDialog(parent, withDir) : await dialog2.showOpenDialog(withDir);
  const picked = result.filePaths[0];
  if (!result.canceled && picked) {
    lastUsedDirectoryByDialog.set(
      dialog2,
      options.properties?.includes("openDirectory") ? picked : (0, import_node_path.dirname)(picked)
    );
  }
  return result;
}
async function showSaveDialogWithMemory(dialog2, parent, options, fallbackDir) {
  const withDir = withRememberedDirectory(dialog2, options, fallbackDir);
  const result = parent ? await dialog2.showSaveDialog(parent, withDir) : await dialog2.showSaveDialog(withDir);
  if (!result.canceled && result.filePath) {
    lastUsedDirectoryByDialog.set(dialog2, (0, import_node_path.dirname)(result.filePath));
  }
  return result;
}

// packages/electron-utils/src/default-save-dir.ts
var import_node_fs = require("node:fs");
var import_node_path2 = require("node:path");
var DEFAULT_SAVE_DIR_KEY = "defaultSaveDir";
function readDefaultSaveDirSetting(settingsPath) {
  try {
    const raw = JSON.parse((0, import_node_fs.readFileSync)(settingsPath, "utf8"));
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
    const value = raw[DEFAULT_SAVE_DIR_KEY];
    return typeof value === "string" && (0, import_node_path2.isAbsolute)(value) ? value : null;
  } catch {
    return null;
  }
}
function isUsableSaveDir(dir) {
  try {
    (0, import_node_fs.mkdirSync)(dir, { recursive: true });
    (0, import_node_fs.accessSync)(dir, import_node_fs.constants.W_OK);
    return true;
  } catch {
    return false;
  }
}
function resolveDefaultSaveDir(configured, fallbackDir) {
  if (configured && isUsableSaveDir(configured)) return configured;
  (0, import_node_fs.mkdirSync)(fallbackDir, { recursive: true });
  return fallbackDir;
}
function configuredDefaultSaveDir(app2) {
  const settingsPath = (0, import_node_path2.join)(app2.getPath("userData"), "app-settings.json");
  const fallback = (0, import_node_path2.join)(app2.getPath("documents"), "PiCoddy Office");
  return resolveDefaultSaveDir(readDefaultSaveDirSetting(settingsPath), fallback);
}

// packages/electron-utils/src/navigation-guard.ts
var INSTALLED2 = Symbol.for("genoffice.navigation-guard-installed");

// packages/electron-utils/src/drop-open.ts
var import_electron = require("electron");
var INSTALLED3 = Symbol.for("genoffice.drop-open-installed");

// packages/electron-utils/src/safe-external-url.ts
var DEFAULT_PROTOCOLS = ["http:", "https:"];
function safeExternalUrl(url, options) {
  if (typeof url !== "string") return null;
  const text = url.trim();
  let parsed;
  try {
    parsed = new URL(text);
  } catch {
    return null;
  }
  const allowed = options?.allowedProtocols ?? DEFAULT_PROTOCOLS;
  return allowed.includes(parsed.protocol) ? text : null;
}

// packages/electron-utils/src/safe-remote-url.ts
var import_promises = require("node:dns/promises");
var import_node_net = require("node:net");
var blockedAddresses = (() => {
  const list = new import_node_net.BlockList();
  list.addSubnet("0.0.0.0", 8);
  list.addSubnet("10.0.0.0", 8);
  list.addSubnet("100.64.0.0", 10);
  list.addSubnet("127.0.0.0", 8);
  list.addSubnet("169.254.0.0", 16);
  list.addSubnet("172.16.0.0", 12);
  list.addSubnet("192.0.0.0", 24);
  list.addSubnet("192.168.0.0", 16);
  list.addSubnet("198.18.0.0", 15);
  list.addSubnet("224.0.0.0", 4);
  list.addSubnet("240.0.0.0", 4);
  list.addAddress("::", "ipv6");
  list.addAddress("::1", "ipv6");
  list.addSubnet("::", 96, "ipv6");
  list.addSubnet("64:ff9b::", 96, "ipv6");
  list.addSubnet("fc00::", 7, "ipv6");
  list.addSubnet("fe80::", 10, "ipv6");
  list.addSubnet("ff00::", 8, "ipv6");
  return list;
})();
var BLOCKED_HOST_SUFFIXES = [".localhost", ".local", ".internal"];
function isBlockedAddress(ip) {
  const family = (0, import_node_net.isIP)(ip);
  if (family === 0) return true;
  return blockedAddresses.check(ip, family === 4 ? "ipv4" : "ipv6");
}
async function isSafeRemoteUrl(raw, lookupImpl = import_promises.lookup) {
  if (typeof raw !== "string") return false;
  let url;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return false;
  const host = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (host === "") return false;
  if ((0, import_node_net.isIP)(host)) return !isBlockedAddress(host);
  if (host === "localhost" || BLOCKED_HOST_SUFFIXES.some((s) => host.endsWith(s))) return false;
  try {
    const addrs = await lookupImpl(host, { all: true });
    return addrs.length > 0 && addrs.every((a) => !isBlockedAddress(a.address));
  } catch {
    return false;
  }
}
async function fetchWithSsrfGuard(rawUrl, options = {}) {
  const { maxRedirects = 5, headers, fetchImpl = fetch, lookupImpl = import_promises.lookup } = options;
  let current = rawUrl;
  for (let hop = 0; hop <= maxRedirects; hop++) {
    if (!await isSafeRemoteUrl(current, lookupImpl)) return null;
    const resp = await fetchImpl(current, {
      ...headers ? { headers } : {},
      redirect: "manual"
    });
    if (resp.status < 300 || resp.status >= 400) return resp;
    const location = resp.headers.get("location");
    if (!location) return null;
    try {
      current = new URL(location, current).toString();
    } catch {
      return null;
    }
  }
  return null;
}

// packages/electron-utils/src/generated-images.ts
var import_node_crypto = require("node:crypto");
var import_node_fs2 = require("node:fs");
var import_node_os = require("node:os");
var import_node_path3 = require("node:path");
var import_node_url = require("node:url");
var GENERATED_IMAGE_DIR = (0, import_node_path3.join)((0, import_node_os.tmpdir)(), "genoffice-ai-images");
var MIME_BY_EXT = {
  png: "image/png",
  jpg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp"
};
var EXT_BY_MIME = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp"
};
var FILE_NAME_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(png|jpg|gif|webp)$/;
var MAX_AGE_MS = 24 * 60 * 60 * 1e3;
function pruneOld(now = Date.now()) {
  let names;
  try {
    names = (0, import_node_fs2.readdirSync)(GENERATED_IMAGE_DIR);
  } catch {
    return;
  }
  for (const name of names) {
    if (!FILE_NAME_RE.test(name)) continue;
    const path = (0, import_node_path3.join)(GENERATED_IMAGE_DIR, name);
    try {
      if (now - (0, import_node_fs2.statSync)(path).mtimeMs > MAX_AGE_MS) (0, import_node_fs2.unlinkSync)(path);
    } catch {
    }
  }
}
function storeGeneratedImage(bytes, mime) {
  const ext = EXT_BY_MIME[mime.toLowerCase()] ?? "png";
  (0, import_node_fs2.mkdirSync)(GENERATED_IMAGE_DIR, { recursive: true });
  pruneOld();
  const path = (0, import_node_path3.join)(GENERATED_IMAGE_DIR, `${(0, import_node_crypto.randomUUID)()}.${ext}`);
  (0, import_node_fs2.writeFileSync)(path, bytes);
  return (0, import_node_url.pathToFileURL)(path).toString();
}
function readGeneratedImage(rawUrl) {
  let path;
  try {
    const url = new URL(rawUrl);
    if (url.protocol !== "file:") return null;
    path = (0, import_node_path3.resolve)((0, import_node_url.fileURLToPath)(url));
  } catch {
    return null;
  }
  const dir = (0, import_node_path3.resolve)(GENERATED_IMAGE_DIR);
  if (!path.startsWith(dir + import_node_path3.sep)) return null;
  const name = (0, import_node_path3.basename)(path);
  if (!FILE_NAME_RE.test(name) || path !== (0, import_node_path3.join)(dir, name)) return null;
  try {
    const bytes = (0, import_node_fs2.readFileSync)(path);
    return { bytes, mime: MIME_BY_EXT[name.slice(name.lastIndexOf(".") + 1)] ?? "image/png" };
  } catch {
    return null;
  }
}

// packages/electron-utils/src/remote-image.ts
var RETRY_DELAYS_MS = [500, 1500];
function remoteImageHeaders(rawUrl) {
  const headers = {
    "User-Agent": "Mozilla/5.0",
    // Only advertise formats the insert pipelines can label correctly: callers
    // map non-png/gif responses to JPEG, so preferring avif/webp would invite
    // content-negotiating CDNs to send bytes that end up mislabeled.
    Accept: "image/png,image/jpeg,image/gif,image/*;q=0.8,*/*;q=0.5"
  };
  try {
    const host = new URL(rawUrl).hostname.toLowerCase();
    if (host === "genspark.ai" || host.endsWith(".genspark.ai")) {
      headers.Referer = "https://www.genspark.ai/";
    }
  } catch {
  }
  return headers;
}
async function fetchRemoteImage(rawUrl, options = {}) {
  const { retryDelaysMs = RETRY_DELAYS_MS, ...guardOptions } = options;
  if (rawUrl.startsWith("file:")) {
    const local = readGeneratedImage(rawUrl);
    if (!local) return null;
    return new Response(new Uint8Array(local.bytes), {
      status: 200,
      headers: { "content-type": local.mime, "content-length": String(local.bytes.byteLength) }
    });
  }
  const headers = remoteImageHeaders(rawUrl);
  for (let attempt = 0; ; attempt++) {
    let resp = null;
    let threw = false;
    try {
      resp = await fetchWithSsrfGuard(rawUrl, { ...guardOptions, headers });
    } catch {
      threw = true;
    }
    if (resp?.ok) return resp;
    if (resp === null && !threw) return null;
    const transient = threw || resp !== null && (resp.status === 403 || resp.status === 408 || resp.status === 429 || resp.status >= 500);
    const delay = retryDelaysMs[attempt];
    if (!transient || delay === void 0) return resp;
    await new Promise((r) => setTimeout(r, delay));
  }
}

// node_modules/parse5/dist/common/unicode.js
var CODE_POINTS;
(function(CODE_POINTS2) {
  CODE_POINTS2[CODE_POINTS2["EOF"] = -1] = "EOF";
  CODE_POINTS2[CODE_POINTS2["NULL"] = 0] = "NULL";
  CODE_POINTS2[CODE_POINTS2["TABULATION"] = 9] = "TABULATION";
  CODE_POINTS2[CODE_POINTS2["CARRIAGE_RETURN"] = 13] = "CARRIAGE_RETURN";
  CODE_POINTS2[CODE_POINTS2["LINE_FEED"] = 10] = "LINE_FEED";
  CODE_POINTS2[CODE_POINTS2["FORM_FEED"] = 12] = "FORM_FEED";
  CODE_POINTS2[CODE_POINTS2["SPACE"] = 32] = "SPACE";
  CODE_POINTS2[CODE_POINTS2["EXCLAMATION_MARK"] = 33] = "EXCLAMATION_MARK";
  CODE_POINTS2[CODE_POINTS2["QUOTATION_MARK"] = 34] = "QUOTATION_MARK";
  CODE_POINTS2[CODE_POINTS2["AMPERSAND"] = 38] = "AMPERSAND";
  CODE_POINTS2[CODE_POINTS2["APOSTROPHE"] = 39] = "APOSTROPHE";
  CODE_POINTS2[CODE_POINTS2["HYPHEN_MINUS"] = 45] = "HYPHEN_MINUS";
  CODE_POINTS2[CODE_POINTS2["SOLIDUS"] = 47] = "SOLIDUS";
  CODE_POINTS2[CODE_POINTS2["DIGIT_0"] = 48] = "DIGIT_0";
  CODE_POINTS2[CODE_POINTS2["DIGIT_9"] = 57] = "DIGIT_9";
  CODE_POINTS2[CODE_POINTS2["SEMICOLON"] = 59] = "SEMICOLON";
  CODE_POINTS2[CODE_POINTS2["LESS_THAN_SIGN"] = 60] = "LESS_THAN_SIGN";
  CODE_POINTS2[CODE_POINTS2["EQUALS_SIGN"] = 61] = "EQUALS_SIGN";
  CODE_POINTS2[CODE_POINTS2["GREATER_THAN_SIGN"] = 62] = "GREATER_THAN_SIGN";
  CODE_POINTS2[CODE_POINTS2["QUESTION_MARK"] = 63] = "QUESTION_MARK";
  CODE_POINTS2[CODE_POINTS2["LATIN_CAPITAL_A"] = 65] = "LATIN_CAPITAL_A";
  CODE_POINTS2[CODE_POINTS2["LATIN_CAPITAL_Z"] = 90] = "LATIN_CAPITAL_Z";
  CODE_POINTS2[CODE_POINTS2["RIGHT_SQUARE_BRACKET"] = 93] = "RIGHT_SQUARE_BRACKET";
  CODE_POINTS2[CODE_POINTS2["GRAVE_ACCENT"] = 96] = "GRAVE_ACCENT";
  CODE_POINTS2[CODE_POINTS2["LATIN_SMALL_A"] = 97] = "LATIN_SMALL_A";
  CODE_POINTS2[CODE_POINTS2["LATIN_SMALL_Z"] = 122] = "LATIN_SMALL_Z";
})(CODE_POINTS || (CODE_POINTS = {}));

// node_modules/parse5/dist/common/error-codes.js
var ERR;
(function(ERR2) {
  ERR2["controlCharacterInInputStream"] = "control-character-in-input-stream";
  ERR2["noncharacterInInputStream"] = "noncharacter-in-input-stream";
  ERR2["surrogateInInputStream"] = "surrogate-in-input-stream";
  ERR2["nonVoidHtmlElementStartTagWithTrailingSolidus"] = "non-void-html-element-start-tag-with-trailing-solidus";
  ERR2["endTagWithAttributes"] = "end-tag-with-attributes";
  ERR2["endTagWithTrailingSolidus"] = "end-tag-with-trailing-solidus";
  ERR2["unexpectedSolidusInTag"] = "unexpected-solidus-in-tag";
  ERR2["unexpectedNullCharacter"] = "unexpected-null-character";
  ERR2["unexpectedQuestionMarkInsteadOfTagName"] = "unexpected-question-mark-instead-of-tag-name";
  ERR2["invalidFirstCharacterOfTagName"] = "invalid-first-character-of-tag-name";
  ERR2["unexpectedEqualsSignBeforeAttributeName"] = "unexpected-equals-sign-before-attribute-name";
  ERR2["missingEndTagName"] = "missing-end-tag-name";
  ERR2["unexpectedCharacterInAttributeName"] = "unexpected-character-in-attribute-name";
  ERR2["unknownNamedCharacterReference"] = "unknown-named-character-reference";
  ERR2["missingSemicolonAfterCharacterReference"] = "missing-semicolon-after-character-reference";
  ERR2["unexpectedCharacterAfterDoctypeSystemIdentifier"] = "unexpected-character-after-doctype-system-identifier";
  ERR2["unexpectedCharacterInUnquotedAttributeValue"] = "unexpected-character-in-unquoted-attribute-value";
  ERR2["eofBeforeTagName"] = "eof-before-tag-name";
  ERR2["eofInTag"] = "eof-in-tag";
  ERR2["missingAttributeValue"] = "missing-attribute-value";
  ERR2["missingWhitespaceBetweenAttributes"] = "missing-whitespace-between-attributes";
  ERR2["missingWhitespaceAfterDoctypePublicKeyword"] = "missing-whitespace-after-doctype-public-keyword";
  ERR2["missingWhitespaceBetweenDoctypePublicAndSystemIdentifiers"] = "missing-whitespace-between-doctype-public-and-system-identifiers";
  ERR2["missingWhitespaceAfterDoctypeSystemKeyword"] = "missing-whitespace-after-doctype-system-keyword";
  ERR2["missingQuoteBeforeDoctypePublicIdentifier"] = "missing-quote-before-doctype-public-identifier";
  ERR2["missingQuoteBeforeDoctypeSystemIdentifier"] = "missing-quote-before-doctype-system-identifier";
  ERR2["missingDoctypePublicIdentifier"] = "missing-doctype-public-identifier";
  ERR2["missingDoctypeSystemIdentifier"] = "missing-doctype-system-identifier";
  ERR2["abruptDoctypePublicIdentifier"] = "abrupt-doctype-public-identifier";
  ERR2["abruptDoctypeSystemIdentifier"] = "abrupt-doctype-system-identifier";
  ERR2["cdataInHtmlContent"] = "cdata-in-html-content";
  ERR2["incorrectlyOpenedComment"] = "incorrectly-opened-comment";
  ERR2["eofInScriptHtmlCommentLikeText"] = "eof-in-script-html-comment-like-text";
  ERR2["eofInDoctype"] = "eof-in-doctype";
  ERR2["nestedComment"] = "nested-comment";
  ERR2["abruptClosingOfEmptyComment"] = "abrupt-closing-of-empty-comment";
  ERR2["eofInComment"] = "eof-in-comment";
  ERR2["incorrectlyClosedComment"] = "incorrectly-closed-comment";
  ERR2["eofInCdata"] = "eof-in-cdata";
  ERR2["absenceOfDigitsInNumericCharacterReference"] = "absence-of-digits-in-numeric-character-reference";
  ERR2["nullCharacterReference"] = "null-character-reference";
  ERR2["surrogateCharacterReference"] = "surrogate-character-reference";
  ERR2["characterReferenceOutsideUnicodeRange"] = "character-reference-outside-unicode-range";
  ERR2["controlCharacterReference"] = "control-character-reference";
  ERR2["noncharacterCharacterReference"] = "noncharacter-character-reference";
  ERR2["missingWhitespaceBeforeDoctypeName"] = "missing-whitespace-before-doctype-name";
  ERR2["missingDoctypeName"] = "missing-doctype-name";
  ERR2["invalidCharacterSequenceAfterDoctypeName"] = "invalid-character-sequence-after-doctype-name";
  ERR2["duplicateAttribute"] = "duplicate-attribute";
  ERR2["nonConformingDoctype"] = "non-conforming-doctype";
  ERR2["missingDoctype"] = "missing-doctype";
  ERR2["misplacedDoctype"] = "misplaced-doctype";
  ERR2["endTagWithoutMatchingOpenElement"] = "end-tag-without-matching-open-element";
  ERR2["closingOfElementWithOpenChildElements"] = "closing-of-element-with-open-child-elements";
  ERR2["disallowedContentInNoscriptInHead"] = "disallowed-content-in-noscript-in-head";
  ERR2["openElementsLeftAfterEof"] = "open-elements-left-after-eof";
  ERR2["abandonedHeadElementChild"] = "abandoned-head-element-child";
  ERR2["misplacedStartTagForHeadElement"] = "misplaced-start-tag-for-head-element";
  ERR2["nestedNoscriptInHead"] = "nested-noscript-in-head";
  ERR2["eofInElementThatCanContainOnlyText"] = "eof-in-element-that-can-contain-only-text";
})(ERR || (ERR = {}));

// node_modules/parse5/dist/tokenizer/preprocessor.js
var DEFAULT_BUFFER_WATERLINE = 1 << 16;

// node_modules/parse5/dist/common/token.js
var TokenType;
(function(TokenType2) {
  TokenType2[TokenType2["CHARACTER"] = 0] = "CHARACTER";
  TokenType2[TokenType2["NULL_CHARACTER"] = 1] = "NULL_CHARACTER";
  TokenType2[TokenType2["WHITESPACE_CHARACTER"] = 2] = "WHITESPACE_CHARACTER";
  TokenType2[TokenType2["START_TAG"] = 3] = "START_TAG";
  TokenType2[TokenType2["END_TAG"] = 4] = "END_TAG";
  TokenType2[TokenType2["COMMENT"] = 5] = "COMMENT";
  TokenType2[TokenType2["DOCTYPE"] = 6] = "DOCTYPE";
  TokenType2[TokenType2["EOF"] = 7] = "EOF";
  TokenType2[TokenType2["HIBERNATION"] = 8] = "HIBERNATION";
})(TokenType || (TokenType = {}));

// node_modules/parse5/dist/common/html.js
var NS;
(function(NS2) {
  NS2["HTML"] = "http://www.w3.org/1999/xhtml";
  NS2["MATHML"] = "http://www.w3.org/1998/Math/MathML";
  NS2["SVG"] = "http://www.w3.org/2000/svg";
  NS2["XLINK"] = "http://www.w3.org/1999/xlink";
  NS2["XML"] = "http://www.w3.org/XML/1998/namespace";
  NS2["XMLNS"] = "http://www.w3.org/2000/xmlns/";
})(NS || (NS = {}));
var ATTRS;
(function(ATTRS2) {
  ATTRS2["TYPE"] = "type";
  ATTRS2["ACTION"] = "action";
  ATTRS2["ENCODING"] = "encoding";
  ATTRS2["PROMPT"] = "prompt";
  ATTRS2["NAME"] = "name";
  ATTRS2["COLOR"] = "color";
  ATTRS2["FACE"] = "face";
  ATTRS2["SIZE"] = "size";
})(ATTRS || (ATTRS = {}));
var DOCUMENT_MODE;
(function(DOCUMENT_MODE2) {
  DOCUMENT_MODE2["NO_QUIRKS"] = "no-quirks";
  DOCUMENT_MODE2["QUIRKS"] = "quirks";
  DOCUMENT_MODE2["LIMITED_QUIRKS"] = "limited-quirks";
})(DOCUMENT_MODE || (DOCUMENT_MODE = {}));
var TAG_NAMES;
(function(TAG_NAMES2) {
  TAG_NAMES2["A"] = "a";
  TAG_NAMES2["ADDRESS"] = "address";
  TAG_NAMES2["ANNOTATION_XML"] = "annotation-xml";
  TAG_NAMES2["APPLET"] = "applet";
  TAG_NAMES2["AREA"] = "area";
  TAG_NAMES2["ARTICLE"] = "article";
  TAG_NAMES2["ASIDE"] = "aside";
  TAG_NAMES2["B"] = "b";
  TAG_NAMES2["BASE"] = "base";
  TAG_NAMES2["BASEFONT"] = "basefont";
  TAG_NAMES2["BGSOUND"] = "bgsound";
  TAG_NAMES2["BIG"] = "big";
  TAG_NAMES2["BLOCKQUOTE"] = "blockquote";
  TAG_NAMES2["BODY"] = "body";
  TAG_NAMES2["BR"] = "br";
  TAG_NAMES2["BUTTON"] = "button";
  TAG_NAMES2["CAPTION"] = "caption";
  TAG_NAMES2["CENTER"] = "center";
  TAG_NAMES2["CODE"] = "code";
  TAG_NAMES2["COL"] = "col";
  TAG_NAMES2["COLGROUP"] = "colgroup";
  TAG_NAMES2["DD"] = "dd";
  TAG_NAMES2["DESC"] = "desc";
  TAG_NAMES2["DETAILS"] = "details";
  TAG_NAMES2["DIALOG"] = "dialog";
  TAG_NAMES2["DIR"] = "dir";
  TAG_NAMES2["DIV"] = "div";
  TAG_NAMES2["DL"] = "dl";
  TAG_NAMES2["DT"] = "dt";
  TAG_NAMES2["EM"] = "em";
  TAG_NAMES2["EMBED"] = "embed";
  TAG_NAMES2["FIELDSET"] = "fieldset";
  TAG_NAMES2["FIGCAPTION"] = "figcaption";
  TAG_NAMES2["FIGURE"] = "figure";
  TAG_NAMES2["FONT"] = "font";
  TAG_NAMES2["FOOTER"] = "footer";
  TAG_NAMES2["FOREIGN_OBJECT"] = "foreignObject";
  TAG_NAMES2["FORM"] = "form";
  TAG_NAMES2["FRAME"] = "frame";
  TAG_NAMES2["FRAMESET"] = "frameset";
  TAG_NAMES2["H1"] = "h1";
  TAG_NAMES2["H2"] = "h2";
  TAG_NAMES2["H3"] = "h3";
  TAG_NAMES2["H4"] = "h4";
  TAG_NAMES2["H5"] = "h5";
  TAG_NAMES2["H6"] = "h6";
  TAG_NAMES2["HEAD"] = "head";
  TAG_NAMES2["HEADER"] = "header";
  TAG_NAMES2["HGROUP"] = "hgroup";
  TAG_NAMES2["HR"] = "hr";
  TAG_NAMES2["HTML"] = "html";
  TAG_NAMES2["I"] = "i";
  TAG_NAMES2["IMG"] = "img";
  TAG_NAMES2["IMAGE"] = "image";
  TAG_NAMES2["INPUT"] = "input";
  TAG_NAMES2["IFRAME"] = "iframe";
  TAG_NAMES2["KEYGEN"] = "keygen";
  TAG_NAMES2["LABEL"] = "label";
  TAG_NAMES2["LI"] = "li";
  TAG_NAMES2["LINK"] = "link";
  TAG_NAMES2["LISTING"] = "listing";
  TAG_NAMES2["MAIN"] = "main";
  TAG_NAMES2["MALIGNMARK"] = "malignmark";
  TAG_NAMES2["MARQUEE"] = "marquee";
  TAG_NAMES2["MATH"] = "math";
  TAG_NAMES2["MENU"] = "menu";
  TAG_NAMES2["META"] = "meta";
  TAG_NAMES2["MGLYPH"] = "mglyph";
  TAG_NAMES2["MI"] = "mi";
  TAG_NAMES2["MO"] = "mo";
  TAG_NAMES2["MN"] = "mn";
  TAG_NAMES2["MS"] = "ms";
  TAG_NAMES2["MTEXT"] = "mtext";
  TAG_NAMES2["NAV"] = "nav";
  TAG_NAMES2["NOBR"] = "nobr";
  TAG_NAMES2["NOFRAMES"] = "noframes";
  TAG_NAMES2["NOEMBED"] = "noembed";
  TAG_NAMES2["NOSCRIPT"] = "noscript";
  TAG_NAMES2["OBJECT"] = "object";
  TAG_NAMES2["OL"] = "ol";
  TAG_NAMES2["OPTGROUP"] = "optgroup";
  TAG_NAMES2["OPTION"] = "option";
  TAG_NAMES2["P"] = "p";
  TAG_NAMES2["PARAM"] = "param";
  TAG_NAMES2["PLAINTEXT"] = "plaintext";
  TAG_NAMES2["PRE"] = "pre";
  TAG_NAMES2["RB"] = "rb";
  TAG_NAMES2["RP"] = "rp";
  TAG_NAMES2["RT"] = "rt";
  TAG_NAMES2["RTC"] = "rtc";
  TAG_NAMES2["RUBY"] = "ruby";
  TAG_NAMES2["S"] = "s";
  TAG_NAMES2["SCRIPT"] = "script";
  TAG_NAMES2["SEARCH"] = "search";
  TAG_NAMES2["SECTION"] = "section";
  TAG_NAMES2["SELECT"] = "select";
  TAG_NAMES2["SOURCE"] = "source";
  TAG_NAMES2["SMALL"] = "small";
  TAG_NAMES2["SPAN"] = "span";
  TAG_NAMES2["STRIKE"] = "strike";
  TAG_NAMES2["STRONG"] = "strong";
  TAG_NAMES2["STYLE"] = "style";
  TAG_NAMES2["SUB"] = "sub";
  TAG_NAMES2["SUMMARY"] = "summary";
  TAG_NAMES2["SUP"] = "sup";
  TAG_NAMES2["TABLE"] = "table";
  TAG_NAMES2["TBODY"] = "tbody";
  TAG_NAMES2["TEMPLATE"] = "template";
  TAG_NAMES2["TEXTAREA"] = "textarea";
  TAG_NAMES2["TFOOT"] = "tfoot";
  TAG_NAMES2["TD"] = "td";
  TAG_NAMES2["TH"] = "th";
  TAG_NAMES2["THEAD"] = "thead";
  TAG_NAMES2["TITLE"] = "title";
  TAG_NAMES2["TR"] = "tr";
  TAG_NAMES2["TRACK"] = "track";
  TAG_NAMES2["TT"] = "tt";
  TAG_NAMES2["U"] = "u";
  TAG_NAMES2["UL"] = "ul";
  TAG_NAMES2["SVG"] = "svg";
  TAG_NAMES2["VAR"] = "var";
  TAG_NAMES2["WBR"] = "wbr";
  TAG_NAMES2["XMP"] = "xmp";
})(TAG_NAMES || (TAG_NAMES = {}));
var TAG_ID;
(function(TAG_ID2) {
  TAG_ID2[TAG_ID2["UNKNOWN"] = 0] = "UNKNOWN";
  TAG_ID2[TAG_ID2["A"] = 1] = "A";
  TAG_ID2[TAG_ID2["ADDRESS"] = 2] = "ADDRESS";
  TAG_ID2[TAG_ID2["ANNOTATION_XML"] = 3] = "ANNOTATION_XML";
  TAG_ID2[TAG_ID2["APPLET"] = 4] = "APPLET";
  TAG_ID2[TAG_ID2["AREA"] = 5] = "AREA";
  TAG_ID2[TAG_ID2["ARTICLE"] = 6] = "ARTICLE";
  TAG_ID2[TAG_ID2["ASIDE"] = 7] = "ASIDE";
  TAG_ID2[TAG_ID2["B"] = 8] = "B";
  TAG_ID2[TAG_ID2["BASE"] = 9] = "BASE";
  TAG_ID2[TAG_ID2["BASEFONT"] = 10] = "BASEFONT";
  TAG_ID2[TAG_ID2["BGSOUND"] = 11] = "BGSOUND";
  TAG_ID2[TAG_ID2["BIG"] = 12] = "BIG";
  TAG_ID2[TAG_ID2["BLOCKQUOTE"] = 13] = "BLOCKQUOTE";
  TAG_ID2[TAG_ID2["BODY"] = 14] = "BODY";
  TAG_ID2[TAG_ID2["BR"] = 15] = "BR";
  TAG_ID2[TAG_ID2["BUTTON"] = 16] = "BUTTON";
  TAG_ID2[TAG_ID2["CAPTION"] = 17] = "CAPTION";
  TAG_ID2[TAG_ID2["CENTER"] = 18] = "CENTER";
  TAG_ID2[TAG_ID2["CODE"] = 19] = "CODE";
  TAG_ID2[TAG_ID2["COL"] = 20] = "COL";
  TAG_ID2[TAG_ID2["COLGROUP"] = 21] = "COLGROUP";
  TAG_ID2[TAG_ID2["DD"] = 22] = "DD";
  TAG_ID2[TAG_ID2["DESC"] = 23] = "DESC";
  TAG_ID2[TAG_ID2["DETAILS"] = 24] = "DETAILS";
  TAG_ID2[TAG_ID2["DIALOG"] = 25] = "DIALOG";
  TAG_ID2[TAG_ID2["DIR"] = 26] = "DIR";
  TAG_ID2[TAG_ID2["DIV"] = 27] = "DIV";
  TAG_ID2[TAG_ID2["DL"] = 28] = "DL";
  TAG_ID2[TAG_ID2["DT"] = 29] = "DT";
  TAG_ID2[TAG_ID2["EM"] = 30] = "EM";
  TAG_ID2[TAG_ID2["EMBED"] = 31] = "EMBED";
  TAG_ID2[TAG_ID2["FIELDSET"] = 32] = "FIELDSET";
  TAG_ID2[TAG_ID2["FIGCAPTION"] = 33] = "FIGCAPTION";
  TAG_ID2[TAG_ID2["FIGURE"] = 34] = "FIGURE";
  TAG_ID2[TAG_ID2["FONT"] = 35] = "FONT";
  TAG_ID2[TAG_ID2["FOOTER"] = 36] = "FOOTER";
  TAG_ID2[TAG_ID2["FOREIGN_OBJECT"] = 37] = "FOREIGN_OBJECT";
  TAG_ID2[TAG_ID2["FORM"] = 38] = "FORM";
  TAG_ID2[TAG_ID2["FRAME"] = 39] = "FRAME";
  TAG_ID2[TAG_ID2["FRAMESET"] = 40] = "FRAMESET";
  TAG_ID2[TAG_ID2["H1"] = 41] = "H1";
  TAG_ID2[TAG_ID2["H2"] = 42] = "H2";
  TAG_ID2[TAG_ID2["H3"] = 43] = "H3";
  TAG_ID2[TAG_ID2["H4"] = 44] = "H4";
  TAG_ID2[TAG_ID2["H5"] = 45] = "H5";
  TAG_ID2[TAG_ID2["H6"] = 46] = "H6";
  TAG_ID2[TAG_ID2["HEAD"] = 47] = "HEAD";
  TAG_ID2[TAG_ID2["HEADER"] = 48] = "HEADER";
  TAG_ID2[TAG_ID2["HGROUP"] = 49] = "HGROUP";
  TAG_ID2[TAG_ID2["HR"] = 50] = "HR";
  TAG_ID2[TAG_ID2["HTML"] = 51] = "HTML";
  TAG_ID2[TAG_ID2["I"] = 52] = "I";
  TAG_ID2[TAG_ID2["IMG"] = 53] = "IMG";
  TAG_ID2[TAG_ID2["IMAGE"] = 54] = "IMAGE";
  TAG_ID2[TAG_ID2["INPUT"] = 55] = "INPUT";
  TAG_ID2[TAG_ID2["IFRAME"] = 56] = "IFRAME";
  TAG_ID2[TAG_ID2["KEYGEN"] = 57] = "KEYGEN";
  TAG_ID2[TAG_ID2["LABEL"] = 58] = "LABEL";
  TAG_ID2[TAG_ID2["LI"] = 59] = "LI";
  TAG_ID2[TAG_ID2["LINK"] = 60] = "LINK";
  TAG_ID2[TAG_ID2["LISTING"] = 61] = "LISTING";
  TAG_ID2[TAG_ID2["MAIN"] = 62] = "MAIN";
  TAG_ID2[TAG_ID2["MALIGNMARK"] = 63] = "MALIGNMARK";
  TAG_ID2[TAG_ID2["MARQUEE"] = 64] = "MARQUEE";
  TAG_ID2[TAG_ID2["MATH"] = 65] = "MATH";
  TAG_ID2[TAG_ID2["MENU"] = 66] = "MENU";
  TAG_ID2[TAG_ID2["META"] = 67] = "META";
  TAG_ID2[TAG_ID2["MGLYPH"] = 68] = "MGLYPH";
  TAG_ID2[TAG_ID2["MI"] = 69] = "MI";
  TAG_ID2[TAG_ID2["MO"] = 70] = "MO";
  TAG_ID2[TAG_ID2["MN"] = 71] = "MN";
  TAG_ID2[TAG_ID2["MS"] = 72] = "MS";
  TAG_ID2[TAG_ID2["MTEXT"] = 73] = "MTEXT";
  TAG_ID2[TAG_ID2["NAV"] = 74] = "NAV";
  TAG_ID2[TAG_ID2["NOBR"] = 75] = "NOBR";
  TAG_ID2[TAG_ID2["NOFRAMES"] = 76] = "NOFRAMES";
  TAG_ID2[TAG_ID2["NOEMBED"] = 77] = "NOEMBED";
  TAG_ID2[TAG_ID2["NOSCRIPT"] = 78] = "NOSCRIPT";
  TAG_ID2[TAG_ID2["OBJECT"] = 79] = "OBJECT";
  TAG_ID2[TAG_ID2["OL"] = 80] = "OL";
  TAG_ID2[TAG_ID2["OPTGROUP"] = 81] = "OPTGROUP";
  TAG_ID2[TAG_ID2["OPTION"] = 82] = "OPTION";
  TAG_ID2[TAG_ID2["P"] = 83] = "P";
  TAG_ID2[TAG_ID2["PARAM"] = 84] = "PARAM";
  TAG_ID2[TAG_ID2["PLAINTEXT"] = 85] = "PLAINTEXT";
  TAG_ID2[TAG_ID2["PRE"] = 86] = "PRE";
  TAG_ID2[TAG_ID2["RB"] = 87] = "RB";
  TAG_ID2[TAG_ID2["RP"] = 88] = "RP";
  TAG_ID2[TAG_ID2["RT"] = 89] = "RT";
  TAG_ID2[TAG_ID2["RTC"] = 90] = "RTC";
  TAG_ID2[TAG_ID2["RUBY"] = 91] = "RUBY";
  TAG_ID2[TAG_ID2["S"] = 92] = "S";
  TAG_ID2[TAG_ID2["SCRIPT"] = 93] = "SCRIPT";
  TAG_ID2[TAG_ID2["SEARCH"] = 94] = "SEARCH";
  TAG_ID2[TAG_ID2["SECTION"] = 95] = "SECTION";
  TAG_ID2[TAG_ID2["SELECT"] = 96] = "SELECT";
  TAG_ID2[TAG_ID2["SOURCE"] = 97] = "SOURCE";
  TAG_ID2[TAG_ID2["SMALL"] = 98] = "SMALL";
  TAG_ID2[TAG_ID2["SPAN"] = 99] = "SPAN";
  TAG_ID2[TAG_ID2["STRIKE"] = 100] = "STRIKE";
  TAG_ID2[TAG_ID2["STRONG"] = 101] = "STRONG";
  TAG_ID2[TAG_ID2["STYLE"] = 102] = "STYLE";
  TAG_ID2[TAG_ID2["SUB"] = 103] = "SUB";
  TAG_ID2[TAG_ID2["SUMMARY"] = 104] = "SUMMARY";
  TAG_ID2[TAG_ID2["SUP"] = 105] = "SUP";
  TAG_ID2[TAG_ID2["TABLE"] = 106] = "TABLE";
  TAG_ID2[TAG_ID2["TBODY"] = 107] = "TBODY";
  TAG_ID2[TAG_ID2["TEMPLATE"] = 108] = "TEMPLATE";
  TAG_ID2[TAG_ID2["TEXTAREA"] = 109] = "TEXTAREA";
  TAG_ID2[TAG_ID2["TFOOT"] = 110] = "TFOOT";
  TAG_ID2[TAG_ID2["TD"] = 111] = "TD";
  TAG_ID2[TAG_ID2["TH"] = 112] = "TH";
  TAG_ID2[TAG_ID2["THEAD"] = 113] = "THEAD";
  TAG_ID2[TAG_ID2["TITLE"] = 114] = "TITLE";
  TAG_ID2[TAG_ID2["TR"] = 115] = "TR";
  TAG_ID2[TAG_ID2["TRACK"] = 116] = "TRACK";
  TAG_ID2[TAG_ID2["TT"] = 117] = "TT";
  TAG_ID2[TAG_ID2["U"] = 118] = "U";
  TAG_ID2[TAG_ID2["UL"] = 119] = "UL";
  TAG_ID2[TAG_ID2["SVG"] = 120] = "SVG";
  TAG_ID2[TAG_ID2["VAR"] = 121] = "VAR";
  TAG_ID2[TAG_ID2["WBR"] = 122] = "WBR";
  TAG_ID2[TAG_ID2["XMP"] = 123] = "XMP";
})(TAG_ID || (TAG_ID = {}));
var TAG_NAME_TO_ID = /* @__PURE__ */ new Map([
  [TAG_NAMES.A, TAG_ID.A],
  [TAG_NAMES.ADDRESS, TAG_ID.ADDRESS],
  [TAG_NAMES.ANNOTATION_XML, TAG_ID.ANNOTATION_XML],
  [TAG_NAMES.APPLET, TAG_ID.APPLET],
  [TAG_NAMES.AREA, TAG_ID.AREA],
  [TAG_NAMES.ARTICLE, TAG_ID.ARTICLE],
  [TAG_NAMES.ASIDE, TAG_ID.ASIDE],
  [TAG_NAMES.B, TAG_ID.B],
  [TAG_NAMES.BASE, TAG_ID.BASE],
  [TAG_NAMES.BASEFONT, TAG_ID.BASEFONT],
  [TAG_NAMES.BGSOUND, TAG_ID.BGSOUND],
  [TAG_NAMES.BIG, TAG_ID.BIG],
  [TAG_NAMES.BLOCKQUOTE, TAG_ID.BLOCKQUOTE],
  [TAG_NAMES.BODY, TAG_ID.BODY],
  [TAG_NAMES.BR, TAG_ID.BR],
  [TAG_NAMES.BUTTON, TAG_ID.BUTTON],
  [TAG_NAMES.CAPTION, TAG_ID.CAPTION],
  [TAG_NAMES.CENTER, TAG_ID.CENTER],
  [TAG_NAMES.CODE, TAG_ID.CODE],
  [TAG_NAMES.COL, TAG_ID.COL],
  [TAG_NAMES.COLGROUP, TAG_ID.COLGROUP],
  [TAG_NAMES.DD, TAG_ID.DD],
  [TAG_NAMES.DESC, TAG_ID.DESC],
  [TAG_NAMES.DETAILS, TAG_ID.DETAILS],
  [TAG_NAMES.DIALOG, TAG_ID.DIALOG],
  [TAG_NAMES.DIR, TAG_ID.DIR],
  [TAG_NAMES.DIV, TAG_ID.DIV],
  [TAG_NAMES.DL, TAG_ID.DL],
  [TAG_NAMES.DT, TAG_ID.DT],
  [TAG_NAMES.EM, TAG_ID.EM],
  [TAG_NAMES.EMBED, TAG_ID.EMBED],
  [TAG_NAMES.FIELDSET, TAG_ID.FIELDSET],
  [TAG_NAMES.FIGCAPTION, TAG_ID.FIGCAPTION],
  [TAG_NAMES.FIGURE, TAG_ID.FIGURE],
  [TAG_NAMES.FONT, TAG_ID.FONT],
  [TAG_NAMES.FOOTER, TAG_ID.FOOTER],
  [TAG_NAMES.FOREIGN_OBJECT, TAG_ID.FOREIGN_OBJECT],
  [TAG_NAMES.FORM, TAG_ID.FORM],
  [TAG_NAMES.FRAME, TAG_ID.FRAME],
  [TAG_NAMES.FRAMESET, TAG_ID.FRAMESET],
  [TAG_NAMES.H1, TAG_ID.H1],
  [TAG_NAMES.H2, TAG_ID.H2],
  [TAG_NAMES.H3, TAG_ID.H3],
  [TAG_NAMES.H4, TAG_ID.H4],
  [TAG_NAMES.H5, TAG_ID.H5],
  [TAG_NAMES.H6, TAG_ID.H6],
  [TAG_NAMES.HEAD, TAG_ID.HEAD],
  [TAG_NAMES.HEADER, TAG_ID.HEADER],
  [TAG_NAMES.HGROUP, TAG_ID.HGROUP],
  [TAG_NAMES.HR, TAG_ID.HR],
  [TAG_NAMES.HTML, TAG_ID.HTML],
  [TAG_NAMES.I, TAG_ID.I],
  [TAG_NAMES.IMG, TAG_ID.IMG],
  [TAG_NAMES.IMAGE, TAG_ID.IMAGE],
  [TAG_NAMES.INPUT, TAG_ID.INPUT],
  [TAG_NAMES.IFRAME, TAG_ID.IFRAME],
  [TAG_NAMES.KEYGEN, TAG_ID.KEYGEN],
  [TAG_NAMES.LABEL, TAG_ID.LABEL],
  [TAG_NAMES.LI, TAG_ID.LI],
  [TAG_NAMES.LINK, TAG_ID.LINK],
  [TAG_NAMES.LISTING, TAG_ID.LISTING],
  [TAG_NAMES.MAIN, TAG_ID.MAIN],
  [TAG_NAMES.MALIGNMARK, TAG_ID.MALIGNMARK],
  [TAG_NAMES.MARQUEE, TAG_ID.MARQUEE],
  [TAG_NAMES.MATH, TAG_ID.MATH],
  [TAG_NAMES.MENU, TAG_ID.MENU],
  [TAG_NAMES.META, TAG_ID.META],
  [TAG_NAMES.MGLYPH, TAG_ID.MGLYPH],
  [TAG_NAMES.MI, TAG_ID.MI],
  [TAG_NAMES.MO, TAG_ID.MO],
  [TAG_NAMES.MN, TAG_ID.MN],
  [TAG_NAMES.MS, TAG_ID.MS],
  [TAG_NAMES.MTEXT, TAG_ID.MTEXT],
  [TAG_NAMES.NAV, TAG_ID.NAV],
  [TAG_NAMES.NOBR, TAG_ID.NOBR],
  [TAG_NAMES.NOFRAMES, TAG_ID.NOFRAMES],
  [TAG_NAMES.NOEMBED, TAG_ID.NOEMBED],
  [TAG_NAMES.NOSCRIPT, TAG_ID.NOSCRIPT],
  [TAG_NAMES.OBJECT, TAG_ID.OBJECT],
  [TAG_NAMES.OL, TAG_ID.OL],
  [TAG_NAMES.OPTGROUP, TAG_ID.OPTGROUP],
  [TAG_NAMES.OPTION, TAG_ID.OPTION],
  [TAG_NAMES.P, TAG_ID.P],
  [TAG_NAMES.PARAM, TAG_ID.PARAM],
  [TAG_NAMES.PLAINTEXT, TAG_ID.PLAINTEXT],
  [TAG_NAMES.PRE, TAG_ID.PRE],
  [TAG_NAMES.RB, TAG_ID.RB],
  [TAG_NAMES.RP, TAG_ID.RP],
  [TAG_NAMES.RT, TAG_ID.RT],
  [TAG_NAMES.RTC, TAG_ID.RTC],
  [TAG_NAMES.RUBY, TAG_ID.RUBY],
  [TAG_NAMES.S, TAG_ID.S],
  [TAG_NAMES.SCRIPT, TAG_ID.SCRIPT],
  [TAG_NAMES.SEARCH, TAG_ID.SEARCH],
  [TAG_NAMES.SECTION, TAG_ID.SECTION],
  [TAG_NAMES.SELECT, TAG_ID.SELECT],
  [TAG_NAMES.SOURCE, TAG_ID.SOURCE],
  [TAG_NAMES.SMALL, TAG_ID.SMALL],
  [TAG_NAMES.SPAN, TAG_ID.SPAN],
  [TAG_NAMES.STRIKE, TAG_ID.STRIKE],
  [TAG_NAMES.STRONG, TAG_ID.STRONG],
  [TAG_NAMES.STYLE, TAG_ID.STYLE],
  [TAG_NAMES.SUB, TAG_ID.SUB],
  [TAG_NAMES.SUMMARY, TAG_ID.SUMMARY],
  [TAG_NAMES.SUP, TAG_ID.SUP],
  [TAG_NAMES.TABLE, TAG_ID.TABLE],
  [TAG_NAMES.TBODY, TAG_ID.TBODY],
  [TAG_NAMES.TEMPLATE, TAG_ID.TEMPLATE],
  [TAG_NAMES.TEXTAREA, TAG_ID.TEXTAREA],
  [TAG_NAMES.TFOOT, TAG_ID.TFOOT],
  [TAG_NAMES.TD, TAG_ID.TD],
  [TAG_NAMES.TH, TAG_ID.TH],
  [TAG_NAMES.THEAD, TAG_ID.THEAD],
  [TAG_NAMES.TITLE, TAG_ID.TITLE],
  [TAG_NAMES.TR, TAG_ID.TR],
  [TAG_NAMES.TRACK, TAG_ID.TRACK],
  [TAG_NAMES.TT, TAG_ID.TT],
  [TAG_NAMES.U, TAG_ID.U],
  [TAG_NAMES.UL, TAG_ID.UL],
  [TAG_NAMES.SVG, TAG_ID.SVG],
  [TAG_NAMES.VAR, TAG_ID.VAR],
  [TAG_NAMES.WBR, TAG_ID.WBR],
  [TAG_NAMES.XMP, TAG_ID.XMP]
]);
var $ = TAG_ID;
var SPECIAL_ELEMENTS = {
  [NS.HTML]: /* @__PURE__ */ new Set([
    $.ADDRESS,
    $.APPLET,
    $.AREA,
    $.ARTICLE,
    $.ASIDE,
    $.BASE,
    $.BASEFONT,
    $.BGSOUND,
    $.BLOCKQUOTE,
    $.BODY,
    $.BR,
    $.BUTTON,
    $.CAPTION,
    $.CENTER,
    $.COL,
    $.COLGROUP,
    $.DD,
    $.DETAILS,
    $.DIR,
    $.DIV,
    $.DL,
    $.DT,
    $.EMBED,
    $.FIELDSET,
    $.FIGCAPTION,
    $.FIGURE,
    $.FOOTER,
    $.FORM,
    $.FRAME,
    $.FRAMESET,
    $.H1,
    $.H2,
    $.H3,
    $.H4,
    $.H5,
    $.H6,
    $.HEAD,
    $.HEADER,
    $.HGROUP,
    $.HR,
    $.HTML,
    $.IFRAME,
    $.IMG,
    $.INPUT,
    $.LI,
    $.LINK,
    $.LISTING,
    $.MAIN,
    $.MARQUEE,
    $.MENU,
    $.META,
    $.NAV,
    $.NOEMBED,
    $.NOFRAMES,
    $.NOSCRIPT,
    $.OBJECT,
    $.OL,
    $.P,
    $.PARAM,
    $.PLAINTEXT,
    $.PRE,
    $.SCRIPT,
    $.SECTION,
    $.SELECT,
    $.SOURCE,
    $.STYLE,
    $.SUMMARY,
    $.TABLE,
    $.TBODY,
    $.TD,
    $.TEMPLATE,
    $.TEXTAREA,
    $.TFOOT,
    $.TH,
    $.THEAD,
    $.TITLE,
    $.TR,
    $.TRACK,
    $.UL,
    $.WBR,
    $.XMP
  ]),
  [NS.MATHML]: /* @__PURE__ */ new Set([$.MI, $.MO, $.MN, $.MS, $.MTEXT, $.ANNOTATION_XML]),
  [NS.SVG]: /* @__PURE__ */ new Set([$.TITLE, $.FOREIGN_OBJECT, $.DESC]),
  [NS.XLINK]: /* @__PURE__ */ new Set(),
  [NS.XML]: /* @__PURE__ */ new Set(),
  [NS.XMLNS]: /* @__PURE__ */ new Set()
};
var NUMBERED_HEADERS = /* @__PURE__ */ new Set([$.H1, $.H2, $.H3, $.H4, $.H5, $.H6]);
var UNESCAPED_TEXT = /* @__PURE__ */ new Set([
  TAG_NAMES.STYLE,
  TAG_NAMES.SCRIPT,
  TAG_NAMES.XMP,
  TAG_NAMES.IFRAME,
  TAG_NAMES.NOEMBED,
  TAG_NAMES.NOFRAMES,
  TAG_NAMES.PLAINTEXT
]);

// node_modules/parse5/dist/tokenizer/index.js
var State;
(function(State2) {
  State2[State2["DATA"] = 0] = "DATA";
  State2[State2["RCDATA"] = 1] = "RCDATA";
  State2[State2["RAWTEXT"] = 2] = "RAWTEXT";
  State2[State2["SCRIPT_DATA"] = 3] = "SCRIPT_DATA";
  State2[State2["PLAINTEXT"] = 4] = "PLAINTEXT";
  State2[State2["TAG_OPEN"] = 5] = "TAG_OPEN";
  State2[State2["END_TAG_OPEN"] = 6] = "END_TAG_OPEN";
  State2[State2["TAG_NAME"] = 7] = "TAG_NAME";
  State2[State2["RCDATA_LESS_THAN_SIGN"] = 8] = "RCDATA_LESS_THAN_SIGN";
  State2[State2["RCDATA_END_TAG_OPEN"] = 9] = "RCDATA_END_TAG_OPEN";
  State2[State2["RCDATA_END_TAG_NAME"] = 10] = "RCDATA_END_TAG_NAME";
  State2[State2["RAWTEXT_LESS_THAN_SIGN"] = 11] = "RAWTEXT_LESS_THAN_SIGN";
  State2[State2["RAWTEXT_END_TAG_OPEN"] = 12] = "RAWTEXT_END_TAG_OPEN";
  State2[State2["RAWTEXT_END_TAG_NAME"] = 13] = "RAWTEXT_END_TAG_NAME";
  State2[State2["SCRIPT_DATA_LESS_THAN_SIGN"] = 14] = "SCRIPT_DATA_LESS_THAN_SIGN";
  State2[State2["SCRIPT_DATA_END_TAG_OPEN"] = 15] = "SCRIPT_DATA_END_TAG_OPEN";
  State2[State2["SCRIPT_DATA_END_TAG_NAME"] = 16] = "SCRIPT_DATA_END_TAG_NAME";
  State2[State2["SCRIPT_DATA_ESCAPE_START"] = 17] = "SCRIPT_DATA_ESCAPE_START";
  State2[State2["SCRIPT_DATA_ESCAPE_START_DASH"] = 18] = "SCRIPT_DATA_ESCAPE_START_DASH";
  State2[State2["SCRIPT_DATA_ESCAPED"] = 19] = "SCRIPT_DATA_ESCAPED";
  State2[State2["SCRIPT_DATA_ESCAPED_DASH"] = 20] = "SCRIPT_DATA_ESCAPED_DASH";
  State2[State2["SCRIPT_DATA_ESCAPED_DASH_DASH"] = 21] = "SCRIPT_DATA_ESCAPED_DASH_DASH";
  State2[State2["SCRIPT_DATA_ESCAPED_LESS_THAN_SIGN"] = 22] = "SCRIPT_DATA_ESCAPED_LESS_THAN_SIGN";
  State2[State2["SCRIPT_DATA_ESCAPED_END_TAG_OPEN"] = 23] = "SCRIPT_DATA_ESCAPED_END_TAG_OPEN";
  State2[State2["SCRIPT_DATA_ESCAPED_END_TAG_NAME"] = 24] = "SCRIPT_DATA_ESCAPED_END_TAG_NAME";
  State2[State2["SCRIPT_DATA_DOUBLE_ESCAPE_START"] = 25] = "SCRIPT_DATA_DOUBLE_ESCAPE_START";
  State2[State2["SCRIPT_DATA_DOUBLE_ESCAPED"] = 26] = "SCRIPT_DATA_DOUBLE_ESCAPED";
  State2[State2["SCRIPT_DATA_DOUBLE_ESCAPED_DASH"] = 27] = "SCRIPT_DATA_DOUBLE_ESCAPED_DASH";
  State2[State2["SCRIPT_DATA_DOUBLE_ESCAPED_DASH_DASH"] = 28] = "SCRIPT_DATA_DOUBLE_ESCAPED_DASH_DASH";
  State2[State2["SCRIPT_DATA_DOUBLE_ESCAPED_LESS_THAN_SIGN"] = 29] = "SCRIPT_DATA_DOUBLE_ESCAPED_LESS_THAN_SIGN";
  State2[State2["SCRIPT_DATA_DOUBLE_ESCAPE_END"] = 30] = "SCRIPT_DATA_DOUBLE_ESCAPE_END";
  State2[State2["BEFORE_ATTRIBUTE_NAME"] = 31] = "BEFORE_ATTRIBUTE_NAME";
  State2[State2["ATTRIBUTE_NAME"] = 32] = "ATTRIBUTE_NAME";
  State2[State2["AFTER_ATTRIBUTE_NAME"] = 33] = "AFTER_ATTRIBUTE_NAME";
  State2[State2["BEFORE_ATTRIBUTE_VALUE"] = 34] = "BEFORE_ATTRIBUTE_VALUE";
  State2[State2["ATTRIBUTE_VALUE_DOUBLE_QUOTED"] = 35] = "ATTRIBUTE_VALUE_DOUBLE_QUOTED";
  State2[State2["ATTRIBUTE_VALUE_SINGLE_QUOTED"] = 36] = "ATTRIBUTE_VALUE_SINGLE_QUOTED";
  State2[State2["ATTRIBUTE_VALUE_UNQUOTED"] = 37] = "ATTRIBUTE_VALUE_UNQUOTED";
  State2[State2["AFTER_ATTRIBUTE_VALUE_QUOTED"] = 38] = "AFTER_ATTRIBUTE_VALUE_QUOTED";
  State2[State2["SELF_CLOSING_START_TAG"] = 39] = "SELF_CLOSING_START_TAG";
  State2[State2["BOGUS_COMMENT"] = 40] = "BOGUS_COMMENT";
  State2[State2["MARKUP_DECLARATION_OPEN"] = 41] = "MARKUP_DECLARATION_OPEN";
  State2[State2["COMMENT_START"] = 42] = "COMMENT_START";
  State2[State2["COMMENT_START_DASH"] = 43] = "COMMENT_START_DASH";
  State2[State2["COMMENT"] = 44] = "COMMENT";
  State2[State2["COMMENT_LESS_THAN_SIGN"] = 45] = "COMMENT_LESS_THAN_SIGN";
  State2[State2["COMMENT_LESS_THAN_SIGN_BANG"] = 46] = "COMMENT_LESS_THAN_SIGN_BANG";
  State2[State2["COMMENT_LESS_THAN_SIGN_BANG_DASH"] = 47] = "COMMENT_LESS_THAN_SIGN_BANG_DASH";
  State2[State2["COMMENT_LESS_THAN_SIGN_BANG_DASH_DASH"] = 48] = "COMMENT_LESS_THAN_SIGN_BANG_DASH_DASH";
  State2[State2["COMMENT_END_DASH"] = 49] = "COMMENT_END_DASH";
  State2[State2["COMMENT_END"] = 50] = "COMMENT_END";
  State2[State2["COMMENT_END_BANG"] = 51] = "COMMENT_END_BANG";
  State2[State2["DOCTYPE"] = 52] = "DOCTYPE";
  State2[State2["BEFORE_DOCTYPE_NAME"] = 53] = "BEFORE_DOCTYPE_NAME";
  State2[State2["DOCTYPE_NAME"] = 54] = "DOCTYPE_NAME";
  State2[State2["AFTER_DOCTYPE_NAME"] = 55] = "AFTER_DOCTYPE_NAME";
  State2[State2["AFTER_DOCTYPE_PUBLIC_KEYWORD"] = 56] = "AFTER_DOCTYPE_PUBLIC_KEYWORD";
  State2[State2["BEFORE_DOCTYPE_PUBLIC_IDENTIFIER"] = 57] = "BEFORE_DOCTYPE_PUBLIC_IDENTIFIER";
  State2[State2["DOCTYPE_PUBLIC_IDENTIFIER_DOUBLE_QUOTED"] = 58] = "DOCTYPE_PUBLIC_IDENTIFIER_DOUBLE_QUOTED";
  State2[State2["DOCTYPE_PUBLIC_IDENTIFIER_SINGLE_QUOTED"] = 59] = "DOCTYPE_PUBLIC_IDENTIFIER_SINGLE_QUOTED";
  State2[State2["AFTER_DOCTYPE_PUBLIC_IDENTIFIER"] = 60] = "AFTER_DOCTYPE_PUBLIC_IDENTIFIER";
  State2[State2["BETWEEN_DOCTYPE_PUBLIC_AND_SYSTEM_IDENTIFIERS"] = 61] = "BETWEEN_DOCTYPE_PUBLIC_AND_SYSTEM_IDENTIFIERS";
  State2[State2["AFTER_DOCTYPE_SYSTEM_KEYWORD"] = 62] = "AFTER_DOCTYPE_SYSTEM_KEYWORD";
  State2[State2["BEFORE_DOCTYPE_SYSTEM_IDENTIFIER"] = 63] = "BEFORE_DOCTYPE_SYSTEM_IDENTIFIER";
  State2[State2["DOCTYPE_SYSTEM_IDENTIFIER_DOUBLE_QUOTED"] = 64] = "DOCTYPE_SYSTEM_IDENTIFIER_DOUBLE_QUOTED";
  State2[State2["DOCTYPE_SYSTEM_IDENTIFIER_SINGLE_QUOTED"] = 65] = "DOCTYPE_SYSTEM_IDENTIFIER_SINGLE_QUOTED";
  State2[State2["AFTER_DOCTYPE_SYSTEM_IDENTIFIER"] = 66] = "AFTER_DOCTYPE_SYSTEM_IDENTIFIER";
  State2[State2["BOGUS_DOCTYPE"] = 67] = "BOGUS_DOCTYPE";
  State2[State2["CDATA_SECTION"] = 68] = "CDATA_SECTION";
  State2[State2["CDATA_SECTION_BRACKET"] = 69] = "CDATA_SECTION_BRACKET";
  State2[State2["CDATA_SECTION_END"] = 70] = "CDATA_SECTION_END";
  State2[State2["CHARACTER_REFERENCE"] = 71] = "CHARACTER_REFERENCE";
  State2[State2["AMBIGUOUS_AMPERSAND"] = 72] = "AMBIGUOUS_AMPERSAND";
})(State || (State = {}));
var TokenizerMode = {
  DATA: State.DATA,
  RCDATA: State.RCDATA,
  RAWTEXT: State.RAWTEXT,
  SCRIPT_DATA: State.SCRIPT_DATA,
  PLAINTEXT: State.PLAINTEXT,
  CDATA_SECTION: State.CDATA_SECTION
};

// node_modules/parse5/dist/parser/open-element-stack.js
var IMPLICIT_END_TAG_REQUIRED = /* @__PURE__ */ new Set([TAG_ID.DD, TAG_ID.DT, TAG_ID.LI, TAG_ID.OPTGROUP, TAG_ID.OPTION, TAG_ID.P, TAG_ID.RB, TAG_ID.RP, TAG_ID.RT, TAG_ID.RTC]);
var IMPLICIT_END_TAG_REQUIRED_THOROUGHLY = /* @__PURE__ */ new Set([
  ...IMPLICIT_END_TAG_REQUIRED,
  TAG_ID.CAPTION,
  TAG_ID.COLGROUP,
  TAG_ID.TBODY,
  TAG_ID.TD,
  TAG_ID.TFOOT,
  TAG_ID.TH,
  TAG_ID.THEAD,
  TAG_ID.TR
]);
var SCOPING_ELEMENTS_HTML = /* @__PURE__ */ new Set([
  TAG_ID.APPLET,
  TAG_ID.CAPTION,
  TAG_ID.HTML,
  TAG_ID.MARQUEE,
  TAG_ID.OBJECT,
  TAG_ID.TABLE,
  TAG_ID.TD,
  TAG_ID.TEMPLATE,
  TAG_ID.TH
]);
var SCOPING_ELEMENTS_HTML_LIST = /* @__PURE__ */ new Set([...SCOPING_ELEMENTS_HTML, TAG_ID.OL, TAG_ID.UL]);
var SCOPING_ELEMENTS_HTML_BUTTON = /* @__PURE__ */ new Set([...SCOPING_ELEMENTS_HTML, TAG_ID.BUTTON]);
var SCOPING_ELEMENTS_MATHML = /* @__PURE__ */ new Set([TAG_ID.ANNOTATION_XML, TAG_ID.MI, TAG_ID.MN, TAG_ID.MO, TAG_ID.MS, TAG_ID.MTEXT]);
var SCOPING_ELEMENTS_SVG = /* @__PURE__ */ new Set([TAG_ID.DESC, TAG_ID.FOREIGN_OBJECT, TAG_ID.TITLE]);
var TABLE_ROW_CONTEXT = /* @__PURE__ */ new Set([TAG_ID.TR, TAG_ID.TEMPLATE, TAG_ID.HTML]);
var TABLE_BODY_CONTEXT = /* @__PURE__ */ new Set([TAG_ID.TBODY, TAG_ID.TFOOT, TAG_ID.THEAD, TAG_ID.TEMPLATE, TAG_ID.HTML]);
var TABLE_CONTEXT = /* @__PURE__ */ new Set([TAG_ID.TABLE, TAG_ID.TEMPLATE, TAG_ID.HTML]);
var TABLE_CELLS = /* @__PURE__ */ new Set([TAG_ID.TD, TAG_ID.TH]);

// node_modules/parse5/dist/parser/formatting-element-list.js
var EntryType;
(function(EntryType2) {
  EntryType2[EntryType2["Marker"] = 0] = "Marker";
  EntryType2[EntryType2["Element"] = 1] = "Element";
})(EntryType || (EntryType = {}));
var MARKER = { type: EntryType.Marker };

// node_modules/parse5/dist/common/doctype.js
var QUIRKS_MODE_PUBLIC_ID_PREFIXES = [
  "+//silmaril//dtd html pro v0r11 19970101//",
  "-//as//dtd html 3.0 aswedit + extensions//",
  "-//advasoft ltd//dtd html 3.0 aswedit + extensions//",
  "-//ietf//dtd html 2.0 level 1//",
  "-//ietf//dtd html 2.0 level 2//",
  "-//ietf//dtd html 2.0 strict level 1//",
  "-//ietf//dtd html 2.0 strict level 2//",
  "-//ietf//dtd html 2.0 strict//",
  "-//ietf//dtd html 2.0//",
  "-//ietf//dtd html 2.1e//",
  "-//ietf//dtd html 3.0//",
  "-//ietf//dtd html 3.2 final//",
  "-//ietf//dtd html 3.2//",
  "-//ietf//dtd html 3//",
  "-//ietf//dtd html level 0//",
  "-//ietf//dtd html level 1//",
  "-//ietf//dtd html level 2//",
  "-//ietf//dtd html level 3//",
  "-//ietf//dtd html strict level 0//",
  "-//ietf//dtd html strict level 1//",
  "-//ietf//dtd html strict level 2//",
  "-//ietf//dtd html strict level 3//",
  "-//ietf//dtd html strict//",
  "-//ietf//dtd html//",
  "-//metrius//dtd metrius presentational//",
  "-//microsoft//dtd internet explorer 2.0 html strict//",
  "-//microsoft//dtd internet explorer 2.0 html//",
  "-//microsoft//dtd internet explorer 2.0 tables//",
  "-//microsoft//dtd internet explorer 3.0 html strict//",
  "-//microsoft//dtd internet explorer 3.0 html//",
  "-//microsoft//dtd internet explorer 3.0 tables//",
  "-//netscape comm. corp.//dtd html//",
  "-//netscape comm. corp.//dtd strict html//",
  "-//o'reilly and associates//dtd html 2.0//",
  "-//o'reilly and associates//dtd html extended 1.0//",
  "-//o'reilly and associates//dtd html extended relaxed 1.0//",
  "-//sq//dtd html 2.0 hotmetal + extensions//",
  "-//softquad software//dtd hotmetal pro 6.0::19990601::extensions to html 4.0//",
  "-//softquad//dtd hotmetal pro 4.0::19971010::extensions to html 4.0//",
  "-//spyglass//dtd html 2.0 extended//",
  "-//sun microsystems corp.//dtd hotjava html//",
  "-//sun microsystems corp.//dtd hotjava strict html//",
  "-//w3c//dtd html 3 1995-03-24//",
  "-//w3c//dtd html 3.2 draft//",
  "-//w3c//dtd html 3.2 final//",
  "-//w3c//dtd html 3.2//",
  "-//w3c//dtd html 3.2s draft//",
  "-//w3c//dtd html 4.0 frameset//",
  "-//w3c//dtd html 4.0 transitional//",
  "-//w3c//dtd html experimental 19960712//",
  "-//w3c//dtd html experimental 970421//",
  "-//w3c//dtd w3 html//",
  "-//w3o//dtd w3 html 3.0//",
  "-//webtechs//dtd mozilla html 2.0//",
  "-//webtechs//dtd mozilla html//"
];
var QUIRKS_MODE_NO_SYSTEM_ID_PUBLIC_ID_PREFIXES = [
  ...QUIRKS_MODE_PUBLIC_ID_PREFIXES,
  "-//w3c//dtd html 4.01 frameset//",
  "-//w3c//dtd html 4.01 transitional//"
];
var LIMITED_QUIRKS_PUBLIC_ID_PREFIXES = ["-//w3c//dtd xhtml 1.0 frameset//", "-//w3c//dtd xhtml 1.0 transitional//"];
var LIMITED_QUIRKS_WITH_SYSTEM_ID_PUBLIC_ID_PREFIXES = [
  ...LIMITED_QUIRKS_PUBLIC_ID_PREFIXES,
  "-//w3c//dtd html 4.01 frameset//",
  "-//w3c//dtd html 4.01 transitional//"
];

// node_modules/parse5/dist/common/foreign-content.js
var SVG_ATTRS_ADJUSTMENT_MAP = new Map([
  "attributeName",
  "attributeType",
  "baseFrequency",
  "baseProfile",
  "calcMode",
  "clipPathUnits",
  "diffuseConstant",
  "edgeMode",
  "filterUnits",
  "glyphRef",
  "gradientTransform",
  "gradientUnits",
  "kernelMatrix",
  "kernelUnitLength",
  "keyPoints",
  "keySplines",
  "keyTimes",
  "lengthAdjust",
  "limitingConeAngle",
  "markerHeight",
  "markerUnits",
  "markerWidth",
  "maskContentUnits",
  "maskUnits",
  "numOctaves",
  "pathLength",
  "patternContentUnits",
  "patternTransform",
  "patternUnits",
  "pointsAtX",
  "pointsAtY",
  "pointsAtZ",
  "preserveAlpha",
  "preserveAspectRatio",
  "primitiveUnits",
  "refX",
  "refY",
  "repeatCount",
  "repeatDur",
  "requiredExtensions",
  "requiredFeatures",
  "specularConstant",
  "specularExponent",
  "spreadMethod",
  "startOffset",
  "stdDeviation",
  "stitchTiles",
  "surfaceScale",
  "systemLanguage",
  "tableValues",
  "targetX",
  "targetY",
  "textLength",
  "viewBox",
  "viewTarget",
  "xChannelSelector",
  "yChannelSelector",
  "zoomAndPan"
].map((attr) => [attr.toLowerCase(), attr]));
var XML_ATTRS_ADJUSTMENT_MAP = /* @__PURE__ */ new Map([
  ["xlink:actuate", { prefix: "xlink", name: "actuate", namespace: NS.XLINK }],
  ["xlink:arcrole", { prefix: "xlink", name: "arcrole", namespace: NS.XLINK }],
  ["xlink:href", { prefix: "xlink", name: "href", namespace: NS.XLINK }],
  ["xlink:role", { prefix: "xlink", name: "role", namespace: NS.XLINK }],
  ["xlink:show", { prefix: "xlink", name: "show", namespace: NS.XLINK }],
  ["xlink:title", { prefix: "xlink", name: "title", namespace: NS.XLINK }],
  ["xlink:type", { prefix: "xlink", name: "type", namespace: NS.XLINK }],
  ["xml:lang", { prefix: "xml", name: "lang", namespace: NS.XML }],
  ["xml:space", { prefix: "xml", name: "space", namespace: NS.XML }],
  ["xmlns", { prefix: "", name: "xmlns", namespace: NS.XMLNS }],
  ["xmlns:xlink", { prefix: "xmlns", name: "xlink", namespace: NS.XMLNS }]
]);
var SVG_TAG_NAMES_ADJUSTMENT_MAP = new Map([
  "altGlyph",
  "altGlyphDef",
  "altGlyphItem",
  "animateColor",
  "animateMotion",
  "animateTransform",
  "clipPath",
  "feBlend",
  "feColorMatrix",
  "feComponentTransfer",
  "feComposite",
  "feConvolveMatrix",
  "feDiffuseLighting",
  "feDisplacementMap",
  "feDistantLight",
  "feFlood",
  "feFuncA",
  "feFuncB",
  "feFuncG",
  "feFuncR",
  "feGaussianBlur",
  "feImage",
  "feMerge",
  "feMergeNode",
  "feMorphology",
  "feOffset",
  "fePointLight",
  "feSpecularLighting",
  "feSpotLight",
  "feTile",
  "feTurbulence",
  "foreignObject",
  "glyphRef",
  "linearGradient",
  "radialGradient",
  "textPath"
].map((tn) => [tn.toLowerCase(), tn]));
var EXITS_FOREIGN_CONTENT = /* @__PURE__ */ new Set([
  TAG_ID.B,
  TAG_ID.BIG,
  TAG_ID.BLOCKQUOTE,
  TAG_ID.BODY,
  TAG_ID.BR,
  TAG_ID.CENTER,
  TAG_ID.CODE,
  TAG_ID.DD,
  TAG_ID.DIV,
  TAG_ID.DL,
  TAG_ID.DT,
  TAG_ID.EM,
  TAG_ID.EMBED,
  TAG_ID.H1,
  TAG_ID.H2,
  TAG_ID.H3,
  TAG_ID.H4,
  TAG_ID.H5,
  TAG_ID.H6,
  TAG_ID.HEAD,
  TAG_ID.HR,
  TAG_ID.I,
  TAG_ID.IMG,
  TAG_ID.LI,
  TAG_ID.LISTING,
  TAG_ID.MENU,
  TAG_ID.META,
  TAG_ID.NOBR,
  TAG_ID.OL,
  TAG_ID.P,
  TAG_ID.PRE,
  TAG_ID.RUBY,
  TAG_ID.S,
  TAG_ID.SMALL,
  TAG_ID.SPAN,
  TAG_ID.STRONG,
  TAG_ID.STRIKE,
  TAG_ID.SUB,
  TAG_ID.SUP,
  TAG_ID.TABLE,
  TAG_ID.TT,
  TAG_ID.U,
  TAG_ID.UL,
  TAG_ID.VAR
]);

// node_modules/parse5/dist/parser/index.js
var InsertionMode;
(function(InsertionMode2) {
  InsertionMode2[InsertionMode2["INITIAL"] = 0] = "INITIAL";
  InsertionMode2[InsertionMode2["BEFORE_HTML"] = 1] = "BEFORE_HTML";
  InsertionMode2[InsertionMode2["BEFORE_HEAD"] = 2] = "BEFORE_HEAD";
  InsertionMode2[InsertionMode2["IN_HEAD"] = 3] = "IN_HEAD";
  InsertionMode2[InsertionMode2["IN_HEAD_NO_SCRIPT"] = 4] = "IN_HEAD_NO_SCRIPT";
  InsertionMode2[InsertionMode2["AFTER_HEAD"] = 5] = "AFTER_HEAD";
  InsertionMode2[InsertionMode2["IN_BODY"] = 6] = "IN_BODY";
  InsertionMode2[InsertionMode2["TEXT"] = 7] = "TEXT";
  InsertionMode2[InsertionMode2["IN_TABLE"] = 8] = "IN_TABLE";
  InsertionMode2[InsertionMode2["IN_TABLE_TEXT"] = 9] = "IN_TABLE_TEXT";
  InsertionMode2[InsertionMode2["IN_CAPTION"] = 10] = "IN_CAPTION";
  InsertionMode2[InsertionMode2["IN_COLUMN_GROUP"] = 11] = "IN_COLUMN_GROUP";
  InsertionMode2[InsertionMode2["IN_TABLE_BODY"] = 12] = "IN_TABLE_BODY";
  InsertionMode2[InsertionMode2["IN_ROW"] = 13] = "IN_ROW";
  InsertionMode2[InsertionMode2["IN_CELL"] = 14] = "IN_CELL";
  InsertionMode2[InsertionMode2["IN_SELECT"] = 15] = "IN_SELECT";
  InsertionMode2[InsertionMode2["IN_SELECT_IN_TABLE"] = 16] = "IN_SELECT_IN_TABLE";
  InsertionMode2[InsertionMode2["IN_TEMPLATE"] = 17] = "IN_TEMPLATE";
  InsertionMode2[InsertionMode2["AFTER_BODY"] = 18] = "AFTER_BODY";
  InsertionMode2[InsertionMode2["IN_FRAMESET"] = 19] = "IN_FRAMESET";
  InsertionMode2[InsertionMode2["AFTER_FRAMESET"] = 20] = "AFTER_FRAMESET";
  InsertionMode2[InsertionMode2["AFTER_AFTER_BODY"] = 21] = "AFTER_AFTER_BODY";
  InsertionMode2[InsertionMode2["AFTER_AFTER_FRAMESET"] = 22] = "AFTER_AFTER_FRAMESET";
})(InsertionMode || (InsertionMode = {}));
var TABLE_STRUCTURE_TAGS = /* @__PURE__ */ new Set([TAG_ID.TABLE, TAG_ID.TBODY, TAG_ID.TFOOT, TAG_ID.THEAD, TAG_ID.TR]);
var TABLE_VOID_ELEMENTS = /* @__PURE__ */ new Set([TAG_ID.CAPTION, TAG_ID.COL, TAG_ID.COLGROUP, TAG_ID.TBODY, TAG_ID.TD, TAG_ID.TFOOT, TAG_ID.TH, TAG_ID.THEAD, TAG_ID.TR]);

// node_modules/parse5/dist/serializer/index.js
var VOID_ELEMENTS = /* @__PURE__ */ new Set([
  TAG_NAMES.AREA,
  TAG_NAMES.BASE,
  TAG_NAMES.BASEFONT,
  TAG_NAMES.BGSOUND,
  TAG_NAMES.BR,
  TAG_NAMES.COL,
  TAG_NAMES.EMBED,
  TAG_NAMES.FRAME,
  TAG_NAMES.HR,
  TAG_NAMES.IMG,
  TAG_NAMES.INPUT,
  TAG_NAMES.KEYGEN,
  TAG_NAMES.LINK,
  TAG_NAMES.META,
  TAG_NAMES.PARAM,
  TAG_NAMES.SOURCE,
  TAG_NAMES.TRACK,
  TAG_NAMES.WBR
]);

// packages/i18n/src/index.ts
var MAC_KEY_NAMES = {
  "\u232B": "Backspace",
  "\u2326": "Delete",
  "\u23CE": "Enter",
  "\u21A9": "Enter",
  "\u2423": "Space"
};
var HAS_MAC_SYMBOL = /[⌘⌃⌥⇧⌫⌦⏎↩␣]/;
var CHORD = /([⌘⌃⌥⇧]+)(F\d{1,2}|[A-Za-z0-9±=`'\\,./;[\]\-←↑→↓⌫⌦⏎↩␣]|\+)?/g;
function chordToWin(mods, key) {
  const parts = [];
  if (mods.includes("\u2318") || mods.includes("\u2303")) parts.push("Ctrl");
  if (mods.includes("\u2325")) parts.push("Alt");
  if (mods.includes("\u21E7")) parts.push("Shift");
  if (key) parts.push(MAC_KEY_NAMES[key] ?? key);
  return parts.join("+");
}
function macShortcutsToWin(text) {
  if (!HAS_MAC_SYMBOL.test(text)) return text;
  return text.replace(new RegExp("\u2318\\/(?=\\p{L}{2})", "gu"), "").replace(
    CHORD,
    (_m, mods, key) => key === "+" ? `${chordToWin(mods, void 0)}+` : chordToWin(mods, key)
  ).replace(/[⌫⌦⏎↩␣]/g, (glyph) => MAC_KEY_NAMES[glyph] ?? glyph);
}
var IS_MAC = (() => {
  const g = globalThis;
  if (g.navigator?.platform) return /mac/i.test(g.navigator.platform);
  return g.process?.platform === "darwin";
})();
var platformShortcuts = IS_MAC ? (text) => text : macShortcutsToWin;
function format(template, params) {
  if (!params) return template;
  return template.replace(
    /\{(\w+)\}/g,
    (match, name) => name in params ? String(params[name]) : match
  );
}
var uiLang = "zh";
function getUiLang() {
  return uiLang;
}
function createI18n(dicts) {
  return (lang, key, params) => platformShortcuts(format(dicts[lang][key], params));
}

// packages/ai-search/src/shared.ts
function asRecord(v) {
  return typeof v === "object" && v !== null ? v : {};
}
function firstItem(v) {
  return Array.isArray(v) ? v[0] : void 0;
}
var explicitProxyUrl = "";
function gskProxyUrl() {
  return explicitProxyUrl;
}

// packages/ai-search/src/gsk.ts
var import_node_child_process = require("node:child_process");
var import_node_fs4 = require("node:fs");
var import_node_os3 = require("node:os");
var import_node_path5 = require("node:path");
var import_node_module = require("node:module");

// packages/ai-search/src/genoffice-auth.ts
var import_node_fs3 = require("node:fs");
var import_node_os2 = require("node:os");
var import_node_path4 = require("node:path");
function genofficeAuthPath() {
  return (0, import_node_path4.join)(process.env.GENOFFICE_AUTH_DIR || (0, import_node_path4.join)((0, import_node_os2.homedir)(), ".genoffice"), "auth.json");
}
var cachedAuth;
function readAuthFile() {
  try {
    const raw = asRecord(JSON.parse((0, import_node_fs3.readFileSync)(genofficeAuthPath(), "utf-8")));
    if (typeof raw.api_key !== "string" || !raw.api_key) return null;
    return {
      apiKey: raw.api_key,
      ...typeof raw.key_id === "string" && raw.key_id ? { keyId: raw.key_id } : {},
      ...typeof raw.access_token === "string" && raw.access_token ? { accessToken: raw.access_token } : {}
    };
  } catch {
    return null;
  }
}
function loadGenofficeAuth() {
  if (cachedAuth === void 0) cachedAuth = readAuthFile();
  return cachedAuth;
}
function genofficeApiKey() {
  return loadGenofficeAuth()?.apiKey ?? "";
}

// packages/ai-search/src/gsk.ts
var import_meta = {};
var SEARCH_TIMEOUT_MS = 6e4;
var GENERATE_TIMEOUT_MS = 6e5;
var MAX_BUFFER = 32 * 1024 * 1024;
var cachedEntry;
function resolveGskEntry() {
  if (process.env.GSK_CLI_PATH) return process.env.GSK_CLI_PATH;
  if (cachedEntry !== void 0) return cachedEntry;
  try {
    const require2 = (0, import_node_module.createRequire)(import_meta.url);
    cachedEntry = require2.resolve("@genspark/cli/dist/index.js");
  } catch {
    const resourcesPath = process.resourcesPath;
    const packed = resourcesPath ? (0, import_node_path5.join)(resourcesPath, "gsk", "node_modules", "@genspark", "cli", "dist", "index.js") : null;
    cachedEntry = packed && (0, import_node_fs4.existsSync)(packed) ? packed : null;
  }
  return cachedEntry;
}
var compatPath;
function electronCompatArgs() {
  if (!process.versions.electron) return [];
  if (compatPath === void 0) {
    try {
      const dir = (0, import_node_path5.join)((0, import_node_os3.homedir)(), ".genoffice", "bin");
      (0, import_node_fs4.mkdirSync)(dir, { recursive: true });
      compatPath = (0, import_node_path5.join)(dir, "electron-compat.js");
      (0, import_node_fs4.writeFileSync)(compatPath, "delete process.versions.electron;\n");
    } catch {
      compatPath = null;
    }
  }
  return compatPath ? ["--require", compatPath] : [];
}
function gskApiKey() {
  if (process.env.GSK_API_KEY) return process.env.GSK_API_KEY;
  const own = genofficeApiKey();
  if (own) return own;
  try {
    const configPath = (0, import_node_path5.join)((0, import_node_os3.homedir)(), ".genspark-tool-cli", "config.json");
    if (!(0, import_node_fs4.existsSync)(configPath)) return "";
    const config = JSON.parse((0, import_node_fs4.readFileSync)(configPath, "utf-8"));
    return config.api_key ?? "";
  } catch {
    return "";
  }
}
function hasGskAuth() {
  if (process.env.AI_SEARCH_DISABLE_GSK === "1") return false;
  return !!gskApiKey() && resolveGskEntry() !== null;
}
function gskChildEnv(base = process.env) {
  const env = { ...base, ELECTRON_RUN_AS_NODE: "1" };
  const proxy = [
    gskProxyUrl(),
    base.HTTPS_PROXY,
    base.https_proxy,
    base.HTTP_PROXY,
    base.http_proxy,
    base.ALL_PROXY,
    base.all_proxy
  ].find((v) => v && /^https?:\/\//.test(v));
  if (proxy) {
    delete env.https_proxy;
    delete env.http_proxy;
    delete env.ALL_PROXY;
    delete env.all_proxy;
    env.NODE_USE_ENV_PROXY = "1";
    env.HTTPS_PROXY = proxy;
    env.HTTP_PROXY = proxy;
  }
  return env;
}
function parseGskOutput(stdout) {
  const trimmed = stdout.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
  }
  const lines = trimmed.split("\n");
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i].trim();
    if (line.startsWith("{") || line.startsWith("[")) {
      try {
        return JSON.parse(lines.slice(i).join("\n"));
      } catch {
        continue;
      }
    }
  }
  throw new Error(`No JSON found in gsk output: ${stdout.slice(0, 300)}`);
}
function runGsk(args, timeoutMs, signal) {
  const entry = resolveGskEntry();
  if (!entry) return Promise.reject(new Error("@genspark/cli is not installed"));
  const key = gskApiKey();
  return new Promise((resolve5, reject) => {
    (0, import_node_child_process.execFile)(
      process.execPath,
      [...electronCompatArgs(), entry, ...args, "--output", "json"],
      {
        timeout: timeoutMs,
        maxBuffer: MAX_BUFFER,
        env: {
          ...gskChildEnv(),
          ...key ? { GSK_API_KEY: key } : {}
        },
        ...signal ? { signal } : {}
      },
      (err, stdout, stderr) => {
        if (err) {
          const errText = (stderr || "").toString().trim().slice(0, 500);
          reject(errText ? new Error(`${err.message} | stderr: ${errText}`) : err);
          return;
        }
        try {
          const result = parseGskOutput(String(stdout));
          const rec = asRecord(result);
          if (rec.status && rec.status !== "ok") {
            reject(new Error(`gsk returned an error: ${rec.message ?? rec.status}`));
            return;
          }
          resolve5(result);
        } catch (parseErr) {
          reject(parseErr);
        }
      }
    );
  });
}
function parseGskGeneratedImage(raw) {
  const data = asRecord(asRecord(raw).data ?? raw);
  const img = asRecord(firstItem(data.generated_images ?? data.images ?? []));
  const url = firstItem(img.image_urls_nowatermark) ?? firstItem(img.image_urls) ?? img.url ?? "";
  if (!url) {
    throw new Error(`gsk image generation returned no result: ${JSON.stringify(raw).slice(0, 200)}`);
  }
  return { url: String(url), taskId: String(img.task_id ?? "") };
}
async function gskGenerateImage(options, signal) {
  const args = ["img", options.prompt];
  if (options.model) args.push("-m", options.model);
  if (options.referenceImageUrls?.length) args.push("--image_urls", ...options.referenceImageUrls);
  if (options.aspectRatio) args.push("--aspect_ratio", options.aspectRatio);
  if (options.imageSize) args.push("--image_size", options.imageSize);
  const raw = await runGsk(args, GENERATE_TIMEOUT_MS, signal);
  const result = parseGskGeneratedImage(raw);
  result.url = await gskResolveDownloadUrl(result.url);
  return result;
}
async function gskResolveDownloadUrl(url) {
  if (!url.includes("/api/files/")) return url;
  try {
    const raw = asRecord(await runGsk(["download", url], SEARCH_TIMEOUT_MS));
    const downloadUrl = asRecord(raw.data).download_url ?? raw.download_url;
    return downloadUrl ? String(downloadUrl) : url;
  } catch {
    return url;
  }
}

// packages/ai-search/src/media-tools.ts
var import_node_fs5 = require("node:fs");
var import_node_path6 = require("node:path");

// packages/ai-provider/src/media.ts
var OPENAI_IMAGES_BASE_URL = "https://api.openai.com/v1";
var GEMINI_MEDIA_BASE_URL = "https://generativelanguage.googleapis.com/v1beta";
var ARK_BASE_URL = "https://ark.cn-beijing.volces.com/api/v3";
var ZHIPU_BASE_URL = "https://open.bigmodel.cn/api/paas/v4";
var XAI_BASE_URL = "https://api.x.ai/v1";
var DASHSCOPE_BASE_URL = "https://dashscope.aliyuncs.com";
var MINIMAX_BASE_URL = "https://api.minimax.io/v1";
var AI_MEDIA_PROVIDERS = [
  {
    id: "genspark",
    label: "Genspark",
    description: "Image generation, media analysis and search through your Genspark sign-in",
    keyPlaceholder: "Not required - sign in to Genspark",
    defaultBaseUrl: "",
    imageProtocol: "openai-images",
    imageModels: [],
    defaultImageModel: "",
    analysisProtocol: "openai-chat",
    analysisModels: [],
    defaultAnalysisModel: "",
    videoAnalysis: true
  },
  {
    id: "openai",
    label: "OpenAI",
    description: "GPT Image for generation and editing; GPT chat models for image analysis",
    keyPlaceholder: "sk-...",
    defaultBaseUrl: OPENAI_IMAGES_BASE_URL,
    imageProtocol: "openai-images",
    imageModels: ["gpt-image-2", "gpt-image-1.5", "gpt-image-1", "gpt-image-1-mini"],
    defaultImageModel: "gpt-image-2",
    analysisProtocol: "openai-chat",
    analysisModels: ["gpt-5.6-sol", "gpt-5.6-terra", "gpt-5.6-luna", "gpt-5.5", "gpt-5.4-mini"],
    defaultAnalysisModel: "gpt-5.6-luna",
    videoAnalysis: false
  },
  {
    id: "gemini",
    label: "Gemini",
    description: "Gemini native image output (Nano Banana) and Imagen; Gemini reads images, video and audio",
    keyPlaceholder: "AIza...",
    defaultBaseUrl: GEMINI_MEDIA_BASE_URL,
    imageProtocol: "gemini",
    imageModels: [
      "gemini-3.1-flash-image",
      "gemini-3-pro-image",
      "gemini-3.1-flash-lite-image",
      "gemini-2.5-flash-image"
    ],
    defaultImageModel: "gemini-3.1-flash-image",
    analysisProtocol: "gemini",
    analysisModels: ["gemini-3.7-flash", "gemini-3.1-pro-preview", "gemini-3.6-flash"],
    defaultAnalysisModel: "gemini-3.7-flash",
    videoAnalysis: true
  },
  {
    id: "doubao",
    label: "Doubao (Volcengine Ark)",
    description: "Seedream image generation and editing; Doubao Seed reads images and video",
    keyPlaceholder: "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx",
    defaultBaseUrl: ARK_BASE_URL,
    imageProtocol: "openai-images",
    imageModels: [
      "doubao-seedream-5-0-260128",
      "doubao-seedream-4-5-251128",
      "doubao-seedream-4-0-250828"
    ],
    defaultImageModel: "doubao-seedream-5-0-260128",
    analysisProtocol: "openai-chat",
    analysisModels: ["doubao-seed-2-1-pro-260628", "doubao-seed-2-1-turbo-260628"],
    defaultAnalysisModel: "doubao-seed-2-1-pro-260628",
    videoAnalysis: true
  },
  {
    id: "glm",
    label: "GLM (Zhipu)",
    description: "CogView image generation; GLM-V reads images and video",
    keyPlaceholder: "xxxxxxxx.xxxxxxxx",
    defaultBaseUrl: ZHIPU_BASE_URL,
    imageProtocol: "openai-images",
    imageModels: ["cogview-4-250304", "cogview-3-flash"],
    defaultImageModel: "cogview-4-250304",
    analysisProtocol: "openai-chat",
    analysisModels: ["glm-4.6v", "glm-4.6v-flash"],
    defaultAnalysisModel: "glm-4.6v",
    videoAnalysis: true
  },
  {
    id: "xai",
    label: "Grok (xAI)",
    description: "Grok Imagine image generation; Grok reads images",
    keyPlaceholder: "xai-...",
    defaultBaseUrl: XAI_BASE_URL,
    imageProtocol: "openai-images",
    imageModels: ["grok-imagine-image-2.0", "grok-2-image-1212"],
    defaultImageModel: "grok-imagine-image-2.0",
    analysisProtocol: "openai-chat",
    analysisModels: ["grok-4.6", "grok-4.5"],
    defaultAnalysisModel: "grok-4.6",
    videoAnalysis: false
  },
  {
    id: "qwen",
    label: "Qwen (Alibaba Cloud)",
    description: "Qwen-Image generation; Qwen-VL reads images and video (DashScope)",
    keyPlaceholder: "sk-...",
    defaultBaseUrl: DASHSCOPE_BASE_URL,
    imageProtocol: "dashscope",
    imageModels: ["qwen-image-plus", "qwen-image"],
    defaultImageModel: "qwen-image-plus",
    analysisProtocol: "openai-chat",
    analysisModels: ["qwen3-vl-plus", "qwen3-vl-flash", "qwen3.8-max", "qwen3.7-plus"],
    defaultAnalysisModel: "qwen3-vl-plus",
    videoAnalysis: true
  },
  {
    id: "minimax",
    label: "MiniMax",
    description: "image-01 image generation (api.minimax.io; use api.minimaxi.com/v1 for the CN region)",
    keyPlaceholder: "eyJ...",
    defaultBaseUrl: MINIMAX_BASE_URL,
    imageProtocol: "minimax",
    imageModels: ["image-01"],
    defaultImageModel: "image-01",
    analysisModels: [],
    defaultAnalysisModel: "",
    videoAnalysis: false
  },
  {
    id: "custom",
    label: "Custom",
    description: "Any OpenAI-compatible endpoint: /images/generations and /chat/completions",
    keyPlaceholder: "API Key",
    needsBaseUrl: true,
    defaultBaseUrl: "",
    imageProtocol: "openai-images",
    imageModels: [],
    defaultImageModel: "",
    analysisProtocol: "openai-chat",
    analysisModels: [],
    defaultAnalysisModel: "",
    videoAnalysis: false
  }
];
function getMediaProviderMeta(id) {
  return AI_MEDIA_PROVIDERS.find((m) => m.id === id);
}
function providerHasCapability(meta, capability) {
  if (capability === "image") return !!meta.imageProtocol;
  if (capability === "video") return !!meta.analysisProtocol && meta.videoAnalysis;
  return !!meta.analysisProtocol;
}
function defaultAiMediaSettings() {
  const providers = {};
  for (const meta of AI_MEDIA_PROVIDERS) {
    providers[meta.id] = {
      apiKey: "",
      imageModel: meta.defaultImageModel,
      analysisModel: meta.defaultAnalysisModel,
      baseUrl: meta.needsBaseUrl ? "" : void 0
    };
  }
  return {
    imageProvider: "genspark",
    analysisProvider: "genspark",
    videoAnalysisProvider: "genspark",
    providers
  };
}
function resolveAiMediaSettings(stored) {
  const defaults = defaultAiMediaSettings();
  if (!stored) return defaults;
  const providers = { ...defaults.providers };
  for (const [id, config] of Object.entries(stored.providers ?? {})) {
    if (!config || typeof config !== "object") continue;
    const base = providers[id];
    providers[id] = {
      apiKey: (config.apiKey ?? base?.apiKey ?? "").trim(),
      imageModel: (config.imageModel ?? base?.imageModel ?? "").trim(),
      analysisModel: (config.analysisModel ?? base?.analysisModel ?? "").trim(),
      ...config.baseUrl !== void 0 ? { baseUrl: config.baseUrl.trim() } : base?.baseUrl !== void 0 ? { baseUrl: base.baseUrl } : {}
    };
  }
  const legacy = stored.provider;
  const analysisProvider = stored.analysisProvider ?? legacy ?? defaults.analysisProvider;
  return {
    imageProvider: stored.imageProvider ?? legacy ?? defaults.imageProvider,
    analysisProvider,
    // a pre-split file used one vendor for all media analysis
    videoAnalysisProvider: stored.videoAnalysisProvider ?? analysisProvider,
    providers
  };
}
function mediaConfigUsable(meta, config) {
  if (!config) return false;
  if (meta.needsBaseUrl) return !!config.baseUrl;
  return !!config.apiKey;
}
function activeMediaProvider(settings, capability) {
  const media = settings.media;
  if (!media) return "genspark";
  const id = capability === "image" ? media.imageProvider : capability === "video" ? media.videoAnalysisProvider : media.analysisProvider;
  if (!id || id === "genspark") return "genspark";
  const meta = getMediaProviderMeta(id);
  if (!meta || !providerHasCapability(meta, capability)) return "genspark";
  if (!mediaConfigUsable(meta, media.providers?.[id])) return "genspark";
  return id;
}
function activeMediaConfig(settings, capability) {
  const provider = activeMediaProvider(settings, capability);
  if (provider === "genspark") return null;
  return { provider, config: settings.media.providers[provider] };
}

// packages/ai-provider/src/search-settings.ts
function defaultAiSearchSettings() {
  return { provider: "genspark", providers: { serper: { apiKey: "" }, tavily: { apiKey: "" } } };
}
function resolveAiSearchSettings(stored) {
  const defaults = defaultAiSearchSettings();
  if (!stored) return defaults;
  const providers = { ...defaults.providers };
  for (const id of ["serper", "tavily"]) {
    const key = stored.providers?.[id]?.apiKey;
    if (typeof key === "string") providers[id] = { apiKey: key.trim() };
  }
  return { provider: stored.provider ?? defaults.provider, providers };
}

// packages/ai-provider/src/providers.ts
var GENSPARK_LLM_BASE_URLS = {
  anthropic: "https://www.genspark.ai/api/anthropic",
  openai: "https://www.genspark.ai/api/llm_proxy/v1"
};
var AI_PROVIDERS = [
  {
    id: "genspark",
    label: "Genspark",
    // must stay within the proxy's served set (GET /api/llm_proxy/v1/models);
    // bare gpt-5.6 and the gemini family dropped off it (verified 2026-08-31)
    models: [
      "claude-opus-4-7",
      "claude-opus-4-8",
      "claude-sonnet-4-6",
      "gpt-5.6-terra",
      "gpt-5.6-luna"
    ],
    defaultModel: "claude-opus-4-7",
    keyPlaceholder: "Not required - sign in to Genspark"
  },
  {
    id: "codex",
    label: "Codex CLI",
    // Populated at runtime from codex app-server model/list. Empty also lets
    // the CLI select the account's current default without a stale hardcode.
    models: [],
    defaultModel: "",
    keyPlaceholder: "",
    needsCliPath: true
  },
  {
    id: "anthropic",
    label: "Claude",
    // current-generation ids per platform.claude.com models overview (2026-08)
    models: [
      "claude-opus-5",
      "claude-sonnet-5",
      "claude-fable-5",
      "claude-opus-4-8",
      "claude-opus-4-7",
      "claude-sonnet-4-6",
      "claude-haiku-4-5-20251001"
    ],
    defaultModel: "claude-sonnet-5",
    keyPlaceholder: "sk-ant-api03-..."
  },
  {
    id: "gemini",
    label: "Gemini",
    // 3.x lineup per ai.google.dev/gemini-api/docs/models (2026-08). 3.7 Flash is
    // the current stable Flash; 3.1 Pro is still preview-only.
    models: [
      "gemini-3.7-flash",
      "gemini-3.1-pro-preview",
      "gemini-3.6-flash",
      "gemini-3.5-flash-lite"
    ],
    defaultModel: "gemini-3.7-flash",
    keyPlaceholder: "AIza..."
  },
  {
    id: "deepseek",
    label: "DeepSeek",
    // V4 ids per api-docs.deepseek.com (2026-08). Vision Exp is available
    // through the normal DeepSeek API key; indirect-route aliases such as
    // `-openrouter` do not belong in this direct-provider list.
    models: ["deepseek-v4-pro", "deepseek-v4-flash", "deepseek-v4-flash-vision-exp"],
    defaultModel: "deepseek-v4-pro",
    keyPlaceholder: "sk-..."
  },
  {
    id: "openai",
    label: "OpenAI",
    // GPT-5.6 naming: sol is the flagship (the bare `gpt-5.6` alias resolves to
    // it, but spell it out so the picker says which tier it is), terra balances
    // cost/intelligence, luna is the high-volume tier (2026-08)
    models: ["gpt-5.6-sol", "gpt-5.6-terra", "gpt-5.6-luna", "gpt-5.5", "gpt-5.4", "gpt-5.4-mini"],
    defaultModel: "gpt-5.6-terra",
    keyPlaceholder: "sk-..."
  },
  {
    id: "kimi",
    label: "Kimi",
    models: ["kimi-k3"],
    defaultModel: "kimi-k3",
    keyPlaceholder: "sk-..."
  },
  {
    id: "glm",
    label: "GLM",
    // bigmodel.cn text-model lineup (2026-08); 5.3 and 5.2 share a base model,
    // 5-Turbo is the cheap tier
    models: ["glm-5.3", "glm-5.2", "glm-5-turbo"],
    defaultModel: "glm-5.3",
    keyPlaceholder: "xxxxxxxx.xxxxxxxx"
  },
  {
    id: "qwen",
    label: "Qwen",
    // Versioned DashScope ids: the bare qwen-max alias still points at a
    // Qwen2.5-era snapshot, so name the 3.x tiers explicitly (2026-08)
    models: ["qwen3.8-max", "qwen3.7-plus", "qwen3.7-flash"],
    defaultModel: "qwen3.8-max",
    keyPlaceholder: "sk-..."
  },
  {
    id: "doubao",
    label: "Doubao",
    // Ark ids are dashed and date-pinned; it also accepts ep-... inference
    // endpoint ids in the model field
    models: ["doubao-seed-2-1-pro-260628", "doubao-seed-2-1-turbo-260628"],
    defaultModel: "doubao-seed-2-1-pro-260628",
    keyPlaceholder: "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
  },
  {
    id: "minimax",
    label: "MiniMax",
    // M3 is the current agentic/tool-use model; M2.5 moved to the legacy tier
    models: ["MiniMax-M3", "MiniMax-M2.7"],
    defaultModel: "MiniMax-M3",
    keyPlaceholder: "eyJ..."
  },
  {
    id: "xai",
    label: "Grok",
    models: ["grok-4.6", "grok-4.5"],
    defaultModel: "grok-4.6",
    keyPlaceholder: "xai-..."
  },
  {
    id: "mistral",
    label: "Mistral",
    // `-latest` aliases track the newest GA snapshot. Medium 3.5 is Mistral's
    // agentic tier; codestral is a code-completion/FIM model, not an agent driver.
    models: ["mistral-medium-latest", "mistral-large-latest", "mistral-small-latest"],
    defaultModel: "mistral-medium-latest",
    keyPlaceholder: "API Key"
  },
  {
    id: "openrouter",
    label: "OpenRouter",
    // vendor-prefixed slugs exactly as openrouter.ai/api/v1/models lists them —
    // there is no `openai/gpt-5.6` alias there, only the per-tier ids
    models: [
      "openrouter/auto",
      "anthropic/claude-sonnet-5",
      "openai/gpt-5.6-sol",
      "moonshotai/kimi-k3"
    ],
    defaultModel: "openrouter/auto",
    keyPlaceholder: "sk-or-..."
  },
  {
    id: "opencode-zen",
    label: "OpenCode Zen",
    // Pay-as-you-go gateway (opencode.ai/docs/zen); ids exactly as GET
    // /zen/v1/models lists them (2026-09-03). GPT-5.x, Grok and Muse Spark
    // are served only through the Responses API, which has no protocol here,
    // so they stay out until one exists.
    models: [
      "claude-sonnet-5",
      "claude-opus-5",
      "claude-fable-5-1",
      "claude-haiku-4-5",
      "gemini-3.7-flash",
      "gemini-3.1-pro",
      "kimi-k3",
      "kimi-k2.7-code",
      "deepseek-v4-pro",
      "deepseek-v4-flash",
      "glm-5.2",
      "minimax-m3",
      "qwen3.6-plus"
    ],
    defaultModel: "claude-sonnet-5",
    keyPlaceholder: "API Key"
  },
  {
    id: "opencode-go",
    label: "OpenCode Go",
    // $10/month subscription to open-weight coding models (opencode.ai/docs/go),
    // same key as Zen; ids exactly as GET /zen/go/v1/models lists them
    // (2026-09-03). GPT-5.6 Luna, Grok and Muse Spark are Responses-only and
    // left out for the same reason as above.
    models: [
      "kimi-k2.7-code",
      "kimi-k3",
      "glm-5.3",
      "glm-5.3-flash",
      "deepseek-v4-pro",
      "deepseek-v4-flash",
      "qwen3.8-max",
      "qwen3.8-flash",
      "minimax-m3",
      "mimo-v2.5-pro",
      "longcat-2.0"
    ],
    defaultModel: "kimi-k2.7-code",
    keyPlaceholder: "API Key"
  },
  {
    id: "custom",
    label: "Custom",
    models: [],
    defaultModel: "",
    keyPlaceholder: "API Key",
    needsBaseUrl: true
  }
];
function defaultAiSettings(defaultApiKeys) {
  const providers = {};
  for (const meta of AI_PROVIDERS) {
    providers[meta.id] = {
      apiKey: defaultApiKeys?.[meta.id] ?? "",
      model: meta.defaultModel,
      baseUrl: meta.needsBaseUrl ? "" : void 0,
      cliPath: meta.needsCliPath ? "" : void 0
    };
  }
  return {
    provider: "genspark",
    providers,
    gskToolsEnabled: true,
    media: defaultAiMediaSettings(),
    search: defaultAiSearchSettings()
  };
}
function cloudToolsEnabled(settings) {
  return settings.gskToolsEnabled !== false;
}
var RETIRED_MODELS = {
  // aliases retired 2026-07-24; DeepSeek pointed both at the V4-Flash line,
  // where thinking mode is a request parameter rather than a separate id
  deepseek: {
    "deepseek-chat": "deepseek-v4-flash",
    "deepseek-reasoner": "deepseek-v4-flash"
  },
  // proxy stopped serving bare gpt-5.6 (400) and removed the gemini route
  // entirely (405), verified 2026-08-31; gemini selections fall back to the
  // provider default since no gemini id is served at all
  genspark: {
    "gpt-5.6": "gpt-5.6-terra",
    "gemini-3.1-pro-preview": "claude-opus-4-7",
    "gemini-3-flash-preview": "claude-opus-4-7",
    "gemini-3.7-flash": "claude-opus-4-7"
  }
};
var DEFAULT_MAX_OUTPUT_TOKENS = 32768;
var MIN_MAX_OUTPUT_TOKENS = 1024;
var MAX_MAX_OUTPUT_TOKENS = 131072;
function clampMaxOutputTokens(value) {
  const n = typeof value === "number" ? Math.floor(value) : Number.NaN;
  if (!Number.isFinite(n)) return DEFAULT_MAX_OUTPUT_TOKENS;
  return Math.min(MAX_MAX_OUTPUT_TOKENS, Math.max(MIN_MAX_OUTPUT_TOKENS, n));
}
function trimConfigs(providers) {
  const trimmed = { ...providers };
  for (const [id, config] of Object.entries(trimmed)) {
    trimmed[id] = {
      ...config,
      apiKey: config.apiKey?.trim() ?? "",
      model: config.model?.trim() ?? "",
      ...config.baseUrl !== void 0 ? { baseUrl: config.baseUrl.trim() } : {},
      ...config.cliPath !== void 0 ? { cliPath: config.cliPath.trim() } : {}
    };
  }
  return trimmed;
}
function migrateRetiredModels(providers) {
  const migrated = { ...providers };
  for (const [id, replacements] of Object.entries(RETIRED_MODELS)) {
    const config = migrated[id];
    const replacement = config?.model ? replacements[config.model] : void 0;
    if (replacement) migrated[id] = { ...config, model: replacement };
  }
  return migrated;
}
function resolveAiSettings(stored, defaults) {
  if (!stored.providers) {
    if (stored.apiKey) {
      defaults.providers.custom = {
        apiKey: stored.apiKey.trim(),
        model: stored.model?.trim() ?? "",
        baseUrl: (stored.baseUrl ?? "https://api.openai.com/v1").trim()
      };
    }
    return defaults;
  }
  return {
    provider: stored.provider ?? defaults.provider,
    // Trim before migrating: a pasted " deepseek-reasoner " must still hit
    // the retired-id remap instead of being sent to the API verbatim.
    providers: migrateRetiredModels(trimConfigs({ ...defaults.providers, ...stored.providers })),
    gskToolsEnabled: stored.gskToolsEnabled ?? defaults.gskToolsEnabled ?? true,
    media: resolveAiMediaSettings(stored.media ?? defaults.media),
    search: resolveAiSearchSettings(stored.search ?? defaults.search),
    // clamped on read: a hand-edited settings file with an absurd cap must not be
    // forwarded to the endpoint verbatim
    ...stored.maxOutputTokens !== void 0 || defaults.maxOutputTokens !== void 0 ? {
      maxOutputTokens: clampMaxOutputTokens(stored.maxOutputTokens ?? defaults.maxOutputTokens)
    } : {}
  };
}

// packages/ai-provider/src/fetch.ts
var rescueFetch = null;
var AI_DEFAULT_USER_AGENT = "GenOffice";
var userAgent = AI_DEFAULT_USER_AGENT;
function withUserAgent(init) {
  const given = init.headers;
  const headers = {};
  if (given instanceof Headers) given.forEach((value, name) => headers[name] = value);
  else if (Array.isArray(given)) for (const [name, value] of given) headers[name] = value;
  else Object.assign(headers, given);
  if (!Object.keys(headers).some((name) => name.toLowerCase() === "user-agent")) {
    headers["User-Agent"] = userAgent;
  }
  return { ...init, headers };
}
function isBlockPage(response) {
  return response.status === 403 && (response.headers.get("content-type") || "").includes("text/html");
}
async function aiFetch(url, rawInit) {
  const init = withUserAgent(rawInit);
  const signal = init.signal;
  let response;
  try {
    response = await fetch(url, init);
  } catch (primaryError) {
    if (!rescueFetch || signal?.aborted) throw primaryError;
    console.warn("[ai-provider] fetch failed, retrying via rescue fetch:", String(primaryError));
    try {
      return await rescueFetch(url, init);
    } catch {
      throw primaryError;
    }
  }
  const resendable = init.body == null || typeof init.body === "string";
  if (rescueFetch && resendable && !signal?.aborted && isBlockPage(response)) {
    console.warn(
      "[ai-provider] 403 block page from",
      new URL(url).host,
      "- retrying via rescue fetch"
    );
    try {
      const rescued = await rescueFetch(url, init);
      if (!isBlockPage(rescued)) return rescued;
    } catch {
    }
  }
  return response;
}

// packages/ai-provider/src/http-error.ts
function httpBodyDetail(body) {
  const head = body.trimStart().slice(0, 30).toLowerCase();
  const isHtml = ["<!doctype", "<html", "<head", "<body"].some((tag) => head.startsWith(tag));
  if (isHtml) {
    return `the service returned a web page${describeBlockPage(body)} instead of an API response (likely a temporary network or gateway block) \u2014 check your connection and retry`;
  }
  return body.slice(0, 500);
}
function describeBlockPage(body) {
  const title = /<title[^>]*>([^<]*)<\/title>/i.exec(body)?.[1]?.replace(/\s+/g, " ").trim();
  const code = /error code:?\s*(?:<[^>]+>\s*)*(\d{3,5})/i.exec(body)?.[1];
  const ray = /ray id:?\s*(?:<[^>]+>\s*)*([a-f0-9]{16})/i.exec(body)?.[1];
  const parts = [
    title && `"${title.slice(0, 60)}"`,
    code && `error code ${code}`,
    ray && `ray ${ray}`
  ].filter(Boolean);
  return parts.length ? ` (${parts.join(", ")})` : "";
}

// packages/ai-provider/src/media-protocols.ts
var GENERATE_TIMEOUT_MS2 = 6e5;
var GEMINI_INLINE_LIMIT_BYTES = 18 * 1024 * 1024;
function trimSlash(url) {
  return url.replace(/\/+$/, "");
}
function metaOf(provider) {
  const meta = getMediaProviderMeta(provider);
  if (!meta) throw new Error(`Unknown media provider: ${provider}`);
  return meta;
}
function openAiBase(provider, config) {
  if (provider === "qwen") return `${dashscopeRoot(config)}/compatible-mode/v1`;
  const meta = metaOf(provider);
  return trimSlash(config.baseUrl || meta.defaultBaseUrl || OPENAI_IMAGES_BASE_URL);
}
function dashscopeRoot(config) {
  return trimSlash(config.baseUrl || DASHSCOPE_BASE_URL).replace(/\/compatible-mode\/v1$/, "").replace(/\/api\/v1$/, "");
}
function geminiBase(config) {
  return trimSlash(config.baseUrl || GEMINI_MEDIA_BASE_URL);
}
function bearer(config) {
  return config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {};
}
function bytesToBase64(bytes) {
  if (typeof Buffer !== "undefined") return Buffer.from(bytes).toString("base64");
  let binary = "";
  for (let i = 0; i < bytes.length; i += 32768) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 32768));
  }
  return btoa(binary);
}
function base64ToBytes(b64) {
  if (typeof Buffer !== "undefined") return new Uint8Array(Buffer.from(b64, "base64"));
  const binary = atob(b64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}
function dataUrl(blob) {
  return `data:${blob.mime};base64,${bytesToBase64(blob.bytes)}`;
}
function sniffImageMime(bytes, fallback = "image/png") {
  if (bytes.length > 8 && bytes[0] === 137 && bytes[1] === 80 && bytes[2] === 78) {
    return "image/png";
  }
  if (bytes.length > 3 && bytes[0] === 255 && bytes[1] === 216) return "image/jpeg";
  if (bytes.length > 6 && bytes[0] === 71 && bytes[1] === 73 && bytes[2] === 70) {
    return "image/gif";
  }
  if (bytes.length > 12 && bytes[8] === 87 && bytes[9] === 69 && bytes[10] === 66 && bytes[11] === 80) {
    return "image/webp";
  }
  return fallback;
}
function toArrayBuffer(bytes) {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
}
async function failFrom(label, resp) {
  const body = await resp.text().catch(() => "");
  throw new Error(`${label} ${resp.status}: ${httpBodyDetail(body)}`);
}
function asRecord2(v) {
  return v && typeof v === "object" ? v : {};
}
function withTimeout(signal, ms) {
  const timeout = AbortSignal.timeout(ms);
  return signal ? AbortSignal.any([signal, timeout]) : timeout;
}
async function downloadImage(label, url, signal) {
  const img = await aiFetch(url, { signal });
  if (!img.ok) return failFrom(`${label} download`, img);
  const bytes = new Uint8Array(await img.arrayBuffer());
  return { bytes, mime: sniffImageMime(bytes, img.headers.get("content-type") ?? "image/png") };
}
function fromBase64(b64, declaredMime) {
  const bytes = base64ToBytes(b64);
  return {
    bytes,
    mime: sniffImageMime(bytes, typeof declaredMime === "string" ? declaredMime : "image/png")
  };
}
var OPENAI_SIZES = {
  "1:1": "1024x1024",
  "16:9": "1536x1024",
  "3:2": "1536x1024",
  "4:3": "1536x1024",
  "9:16": "1024x1536",
  "2:3": "1024x1536",
  "3:4": "1024x1536"
};
var GLM_SIZES = {
  "1:1": "1024x1024",
  "16:9": "1344x768",
  "3:2": "1344x768",
  "4:3": "1152x864",
  "9:16": "768x1344",
  "2:3": "768x1344",
  "3:4": "864x1152"
};
var ARK_RATIOS = /* @__PURE__ */ new Set(["1:1", "3:4", "4:3", "9:16", "16:9", "2:3", "3:2", "21:9"]);
function openAiImagesStyle(provider) {
  switch (provider) {
    case "doubao":
      return {
        size: (r) => r && ARK_RATIOS.has(r) ? r : "2K",
        bodyExtras: { response_format: "b64_json", watermark: false },
        edits: "inline"
      };
    case "glm":
      return { size: (r) => r ? GLM_SIZES[r] : void 0, bodyExtras: {}, edits: "none" };
    case "xai":
      return { size: () => void 0, bodyExtras: { response_format: "b64_json" }, edits: "none" };
    default:
      return { size: (r) => r ? OPENAI_SIZES[r] : void 0, bodyExtras: {}, edits: "multipart" };
  }
}
async function openAiImageResult(label, resp, signal) {
  if (!resp.ok) return failFrom(label, resp);
  const json = asRecord2(await resp.json());
  const first = asRecord2(json.data?.[0]);
  if (typeof first.b64_json === "string" && first.b64_json) return fromBase64(first.b64_json);
  if (typeof first.url === "string" && first.url) return downloadImage(label, first.url, signal);
  throw new Error(`${label} returned no image: ${JSON.stringify(json).slice(0, 200)}`);
}
async function generateImageOpenAi(provider, config, model, input, signal) {
  const base = openAiBase(provider, config);
  const style = openAiImagesStyle(provider);
  const size = style.size(input.aspectRatio);
  const refs = input.references ?? [];
  if (refs.length && style.edits === "none") {
    throw new Error(
      `${metaOf(provider).label} cannot edit or reference images here; generate from the prompt alone or pick another image provider.`
    );
  }
  if (refs.length === 0 || style.edits === "inline") {
    const resp2 = await aiFetch(`${base}/images/generations`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...bearer(config) },
      body: JSON.stringify({
        model,
        prompt: input.prompt,
        n: 1,
        ...size ? { size } : {},
        ...style.bodyExtras,
        ...refs.length ? { image: refs.map(dataUrl) } : {}
      }),
      signal
    });
    return openAiImageResult("Image generation failed:", resp2, signal);
  }
  const form = new FormData();
  form.set("model", model);
  form.set("prompt", input.prompt);
  if (size) form.set("size", size);
  refs.forEach((ref, i) => {
    const ext = ref.mime.split("/")[1]?.replace("jpeg", "jpg") ?? "png";
    form.append(
      refs.length > 1 ? "image[]" : "image",
      new Blob([toArrayBuffer(ref.bytes)], { type: ref.mime }),
      ref.name ?? `ref-${i}.${ext}`
    );
  });
  const resp = await aiFetch(`${base}/images/edits`, {
    method: "POST",
    headers: bearer(config),
    body: form,
    signal
  });
  return openAiImageResult("Image edit failed:", resp, signal);
}
var DASHSCOPE_SIZES = {
  "1:1": "1328*1328",
  "16:9": "1664*928",
  "3:2": "1664*928",
  "4:3": "1472*1104",
  "9:16": "928*1664",
  "2:3": "928*1664",
  "3:4": "1104*1472"
};
async function generateImageDashscope(config, model, input, signal) {
  if (input.references?.length) {
    throw new Error(
      "Qwen-Image here generates from the prompt alone; pick another image provider for edits."
    );
  }
  const size = input.aspectRatio ? DASHSCOPE_SIZES[input.aspectRatio] : void 0;
  const resp = await aiFetch(
    `${dashscopeRoot(config)}/api/v1/services/aigc/multimodal-generation/generation`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", ...bearer(config) },
      body: JSON.stringify({
        model,
        input: { messages: [{ role: "user", content: [{ text: input.prompt }] }] },
        parameters: { n: 1, watermark: false, ...size ? { size } : {} }
      }),
      signal
    }
  );
  if (!resp.ok) return failFrom("Image generation failed:", resp);
  const json = asRecord2(await resp.json());
  if (typeof json.code === "string" && json.code) {
    throw new Error(`Image generation failed: ${json.code} ${String(json.message ?? "")}`);
  }
  const choice = asRecord2(asRecord2(json.output).choices?.[0]);
  const content = asRecord2(choice.message).content;
  const image = Array.isArray(content) ? content.map(asRecord2).find((c) => typeof c.image === "string")?.image : void 0;
  if (typeof image !== "string") {
    throw new Error(`Image generation returned no image: ${JSON.stringify(json).slice(0, 200)}`);
  }
  return downloadImage("Image generation failed:", image, signal);
}
var MINIMAX_RATIOS = /* @__PURE__ */ new Set(["1:1", "16:9", "4:3", "3:2", "2:3", "3:4", "9:16", "21:9"]);
async function generateImageMinimax(config, model, input, signal) {
  if (input.references?.length) {
    throw new Error(
      "MiniMax image-01 here generates from the prompt alone; pick another image provider for edits."
    );
  }
  const base = trimSlash(config.baseUrl || MINIMAX_BASE_URL);
  const ratio = input.aspectRatio && MINIMAX_RATIOS.has(input.aspectRatio) ? input.aspectRatio : void 0;
  const resp = await aiFetch(`${base}/image_generation`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...bearer(config) },
    body: JSON.stringify({
      model,
      prompt: input.prompt,
      n: 1,
      response_format: "base64",
      ...ratio ? { aspect_ratio: ratio } : {}
    }),
    signal
  });
  if (!resp.ok) return failFrom("Image generation failed:", resp);
  const json = asRecord2(await resp.json());
  const status = asRecord2(json.base_resp);
  if (typeof status.status_code === "number" && status.status_code !== 0) {
    throw new Error(
      `Image generation failed: ${status.status_code} ${String(status.status_msg ?? "")}`
    );
  }
  const data = asRecord2(json.data);
  const b64 = data.image_base64?.[0];
  if (typeof b64 === "string" && b64) return fromBase64(b64);
  const url = data.image_urls?.[0];
  if (typeof url === "string" && url) return downloadImage("Image generation failed:", url, signal);
  throw new Error(`Image generation returned no image: ${JSON.stringify(json).slice(0, 200)}`);
}
var GEMINI_ASPECT_RATIOS = /* @__PURE__ */ new Set([
  "1:1",
  "2:3",
  "3:2",
  "3:4",
  "4:3",
  "4:5",
  "5:4",
  "9:16",
  "16:9",
  "21:9"
]);
function geminiHeaders(config) {
  return { "Content-Type": "application/json", "x-goog-api-key": config.apiKey };
}
function geminiParts(candidate) {
  const content = asRecord2(asRecord2(candidate).content);
  return Array.isArray(content.parts) ? content.parts.map(asRecord2) : [];
}
function geminiBlockedReason(json) {
  const feedback = asRecord2(json.promptFeedback);
  const candidate = asRecord2(json.candidates?.[0]);
  const reason = feedback.blockReason ?? candidate.finishReason;
  return typeof reason === "string" && reason !== "STOP" ? ` (${reason})` : "";
}
async function generateImageGemini(config, model, input, signal) {
  const base = geminiBase(config);
  const aspectRatio = input.aspectRatio && GEMINI_ASPECT_RATIOS.has(input.aspectRatio) ? input.aspectRatio : void 0;
  if (model.startsWith("imagen-")) {
    const resp2 = await aiFetch(`${base}/models/${model}:predict`, {
      method: "POST",
      headers: geminiHeaders(config),
      body: JSON.stringify({
        instances: [{ prompt: input.prompt }],
        parameters: { sampleCount: 1, ...aspectRatio ? { aspectRatio } : {} }
      }),
      signal
    });
    if (!resp2.ok) return failFrom("Image generation failed:", resp2);
    const json2 = asRecord2(await resp2.json());
    const first = asRecord2(json2.predictions?.[0]);
    if (typeof first.bytesBase64Encoded !== "string") {
      throw new Error(`Image generation returned no image: ${JSON.stringify(json2).slice(0, 200)}`);
    }
    return fromBase64(first.bytesBase64Encoded, first.mimeType);
  }
  const resp = await aiFetch(`${base}/models/${model}:generateContent`, {
    method: "POST",
    headers: geminiHeaders(config),
    body: JSON.stringify({
      contents: [
        {
          role: "user",
          parts: [
            { text: input.prompt },
            ...(input.references ?? []).map((ref) => ({
              inline_data: { mime_type: ref.mime, data: bytesToBase64(ref.bytes) }
            }))
          ]
        }
      ],
      generationConfig: {
        responseModalities: ["TEXT", "IMAGE"],
        ...aspectRatio ? { imageConfig: { aspectRatio } } : {}
      }
    }),
    signal
  });
  if (!resp.ok) return failFrom("Image generation failed:", resp);
  const json = asRecord2(await resp.json());
  const parts = geminiParts(json.candidates?.[0]);
  const image = parts.map((p) => asRecord2(p.inlineData ?? p.inline_data)).find((d) => typeof d.data === "string");
  if (!image) {
    const text = parts.map((p) => typeof p.text === "string" ? p.text : "").join(" ").trim();
    throw new Error(
      `Image generation returned no image${geminiBlockedReason(json)}${text ? `: ${text.slice(0, 200)}` : ""}`
    );
  }
  return fromBase64(image.data, image.mimeType ?? image.mime_type);
}
function modelOf(meta, config, field) {
  const model = config[field] || (field === "imageModel" ? meta.defaultImageModel : meta.defaultAnalysisModel);
  if (!model) {
    throw new Error(
      `No ${field === "imageModel" ? "image" : "analysis"} model configured for the ${meta.label} media provider`
    );
  }
  return model;
}
function requireBaseUrl(meta, config) {
  if (meta.needsBaseUrl && !config.baseUrl) {
    throw new Error(`The ${meta.label} media provider requires a Base URL`);
  }
}
async function generateImageWithProvider(provider, config, input, signal) {
  const meta = metaOf(provider);
  requireBaseUrl(meta, config);
  if (!meta.imageProtocol) throw new Error(`${meta.label} does not generate images`);
  const model = modelOf(meta, config, "imageModel");
  const guard = withTimeout(signal, GENERATE_TIMEOUT_MS2);
  switch (meta.imageProtocol) {
    case "gemini":
      return generateImageGemini(config, model, input, guard);
    case "dashscope":
      return generateImageDashscope(config, model, input, guard);
    case "minimax":
      return generateImageMinimax(config, model, input, guard);
    case "openai-images":
      return generateImageOpenAi(provider, config, model, input, guard);
  }
}

// packages/ai-provider/src/protocols/anthropic.ts
var ANTHROPIC_BASE_URL = "https://api.anthropic.com";

// packages/ai-provider/src/protocols/gemini.ts
var GEMINI_BASE_URL = "https://generativelanguage.googleapis.com/v1beta";

// packages/ai-provider/src/registry.ts
function metaOf2(id) {
  return AI_PROVIDERS.find((m) => m.id === id);
}
function modelHasFixedSampling(model) {
  return /(^|\/)(kimi-k3|gpt-5|gemini-3|o1(-mini|-preview)?|o3(-mini)?|o4-mini)/.test(model);
}
var DEEPSEEK_NON_THINKING = { thinking: { type: "disabled" } };
var OPENCODE_GATEWAY_ROOTS = {
  zen: "https://opencode.ai/zen",
  go: "https://opencode.ai/zen/go"
};
function opencodeEndpoint(root, routes) {
  return (config) => {
    const base = (config.baseUrl || root).replace(/\/+$/, "").replace(/\/v1$/, "");
    if (routes.anthropic.test(config.model)) return { protocol: "anthropic", baseUrl: base };
    const omit = modelHasFixedSampling(config.model) || config.model.startsWith("kimi-");
    const sampling = omit ? { omitTemperature: true } : {};
    if (routes.gemini?.test(config.model)) {
      return { protocol: "gemini", baseUrl: `${base}/v1`, ...sampling };
    }
    return { protocol: "openai-compatible", baseUrl: `${base}/v1`, ...sampling };
  };
}
function fixedEndpoint(protocol2, baseUrl, extras) {
  return (config) => {
    const omit = extras?.omitTemperature || modelHasFixedSampling(config.model);
    return {
      protocol: protocol2,
      baseUrl: config.baseUrl || baseUrl,
      ...omit ? { omitTemperature: true } : {},
      ...extras?.useMaxCompletionTokens ? { useMaxCompletionTokens: true } : {},
      ...extras?.bodyExtras ? { bodyExtras: extras.bodyExtras } : {}
    };
  };
}
var AI_PROVIDER_ADAPTERS = {
  genspark: {
    meta: metaOf2("genspark"),
    capabilities: { auth: "gsk-login", vision: true },
    // Route by model id prefix: claude uses the Anthropic protocol (preserves image
    // input fidelity), the rest OpenAI-compatible. The proxy's gemini endpoint was
    // removed server-side (405 as of 2026-08-31) along with its gemini models.
    resolveEndpoint(config) {
      if (config.model.startsWith("claude")) {
        return { protocol: "anthropic", baseUrl: GENSPARK_LLM_BASE_URLS.anthropic };
      }
      return {
        protocol: "openai-compatible",
        baseUrl: GENSPARK_LLM_BASE_URLS.openai,
        ...modelHasFixedSampling(config.model) ? { omitTemperature: true } : {}
      };
    }
  },
  codex: {
    meta: metaOf2("codex"),
    capabilities: { auth: "codex-chatgpt", vision: true },
    resolveEndpoint() {
      return { protocol: "codex-app-server", baseUrl: "" };
    }
  },
  anthropic: {
    meta: metaOf2("anthropic"),
    capabilities: { auth: "api-key", vision: true },
    resolveEndpoint: fixedEndpoint("anthropic", ANTHROPIC_BASE_URL)
  },
  gemini: {
    meta: metaOf2("gemini"),
    capabilities: { auth: "api-key", vision: true },
    resolveEndpoint: fixedEndpoint("gemini", GEMINI_BASE_URL)
  },
  deepseek: {
    meta: metaOf2("deepseek"),
    capabilities: { auth: "api-key", vision: true },
    resolveEndpoint: fixedEndpoint("openai-compatible", "https://api.deepseek.com/v1", {
      bodyExtras: DEEPSEEK_NON_THINKING
    })
  },
  openai: {
    meta: metaOf2("openai"),
    capabilities: { auth: "api-key", vision: true },
    // every current OpenAI model accepts the renamed field, so it is safe endpoint-wide;
    // other openai-compatible vendors (and the LiteLLM-backed Genspark proxy) still expect `max_tokens`
    resolveEndpoint: fixedEndpoint("openai-compatible", "https://api.openai.com/v1", {
      useMaxCompletionTokens: true
    })
  },
  kimi: {
    meta: metaOf2("kimi"),
    capabilities: { auth: "api-key", vision: true },
    resolveEndpoint: fixedEndpoint("openai-compatible", "https://api.moonshot.ai/v1", {
      omitTemperature: true
    })
  },
  glm: {
    meta: metaOf2("glm"),
    capabilities: { auth: "api-key", vision: false },
    resolveEndpoint: fixedEndpoint("openai-compatible", "https://open.bigmodel.cn/api/paas/v4")
  },
  qwen: {
    meta: metaOf2("qwen"),
    capabilities: { auth: "api-key", vision: false },
    resolveEndpoint: fixedEndpoint(
      "openai-compatible",
      "https://dashscope.aliyuncs.com/compatible-mode/v1"
    )
  },
  doubao: {
    meta: metaOf2("doubao"),
    capabilities: { auth: "api-key", vision: true },
    resolveEndpoint: fixedEndpoint("openai-compatible", "https://ark.cn-beijing.volces.com/api/v3")
  },
  minimax: {
    meta: metaOf2("minimax"),
    capabilities: { auth: "api-key", vision: false },
    resolveEndpoint: fixedEndpoint("openai-compatible", "https://api.minimax.io/v1")
  },
  xai: {
    meta: metaOf2("xai"),
    capabilities: { auth: "api-key", vision: true },
    resolveEndpoint: fixedEndpoint("openai-compatible", "https://api.x.ai/v1")
  },
  mistral: {
    meta: metaOf2("mistral"),
    capabilities: { auth: "api-key", vision: false },
    resolveEndpoint: fixedEndpoint("openai-compatible", "https://api.mistral.ai/v1")
  },
  openrouter: {
    meta: metaOf2("openrouter"),
    capabilities: { auth: "api-key", vision: true },
    resolveEndpoint: fixedEndpoint("openai-compatible", "https://openrouter.ai/api/v1")
  },
  "opencode-zen": {
    meta: metaOf2("opencode-zen"),
    capabilities: { auth: "api-key", vision: true },
    // Claude and Qwen ride /v1/messages, Gemini its native generateContent path
    resolveEndpoint: opencodeEndpoint(OPENCODE_GATEWAY_ROOTS.zen, {
      anthropic: /^(claude-|qwen)/,
      gemini: /^gemini-/
    })
  },
  "opencode-go": {
    meta: metaOf2("opencode-go"),
    capabilities: { auth: "api-key", vision: true },
    // MiniMax and Qwen 3.8 Flash ride /v1/messages; the rest is chat-completions
    // (the Go docs table lists every Qwen on Messages, but the client config
    // OpenCode ships routes only 3.8 Flash there — follow the running client)
    resolveEndpoint: opencodeEndpoint(OPENCODE_GATEWAY_ROOTS.go, {
      anthropic: /^(minimax-|qwen3\.8-flash$)/
    })
  },
  custom: {
    meta: metaOf2("custom"),
    capabilities: { auth: "api-key", vision: true },
    resolveEndpoint(config) {
      if (!config.baseUrl) throw new Error("A custom provider requires a Base URL");
      return {
        protocol: "openai-compatible",
        baseUrl: config.baseUrl,
        ...modelHasFixedSampling(config.model) ? { omitTemperature: true } : {}
      };
    }
  }
};

// packages/ai-provider/src/network-error.ts
var NETWORK_ERROR_PATTERN = new RegExp(
  [
    "fetch failed",
    "socket hang up",
    "network error",
    "ECONNRESET",
    "ECONNREFUSED",
    "ECONNABORTED",
    "ETIMEDOUT",
    "ENOTFOUND",
    "EAI_AGAIN",
    "ENETUNREACH",
    "ENETDOWN",
    "EHOSTUNREACH",
    "EHOSTDOWN",
    "EPIPE",
    "UND_ERR_CONNECT_TIMEOUT",
    "UND_ERR_SOCKET",
    "ERR_NETWORK",
    "ERR_INTERNET_DISCONNECTED",
    "ERR_NAME_NOT_RESOLVED",
    "ERR_CONNECTION_[A-Z_]+",
    "ERR_PROXY_CONNECTION_FAILED",
    "ERR_TIMED_OUT",
    "ERR_ADDRESS_UNREACHABLE"
  ].join("|"),
  "i"
);

// packages/ai-provider/src/overload-error.ts
var OVERLOADED_PATTERN = new RegExp(
  [
    "\\bHTTP (429|503|529)\\b",
    "overload",
    // "overloaded", "engine_overloaded_error", Anthropic's "Overloaded"
    "rate.?limit",
    "too many requests",
    "resource.{0,12}exhausted",
    // Gemini RESOURCE_EXHAUSTED / "Resource has been exhausted"
    "quota exceeded"
  ].join("|"),
  "i"
);

// packages/ai-search/src/media-tools.ts
var GSK_NOT_LOGGED_IN_ERROR = "Genspark account is not logged in on this machine; ask the user to log in first";
var GSK_TOOLS_OFF_ERROR = "Genspark cloud tools are turned off in Settings (AI Model); enable them or configure an image provider under Settings (AI Media) to use this tool";
var MAX_MEDIA_BYTES = 200 * 1024 * 1024;
var MediaTooLargeError = class extends Error {
};
var MIME_BY_EXT2 = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".bmp": "image/bmp",
  ".heic": "image/heic",
  ".mp4": "video/mp4",
  ".mov": "video/quicktime",
  ".webm": "video/webm",
  ".m4v": "video/mp4",
  ".mkv": "video/x-matroska",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".m4a": "audio/mp4",
  ".aac": "audio/aac",
  ".ogg": "audio/ogg",
  ".flac": "audio/flac"
};
function readAiSettingsFile(path) {
  let stored = {};
  try {
    if ((0, import_node_fs5.existsSync)(path)) stored = JSON.parse((0, import_node_fs5.readFileSync)(path, "utf-8"));
  } catch {
  }
  return resolveAiSettings(stored, defaultAiSettings());
}
function gskGate(settings, notLoggedInError) {
  if (!hasGskAuth()) return { error: notLoggedInError };
  if (!cloudToolsEnabled(settings)) return { error: GSK_TOOLS_OFF_ERROR };
  return null;
}
function errorText(err) {
  return err instanceof Error ? err.message : String(err);
}
async function loadMediaReference(ref) {
  if (/^https?:\/\//i.test(ref)) {
    const resp = await (ref.match(/\.(png|jpe?g|gif|webp)(\?|$)/i) ? fetchRemoteImage(ref) : fetchWithSsrfGuard(ref, { headers: { "User-Agent": "Mozilla/5.0" } }));
    if (!resp || !resp.ok) throw new Error(`Could not download ${ref}`);
    const declared = Number(resp.headers.get("content-length") ?? 0);
    if (declared > MAX_MEDIA_BYTES) throw new MediaTooLargeError(`${ref} is too large to analyze`);
    const bytes = new Uint8Array(await resp.arrayBuffer());
    if (bytes.byteLength > MAX_MEDIA_BYTES) {
      throw new MediaTooLargeError(`${ref} is too large to analyze`);
    }
    const ct = resp.headers.get("content-type")?.split(";")[0]?.trim();
    const name = (0, import_node_path6.basename)(new URL(ref).pathname) || void 0;
    const mime2 = ct && ct !== "application/octet-stream" ? ct : MIME_BY_EXT2[(0, import_node_path6.extname)(name ?? "").toLowerCase()];
    if (!mime2) throw new Error(`Could not tell the media type of ${ref}`);
    return { bytes, mime: mime2, ...name ? { name } : {} };
  }
  if (ref.startsWith("file:")) {
    const local = readGeneratedImage(ref);
    if (!local) throw new Error(`Not an accessible image: ${ref}`);
    return { bytes: new Uint8Array(local.bytes), mime: local.mime };
  }
  const mime = MIME_BY_EXT2[(0, import_node_path6.extname)(ref).toLowerCase()];
  if (!mime) throw new Error(`Unsupported media file: ${ref} (images, video and audio only)`);
  if (!(0, import_node_fs5.existsSync)(ref)) throw new Error(`File not found: ${ref}`);
  if ((0, import_node_fs5.statSync)(ref).size > MAX_MEDIA_BYTES) {
    throw new MediaTooLargeError(`${ref} is too large to analyze`);
  }
  return { bytes: new Uint8Array((0, import_node_fs5.readFileSync)(ref)), mime, name: (0, import_node_path6.basename)(ref) };
}
async function generateImageTool(settingsPath, op, options = {}) {
  const prompt = String(op.prompt ?? "").trim();
  if (!prompt) return { error: "prompt must not be empty" };
  const settings = readAiSettingsFile(settingsPath);
  const byok = activeMediaConfig(settings, "image");
  try {
    if (!byok) {
      const gate = gskGate(settings, options.notLoggedInError ?? GSK_NOT_LOGGED_IN_ERROR);
      if (gate) return gate;
      return { url: (await gskGenerateImage({ ...op, prompt })).url };
    }
    const references = await Promise.all((op.referenceImageUrls ?? []).map(loadMediaReference));
    const image = await generateImageWithProvider(byok.provider, byok.config, {
      prompt,
      aspectRatio: op.aspectRatio,
      references
    });
    return { url: storeGeneratedImage(image.bytes, image.mime) };
  } catch (err) {
    return { error: errorText(err) };
  }
}

// packages/product-config/src/index.ts
var PRODUCT_FEATURES = Object.freeze({
  ai: false,
  cloudProjects: false,
  analytics: false,
  autoUpdate: false,
  editors: Object.freeze({
    docs: true,
    sheets: true,
    slides: true,
    pdf: false,
    markdown: true,
    html: false
  })
});
var SUPPORTED_FILE_EXTENSIONS = Object.freeze([
  "docx",
  "xlsx",
  "pptx",
  "md",
  "markdown"
]);

// apps/markdown/src/main/atomic-write.ts
var import_node_crypto2 = require("node:crypto");
var import_promises2 = require("node:fs/promises");
var import_node_path7 = require("node:path");
var RETRYABLE_RENAME_CODES = /* @__PURE__ */ new Set(["EPERM", "EACCES", "EBUSY"]);
var RENAME_RETRIES = 4;
var sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function atomicWriteFile(filePath, data) {
  const tmp = (0, import_node_path7.join)(
    (0, import_node_path7.dirname)(filePath),
    `.${(0, import_node_path7.basename)(filePath)}.${(0, import_node_crypto2.randomBytes)(6).toString("hex")}.tmp`
  );
  try {
    await (0, import_promises2.writeFile)(tmp, data);
    for (let attempt = 0; ; attempt++) {
      try {
        await (0, import_promises2.rename)(tmp, filePath);
        return;
      } catch (err) {
        const code = err.code ?? "";
        if (!RETRYABLE_RENAME_CODES.has(code) || attempt >= RENAME_RETRIES) throw err;
        await sleep(50 * 2 ** attempt);
      }
    }
  } catch (err) {
    try {
      await (0, import_promises2.unlink)(tmp);
    } catch {
    }
    if (RETRYABLE_RENAME_CODES.has(err.code ?? "")) {
      await (0, import_promises2.writeFile)(filePath, data);
      return;
    }
    throw err;
  }
}

// apps/markdown/src/main/asset-lifecycle.ts
var import_node_crypto3 = require("node:crypto");
var import_node_fs6 = require("node:fs");
var import_promises3 = require("node:fs/promises");
var import_node_path8 = require("node:path");
var ASSET_MANIFEST_FILENAME = ".genoffice-assets.json";
var SHA256_RE = /^[a-f0-9]{64}$/;
var manifestLocks = /* @__PURE__ */ new Map();
function emptyManifest() {
  return {
    version: 1,
    files: [],
    documents: /* @__PURE__ */ Object.create(null),
    pending: /* @__PURE__ */ Object.create(null)
  };
}
function assetsDirFor(documentPath) {
  return (0, import_node_path8.join)((0, import_node_path8.dirname)((0, import_node_path8.resolve)(documentPath)), "assets");
}
function manifestPathFor(documentPath) {
  return (0, import_node_path8.join)(assetsDirFor(documentPath), ASSET_MANIFEST_FILENAME);
}
function documentKey(documentPath) {
  return (0, import_node_path8.basename)((0, import_node_path8.resolve)(documentPath));
}
function errorCode(error) {
  return error?.code ?? "";
}
function isSafeAssetName(name) {
  return name.length > 0 && name.length <= 180 && name !== "." && name !== ".." && name !== ASSET_MANIFEST_FILENAME && (0, import_node_path8.basename)(name) === name && !name.includes("/") && !name.includes("\\") && !name.includes("\0");
}
function replaceControlCharacters(value) {
  return [...value].map((character) => character.charCodeAt(0) < 32 ? "_" : character).join("");
}
function sanitizeAssetName(input) {
  const raw = (0, import_node_path8.basename)(input.replace(/\\/g, "/"));
  const rawExt = (0, import_node_path8.extname)(raw);
  const ext = /^\.[a-z0-9]{1,10}$/i.test(rawExt) ? rawExt.toLowerCase() : "";
  const maxStem = 140 - ext.length;
  const stem = replaceControlCharacters(raw.slice(0, raw.length - rawExt.length)).replace(/[/\\:*?"<>|#%]+/g, "_").replace(/\s+/g, "_").replace(/^\.+/, "").slice(0, maxStem).replace(/[. ]+$/g, "") || "image";
  const name = `${stem}${ext}`;
  return name === ASSET_MANIFEST_FILENAME ? `image-${name}` : name;
}
function nameWithSuffix(name, suffix) {
  if (suffix === 0) return name;
  const ext = (0, import_node_path8.extname)(name);
  return `${(0, import_node_path8.basename)(name, ext)}-${suffix}${ext}`;
}
function normalizedManifest(value) {
  if (!value || typeof value !== "object") throw new Error("asset manifest is not an object");
  const raw = value;
  if (raw.version !== 1 || !Array.isArray(raw.files)) {
    throw new Error("asset manifest has an unsupported format");
  }
  const files = [];
  const seen = /* @__PURE__ */ new Set();
  for (const item of raw.files) {
    if (!item || typeof item !== "object") throw new Error("asset manifest has a bad file entry");
    const { name, sha256 } = item;
    if (typeof name !== "string" || !isSafeAssetName(name) || typeof sha256 !== "string" || !SHA256_RE.test(sha256) || seen.has(name)) {
      throw new Error("asset manifest has an unsafe file entry");
    }
    seen.add(name);
    files.push({ name, sha256 });
  }
  const documents = /* @__PURE__ */ Object.create(null);
  if (raw.documents !== void 0) {
    if (!raw.documents || typeof raw.documents !== "object" || Array.isArray(raw.documents)) {
      throw new Error("asset manifest has bad document references");
    }
    for (const [key, names] of Object.entries(raw.documents)) {
      if (!isSafeAssetName(key) || !Array.isArray(names)) {
        throw new Error("asset manifest has unsafe document references");
      }
      const unique = /* @__PURE__ */ new Set();
      for (const name of names) {
        if (typeof name !== "string" || !isSafeAssetName(name)) {
          throw new Error("asset manifest has unsafe document references");
        }
        unique.add(name);
      }
      documents[key] = [...unique].sort();
    }
  }
  const pending = /* @__PURE__ */ Object.create(null);
  if (raw.pending !== void 0) {
    if (!raw.pending || typeof raw.pending !== "object" || Array.isArray(raw.pending)) {
      throw new Error("asset manifest has bad pending references");
    }
    for (const [key, names] of Object.entries(raw.pending)) {
      if (!isSafeAssetName(key) || !Array.isArray(names)) {
        throw new Error("asset manifest has unsafe pending references");
      }
      const unique = /* @__PURE__ */ new Set();
      for (const name of names) {
        if (typeof name !== "string" || !isSafeAssetName(name)) {
          throw new Error("asset manifest has unsafe pending references");
        }
        unique.add(name);
      }
      pending[key] = [...unique].sort();
    }
  }
  return {
    version: 1,
    files: files.sort((a, b) => a.name.localeCompare(b.name)),
    documents,
    pending
  };
}
async function existingAssetsDir(documentPath) {
  const assetsDir = assetsDirFor(documentPath);
  try {
    const info = await (0, import_promises3.lstat)(assetsDir);
    if (!info.isDirectory() || info.isSymbolicLink()) {
      throw new Error("markdown assets path must be a real directory");
    }
    return assetsDir;
  } catch (error) {
    if (errorCode(error) === "ENOENT") return null;
    throw error;
  }
}
async function ensureAssetsDir(documentPath) {
  const existing = await existingAssetsDir(documentPath);
  if (existing) return existing;
  const assetsDir = assetsDirFor(documentPath);
  await (0, import_promises3.mkdir)(assetsDir, { recursive: true });
  const info = await (0, import_promises3.lstat)(assetsDir);
  if (!info.isDirectory() || info.isSymbolicLink()) {
    throw new Error("markdown assets path must be a real directory");
  }
  return assetsDir;
}
async function assertSafeManifestFile(path) {
  try {
    const info = await (0, import_promises3.lstat)(path);
    if (!info.isFile() || info.isSymbolicLink()) {
      throw new Error("asset manifest path must be a real file");
    }
  } catch (error) {
    if (errorCode(error) !== "ENOENT") throw error;
  }
}
async function readManifestUnlocked(documentPath) {
  const assetsDir = await existingAssetsDir(documentPath);
  if (!assetsDir) return emptyManifest();
  const manifestPath = (0, import_node_path8.join)(assetsDir, ASSET_MANIFEST_FILENAME);
  try {
    await assertSafeManifestFile(manifestPath);
    return normalizedManifest(JSON.parse(await (0, import_promises3.readFile)(manifestPath, "utf8")));
  } catch (error) {
    if (errorCode(error) === "ENOENT") return emptyManifest();
    if (error instanceof SyntaxError) {
      throw new Error("asset manifest is invalid JSON", { cause: error });
    }
    throw error;
  }
}
async function writeManifestUnlocked(documentPath, manifest) {
  const assetsDir = await ensureAssetsDir(documentPath);
  const normalized = normalizedManifest(manifest);
  const text = `${JSON.stringify(normalized, null, 2)}
`;
  const manifestPath = (0, import_node_path8.join)(assetsDir, ASSET_MANIFEST_FILENAME);
  await assertSafeManifestFile(manifestPath);
  await atomicWriteFile(manifestPath, Buffer.from(text, "utf8"));
}
async function withManifestLock(documentPath, run) {
  const key = manifestPathFor(documentPath);
  const previous = manifestLocks.get(key) ?? Promise.resolve();
  let release;
  const gate = new Promise((resolveGate) => {
    release = resolveGate;
  });
  const queued = previous.catch(() => {
  }).then(() => gate);
  manifestLocks.set(key, queued);
  await previous.catch(() => {
  });
  try {
    return await run();
  } finally {
    release();
    if (manifestLocks.get(key) === queued) manifestLocks.delete(key);
  }
}
async function sha256File(path) {
  return (0, import_node_crypto3.createHash)("sha256").update(await (0, import_promises3.readFile)(path)).digest("hex");
}
async function addOwnedRecord(documentPath, record) {
  await withManifestLock(documentPath, async () => {
    const manifest = await readManifestUnlocked(documentPath);
    const existing = manifest.files.find((file) => file.name === record.name);
    if (existing && existing.sha256 !== record.sha256) {
      throw new Error("asset manifest already owns a different file with this name");
    }
    if (!existing) manifest.files.push(record);
    const key = documentKey(documentPath);
    manifest.pending[key] = [.../* @__PURE__ */ new Set([...manifest.pending[key] ?? [], record.name])].sort();
    await writeManifestUnlocked(documentPath, manifest);
  });
}
async function createOwnedAsset(documentPath, preferredName, create) {
  const assetsDir = await ensureAssetsDir(documentPath);
  const base = sanitizeAssetName(preferredName);
  for (let suffix = 0; suffix < 1e5; suffix++) {
    const name = nameWithSuffix(base, suffix);
    const target = (0, import_node_path8.join)(assetsDir, name);
    try {
      await create(target);
    } catch (error) {
      if (errorCode(error) === "EEXIST") continue;
      throw error;
    }
    try {
      await addOwnedRecord(documentPath, { name, sha256: await sha256File(target) });
      return `assets/${name}`;
    } catch (error) {
      await (0, import_promises3.rm)(target, { force: true }).catch(() => {
      });
      throw error;
    }
  }
  throw new Error("markdown asset name space exhausted");
}
async function copyImageIntoOwnedAssets(documentPath, sourcePath) {
  return createOwnedAsset(
    documentPath,
    (0, import_node_path8.basename)(sourcePath),
    (target) => (0, import_promises3.copyFile)(sourcePath, target, import_node_fs6.constants.COPYFILE_EXCL)
  );
}
async function writeImageIntoOwnedAssets(documentPath, preferredName, bytes) {
  return createOwnedAsset(
    documentPath,
    preferredName,
    (target) => (0, import_promises3.writeFile)(target, bytes, { flag: "wx" })
  );
}
function decodeLocalSource(source) {
  const trimmed = source.trim();
  if (!trimmed || trimmed.includes("\0") || trimmed.includes("?") || trimmed.includes("#") || trimmed.startsWith("/") || trimmed.startsWith("\\") || /^[a-zA-Z]:[\\/]/.test(trimmed) || /^[a-z][a-z0-9+.-]*:/i.test(trimmed)) {
    return null;
  }
  try {
    return decodeURIComponent(trimmed);
  } catch {
    return null;
  }
}
function isPathInside(root, candidate) {
  const fromRoot = (0, import_node_path8.relative)(root, candidate);
  return fromRoot.length > 0 && fromRoot !== ".." && !fromRoot.startsWith(`..${import_node_path8.sep}`) && !(0, import_node_path8.isAbsolute)(fromRoot);
}
async function resolveSafeRelativeImagePath(documentPath, source) {
  const decoded = decodeLocalSource(source);
  if (!decoded) return null;
  const documentDir = (0, import_node_path8.dirname)((0, import_node_path8.resolve)(documentPath));
  const candidate = (0, import_node_path8.resolve)(documentDir, decoded.replace(/[\\/]/g, import_node_path8.sep));
  if (!isPathInside(documentDir, candidate)) return null;
  try {
    const [realDocumentDir, realCandidate, info] = await Promise.all([
      (0, import_promises3.realpath)(documentDir),
      (0, import_promises3.realpath)(candidate),
      (0, import_promises3.stat)(candidate)
    ]);
    if (!info.isFile() || !isPathInside(realDocumentDir, realCandidate)) return null;
    return realCandidate;
  } catch {
    return null;
  }
}
function ownedNameForSource(source) {
  const decoded = decodeLocalSource(source);
  if (!decoded) return null;
  const parts = decoded.replace(/\\/g, "/").split("/").filter((part) => part && part !== ".");
  if (parts.length !== 2 || parts[0].toLowerCase() !== "assets" || parts.some((part) => part === "..") || !isSafeAssetName(parts[1])) {
    return null;
  }
  return parts[1];
}
async function siblingMarkdownReferences(documentPath, ownedNames, includeCurrent = false) {
  const references = /* @__PURE__ */ new Set();
  const documentDir = (0, import_node_path8.dirname)((0, import_node_path8.resolve)(documentPath));
  const currentKey = documentKey(documentPath);
  try {
    for (const entry of await (0, import_promises3.readdir)(documentDir, { withFileTypes: true })) {
      if (!entry.isFile() || !includeCurrent && entry.name === currentKey || !/\.(?:md|markdown)$/i.test(entry.name)) {
        continue;
      }
      const path = (0, import_node_path8.join)(documentDir, entry.name);
      try {
        const info = await (0, import_promises3.stat)(path);
        if (info.size > 16 * 1024 * 1024) return new Set(ownedNames);
        const scan = scanImageSources(await (0, import_promises3.readFile)(path, "utf8"));
        if (scan.ambiguousHtml) return new Set(ownedNames);
        for (const { source } of scan.ranges) {
          const name = ownedNameForSource(source);
          if (name && ownedNames.has(name)) references.add(name);
        }
      } catch {
        return new Set(ownedNames);
      }
    }
  } catch {
    return new Set(ownedNames);
  }
  return references;
}
function escapedAt(text, index) {
  let slashes = 0;
  for (let i = index - 1; i >= 0 && text[i] === "\\"; i--) slashes++;
  return slashes % 2 === 1;
}
function imageDestinationRanges(markdown) {
  const ranges = [];
  for (let i = 0; i < markdown.length - 2; i++) {
    if (markdown[i] !== "!" || markdown[i + 1] !== "[" || escapedAt(markdown, i)) continue;
    let bracketDepth = 1;
    let altEnd = i + 2;
    for (; altEnd < markdown.length; altEnd++) {
      if (escapedAt(markdown, altEnd)) continue;
      if (markdown[altEnd] === "[") bracketDepth++;
      else if (markdown[altEnd] === "]" && --bracketDepth === 0) break;
    }
    if (bracketDepth !== 0) continue;
    let open = altEnd + 1;
    while (markdown[open] === " " || markdown[open] === "	") open++;
    if (markdown[open] !== "(") {
      i = altEnd;
      continue;
    }
    let close = open + 1;
    let parenDepth = 1;
    let quote = "";
    let angle = false;
    for (; close < markdown.length; close++) {
      const char = markdown[close];
      if (escapedAt(markdown, close)) continue;
      if (quote) {
        if (char === quote) quote = "";
        continue;
      }
      if (angle) {
        if (char === ">") angle = false;
        continue;
      }
      if (char === '"' || char === "'") quote = char;
      else if (char === "<") angle = true;
      else if (char === "(") parenDepth++;
      else if (char === ")" && --parenDepth === 0) break;
    }
    if (parenDepth !== 0) continue;
    let start = open + 1;
    let end = close;
    while (start < end && /\s/.test(markdown[start])) start++;
    while (end > start && /\s/.test(markdown[end - 1])) end--;
    if (markdown[start] === "<") {
      const angleEnd = markdown.indexOf(">", start + 1);
      if (angleEnd > start && angleEnd <= end) {
        start++;
        end = angleEnd;
      }
    } else {
      const raw = markdown.slice(start, end);
      const title = /\s+(?:"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|\((?:\\.|[^)\\])*\))\s*$/.exec(raw);
      if (title?.index !== void 0) end = start + title.index;
      while (end > start && /\s/.test(markdown[end - 1])) end--;
    }
    if (end > start) {
      const source = markdown.slice(start, end).replace(/\\([\\()[\]<> ])/g, "$1");
      ranges.push({ start, end, source });
    }
    i = close;
  }
  return ranges;
}
var BASIC_HTML_ENTITIES = {
  amp: "&",
  apos: "'",
  gt: ">",
  lt: "<",
  nbsp: "\xA0",
  quot: '"'
};
function decodeHtmlImageSource(value) {
  let ambiguous = false;
  const source = value.replace(/&([^&;\s]+);/g, (entity, body) => {
    if (body.startsWith("#")) {
      const hexadecimal = body[1]?.toLowerCase() === "x";
      const digits = body.slice(hexadecimal ? 2 : 1);
      if (digits.length === 0 || !(hexadecimal ? /^[0-9a-f]+$/i.test(digits) : /^[0-9]+$/.test(digits))) {
        ambiguous = true;
        return entity;
      }
      const codePoint = Number.parseInt(digits, hexadecimal ? 16 : 10);
      if (codePoint <= 0 || codePoint > 1114111 || codePoint >= 55296 && codePoint <= 57343) {
        ambiguous = true;
        return entity;
      }
      return String.fromCodePoint(codePoint);
    }
    const decoded = BASIC_HTML_ENTITIES[body.toLowerCase()];
    if (decoded === void 0) {
      ambiguous = true;
      return entity;
    }
    return decoded;
  });
  if (/&#(?:x[0-9a-f]*|[0-9]*)/i.test(source)) ambiguous = true;
  return { source, ambiguous };
}
function parseHtmlImageTag(text, tagStart) {
  let cursor = tagStart + 4;
  let sourceRange;
  let ambiguous = false;
  while (cursor < text.length) {
    while (cursor < text.length && /\s/.test(text[cursor])) cursor += 1;
    if (cursor >= text.length) return { nextIndex: text.length, ambiguous: true };
    if (text[cursor] === ">") {
      return {
        nextIndex: cursor + 1,
        ...ambiguous || sourceRange === void 0 ? {} : { range: sourceRange },
        ambiguous
      };
    }
    if (text[cursor] === "/" && text[cursor + 1] === ">") {
      return {
        nextIndex: cursor + 2,
        ...ambiguous || sourceRange === void 0 ? {} : { range: sourceRange },
        ambiguous
      };
    }
    if (text[cursor] === "/") {
      ambiguous = true;
      cursor += 1;
      continue;
    }
    const nameStart = cursor;
    while (cursor < text.length && !/\s/.test(text[cursor]) && text[cursor] !== "=" && text[cursor] !== "/" && text[cursor] !== ">") {
      cursor += 1;
    }
    if (cursor === nameStart) {
      ambiguous = true;
      cursor += 1;
      continue;
    }
    const attributeName = text.slice(nameStart, cursor).toLowerCase();
    while (cursor < text.length && /\s/.test(text[cursor])) cursor += 1;
    if (text[cursor] !== "=") {
      if (attributeName === "src") ambiguous = true;
      continue;
    }
    cursor += 1;
    while (cursor < text.length && /\s/.test(text[cursor])) cursor += 1;
    if (cursor >= text.length || text[cursor] === ">" || text[cursor] === "/" && text[cursor + 1] === ">") {
      if (attributeName === "src") ambiguous = true;
      continue;
    }
    const quote = text[cursor] === '"' ? '"' : text[cursor] === "'" ? "'" : null;
    let valueStart;
    let valueEnd;
    if (quote !== null) {
      valueStart = cursor + 1;
      valueEnd = text.indexOf(quote, valueStart);
      if (valueEnd < 0) return { nextIndex: text.length, ambiguous: true };
      cursor = valueEnd + 1;
    } else {
      valueStart = cursor;
      while (cursor < text.length && !/\s/.test(text[cursor]) && text[cursor] !== ">" && !(text[cursor] === "/" && text[cursor + 1] === ">")) {
        if (/["'`<=]/.test(text[cursor])) ambiguous = true;
        cursor += 1;
      }
      valueEnd = cursor;
      if (valueEnd === valueStart && attributeName === "src") ambiguous = true;
    }
    if (attributeName !== "src") continue;
    if (sourceRange !== void 0) {
      ambiguous = true;
      continue;
    }
    const decoded = decodeHtmlImageSource(text.slice(valueStart, valueEnd));
    if (decoded.ambiguous) ambiguous = true;
    sourceRange = {
      start: valueStart,
      end: valueEnd,
      source: decoded.source,
      htmlQuote: quote
    };
  }
  return { nextIndex: text.length, ambiguous: true };
}
function positionInRanges(ranges, position) {
  let low = 0;
  let high = ranges.length - 1;
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    const range = ranges[middle];
    if (position < range.start) high = middle - 1;
    else if (position >= range.end) low = middle + 1;
    else return range;
  }
  return void 0;
}
function markdownCodeRanges(markdown) {
  const blockRanges = [];
  let fence = null;
  let offset = 0;
  for (const lineWithBreak of markdown.match(/.*(?:\n|$)/g) ?? []) {
    if (!lineWithBreak) continue;
    const line = lineWithBreak.replace(/\r?\n$/, "");
    const lineEnd = offset + lineWithBreak.length;
    if (fence) {
      const close = new RegExp(`^ {0,3}\\${fence.marker}{${fence.length},}[ \\t]*$`);
      if (close.test(line)) {
        blockRanges.push({ start: fence.start, end: lineEnd });
        fence = null;
      }
    } else {
      const open = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line);
      if (open && (open[1][0] === "~" || !open[2].includes("`"))) {
        fence = {
          marker: open[1][0],
          length: open[1].length,
          start: offset
        };
      } else if (/^(?: {4}|\t)/.test(line)) {
        blockRanges.push({ start: offset, end: lineEnd });
      }
    }
    offset = lineEnd;
  }
  if (fence) blockRanges.push({ start: fence.start, end: markdown.length });
  blockRanges.sort((left, right) => left.start - right.start);
  const ranges = [...blockRanges];
  for (let index = 0; index < markdown.length; ) {
    const block = positionInRanges(blockRanges, index);
    if (block) {
      index = block.end;
      continue;
    }
    if (markdown[index] !== "`" || escapedAt(markdown, index)) {
      index += 1;
      continue;
    }
    let runEnd = index + 1;
    while (markdown[runEnd] === "`") runEnd += 1;
    const runLength = runEnd - index;
    let search = runEnd;
    let closeEnd = -1;
    while (search < markdown.length) {
      const blocked = positionInRanges(blockRanges, search);
      if (blocked) {
        search = blocked.end;
        continue;
      }
      const next = markdown.indexOf("`", search);
      if (next < 0) break;
      let nextEnd = next + 1;
      while (markdown[nextEnd] === "`") nextEnd += 1;
      if (nextEnd - next === runLength) {
        closeEnd = nextEnd;
        break;
      }
      search = nextEnd;
    }
    if (closeEnd > 0) {
      ranges.push({ start: index, end: closeEnd });
      index = closeEnd;
    } else {
      index = runEnd;
    }
  }
  return ranges.sort((left, right) => left.start - right.start);
}
function htmlImageSourceRanges(markdown, codeRanges) {
  const ranges = [];
  let ambiguousHtml = false;
  for (let index = 0; index < markdown.length; index += 1) {
    const code = positionInRanges(codeRanges, index);
    if (code) {
      index = code.end - 1;
      continue;
    }
    if (markdown[index] !== "<") continue;
    if (markdown.startsWith("<!--", index)) {
      const commentEnd = markdown.indexOf("-->", index + 4);
      if (commentEnd < 0) {
        if (/<img(?:\s|\/|>)/i.test(markdown.slice(index + 4))) ambiguousHtml = true;
        break;
      }
      index = commentEnd + 2;
      continue;
    }
    if (markdown.slice(index + 1, index + 4).toLowerCase() !== "img" || index + 4 < markdown.length && !/[\s/>]/.test(markdown[index + 4])) {
      continue;
    }
    const parsed = parseHtmlImageTag(markdown, index);
    if (parsed.ambiguous) ambiguousHtml = true;
    if (parsed.range) ranges.push(parsed.range);
    index = Math.max(index, parsed.nextIndex - 1);
  }
  return { ranges, ambiguousHtml };
}
function scanImageSources(markdown) {
  const codeRanges = markdownCodeRanges(markdown);
  const html = htmlImageSourceRanges(markdown, codeRanges);
  const markdownRanges = imageDestinationRanges(markdown).filter(
    (range) => positionInRanges(codeRanges, range.start) === void 0
  );
  const ordered = [...markdownRanges, ...html.ranges].sort(
    (left, right) => left.start - right.start || left.end - right.end
  );
  const ranges = [];
  for (const range of ordered) {
    const previous = ranges[ranges.length - 1];
    if (previous && range.start < previous.end) {
      html.ambiguousHtml = true;
      continue;
    }
    ranges.push(range);
  }
  return { ranges, ambiguousHtml: html.ambiguousHtml };
}
function extractMarkdownImageSources(markdown) {
  return scanImageSources(markdown).ranges.map((range) => range.source);
}
function encodeHtmlAttributeReplacement(value, quote) {
  let encoded = "";
  for (const character of value) {
    if (character === "&") encoded += "&amp;";
    else if (character === "<") encoded += "&lt;";
    else if (quote === '"' && character === '"') encoded += "&quot;";
    else if (quote === "'" && character === "'") encoded += "&#39;";
    else if (quote === null && /[\s"'`=>]/.test(character)) {
      encoded += `&#${character.codePointAt(0)};`;
    } else encoded += character;
  }
  return encoded;
}
function rewriteMarkdownImageSources(markdown, rewrites) {
  if (rewrites.size === 0) return markdown;
  const ranges = scanImageSources(markdown).ranges;
  let cursor = 0;
  let output = "";
  for (const range of ranges) {
    const replacement = rewrites.get(range.source);
    if (replacement === void 0) continue;
    output += markdown.slice(cursor, range.start);
    output += range.htmlQuote === void 0 ? replacement : encodeHtmlAttributeReplacement(replacement, range.htmlQuote);
    cursor = range.end;
  }
  return cursor === 0 ? markdown : output + markdown.slice(cursor);
}
async function removeCreatedRecords(documentPath, created) {
  if (created.length === 0) return;
  await withManifestLock(documentPath, async () => {
    const manifest = await readManifestUnlocked(documentPath);
    const createdNames = new Set(created.map((record) => record.name));
    const key = documentKey(documentPath);
    manifest.pending[key] = (manifest.pending[key] ?? []).filter((name) => !createdNames.has(name));
    if (manifest.pending[key].length === 0) delete manifest.pending[key];
    const referenced = /* @__PURE__ */ new Set([
      ...Object.values(manifest.documents).flat(),
      ...Object.values(manifest.pending).flat()
    ]);
    const removeNames = /* @__PURE__ */ new Set();
    for (const record of created) {
      if (referenced.has(record.name)) continue;
      const current = manifest.files.find(
        (file) => file.name === record.name && file.sha256 === record.sha256
      );
      if (!current) continue;
      const path = (0, import_node_path8.join)(assetsDirFor(documentPath), record.name);
      try {
        const info = await (0, import_promises3.lstat)(path);
        if (!info.isFile() || info.isSymbolicLink() || await sha256File(path) !== record.sha256) {
          continue;
        }
        await (0, import_promises3.rm)(path);
        removeNames.add(record.name);
      } catch (error) {
        if (errorCode(error) === "ENOENT") removeNames.add(record.name);
      }
    }
    manifest.files = manifest.files.filter((file) => !removeNames.has(file.name));
    for (const key2 of Object.keys(manifest.documents)) {
      manifest.documents[key2] = manifest.documents[key2].filter((name) => !removeNames.has(name));
      if (manifest.documents[key2].length === 0) delete manifest.documents[key2];
    }
    for (const key2 of Object.keys(manifest.pending)) {
      manifest.pending[key2] = manifest.pending[key2].filter((name) => !removeNames.has(name));
      if (manifest.pending[key2].length === 0) delete manifest.pending[key2];
    }
    await writeManifestUnlocked(documentPath, manifest);
  });
}
async function prepareAssetsForSaveAs(sourceDocumentPath, targetDocumentPath, text, imageSources) {
  const allImageSources = [...imageSources];
  const knownSources = new Set(allImageSources);
  for (const source of extractMarkdownImageSources(text)) {
    if (knownSources.has(source)) continue;
    knownSources.add(source);
    allImageSources.push(source);
  }
  if ((0, import_node_path8.resolve)((0, import_node_path8.dirname)(sourceDocumentPath)) === (0, import_node_path8.resolve)((0, import_node_path8.dirname)(targetDocumentPath))) {
    return {
      targetDocumentPath,
      text,
      imageSources: allImageSources,
      rewrites: [],
      created: []
    };
  }
  const created = [];
  const rewrites = /* @__PURE__ */ new Map();
  const targetAssetsDir = await ensureAssetsDir(targetDocumentPath);
  try {
    await withManifestLock(targetDocumentPath, async () => {
      const manifest = await readManifestUnlocked(targetDocumentPath);
      const reservedNames = new Set(manifest.files.map((file) => file.name));
      const copiedByRealPath = /* @__PURE__ */ new Map();
      for (const source of allImageSources) {
        if (rewrites.has(source)) continue;
        const safeSource = await resolveSafeRelativeImagePath(sourceDocumentPath, source);
        if (!safeSource) continue;
        const alreadyCopied = copiedByRealPath.get(safeSource);
        if (alreadyCopied) {
          rewrites.set(source, alreadyCopied);
          continue;
        }
        const base = sanitizeAssetName((0, import_node_path8.basename)(safeSource));
        let copied = null;
        for (let suffix = 0; suffix < 1e5; suffix++) {
          const name = nameWithSuffix(base, suffix);
          if (reservedNames.has(name)) continue;
          const target = (0, import_node_path8.join)(targetAssetsDir, name);
          try {
            await (0, import_promises3.copyFile)(safeSource, target, import_node_fs6.constants.COPYFILE_EXCL);
            copied = { name, sha256: await sha256File(target) };
            break;
          } catch (error) {
            if (errorCode(error) === "EEXIST") continue;
            throw error;
          }
        }
        if (!copied) throw new Error("markdown asset name space exhausted");
        created.push(copied);
        manifest.files.push(copied);
        reservedNames.add(copied.name);
        const targetKey = documentKey(targetDocumentPath);
        manifest.pending[targetKey] = [
          .../* @__PURE__ */ new Set([...manifest.pending[targetKey] ?? [], copied.name])
        ].sort();
        const authored = `assets/${copied.name}`;
        copiedByRealPath.set(safeSource, authored);
        rewrites.set(source, authored);
      }
      const rewrittenDestinations = new Set(
        extractMarkdownImageSources(rewriteMarkdownImageSources(text, rewrites))
      );
      for (const destination of rewrites.values()) {
        if (!rewrittenDestinations.has(destination)) {
          throw new Error("could not safely rewrite a Markdown image during Save As");
        }
      }
      await writeManifestUnlocked(targetDocumentPath, manifest);
    });
  } catch (error) {
    for (const record of created) {
      await (0, import_promises3.rm)((0, import_node_path8.join)(targetAssetsDir, record.name), { force: true }).catch(() => {
      });
    }
    throw error;
  }
  const rewriteList = [...rewrites].map(([from, to]) => ({ from, to }));
  return {
    targetDocumentPath,
    text: rewriteMarkdownImageSources(text, rewrites),
    imageSources: allImageSources.map((source) => rewrites.get(source) ?? source),
    rewrites: rewriteList,
    created
  };
}
async function rollbackPreparedSaveAsAssets(plan) {
  await removeCreatedRecords(plan.targetDocumentPath, plan.created);
}
async function pendingOwnedAssetsForDocument(documentPath) {
  try {
    return await withManifestLock(documentPath, async () => {
      const manifest = await readManifestUnlocked(documentPath);
      return [...manifest.pending[documentKey(documentPath)] ?? []];
    });
  } catch {
    return [];
  }
}
async function resolvePendingOwnedAssets(documentPath, pendingAtOperationStart) {
  const result = { deleted: [], preserved: [], errors: [] };
  try {
    return await withManifestLock(documentPath, async () => {
      const manifest = await readManifestUnlocked(documentPath);
      const key = documentKey(documentPath);
      const currentPending = manifest.pending[key] ?? [];
      const requested = new Set(pendingAtOperationStart ?? currentPending);
      const pendingNames = new Set(currentPending.filter((name) => requested.has(name)));
      if (pendingNames.size === 0) return result;
      manifest.pending[key] = currentPending.filter((name) => !pendingNames.has(name));
      if (manifest.pending[key].length === 0) delete manifest.pending[key];
      const assetsDir = await existingAssetsDir(documentPath);
      if (!assetsDir) return result;
      const recordsByName = new Map(manifest.files.map((record) => [record.name, record]));
      const ownedNames = new Set(recordsByName.keys());
      const referenced = /* @__PURE__ */ new Set([
        ...Object.values(manifest.documents).flat(),
        ...Object.values(manifest.pending).flat()
      ]);
      for (const name of await siblingMarkdownReferences(documentPath, ownedNames, true)) {
        referenced.add(name);
      }
      const relinquished = /* @__PURE__ */ new Set();
      for (const name of pendingNames) {
        const record = recordsByName.get(name);
        if (!record) continue;
        const path = (0, import_node_path8.join)(assetsDir, name);
        try {
          const info = await (0, import_promises3.lstat)(path);
          if (!info.isFile() || info.isSymbolicLink() || await sha256File(path) !== record.sha256) {
            relinquished.add(name);
            result.preserved.push(name);
            continue;
          }
          if (referenced.has(name)) {
            result.preserved.push(name);
            continue;
          }
          await (0, import_promises3.rm)(path);
          relinquished.add(name);
          result.deleted.push(name);
        } catch (error) {
          if (errorCode(error) === "ENOENT") {
            relinquished.add(name);
          } else {
            result.preserved.push(name);
            result.errors.push(`${name}: ${error instanceof Error ? error.message : String(error)}`);
          }
        }
      }
      manifest.files = manifest.files.filter((record) => !relinquished.has(record.name));
      for (const references of [manifest.documents, manifest.pending]) {
        for (const referenceKey of Object.keys(references)) {
          references[referenceKey] = references[referenceKey].filter(
            (name) => !relinquished.has(name)
          );
          if (references[referenceKey].length === 0) delete references[referenceKey];
        }
      }
      await writeManifestUnlocked(documentPath, manifest);
      return result;
    });
  } catch (error) {
    result.errors.push(error instanceof Error ? error.message : String(error));
    return result;
  }
}
async function discardPendingOwnedAssets(documentPath) {
  return resolvePendingOwnedAssets(documentPath);
}
async function resolveSourcePendingAfterSaveAs(sourceDocumentPath, pendingAtSaveStart) {
  return resolvePendingOwnedAssets(sourceDocumentPath, pendingAtSaveStart);
}
async function reconcileOwnedAssets(documentPath, imageSources, options = {}) {
  const result = { deleted: [], preserved: [], errors: [] };
  try {
    return await withManifestLock(documentPath, async () => {
      const manifest = await readManifestUnlocked(documentPath);
      const assetsDir = await existingAssetsDir(documentPath);
      if (!assetsDir) return result;
      const validRecords = [];
      const relinquished = /* @__PURE__ */ new Set();
      for (const record of manifest.files) {
        const path = (0, import_node_path8.join)(assetsDir, record.name);
        try {
          const info = await (0, import_promises3.lstat)(path);
          if (!info.isFile() || info.isSymbolicLink() || await sha256File(path) !== record.sha256) {
            relinquished.add(record.name);
            result.preserved.push(record.name);
          } else {
            validRecords.push(record);
          }
        } catch (error) {
          if (errorCode(error) !== "ENOENT") {
            relinquished.add(record.name);
            result.preserved.push(record.name);
            result.errors.push(
              `${record.name}: ${error instanceof Error ? error.message : String(error)}`
            );
          }
        }
      }
      manifest.files = validRecords;
      const ownedNames = new Set(validRecords.map((record) => record.name));
      for (const key2 of Object.keys(manifest.documents)) {
        manifest.documents[key2] = manifest.documents[key2].filter(
          (name) => ownedNames.has(name) && !relinquished.has(name)
        );
        if (manifest.documents[key2].length === 0) delete manifest.documents[key2];
      }
      for (const key2 of Object.keys(manifest.pending)) {
        manifest.pending[key2] = manifest.pending[key2].filter(
          (name) => ownedNames.has(name) && !relinquished.has(name)
        );
        if (manifest.pending[key2].length === 0) delete manifest.pending[key2];
      }
      const currentReferences = /* @__PURE__ */ new Set();
      for (const source of imageSources) {
        const name = ownedNameForSource(source);
        if (name && ownedNames.has(name)) currentReferences.add(name);
      }
      const key = documentKey(documentPath);
      if (currentReferences.size > 0) {
        manifest.documents[key] = [...currentReferences].sort();
      } else {
        delete manifest.documents[key];
      }
      const pendingToResolve = new Set(options.pendingNames ?? manifest.pending[key] ?? []);
      manifest.pending[key] = (manifest.pending[key] ?? []).filter(
        (name) => !pendingToResolve.has(name)
      );
      if (manifest.pending[key].length === 0) delete manifest.pending[key];
      const referenced = /* @__PURE__ */ new Set([
        ...Object.values(manifest.documents).flat(),
        ...Object.values(manifest.pending).flat()
      ]);
      for (const name of await siblingMarkdownReferences(documentPath, ownedNames)) {
        referenced.add(name);
      }
      const deleted = /* @__PURE__ */ new Set();
      for (const record of validRecords) {
        if (referenced.has(record.name)) continue;
        const path = (0, import_node_path8.join)(assetsDir, record.name);
        try {
          const info = await (0, import_promises3.lstat)(path);
          if (!info.isFile() || info.isSymbolicLink() || await sha256File(path) !== record.sha256) {
            result.preserved.push(record.name);
            continue;
          }
          await (0, import_promises3.rm)(path);
          deleted.add(record.name);
          result.deleted.push(record.name);
        } catch (error) {
          if (errorCode(error) === "ENOENT") {
            deleted.add(record.name);
          } else {
            result.errors.push(
              `${record.name}: ${error instanceof Error ? error.message : String(error)}`
            );
          }
        }
      }
      manifest.files = manifest.files.filter((record) => !deleted.has(record.name));
      for (const doc of Object.keys(manifest.documents)) {
        manifest.documents[doc] = manifest.documents[doc].filter((name) => !deleted.has(name));
        if (manifest.documents[doc].length === 0) delete manifest.documents[doc];
      }
      for (const doc of Object.keys(manifest.pending)) {
        manifest.pending[doc] = manifest.pending[doc].filter((name) => !deleted.has(name));
        if (manifest.pending[doc].length === 0) delete manifest.pending[doc];
      }
      try {
        await writeManifestUnlocked(documentPath, manifest);
      } catch (error) {
        result.errors.push(error instanceof Error ? error.message : String(error));
      }
      return result;
    });
  } catch (error) {
    result.errors.push(error instanceof Error ? error.message : String(error));
    return result;
  }
}

// apps/markdown/src/main/conversion-lifecycle.ts
var import_node_crypto4 = require("node:crypto");
var import_promises4 = require("node:fs/promises");
var import_node_path9 = require("node:path");
var MARKDOWN_CONVERSION_TTL_MS = 7 * 24 * 60 * 60 * 1e3;
var SESSION_MARKER = ".genoffice-markdown-conversion.json";
function errorCode2(error) {
  return error?.code ?? "";
}
function isPathInside2(root, candidate) {
  const fromRoot = (0, import_node_path9.relative)(root, candidate);
  return fromRoot.length > 0 && fromRoot !== ".." && !fromRoot.startsWith(`..${import_node_path9.sep}`) && !(0, import_node_path9.isAbsolute)(fromRoot);
}
function replaceControlCharacters2(value) {
  return [...value].map((character) => character.charCodeAt(0) < 32 ? "_" : character).join("");
}
function safeBaseName(input) {
  const raw = (0, import_node_path9.basename)(input);
  const ext = (0, import_node_path9.extname)(raw);
  return replaceControlCharacters2(raw.slice(0, raw.length - ext.length)).replace(/[/\\:*?"<>|]+/g, "_").replace(/\s+/g, "_").replace(/^\.+/, "").slice(0, 100).replace(/[. ]+$/g, "") || "Untitled";
}
async function readSessionMarker(directory) {
  try {
    const value = JSON.parse(await (0, import_promises4.readFile)((0, import_node_path9.join)(directory, SESSION_MARKER), "utf8"));
    if (value.version !== 1 || typeof value.createdAt !== "number" || !Number.isFinite(value.createdAt) || value.createdAt < 0) {
      return null;
    }
    return { version: 1, createdAt: value.createdAt };
  } catch {
    return null;
  }
}
async function cleanupStaleMarkdownConversions(root, now = Date.now(), ttlMs = MARKDOWN_CONVERSION_TTL_MS) {
  const absoluteRoot = (0, import_node_path9.resolve)(root);
  await (0, import_promises4.mkdir)(absoluteRoot, { recursive: true });
  const removed = [];
  for (const entry of await (0, import_promises4.readdir)(absoluteRoot, { withFileTypes: true })) {
    if (!entry.isDirectory() || !entry.name.startsWith("session-")) continue;
    const directory = (0, import_node_path9.join)(absoluteRoot, entry.name);
    if (!isPathInside2(absoluteRoot, directory)) continue;
    const marker = await readSessionMarker(directory);
    if (!marker || now - marker.createdAt < ttlMs) continue;
    await (0, import_promises4.rm)(directory, { recursive: true, force: true });
    removed.push(directory);
  }
  return removed;
}
async function createMarkdownConversionSession(root, options = {}) {
  const now = options.now ?? Date.now();
  const absoluteRoot = (0, import_node_path9.resolve)(root);
  await cleanupStaleMarkdownConversions(
    absoluteRoot,
    now,
    options.ttlMs ?? MARKDOWN_CONVERSION_TTL_MS
  );
  const rawId = options.id ?? (0, import_node_crypto4.randomUUID)();
  const id = rawId.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 80) || (0, import_node_crypto4.randomUUID)();
  const directory = (0, import_node_path9.join)(absoluteRoot, `session-${now}-${id}`);
  if (!isPathInside2(absoluteRoot, directory)) {
    throw new Error("invalid Markdown conversion session path");
  }
  await (0, import_promises4.mkdir)(directory);
  const marker = { version: 1, createdAt: now };
  await (0, import_promises4.writeFile)((0, import_node_path9.join)(directory, SESSION_MARKER), `${JSON.stringify(marker)}
`, { flag: "wx" });
  return directory;
}
async function writeMarkdownConversion(sessionDirectory, suggestedName, bytes, id = (0, import_node_crypto4.randomUUID)()) {
  const marker = await readSessionMarker(sessionDirectory);
  if (!marker) throw new Error("invalid Markdown conversion session");
  const base = safeBaseName(suggestedName);
  const safeId = id.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 80) || (0, import_node_crypto4.randomUUID)();
  for (let suffix = 0; suffix < 1e5; suffix++) {
    const tail = suffix === 0 ? "" : `-${suffix}`;
    const target = (0, import_node_path9.join)(sessionDirectory, `${base}-${safeId}${tail}.docx`);
    if (!isPathInside2((0, import_node_path9.resolve)(sessionDirectory), (0, import_node_path9.resolve)(target))) {
      throw new Error("invalid Markdown conversion output path");
    }
    try {
      await (0, import_promises4.writeFile)(target, bytes, { flag: "wx" });
      return target;
    } catch (error) {
      if (errorCode2(error) === "EEXIST") continue;
      throw error;
    }
  }
  throw new Error("Markdown conversion name space exhausted");
}

// apps/markdown/src/shared/ipc.ts
var MARKDOWN_CHANNELS = {
  consumePending: "markdown:consume-pending",
  readFile: "markdown:read-file",
  save: "markdown:save",
  saveRequest: "markdown:save-request",
  saveRequestAck: "markdown:save-request-ack",
  dirtyChanged: "markdown:dirty-changed",
  closeSaveRequest: "markdown:close-save-request",
  closeSaveResult: "markdown:close-save-result",
  fileRenamed: "markdown:file-renamed",
  pickImage: "markdown:pick-image",
  saveImage: "markdown:save-image",
  readImage: "markdown:read-image",
  exportRequest: "markdown:export-request",
  exportDocx: "markdown:export-docx",
  exportPdf: "markdown:export-pdf",
  printRequest: "markdown:print-request",
  aiGenerateImage: "markdown:ai-generate-image",
  getLanguage: "app:get-language",
  languageChanged: "app:language-changed",
  getTheme: "app:get-theme",
  themeChanged: "app:theme-changed",
  getAutoSaveDefault: "app:get-auto-save-default",
  autoSaveDefaultChanged: "app:auto-save-default-changed",
  getAiPanelPrefs: "app:get-ai-panel-prefs",
  aiPanelPrefsChanged: "app:ai-panel-prefs-changed"
};

// apps/markdown/src/main/markdown-main.ts
var tDlg = createI18n({
  zh: {
    dlgSaveTitle: "\u4FDD\u5B58 Markdown \u6587\u6863",
    filterMarkdown: "Markdown \u6587\u6863",
    dlgPickImage: "\u9009\u62E9\u56FE\u7247",
    filterImages: "\u56FE\u7247",
    untitledFile: "\u672A\u547D\u540D\u6587\u6863",
    closeUnsavedMsg: "\u6B64\u6587\u6863\u6709\u672A\u4FDD\u5B58\u7684\u66F4\u6539\u3002",
    closeUnsavedDetail: "\u5173\u95ED\u524D\u662F\u5426\u4FDD\u5B58\uFF1F",
    btnSave: "\u4FDD\u5B58",
    btnDontSave: "\u4E0D\u4FDD\u5B58",
    btnCancel: "\u53D6\u6D88"
  },
  en: {
    dlgSaveTitle: "Save Markdown Document",
    filterMarkdown: "Markdown Documents",
    dlgPickImage: "Choose an Image",
    filterImages: "Images",
    untitledFile: "Untitled",
    closeUnsavedMsg: "This document has unsaved changes.",
    closeUnsavedDetail: "Do you want to save them before closing?",
    btnSave: "Save",
    btnDontSave: "Don't Save",
    btnCancel: "Cancel"
  },
  ja: {
    dlgSaveTitle: "Markdown \u30C9\u30AD\u30E5\u30E1\u30F3\u30C8\u3092\u4FDD\u5B58",
    filterMarkdown: "Markdown \u30C9\u30AD\u30E5\u30E1\u30F3\u30C8",
    dlgPickImage: "\u753B\u50CF\u3092\u9078\u629E",
    filterImages: "\u753B\u50CF",
    untitledFile: "\u7121\u984C",
    closeUnsavedMsg: "\u3053\u306E\u30C9\u30AD\u30E5\u30E1\u30F3\u30C8\u306B\u672A\u4FDD\u5B58\u306E\u5909\u66F4\u304C\u3042\u308A\u307E\u3059\u3002",
    closeUnsavedDetail: "\u9589\u3058\u308B\u524D\u306B\u4FDD\u5B58\u3057\u307E\u3059\u304B\uFF1F",
    btnSave: "\u4FDD\u5B58",
    btnDontSave: "\u4FDD\u5B58\u3057\u306A\u3044",
    btnCancel: "\u30AD\u30E3\u30F3\u30BB\u30EB"
  },
  ko: {
    dlgSaveTitle: "Markdown \uBB38\uC11C \uC800\uC7A5",
    filterMarkdown: "Markdown \uBB38\uC11C",
    dlgPickImage: "\uC774\uBBF8\uC9C0 \uC120\uD0DD",
    filterImages: "\uC774\uBBF8\uC9C0",
    untitledFile: "\uC81C\uBAA9 \uC5C6\uC74C",
    closeUnsavedMsg: "\uC774 \uBB38\uC11C\uC5D0 \uC800\uC7A5\uD558\uC9C0 \uC54A\uC740 \uBCC0\uACBD \uC0AC\uD56D\uC774 \uC788\uC2B5\uB2C8\uB2E4.",
    closeUnsavedDetail: "\uB2EB\uAE30 \uC804\uC5D0 \uC800\uC7A5\uD558\uC2DC\uACA0\uC2B5\uB2C8\uAE4C?",
    btnSave: "\uC800\uC7A5",
    btnDontSave: "\uC800\uC7A5 \uC548 \uD568",
    btnCancel: "\uCDE8\uC18C"
  },
  fr: {
    dlgSaveTitle: "Enregistrer le document Markdown",
    filterMarkdown: "Documents Markdown",
    dlgPickImage: "Choisir une image",
    filterImages: "Images",
    untitledFile: "Sans titre",
    closeUnsavedMsg: "Ce document contient des modifications non enregistr\xE9es.",
    closeUnsavedDetail: "Voulez-vous les enregistrer avant de fermer ?",
    btnSave: "Enregistrer",
    btnDontSave: "Ne pas enregistrer",
    btnCancel: "Annuler"
  },
  de: {
    dlgSaveTitle: "Markdown-Dokument speichern",
    filterMarkdown: "Markdown-Dokumente",
    dlgPickImage: "Bild ausw\xE4hlen",
    filterImages: "Bilder",
    untitledFile: "Unbenannt",
    closeUnsavedMsg: "Dieses Dokument enth\xE4lt ungespeicherte \xC4nderungen.",
    closeUnsavedDetail: "Vor dem Schlie\xDFen speichern?",
    btnSave: "Speichern",
    btnDontSave: "Nicht speichern",
    btnCancel: "Abbrechen"
  },
  es: {
    dlgSaveTitle: "Guardar documento Markdown",
    filterMarkdown: "Documentos Markdown",
    dlgPickImage: "Elegir imagen",
    filterImages: "Im\xE1genes",
    untitledFile: "Sin t\xEDtulo",
    closeUnsavedMsg: "Este documento tiene cambios sin guardar.",
    closeUnsavedDetail: "\xBFQuieres guardarlos antes de cerrar?",
    btnSave: "Guardar",
    btnDontSave: "No guardar",
    btnCancel: "Cancelar"
  },
  th: {
    dlgSaveTitle: "\u0E1A\u0E31\u0E19\u0E17\u0E36\u0E01\u0E40\u0E2D\u0E01\u0E2A\u0E32\u0E23 Markdown",
    filterMarkdown: "\u0E40\u0E2D\u0E01\u0E2A\u0E32\u0E23 Markdown",
    dlgPickImage: "\u0E40\u0E25\u0E37\u0E2D\u0E01\u0E23\u0E39\u0E1B\u0E20\u0E32\u0E1E",
    filterImages: "\u0E23\u0E39\u0E1B\u0E20\u0E32\u0E1E",
    untitledFile: "\u0E44\u0E21\u0E48\u0E21\u0E35\u0E0A\u0E37\u0E48\u0E2D",
    closeUnsavedMsg: "\u0E40\u0E2D\u0E01\u0E2A\u0E32\u0E23\u0E19\u0E35\u0E49\u0E21\u0E35\u0E01\u0E32\u0E23\u0E40\u0E1B\u0E25\u0E35\u0E48\u0E22\u0E19\u0E41\u0E1B\u0E25\u0E07\u0E17\u0E35\u0E48\u0E22\u0E31\u0E07\u0E44\u0E21\u0E48\u0E44\u0E14\u0E49\u0E1A\u0E31\u0E19\u0E17\u0E36\u0E01",
    closeUnsavedDetail: "\u0E15\u0E49\u0E2D\u0E07\u0E01\u0E32\u0E23\u0E1A\u0E31\u0E19\u0E17\u0E36\u0E01\u0E01\u0E48\u0E2D\u0E19\u0E1B\u0E34\u0E14\u0E2B\u0E23\u0E37\u0E2D\u0E44\u0E21\u0E48?",
    btnSave: "\u0E1A\u0E31\u0E19\u0E17\u0E36\u0E01",
    btnDontSave: "\u0E44\u0E21\u0E48\u0E1A\u0E31\u0E19\u0E17\u0E36\u0E01",
    btnCancel: "\u0E22\u0E01\u0E40\u0E25\u0E34\u0E01"
  },
  id: {
    dlgSaveTitle: "Simpan dokumen Markdown",
    filterMarkdown: "Dokumen Markdown",
    dlgPickImage: "Pilih gambar",
    filterImages: "Gambar",
    untitledFile: "Tanpa judul",
    closeUnsavedMsg: "Dokumen ini memiliki perubahan yang belum disimpan.",
    closeUnsavedDetail: "Simpan sebelum menutup?",
    btnSave: "Simpan",
    btnDontSave: "Jangan Simpan",
    btnCancel: "Batal"
  },
  ru: {
    dlgSaveTitle: "\u0421\u043E\u0445\u0440\u0430\u043D\u0438\u0442\u044C \u0434\u043E\u043A\u0443\u043C\u0435\u043D\u0442 Markdown",
    filterMarkdown: "\u0414\u043E\u043A\u0443\u043C\u0435\u043D\u0442\u044B Markdown",
    dlgPickImage: "\u0412\u044B\u0431\u0435\u0440\u0438\u0442\u0435 \u0438\u0437\u043E\u0431\u0440\u0430\u0436\u0435\u043D\u0438\u0435",
    filterImages: "\u0418\u0437\u043E\u0431\u0440\u0430\u0436\u0435\u043D\u0438\u044F",
    untitledFile: "\u0411\u0435\u0437 \u043D\u0430\u0437\u0432\u0430\u043D\u0438\u044F",
    closeUnsavedMsg: "\u0412 \u044D\u0442\u043E\u043C \u0434\u043E\u043A\u0443\u043C\u0435\u043D\u0442\u0435 \u0435\u0441\u0442\u044C \u043D\u0435\u0441\u043E\u0445\u0440\u0430\u043D\u0451\u043D\u043D\u044B\u0435 \u0438\u0437\u043C\u0435\u043D\u0435\u043D\u0438\u044F.",
    closeUnsavedDetail: "\u0421\u043E\u0445\u0440\u0430\u043D\u0438\u0442\u044C \u0438\u0445 \u043F\u0435\u0440\u0435\u0434 \u0437\u0430\u043A\u0440\u044B\u0442\u0438\u0435\u043C?",
    btnSave: "\u0421\u043E\u0445\u0440\u0430\u043D\u0438\u0442\u044C",
    btnDontSave: "\u041D\u0435 \u0441\u043E\u0445\u0440\u0430\u043D\u044F\u0442\u044C",
    btnCancel: "\u041E\u0442\u043C\u0435\u043D\u0430"
  },
  ar: {
    dlgSaveTitle: "\u062D\u0641\u0638 \u0645\u0633\u062A\u0646\u062F Markdown",
    filterMarkdown: "\u0645\u0633\u062A\u0646\u062F\u0627\u062A Markdown",
    dlgPickImage: "\u0627\u062E\u062A\u0631 \u0635\u0648\u0631\u0629",
    filterImages: "\u0635\u0648\u0631",
    untitledFile: "\u0628\u062F\u0648\u0646 \u0639\u0646\u0648\u0627\u0646",
    closeUnsavedMsg: "\u064A\u062D\u062A\u0648\u064A \u0647\u0630\u0627 \u0627\u0644\u0645\u0633\u062A\u0646\u062F \u0639\u0644\u0649 \u062A\u063A\u064A\u064A\u0631\u0627\u062A \u063A\u064A\u0631 \u0645\u062D\u0641\u0648\u0638\u0629.",
    closeUnsavedDetail: "\u0647\u0644 \u062A\u0631\u064A\u062F \u062D\u0641\u0638\u0647\u0627 \u0642\u0628\u0644 \u0627\u0644\u0625\u063A\u0644\u0627\u0642\u061F",
    btnSave: "\u062D\u0641\u0638",
    btnDontSave: "\u0639\u062F\u0645 \u0627\u0644\u062D\u0641\u0638",
    btnCancel: "\u0625\u0644\u063A\u0627\u0621"
  },
  pt: {
    dlgSaveTitle: "Salvar documento Markdown",
    filterMarkdown: "Documentos Markdown",
    dlgPickImage: "Escolher imagem",
    filterImages: "Imagens",
    untitledFile: "Sem t\xEDtulo",
    closeUnsavedMsg: "Este documento tem altera\xE7\xF5es n\xE3o salvas.",
    closeUnsavedDetail: "Deseja salv\xE1-las antes de fechar?",
    btnSave: "Salvar",
    btnDontSave: "N\xE3o Salvar",
    btnCancel: "Cancelar"
  },
  it: {
    dlgSaveTitle: "Salva documento Markdown",
    filterMarkdown: "Documenti Markdown",
    dlgPickImage: "Scegli immagine",
    filterImages: "Immagini",
    untitledFile: "Senza titolo",
    closeUnsavedMsg: "Questo documento contiene modifiche non salvate.",
    closeUnsavedDetail: "Vuoi salvarle prima di chiudere?",
    btnSave: "Salva",
    btnDontSave: "Non salvare",
    btnCancel: "Annulla"
  },
  pl: {
    dlgSaveTitle: "Zapisz dokument Markdown",
    filterMarkdown: "Dokumenty Markdown",
    dlgPickImage: "Wybierz obraz",
    filterImages: "Obrazy",
    untitledFile: "Bez tytu\u0142u",
    closeUnsavedMsg: "Ten dokument ma niezapisane zmiany.",
    closeUnsavedDetail: "Czy zapisa\u0107 je przed zamkni\u0119ciem?",
    btnSave: "Zapisz",
    btnDontSave: "Nie zapisuj",
    btnCancel: "Anuluj"
  },
  cs: {
    dlgSaveTitle: "Ulo\u017Eit dokument Markdown",
    filterMarkdown: "Dokumenty Markdown",
    dlgPickImage: "Vyberte obr\xE1zek",
    filterImages: "Obr\xE1zky",
    untitledFile: "Bez n\xE1zvu",
    closeUnsavedMsg: "Tento dokument m\xE1 neulo\u017Een\xE9 zm\u011Bny.",
    closeUnsavedDetail: "Chcete je p\u0159ed zav\u0159en\xEDm ulo\u017Eit?",
    btnSave: "Ulo\u017Eit",
    btnDontSave: "Neukl\xE1dat",
    btnCancel: "Zru\u0161it"
  },
  nl: {
    dlgSaveTitle: "Markdown-document opslaan",
    filterMarkdown: "Markdown-documenten",
    dlgPickImage: "Kies een afbeelding",
    filterImages: "Afbeeldingen",
    untitledFile: "Naamloos",
    closeUnsavedMsg: "Dit document bevat niet-opgeslagen wijzigingen.",
    closeUnsavedDetail: "Wilt u ze opslaan voordat u sluit?",
    btnSave: "Opslaan",
    btnDontSave: "Niet opslaan",
    btnCancel: "Annuleren"
  },
  ms: {
    dlgSaveTitle: "Simpan dokumen Markdown",
    filterMarkdown: "Dokumen Markdown",
    dlgPickImage: "Pilih imej",
    filterImages: "Imej",
    untitledFile: "Tanpa tajuk",
    closeUnsavedMsg: "Dokumen ini mempunyai perubahan yang belum disimpan.",
    closeUnsavedDetail: "Simpan sebelum menutup?",
    btnSave: "Simpan",
    btnDontSave: "Jangan Simpan",
    btnCancel: "Batal"
  },
  he: {
    dlgSaveTitle: "\u05E9\u05DE\u05D9\u05E8\u05EA \u05DE\u05E1\u05DE\u05DA Markdown",
    filterMarkdown: "\u05DE\u05E1\u05DE\u05DB\u05D9 Markdown",
    dlgPickImage: "\u05D1\u05D7\u05E8\u05D5 \u05EA\u05DE\u05D5\u05E0\u05D4",
    filterImages: "\u05EA\u05DE\u05D5\u05E0\u05D5\u05EA",
    untitledFile: "\u05DC\u05DC\u05D0 \u05E9\u05DD",
    closeUnsavedMsg: "\u05D1\u05DE\u05E1\u05DE\u05DA \u05D4\u05D6\u05D4 \u05D9\u05E9 \u05E9\u05D9\u05E0\u05D5\u05D9\u05D9\u05DD \u05E9\u05DC\u05D0 \u05E0\u05E9\u05DE\u05E8\u05D5.",
    closeUnsavedDetail: "\u05D4\u05D0\u05DD \u05DC\u05E9\u05DE\u05D5\u05E8 \u05D0\u05D5\u05EA\u05DD \u05DC\u05E4\u05E0\u05D9 \u05D4\u05E1\u05D2\u05D9\u05E8\u05D4?",
    btnSave: "\u05E9\u05DE\u05D9\u05E8\u05D4",
    btnDontSave: "\u05D0\u05DC \u05EA\u05E9\u05DE\u05D5\u05E8",
    btnCancel: "\u05D1\u05D9\u05D8\u05D5\u05DC"
  },
  hi: {
    dlgSaveTitle: "Markdown \u0926\u0938\u094D\u0924\u093E\u0935\u0947\u091C\u093C \u0938\u0939\u0947\u091C\u0947\u0902",
    filterMarkdown: "Markdown \u0926\u0938\u094D\u0924\u093E\u0935\u0947\u091C\u093C",
    dlgPickImage: "\u091B\u0935\u093F \u091A\u0941\u0928\u0947\u0902",
    filterImages: "\u091B\u0935\u093F\u092F\u093E\u0901",
    untitledFile: "\u0936\u0940\u0930\u094D\u0937\u0915\u0939\u0940\u0928",
    closeUnsavedMsg: "\u0907\u0938 \u0926\u0938\u094D\u0924\u093E\u0935\u0947\u091C\u093C \u092E\u0947\u0902 \u0938\u0939\u0947\u091C\u0947 \u0928\u0939\u0940\u0902 \u0917\u090F \u092A\u0930\u093F\u0935\u0930\u094D\u0924\u0928 \u0939\u0948\u0902\u0964",
    closeUnsavedDetail: "\u0915\u094D\u092F\u093E \u092C\u0902\u0926 \u0915\u0930\u0928\u0947 \u0938\u0947 \u092A\u0939\u0932\u0947 \u0909\u0928\u094D\u0939\u0947\u0902 \u0938\u0939\u0947\u091C\u0928\u093E \u091A\u093E\u0939\u0924\u0947 \u0939\u0948\u0902?",
    btnSave: "\u0938\u0939\u0947\u091C\u0947\u0902",
    btnDontSave: "\u0928 \u0938\u0939\u0947\u091C\u0947\u0902",
    btnCancel: "\u0930\u0926\u094D\u0926 \u0915\u0930\u0947\u0902"
  },
  "zh-TW": {
    dlgSaveTitle: "\u5132\u5B58 Markdown \u6587\u4EF6",
    filterMarkdown: "Markdown \u6587\u4EF6",
    dlgPickImage: "\u9078\u64C7\u5716\u7247",
    filterImages: "\u5716\u7247",
    untitledFile: "\u672A\u547D\u540D\u6587\u4EF6",
    closeUnsavedMsg: "\u6B64\u6587\u4EF6\u6709\u672A\u5132\u5B58\u7684\u8B8A\u66F4\u3002",
    closeUnsavedDetail: "\u95DC\u9589\u524D\u662F\u5426\u5132\u5B58\uFF1F",
    btnSave: "\u5132\u5B58",
    btnDontSave: "\u4E0D\u5132\u5B58",
    btnCancel: "\u53D6\u6D88"
  }
});
var tm = (key) => tDlg(getUiLang(), key);
var runtime = { preloadPath: "" };
function configureMarkdownRuntime(paths) {
  runtime = paths;
}
function openExportedPdf(path) {
  try {
    if (runtime.openGeneratedPath?.(path)) return;
  } catch (err) {
    console.warn("[markdown] Failed to open exported PDF:", err);
  }
  import_electron2.shell.showItemInFolder(path);
}
var openPathByWc = /* @__PURE__ */ new Map();
var allowedByWc = /* @__PURE__ */ new Map();
var savePathByWc = /* @__PURE__ */ new Map();
var dirtyByWc = /* @__PURE__ */ new Set();
var closeSaveWaiters = /* @__PURE__ */ new Map();
var saveWaiters = /* @__PURE__ */ new Map();
var fileSavedHook = null;
var docxExportedHook = null;
var conversionSessionPromise = null;
function markdownConversionSession() {
  conversionSessionPromise ??= createMarkdownConversionSession(
    (0, import_node_path10.join)(import_electron2.app.getPath("userData"), "markdown-conversions")
  );
  return conversionSessionPromise;
}
function requestMarkdownSave(contents) {
  // Preserve the sender-scoped acknowledgement already owned by an in-flight save.
  if (closeSaveWaiters.has(contents.id)) return Promise.resolve(false);
  if (!dirtyByWc.has(contents.id) || contents.isDestroyed()) return Promise.resolve(true);
  return new Promise((resolve5) => {
    const timer = setTimeout(() => {
      closeSaveWaiters.delete(contents.id);
      resolve5(false);
    }, 12e4);
    closeSaveWaiters.set(contents.id, (ok) => {
      clearTimeout(timer);
      resolve5(ok);
    });
    try {
      contents.send(MARKDOWN_CHANNELS.closeSaveRequest);
    } catch {
      clearTimeout(timer);
      closeSaveWaiters.delete(contents.id);
      resolve5(false);
    }
  });
}
async function requestMarkdownClose(contents, parent) {
  if (!dirtyByWc.has(contents.id) || contents.isDestroyed()) return true;
  const options = {
    type: "warning",
    message: tm("closeUnsavedMsg"),
    detail: tm("closeUnsavedDetail"),
    buttons: [tm("btnSave"), tm("btnDontSave"), tm("btnCancel")],
    defaultId: 0,
    cancelId: 2,
    noLink: true
  };
  const { response } = parent && !parent.isDestroyed() ? await import_electron2.dialog.showMessageBox(parent, options) : await import_electron2.dialog.showMessageBox(options);
  if (response === 2) return false;
  if (response === 1) {
    const documentPath = savePathByWc.get(contents.id);
    if (documentPath) {
      const discarded = await discardPendingOwnedAssets(documentPath);
      if (discarded.errors.length > 0) {
        console.warn("[markdown] pending asset discard incomplete:", discarded.errors);
      }
    }
    return true;
  }
  return requestMarkdownSave(contents);
}
async function discardMarkdownChanges(contents) {
  const documentPath = savePathByWc.get(contents.id);
  if (documentPath) {
    const discarded = await discardPendingOwnedAssets(documentPath);
    if (discarded.errors.length > 0) {
      console.warn("[markdown] pending asset discard incomplete:", discarded.errors);
    }
  }
  dirtyByWc.delete(contents.id);
}
async function writeTextAtomic(path, text) {
  await atomicWriteFile(path, Buffer.from(text, "utf8"));
}
async function resolveSaveTarget(e, mode, suggestedName) {
  const current = savePathByWc.get(e.sender.id);
  if (mode === "save" && current) return current;
  if (mode === "save" && !current && suggestedName) {
    const base = suggestedName.replace(/[/\\:*?"<>|]/g, "_").slice(0, 80).trim();
    if (base) {
      const dir = configuredDefaultSaveDir(import_electron2.app);
      let target = (0, import_node_path10.join)(dir, `${base}.md`);
      for (let n = 1; (0, import_node_fs7.existsSync)(target); n++) target = (0, import_node_path10.join)(dir, `${base}-${n}.md`);
      return target;
    }
  }
  const win = import_electron2.BrowserWindow.fromWebContents(e.sender) ?? import_electron2.BrowserWindow.getFocusedWindow() ?? void 0;
  const defaultPath = current ? (0, import_node_path10.join)((0, import_node_path10.dirname)(current), (0, import_node_path10.basename)(current)) : (0, import_node_path10.join)(configuredDefaultSaveDir(import_electron2.app), `${tm("untitledFile")}.md`);
  const picked = await showSaveDialogWithMemory(import_electron2.dialog, win, {
    title: tm("dlgSaveTitle"),
    defaultPath,
    filters: [{ name: tm("filterMarkdown"), extensions: ["md", "markdown"] }]
  });
  if (picked.canceled || !picked.filePath) return "canceled";
  return picked.filePath;
}
var DISPLAY_IMAGE_EXTS = /* @__PURE__ */ new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".svg",
  ".bmp",
  ".avif"
]);
function registerImageProtocol() {
  import_electron2.session.fromPartition("nami-office-preview").protocol.handle("md-asset", async (request) => {
    let target;
    try {
      target = decodeURIComponent(new URL(request.url).pathname);
    } catch {
      return new Response(null, { status: 400 });
    }
    if (/^\/[a-zA-Z]:\//.test(target)) target = target.slice(1);
    target = (0, import_node_path10.resolve)(target);
    if (!DISPLAY_IMAGE_EXTS.has((0, import_node_path10.extname)(target).toLowerCase()) || !(0, import_node_fs7.existsSync)(target)) {
      return new Response(null, { status: 404 });
    }
    let inDocDir = false;
    for (const doc of /* @__PURE__ */ new Set([...openPathByWc.values(), ...savePathByWc.values()])) {
      const dir = (0, import_node_path10.resolve)((0, import_node_path10.dirname)(doc));
      if (target === dir || !target.startsWith(dir + import_node_path10.sep)) continue;
      if (await resolveSafeRelativeImagePath(doc, (0, import_node_path10.relative)(dir, target))) {
        inDocDir = true;
        break;
      }
    }
    if (!inDocDir) return new Response(null, { status: 403 });
    return import_electron2.net.fetch((0, import_node_url2.pathToFileURL)(target).toString());
  });
}
var ipcRegistered = false;
function registerMarkdownIpc() {
  if (ipcRegistered) return;
  ipcRegistered = true;
  registerImageProtocol();
  import_electron2.ipcMain.handle(MARKDOWN_CHANNELS.consumePending, (e) => openPathByWc.get(e.sender.id) ?? null);
  import_electron2.ipcMain.handle(MARKDOWN_CHANNELS.readFile, async (e, path) => {
    if (typeof path !== "string" || !allowedByWc.get(e.sender.id)?.has(path)) {
      throw new Error("markdown: path not granted to this view");
    }
    return await trackNamiDocumentOperation(e.sender, "parse", () => (0, import_promises5.readFile)(path, "utf8"));
  });
  import_electron2.ipcMain.handle(
    MARKDOWN_CHANNELS.save,
    async (e, request) => {
      const waiter = saveWaiters.get(e.sender.id);
      saveWaiters.delete(e.sender.id);
      const done = (result) => {
        waiter?.(result.ok && !("canceled" in result));
        return result;
      };
      if (typeof request?.text !== "string") {
        return done({ ok: false, error: "markdown: bad save request" });
      }
      if (request.imageSources !== void 0 && (!Array.isArray(request.imageSources) || request.imageSources.some((source) => typeof source !== "string"))) {
        return done({ ok: false, error: "markdown: bad image references" });
      }
      const mode = request.mode === "saveAs" ? "saveAs" : "save";
      const pathAtRequest = savePathByWc.get(e.sender.id);
      const pendingAtRequest = pathAtRequest ? await pendingOwnedAssetsForDocument(pathAtRequest) : [];
      try {
        const suggestedName = typeof request.suggestedName === "string" ? request.suggestedName : void 0;
        const target = await resolveSaveTarget(e, mode, suggestedName);
        if (target === "canceled") return done({ ok: true, canceled: true });
        if (!target) return done({ ok: false, error: "markdown: no save target" });
        const currentPath = pathAtRequest;
        const isNewPath = currentPath !== target;
        const imageSources = [...request.imageSources ?? []];
        const knownImageSources = new Set(imageSources);
        for (const source of extractMarkdownImageSources(request.text)) {
          if (knownImageSources.has(source)) continue;
          knownImageSources.add(source);
          imageSources.push(source);
        }
        const prepared = currentPath && (0, import_node_path10.resolve)((0, import_node_path10.dirname)(currentPath)) !== (0, import_node_path10.resolve)((0, import_node_path10.dirname)(target)) ? await prepareAssetsForSaveAs(currentPath, target, request.text, imageSources) : null;
        const textToWrite = prepared?.text ?? request.text;
        const savedImageSources = prepared?.imageSources ?? imageSources;
        try {
          if (dirtyByWc.has(e.sender.id)) await trackNamiDocumentOperation(e.sender, "save", () => writeTextAtomic(target, textToWrite));
          else await writeTextAtomic(target, textToWrite);
        } catch (error) {
          if (prepared) await rollbackPreparedSaveAsAssets(prepared).catch(() => {
          });
          throw error;
        }
        savePathByWc.set(e.sender.id, target);
        openPathByWc.set(e.sender.id, target);
        const allowed = allowedByWc.get(e.sender.id) ?? /* @__PURE__ */ new Set();
        allowed.add(target);
        allowedByWc.set(e.sender.id, allowed);
        dirtyByWc.delete(e.sender.id);
        const pendingNames = prepared ? prepared.created.map((record) => record.name) : currentPath && (0, import_node_path10.resolve)(currentPath) === (0, import_node_path10.resolve)(target) ? pendingAtRequest : [];
        const reconciled = await reconcileOwnedAssets(target, savedImageSources, { pendingNames });
        if (reconciled.errors.length > 0) {
          console.warn("[markdown] asset reconciliation incomplete:", reconciled.errors);
        }
        if (mode === "saveAs" && currentPath && (0, import_node_path10.resolve)(currentPath) !== (0, import_node_path10.resolve)(target)) {
          const sourceResolved = await resolveSourcePendingAfterSaveAs(
            currentPath,
            pendingAtRequest
          );
          if (sourceResolved.errors.length > 0) {
            console.warn(
              "[markdown] source asset reconciliation incomplete:",
              sourceResolved.errors
            );
          }
        }
        if (isNewPath) fileSavedHook?.(e.sender, target);
        return done({
          ok: true,
          path: target,
          ...prepared?.rewrites.length ? { imageRewrites: prepared.rewrites } : {}
        });
      } catch (err) {
        return done({ ok: false, error: err instanceof Error ? err.message : String(err) });
      }
    }
  );
  import_electron2.ipcMain.handle(MARKDOWN_CHANNELS.pickImage, async (e) => {
    const docPath = savePathByWc.get(e.sender.id);
    if (!docPath) return null;
    const win = import_electron2.BrowserWindow.fromWebContents(e.sender) ?? import_electron2.BrowserWindow.getFocusedWindow() ?? void 0;
    const picked = await showOpenDialogWithMemory(import_electron2.dialog, win, {
      title: tm("dlgPickImage"),
      // only formats readImage/DOCX export can round-trip (docx-engine NewImage mimes)
      filters: [{ name: tm("filterImages"), extensions: ["png", "jpg", "jpeg", "gif"] }],
      properties: ["openFile"]
    });
    const source = picked.filePaths[0];
    if (picked.canceled || !source) return null;
    return copyImageIntoOwnedAssets(docPath, source);
  });
  import_electron2.ipcMain.handle(
    MARKDOWN_CHANNELS.saveImage,
    async (e, data) => {
      const docPath = savePathByWc.get(e.sender.id);
      const ext = String(data?.ext ?? "").toLowerCase();
      if (!docPath || typeof data?.base64 !== "string" || !data.base64) return null;
      if (!["png", "jpg", "jpeg", "gif"].includes(ext)) return null;
      return writeImageIntoOwnedAssets(docPath, `image.${ext}`, Buffer.from(data.base64, "base64"));
    }
  );
  if (PRODUCT_FEATURES.ai) {
    import_electron2.ipcMain.handle(
      MARKDOWN_CHANNELS.aiGenerateImage,
      (_e, op) => generateImageTool((0, import_node_path10.join)(import_electron2.app.getPath("userData"), "ai-settings.json"), {
        prompt: String(op?.prompt ?? ""),
        aspectRatio: op?.aspectRatio ? String(op.aspectRatio) : void 0
      })
    );
  }
  const MIME_BY_EXT3 = {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif"
  };
  import_electron2.ipcMain.handle(
    MARKDOWN_CHANNELS.readImage,
    async (e, src) => {
      const docPath = savePathByWc.get(e.sender.id);
      if (!docPath || typeof src !== "string" || /^[a-z][a-z0-9+.-]*:/i.test(src)) return null;
      const target = await resolveSafeRelativeImagePath(docPath, src);
      if (!target) return null;
      const mime = MIME_BY_EXT3[(0, import_node_path10.extname)(target).toLowerCase()];
      if (!mime || !(0, import_node_fs7.existsSync)(target)) return null;
      try {
        return { base64: (await (0, import_promises5.readFile)(target)).toString("base64"), mime };
      } catch {
        return null;
      }
    }
  );
  import_electron2.ipcMain.handle(
    MARKDOWN_CHANNELS.exportDocx,
    async (e, request) => {
      if (typeof request?.base64 !== "string" || !request.base64) {
        return { ok: false, error: "markdown: bad export request" };
      }
      const safeName = String(request.suggestedName || tm("untitledFile")).replace(/[/\\:*?"<>|]/g, "_").slice(0, 80).trim() || tm("untitledFile");
      try {
        const bytes = Buffer.from(request.base64, "base64");
        if (request.mode === "openInDocs") {
          const target = await writeMarkdownConversion(
            await markdownConversionSession(),
            safeName,
            bytes
          );
          docxExportedHook?.(target);
          return { ok: true, path: target };
        }
        const win = import_electron2.BrowserWindow.fromWebContents(e.sender) ?? import_electron2.BrowserWindow.getFocusedWindow() ?? void 0;
        const picked = await showSaveDialogWithMemory(
          import_electron2.dialog,
          win,
          {
            defaultPath: `${safeName}.docx`,
            filters: [{ name: "Word", extensions: ["docx"] }]
          },
          configuredDefaultSaveDir(import_electron2.app)
        );
        if (picked.canceled || !picked.filePath) return { ok: true, canceled: true };
        await (0, import_promises5.writeFile)(picked.filePath, bytes);
        return { ok: true, path: picked.filePath };
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
      }
    }
  );
  import_electron2.ipcMain.handle(
    MARKDOWN_CHANNELS.exportPdf,
    async (e, request) => {
      if (typeof request?.html !== "string" || !request.html) {
        return { ok: false, error: "markdown: bad export request" };
      }
      const safeName = String(request.suggestedName || tm("untitledFile")).replace(/[/\\:*?"<>|]/g, "_").slice(0, 80).trim() || tm("untitledFile");
      const win = import_electron2.BrowserWindow.fromWebContents(e.sender) ?? import_electron2.BrowserWindow.getFocusedWindow() ?? void 0;
      const picked = await showSaveDialogWithMemory(
        import_electron2.dialog,
        win,
        {
          defaultPath: `${safeName}.pdf`,
          filters: [{ name: "PDF", extensions: ["pdf"] }]
        },
        configuredDefaultSaveDir(import_electron2.app)
      );
      if (picked.canceled || !picked.filePath) return { ok: true, canceled: true };
      const workDir = await (0, import_promises5.mkdtemp)((0, import_node_path10.join)((0, import_node_os4.tmpdir)(), "genoffice-md-pdf-"));
      const printWin = new import_electron2.BrowserWindow({
        show: false,
        webPreferences: { sandbox: true, javascript: false }
      });
      try {
        const htmlPath = (0, import_node_path10.join)(workDir, "print.html");
        await (0, import_promises5.writeFile)(htmlPath, request.html, "utf8");
        await printWin.loadFile(htmlPath);
        const pdf = await printWin.webContents.printToPDF({
          pageSize: "A4",
          printBackground: true,
          margins: { top: 0.6, bottom: 0.6, left: 0.6, right: 0.6 }
        });
        await (0, import_promises5.writeFile)(picked.filePath, pdf);
        openExportedPdf(picked.filePath);
        return { ok: true, path: picked.filePath };
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
      } finally {
        printWin.destroy();
        await (0, import_promises5.rm)(workDir, { recursive: true, force: true });
      }
    }
  );
  import_electron2.ipcMain.on(MARKDOWN_CHANNELS.dirtyChanged, (e, dirty) => {
    if (dirty === true) { dirtyByWc.add(e.sender.id); beginNamiDocumentOperation(e.sender, "edit"); }
    else dirtyByWc.delete(e.sender.id);
  });
  import_electron2.ipcMain.on(MARKDOWN_CHANNELS.closeSaveResult, (e, ok) => {
    const waiter = closeSaveWaiters.get(e.sender.id);
    closeSaveWaiters.delete(e.sender.id);
    waiter?.(ok === true);
  });
  import_electron2.ipcMain.on(MARKDOWN_CHANNELS.saveRequestAck, (e, ok) => {
    const waiter = saveWaiters.get(e.sender.id);
    saveWaiters.delete(e.sender.id);
    waiter?.(ok === true);
  });
  import_electron2.ipcMain.removeHandler(MARKDOWN_CHANNELS.getLanguage);
  import_electron2.ipcMain.handle(MARKDOWN_CHANNELS.getLanguage, () => getUiLang());
}
function grantAndTrack(wc, openPath) {
  const wcId = wc.id;
  if (openPath && (0, import_node_fs7.existsSync)(openPath)) {
    openPathByWc.set(wcId, openPath);
    savePathByWc.set(wcId, openPath);
    allowedByWc.set(wcId, /* @__PURE__ */ new Set([openPath]));
  }
  wc.setWindowOpenHandler(({ url }) => {
    const target = safeExternalUrl(url, { allowedProtocols: ["http:", "https:", "mailto:"] });
    if (target) void import_electron2.shell.openExternal(target);
    return { action: "deny" };
  });
  wc.once("destroyed", () => {
    openPathByWc.delete(wcId);
    allowedByWc.delete(wcId);
    savePathByWc.delete(wcId);
    dirtyByWc.delete(wcId);
    closeSaveWaiters.get(wcId)?.(false);
    closeSaveWaiters.delete(wcId);
    saveWaiters.get(wcId)?.(false);
    saveWaiters.delete(wcId);
  });
}
function createMarkdownView(openPath, options = {}) {
  registerMarkdownIpc();
  const view = new import_electron2.WebContentsView({
    webPreferences: {
      preload: runtime.preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      partition: "nami-office-preview"
    }
  });
  grantAndTrack(view.webContents, openPath);
  const mode = options.mode ?? "tab";
  if (runtime.rendererUrl) {
    const url = new URL(runtime.rendererUrl);
    url.searchParams.set("mode", mode);
    void view.webContents.loadURL(url.toString());
  } else if (runtime.rendererFile) void view.webContents.loadFile(runtime.rendererFile, { query: { mode } });
  return view;
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  configureMarkdownRuntime,
  createMarkdownView,
  discardMarkdownChanges,
  requestMarkdownClose,
  requestMarkdownSave
});

// Document workspace telemetry: only the owning host can supply a completion callback.
function beginNamiDocumentOperation(contents, type) {
  const operation = { type };
  try { contents?.emit?.("nami-document-operation", operation); } catch {}
  return operation.finish || (() => {});
}
async function trackNamiDocumentOperation(contents, type, work) {
  const finish = beginNamiDocumentOperation(contents, type);
  try { const result = await work(); finish("success"); return result; }
  catch (error) { finish("fail", error?.code || error?.name); throw error; }
}
