/**
 * Electron 主进程入口（ESM）。参考 agent-1.0.24。
 *
 * 职责：窗口管理、Express 静态文件服务、IPC handler 注册。
 * 业务逻辑通过 src/electron/ipc-handlers.ts 集中管理。
 */

const {
  accessSync,
  appendFileSync,
  constants: fsConstants,
  lstatSync,
  mkdirSync,
  realpathSync,
} =
  await import("node:fs");
const {
  basename,
  dirname: pathDirname,
  isAbsolute: pathIsAbsolute,
  join: pathJoin,
  relative: pathRelative,
  resolve: pathResolve,
  sep: pathSep,
} =
  await import("node:path");
const { fileURLToPath } = await import("node:url");

const APP_ROOT = fileURLToPath(new URL(".", import.meta.url));

const MAIN_LOG_PATH = process.platform === "win32"
  ? pathJoin(process.env.LOCALAPPDATA ?? ".", "PiCoddy", "logs", "main.log")
  : pathJoin(process.env.HOME ?? ".", ".picoddy", "logs", "main.log");
const CRASH_LOG_PATH = process.platform === "win32"
  ? pathJoin(process.env.LOCALAPPDATA ?? ".", "PiCoddy", "logs", "crash.log")
  : pathJoin(process.env.HOME ?? ".", ".picoddy", "logs", "crash.log");
const OPERATIONS_LOG_PATH = process.platform === "win32"
  ? pathJoin(process.env.LOCALAPPDATA ?? ".", "PiCoddy", "logs", "operations.jsonl")
  : pathJoin(process.env.HOME ?? ".", ".picoddy", "logs", "operations.jsonl");

function serializeError(error) {
  if (error instanceof Error) {
    return `${error.name}: ${error.message}${error.stack ? `\n${error.stack}` : ""}`;
  }
  return String(error);
}

function redactMainLog(value) {
  return String(value)
    .replace(/\bBearer\s+[^\s,;]+/giu, "Bearer [REDACTED]")
    .replace(/\bsk-[A-Za-z0-9_-]+/gu, "[REDACTED]")
    .replace(/((?:api[-_]?key|token|password|secret|authorization|cookie)\s*[=:]\s*)[^\s,;]+/giu, "$1[REDACTED]");
}

// 崩溃日志需要能帮助定位文件解析阶段，但不能泄露附件路径或内容。
function redactCrashLog(value) {
  return redactMainLog(value)
    .replace(/[A-Za-z]:\\[^\r\n]+/gu, "[PATH]")
    .replace(/\/(?:[^\s\r\n/]+\/){2,}[^\s\r\n]*/gu, "[PATH]");
}

function writeCrashLog(phase, detail) {
  try {
    mkdirSync(pathDirname(CRASH_LOG_PATH), { recursive: true });
    const serialized = detail === undefined ? undefined : serializeError(detail);
    const memory = process.memoryUsage();
    appendFileSync(
      CRASH_LOG_PATH,
      `${JSON.stringify({
        timestamp: new Date().toISOString(),
        phase,
        pid: process.pid,
        platform: process.platform,
        arch: process.arch,
        memory: {
          rssBytes: memory.rss,
          heapUsedBytes: memory.heapUsed,
          heapTotalBytes: memory.heapTotal,
          externalBytes: memory.external,
        },
        ...(serialized ? { detail: redactCrashLog(serialized) } : {}),
      })}\n`,
      "utf8",
    );
  } catch {
    // 在进程不稳定时，日志失败不能影响既有退出路径。
  }
}

function randomOperationId() {
  return `${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function writeEarlyOperationEvent(operation, phase, detail) {
  try {
    mkdirSync(pathDirname(OPERATIONS_LOG_PATH), { recursive: true });
    const event = {
      timestamp: new Date().toISOString(),
      phase,
      operation,
      operationId: randomOperationId(),
      pid: process.pid,
      platform: process.platform,
      arch: process.arch,
      ...(detail === undefined
        ? {}
        : phase === "error" || phase === "crash"
        ? { error: redactMainLog(detail) }
        : { metadata: { detail: redactMainLog(detail) } }),
    };
    appendFileSync(OPERATIONS_LOG_PATH, `${JSON.stringify(event)}\n`, "utf8");
  } catch {
    // Logging must never become a second startup failure.
  }
}

function writeMainLog(phase, error) {
  const detail = error === undefined ? undefined : serializeError(error);
  try {
    mkdirSync(pathDirname(MAIN_LOG_PATH), { recursive: true });
    appendFileSync(
      MAIN_LOG_PATH,
      `[${new Date().toISOString()}] ${phase}${detail ? `\n${redactMainLog(detail)}` : ""}\n`,
      "utf8",
    );
  } catch {
    // Logging must never become a second startup failure.
  }

  const failure = phase.includes("failed") || phase.includes("failure") ||
    phase.includes("exception") || phase.includes("rejection") || phase.includes("gone");
  writeEarlyOperationEvent(
    phase === "main-process-start" ? "main.process" : phase,
    failure ? "error" : "event",
    detail,
  );
}

writeMainLog(
  "main-process-start",
  `platform=${process.platform} arch=${process.arch} nodeEnv=${process.env.NODE_ENV ?? "unset"}`,
);

process.on("uncaughtException", (error) => {
  writeCrashLog("uncaught-exception", error);
  writeMainLog("uncaught-exception", error);
  console.error("[startup] uncaught exception", error);
  process.exit(1);
});

process.on("unhandledRejection", (error) => {
  writeCrashLog("unhandled-rejection", error);
  writeMainLog("unhandled-rejection", error);
  console.error("[startup] unhandled rejection", error);
  process.exit(1);
});

process.on("exit", (code) => {
  if (code !== 0) writeCrashLog("process-exit", `exitCode=${code}`);
});

function isInsidePath(root, target) {
  const childPath = pathRelative(root, target);
  return childPath !== "" && childPath !== ".." &&
    !childPath.startsWith(`..${pathSep}`) && !pathIsAbsolute(childPath);
}

function configurePackagedEsbuild() {
  if (basename(pathResolve(APP_ROOT)) !== "app.asar") return;

  const supportedArchitectures = new Set(process.platform === "win32" ? ["ia32", "x64", "arm64"] : ["arm64", "x64"]);
  const supportedPlatforms = new Set(["darwin", "linux", "win32"]);
  if (!supportedPlatforms.has(process.platform) || !supportedArchitectures.has(process.arch)) {
    throw new Error(
      `packaged esbuild does not support ${process.platform}/${process.arch}`,
    );
  }

  const packageName = `${process.platform}-${process.arch}`;
  const binaryParts = process.platform === "win32"
    ? ["node_modules", "@esbuild", packageName, "esbuild.exe"]
    : ["node_modules", "@esbuild", packageName, "bin", "esbuild"];
  const unpackedRoot = pathResolve(process.resourcesPath, "app.asar.unpacked");
  const binaryPath = pathResolve(unpackedRoot, ...binaryParts);
  if (!isInsidePath(unpackedRoot, binaryPath)) {
    throw new Error(`packaged esbuild path escapes app.asar.unpacked: ${binaryPath}`);
  }

  let canonicalRoot;
  let canonicalBinary;
  try {
    canonicalRoot = realpathSync(unpackedRoot);
    canonicalBinary = realpathSync(binaryPath);
  } catch (cause) {
    throw new Error(
      `packaged esbuild binary is missing for ${process.platform}/${process.arch}: ${binaryPath}`,
      { cause },
    );
  }
  if (!isInsidePath(canonicalRoot, canonicalBinary) || !lstatSync(canonicalBinary).isFile()) {
    throw new Error(`packaged esbuild binary is invalid: ${binaryPath}`);
  }
  try {
    accessSync(
      canonicalBinary,
      process.platform === "win32" ? fsConstants.F_OK : fsConstants.X_OK,
    );
  } catch (cause) {
    throw new Error(`packaged esbuild binary is not executable: ${binaryPath}`, { cause });
  }

  process.env.ESBUILD_BINARY_PATH = canonicalBinary;
}

// ── TypeScript 编译器 ──
// Electron needs esbuild's direct synchronous path for both dev and packaged lazy imports.
process.env.ESBUILD_WORKER_THREADS = "0";
try {
  configurePackagedEsbuild();
  writeMainLog("phase:esbuild-ready");
} catch (error) {
  writeMainLog("phase:esbuild-failed", error);
  throw error;
}
const { register } = await import("tsx/esm/api");
register();
writeMainLog("phase:tsx-ready");

// ── 核心模块 ──
const [{ app, BrowserWindow, globalShortcut, Tray, Menu, nativeImage, shell }] =
  await Promise.all([import("electron")]);
writeMainLog("phase:electron-module-loaded");

// 打包后应用根目录为 <resources>/app.asar，开发时为项目根。
// Windows 下 URL.pathname 带前导斜杠（/E:/...），path.join 会拼出非法路径，必须用 fileURLToPath。

// ── 单实例锁 ──
if (!app.requestSingleInstanceLock()) { app.quit(); process.exit(0); }
app.on("second-instance", () => { mainWindow?.show(); mainWindow?.focus(); });

const isDev = process.env.NODE_ENV === "development";
let mainWindow = null;
let officePreview = null;
let officeQuitPending = false;
let officeQuitApproved = false;
let isQuitting = false;
let serverPort = isDev ? 8000 : 0;
let applicationUrl = null;
let applicationReady = false;
let startupFailed = false;
let updateRuntime;

// ── 图标 ──
const ICON_PATH = pathJoin(APP_ROOT, "resources", "app-icon.png");
const STARTUP_PAGE_PATH = pathJoin(APP_ROOT, "resources", "startup", "loading.html");

// ── 窗口 ──
function createWindow({ show = true } = {}) {
  const preloadPath = pathJoin(APP_ROOT, "src", "electron", "preload.cjs");
  const win = new BrowserWindow({
    width: 1180, height: 780, minWidth: 960, minHeight: 640, title: "PiCoddy",
    icon: ICON_PATH, backgroundColor: "#121214", show,
    ...(process.platform === "darwin"
      ? {
        titleBarStyle: "hiddenInset",
        acceptFirstMouse: true,
        // 红绿灯垂直居中于 56px 顶栏（按钮约 12px，(56-12)/2 ≈ 22）
        trafficLightPosition: { x: 16, y: 22 },
      }
      : {}),
    ...(process.platform === "win32"
      ? {
        titleBarStyle: "hidden",
        titleBarOverlay: {
          color: "#121214",
          symbolColor: "#f5f5f7",
          height: 30,
        },
      }
      : {}),
    webPreferences: { preload: preloadPath, webviewTag: true, contextIsolation: true, nodeIntegration: false },
  });
  if (isDev) win.webContents.openDevTools({ mode: "detach" });
  win.on("close", (event) => {
    if (process.platform !== "darwin" && officePreview && !officeQuitApproved) {
      event.preventDefault(); app.quit(); return;
    }
    if (process.platform === "darwin" && !isQuitting) {
      event.preventDefault();
      win.hide();
    }
  });
  win.on("closed", () => { if (mainWindow === win) mainWindow = null; });
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (!url.startsWith("http://localhost") && !url.startsWith("http://127.0.0.1")) {
      void shell.openExternal(url).catch((error) => {
        writeMainLog("open-external-failed", error);
      });
      return { action: "deny" };
    }
    return { action: "allow" };
  });
  return win;
}

async function loadStartupPage(win, state = "loading") {
  await win.loadFile(
    STARTUP_PAGE_PATH,
    state === "error" ? { query: { state: "error" } } : undefined,
  );
  if (!win.isDestroyed()) win.show();
}

async function handleStartupFailure(error) {
  startupFailed = true;
  writeMainLog("startup-failure", error);
  console.error("[startup] PiCoddy failed to start", error);
  if (!app.isPackaged || !mainWindow || mainWindow.isDestroyed()) return;
  try {
    await loadStartupPage(mainWindow, "error");
  } catch (pageError) {
    console.error("[startup] failed to show startup error page", pageError);
    if (!mainWindow.isDestroyed()) mainWindow.show();
  }
}

// ── 简易 multipart 解析 ──
function parseMultipart(buf, boundary) {
  const files = [];
  const str = buf.toString("binary");
  const parts = str.split("--" + boundary);
  for (const part of parts) {
    if (part.includes("Content-Disposition: form-data")) {
      const nameMatch = part.match(/name="([^"]+)"/);
      const filenameMatch = part.match(/filename="([^"]+)"/);
      if (filenameMatch) {
        const contentTypeMatch = part.match(/Content-Type:\s*([^\r\n]+)/i);
        const headerEnd = part.indexOf("\r\n\r\n");
        const dataStart = headerEnd >= 0 ? headerEnd + 4 : 0;
        let data = part.slice(dataStart);
        if (data.endsWith("\r\n")) data = data.slice(0, -2);
        files.push({ filename: filenameMatch[1], contentType: (contentTypeMatch||[])[1] || "application/octet-stream", data: Buffer.from(data, "binary") });
      }
    }
  }
  return files;
}

// ── 静态文件服务器 ──
async function startStaticServer() {
  const { join, extname } = await import("node:path");
  const { readFileSync } = await import("node:fs");
  const distDir = join(APP_ROOT, "frontend", "dist");
  const mimeMap = { ".html":"text/html",".js":"application/javascript",".css":"text/css",".json":"application/json",".png":"image/png",".svg":"image/svg+xml",".ico":"image/x-icon" };

  const { createServer } = await import("node:http");
  const { updateGate } = await import("./src/infra/update-gate.ts");
  const srv = createServer((req, res) => {
    if (req.method === "POST" && req.url?.split("?")[0] === "/api/attachments") {
      void updateGate.run("file-write", () => new Promise((resolve, reject) => {
        res.once("finish", resolve); res.once("close", resolve);
        handleStaticRequest(req, res).catch(reject);
      })).catch(() => { if (!res.headersSent) res.writeHead(503); res.end(JSON.stringify({ error: "正在准备更新" })); });
    } else void handleStaticRequest(req, res);
  });
  async function handleStaticRequest(req, res) {
    const url = new URL(req.url, `http://127.0.0.1:${serverPort}`);

    // API 请求：通过 HTTP 代理（SSE 流 + OAuth 回调 + 文件上传）
    if (url.pathname.startsWith("/api/")) {
      const allowedOrigins = new Set([`http://127.0.0.1:${serverPort}`, `http://localhost:${serverPort}`, ...(isDev ? ['http://localhost:5173', 'http://127.0.0.1:5173'] : [])]);
      const hostOrigin = `http://${req.headers.host || ''}`;
      if (!allowedOrigins.has(hostOrigin) || (req.headers.origin && !allowedOrigins.has(req.headers.origin)) || req.headers['sec-fetch-site'] === 'cross-site') {
        res.writeHead(403, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: '仅允许本地应用来源访问' }));
        return;
      }
      try {
        const h = globalThis.__handleApi;
        if (h) {
          // 附件上传：multipart 解析
          if (url.pathname === "/api/attachments" && req.method === "POST") {
            console.log("[HTTP] multipart upload received, content-type:", req.headers["content-type"]);
            try {
              const { randomUUID } = await import("node:crypto");
              const { join } = await import("node:path");
              const { writeFileSync, mkdirSync } = await import("node:fs");
              const { platformPaths } = await import("./src/platform/paths.ts");
              const boundary = (req.headers["content-type"] || "").split("boundary=")[1];
              console.log("[HTTP] boundary:", boundary);
              if (!boundary) { res.statusCode = 400; res.end(JSON.stringify({error:"invalid multipart"})); return; }
              const chunks = [];
              req.on("data", (c) => chunks.push(c));
              req.on("end", async () => {
                try {
                  const { insertAttachment } = await import("./src/domains/attachment/node/store.ts");
                  const buf = Buffer.concat(chunks);
                  const files = parseMultipart(buf, boundary);
                  if (files.length === 0) { res.statusCode = 400; res.end(JSON.stringify({error:"no files"})); return; }
                  const root = join(platformPaths.appDataDir, "attachments");
                  const records = [];
                  for (const f of files) {
                    const id = randomUUID();
                    const dir = join(root, id);
                    mkdirSync(dir, { recursive: true, mode: 0o700 });
                    const filePath = join(dir, f.filename || "file");
                    writeFileSync(filePath, f.data);
                    const record = { id, name: f.filename, filePath, size: f.data.length, mimeType: f.contentType || "application/octet-stream", extension: (f.filename||"").split(".").pop()?.toLowerCase() || "" };
                    insertAttachment(record);
                    records.push(record);
                  }
                  res.writeHead(200, {"Content-Type":"application/json"});
                  console.log("[HTTP] multipart parsed:", files.length, "files:", files.map(f=>({name:f.filename,size:f.data.length})));
                  res.end(JSON.stringify({ attachments: records.map(({id,name,size,mimeType,extension}) => ({id,name,size,mimeType,extension})) }));
                } catch (e) { res.statusCode = 400; res.end(JSON.stringify({error:e.message})); }
              });
              return;
            } catch { /* fall through */ }
          }
          let body = "";
          req.on("data", (c) => (body += c));
          req.on("end", async () => {
            const requestAbort = new AbortController();
            const abortRequest = () => requestAbort.abort();
            req.once("aborted", abortRequest);
            res.once("close", abortRequest);
            try {
              const requestHeaders = new Map();
              for (const [name, value] of Object.entries(req.headers)) {
                if (typeof value === "string") requestHeaders.set(name, value);
                else if (Array.isArray(value)) requestHeaders.set(name, value.join(", "));
              }
              const result = await h({ method: req.method, url: `http://127.0.0.1:${serverPort}${url.pathname}${url.search}`, headers: requestHeaders, json: () => Promise.resolve(body ? JSON.parse(body) : undefined), signal: requestAbort.signal }, url.pathname);
              if (result instanceof Response) {
                result.headers.forEach((v,k) => { if (k !== "content-length") res.setHeader(k,v); });
                res.statusCode = result.status;
                if (result.headers.get("content-type")?.includes("text/event-stream")) {
                  // Do not wait for the first agent event to establish SSE.
                  // This is especially important during packaged cold starts.
                  res.flushHeaders();
                }
                // SSE 流：逐块转发，不缓冲
                if (result.body) {
                  const reader = result.body.getReader();
                  try {
                    while (!requestAbort.signal.aborted) {
                      const { done, value } = await reader.read();
                      if (done) { res.end(); break; }
                      if (res.write(value)) continue;
                      const drained = await new Promise((resolve) => {
                        const cleanup = () => {
                          res.removeListener("drain", onDrain);
                          res.removeListener("close", onClose);
                        };
                        const onDrain = () => { cleanup(); resolve(true); };
                        const onClose = () => { cleanup(); resolve(false); };
                        res.once("drain", onDrain);
                        res.once("close", onClose);
                      });
                      if (!drained) break;
                    }
                  } finally {
                    if (requestAbort.signal.aborted) {
                      try { await reader.cancel(); } catch {}
                    }
                  }
                } else {
                  res.end(await result.text());
                }
              } else {
                res.setHeader("Content-Type", "application/json");
                res.end(JSON.stringify(result));
              }
            } catch (e) { res.statusCode = 500; res.end(JSON.stringify({error:e.message})); }
          });
          return;
        }
      } catch (e) { console.error("[auth-http]", e); }
    }

    // 静态文件：仅生产模式（开发模式由 Vite 处理）
    if (!isDev) {
      try {
        const filePath = join(distDir, url.pathname === "/" ? "index.html" : url.pathname);
        const content = readFileSync(filePath);
        const ext = extname(filePath).toLowerCase();
        res.writeHead(200, { "Content-Type": mimeMap[ext] || "application/octet-stream" });
        res.end(content);
      } catch {
        const html = readFileSync(join(distDir, "index.html"));
        res.writeHead(200, { "Content-Type": "text/html" });
        res.end(html);
      }
    } else {
      // 开发模式：非 auth 请求返回 204（Vite 代理不需要此服务器）
      res.writeHead(204);
      res.end();
    }
  }

  return new Promise((resolve, reject) => {
    const rejectOnError = (error) => {
      writeMainLog("http.start_failed", error);
      reject(error);
    };
    srv.once("error", rejectOnError);
    srv.listen(isDev ? 8000 : serverPort, "127.0.0.1", () => {
      srv.removeListener("error", rejectOnError);
      serverPort = srv.address().port;
      console.log("[main] Static server on http://127.0.0.1:" + serverPort);
      writeMainLog(`phase:http-started port=${serverPort}`);
      resolve(serverPort);
    });
  });
}

// ── 托盘 ──
async function setupTray() {
  try {
    const icon = nativeImage.createFromPath(ICON_PATH).resize({ width: 16, height: 16 });
    const tray = new Tray(icon);
    tray.setToolTip("PiCoddy");
    tray.setContextMenu(Menu.buildFromTemplate([
      { label: "显示窗口", click: () => { mainWindow?.show(); mainWindow?.focus(); } },
      { label: "新建对话", click: () => mainWindow?.webContents.send("notification", "new-conversation") },
      { type: "separator" },
      { label: "退出 PiCoddy", click: () => { app.quit(); } },
    ]));
    tray.on("click", () => { mainWindow?.isVisible() ? mainWindow.hide() : mainWindow?.show()?.focus(); });
  } catch (e) { console.warn("[main] Tray:", e.message); }
}

// ── 启动 ──
async function bootstrapApplication() {
  writeMainLog("phase:electron-ready");
  console.log("[main] Electron ready");

  // BrowserWindow.icon does not set the macOS Dock icon in development.
  // Apply the same brand asset before showing any window, including startup errors.
  if (process.platform === "darwin" && app.dock) app.dock.setIcon(ICON_PATH);

  // Windows 的顶级菜单由渲染层放入标题栏，子菜单仍由主进程原生弹出。
  if (process.platform === "win32") Menu.setApplicationMenu(null);

  // 1. 先创建主窗口；打包环境立即展示零依赖启动页。
  mainWindow = createWindow({ show: !app.isPackaged });
  writeMainLog("phase:window-created");
  if (app.isPackaged) await loadStartupPage(mainWindow);
  writeMainLog("phase:startup-page-loaded");

  const { createUpdateRuntime } = await import("./src/electron/updates/runtime.ts");
  updateRuntime = await createUpdateRuntime({ window: () => mainWindow, setQuitting: (value) => { isQuitting = value; }, applicationOrigin: () => applicationUrl });
  if (updateRuntime.recoveryRequired) {
    await mainWindow.loadFile(updateRuntime.recoveryPage);
    mainWindow.show();
    return;
  }

  // 2. 初始化后端
  writeMainLog("phase:backend-init-start");
  const { initDb } = await import("./src/infra/db.ts");
  initDb();
  writeMainLog("phase:database-ready");
  const { handleApi } = await import("./application.electron.ts");
  globalThis.__handleApi = handleApi;
  writeMainLog("phase:application-module-loaded");

  // 3. 启动 HTTP 服务器（OAuth 回调 + 生产静态文件）
  await startStaticServer();
  writeMainLog(`phase:static-server-ready port=${serverPort}`);
  applicationUrl = isDev ? "http://localhost:5173" : `http://127.0.0.1:${serverPort}`;

  // 4. 正式页面导航前完成 BrowserView 与 IPC 注册，避免首屏调用竞态。
  const { BrowserViewManager } = await import("./src/electron/browser-view-manager.ts");
  const browserViewManager = new BrowserViewManager();
  browserViewManager.create(mainWindow);
  browserViewManager.setStatusChangeHandler((s) => mainWindow?.webContents.send("browser.state-changed", s));

  const { registerIpcHandlers, setHandleApi } = await import("./src/electron/ipc-handlers.ts");
  setHandleApi(handleApi);
  registerIpcHandlers({ mainWindow, getMainWindow: () => mainWindow, browserViewManager, serverPort });
  const { registerOfficePreview } = await import("./src/electron/office-preview.ts");
  officePreview = registerOfficePreview(() => mainWindow);
  writeMainLog("phase:ipc-ready");
  const channels = await import("./src/channels/node/runtime.ts");
  globalThis.__stopChannels = channels.stopChannels;
  void channels.getChannelService().catch(() => writeMainLog("channels:restore-failed"));

  // 5. 平台功能
  if (process.platform === "darwin") setupTray();
  try { globalShortcut.register("Alt+Space", () => { mainWindow?.isVisible() && mainWindow?.isFocused() ? mainWindow.hide() : (mainWindow?.show(), mainWindow?.focus()); }); console.log("[main] Alt+Space registered"); } catch (e) { console.warn("[main] Shortcut:", e.message); }
  if (process.platform === "darwin" && app.dock) app.dock.setMenu(Menu.buildFromTemplate([{ label: "新建对话", click: () => mainWindow?.webContents.send("notification", "new-conversation") }, { type: "separator" }, { label: "显示窗口", click: () => { mainWindow?.show(); mainWindow?.focus(); } }]));

  // 6. 同一窗口切换至正式前端；loadURL 完成后才标记应用就绪。
  writeMainLog(`phase:frontend-load-start url=${applicationUrl}`);
  await mainWindow.loadURL(applicationUrl);
  writeMainLog("phase:frontend-loaded");
  applicationReady = true;
  await updateRuntime?.ready();
  writeMainLog("phase:ready");
  console.log("[main] PiCoddy ready");
}

async function activateMainWindow() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.show();
    mainWindow.focus();
    return;
  }

  mainWindow = createWindow({ show: !app.isPackaged });
  try {
    if (applicationReady && applicationUrl) {
      await mainWindow.loadURL(applicationUrl);
      if (!mainWindow.isDestroyed()) mainWindow.show();
      return;
    }
    if (app.isPackaged) {
      await loadStartupPage(mainWindow, startupFailed ? "error" : "loading");
      return;
    }
    await mainWindow.loadURL("http://localhost:5173");
  } catch (error) {
    await handleStartupFailure(error);
  }
}

app.whenReady()
  .then(bootstrapApplication)
  .catch((error) => { updateRuntime?.fail(); void handleStartupFailure(error); });

let channelQuitPending = false;
let channelQuitFinished = false;
let previewQuitPending = false;
let previewQuitFinished = false;
app.on("before-quit", (event) => {
  if (officePreview && !officeQuitApproved) {
    event.preventDefault();
    if (!officeQuitPending) {
      officeQuitPending = true;
      officePreview.closeAll().then(ok => {
        officeQuitPending = false;
        if (ok) { officeQuitApproved = true; app.quit(); }
      }).catch(error => { officeQuitPending = false; writeMainLog("office-close", String(error)); });
    }
    return;
  }
  if (!previewQuitFinished && globalThis.__stopPreviewRuns) {
    event.preventDefault();
    if (!previewQuitPending) {
      previewQuitPending = true;
      Promise.resolve(globalThis.__stopPreviewRuns()).catch(error => writeMainLog("preview-cleanup", String(error))).finally(() => {
        previewQuitFinished = true; app.quit();
      });
    }
    return;
  }
  if (!channelQuitFinished && globalThis.__stopChannels) {
    event.preventDefault();
    if (!channelQuitPending) {
      channelQuitPending = true;
      Promise.resolve(globalThis.__stopChannels()).catch(() => writeMainLog("channels:stop-failed")).finally(() => {
        channelQuitFinished = true; app.quit();
      });
    }
    return;
  }
  writeMainLog("phase:before-quit");
  isQuitting = true;
  globalShortcut.unregisterAll();
});
app.on("window-all-closed", () => {
  writeMainLog("phase:window-all-closed");
  if (process.platform !== "darwin") app.quit();
});
app.on("will-quit", () => writeMainLog("phase:will-quit"));
app.on("render-process-gone", (_event, _webContents, details) => {
  writeCrashLog("render-process-gone", JSON.stringify(details));
  writeMainLog("render-process-gone", JSON.stringify(details));
});
app.on("child-process-gone", (_event, details) => {
  writeCrashLog("child-process-gone", JSON.stringify(details));
  writeMainLog("child-process-gone", JSON.stringify(details));
});
app.on("activate", () => { void activateMainWindow(); });
