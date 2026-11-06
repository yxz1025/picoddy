import { createHash } from "node:crypto";
import { createWriteStream } from "node:fs";
import { lstat, mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { pipeline } from "node:stream/promises";
import { resolve, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const LOCK_PATH = join(ROOT, "resources", "runtimes", "runtime-lock.json");
export const RUNTIME_CACHE_ROOT = join(ROOT, "resources", "runtimes", "cache");
const STAGING_ROOT = join(ROOT, "build", "runtime-staging");
const MAX_DOWNLOAD_BYTES = 512 * 1024 * 1024;

function fail(code, message) {
  throw new Error(`${code}: ${message}`);
}

export function parseRuntimeArgs(argv) {
  const result = { offline: false };
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag === "--offline") {
      result.offline = true;
      continue;
    }
    if (flag === "--current") {
      if (result.current) fail("RUNTIME_ARGS_INVALID", "--current must occur once");
      result.current = true;
      continue;
    }
    if (flag !== "--platform" && flag !== "--arch") fail("RUNTIME_ARGS_INVALID", `unknown argument ${flag}`);
    const value = argv[++index];
    if (!value || result[flag.slice(2)]) fail("RUNTIME_ARGS_INVALID", `${flag} must occur once with a value`);
    result[flag.slice(2)] = value;
  }
  if (result.current) {
    result.platform = process.platform;
    result.arch = process.arch;
  }
  if (!result.platform || !result.arch) fail("RUNTIME_ARGS_INVALID", "--platform and --arch are required");
  if (!/^(darwin|win32)$/u.test(result.platform) || !/^(arm64|ia32|x64)$/u.test(result.arch)) {
    fail("RUNTIME_PLATFORM_UNSUPPORTED", `${result.platform}-${result.arch}`);
  }
  return result;
}

function validateLock(lock) {
  if (lock?.schemaVersion !== 1 || lock?.python?.platforms === undefined) fail("RUNTIME_LOCK_INVALID", "unsupported runtime lock");
  return lock;
}

export function isMainModule(moduleUrl, scriptPath = process.argv[1]) {
  return Boolean(scriptPath) && moduleUrl === pathToFileURL(resolve(scriptPath)).href;
}

export function describeDownloadError(error) {
  const message = error instanceof Error ? error.message : String(error);
  const cause = error?.cause;
  if (!cause) return message;
  const causeMessage = cause instanceof Error ? cause.message : String(cause);
  const causeCode = typeof cause?.code === "string" ? `${cause.code}: ` : "";
  return `${message}; cause=${causeCode}${causeMessage}`;
}

async function sha256(path) {
  const hash = createHash("sha256");
  const file = await import("node:fs").then(({ createReadStream }) => createReadStream(path));
  await new Promise((resolvePromise, reject) => {
    file.on("data", (chunk) => hash.update(chunk));
    file.on("error", reject);
    file.on("end", resolvePromise);
  });
  return hash.digest("hex");
}

async function verifyArchive(path, entry) {
  const info = await lstat(path).catch(() => undefined);
  if (!info?.isFile() || info.isSymbolicLink()) fail("RUNTIME_ARCHIVE_MISSING", "archive is not an ordinary file");
  if (info.size !== entry.size) fail("RUNTIME_ARCHIVE_DIGEST_MISMATCH", `size ${info.size} != ${entry.size}`);
  const actual = await sha256(path);
  if (actual !== entry.sha256) fail("RUNTIME_ARCHIVE_DIGEST_MISMATCH", `sha256 ${actual} != ${entry.sha256}`);
}

async function download(url, destination, expectedSize) {
  let response;
  try {
    response = await fetch(url, { redirect: "follow" });
  } catch (error) {
    fail("RUNTIME_DOWNLOAD_FAILED", `request failed for ${url}: ${describeDownloadError(error)}`);
  }
  if (!response.ok || !response.body) fail("RUNTIME_DOWNLOAD_FAILED", `HTTP ${response.status}`);
  const finalHost = new URL(response.url).hostname;
  if (!new Set(["github.com", "objects.githubusercontent.com", "release-assets.githubusercontent.com"]).has(finalHost)) {
    fail("RUNTIME_DOWNLOAD_INVALID", `unexpected redirect host ${finalHost}`);
  }
  const contentLength = Number(response.headers.get("content-length") ?? 0);
  if (contentLength > MAX_DOWNLOAD_BYTES || (contentLength > 0 && contentLength !== expectedSize)) {
    fail("RUNTIME_DOWNLOAD_INVALID", "content length does not match lock");
  }
  await mkdir(resolve(destination, ".."), { recursive: true });
  const temporary = `${destination}.${process.pid}.${Date.now()}.download`;
  try {
    await pipeline(response.body, createWriteStream(temporary, { flags: "wx", mode: 0o600 }));
    await rename(temporary, destination);
  } catch (error) {
    await rm(temporary, { force: true }).catch(() => undefined);
    throw error;
  }
}

export async function prepareRuntime(argv = process.argv.slice(2)) {
  const target = parseRuntimeArgs(argv);
  const lock = validateLock(JSON.parse(await readFile(LOCK_PATH, "utf8")));
  const key = `${target.platform}-${target.arch}`;
  const entry = lock.python.platforms[key];
  if (!entry) fail("RUNTIME_PLATFORM_UNSUPPORTED", key);
  const cachePath = join(RUNTIME_CACHE_ROOT, entry.archive);
  const cached = await lstat(cachePath).catch(() => undefined);
  if (!cached) {
    if (target.offline) fail("RUNTIME_ARCHIVE_MISSING", cachePath);
    await download(entry.url, cachePath, entry.size);
  }
  await verifyArchive(cachePath, entry);
  const temporary = `${STAGING_ROOT}.${process.pid}.${Date.now()}.tmp`;
  await rm(temporary, { recursive: true, force: true });
  await mkdir(temporary, { recursive: true, mode: 0o700 });
  await import("node:fs/promises").then(({ copyFile }) => copyFile(cachePath, join(temporary, "python.dat")));
  const manifest = {
    schemaVersion: 1,
    platform: target.platform,
    arch: target.arch,
    key,
    python: {
      version: lock.python.version,
      archiveFile: "python.dat",
      archiveRoot: entry.archiveRoot,
      archiveFormat: entry.format,
      archiveSha256: entry.sha256,
      archiveBytes: entry.size,
      executable: entry.executable,
    },
  };
  await writeFile(join(temporary, "runtime-manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 });
  await rm(STAGING_ROOT, { recursive: true, force: true });
  await rename(temporary, STAGING_ROOT);
  return manifest;
}

if (isMainModule(import.meta.url)) {
  prepareRuntime().then((manifest) => {
    process.stdout.write(`${JSON.stringify(manifest)}\n`);
  }).catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
