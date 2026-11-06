"use strict";
const electron = require("electron");
const IS_NAMI_OFFICE_PREVIEW = new URLSearchParams(window.location.search).has("mode");
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
const MARKDOWN_CHANNELS = {
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
const AI_CHANNELS = {
  getSettings: "ai:get-settings",
  gskStatus: "ai:gsk-status",
  stream: "ai:stream",
  streamChunk: "ai:stream-chunk",
  streamCancel: "ai:stream-cancel",
  webSearch: "ai:web-search",
  imageSearch: "ai:image-search",
  fetchImage: "ai:fetch-image"
};
const api = {
  consumePending: () => electron.ipcRenderer.invoke(MARKDOWN_CHANNELS.consumePending),
  readFile: (path) => electron.ipcRenderer.invoke(MARKDOWN_CHANNELS.readFile, path),
  save: (request) => electron.ipcRenderer.invoke(MARKDOWN_CHANNELS.save, request),
  setDirty: (dirty) => electron.ipcRenderer.send(MARKDOWN_CHANNELS.dirtyChanged, dirty),
  onSaveRequest: (handler) => {
    const listener = (_e, mode) => handler(mode);
    electron.ipcRenderer.on(MARKDOWN_CHANNELS.saveRequest, listener);
    return () => electron.ipcRenderer.removeListener(MARKDOWN_CHANNELS.saveRequest, listener);
  },
  onCloseSaveRequest: (handler) => {
    const listener = () => handler();
    electron.ipcRenderer.on(MARKDOWN_CHANNELS.closeSaveRequest, listener);
    return () => electron.ipcRenderer.removeListener(MARKDOWN_CHANNELS.closeSaveRequest, listener);
  },
  sendCloseSaveResult: (ok) => electron.ipcRenderer.send(MARKDOWN_CHANNELS.closeSaveResult, ok),
  sendSaveRequestAck: (ok) => electron.ipcRenderer.send(MARKDOWN_CHANNELS.saveRequestAck, ok),
  onFileRenamed: (handler) => {
    const listener = (_e, newPath) => handler(newPath);
    electron.ipcRenderer.on(MARKDOWN_CHANNELS.fileRenamed, listener);
    return () => electron.ipcRenderer.removeListener(MARKDOWN_CHANNELS.fileRenamed, listener);
  },
  pickImage: () => electron.ipcRenderer.invoke(MARKDOWN_CHANNELS.pickImage),
  saveImage: (data) => electron.ipcRenderer.invoke(MARKDOWN_CHANNELS.saveImage, data),
  readImage: (src) => electron.ipcRenderer.invoke(MARKDOWN_CHANNELS.readImage, src),
  onExportRequest: (handler) => {
    const listener = (_e, format) => handler(format);
    electron.ipcRenderer.on(MARKDOWN_CHANNELS.exportRequest, listener);
    return () => electron.ipcRenderer.removeListener(MARKDOWN_CHANNELS.exportRequest, listener);
  },
  onPrintRequest: (handler) => {
    const listener = () => handler();
    electron.ipcRenderer.on(MARKDOWN_CHANNELS.printRequest, listener);
    return () => electron.ipcRenderer.removeListener(MARKDOWN_CHANNELS.printRequest, listener);
  },
  exportDocx: (request) => electron.ipcRenderer.invoke(MARKDOWN_CHANNELS.exportDocx, request),
  exportPdf: (request) => electron.ipcRenderer.invoke(MARKDOWN_CHANNELS.exportPdf, request),
  getLanguage: () => electron.ipcRenderer.invoke(MARKDOWN_CHANNELS.getLanguage),
  onLanguageChanged: (handler) => {
    const listener = (_e, lang) => handler(lang);
    electron.ipcRenderer.on(MARKDOWN_CHANNELS.languageChanged, listener);
    return () => electron.ipcRenderer.removeListener(MARKDOWN_CHANNELS.languageChanged, listener);
  },
  getTheme: () => electron.ipcRenderer.invoke(MARKDOWN_CHANNELS.getTheme),
  onThemeChanged: (handler) => {
    const listener = (_e, theme) => handler(theme);
    electron.ipcRenderer.on(MARKDOWN_CHANNELS.themeChanged, listener);
    return () => electron.ipcRenderer.removeListener(MARKDOWN_CHANNELS.themeChanged, listener);
  },
  getAutoSaveDefault: () => electron.ipcRenderer.invoke(MARKDOWN_CHANNELS.getAutoSaveDefault),
  onAutoSaveDefaultChanged: (handler) => {
    const listener = (_e, value) => handler(value);
    electron.ipcRenderer.on(MARKDOWN_CHANNELS.autoSaveDefaultChanged, listener);
    return () => electron.ipcRenderer.removeListener(MARKDOWN_CHANNELS.autoSaveDefaultChanged, listener);
  },
  getAiPanelPrefs: () => electron.ipcRenderer.invoke(MARKDOWN_CHANNELS.getAiPanelPrefs),
  onAiPanelPrefsChanged: (handler) => {
    const listener = (_event, prefs) => handler(prefs);
    electron.ipcRenderer.on(MARKDOWN_CHANNELS.aiPanelPrefsChanged, listener);
    return () => electron.ipcRenderer.removeListener(MARKDOWN_CHANNELS.aiPanelPrefsChanged, listener);
  },
  onChromePressed: (handler) => {
    const listener = () => handler();
    electron.ipcRenderer.on("app:chrome-pressed", listener);
    return () => electron.ipcRenderer.removeListener("app:chrome-pressed", listener);
  },
  getAiSettings: () => electron.ipcRenderer.invoke(AI_CHANNELS.getSettings),
  aiGskStatus: () => electron.ipcRenderer.invoke(AI_CHANNELS.gskStatus),
  aiStream: (request) => electron.ipcRenderer.invoke(AI_CHANNELS.stream, request),
  aiStreamCancel: (requestId) => electron.ipcRenderer.invoke(AI_CHANNELS.streamCancel, requestId),
  onAiStream: (handler) => {
    const listener = (_e, chunk) => handler(chunk);
    electron.ipcRenderer.on(AI_CHANNELS.streamChunk, listener);
    return () => electron.ipcRenderer.removeListener(AI_CHANNELS.streamChunk, listener);
  },
  webSearch: (query, maxResults) => electron.ipcRenderer.invoke(AI_CHANNELS.webSearch, query, maxResults),
  imageSearch: (query, maxResults) => electron.ipcRenderer.invoke(AI_CHANNELS.imageSearch, query, maxResults),
  fetchImage: (url) => electron.ipcRenderer.invoke(AI_CHANNELS.fetchImage, url),
  aiGenerateImage: (op) => electron.ipcRenderer.invoke(MARKDOWN_CHANNELS.aiGenerateImage, op)
};
const projectApi = {
  resolveChat: (args) => electron.ipcRenderer.invoke("project:resolveChat", args),
  appendChat: (args) => electron.ipcRenderer.invoke("project:appendChat", args),
  loadChat: (args) => electron.ipcRenderer.invoke("project:loadChat", args),
  rebindChat: (args) => electron.ipcRenderer.invoke("project:rebindChat", args)
};
electron.contextBridge.exposeInMainWorld("markdownApi", api);
if (!IS_NAMI_OFFICE_PREVIEW) electron.contextBridge.exposeInMainWorld("projectApi", projectApi);
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
