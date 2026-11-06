import { app, ipcMain, shell, dialog, powerMonitor, type BrowserWindow, type IpcMainInvokeEvent } from "electron";
import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { platformPaths } from "../../platform/paths.ts";
import { updateGate } from "../../infra/update-gate.ts";
import { UpdateManager } from "./manager.ts";
import { Journal } from "./journal.ts";
import { installationId, readJson } from "./storage.ts";
import { validateConfig } from "./policy.ts";
import { createDriver, requireSpace } from "./driver.ts";
import type { UpdateConfig, UpdateSnapshot } from "./types.ts";
import { openExternalSafely, openPathSafely } from "../safe-shell-open.ts";

export async function createUpdateRuntime(options: { window: () => BrowserWindow | null; setQuitting: (value: boolean) => void; applicationOrigin: () => string | null }) {
  const root = join(platformPaths.appDataDir, "updates");
  mkdirSync(root, { recursive: true, mode: 0o700 });
  const journal = new Journal(root);
  let boot: ReturnType<Journal["boot"]>;
  try { boot = journal.boot(app.getVersion()); } catch { boot = "recovery"; }
  let config: UpdateConfig | undefined;
  const configPath = join(app.isPackaged ? process.resourcesPath : app.getAppPath(), "update-config.json");
  try {
    const value = readJson(configPath);
    if (value && app.isPackaged) config = validateConfig(value, process.platform, process.arch);
  } catch { /* A bad release configuration must not prevent opening user data. */ }
  let databaseFrozen = false;
  let paused = false;
  const identity = installationId(root);
  function record(event: string, snapshot: UpdateSnapshot) {
    const value = { event, at: new Date().toISOString(), installId: identity, version: app.getVersion(),
      releaseId: snapshot.releaseId, platform: process.platform, arch: process.arch, scope: config?.scope,
      error: snapshot.error?.code };
    const path = join(root, "events.jsonl");
    try {
      if (existsSync(path) && statSync(path).size > 2 * 1024 * 1024) renameSync(path, join(root, "events.previous.jsonl"));
      appendFileSync(path, `${JSON.stringify(value)}\n`, { mode: 0o600 });
    } catch { /* Logging is best effort; journal is separately durable. */ }
    if (config?.eventsUrl) void fetch(config.eventsUrl, { method: "POST", redirect: "error", signal: AbortSignal.timeout(10000),
      headers: { "Content-Type": "application/json" }, body: JSON.stringify(value) }).catch(() => {});
  }
  const driver = config && config.channel !== "manual-managed" ? await createDriver({ config, version: app.getVersion(), identity, root,
    beforeQuit: () => options.setQuitting(true), openFile: (file) => openPathSafely(shell.openPath.bind(shell), file, { requireExistingPath: true }), quit: () => app.quit() }) : undefined;
  const manager = new UpdateManager({ version: app.getVersion(), platform: process.platform, arch: process.arch, config, root, driver,
    installMode: process.platform === "darwin" ? "manual" : "automatic", record,
    preparation: {
      async prepare(signal, mode, blockers, release) {
        updateGate.close(); paused = true;
        const scheduler = await import("../../domains/automation/node/scheduler.ts");
        scheduler.stopScheduler();
        if (mode === "now") {
          const { provider } = await import("../../agent/provider.ts");
          await provider.abortAllForUpdate();
        }
        blockers(updateGate.blockers);
        const watch = setInterval(() => blockers(updateGate.blockers), 500);
        try { await updateGate.waitForIdle(signal); } finally { clearInterval(watch); }
        signal.throwIfAborted(); blockers([]);
        const dbPath = join(platformPaths.appDataDir, "pi-a.db");
        await requireSpace(root, (existsSync(dbPath) ? statSync(dbPath).size : 0) * 2 + 256 * 1024 * 1024);
        // Installation volume may differ from download/data volumes.
        await requireSpace(dirname(process.execPath), release.unpackedSize + 256 * 1024 * 1024);
        const { disconnectAllMcpServers } = await import("../../agent/mcp.ts");
        await disconnectAllMcpServers();
        signal.throwIfAborted();
        const { freezeDatabaseForUpdate } = await import("../../infra/db.ts");
        try { const backupId = freezeDatabaseForUpdate(app.getVersion()); databaseFrozen = true; return backupId; }
        catch { throw new Error("BACKUP_FAILED"); }
      },
      async release() {
        options.setQuitting(false);
        if (databaseFrozen) {
          const { resumeDatabaseAfterUpdate } = await import("../../infra/db.ts");
          resumeDatabaseAfterUpdate(); databaseFrozen = false;
        }
        if (paused) {
          updateGate.reopen(); paused = false;
          const { startScheduler } = await import("../../domains/automation/node/scheduler.ts");
          startScheduler(false);
          const { connectAllMcpServers } = await import("../../agent/mcp.ts");
          void connectAllMcpServers().catch(() => {});
        }
      },
      journal(release, backupId) { journal.request(app.getVersion(), release, backupId); },
    },
  });
  const recoveryPage = join(app.getAppPath(), "resources", "startup", "update-recovery.html");
  if (boot === "verifying") manager.bootState("verifying");
  if (boot === "recovery") manager.bootState("recoveryRequired");
  function trusted(event: IpcMainInvokeEvent, channel: string) {
    const window = options.window();
    if (!window || event.sender !== window.webContents || event.senderFrame !== event.sender.mainFrame) throw new Error("Forbidden update sender");
    const url = event.senderFrame?.url ?? "";
    if (url === pathToFileURL(recoveryPage).href && ["update.openLogs", "update.restoreBackup", "update.retryBoot"].includes(channel)) return;
    if (!options.applicationOrigin() || new URL(url).origin !== new URL(options.applicationOrigin()!).origin) throw new Error("Forbidden update origin");
  }
  const handlers: Record<string, (payload?: any) => unknown> = {
    "update.getState": () => manager.getState(),
    "update.check": () => manager.check(),
    "update.download": (p) => { id(p?.releaseId); return manager.download(p.releaseId); },
    "update.cancelDownload": (p) => { id(p?.operationId); return manager.cancelDownload(p.operationId); },
    "update.install": (p) => { id(p?.releaseId); if (!["now", "when-idle"].includes(p.mode)) throw new TypeError("Invalid mode"); return manager.install(p.releaseId, p.mode); },
    "update.defer": (p) => { id(p?.releaseId); return manager.defer(p.releaseId); },
    "update.openReleaseNotes": (p) => { id(p?.releaseId); const url = manager.notesUrl(p.releaseId); if (url) return openExternalSafely(shell.openExternal.bind(shell), url); },
    "update.openLogs": () => openPathSafely(shell.openPath.bind(shell), root, { requireExistingPath: true }),
    "update.health": () => { rendererReady = true; },
    "update.retryBoot": () => { if (boot !== "recovery") throw new Error("Recovery only"); journal.retry(); options.setQuitting(true); app.relaunch(); app.quit(); },
    "update.restoreBackup": async () => {
      if (boot !== "recovery") throw new Error("Recovery only");
      const current = journal.read(); if (!current) throw new Error("No update backup");
      const result = await dialog.showMessageBox(options.window()!, { type: "warning", buttons: ["取消", "恢复数据库"], defaultId: 0, cancelId: 0,
        message: "恢复升级前的数据库？", detail: "备份之后新增的会话和设置将不再出现在恢复后的数据库中。当前数据库会另存备份；附件和工作区文件不会删除。" });
      if (result.response !== 1) return;
      const { restoreBackup } = await import("./recovery.ts");
      restoreBackup(platformPaths.appDataDir, current.backupId, app.getVersion());
      journal.retry(); options.setQuitting(true); app.relaunch(); app.quit();
    },
  };
  function id(value: unknown) { if (typeof value !== "string" || !/^[a-zA-Z0-9._-]{1,160}$/.test(value)) throw new TypeError("Invalid update identifier"); }
  for (const [name, handler] of Object.entries(handlers)) ipcMain.handle(name, (event, payload) => { trusted(event, name); return handler(payload); });
  manager.on("state", (snapshot) => {
    const window = options.window();
    if (window && !window.isDestroyed()) window.webContents.send("update.state", snapshot);
  });
  let rendererReady = false;
  let healthyTimer: ReturnType<typeof setTimeout> | undefined;
  function failure() {
    if (boot !== "verifying") return;
    journal.failed(); boot = "recovery";
    if (healthyTimer) clearTimeout(healthyTimer);
    manager.bootState("recoveryRequired");
    manager.dispose();
    record("recovery-required", manager.getState());
    // Business services may already be running. Restart into the early recovery
    // entry point, where restoring a database cannot race live connections.
    options.setQuitting(true); app.relaunch(); app.quit();
  }
  app.on("render-process-gone", (_event, contents) => { if (contents === options.window()?.webContents) failure(); });
  powerMonitor.on("resume", () => manager.wake());
  app.once("before-quit", () => { manager.dispose(); if (healthyTimer) clearTimeout(healthyTimer); });
  return {
    recoveryRequired: boot === "recovery",
    recoveryPage,
    manager,
    fail: failure,
    async ready() {
      if (boot === "recovery") return;
      if (boot !== "verifying") { manager.start(); void manager.restoreCache(); }
      if (boot === "incomplete") record("install-incomplete", manager.getState());
      if (boot !== "verifying") return;
      // Manifest validation does not unpack Python or require network access.
      try {
        const manifest = JSON.parse(readFileSync(join(process.resourcesPath, "vendor", "runtime-manifest.json"), "utf8"));
        if (manifest.schemaVersion !== 1 || manifest.platform !== process.platform || manifest.arch !== process.arch ||
            manifest.key !== `${process.platform}-${process.arch}` || !manifest.python ||
            statSync(join(process.resourcesPath, "vendor", "python.dat")).size !== manifest.python.archiveBytes) throw new Error("Runtime mismatch");
        const { createDefaultManagedRuntimeService } = await import("../../platform/runtime/index.ts");
        await createDefaultManagedRuntimeService().resolveNode();
        const { getTools } = await import("../../agent/tools/index.ts");
        if (!getTools().some((tool) => tool.name === "read_doc")) throw new Error("Core tool missing");
      } catch { failure(); return; }
      if (boot !== "verifying") return;
      healthyTimer = setTimeout(() => {
        if (!rendererReady) { failure(); return; }
        if (boot !== "verifying") return;
        journal.healthy(); boot = "normal"; manager.bootState("idle"); record("boot-healthy", manager.getState());
        manager.start(); void manager.restoreCache();
      }, 30000);
    },
  };
}
