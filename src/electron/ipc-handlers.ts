import { registerChannelIpc } from "../channels/node/ipc.ts";
import { createTrustedMainWindowGuard } from "./trusted-main-window.ts";
import { updateGate } from "../infra/update-gate.ts";
/**
 * IPC Handler 注册 — 集中管理所有 ipcMain.handle/on 调用。
 * 参考 agent-1.0.24 模式：每个 handler 直接调用业务逻辑，无 HTTP 代理层。
 */

import { ipcMain as electronIpcMain, app, dialog, shell, BrowserWindow, Menu } from "electron";
import { writeFileSync, readdirSync, statSync, mkdirSync, readFileSync } from "node:fs";

import type { BrowserViewManager } from "./browser-view-manager.ts";
import { decodeApiResponse } from "./api-response.ts";
import { startOperation } from "../infra/operation_log.ts";
import { openPathSafely } from "./safe-shell-open.ts";

const nativeIpcHandle = electronIpcMain.handle.bind(electronIpcMain);

function handleLogged(
  channel: string,
  listener: (...args: any[]) => any,
): void {
  nativeIpcHandle(channel, async (...args: any[]) => {
    const operation = startOperation(`ipc.${channel}`, {
      argumentCount: Math.max(0, args.length - 1),
    });
    try {
      const continuation = ["session.stop", "permission.respond", "ask.respond", "client-invoke"].includes(channel);
      const result = await (continuation ? listener(...args) : updateGate.run("ipc", () => listener(...args)));
      operation.success();
      return result;
    } catch (error) {
      operation.error(error);
      throw error;
    }
  });
}

// Keep the existing registration code readable while ensuring every
// ipcMain.handle listener receives the same crash-safe operation boundary.
const ipcMain = new Proxy(electronIpcMain, {
  get(target, property, receiver) {
    if (property === "handle") return handleLogged;
    const value = Reflect.get(target, property, receiver);
    return typeof value === "function" ? value.bind(target) : value;
  },
});

// ── 延迟导入的业务模块（避免循环依赖） ──
let _handleApi: ((req: any, path: string) => Promise<any>) | null = null;
let _serverPort = 8000;

export function setHandleApi(fn: (req: any, path: string) => Promise<any>) { _handleApi = fn; }

// ── 注册所有 IPC handlers ──

export function registerIpcHandlers(opts: {
  mainWindow: BrowserWindow;
  getMainWindow: () => BrowserWindow | null;
  browserViewManager: BrowserViewManager;
  serverPort: number;
}) {
  const { mainWindow, browserViewManager, serverPort } = opts;
  _serverPort = serverPort;

  // ── Browser ──
  const safe = (fn: () => any) => { try { return fn(); } catch { return null; } };

  ipcMain.handle("window.menu.popup", async (_event, payload: unknown) => {
    if (process.platform !== "win32") return { ok: false };
    const value = payload && typeof payload === "object"
      ? payload as Record<string, unknown>
      : {};
    const menuId = value.menuId;
    if (menuId !== "edit" && menuId !== "window" && menuId !== "help") {
      throw new TypeError("无效的窗口菜单");
    }

    const [contentWidth, contentHeight] = mainWindow.getContentSize();
    const coordinate = (candidate: unknown, maximum: number): number => {
      if (typeof candidate !== "number" || !Number.isFinite(candidate)) return 0;
      return Math.max(0, Math.min(Math.round(candidate), maximum));
    };
    const x = coordinate(value.x, contentWidth);
    const y = coordinate(value.y, contentHeight);
    const menu = menuId === "edit"
      ? Menu.buildFromTemplate([
        { label: "撤销", role: "undo" },
        { label: "重做", role: "redo" },
        { type: "separator" },
        { label: "剪切", role: "cut" },
        { label: "复制", role: "copy" },
        { label: "粘贴", role: "paste" },
        { label: "全选", role: "selectAll" },
      ])
      : menuId === "window"
      ? Menu.buildFromTemplate([
        { label: "最小化", role: "minimize" },
        { label: "关闭", role: "close" },
      ])
      : Menu.buildFromTemplate([
        { label: "关于 PiCoddy", click: () => app.showAboutPanel() },
      ]);

    await new Promise<void>((resolve) => {
      menu.popup({ window: mainWindow, x, y, callback: resolve });
    });
    return { ok: true };
  });

  ipcMain.handle("window.titlebar.setTheme", (_event, theme: unknown) => {
    if (process.platform !== "win32") return { ok: false };
    if (theme !== "light" && theme !== "dark") {
      throw new TypeError("无效的标题栏主题");
    }
    mainWindow.setTitleBarOverlay({
      color: theme === "dark" ? "#18181b" : "#f6f6f6",
      symbolColor: theme === "dark" ? "#f5f5f7" : "#202124",
      height: 30,
    });
    return { ok: true };
  });

  ipcMain.handle("browser.toggle", () => safe(() => { browserViewManager.toggle(); return browserViewManager.getStatus(); }));
  ipcMain.handle("browser.show", () => safe(() => { browserViewManager.show(); return browserViewManager.getStatus(); }));
  ipcMain.handle("browser.hide", () => safe(() => { browserViewManager.hide(); return browserViewManager.getStatus(); }));
  ipcMain.handle("browser.navigate", (_e, url) => safe(() => { browserViewManager.navigate(url); return browserViewManager.getStatus(); }));
  ipcMain.handle("browser.getStatus", () => safe(() => browserViewManager.getStatus()));
  ipcMain.handle("browser.goBack", () => safe(() => { browserViewManager.goBack(); return browserViewManager.getStatus(); }));
  ipcMain.handle("browser.goForward", () => safe(() => { browserViewManager.goForward(); return browserViewManager.getStatus(); }));
  ipcMain.handle("browser.reload", () => safe(() => { browserViewManager.reload(); return browserViewManager.getStatus(); }));
  ipcMain.handle("browser.stop", () => safe(() => { browserViewManager.stop(); return browserViewManager.getStatus(); }));
  ipcMain.handle("browser.setBounds", (_e, x, y, w, h) => safe(() => { browserViewManager.setBounds(x, y, w, h); }));
  ipcMain.handle("browser.setTheme", (_e, t, b) => safe(() => { browserViewManager.setTheme(t, b); }));
  ipcMain.handle("browser.enterFullscreen", () => { mainWindow.setFullScreen(true); });
  ipcMain.handle("browser.exitFullscreen", () => { mainWindow.setFullScreen(false); });

  // ── FS ──
  ipcMain.handle("fs.readFile", async (_e, fp: string) => {
    try {
      const fs = await import("node:fs"); const p = await import("node:path");
      const ext = p.extname(fp).toLowerCase();
      const imgExts = [".png",".jpg",".jpeg",".gif",".webp",".bmp",".svg"];
      if (imgExts.includes(ext)) {
        const buf = fs.readFileSync(fp);
        const mimeMap: Record<string,string> = {".png":"image/png",".jpg":"image/jpeg",".jpeg":"image/jpeg",".gif":"image/gif",".webp":"image/webp",".bmp":"image/bmp",".svg":"image/svg+xml"};
        return { type:"image", content:`data:${mimeMap[ext]};base64,${buf.toString("base64")}`, mimeType:mimeMap[ext] };
      }
      return { type:"text", content:fs.readFileSync(fp,"utf-8"), ext };
    } catch (e: any) { return { type:"error", message:e.message }; }
  });
  ipcMain.handle("fs.listDirectory", async (_e, dp: string) => {
    try {
      const fs = await import("node:fs"); const p = await import("node:path");
      return fs.readdirSync(dp,{withFileTypes:true}).map((e:any) => ({name:e.name,isDir:e.isDirectory(),ext:p.extname(e.name).toLowerCase()}));
    } catch { return []; }
  });
  ipcMain.handle("fs.openPath", async (_e, fp: string) => {
    const target = typeof fp === "string" ? fp.trim() : "";
    const error = await openPathSafely(shell.openPath.bind(shell), target, {
      requireExistingPath: true,
    });
    return error ? { ok: false, error } : { ok: true, path: target };
  });
  ipcMain.handle("fs.showItemInFolder", async (_e, fp: unknown) => {
    const filePath = typeof fp === "string" ? fp.trim() : "";
    if (!filePath) return { ok: false, error: "文件路径为空" };
    try {
      const fs = await import("node:fs");
      const p = await import("node:path");
      const target = p.resolve(filePath);
      if (fs.existsSync(target)) {
        shell.showItemInFolder(target);
        return { ok: true, path: target };
      }
      const parent = p.dirname(target);
      const error = await openPathSafely(shell.openPath.bind(shell), parent, {
        requireExistingPath: true,
      });
      return error
        ? { ok: false, path: parent, error }
        : { ok: true, path: parent, fallback: true };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  });
  ipcMain.handle("file.preview", async (_e, p: any) => _callApi("GET", `/api/preview?path=${encodeURIComponent(p.path||"")}`));
  ipcMain.handle("file.previewMarkdown", async (_e, p: any) => _callApi("GET", `/api/preview/markdown?path=${encodeURIComponent(p.path||"")}`));
  ipcMain.handle("file.read", async (_e, p: any) => _callApi("GET", `/api/file?path=${encodeURIComponent(p.path||"")}`));
  ipcMain.handle("file.openExternal", async (_e, p: any) => {
    const target = typeof p?.path === "string" ? p.path.trim() : "";
    const error = await openPathSafely(shell.openPath.bind(shell), target, {
      requireExistingPath: true,
    });
    return error ? { ok: false, error } : { ok: true, path: target };
  });
  ipcMain.handle("dialog.pickDir", async () => {
    if (mainWindow.isMinimized()) mainWindow.restore();
    if (!mainWindow.isVisible()) mainWindow.show();
    mainWindow.focus();
    const options = {
      title: "选择本地文件夹",
      buttonLabel: "选择文件夹",
      properties: ["openDirectory"] as Array<"openDirectory">,
    };
    // Windows 下无父窗口的系统对话框更不容易被应用内模态层遮挡。
    const result = process.platform === "win32"
      ? await dialog.showOpenDialog(options)
      : await dialog.showOpenDialog(mainWindow, options);
    if (result.canceled || !result.filePaths[0]) {
      return { cancelled: true, path: null };
    }
    const path = await import("node:path");
    const selectedPath = result.filePaths[0];
    return {
      cancelled: false,
      path: selectedPath,
      name: path.basename(selectedPath) || "新空间",
    };
  });

  // ── Attachments（主进程直接处理文件 I/O） ──
  ipcMain.handle("attachments.upload", async (_e, payload: any) => {
    const path = typeof payload?.path === "string" ? payload.path : "";
    console.log("[IPC] attachments.upload received:", path || payload?.name);
    try {
      const { saveLocalFiles, saveUploadedFiles } = await import(
        "../domains/attachment/node/service.ts"
      );
      let records;
      if (path) {
        records = await saveLocalFiles([{
          path,
          mimeType: payload?.mimeType || "application/octet-stream",
        }]);
      } else {
        const name = typeof payload?.name === "string" ? payload.name : "";
        const mimeType = typeof payload?.mimeType === "string" && payload.mimeType
          ? payload.mimeType
          : "application/octet-stream";
        const rawBytes = payload?.bytes;
        const bytes = rawBytes instanceof ArrayBuffer
          ? new Uint8Array(rawBytes)
          : ArrayBuffer.isView(rawBytes)
          ? Uint8Array.from(
            new Uint8Array(
              rawBytes.buffer,
              rawBytes.byteOffset,
              rawBytes.byteLength,
            ),
          )
          : null;
        if (!name || !bytes) {
          throw new TypeError("附件上传载荷无效");
        }
        records = await saveUploadedFiles([
          new File([bytes], name, { type: mimeType }),
        ]);
      }
      return records.map(({ id, name, size, mimeType, extension }) => ({
        id,
        name,
        size,
        mimeType,
        extension,
      }));
    } catch (error) {
      console.error("[IPC] upload failed:", error);
      throw error;
    }
  });

  // ── System ──
  ipcMain.handle("system.browserAutomationGet", async () => _callApi("GET", "/api/system/browser-automation"));
  ipcMain.handle("system.browserAutomationSet", async (_event, body) => _callApi("POST", "/api/system/browser-automation", body));
  ipcMain.handle("system.permissions", async () => _callApi("GET", "/api/system/permissions"));
  ipcMain.handle("system.openPermissionSettings", async () => _callApi("POST", "/api/system/permissions/open", {}));
  ipcMain.handle("system.context", async () => _callApi("GET", "/api/system/context"));
  ipcMain.handle("system.sidecar", async () => ({ready:false,port:0,logs:[]}));
  ipcMain.handle("system.exit", async () => { app.quit(); return {ok:true}; });
  ipcMain.handle("float.transfer", async (_e, p: any) => _callApi("POST", "/api/float/transfer", p));
  ipcMain.handle("float.close", async () => ({ok:true}));

  // ── Domain CRUD (通过 handleApi 桥接，共享 application.electron.ts 的业务逻辑) ──
  _registerDomainHandlers(opts.getMainWindow);
  _registerCoreIpc(mainWindow, serverPort);
}

// ── Domain API（代理到 handleApi，未来逐步替换为直接调用） ──
function _registerDomainHandlers(getMainWindow: () => BrowserWindow | null) {
  registerChannelIpc((name, listener) => ipcMain.handle(name, listener), getMainWindow);
  const h = (method: string, path: string, body?: any, tapdTrustedIpc = false) => _callApi(method, path, body, tapdTrustedIpc);
  // IPC route parameters may already be percent-encoded by the renderer's
  // HTTP-compatible client. Decode once before encoding for the internal
  // request so IDs containing reserved characters are never double-encoded.
  const pathSegment = (value: unknown): string => {
    const text = typeof value === "string" ? value : "";
    try {
      return encodeURIComponent(decodeURIComponent(text));
    } catch {
      return encodeURIComponent(text);
    }
  };
  const api = (name: string, method: string, pathFn: (p: any) => string, bodyFn?: (p: any) => any) => {
    ipcMain.handle(name, async (_e, p: any) => {
      const path = pathFn(p);
      const body = bodyFn ? bodyFn(p) : (p && Object.keys(p).length > 0 ? p : undefined);
      return h(method, path, body);
    });
  };

  // Config
  // Auth
  ipcMain.handle("auth.session", async () => h("GET", "/api/auth/session"));
  ipcMain.handle("auth.login", async () => h("POST", "/api/auth/login", {}));
  ipcMain.handle("auth.logout", async () => h("POST", "/api/auth/logout", {}));

  ipcMain.handle("config.get", async () => h("GET", "/api/settings"));
  ipcMain.handle("config.save", async (_e, p) => h("POST", "/api/settings", p));
  ipcMain.handle("config.openaiSubscriptionStatus", async () => h("GET", "/api/settings/openai-subscription"));
  api("config.openaiSubscription", "POST", () => "/api/settings/openai-subscription");
  ipcMain.handle("config.getApiKeys", async () => h("GET", "/api/settings/keys"));
  ipcMain.handle("config.saveApiKey", async (_e, p) => h("POST", "/api/settings/keys", p));
  api("config.deleteApiKey", "DELETE", (p) => `/api/settings/keys/${p.provider}`);
  api("config.saveCustomProvider", "POST", () => "/api/settings/custom-providers");
  api("config.deleteCustomProvider", "DELETE", (p) => `/api/settings/custom-providers/${p.id}`);
  api("config.testConnection", "POST", () => "/api/settings/test-connection");
  api("config.customProviderModels", "POST", () => "/api/settings/custom-providers/models");

  // Session
  ipcMain.handle("session.list", async () => h("GET", "/api/conv"));
  ipcMain.handle("session.start", async (_e, p: any) => h("POST", "/api/conv", {title:p?.title, category:p?.category||"assistant", workspaceId:p?.workspaceId, modelProvider:p?.provider, modelId:p?.model, expertOperation:p?.expertOperation}));
  api("session.delete", "DELETE", (p) => `/api/conv/${p.sessionId}`);
  api("session.getMessages", "GET", (p) => `/api/msgs/${p.sessionId}`);
  api("session.fork", "POST", (p) => `/api/conv/${p.sessionId}/fork`, (p) => ({fromMessageId:p.fromMessageId}));
  api("session.export", "GET", (p) => `/api/conv/${p.sessionId}/export?format=md`);

  // Memory
  ipcMain.handle("memory.list", async () => h("GET", "/api/memories"));
  ipcMain.handle("memory.create", async (_e, p) => h("POST", "/api/memories", p));
  api("memory.delete", "DELETE", (p) => `/api/memories/${p.id}`);

  // Skills
  ipcMain.handle("clawhub.list", async (_e, p) => h("GET", `/api/clawhub/skills?${new URLSearchParams({ q: p?.q || "", cursor: p?.cursor || "" })}`));
  ipcMain.handle("clawhub.install", async (_e, p) => h("POST", "/api/clawhub/install", p));
  ipcMain.handle("skillhub.ensureAuth", async () => h("POST", "/api/skillhub/auth/ensure"));
  ipcMain.handle("skillhub.authConfig", async () => h("GET", "/api/skillhub/auth/config"));
  ipcMain.handle("skillhub.saveAuthConfig", async (_e, p) => h("POST", "/api/skillhub/auth/config", { secret: p?.secret }));
  ipcMain.handle("skillhub.namespaces", async () => h("GET", "/api/skillhub/namespaces"));
  ipcMain.handle("skillhub.list", async () => h("GET", "/api/skillhub/skills"));
  ipcMain.handle("skillhub.experts", async () => h("GET", "/api/skillhub/experts"));
  ipcMain.handle("skillhub.expertDetail", async (_e, p) =>
    h("GET", `/api/skillhub/experts/${encodeURIComponent(p.namespace)}/${encodeURIComponent(p.slug)}`)
  );
  ipcMain.handle("skillhub.install", async (_e, p) => h("POST", "/api/skillhub/install", p));
  ipcMain.handle("skillhub.expertInstall", async (_e, p) => h("POST", "/api/skillhub/experts/install", p));
  ipcMain.handle("skills.list", async () => h("GET", "/api/skills"));
  ipcMain.handle("skills.create", async (_e, p) => h("POST", "/api/skills", p));
  api("skills.update", "PUT", (p) => `/api/skills/${p.name}`);
  api("skills.delete", "DELETE", (p) => `/api/skills/${p.name}`);

  // Plugins（Pi 生态扩展包）
  ipcMain.handle("plugins.list", async () => h("GET", "/api/plugins"));
  ipcMain.handle("plugins.catalog", async () => h("GET", "/api/plugins/catalog"));
  api("plugins.search", "GET", (p) => `/api/plugins/search?q=${encodeURIComponent(p?.q ?? "")}`, () => undefined);
  ipcMain.handle("plugins.install", async (_e, p) => h("POST", "/api/plugins/install", p));
  ipcMain.handle("plugins.uninstall", async (_e, p) => h("POST", "/api/plugins/uninstall", p));

  // Automation
  ipcMain.handle("automation.list", async () => h("GET", "/api/automations"));
  ipcMain.handle("automation.create", async (_e, p) => h("POST", "/api/automations", p));
  api("automation.update", "PUT", (p) => `/api/automations/${p.id}`);
  api("automation.delete", "DELETE", (p) => `/api/automations/${p.id}`);
  api("automation.run", "POST", (p) => `/api/automations/${p.id}/run`);
  api("automation.runs", "GET", (p) => `/api/automations/${p.id}/runs`);

  // Microapp

  // Workspace
  ipcMain.handle("workspace.list", async () => h("GET", "/api/workspaces"));
  ipcMain.handle("workspace.create", async (_e, p) => h("POST", "/api/workspaces", p));
  api("workspace.update", "PUT", (p) => `/api/workspaces/${p.id}`);
  api("workspace.delete", "DELETE", (p) => `/api/workspaces/${p.id}`);
  api("workspace.assign", "POST", (p) => `/api/workspaces/${p.id}/assign`, (p) => ({conversationId:p.conversationId}));
  api("workspace.assignConversation", "POST", (p) => `/api/conversations/${pathSegment(p?.conversationId)}/workspace`, (p) => ({workspaceId:p?.workspaceId ?? null}));

  // Expert / MCP / Ollama / Audit / Usage / Artifacts / Projects
  ipcMain.handle("expert.list", async () => h("GET", "/api/experts"));
  ipcMain.handle("expert.listInstalled", async () => h("GET", "/api/experts/installed"));
  api("expert.get", "GET", (p) => `/api/experts/${pathSegment(p?.id ?? p?.expertId)}`);
  api("expert.createEditSession", "POST", (p) => `/api/experts/${pathSegment(p?.id ?? p?.expertId)}/edit-session`);
  api("skill.createEditSession", "POST", (p) => `/api/skills/${pathSegment(p?.name)}/edit-session`);
  api("expert.openFolder", "POST", (p) => `/api/experts/${pathSegment(p?.id ?? p?.expertId)}/open-folder`);
  api("expert.uninstall", "DELETE", (p) => `/api/experts/${pathSegment(p?.id ?? p?.expertId)}`);
  api("expert.assign", "PUT", (p) => `/api/conversations/${pathSegment(p?.sessionId)}/expert`, (p) => ({expertId:p?.expertId}));
  api("expert.clear", "DELETE", (p) => `/api/conversations/${pathSegment(p?.sessionId)}/expert`);

  // Connectors（受管 CLI 连接器，经 handleApi 代理到共享服务单例）
  ipcMain.handle("connector.list", async () => h("GET", "/api/connectors"));
  api("connector.get", "GET", (p) => `/api/connectors/${pathSegment(p?.id ?? p?.connectorId)}`);
  api("connector.activate", "POST", (p) => `/api/connectors/${pathSegment(p?.id ?? p?.connectorId)}/activate`);
  api("connector.cancel", "POST", (p) => `/api/connectors/${pathSegment(p?.id ?? p?.connectorId)}/cancel`);
  api("connector.reauthorize", "POST", (p) => `/api/connectors/${pathSegment(p?.id ?? p?.connectorId)}/reauthorize`);
  api("connector.logout", "POST", (p) => `/api/connectors/${pathSegment(p?.id ?? p?.connectorId)}/logout`);
  api("connector.repair", "POST", (p) => `/api/connectors/${pathSegment(p?.id ?? p?.connectorId)}/repair`);
  api("connector.update", "POST", (p) => `/api/connectors/${pathSegment(p?.id ?? p?.connectorId)}/update`);
  api("connector.uninstall", "DELETE", (p) => `/api/connectors/${pathSegment(p?.id ?? p?.connectorId)}`);
  const trustedTapd = createTrustedMainWindowGuard(getMainWindow);
  for (const [action, method, suffix] of [["Status", "GET", ""], ["Install", "POST", "/install"], ["Configure", "POST", "/configure"]] as const) {
    ipcMain.handle(`mcp.npm${action}`, async (event, p) => {
      trustedTapd(event);
      if (p?.id !== "gitlab" && p?.id !== "jenkins") throw new Error("未知的内置连接器");
      return h(method, `/api/mcp/builtin/npm/${p.id}${suffix}`, action === "Configure" ? { env: p.env } : undefined, true);
    });
  }
  ipcMain.handle("mcp.oauthStatus", async (_e, p) => h("GET", `/api/mcp/oauth?name=${encodeURIComponent(p.name)}`));
  ipcMain.handle("mcp.oauth", async (_e, p) => h("POST", "/api/mcp/oauth", p));
  ipcMain.handle("mcp.list", async () => h("GET", "/api/mcp"));
  ipcMain.handle("mcp.addFigma", async (event, p) => { trustedTapd(event); return h("POST", "/api/mcp/presets/figma", p, true); });
  ipcMain.handle("mcp.connect", async (_e, p) => h("POST", "/api/mcp/connect", p));
  ipcMain.handle("mcp.save", async (_e, p) => h("POST", "/api/mcp", p));
  ipcMain.handle("ollama.models", async () => h("GET", "/api/ollama/models"));
  ipcMain.handle("provider.models", async (_e, p) =>
    h("POST", `/api/providers/${pathSegment(p?.provider)}/models`, {
      apiKey: p?.apiKey,
    }));
  ipcMain.handle("audit.list", async () => h("GET", "/api/settings/audit-logs"));
  ipcMain.handle("usage.get", async () => h("GET", "/api/usage"));
  ipcMain.handle("artifacts.list", async () => h("GET", "/api/artifacts"));
  ipcMain.handle("projects.list", async () => h("GET", "/api/projects"));
  ipcMain.handle("tapd.requirements", async (_e, p: any) => {
    const query = new URLSearchParams();
    query.set("page", String(p?.page || 1));
    query.set("pageSize", String(p?.pageSize || 20));
    if (p?.query) query.set("query", String(p.query));
    if (p?.workspaceId) query.set("workspaceId", String(p.workspaceId));
    if (p?.status) query.set("status", String(p.status));
    if (p?.refresh) query.set("refresh", "1");
    return h("GET", `/api/tapd/requirements?${query}`);
  });
  ipcMain.handle("tapd.completionGet", async (_e, p: any) => h("GET", `/api/conversations/${pathSegment(p.id)}/requirement-completion`));
  ipcMain.handle("tapd.testingGet", async (_e, p: any) => {
    const query = new URLSearchParams();
    if (p.assetId) query.set('assetId', String(p.assetId));
    if (p.resultsOnly) query.set('resultsOnly', '1');
    if (p.destinationsOnly) query.set('destinationsOnly', '1');
    return h('GET', `/api/conversations/${pathSegment(p.id)}/testing-delivery${query.size ? `?${query}` : ''}`);
  });
  ipcMain.handle("tapd.testingSubmit", async (_e, p: any) => { const { id, ...body } = p; return h("POST", `/api/conversations/${pathSegment(id)}/testing-delivery`, body); });
  ipcMain.handle("tapd.completionSubmit", async (_e, p: any) => { const { id, ...body } = p; return h("POST", `/api/conversations/${pathSegment(id)}/requirement-completion`, body); });
  ipcMain.handle("tapd.previewGet", async (event, p: any) => {
    trustedTapd(event);
    return h("GET", `/api/tapd/requirements/${pathSegment(p.workspaceId)}/${pathSegment(p.storyId)}/preview`, undefined, true);
  });
  ipcMain.handle("tapd.previewAction", async (event, p: any) => {
    trustedTapd(event); const { workspaceId, storyId, ...body } = p;
    return h("POST", `/api/tapd/requirements/${pathSegment(workspaceId)}/${pathSegment(storyId)}/preview`, body, true);
  });
  ipcMain.handle("tapd.testingExecutionGet", async (event, p: any) => {
    trustedTapd(event);
    return h("GET", `/api/tapd/requirements/${pathSegment(p.workspaceId)}/${pathSegment(p.storyId)}/testing-execution`, undefined, true);
  });
  ipcMain.handle("tapd.testingExecutionSave", async (event, p: any) => {
    trustedTapd(event); const { workspaceId, storyId, ...body } = p;
    return h("POST", `/api/tapd/requirements/${pathSegment(workspaceId)}/${pathSegment(storyId)}/testing-execution`, body, true);
  });
  ipcMain.handle("tapd.inputsGet", async (_e, p: any) => h("GET", `/api/tapd/requirements/${pathSegment(p.workspaceId)}/${pathSegment(p.storyId)}/inputs?stageKey=${encodeURIComponent(p.stageKey)}`));
  ipcMain.handle("tapd.inputsSave", async (_e, p: any) => { const { workspaceId, storyId, ...body } = p; return h("POST", `/api/tapd/requirements/${pathSegment(workspaceId)}/${pathSegment(storyId)}/inputs`, body); });
  ipcMain.handle("tapd.inputHistory", async (_e, p: any) => h("GET", `/api/conversations/${pathSegment(p.id)}/requirement-inputs`));
  ipcMain.handle("tapd.assetsList", async (_e, p: any) => h("GET", `/api/tapd/requirements/${pathSegment(p?.workspaceId)}/${pathSegment(p?.storyId)}/assets`));
  ipcMain.handle("tapd.assetsSave", async (_e, p: any) => {
    const { workspaceId, storyId, ...body } = p || {};
    return h("POST", `/api/tapd/requirements/${pathSegment(workspaceId)}/${pathSegment(storyId)}/assets`, body);
  });
  ipcMain.handle("tapd.requirementOpen", async (_e, p: any) =>
    h("GET", `/api/tapd/requirements/${pathSegment(p?.workspaceId)}/${pathSegment(p?.storyId)}`));
  ipcMain.handle("tapd.requirementConversation", async (_e, p: any) => {
    const workspaceId = pathSegment(p?.workspaceId);
    const storyId = pathSegment(p?.storyId);
    const { workspaceId: _workspaceId, storyId: _storyId, ...body } = p || {};
    return h("POST", `/api/tapd/requirements/${workspaceId}/${storyId}/conversations`, body);
  });

  // Permission / Ask
  ipcMain.handle("permission.respond", async (_e, p: any) => h("POST", "/api/confirm", p));
  ipcMain.handle("ask.respond", async (_e, p: any) => h("POST", "/api/ask-answer", p));

  // Attachments
  api("attachments.delete", "DELETE", (p) => `/api/attachments/${p.id}`);

  // SkillDraft
  const draftProxy = (method: string, path: string, body?: any) => h(method, path, body);
  api("skillDraft.get", "GET", (p) => `/api/skill-drafts/${p.id}`);
  api("skillDraft.files", "GET", (p) => `/api/skill-drafts/${p.id}/files`);
  api("skillDraft.readFile", "GET", (p) => `/api/skill-drafts/${p.id}/file?path=${encodeURIComponent(p.path||"")}`);
  ipcMain.handle("skillDraft.revision", async (_e, p: any) => draftProxy("POST", `/api/skill-drafts/${p.id}/revision`));
  ipcMain.handle("skillDraft.installedFiles", async (_e, p: any) => draftProxy("GET", `/api/skill-drafts/${p.id}/installed-files`));
  ipcMain.handle("skillDraft.readInstalledFile", async (_e, p: any) => draftProxy("GET", `/api/skill-drafts/${p.id}/installed-file?path=${encodeURIComponent(p.path||"")}`));
  ipcMain.handle("skillDraft.validate", async (_e, p: any) => draftProxy("POST", `/api/skill-drafts/${p.id}/validate`));
  ipcMain.handle("skillDraft.install", async (_e, p: any) => draftProxy("POST", `/api/skill-drafts/${p.id}/install`));
}

// ── Core ClientEvent / ServerEvent ──
function _registerCoreIpc(mainWindow: BrowserWindow, serverPort: number) {
  const ALLOWED = new Set(["session.start","session.continue","session.stop","session.list","session.getMessages","permission.response","settings.update","auth.session","auth.login","auth.logout","config.get","config.save","config.getApiKeys","config.openaiSubscriptionStatus","config.openaiSubscription","config.saveApiKey","config.deleteApiKey","memory.list","memory.create","memory.delete","skills.list","skills.create","skills.update","skills.delete","automation.list","automation.create","automation.update","automation.delete","automation.run","automation.runs","workspace.list","workspace.create","workspace.update","workspace.delete","workspace.assign","workspace.assignConversation","expert.list","expert.listInstalled","expert.get","expert.createEditSession","expert.openFolder","expert.uninstall","expert.assign","expert.clear","skill.createEditSession","connector.list","connector.get","connector.activate","connector.cancel","connector.reauthorize","connector.logout","connector.repair","connector.update","connector.uninstall","mcp.oauthStatus","mcp.oauth","mcp.list","mcp.connect","mcp.save","ollama.models","audit.list","usage.get","artifacts.list","projects.list","tapd.requirements","tapd.requirementOpen","tapd.requirementConversation","tapd.assetsList","tapd.assetsSave","tapd.completionGet","tapd.completionSubmit","tapd.inputsGet","tapd.inputsSave","tapd.inputHistory","attachments.upload","attachments.delete","session.fork","session.export","session.delete","session.getMessages","config.saveCustomProvider","config.deleteCustomProvider","config.testConnection","permission.respond","ask.respond","file.preview","file.previewMarkdown","file.read","file.openExternal","dialog.pickDir","system.browserAutomationGet","system.browserAutomationSet","system.permissions","system.openPermissionSettings","system.context","float.transfer","float.close","skillDraft.get","skillDraft.files","skillDraft.readFile","skillDraft.revision","skillDraft.installedFiles","skillDraft.readInstalledFile","skillDraft.validate","skillDraft.install","browser.toggle","browser.show","browser.hide","browser.navigate","browser.getStatus","browser.goBack","browser.goForward","browser.reload","browser.stop","browser.setBounds","browser.setTheme","browser.enterFullscreen","browser.exitFullscreen","fs.readFile","fs.listDirectory","fs.openPath"]);

  ALLOWED.add('tapd.testingGet');
  ALLOWED.add('tapd.testingSubmit');
  ipcMain.on("client-event", (_e, data: any) => {
    if (!ALLOWED.has(data?.type)) return;
    _handleClientEvent(data).catch((e: any) => console.error("[IPC] client-event:", e));
  });

  ipcMain.handle("client-invoke", async (_e, data: any) => {
    if (!ALLOWED.has(data?.type)) {
      return { name: "ApiError", message: "forbidden", status: 403 };
    }
    try {
      return await _handleClientEvent(data);
    } catch (error) {
      if (
        error &&
        typeof error === "object" &&
        (error as { name?: unknown }).name === "ApiError" &&
        Number.isInteger((error as { status?: unknown }).status)
      ) {
        // Error custom properties are discarded by Electron structured cloning.
        const apiError = error as Error & { status: number; code?: string };
        return { name: "ApiError", message: apiError.message, status: apiError.status,
          ...(apiError.code ? { code: apiError.code } : {}) };
      }
      throw error;
    }
  });

  async function _handleClientEvent(event: any) {
    const h = (method: string, path: string, body?: any) => _callApi(method, path, body);
    switch (event.type) {
      case "system.browserAutomationGet": return h("GET", "/api/system/browser-automation");
      case "system.browserAutomationSet": return h("POST", "/api/system/browser-automation", event.payload);
      case "session.start": {
        const session = await h("POST", "/api/conv", {
          title: event.payload?.title || "新对话",
          category: event.payload?.category || "assistant",
          workspaceId: event.payload?.workspaceId,
          modelProvider: event.payload?.provider,
          modelId: event.payload?.model,
        });
        if (event.payload?.prompt) {
          await h("POST", "/api/prompt", { sessionId: session.id, text: event.payload.prompt, mode: event.payload?.mode, permission: event.payload?.permission });
        }
        return { session };
      }
      case "session.continue": {
        const requestedModelProvider = typeof event.payload?.modelProvider === "string"
          ? event.payload.modelProvider.trim()
          : "";
        const requestedModelId = typeof event.payload?.modelId === "string"
          ? event.payload.modelId.trim()
          : "";
        const hasCompleteRequestedModel = Boolean(
          requestedModelProvider && requestedModelId,
        );
        console.log("[IPC] session.continue payload:", JSON.stringify({
          sessionId: event.payload?.sessionId,
          textLen: event.payload?.text?.length || event.payload?.prompt?.length || 0,
          mode: event.payload?.mode,
          modelProvider: hasCompleteRequestedModel
            ? requestedModelProvider
            : undefined,
          modelId: hasCompleteRequestedModel ? requestedModelId : undefined,
          attachmentIds: event.payload?.attachmentIds,
          attachmentCount: event.payload?.attachments?.length,
        }));
        const result = await h("POST", "/api/prompt", {
          sessionId: event.payload?.sessionId,
          text: event.payload?.text || event.payload?.prompt || "",
          mode: event.payload?.mode || "craft",
          permission: event.payload?.permission || "default",
          modelProvider: hasCompleteRequestedModel
            ? requestedModelProvider
            : undefined,
          modelId: hasCompleteRequestedModel ? requestedModelId : undefined,
          attachmentIds: event.payload?.attachmentIds || [],
          attachments: event.payload?.attachments,
          preferredConnectors: event.payload?.preferredConnectors,
          preferredConnector: event.payload?.preferredConnector,
          preferredConnectorKind: event.payload?.preferredConnectorKind,
          displayText: event.payload?.displayText,
          attachmentAnchors: event.payload?.attachmentAnchors,
          selectedSkillNames: event.payload?.selectedSkillNames,
          selectedExpertId: event.payload?.selectedExpertId,
          testingPublishField: event.payload?.testingPublishField,
        });
        return result;
      }
      case "session.stop":
        await h("POST", "/api/abort", { sessionId: event.payload?.sessionId });
        return { ok: true };
      case "session.list":
        return { sessions: await h("GET", "/api/conv") };
      case "session.getMessages":
        return await h("GET", `/api/msgs/${event.payload?.sessionId}`);
      case "permission.response":
        await h("POST", "/api/confirm", { requestId: event.payload?.toolUseId, approved: event.payload?.result==="allow" });
        return { ok: true };
      default:
        return { error: "unknown event" };
    }
  }
}

// ── 内部：通过 handleApi 调用应用逻辑 ──
async function _callApi(method: string, path: string, body?: any, tapdTrustedIpc = false): Promise<any> {
  const operation = startOperation("api.request", {
    method,
    route: path.split("?")[0],
    ...(path === "/api/settings/keys" && typeof body?.provider === "string"
      ? { provider: body.provider }
      : {}),
  });
  if (!_handleApi) {
    const error = new Error("handleApi not initialized");
    operation.error(error);
    throw error;
  }
  const req: any = {
    method,
    tapdTrustedIpc,
    url: `http://127.0.0.1:${_serverPort}${path}`,
    headers: new Map([["content-type","application/json"]]),
    json: () => Promise.resolve(body),
    signal: { addEventListener: () => {} },
    on: () => {},
  };
  try {
    const result = await _handleApi(req, path);
    if (result instanceof Response) {
      const decoded = await decodeApiResponse(result);
      operation.success({ response: "ok" });
      return decoded;
    }
    operation.success({ response: "ok" });
    return result;
  } catch (error) {
    operation.error(error);
    throw error;
  }
}
