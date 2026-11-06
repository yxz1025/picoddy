import { mkdir, rename, rm, stat, statfs } from "node:fs/promises";
import { createWriteStream } from "node:fs";
import { join } from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { UpdateConfig, Release } from "./types.ts";
import type { UpdateDriver } from "./manager.ts";
import { parseRelease, sameRelease, trustedUrl } from "./policy.ts";
import { digestFile } from "./storage.ts";
import { launchWindowsInstaller } from "./windows-install.ts";

export async function requireSpace(path: string, bytes: number): Promise<void> {
  const disk = await statfs(path);
  if (disk.bavail * disk.bsize < bytes) throw new Error("DISK_SPACE");
}
export function feedFilename(config: UpdateConfig): string {
  return `${config.channel === "beta" ? "beta" : "latest"}${config.platform === "darwin" ? "-mac" : ""}.yml`;
}
export async function fetchRelease(config: UpdateConfig, version: string, identity: string, signal: AbortSignal): Promise<Release | null> {
  const url = trustedUrl(feedFilename(config), config.feedUrl);
  // Redirects are rejected: the trusted company origin is the sole release authority.
  const response = await fetch(url, { signal, redirect: "error", headers: { "Cache-Control": "no-cache" } });
  if (!response.ok) throw new Error("NETWORK");
  const chunks: Uint8Array[] = []; let size = 0;
  if (!response.body) throw new Error("MANIFEST_INVALID");
  for await (const chunk of response.body) {
    size += chunk.byteLength;
    if (size > 1024 * 1024) throw new Error("MANIFEST_INVALID");
    chunks.push(chunk);
  }
  return parseRelease(Buffer.concat(chunks).toString("utf8"), config, version, identity);
}

export async function createDriver(options: { config: UpdateConfig; version: string; identity: string; root: string;
  beforeQuit: () => void; openFile: (path: string) => Promise<string>; quit: () => void }): Promise<UpdateDriver> {
  const { config } = options;
  const check = (signal: AbortSignal) => fetchRelease(config, options.version, options.identity, signal);
  if (config.platform === "win32" && config.channel !== "manual-managed") {
    const imported = await import("electron-updater");
    const { NsisUpdater } = imported.default ?? imported;
    // 6.8.9 quitAndInstall quits before asynchronous launch/UAC errors settle.
    // Keep its verified cache and download implementation; acknowledge launch
    // before exiting so a rejected UAC prompt can release the database gate.
    class AwaitableNsisUpdater extends NsisUpdater {
      async checkCacheSpace(bytes: number) {
        await mkdir(this.app.baseCachePath, { recursive: true });
        await requireSpace(this.app.baseCachePath, bytes);
      }
      async launchVerified(file: string) {
        if (this.installerPath !== file || !this.downloadedUpdateHelper?.downloadedFileInfo || this.downloadedUpdateHelper.packageFile) {
          throw new Error("INSTALL_PERMISSION");
        }
        await launchWindowsInstaller(file, config.scope === "machine" || this.downloadedUpdateHelper.downloadedFileInfo.isAdminRightsRequired);
      }
    }
    const updater = new AwaitableNsisUpdater({ provider: "generic", url: config.feedUrl, channel: config.channel === "beta" ? "beta" : "latest" });
    updater.autoDownload = false;
    updater.autoInstallOnAppQuit = false;
    updater.allowDowngrade = false;
    updater.allowPrerelease = config.channel === "beta";
    updater.disableWebInstaller = true;
    // Explicit unsigned product policy; HTTPS + SHA-512 are still mandatory.
    updater.verifyUpdateCodeSignature = async () => null;
    // Eligibility is enforced by the strict platform/scope policy above using a persisted bucket.
    updater.isUserWithinRollout = async () => true;
    updater.on("error", () => {}); // handled by awaited check/download or journal after process exit
    let activePath: string | undefined;
    return {
      check,
      async download(release, signal, progress) {
        signal.throwIfAborted();
        if (!sameRelease(release, await check(signal))) throw new Error("VERSION_MISMATCH");
        const result = await updater.checkForUpdates();
        signal.throwIfAborted();
        if (!result || result.updateInfo.version !== release.version ||
            !result.updateInfo.files.some((file) => file.sha512 === release.sha512 && trustedUrl(file.url, config.feedUrl).href === release.url)) throw new Error("VERSION_MISMATCH");
        const cancel = () => result.cancellationToken?.cancel();
        const onProgress = (event: { transferred: number; total: number }) => progress(event.transferred, event.total);
        signal.addEventListener("abort", cancel, { once: true }); updater.on("download-progress", onProgress);
        try {
          await mkdir(options.root, { recursive: true });
          await updater.checkCacheSpace(release.size * 2 + 256 * 1024 * 1024);
          const files = await updater.downloadUpdate(result.cancellationToken);
          signal.throwIfAborted(); activePath = files[0]; return activePath;
        } finally { signal.removeEventListener("abort", cancel); updater.removeListener("download-progress", onProgress); }
      },
      async install(path) {
        if (!activePath || path !== activePath) throw new Error("INSTALL_PERMISSION");
        await updater.launchVerified(path);
        options.beforeQuit(); options.quit();
      },
    };
  }
  // Unsigned macOS is deliberately manual: Squirrel.Mac cannot install unsigned applications.
  return {
    check,
    async download(release, signal, progress) {
      const cache = join(options.root, "packages");
      await mkdir(cache, { recursive: true, mode: 0o700 });
      const destination = join(cache, `${release.releaseId}.dmg`);
      try {
        if ((await stat(destination)).size === release.size && await digestFile(destination) === release.sha512) return destination;
      } catch { /* download below */ }
      await requireSpace(cache, release.size * 2 + release.unpackedSize + 256 * 1024 * 1024);
      const response = await fetch(release.url, { signal, redirect: "error" });
      if (!response.ok || !response.body) throw new Error("NETWORK");
      const temp = `${destination}.part`;
      let transferred = 0;
      try {
        await pipeline(Readable.fromWeb(response.body as any), new Transform({ transform(chunk, _encoding, done) {
          transferred += chunk.length;
          if (transferred > release.size) { done(new Error("SIGNATURE_INVALID")); return; }
          progress(transferred, release.size); done(null, chunk);
        } }), createWriteStream(temp, { mode: 0o600 }), { signal });
        if (transferred !== release.size || await digestFile(temp) !== release.sha512) throw new Error("SIGNATURE_INVALID");
        await rename(temp, destination); return destination;
      } finally { await rm(temp, { force: true }); }
    },
    async install(path) {
      if (await options.openFile(path)) throw new Error("INSTALL_PERMISSION");
      options.beforeQuit(); options.quit();
    },
  };
}
