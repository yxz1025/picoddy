import { createHash } from "node:crypto";
import { lstat, readFile, readdir } from "node:fs/promises";
import { resolve, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const OUTPUT_ROOT = resolve(ROOT, "..", "build", "picoddy");

function fail(code, message) {
  throw new Error(`${code}: ${message}`);
}

async function digest(path) {
  const hash = createHash("sha256");
  const stream = await import("node:fs").then(({ createReadStream }) => createReadStream(path));
  await new Promise((resolvePromise, reject) => {
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", reject);
    stream.on("end", resolvePromise);
  });
  return hash.digest("hex");
}

async function findVendorRoot() {
  const candidates = [
    join(OUTPUT_ROOT, "mac-arm64", "PiCoddy.app", "Contents", "Resources", "vendor"),
    join(OUTPUT_ROOT, "mac", "PiCoddy.app", "Contents", "Resources", "vendor"),
    join(OUTPUT_ROOT, "win-unpacked", "resources", "vendor"),
    join(OUTPUT_ROOT, "linux-unpacked", "resources", "vendor"),
  ];
  for (const candidate of candidates) {
    const info = await lstat(candidate).catch(() => undefined);
    if (info?.isDirectory() && !info.isSymbolicLink()) return candidate;
  }
  fail("RUNTIME_PACKAGE_MISSING", `vendor directory not found below ${OUTPUT_ROOT}`);
}

export async function verifyPackagedRuntime(vendorRoot) {
  vendorRoot ??= await findVendorRoot();
  const manifest = JSON.parse(await readFile(join(vendorRoot, "runtime-manifest.json"), "utf8"));
  if (manifest?.schemaVersion !== 1 || !manifest.key || !manifest.python) fail("RUNTIME_MANIFEST_INVALID", "invalid packaged manifest");
  const archive = join(vendorRoot, "python.dat");
  const archiveInfo = await lstat(archive).catch(() => undefined);
  if (!archiveInfo?.isFile() || archiveInfo.isSymbolicLink()) fail("RUNTIME_PACKAGE_MISSING", "python.dat is missing or not a regular file");
  if (archiveInfo.size !== manifest.python.archiveBytes) fail("RUNTIME_PACKAGE_DIGEST_MISMATCH", "python.dat size differs");
  const actual = await digest(archive);
  if (actual !== manifest.python.archiveSha256) fail("RUNTIME_PACKAGE_DIGEST_MISMATCH", "python.dat SHA-256 differs");
  const entries = await readdir(vendorRoot);
  const foreign = entries.filter((entry) => /python.*\.(?:zip|tar|gz|zst)$/iu.test(entry) && entry !== "python.dat");
  if (foreign.length) fail("RUNTIME_PACKAGE_FOREIGN_ARCHIVE", foreign.join(", "));
  return { ok: true, key: manifest.key, version: manifest.python.version, bytes: archiveInfo.size, sha256: actual };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  verifyPackagedRuntime().then((result) => process.stdout.write(`${JSON.stringify(result)}\n`)).catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
