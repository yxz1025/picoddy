import { createHash } from "node:crypto";
import { constants, lstat, mkdir, open, rm } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

import Pizzip from "pizzip";

import { ConnectorError } from "./errors.ts";

const MAX_ARCHIVE_BYTES = 64 * 1024 * 1024;
const MAX_FILES = 1024;
const MAX_DEPTH = 16;
const MAX_FILE_BYTES = 8 * 1024 * 1024;
const MAX_TOTAL_BYTES = 64 * 1024 * 1024;
const MAX_READ_CHUNK = 64 * 1024;

export interface ExtractConnectorSkillOptions {
  readonly packageRoot: string;
  readonly archive: string;
  readonly entry: string;
  readonly destination: string;
}

export interface ExtractConnectorSkillResult {
  readonly entryPath: string;
  readonly fileCount: number;
  readonly skillDigest: string;
}

interface PizZipEntryMeta {
  readonly _data?: { readonly uncompressedSize?: number };
}

interface PendingEntry {
  readonly rawName: string;
  readonly name: string;
  readonly dir: boolean;
  readonly size: number;
}

function invalidArchive(): never {
  throw new ConnectorError("SKILL_ARCHIVE_INVALID", "Connector skill archive is invalid");
}

function isInside(root: string, target: string): boolean {
  const rel = relative(root, target);
  return rel === "" || (rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel));
}

// Returns the slash-normalized relative path, or undefined when unsafe.
function normalizeZipPath(name: string): string | undefined {
  if (name.includes("\\") || /^[A-Za-z]:/u.test(name) || name.startsWith("/")) return undefined;
  const segments = name.split("/");
  const normalized: string[] = [];
  for (const segment of segments) {
    if (segment === "" || segment === ".") continue;
    if (segment === "..") return undefined;
    normalized.push(segment);
  }
  if (normalized.length === 0) return undefined;
  return normalized.join("/");
}

async function readBoundedFile(path: string, limit: number): Promise<Buffer> {
  const stat = await lstat(path).catch(() => undefined);
  if (!stat || stat.isSymbolicLink() || !stat.isFile() || stat.size > limit) invalidArchive();
  const noFollow = constants.O_NOFOLLOW;
  const flags = typeof noFollow === "number" && noFollow !== 0 ? constants.O_RDONLY | noFollow : constants.O_RDONLY;
  const handle = await open(path, flags).catch(invalidArchive);
  try {
    const chunks: Buffer[] = [];
    let total = 0;
    while (true) {
      const capacity = Math.min(MAX_READ_CHUNK, limit + 1 - total);
      if (capacity <= 0) invalidArchive();
      const chunk = Buffer.allocUnsafe(capacity);
      const { bytesRead } = await handle.read(chunk, 0, chunk.length, null).catch(invalidArchive);
      if (bytesRead === 0) break;
      total += bytesRead;
      if (total > limit) invalidArchive();
      chunks.push(chunk.subarray(0, bytesRead));
    }
    return Buffer.concat(chunks, total);
  } finally {
    await handle.close().catch(() => undefined);
  }
}

function validSkillFrontmatter(content: Buffer): boolean {
  const text = content.toString("utf8");
  const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/u.exec(text);
  if (!match) return false;
  return /^name:\s*\S+/mu.test(match[1]);
}

export async function extractConnectorSkill(
  options: ExtractConnectorSkillOptions,
): Promise<ExtractConnectorSkillResult> {
  const packageRoot = resolve(options.packageRoot);
  const archiveRelative = normalizeZipPath(options.archive);
  const entryRelative = normalizeZipPath(options.entry);
  if (archiveRelative === undefined || entryRelative === undefined) invalidArchive();
  const archivePath = join(packageRoot, archiveRelative);
  if (!isInside(packageRoot, archivePath)) invalidArchive();
  const destination = resolve(options.destination);

  const archiveBytes = await readBoundedFile(archivePath, MAX_ARCHIVE_BYTES);
  let zip: Pizzip;
  try {
    zip = new Pizzip(archiveBytes);
  } catch {
    invalidArchive();
  }

  const seen = new Set<string>();
  const pending: PendingEntry[] = [];
  let fileCount = 0;
  let totalBytes = 0;
  for (const rawName of Object.keys(zip.files)) {
    const file = zip.files[rawName];
    const normalized = normalizeZipPath(rawName);
    if (normalized === undefined || seen.has(normalized)) invalidArchive();
    seen.add(normalized);
    if (normalized.split("/").length > MAX_DEPTH) invalidArchive();
    if (file.dir) {
      pending.push({ rawName, name: normalized, dir: true, size: 0 });
      continue;
    }
    const permissions = typeof file.unixPermissions === "number" ? file.unixPermissions : NaN;
    if (Number.isFinite(permissions) && (permissions & 0o170000) === 0o120000) invalidArchive();
    const size = (file as unknown as PizZipEntryMeta)._data?.uncompressedSize;
    if (typeof size !== "number" || !Number.isFinite(size) || size < 0) invalidArchive();
    if (size > MAX_FILE_BYTES) invalidArchive();
    totalBytes += size;
    if (totalBytes > MAX_TOTAL_BYTES) invalidArchive();
    fileCount += 1;
    if (fileCount > MAX_FILES) invalidArchive();
    pending.push({ rawName, name: normalized, dir: false, size });
  }
  if (fileCount === 0 || !seen.has(entryRelative)) invalidArchive();

  await rm(destination, { recursive: true, force: true });
  await mkdir(destination, { recursive: true });
  let entryBuffer: Buffer | undefined;
  for (const entry of pending) {
    const target = join(destination, entry.name);
    if (!isInside(destination, target)) invalidArchive();
    if (entry.dir) {
      await mkdir(target, { recursive: true }).catch(invalidArchive);
      continue;
    }
    const file = zip.files[entry.rawName];
    let content: Buffer;
    try {
      content = file.asNodeBuffer();
    } catch {
      invalidArchive();
    }
    if (content.length > MAX_FILE_BYTES || content.length !== entry.size) invalidArchive();
    await mkdir(dirname(target), { recursive: true }).catch(invalidArchive);
    const handle = await open(target, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY, 0o600).catch(invalidArchive);
    try {
      await handle.writeFile(content).catch(invalidArchive);
      await handle.sync().catch(invalidArchive);
    } finally {
      await handle.close().catch(() => undefined);
    }
    if (entry.name === entryRelative) entryBuffer = content;
  }

  if (entryBuffer === undefined || !validSkillFrontmatter(entryBuffer)) invalidArchive();
  const skillDigest = createHash("sha512").update(entryBuffer).digest("hex");
  return {
    entryPath: join(destination, entryRelative),
    fileCount,
    skillDigest,
  };
}
