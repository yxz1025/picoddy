import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { createRequire } from "node:module";
import { chmod, lstat, mkdir, realpath, rename, rm, stat } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import {
  assertOrdinaryFileWithoutSymlink,
  createArchiveBudget,
  readJsonFile,
  validateArchiveEntry,
  verifyArchiveFile,
  writeJsonAtomically,
} from "./archive-verifier.ts";

export interface PackagedPythonManifest {
  version: string;
  archiveFile: string;
  archiveRoot?: string;
  archiveFormat: "tar.gz" | "zip";
  archiveSha256: string;
  archiveBytes: number;
  executable: "bin/python3" | "python.exe";
}

export interface RuntimeProbe {
  version: string;
  machine: string;
  executable: string;
  pointerBits?: number;
}

export interface InstalledRuntimeReceipt {
  schemaVersion: 1;
  version: string;
  platform: string;
  arch: string;
  archiveSha256: string;
  executableRelativePath: string;
  installedAt: string;
}

export interface ActivePythonRuntime {
  schemaVersion: 1;
  version: string;
  archiveSha256: string;
  relativeRoot: string;
}

export interface PythonInstallerOptions {
  platform: string;
  arch: string;
  pythonRoot: string;
  archivePath: string;
  manifest: PackagedPythonManifest;
  extract?: (archivePath: string, destination: string, format: "tar.gz" | "zip") => Promise<void>;
  probe?: (executable: string) => Promise<RuntimeProbe>;
  now?: () => string;
}

export interface ResolvedPythonRuntime {
  executable: string;
  version: string;
  root: string;
  env: NodeJS.ProcessEnv;
}

const installPromises = new Map<string, Promise<ResolvedPythonRuntime>>();

function isInside(root: string, target: string): boolean {
  const path = relative(resolve(root), resolve(target));
  return path !== "" && path !== ".." && !path.startsWith(`..${sep}`) && !isAbsolute(path);
}

function defaultProbe(): (executable: string) => Promise<RuntimeProbe> {
  return (executable) => new Promise((resolveProbe, reject) => {
    execFile(
      executable,
      ["-I", "-c", "import json,platform,sys,struct; print(json.dumps({'version':platform.python_version(),'machine':platform.machine(),'executable':sys.executable,'pointerBits':struct.calcsize('P')*8}))"],
      { timeout: 10_000, windowsHide: true, maxBuffer: 64 * 1024, encoding: "utf8" },
      (error, stdout) => {
        if (error) {
          reject(new Error(`RUNTIME_PROBE_FAILED: ${error.message}`, { cause: error }));
          return;
        }
        try {
          resolveProbe(JSON.parse(stdout) as RuntimeProbe);
        } catch (cause) {
          reject(new Error("RUNTIME_PROBE_INVALID: probe output is not JSON", { cause }));
        }
      },
    );
  });
}

async function defaultExtract(archivePath: string, destination: string, format: "tar.gz" | "zip"): Promise<void> {
  const require = createRequire(import.meta.url);
  if (format === "tar.gz") {
    const tar = require("tar") as { x(options: { file: string; cwd: string; strict: boolean; filter: (name: string, entry: { type?: string; size?: number; linkpath?: string }) => boolean }): Promise<void> };
    const budget = createArchiveBudget();
    await tar.x({
      file: archivePath,
      cwd: destination,
      strict: true,
      filter: (name: string, entry: { type?: string; size?: number; linkpath?: string }) => {
        const kind = entry.type === "File" ? "file" : entry.type === "Directory" ? "directory" : undefined;
        if (kind) {
          validateArchiveEntry(name, kind);
          budget.accept(kind, entry.size ?? 0);
          return true;
        }
        if (entry.type !== "SymbolicLink" || !entry.linkpath || entry.linkpath.includes("\0") || entry.linkpath.startsWith("/")) {
          throw new Error("RUNTIME_ARCHIVE_ENTRY_INVALID: archive contains a special file");
        }
        validateArchiveEntry(name, "file");
        const linkTarget = resolve(destination, dirname(name), entry.linkpath);
        if (!isInside(destination, linkTarget)) throw new Error("RUNTIME_ARCHIVE_ENTRY_INVALID: symlink escapes destination");
        budget.accept("file", 0);
        return true;
      },
    } as never);
    return;
  }
  const unzipper = require("unzipper") as {
    Open: { file(path: string): Promise<{ files: Array<{ type: string; path: string; uncompressedSize?: number; stream(): NodeJS.ReadableStream }> }> };
  };
  const directory = await unzipper.Open.file(archivePath);
  const budget = createArchiveBudget();
  for (const entry of directory.files) {
    const kind = entry.type === "File" ? "file" : entry.type === "Directory" ? "directory" : undefined;
    if (!kind) throw new Error("RUNTIME_ARCHIVE_ENTRY_INVALID: zip contains a link or special file");
    const normalized = validateArchiveEntry(entry.path, kind);
    budget.accept(kind, entry.uncompressedSize ?? 0);
    const entryPath = resolve(destination, normalized);
    if (!isInside(destination, entryPath)) throw new Error("RUNTIME_ARCHIVE_ENTRY_INVALID: zip path escapes destination");
    await mkdir(dirname(entryPath), { recursive: true });
    if (kind === "directory") continue;
    const chunks: Buffer[] = [];
    for await (const chunk of entry.stream() as AsyncIterable<Buffer>) chunks.push(chunk);
    await import("node:fs/promises").then(({ writeFile }) => writeFile(entryPath, Buffer.concat(chunks), { flag: "wx", mode: 0o600 }));
  }
}

async function flattenArchiveRoot(staging: string, archiveRoot: string | undefined): Promise<void> {
  if (!archiveRoot) return;
  const root = resolve(staging, archiveRoot);
  if (!isInside(staging, root)) throw new Error("RUNTIME_ARCHIVE_ENTRY_INVALID: archive root escapes staging");
  const entries = await import("node:fs/promises").then(({ readdir }) => readdir(root));
  for (const entry of entries) {
    await rename(join(root, entry), join(staging, entry));
  }
  await rm(root, { recursive: true, force: true });
}

function assertProbeMatches(options: PythonInstallerOptions, executable: string, probe: RuntimeProbe): void {
  if (probe.version !== options.manifest.version) throw new Error("RUNTIME_VERSION_MISMATCH: Python version differs");
  if (resolve(probe.executable) !== resolve(executable)) throw new Error("RUNTIME_PROBE_INVALID: executable path differs");
  const machine = probe.machine.toLowerCase();
  const expected = `${options.platform}-${options.arch}`;
  const accepted = expected === "darwin-arm64"
    ? ["arm64", "aarch64"]
    : expected === "darwin-x64"
      ? ["x86_64", "amd64"]
      : expected === "win32-ia32"
        ? ["x86", "i386", "i686", "amd64", "x86_64"]
        : expected === "win32-x64" ? ["amd64", "x86_64"] : [];
  if (probe.pointerBits !== undefined && probe.pointerBits !== (options.arch === "ia32" ? 32 : 64)) {
    throw new Error("RUNTIME_ARCH_MISMATCH: Python pointer width differs");
  }
  if (!accepted.includes(machine)) throw new Error("RUNTIME_ARCH_MISMATCH: Python architecture differs");
}

async function validateExisting(options: PythonInstallerOptions): Promise<ResolvedPythonRuntime | undefined> {
  const activePath = join(options.pythonRoot, "active.json");
  const active = await readJsonFile<ActivePythonRuntime>(activePath);
  if (!active || active.schemaVersion !== 1 || active.version !== options.manifest.version
    || active.archiveSha256 !== options.manifest.archiveSha256
    || !isInside(options.pythonRoot, join(options.pythonRoot, active.relativeRoot))) return undefined;
  const root = resolve(options.pythonRoot, active.relativeRoot);
  const receipt = await readJsonFile<InstalledRuntimeReceipt>(join(root, ".runtime.json"));
  if (!receipt || receipt.schemaVersion !== 1 || receipt.version !== active.version
    || receipt.archiveSha256 !== active.archiveSha256 || receipt.platform !== options.platform || receipt.arch !== options.arch) return undefined;
  const executable = resolve(root, options.manifest.executable);
  const info = await lstat(executable).catch(() => undefined);
  if (!info || (!info.isFile() && !info.isSymbolicLink())) return undefined;
  if (info.isSymbolicLink()) {
    const canonical = await realpath(executable).catch(() => undefined);
    if (!canonical || !isInside(root, canonical)) return undefined;
  }
  const probe = await (options.probe ?? defaultProbe())(executable);
  assertProbeMatches(options, executable, probe);
  return { executable, version: options.manifest.version, root, env: {} };
}

async function install(options: PythonInstallerOptions): Promise<ResolvedPythonRuntime> {
  const existing = await validateExisting(options).catch(() => undefined);
  if (existing) return existing;
  await verifyArchiveFile(options.archivePath, {
    size: options.manifest.archiveBytes,
    sha256: options.manifest.archiveSha256,
  });
  await mkdir(join(options.pythonRoot, "versions"), { recursive: true });
  const staging = join(options.pythonRoot, "versions", `.staging-${randomUUID()}`);
  // Publish a new generation: never reuse or overwrite a damaged/in-use directory.
  const versionRoot = join(options.pythonRoot, "versions", `${options.manifest.version}-${options.manifest.archiveSha256.slice(0, 12)}-${randomUUID()}`);
  await mkdir(staging, { recursive: true, mode: 0o700 });
  try {
    await (options.extract ?? defaultExtract)(options.archivePath, staging, options.manifest.archiveFormat);
    await flattenArchiveRoot(staging, options.manifest.archiveRoot);
    const executable = resolve(staging, options.manifest.executable);
    if (!isInside(staging, executable)) throw new Error("RUNTIME_PATH_INVALID: executable escapes staging");
    const info = await lstat(executable);
    if (!info.isFile() && !info.isSymbolicLink()) throw new Error("RUNTIME_EXECUTABLE_MISSING: Python executable is invalid");
    const canonicalExecutable = await realpath(executable);
    const canonicalStaging = await realpath(staging);
    if (!isInside(canonicalStaging, canonicalExecutable)) throw new Error(`RUNTIME_PATH_INVALID: executable symlink escapes staging (${staging} -> ${canonicalExecutable})`);
    if (info.isSymbolicLink() && !(await stat(canonicalExecutable)).isFile()) throw new Error("RUNTIME_EXECUTABLE_MISSING: Python executable target is invalid");
    if (options.platform === "darwin") await chmod(canonicalExecutable, 0o700);
    const probe = await (options.probe ?? defaultProbe())(executable);
    assertProbeMatches(options, executable, probe);
    const receipt: InstalledRuntimeReceipt = {
      schemaVersion: 1,
      version: options.manifest.version,
      platform: options.platform,
      arch: options.arch,
      archiveSha256: options.manifest.archiveSha256,
      executableRelativePath: options.manifest.executable,
      installedAt: (options.now ?? (() => new Date().toISOString()))(),
    };
    await writeJsonAtomically(join(staging, ".runtime.json"), receipt);
    await rename(staging, versionRoot);
    await writeJsonAtomically(join(options.pythonRoot, "active.json"), {
      schemaVersion: 1,
      version: options.manifest.version,
      archiveSha256: options.manifest.archiveSha256,
      relativeRoot: relative(options.pythonRoot, versionRoot).split(sep).join("/"),
    } satisfies ActivePythonRuntime);
    return {
      executable: resolve(versionRoot, options.manifest.executable),
      version: options.manifest.version,
      root: versionRoot,
      env: {},
    };
  } catch (error) {
    await rm(staging, { recursive: true, force: true }).catch(() => undefined);
    throw error;
  }
}

export function ensurePythonRuntime(options: PythonInstallerOptions): Promise<ResolvedPythonRuntime> {
  const key = `${resolve(options.pythonRoot)}\0${options.platform}\0${options.arch}\0${options.manifest.version}\0${options.manifest.archiveSha256}`;
  const current = installPromises.get(key);
  if (current) return current;
  const installPromise = install(options).finally(() => {
    installPromises.delete(key);
  });
  installPromises.set(key, installPromise);
  return installPromise;
}

export function resetPythonInstallerForTests(): void {
  installPromises.clear();
}
