import { EventEmitter } from "node:events";
import { randomUUID } from "node:crypto";
import { stat } from "node:fs/promises";
import { join } from "node:path";
import { atomicJson, digestFile, readJson } from "./storage.ts";
import { sameRelease } from "./policy.ts";
import type { Release, UpdateConfig, UpdateSnapshot } from "./types.ts";

export interface UpdateDriver {
  check(signal: AbortSignal): Promise<Release | null>;
  download(release: Release, signal: AbortSignal, progress: (bytes: number, total: number) => void): Promise<string>;
  install(path: string, release: Release): Promise<void>;
}
export interface Preparation {
  prepare(signal: AbortSignal, mode: "now" | "when-idle", blockers: (items: string[]) => void, release: Release): Promise<string>;
  release(): Promise<void>;
  journal(release: Release, backupId: string): void;
}
const messages: Record<string, string> = {
  NETWORK: "更新服务暂时不可达，请稍后重试", MANIFEST_INVALID: "更新清单无效，请联系发布管理员",
  ARCH_MISMATCH: "更新包与当前平台或安装范围不匹配", VERSION_MISMATCH: "该更新已撤回或被新版本取代，请重新检查",
  SIGNATURE_INVALID: "安装包完整性校验失败，请重新下载", DISK_SPACE: "磁盘空间不足，请清理后重试",
  BACKUP_FAILED: "数据备份失败，已取消安装", INSTALL_PERMISSION: "无法启动安装，请检查安装目录权限",
  TASK_BUSY: "正在等待任务安全结束", NOT_CONFIGURED: "尚未配置更新服务", BOOT_FAILED: "上次更新未通过启动检查",
};

export class UpdateManager extends EventEmitter {
  private snapshot: UpdateSnapshot;
  private releaseInfo?: Release;
  private downloaded?: string;
  private operation?: AbortController;
  private timer?: ReturnType<typeof setTimeout>;
  private retry = 0;
  private disposed = false;
  private preparing = false;
  private lastCheck = 0;
  constructor(private options: { version: string; platform: string; arch: string; config?: UpdateConfig;
    root: string; driver?: UpdateDriver; preparation: Preparation; installMode: "automatic" | "manual";
    record?: (event: string, snapshot: UpdateSnapshot) => void }) {
    super();
    const { config } = options;
    this.snapshot = { revision: 0, state: "idle", currentVersion: options.version, configured: !!config,
      channel: config?.channel ?? "stable", platform: options.platform, arch: options.arch,
      installScope: config?.scope ?? "unknown", installMode: options.installMode };
  }
  getState(): UpdateSnapshot { return structuredClone(this.snapshot); }
  bootState(state: "verifying" | "recoveryRequired" | "idle") {
    this.set({ state, error: state === "recoveryRequired"
      ? { code: "BOOT_FAILED", message: messages.BOOT_FAILED, retryable: false } : undefined });
  }
  private set(patch: Partial<UpdateSnapshot>) {
    this.snapshot = { ...this.snapshot, ...patch, revision: this.snapshot.revision + 1 };
    this.emit("state", this.getState());
  }
  private error(error: unknown, state: UpdateSnapshot["state"]) {
    const code = error instanceof Error && messages[error.message] ? error.message : "NETWORK";
    this.set({ state, blockedBy: undefined, operationId: undefined, error: { code, message: messages[code], retryable: !["ARCH_MISMATCH", "MANIFEST_INVALID"].includes(code) } });
    this.options.record?.("error", this.getState());
  }
  private begin(): AbortController {
    this.operation?.abort();
    this.operation = new AbortController();
    this.set({ operationId: randomUUID(), error: undefined });
    return this.operation;
  }
  private active(op: AbortController) { return this.operation === op && !op.signal.aborted && !this.disposed; }
  private persistCache() {
    atomicJson(join(this.options.root, "download.json"), { release: this.releaseInfo, file: this.downloaded });
  }
  async restoreCache(): Promise<void> {
    const revision = this.snapshot.revision;
    try {
      const saved = readJson<{ release: Release; file: string }>(join(this.options.root, "download.json"));
      if (!saved?.release || !saved.file || !this.options.driver) return;
      // Never rehydrate installer internals or trust a saved executable path. The driver owns cache reuse.
      const current = await this.options.driver.check(AbortSignal.timeout(15000));
      if (!this.disposed && this.snapshot.revision === revision && sameRelease(saved.release, current)) {
        this.releaseInfo = current!;
        this.set({ state: "available", targetVersion: current!.version, releaseId: current!.releaseId, releaseNotes: current!.notes });
      }
    } catch { /* An offline start must still open the app. */ }
  }
  async check(): Promise<UpdateSnapshot> {
    if (this.disposed || this.preparing || !["idle", "available", "ready"].includes(this.snapshot.state)) return this.getState();
    if (!this.options.driver) { this.error(new Error("NOT_CONFIGURED"), "idle"); return this.getState(); }
    if (Date.now() - this.lastCheck < 5000) return this.getState();
    this.lastCheck = Date.now();
    const previous = this.snapshot.state;
    const op = this.begin();
    this.set({ state: "checking" });
    try {
      const result = await this.options.driver.check(AbortSignal.any([op.signal, AbortSignal.timeout(15000)]));
      if (!this.active(op)) return this.getState();
      const keep = this.releaseInfo && sameRelease(this.releaseInfo, result) && !!this.downloaded;
      this.releaseInfo = result ?? undefined;
      if (!keep) this.downloaded = undefined;
      this.set({ state: result ? (keep ? "ready" : "available") : "idle", targetVersion: result?.version,
        releaseId: result?.releaseId, releaseNotes: result?.notes, progress: undefined,
        lastCheckedAt: new Date().toISOString(), operationId: undefined });
      this.retry = 0;
      this.options.record?.("check", this.getState());
    } catch (error) {
      if (this.active(op)) {
        this.error(error, previous);
        if (this.snapshot.error?.code === "NETWORK" && this.retry < 3) this.schedule([60000, 300000, 1800000][this.retry++]);
      }
    }
    return this.getState();
  }
  async download(releaseId: string): Promise<UpdateSnapshot> {
    if (this.preparing || this.snapshot.state !== "available" || this.releaseInfo?.releaseId !== releaseId || !this.options.driver) return this.getState();
    const target = this.releaseInfo;
    const op = this.begin(); this.set({ state: "downloading" });
    try {
      const file = await this.options.driver.download(target, op.signal, (transferred, total) => {
        if (this.active(op)) this.set({ progress: { transferred, total, percent: total > 0 ? Math.min(100, transferred / total * 100) : 0 } });
      });
      if (!this.active(op)) return this.getState();
      if ((await stat(file)).size !== target.size || await digestFile(file) !== target.sha512) throw new Error("SIGNATURE_INVALID");
      if (!this.active(op)) return this.getState();
      this.downloaded = file; this.persistCache();
      this.set({ state: "ready", operationId: undefined }); this.options.record?.("download", this.getState());
    } catch (error) { if (this.active(op)) this.error(error, "available"); }
    return this.getState();
  }
  cancelDownload(operationId: string): UpdateSnapshot {
    if (this.snapshot.state === "downloading" && this.snapshot.operationId === operationId) {
      this.operation?.abort(); this.set({ state: "available", operationId: undefined, progress: undefined });
    }
    return this.getState();
  }
  async install(releaseId: string, mode: "now" | "when-idle"): Promise<UpdateSnapshot> {
    if (this.preparing || this.snapshot.state !== "ready" || !this.downloaded || this.releaseInfo?.releaseId !== releaseId || !this.options.driver) return this.getState();
    this.preparing = true;
    const target = this.releaseInfo, file = this.downloaded;
    const op = this.begin(); this.set({ state: "waitingForIdle" });
    try {
      const backupId = await this.options.preparation.prepare(op.signal, mode, (blockedBy) => {
        if (this.active(op)) this.set({ blockedBy, state: blockedBy.length ? "waitingForIdle" : "preparing" });
      }, target);
      op.signal.throwIfAborted();
      if (!sameRelease(target, await this.options.driver.check(AbortSignal.any([op.signal, AbortSignal.timeout(15000)])))) throw new Error("VERSION_MISMATCH");
      if ((await stat(file)).size !== target.size || await digestFile(file) !== target.sha512) throw new Error("SIGNATURE_INVALID");
      op.signal.throwIfAborted();
      this.options.preparation.journal(target, backupId);
      this.set({ state: "installing", blockedBy: undefined });
      this.options.record?.("install-request", this.getState());
      await this.options.driver.install(file, target);
    } catch (error) {
      if (this.active(op)) {
        // A bad/missing cache must expose Download again, rather than trapping
        // the user in Ready with an installer that can never pass validation.
        const invalidCache = error instanceof Error && (error.message === "SIGNATURE_INVALID" ||
          (error as NodeJS.ErrnoException).code === "ENOENT");
        if (invalidCache) this.downloaded = undefined;
        this.error(invalidCache ? new Error("SIGNATURE_INVALID") : error, invalidCache ? "available" : "ready");
      }
    } finally {
      try { if (this.getState().state !== "installing") await this.options.preparation.release(); }
      finally { this.preparing = false; }
    }
    return this.getState();
  }
  async defer(releaseId: string): Promise<UpdateSnapshot> {
    if (this.releaseInfo?.releaseId !== releaseId || !["waitingForIdle", "ready"].includes(this.snapshot.state)) return this.getState();
    this.operation?.abort();
    // The in-flight prepare owns cleanup; do not reopen admission before it unwinds.
    if (this.snapshot.state === "ready") return this.getState();
    this.set({ state: "ready", blockedBy: undefined, operationId: undefined });
    return this.getState();
  }
  notesUrl(releaseId: string): string | undefined { return this.releaseInfo?.releaseId === releaseId ? this.releaseInfo.notesUrl : undefined; }
  private schedule(ms: number) {
    if (this.timer) clearTimeout(this.timer);
    if (this.disposed) return;
    this.timer = setTimeout(() => { this.timer = undefined; void this.check().finally(() => {
      if (!this.timer) this.schedule(21600000 * (0.85 + Math.random() * 0.3));
    }); }, ms); this.timer.unref?.();
  }
  start() { if (this.options.driver) this.schedule(30000 + Math.random() * 60000); }
  wake() { if (Date.now() - this.lastCheck > 21600000) this.schedule(1000); }
  dispose() { this.disposed = true; this.operation?.abort(); if (this.timer) clearTimeout(this.timer); }
}
