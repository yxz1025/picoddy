"use strict";
const electron = require("electron");
const IS_NAMI_OFFICE_PREVIEW = new URLSearchParams(window.location.search).get("mode") === "preview";
const blockedPreviewCall = () => Promise.reject(new Error("Unavailable in read-only preview."));
const DROP_OPEN_CHANNEL = "app:open-dropped-files";
const OPENABLE_DOC_RE = /\.(docx|xlsx|xlsm|xls|csv|pptx|pdf|md|markdown|html|htm)$/i;
const KNOWN_UNSUPPORTED_DOC_RE = /\.(doc|rtf|odt|ppt|pps|odp|ods|xlsb|pages|key|numbers)$/i;
const MAX_DROPPED_FILES = 20;
function tryResolvePath(file, getPathForFile) {
  try {
    return getPathForFile(file).trim();
  } catch {
    return "";
  }
}
function droppableFilePaths(ev, getPathForFile) {
  const transfer = ev.dataTransfer;
  if (!transfer || !transfer.types.includes("Files")) return null;
  const paths = [];
  for (const file of Array.from(transfer.files)) {
    const path = tryResolvePath(file, getPathForFile);
    if (path) paths.push(path);
  }
  return paths;
}
const INSTALLED = /* @__PURE__ */ Symbol.for("genoffice.drop-open-installed");
function installDropOpenBridge() {
  const holder = globalThis;
  if (typeof window === "undefined" || holder[INSTALLED]) return;
  holder[INSTALLED] = true;
  window.addEventListener("dragover", (ev) => {
    if (ev.defaultPrevented) return;
    if (!ev.dataTransfer?.types.includes("Files")) return;
    ev.preventDefault();
  });
  window.addEventListener("drop", (ev) => {
    if (ev.defaultPrevented) return;
    const paths = droppableFilePaths(ev, (file) => electron.webUtils.getPathForFile(file));
    if (!paths) return;
    const payload = paths.filter((p) => OPENABLE_DOC_RE.test(p) || KNOWN_UNSUPPORTED_DOC_RE.test(p));
    ev.preventDefault();
    if (payload.length === 0) return;
    electron.ipcRenderer.send(DROP_OPEN_CHANNEL, payload.slice(0, MAX_DROPPED_FILES));
  });
}
const api = {
  reportDocumentOperation: (operation) => electron.ipcRenderer.send("nami:document-operation", operation),
  getLanguage: () => electron.ipcRenderer.invoke("app:get-language"),
  onLanguageChanged: (handler) => {
    const listener = (_event, lang) => handler(lang);
    electron.ipcRenderer.on("app:language-changed", listener);
    return () => electron.ipcRenderer.removeListener("app:language-changed", listener);
  },
  getTheme: () => electron.ipcRenderer.invoke("app:get-theme"),
  onThemeChanged: (handler) => {
    const listener = (_event, theme) => handler(theme);
    electron.ipcRenderer.on("app:theme-changed", listener);
    return () => electron.ipcRenderer.removeListener("app:theme-changed", listener);
  },
  getAutoSaveDefault: () => electron.ipcRenderer.invoke("app:get-auto-save-default"),
  onAutoSaveDefaultChanged: (handler) => {
    const listener = (_event, value) => handler(value);
    electron.ipcRenderer.on("app:auto-save-default-changed", listener);
    return () => electron.ipcRenderer.removeListener("app:auto-save-default-changed", listener);
  },
  getAiPanelPrefs: () => electron.ipcRenderer.invoke("app:get-ai-panel-prefs"),
  onAiPanelPrefsChanged: (handler) => {
    const listener = (_event, prefs) => handler(prefs);
    electron.ipcRenderer.on("app:ai-panel-prefs-changed", listener);
    return () => electron.ipcRenderer.removeListener("app:ai-panel-prefs-changed", listener);
  },
  onChromePressed: (handler) => {
    const listener = () => handler();
    electron.ipcRenderer.on("app:chrome-pressed", listener);
    return () => electron.ipcRenderer.removeListener("app:chrome-pressed", listener);
  },
  openDocx: () => electron.ipcRenderer.invoke("docs:open"),
  openDocxPath: (path) => electron.ipcRenderer.invoke("docs:open-path", path),
  openDocxDecrypt: (path, password) => electron.ipcRenderer.invoke("docs:open-decrypt", path, password),
  setDocPassword: (filePath, password) => electron.ipcRenderer.invoke("docs:set-password", filePath, password),
  docPasswordIntentRevision: async () => {
    const revision = await electron.ipcRenderer.invoke("docs:password-intent-revision");
    return typeof revision === "number" && Number.isSafeInteger(revision) && revision >= 0 ? revision : 0;
  },
  discardDocPasswordIntents: (throughRevision) => electron.ipcRenderer.invoke("docs:discard-password-intents", throughRevision),
  consumePendingOpenDocx: () => electron.ipcRenderer.invoke("docs:consume-pending-open"),
  consumeNewBlankDoc: () => electron.ipcRenderer.invoke("docs:consume-new-blank"),
  consumeAiDocContent: () => electron.ipcRenderer.invoke("docs:consume-ai-doc-content"),
  createDocument: (request) => electron.ipcRenderer.invoke("docs:create-document", request),
  onOpenDocx: (handler) => {
    const listener = (_event, result) => handler(result);
    electron.ipcRenderer.on("docs:opened", listener);
    return () => electron.ipcRenderer.removeListener("docs:opened", listener);
  },
  onRenamedDocx: (handler) => {
    const listener = (_event, paths) => handler(paths);
    electron.ipcRenderer.on("docs:renamed", listener);
    return () => electron.ipcRenderer.removeListener("docs:renamed", listener);
  },
  saveDocx: (path, data, auto, changed) => electron.ipcRenderer.invoke("docs:save", path, data, auto === true, changed === true),
  writeRecoveryCopy: (path, data) => electron.ipcRenderer.invoke("docs:write-recovery", path, data),
  onTeardown: (handler) => {
    const listener = () => handler();
    electron.ipcRenderer.on("docs:teardown", listener);
    return () => electron.ipcRenderer.removeListener("docs:teardown", listener);
  },
  respellKick: () => electron.ipcRenderer.invoke("docs:respell-kick"),
  saveDocxAs: (defaultName, data, sourcePath, changed) => electron.ipcRenderer.invoke("docs:save-as", defaultName, data, sourcePath ?? null, changed === true),
  saveDocxNew: (defaultName, data) => electron.ipcRenderer.invoke("docs:save-new", defaultName, data),
  getRecentFiles: () => electron.ipcRenderer.invoke("docs:recent"),
  pickImage: () => electron.ipcRenderer.invoke("docs:pick-image"),
  fontMetrics: (family) => electron.ipcRenderer.invoke("docs:font-metrics", family),
  print: (scale) => electron.ipcRenderer.invoke("docs:print", scale),
  exportPdf: (defaultName, pageWidthTwips, pageHeightTwips, outPath, scale) => electron.ipcRenderer.invoke(
    "docs:export-pdf",
    defaultName,
    pageWidthTwips,
    pageHeightTwips,
    outPath,
    scale
  ),
  exportHtml: (defaultName, html, outPath) => electron.ipcRenderer.invoke("docs:export-html", defaultName, html, outPath),
  printPdfBuffer: (pageWidthTwips, pageHeightTwips, scale) => electron.ipcRenderer.invoke("docs:print-pdf-buffer", pageWidthTwips, pageHeightTwips, scale),
  saveMergedPdf: (defaultName, base64Parts, outPath) => electron.ipcRenderer.invoke("docs:save-merged-pdf", defaultName, base64Parts, outPath),
  getAiSettings: () => electron.ipcRenderer.invoke("ai:get-settings"),
  setAiSettings: (settings) => electron.ipcRenderer.invoke("ai:set-settings", settings),
  aiChat: (request) => electron.ipcRenderer.invoke("ai:chat", request),
  aiStream: (request) => electron.ipcRenderer.invoke("ai:stream", request),
  aiStreamCancel: (requestId) => electron.ipcRenderer.invoke("ai:stream-cancel", requestId),
  aiGskStatus: (withEmail) => electron.ipcRenderer.invoke("ai:gsk-status", withEmail),
  aiGskLogin: () => electron.ipcRenderer.invoke("ai:gsk-login"),
  webSearch: (query, maxResults) => electron.ipcRenderer.invoke("ai:web-search", query, maxResults),
  imageSearch: (query, maxResults) => electron.ipcRenderer.invoke("ai:image-search", query, maxResults),
  fetchImage: (url) => electron.ipcRenderer.invoke("ai:fetch-image", url),
  aiGenerateImage: (op) => electron.ipcRenderer.invoke("docs:ai-generate-image", op),
  pickAttachments: () => electron.ipcRenderer.invoke("files:pick"),
  addAttachmentPaths: (paths) => electron.ipcRenderer.invoke("files:add", paths),
  addPastedImage: (data, ext) => electron.ipcRenderer.invoke("files:add-pasted-image", data, ext),
  copyImageToClipboard: (dataUrl, metaJson) => electron.ipcRenderer.invoke("docs:copy-image-to-clipboard", dataUrl, metaJson),
  readAttachment: (path, offset, maxChars) => electron.ipcRenderer.invoke("files:read", path, offset, maxChars),
  readAttachmentImage: (path) => electron.ipcRenderer.invoke("files:read-image", path),
  getPathForFile: (file) => electron.webUtils.getPathForFile(file),
  openNewTab: (openPath) => electron.ipcRenderer.invoke("win:new", openPath ?? null),
  listDocsTabs: () => electron.ipcRenderer.invoke("win:list"),
  focusDocsTab: (id) => electron.ipcRenderer.invoke("win:focus", id),
  onAiStream: (handler) => {
    const listener = (_event, chunk) => handler(chunk);
    electron.ipcRenderer.on("ai:stream-chunk", listener);
    return () => electron.ipcRenderer.removeListener("ai:stream-chunk", listener);
  },
  onMenuCommand: (handler) => {
    const listener = (_event, command, payload) => handler(command, payload);
    electron.ipcRenderer.on("menu:command", listener);
    return () => electron.ipcRenderer.removeListener("menu:command", listener);
  },
  onCloseCheck: (handler) => {
    const listener = () => handler();
    electron.ipcRenderer.on("docs:close-check", listener);
    return () => electron.ipcRenderer.removeListener("docs:close-check", listener);
  },
  reportViewMenuState: (state) => electron.ipcRenderer.send("docs:view-menu-state", {
    aiSidebar: state?.aiSidebar === true,
    darkCanvas: state?.darkCanvas === true
  }),
  reportCloseCheck: (state) => electron.ipcRenderer.send("docs:close-check-result", {
    dirty: state?.dirty === true,
    autoSave: state?.autoSave === true,
    filePath: typeof state?.filePath === "string" ? state.filePath : null
  }),
  onCloseSaveRequest: (handler) => {
    const listener = () => handler();
    electron.ipcRenderer.on("docs:close-save-request", listener);
    return () => electron.ipcRenderer.removeListener("docs:close-save-request", listener);
  },
  reportCloseSaveResult: (ok) => electron.ipcRenderer.send("docs:close-save-result", ok === true)
};
const projectApi = {
  resolveChat: (args) => electron.ipcRenderer.invoke("project:resolveChat", args),
  appendChat: (args) => electron.ipcRenderer.invoke("project:appendChat", args),
  loadChat: (args) => electron.ipcRenderer.invoke("project:loadChat", args),
  rebindChat: (args) => electron.ipcRenderer.invoke("project:rebindChat", args),
  // P1 extensions
  listProjects: () => electron.ipcRenderer.invoke("project:list"),
  createProject: (args) => electron.ipcRenderer.invoke("project:create", args),
  renameProject: (args) => electron.ipcRenderer.invoke("project:rename", args),
  deleteProject: (args) => electron.ipcRenderer.invoke("project:delete", args),
  moveFile: (args) => electron.ipcRenderer.invoke("project:moveFile", args),
  getTimeline: (args) => electron.ipcRenderer.invoke("project:timeline", args)
};
if (IS_NAMI_OFFICE_PREVIEW) {
  for (const name of [
    "openDocx", "openDocxPath", "openDocxDecrypt", "setDocPassword",
    "createDocument", "saveDocx", "writeRecoveryCopy", "respellKick",
    "saveDocxAs", "saveDocxNew", "getRecentFiles", "pickImage", "print",
    "exportPdf", "exportHtml", "printPdfBuffer", "saveMergedPdf",
    "getAiSettings", "setAiSettings", "aiChat", "aiStream", "aiStreamCancel",
    "aiGskStatus", "aiGskLogin", "webSearch", "imageSearch", "fetchImage",
    "aiGenerateImage", "pickAttachments", "addAttachmentPaths", "addPastedImage",
    "copyImageToClipboard", "readAttachment", "readAttachmentImage",
    "openNewTab", "listDocsTabs", "focusDocsTab"
  ]) api[name] = blockedPreviewCall;
  api.getPathForFile = () => "";
}
electron.contextBridge.exposeInMainWorld("desktop", api);
electron.contextBridge.exposeInMainWorld("projectApi", projectApi);
if (!IS_NAMI_OFFICE_PREVIEW) installDropOpenBridge();

// [NAMI] Selection UI bridge. It exposes no file path or write operation.
const namiSelectionElectron = require('electron');
namiSelectionElectron.contextBridge.exposeInMainWorld('namiOfficeSelection', Object.freeze({
  submit: input => namiSelectionElectron.ipcRenderer.invoke('nami-office-selection:submit', input),
  cancel: requestId => namiSelectionElectron.ipcRenderer.invoke('nami-office-selection:cancel', requestId),
  onState: callback => {
    const listener = (_event, state) => callback(state);
    namiSelectionElectron.ipcRenderer.on('nami-office-selection:state', listener);
    return () => namiSelectionElectron.ipcRenderer.removeListener('nami-office-selection:state', listener);
  },
}));
