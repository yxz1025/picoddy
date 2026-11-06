const { contextBridge, ipcRenderer, webUtils } = require("electron");


contextBridge.exposeInMainWorld("electronAPI", {
  platform: process.platform,
  updates: {
    getState: () => ipcRenderer.invoke("update.getState"),
    check: () => ipcRenderer.invoke("update.check"),
    download: (releaseId) => ipcRenderer.invoke("update.download", { releaseId }),
    cancelDownload: (operationId) => ipcRenderer.invoke("update.cancelDownload", { operationId }),
    install: (releaseId, mode) => ipcRenderer.invoke("update.install", { releaseId, mode }),
    defer: (releaseId) => ipcRenderer.invoke("update.defer", { releaseId }),
    openReleaseNotes: (releaseId) => ipcRenderer.invoke("update.openReleaseNotes", { releaseId }),
    openLogs: () => ipcRenderer.invoke("update.openLogs"),
    health: () => ipcRenderer.invoke("update.health"),
    restoreBackup: () => ipcRenderer.invoke("update.restoreBackup"),
    retryBoot: () => ipcRenderer.invoke("update.retryBoot"),
    onState: (callback) => {
      const handler = (_event, snapshot) => callback(snapshot);
      ipcRenderer.on("update.state", handler);
      return () => ipcRenderer.removeListener("update.state", handler);
    },
  },
  send: (event) => ipcRenderer.send("client-event", event),
  invoke: (event) => ipcRenderer.invoke("client-invoke", event),
  call: (name, ...args) => ipcRenderer.invoke(name, ...args),
  preview: {
    get: (params) => ipcRenderer.invoke('tapd.previewGet', params),
    action: (params) => ipcRenderer.invoke('tapd.previewAction', params),
  },
  testingExecution: {
    get: (params) => ipcRenderer.invoke('tapd.testingExecutionGet', params),
    update: (params) => ipcRenderer.invoke('tapd.testingExecutionSave', params),
  },
  testingDelivery: {
    get: (params) => ipcRenderer.invoke('tapd.testingGet', params),
    submit: (params) => ipcRenderer.invoke('tapd.testingSubmit', params),
  },
  on: (callback) => {
    const handler = (_event, data) => callback(data);
    ipcRenderer.on("server-event", handler);
    return () => ipcRenderer.removeListener("server-event", handler);
  },
  openFile: (filePath) => ipcRenderer.invoke("fs.openPath", filePath).then(
    (result) => result?.ok ? "" : (result?.error || "无法打开路径"),
    (error) => error instanceof Error ? error.message : String(error),
  ),
  showItemInFolder: (filePath) => ipcRenderer.invoke("fs.showItemInFolder", filePath),
  openPath: (filePath) => ipcRenderer.invoke("fs.openPath", filePath),
  readFile: (filePath) => ipcRenderer.invoke("fs.readFile", filePath),
  listDirectory: (dirPath) => ipcRenderer.invoke("fs.listDirectory", dirPath),
  windowMenu: {
    popup: (menuId, x, y) =>
      ipcRenderer.invoke("window.menu.popup", { menuId, x, y }),
  },
  windowTitlebar: {
    setTheme: (theme) => ipcRenderer.invoke("window.titlebar.setTheme", theme),
  },
  browser: {
    toggle: () => ipcRenderer.invoke("browser.toggle"),
    show: () => ipcRenderer.invoke("browser.show"),
    hide: () => ipcRenderer.invoke("browser.hide"),
    navigate: (url) => ipcRenderer.invoke("browser.navigate", url),
    getStatus: () => ipcRenderer.invoke("browser.getStatus"),
    goBack: () => ipcRenderer.invoke("browser.goBack"),
    goForward: () => ipcRenderer.invoke("browser.goForward"),
    reload: () => ipcRenderer.invoke("browser.reload"),
    stop: () => ipcRenderer.invoke("browser.stop"),
    setBounds: (x,y,w,h) => ipcRenderer.invoke("browser.setBounds", x, y, w, h),
    setTheme: (t,b) => ipcRenderer.invoke("browser.setTheme", t, b),
    enterFullscreen: () => ipcRenderer.invoke("browser.enterFullscreen"),
    exitFullscreen: () => ipcRenderer.invoke("browser.exitFullscreen"),
    onStateChanged: (cb) => {
      const h = (_e, s) => cb(s);
      ipcRenderer.on("browser.state-changed", h);
      return () => ipcRenderer.removeListener("browser.state-changed", h);
    },
  },
  config: {
    get: () => ipcRenderer.invoke("config.get"),
    save: (d) => ipcRenderer.invoke("config.save", d),
    openaiSubscriptionStatus: () => ipcRenderer.invoke("config.openaiSubscriptionStatus"),
    openaiSubscription: (d) => ipcRenderer.invoke("config.openaiSubscription", d),
    getApiKeys: () => ipcRenderer.invoke("config.getApiKeys"),
    saveApiKey: (d) => ipcRenderer.invoke("config.saveApiKey", d),
    deleteApiKey: (d) => ipcRenderer.invoke("config.deleteApiKey", d),
  },
  memory: {
    list: () => ipcRenderer.invoke("memory.list"),
    create: (d) => ipcRenderer.invoke("memory.create", d),
    delete: (d) => ipcRenderer.invoke("memory.delete", d),
  },
  skills: {
    list: () => ipcRenderer.invoke("skills.list"),
    create: (d) => ipcRenderer.invoke("skills.create", d),
    update: (d) => ipcRenderer.invoke("skills.update", d),
    delete: (d) => ipcRenderer.invoke("skills.delete", d),
  },
  clawhub: {
    list: (d) => ipcRenderer.invoke("clawhub.list", d),
    install: (d) => ipcRenderer.invoke("clawhub.install", d),
  },
  skillhub: {
    ensureAuth: () => ipcRenderer.invoke("skillhub.ensureAuth"),
    authConfig: () => ipcRenderer.invoke("skillhub.authConfig"),
    saveAuthConfig: (d) => ipcRenderer.invoke("skillhub.saveAuthConfig", d),
    namespaces: () => ipcRenderer.invoke("skillhub.namespaces"),
    list: () => ipcRenderer.invoke("skillhub.list"),
    experts: () => ipcRenderer.invoke("skillhub.experts"),
    expertDetail: (d) => ipcRenderer.invoke("skillhub.expertDetail", d),
    install: (d) => ipcRenderer.invoke("skillhub.install", d),
    expertInstall: (d) => ipcRenderer.invoke("skillhub.expertInstall", d),
  },
  plugins: {
    list: () => ipcRenderer.invoke("plugins.list"),
    catalog: () => ipcRenderer.invoke("plugins.catalog"),
    search: (d) => ipcRenderer.invoke("plugins.search", d),
    install: (d) => ipcRenderer.invoke("plugins.install", d),
    uninstall: (d) => ipcRenderer.invoke("plugins.uninstall", d),
  },
  automation: {
    list: () => ipcRenderer.invoke("automation.list"),
    create: (d) => ipcRenderer.invoke("automation.create", d),
    update: (d) => ipcRenderer.invoke("automation.update", d),
    delete: (d) => ipcRenderer.invoke("automation.delete", d),
    run: (d) => ipcRenderer.invoke("automation.run", d),
    runs: (d) => ipcRenderer.invoke("automation.runs", d),
  },
  usage: { get: () => ipcRenderer.invoke("usage.get") },
  artifacts: { list: () => ipcRenderer.invoke("artifacts.list") },
  projects: { list: () => ipcRenderer.invoke("projects.list") },
  attachments: {
    upload: async (file) => {
      const path = webUtils.getPathForFile(file);
      if (path) {
        return ipcRenderer.invoke("attachments.upload", {
          path,
          mimeType: file.type || "application/octet-stream",
        });
      }
      const bytes = await file.arrayBuffer();
      return ipcRenderer.invoke("attachments.upload", {
        name: file.name,
        mimeType: file.type || "application/octet-stream",
        bytes,
      });
    },
    delete: (d) => ipcRenderer.invoke("attachments.delete", d),
  },
  workspace: {
    list: () => ipcRenderer.invoke("workspace.list"),
    create: (d) => ipcRenderer.invoke("workspace.create", d),
    update: (d) => ipcRenderer.invoke("workspace.update", d),
    delete: (d) => ipcRenderer.invoke("workspace.delete", d),
  },
  expert: {
    list: () => ipcRenderer.invoke("expert.list"),
    listInstalled: () => ipcRenderer.invoke("expert.listInstalled"),
    get: (d) => ipcRenderer.invoke("expert.get", d),
    assign: (d) => ipcRenderer.invoke("expert.assign", d),
    clear: (d) => ipcRenderer.invoke("expert.clear", d),
  },
  mcp: {
    addFigma: (d) => ipcRenderer.invoke("mcp.addFigma", d),
    oauthStatus: (d) => ipcRenderer.invoke("mcp.oauthStatus", d),
    oauth: (d) => ipcRenderer.invoke("mcp.oauth", d),
    npmStatus: (d) => ipcRenderer.invoke("mcp.npmStatus", d),
    npmInstall: (d) => ipcRenderer.invoke("mcp.npmInstall", d),
    npmConfigure: (d) => ipcRenderer.invoke("mcp.npmConfigure", d),
    list: () => ipcRenderer.invoke("mcp.list"),
    connect: (d) => ipcRenderer.invoke("mcp.connect", d),
    save: (d) => ipcRenderer.invoke("mcp.save", d),
  },
  ollama: { models: () => ipcRenderer.invoke("ollama.models") },
  audit: { list: () => ipcRenderer.invoke("audit.list") },
  onNotification: (ch, cb) => { ipcRenderer.on(ch, (_e, ...a) => cb(...a)); },
  pickDirectory: () => ipcRenderer.invoke("dialog.pickDir"),
});
