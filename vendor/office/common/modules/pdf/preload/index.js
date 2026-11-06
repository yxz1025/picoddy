"use strict";
const electron = require("electron");
const PDF_CHANNELS = {
  consumePending: "pdf:consume-pending",
  setSidebarVisible: "pdf:set-sidebar-visible",
  sidebarVisibilityChanged: "pdf:sidebar-visibility-changed",
  readFile: "pdf:read-file",
  save: "pdf:save",
  autoRename: "pdf:auto-rename",
  isUntitled: "pdf:is-untitled",
  validateTextEdits: "pdf:validate-text-edits",
  listEditFonts: "pdf:list-edit-fonts",
  canDrawText: "pdf:can-draw-text",
  listPageImages: "pdf:list-page-images",
  listStaticFormFills: "pdf:list-static-form-fills",
  pageImagePng: "pdf:page-image-png",
  pagePreviewPng: "pdf:page-preview-png",
  extractPages: "pdf:extract-pages",
  insertPdf: "pdf:insert-pdf",
  insertBlankPage: "pdf:insert-blank-page",
  splitPdf: "pdf:split-pdf",
  mergePdf: "pdf:merge-pdf",
  mergePages: "pdf:merge-pages",
  replacePages: "pdf:replace-pages",
  setPageSize: "pdf:set-page-size",
  splitPages: "pdf:split-pages",
  cropPages: "pdf:crop-pages",
  exportImages: "pdf:export-images",
  listSignatures: "pdf:list-signatures",
  addSignature: "pdf:add-signature",
  removeSignature: "pdf:remove-signature",
  getUsername: "pdf:get-username",
  dirtyChanged: "pdf:dirty-changed",
  closeSaveRequest: "pdf:close-save-request",
  closeSaveResult: "pdf:close-save-result",
  saveAsRequest: "pdf:save-as-request",
  saveAsResult: "pdf:save-as-result",
  saveAsFlow: "pdf:save-as-flow",
  printRequest: "pdf:print-request",
  getLanguage: "app:get-language",
  languageChanged: "app:language-changed",
  getTheme: "app:get-theme",
  themeChanged: "app:theme-changed",
  getAiPanelPrefs: "app:get-ai-panel-prefs",
  aiPanelPrefsChanged: "app:ai-panel-prefs-changed"
};
const AI_CHANNELS = {
  streamChunk: "ai:stream-chunk"
};
const api = {
  reportDocumentOperation: (operation) => electron.ipcRenderer.send("nami:document-operation", operation),
  supportsOfflineOcr: false,
  setSidebarVisible: (visible) => electron.ipcRenderer.invoke(PDF_CHANNELS.setSidebarVisible, visible),
  onSidebarVisibilityChanged: (handler) => {
    const listener = (_e, visible) => {
      if (typeof visible === "boolean") handler(visible);
    };
    electron.ipcRenderer.on(PDF_CHANNELS.sidebarVisibilityChanged, listener);
    return () => electron.ipcRenderer.removeListener(PDF_CHANNELS.sidebarVisibilityChanged, listener);
  },
  consumePending: () => electron.ipcRenderer.invoke(PDF_CHANNELS.consumePending),
  readFile: (path) => electron.ipcRenderer.invoke(PDF_CHANNELS.readFile, path),
  save: (request) => electron.ipcRenderer.invoke(PDF_CHANNELS.save, request),
  autoRename: (path, baseName) => electron.ipcRenderer.invoke(PDF_CHANNELS.autoRename, path, baseName),
  isUntitled: (path) => electron.ipcRenderer.invoke(PDF_CHANNELS.isUntitled, path),
  validateTextEdits: (request) => electron.ipcRenderer.invoke(PDF_CHANNELS.validateTextEdits, request),
  listEditFonts: () => electron.ipcRenderer.invoke(PDF_CHANNELS.listEditFonts),
  canDrawText: (text, font, bold, italic) => electron.ipcRenderer.invoke(PDF_CHANNELS.canDrawText, text, font, bold, italic),
  listPageImages: (path) => electron.ipcRenderer.invoke(PDF_CHANNELS.listPageImages, path),
  listStaticFormFills: (path) => electron.ipcRenderer.invoke(PDF_CHANNELS.listStaticFormFills, path),
  ocrPage: (png) => Promise.reject(new Error("Unavailable in local PDF editor")),
  pageImagePng: (request) => electron.ipcRenderer.invoke(PDF_CHANNELS.pageImagePng, request),
  pagePreviewPng: (request) => electron.ipcRenderer.invoke(PDF_CHANNELS.pagePreviewPng, request),
  extractPages: (request) => electron.ipcRenderer.invoke(PDF_CHANNELS.extractPages, request),
  insertPdf: (request) => electron.ipcRenderer.invoke(PDF_CHANNELS.insertPdf, request),
  insertBlankPage: (request) => electron.ipcRenderer.invoke(PDF_CHANNELS.insertBlankPage, request),
  splitPdf: (request) => electron.ipcRenderer.invoke(PDF_CHANNELS.splitPdf, request),
  mergePdf: (request) => electron.ipcRenderer.invoke(PDF_CHANNELS.mergePdf, request),
  mergePages: (request) => electron.ipcRenderer.invoke(PDF_CHANNELS.mergePages, request),
  replacePages: (request) => electron.ipcRenderer.invoke(PDF_CHANNELS.replacePages, request),
  setPageSize: (request) => electron.ipcRenderer.invoke(PDF_CHANNELS.setPageSize, request),
  splitPages: (request) => electron.ipcRenderer.invoke(PDF_CHANNELS.splitPages, request),
  cropPages: (request) => electron.ipcRenderer.invoke(PDF_CHANNELS.cropPages, request),
  exportImages: (request) => electron.ipcRenderer.invoke(PDF_CHANNELS.exportImages, request),
  convertOffice: (format) => Promise.reject(new Error("Unavailable in local PDF editor")),
  createDocument: (request) => Promise.reject(new Error("Unavailable in local PDF editor")),
  imageSearch: (query, maxResults) => Promise.reject(new Error("AI unavailable in local PDF editor")),
  fetchImage: (url) => Promise.reject(new Error("AI unavailable in local PDF editor")),
  generateImage: (op) => Promise.reject(new Error("Unavailable in local PDF editor")),
  listSavedSignatures: () => electron.ipcRenderer.invoke(PDF_CHANNELS.listSignatures),
  addSavedSignature: (data) => electron.ipcRenderer.invoke(PDF_CHANNELS.addSignature, data),
  removeSavedSignature: (id) => electron.ipcRenderer.invoke(PDF_CHANNELS.removeSignature, id),
  getUsername: () => electron.ipcRenderer.invoke(PDF_CHANNELS.getUsername),
  setDirty: (dirty) => electron.ipcRenderer.send(PDF_CHANNELS.dirtyChanged, dirty),
  onCloseSaveRequest: (handler) => {
    const listener = () => handler();
    electron.ipcRenderer.on(PDF_CHANNELS.closeSaveRequest, listener);
    return () => electron.ipcRenderer.removeListener(PDF_CHANNELS.closeSaveRequest, listener);
  },
  sendCloseSaveResult: (ok) => electron.ipcRenderer.send(PDF_CHANNELS.closeSaveResult, ok),
  onSaveAsRequest: (handler) => {
    const listener = (_e, targetPath) => handler(targetPath);
    electron.ipcRenderer.on(PDF_CHANNELS.saveAsRequest, listener);
    return () => electron.ipcRenderer.removeListener(PDF_CHANNELS.saveAsRequest, listener);
  },
  sendSaveAsResult: (ok) => electron.ipcRenderer.send(PDF_CHANNELS.saveAsResult, ok),
  onSaveAsFlow: (handler) => {
    const listener = (_e, inFlight) => handler(inFlight);
    electron.ipcRenderer.on(PDF_CHANNELS.saveAsFlow, listener);
    return () => electron.ipcRenderer.removeListener(PDF_CHANNELS.saveAsFlow, listener);
  },
  onPrintRequest: (handler) => {
    const listener = () => handler();
    electron.ipcRenderer.on(PDF_CHANNELS.printRequest, listener);
    return () => electron.ipcRenderer.removeListener(PDF_CHANNELS.printRequest, listener);
  },
  getLanguage: () => electron.ipcRenderer.invoke(PDF_CHANNELS.getLanguage),
  onLanguageChanged: (handler) => {
    const listener = (_e, lang) => handler(lang);
    electron.ipcRenderer.on(PDF_CHANNELS.languageChanged, listener);
    return () => electron.ipcRenderer.removeListener(PDF_CHANNELS.languageChanged, listener);
  },
  getTheme: () => electron.ipcRenderer.invoke(PDF_CHANNELS.getTheme),
  onThemeChanged: (handler) => {
    const listener = (_e, theme) => handler(theme);
    electron.ipcRenderer.on(PDF_CHANNELS.themeChanged, listener);
    return () => electron.ipcRenderer.removeListener(PDF_CHANNELS.themeChanged, listener);
  },
  getAiPanelPrefs: () => electron.ipcRenderer.invoke(PDF_CHANNELS.getAiPanelPrefs),
  onAiPanelPrefsChanged: (handler) => {
    const listener = (_event, prefs) => handler(prefs);
    electron.ipcRenderer.on(PDF_CHANNELS.aiPanelPrefsChanged, listener);
    return () => electron.ipcRenderer.removeListener(PDF_CHANNELS.aiPanelPrefsChanged, listener);
  },
  onChromePressed: (handler) => {
    const listener = () => handler();
    electron.ipcRenderer.on("app:chrome-pressed", listener);
    return () => electron.ipcRenderer.removeListener("app:chrome-pressed", listener);
  },
  getAiSettings: () => Promise.reject(new Error("AI unavailable in local PDF editor")),
  gskStatus: () => Promise.reject(new Error("AI unavailable in local PDF editor")),
  aiStream: (request) => Promise.reject(new Error("AI unavailable in local PDF editor")),
  aiStreamCancel: (requestId) => Promise.reject(new Error("AI unavailable in local PDF editor")),
  onAiStream: (handler) => {
    const listener = (_e, chunk) => handler(chunk);
    electron.ipcRenderer.on(AI_CHANNELS.streamChunk, listener);
    return () => electron.ipcRenderer.removeListener(AI_CHANNELS.streamChunk, listener);
  }
};
const readOnly = process.argv.includes("--nami-pdf-mode=preview");
if (readOnly) {
  const blocked = () => Promise.reject(new Error("Read-only PDF preview"));
  for (const key of [
    "save",
    "autoRename",
    "extractPages",
    "insertPdf",
    "insertBlankPage",
    "splitPdf",
    "mergePdf",
    "mergePages",
    "replacePages",
    "setPageSize",
    "splitPages",
    "cropPages",
    "exportImages",
    "addSavedSignature",
    "removeSavedSignature"
  ]) {
    api[key] = blocked;
  }
  api.setDirty = () => {
  };
}
electron.contextBridge.exposeInMainWorld("pdfApi", api);

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
