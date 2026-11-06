import type { AiPanelPrefs } from '@genoffice/ui'
import { contextBridge, ipcRenderer } from 'electron'
import type { Lang } from '@genoffice/i18n'
import type { AiStreamChunk } from '@genoffice/ai-provider'
import { AI_CHANNELS, PDF_CHANNELS } from '../shared/ipc'
import type { PdfApi, UiTheme } from '../shared/ipc'

const api: PdfApi = {
  supportsOfflineOcr: false,
  setSidebarVisible: (visible) => ipcRenderer.invoke(PDF_CHANNELS.setSidebarVisible, visible),
  onSidebarVisibilityChanged: (handler) => {
    const listener = (_e: Electron.IpcRendererEvent, visible: unknown) => {
      if (typeof visible === 'boolean') handler(visible)
    }
    ipcRenderer.on(PDF_CHANNELS.sidebarVisibilityChanged, listener)
    return () => ipcRenderer.removeListener(PDF_CHANNELS.sidebarVisibilityChanged, listener)
  },
  consumePending: () => ipcRenderer.invoke(PDF_CHANNELS.consumePending),
  readFile: (path) => ipcRenderer.invoke(PDF_CHANNELS.readFile, path),
  save: (request) => ipcRenderer.invoke(PDF_CHANNELS.save, request),
  autoRename: (path, baseName) => ipcRenderer.invoke(PDF_CHANNELS.autoRename, path, baseName),
  isUntitled: (path) => ipcRenderer.invoke(PDF_CHANNELS.isUntitled, path),
  validateTextEdits: (request) => ipcRenderer.invoke(PDF_CHANNELS.validateTextEdits, request),
  listEditFonts: () => ipcRenderer.invoke(PDF_CHANNELS.listEditFonts),
  canDrawText: (text, font, bold, italic) =>
    ipcRenderer.invoke(PDF_CHANNELS.canDrawText, text, font, bold, italic),
  listPageImages: (path) => ipcRenderer.invoke(PDF_CHANNELS.listPageImages, path),
  listStaticFormFills: (path) => ipcRenderer.invoke(PDF_CHANNELS.listStaticFormFills, path),
  ocrPage: (png) => Promise.reject(new Error('Unavailable in local PDF editor')),
  pageImagePng: (request) => ipcRenderer.invoke(PDF_CHANNELS.pageImagePng, request),
  pagePreviewPng: (request) => ipcRenderer.invoke(PDF_CHANNELS.pagePreviewPng, request),
  extractPages: (request) => ipcRenderer.invoke(PDF_CHANNELS.extractPages, request),
  insertPdf: (request) => ipcRenderer.invoke(PDF_CHANNELS.insertPdf, request),
  insertBlankPage: (request) => ipcRenderer.invoke(PDF_CHANNELS.insertBlankPage, request),
  splitPdf: (request) => ipcRenderer.invoke(PDF_CHANNELS.splitPdf, request),
  mergePdf: (request) => ipcRenderer.invoke(PDF_CHANNELS.mergePdf, request),
  mergePages: (request) => ipcRenderer.invoke(PDF_CHANNELS.mergePages, request),
  replacePages: (request) => ipcRenderer.invoke(PDF_CHANNELS.replacePages, request),
  setPageSize: (request) => ipcRenderer.invoke(PDF_CHANNELS.setPageSize, request),
  splitPages: (request) => ipcRenderer.invoke(PDF_CHANNELS.splitPages, request),
  cropPages: (request) => ipcRenderer.invoke(PDF_CHANNELS.cropPages, request),
  exportImages: (request) => ipcRenderer.invoke(PDF_CHANNELS.exportImages, request),
  convertOffice: (format) => Promise.reject(new Error('Unavailable in local PDF editor')),
  createDocument: (request) => Promise.reject(new Error('Unavailable in local PDF editor')),
  imageSearch: (query, maxResults) =>
    Promise.reject(new Error('AI unavailable in local PDF editor')),
  fetchImage: (url) => Promise.reject(new Error('AI unavailable in local PDF editor')),
  generateImage: (op) => Promise.reject(new Error('Unavailable in local PDF editor')),
  listSavedSignatures: () => ipcRenderer.invoke(PDF_CHANNELS.listSignatures),
  addSavedSignature: (data) => ipcRenderer.invoke(PDF_CHANNELS.addSignature, data),
  removeSavedSignature: (id) => ipcRenderer.invoke(PDF_CHANNELS.removeSignature, id),
  getUsername: () => ipcRenderer.invoke(PDF_CHANNELS.getUsername),
  setDirty: (dirty) => ipcRenderer.send(PDF_CHANNELS.dirtyChanged, dirty),
  onCloseSaveRequest: (handler) => {
    const listener = () => handler()
    ipcRenderer.on(PDF_CHANNELS.closeSaveRequest, listener)
    return () => ipcRenderer.removeListener(PDF_CHANNELS.closeSaveRequest, listener)
  },
  sendCloseSaveResult: (ok) => ipcRenderer.send(PDF_CHANNELS.closeSaveResult, ok),
  onSaveAsRequest: (handler) => {
    const listener = (_e: Electron.IpcRendererEvent, targetPath: string) => handler(targetPath)
    ipcRenderer.on(PDF_CHANNELS.saveAsRequest, listener)
    return () => ipcRenderer.removeListener(PDF_CHANNELS.saveAsRequest, listener)
  },
  sendSaveAsResult: (ok) => ipcRenderer.send(PDF_CHANNELS.saveAsResult, ok),
  onSaveAsFlow: (handler) => {
    const listener = (_e: Electron.IpcRendererEvent, inFlight: boolean) => handler(inFlight)
    ipcRenderer.on(PDF_CHANNELS.saveAsFlow, listener)
    return () => ipcRenderer.removeListener(PDF_CHANNELS.saveAsFlow, listener)
  },
  onPrintRequest: (handler) => {
    const listener = () => handler()
    ipcRenderer.on(PDF_CHANNELS.printRequest, listener)
    return () => ipcRenderer.removeListener(PDF_CHANNELS.printRequest, listener)
  },
  getLanguage: () => ipcRenderer.invoke(PDF_CHANNELS.getLanguage),
  onLanguageChanged: (handler) => {
    const listener = (_e: Electron.IpcRendererEvent, lang: Lang) => handler(lang)
    ipcRenderer.on(PDF_CHANNELS.languageChanged, listener)
    return () => ipcRenderer.removeListener(PDF_CHANNELS.languageChanged, listener)
  },
  getTheme: () => ipcRenderer.invoke(PDF_CHANNELS.getTheme),
  onThemeChanged: (handler) => {
    const listener = (_e: Electron.IpcRendererEvent, theme: UiTheme) => handler(theme)
    ipcRenderer.on(PDF_CHANNELS.themeChanged, listener)
    return () => ipcRenderer.removeListener(PDF_CHANNELS.themeChanged, listener)
  },
  getAiPanelPrefs: () => ipcRenderer.invoke(PDF_CHANNELS.getAiPanelPrefs),
  onAiPanelPrefsChanged: (handler) => {
    const listener = (_event: Electron.IpcRendererEvent, prefs: AiPanelPrefs) => handler(prefs)
    ipcRenderer.on(PDF_CHANNELS.aiPanelPrefsChanged, listener)
    return () => ipcRenderer.removeListener(PDF_CHANNELS.aiPanelPrefsChanged, listener)
  },
  onChromePressed: (handler) => {
    const listener = () => handler()
    ipcRenderer.on('app:chrome-pressed', listener)
    return () => ipcRenderer.removeListener('app:chrome-pressed', listener)
  },
  getAiSettings: () => Promise.reject(new Error('AI unavailable in local PDF editor')),
  gskStatus: () => Promise.reject(new Error('AI unavailable in local PDF editor')),
  aiStream: (request) => Promise.reject(new Error('AI unavailable in local PDF editor')),
  aiStreamCancel: (requestId) => Promise.reject(new Error('AI unavailable in local PDF editor')),
  onAiStream: (handler) => {
    const listener = (_e: Electron.IpcRendererEvent, chunk: AiStreamChunk) => handler(chunk)
    ipcRenderer.on(AI_CHANNELS.streamChunk, listener)
    return () => ipcRenderer.removeListener(AI_CHANNELS.streamChunk, listener)
  },
}


const readOnly = process.argv.includes('--nami-pdf-mode=preview')
if (readOnly) {
  const blocked = () => Promise.reject(new Error('Read-only PDF preview'))
  for (const key of ['save', 'autoRename', 'extractPages', 'insertPdf', 'insertBlankPage',
    'splitPdf', 'mergePdf', 'mergePages', 'replacePages', 'setPageSize', 'splitPages',
    'cropPages', 'exportImages', 'addSavedSignature', 'removeSavedSignature'] as const) {
    (api as unknown as Record<string, unknown>)[key] = blocked
  }
  api.setDirty = () => {}
}
contextBridge.exposeInMainWorld('pdfApi', api)

// [NAMI] Selection UI bridge. It exposes no file path or write operation.
contextBridge.exposeInMainWorld('namiOfficeSelection', Object.freeze({
  submit: (input: unknown) => ipcRenderer.invoke('nami-office-selection:submit', input),
  cancel: (requestId: string) => ipcRenderer.invoke('nami-office-selection:cancel', requestId),
  onState: (callback: (state: unknown) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, state: unknown) => callback(state);
    ipcRenderer.on('nami-office-selection:state', listener);
    return () => ipcRenderer.removeListener('nami-office-selection:state', listener);
  },
}));
