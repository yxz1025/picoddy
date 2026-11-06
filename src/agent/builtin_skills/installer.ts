import { dirname, join, resolve } from "node:path";
import { rm, mkdir, stat, lstat, chmod, rename, truncate, readFile, readdir, open, type FileHandle } from "node:fs/promises";
import type { Stats, Dirent } from "node:fs";

import { platformPaths } from "../../platform/paths.ts";
import type { SupportedPlatform } from "../../platform/runtime.ts";
import { currentPlatform } from "../../platform/runtime.ts";
import {
  type BuiltinSkillManifest,
  getEmbeddedBuiltinSkillsBundle,
  validateBuiltinArchivePath,
  validateBuiltinSkillManifest,
} from "./bundle.ts";

const MARKER_NAME = ".picoddy-builtin-manifest.json";
const MAX_UNCOMPRESSED_BYTES = 64 * 1024 * 1024;

interface InstallerLock {
  assertPathIdentity(): Promise<void>;
  release(): Promise<void>;
}

interface InstallerPlatform {
  os: SupportedPlatform;
  chmod(path: string, mode: number): Promise<void>;
}

export interface BuiltinInstallerPlatformOverrides {
  os?: SupportedPlatform;
  chmod?: (path: string, mode: number) => Promise<void>;
}

function installerPlatform(
  overrides: BuiltinInstallerPlatformOverrides = {},
): InstallerPlatform {
  return {
    os: overrides.os ?? currentPlatform,
    chmod: overrides.chmod ?? ((path, mode) => chmod(path, mode)),
  };
}

interface PayloadFile {
  path: string;
  bytes: Uint8Array;
}

function caseFold(value: string): string {
  return value.toUpperCase().toLowerCase();
}

async function sha256(bytes: Uint8Array): Promise<string> {
  const value = await crypto.subtle.digest(
    "SHA-256",
    Uint8Array.from(bytes).buffer,
  );
  return Buffer.from(value).toString("hex");
}

async function pathInfo(path: string): Promise<Stats | undefined> {
  try {
    return await lstat(path);
  } catch (error) {
    if ((error as { code?: string }).code === "ENOENT") return undefined;
    throw error;
  }
}

async function requirePlainDirectory(
  path: string,
  label: string,
): Promise<void> {
  const info = await pathInfo(path);
  if (!info) throw new Error(`${label} does not exist: ${path}`);
  if (info.isSymbolicLink()) {
    throw new Error(`${label} must not be a symbolic link: ${path}`);
  }
  if (!info.isDirectory()) {
    throw new Error(`${label} must be a directory: ${path}`);
  }
}

async function ensurePlainDirectory(path: string): Promise<void> {
  const absolute = resolve(path);
  const initial = await pathInfo(absolute);
  if (initial?.isSymbolicLink()) {
    throw new Error(
      `Installation root must not be a symbolic link: ${absolute}`,
    );
  }
  if (initial && !initial.isDirectory()) {
    throw new Error(`Installation root must be a directory: ${absolute}`);
  }
  const missing: string[] = [];
  let cursor = absolute;
  while (!(await pathInfo(cursor))) {
    missing.push(cursor);
    const parent = dirname(cursor);
    if (parent === cursor) break;
    cursor = parent;
  }
  const ancestor = await pathInfo(cursor);
  if (!ancestor?.isDirectory() || ancestor.isSymbolicLink()) {
    throw new Error(
      `Installation ancestor must be a plain directory: ${cursor}`,
    );
  }
  for (const directory of missing.reverse()) {
    try {
      await mkdir(directory, { mode: 0o700 });
    } catch (error) {
      if (!((error as { code?: string }).code === "EEXIST")) throw error;
    }
    await requirePlainDirectory(directory, "Installation directory");
  }
  await requirePlainDirectory(absolute, "Installation root");
}

async function decompress(gzip: Uint8Array): Promise<Uint8Array> {
  if (!(gzip instanceof Uint8Array) || gzip.length === 0) {
    throw new Error("Builtin bundle gzip must be a non-empty Uint8Array");
  }
  let stream: ReadableStream<Uint8Array>;
  try {
    stream = new Blob([Uint8Array.from(gzip).buffer]).stream().pipeThrough(
      new DecompressionStream("gzip"),
    );
  } catch (error) {
    throw new Error("Cannot initialize builtin bundle decompression", {
      cause: error,
    });
  }
  const chunks: Uint8Array[] = [];
  let total = 0;
  const reader = stream.getReader();
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      total += value.length;
      if (total > MAX_UNCOMPRESSED_BYTES) {
        await reader.cancel();
        throw new Error("Builtin bundle exceeds the decompression size limit");
      }
      chunks.push(value);
    }
  } catch (error) {
    if (error instanceof Error && error.message.includes("size limit")) {
      throw error;
    }
    throw new Error("Builtin bundle gzip is invalid", { cause: error });
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return bytes;
}

const TAR_BLOCK_SIZE = 512;

function isZeroBlock(block: Uint8Array): boolean {
  return block.every((value) => value === 0);
}

function readTarText(
  header: Uint8Array,
  offset: number,
  length: number,
  label: string,
): string {
  const field = header.subarray(offset, offset + length);
  const nul = field.indexOf(0);
  const content = nul < 0 ? field : field.subarray(0, nul);
  if (nul >= 0 && !field.subarray(nul).every((value) => value === 0)) {
    throw new Error(`Invalid padding in builtin tar ${label}`);
  }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(content);
  } catch (error) {
    throw new Error(`Invalid UTF-8 in builtin tar ${label}`, { cause: error });
  }
}

function readTarOctal(
  header: Uint8Array,
  offset: number,
  length: number,
  label: string,
): number {
  const field = header.subarray(offset, offset + length);
  if ((field[0] & 0x80) !== 0) {
    throw new Error(`Base-256 is not allowed in builtin tar ${label}`);
  }
  const text = new TextDecoder().decode(field).replaceAll("\0", "").trim();
  if (!/^[0-7]+$/.test(text)) {
    throw new Error(`Invalid octal value in builtin tar ${label}`);
  }
  const value = Number.parseInt(text, 8);
  if (!Number.isSafeInteger(value)) {
    throw new Error(`Oversized value in builtin tar ${label}`);
  }
  return value;
}

function verifyTarHeader(header: Uint8Array): void {
  const magic = header.subarray(257, 263);
  const expectedMagic = new Uint8Array([117, 115, 116, 97, 114, 0]);
  if (!magic.every((value, index) => value === expectedMagic[index])) {
    throw new Error("Builtin archive is not a POSIX ustar file");
  }
  if (header[263] !== 0x30 || header[264] !== 0x30) {
    throw new Error("Builtin archive has an unsupported ustar version");
  }
  const expected = readTarOctal(header, 148, 8, "checksum");
  let actual = 0;
  for (let index = 0; index < header.length; index++) {
    actual += index >= 148 && index < 156 ? 0x20 : header[index];
  }
  if (actual !== expected) {
    throw new Error("Builtin tar header checksum mismatch");
  }
}

function expectedDirectories(manifest: BuiltinSkillManifest): Set<string> {
  const directories = new Set<string>();
  for (const file of manifest.files) {
    const segments = file.path.split("/");
    for (let index = 1; index < segments.length; index++) {
      directories.add(segments.slice(0, index).join("/"));
    }
  }
  return directories;
}

async function parsePayload(
  gzip: Uint8Array,
  manifest: BuiltinSkillManifest,
): Promise<PayloadFile[]> {
  const tarBytes = await decompress(gzip);
  if (await sha256(tarBytes) !== manifest.bundleDigest) {
    throw new Error("Builtin bundle digest does not match its manifest");
  }
  if (
    tarBytes.length < TAR_BLOCK_SIZE * 2 || tarBytes.length % TAR_BLOCK_SIZE
  ) {
    throw new Error("Builtin tar must contain complete 512-byte blocks");
  }
  const entries = new Map<
    string,
    { type: "file" | "directory"; bytes: Uint8Array }
  >();
  const foldedPaths = new Set<string>();
  let offset = 0;
  let terminated = false;
  while (offset + TAR_BLOCK_SIZE <= tarBytes.length) {
    const header = tarBytes.subarray(offset, offset + TAR_BLOCK_SIZE);
    if (isZeroBlock(header)) {
      const remainder = tarBytes.subarray(offset);
      if (remainder.length !== TAR_BLOCK_SIZE * 2 || !isZeroBlock(remainder)) {
        throw new Error("Builtin tar must end with exactly two zero blocks");
      }
      terminated = true;
      break;
    }
    verifyTarHeader(header);
    const name = readTarText(header, 0, 100, "name");
    const prefix = readTarText(header, 345, 155, "prefix");
    if (name === "") {
      throw new Error("Builtin tar entry name must not be empty");
    }
    const rawPath = prefix ? `${prefix}/${name}` : name;
    const typeFlag = header[156];
    const type = typeFlag === 0 || typeFlag === 0x30
      ? "file"
      : typeFlag === 0x35
      ? "directory"
      : undefined;
    if (!type) {
      const kind = typeFlag === 0x31
        ? "hardlink"
        : typeFlag === 0x32
        ? "symlink"
        : `special type ${String.fromCharCode(typeFlag)}`;
      throw new Error(`Builtin tar contains forbidden ${kind}: ${rawPath}`);
    }
    if (type === "directory" && !rawPath.endsWith("/")) {
      throw new Error(`Builtin tar directory must end in '/': ${rawPath}`);
    }
    if (type === "file" && rawPath.endsWith("/")) {
      throw new Error(`Builtin tar file must not end in '/': ${rawPath}`);
    }
    const path = validateBuiltinArchivePath(
      type === "directory" ? rawPath.slice(0, -1) : rawPath,
    );
    const folded = caseFold(path);
    if (foldedPaths.has(folded)) {
      throw new Error(`Duplicate builtin tar path: ${path}`);
    }
    foldedPaths.add(folded);
    const linkName = readTarText(header, 157, 100, "linkname");
    if (linkName !== "") {
      throw new Error(`Builtin tar regular entry has a link target: ${path}`);
    }
    const size = readTarOctal(header, 124, 12, "size");
    if (type === "directory" && size !== 0) {
      throw new Error(`Builtin tar directory has content: ${path}`);
    }
    const contentStart = offset + TAR_BLOCK_SIZE;
    const contentEnd = contentStart + size;
    const paddedEnd = contentStart + Math.ceil(size / TAR_BLOCK_SIZE) *
        TAR_BLOCK_SIZE;
    if (contentEnd > tarBytes.length || paddedEnd > tarBytes.length) {
      throw new Error(`Builtin tar entry exceeds archive bounds: ${path}`);
    }
    if (
      !tarBytes.subarray(contentEnd, paddedEnd).every((value) => value === 0)
    ) {
      throw new Error(`Builtin tar entry has non-zero padding: ${path}`);
    }
    entries.set(path, {
      type,
      bytes: tarBytes.slice(contentStart, contentEnd),
    });
    offset = paddedEnd;
  }
  if (!terminated) throw new Error("Builtin tar is missing its terminator");

  const expectedDirectoryPaths = expectedDirectories(manifest);
  const actualDirectoryPaths = [...entries]
    .filter(([, entry]) => entry.type === "directory")
    .map(([path]) => path);
  if (
    actualDirectoryPaths.length !== expectedDirectoryPaths.size ||
    actualDirectoryPaths.some((path) => !expectedDirectoryPaths.has(path))
  ) {
    throw new Error(
      "Builtin tar directory set does not match manifest parents",
    );
  }
  const actualFiles = [...entries]
    .filter(([, entry]) => entry.type === "file")
    .map(([path, entry]) => ({ path, bytes: entry.bytes }))
    .sort((left, right) =>
      left.path < right.path ? -1 : left.path > right.path ? 1 : 0
    );
  if (
    actualFiles.length !== manifest.files.length ||
    actualFiles.some((entry, index) =>
      entry.path !== manifest.files[index].path
    )
  ) {
    throw new Error("Builtin tar regular file set does not match manifest");
  }
  for (let index = 0; index < actualFiles.length; index++) {
    const actual = actualFiles[index];
    const expected = manifest.files[index];
    if (actual.bytes.length !== expected.size) {
      throw new Error(`Size mismatch for builtin bundle path: ${actual.path}`);
    }
    if (await sha256(actual.bytes) !== expected.sha256) {
      throw new Error(
        `SHA-256 mismatch for builtin bundle path: ${actual.path}`,
      );
    }
  }
  return actualFiles;
}

async function writeAll(file: FileHandle, bytes: Uint8Array): Promise<void> {
  let offset = 0;
  while (offset < bytes.length) {
    const { bytesWritten } = await file.write(bytes.subarray(offset));
    if (bytesWritten === 0) {
      throw new Error("Could not finish writing builtin skill file");
    }
    offset += bytesWritten;
  }
}

async function createPlainSubdirectories(
  root: string,
  relativePath: string,
): Promise<void> {
  const segments = relativePath.split("/").slice(0, -1);
  let cursor = root;
  for (const segment of segments) {
    cursor = join(cursor, segment);
    const info = await pathInfo(cursor);
    if (!info) await mkdir(cursor, { mode: 0o700 });
    await requirePlainDirectory(cursor, "Builtin staging directory");
  }
}

async function writeStaging(
  staging: string,
  files: PayloadFile[],
  manifest: BuiltinSkillManifest,
): Promise<void> {
  await mkdir(staging, { mode: 0o700 });
  await requirePlainDirectory(staging, "Builtin staging directory");
  for (const entry of files) {
    await createPlainSubdirectories(staging, entry.path);
    const target = join(staging, ...entry.path.split("/"));
    const file = await open(target, "wx", 0o600);
    try {
      await writeAll(file, entry.bytes);
      await file.sync();
    } finally {
      file.close();
    }
  }
  const markerPath = join(staging, MARKER_NAME);
  const marker = new TextEncoder().encode(
    `${JSON.stringify(manifest, null, 2)}\n`,
  );
  const markerFile = await open(markerPath, "wx", 0o600);
  try {
    await writeAll(markerFile, marker);
    await markerFile.sync();
  } finally {
    markerFile.close();
  }
}

async function scanTree(
  root: string,
  relative = "",
): Promise<Map<string, Stats>> {
  await requirePlainDirectory(root, "Builtin skills directory");
  const result = new Map<string, Stats>();
  const entries: Dirent[] = [];
  for (const entry of await readdir(root, { withFileTypes: true })) entries.push(entry);
  entries.sort((left, right) => left.name < right.name ? -1 : 1);
  for (const entry of entries) {
    const path = relative ? `${relative}/${entry.name}` : entry.name;
    const absolute = join(root, entry.name);
    const info = await lstat(absolute);
    if (info.isSymbolicLink()) {
      throw new Error(`Builtin skills tree contains a symbolic link: ${path}`);
    }
    if (info.isDirectory()) {
      for (const [child, childInfo] of await scanTree(absolute, path)) {
        result.set(child, childInfo);
      }
    } else if (info.isFile()) {
      if (info.nlink !== null && info.nlink > 1) {
        throw new Error(`Builtin skills tree contains a hard link: ${path}`);
      }
      result.set(path, info);
    } else {
      throw new Error(`Builtin skills tree contains a special file: ${path}`);
    }
  }
  return result;
}

async function verifyInstalledTree(
  root: string,
  manifest: BuiltinSkillManifest,
): Promise<void> {
  const actual = await scanTree(root);
  actual.delete(MARKER_NAME);
  if (actual.size !== manifest.files.length) {
    throw new Error(
      "Installed builtin skill file count does not match manifest",
    );
  }
  for (const expected of manifest.files) {
    const info = actual.get(expected.path);
    if (!info) {
      throw new Error(
        `Installed builtin skill file is missing: ${expected.path}`,
      );
    }
    if (info.size !== expected.size) {
      throw new Error(
        `Installed builtin skill size mismatch: ${expected.path}`,
      );
    }
    const bytes = await readFile(join(root, ...expected.path.split("/")));
    if (await sha256(bytes) !== expected.sha256) {
      throw new Error(
        `Installed builtin skill SHA-256 mismatch: ${expected.path}`,
      );
    }
  }
}

async function setTreeReadOnly(
  root: string,
  platform: InstallerPlatform,
): Promise<void> {
  if (platform.os === "windows") return;
  const entries: Dirent[] = [];
  for (const entry of await readdir(root, { withFileTypes: true })) entries.push(entry);
  for (const entry of entries) {
    const absolute = join(root, entry.name);
    const info = await lstat(absolute);
    if (info.isSymbolicLink()) {
      throw new Error(`Cannot protect symbolic link: ${absolute}`);
    }
    if (info.isDirectory()) await setTreeReadOnly(absolute, platform);
    else if (info.isFile()) await platform.chmod(absolute, 0o444);
    else throw new Error(`Cannot protect special file: ${absolute}`);
  }
  await platform.chmod(root, 0o555);
}

async function setTreeWritable(
  root: string,
  platform: InstallerPlatform,
): Promise<void> {
  if (platform.os === "windows") return;
  const info = await pathInfo(root);
  if (!info) return;
  if (info.isSymbolicLink()) {
    throw new Error(`Refusing to modify symbolic link: ${root}`);
  }
  if (!info.isDirectory()) {
    throw new Error(`Expected directory while cleaning: ${root}`);
  }
  await platform.chmod(root, 0o700);
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const absolute = join(root, entry.name);
    const child = await lstat(absolute);
    if (child.isSymbolicLink()) {
      throw new Error(`Refusing to modify symbolic link: ${absolute}`);
    }
    if (child.isDirectory()) await setTreeWritable(absolute, platform);
    else if (child.isFile()) await platform.chmod(absolute, 0o600);
    else throw new Error(`Refusing to modify special file: ${absolute}`);
  }
}

async function removePlainTree(
  path: string,
  platform = installerPlatform(),
): Promise<void> {
  const info = await pathInfo(path);
  if (!info) return;
  if (info.isSymbolicLink()) {
    throw new Error(`Refusing to remove symbolic link: ${path}`);
  }
  if (!info.isDirectory()) {
    throw new Error(`Refusing to remove non-directory: ${path}`);
  }
  await scanTree(path);
  await setTreeWritable(path, platform);
  await rm(path, { recursive: true });
}

async function readVersionManifest(
  version: string,
): Promise<BuiltinSkillManifest> {
  await requirePlainDirectory(version, "Builtin skill version directory");
  const markerPath = join(version, MARKER_NAME);
  const markerInfo = await pathInfo(markerPath);
  if (!markerInfo) {
    throw new Error(`Builtin version manifest is missing: ${markerPath}`);
  }
  if (markerInfo.isSymbolicLink() || !markerInfo.isFile()) {
    throw new Error(
      `Builtin manifest marker must be a regular file: ${markerPath}`,
    );
  }
  if (markerInfo.nlink !== null && markerInfo.nlink > 1) {
    throw new Error(
      `Builtin manifest marker must not be a hard link: ${markerPath}`,
    );
  }
  if (markerInfo.size > 1024 * 1024) {
    throw new Error(`Builtin version manifest is too large: ${markerPath}`);
  }
  try {
    return validateBuiltinSkillManifest(
      JSON.parse(await readFile(markerPath, "utf-8")),
    );
  } catch (error) {
    throw new Error(`Builtin version manifest is invalid: ${markerPath}`, {
      cause: error,
    });
  }
}

interface ActivePointer {
  formatVersion: 1;
  bundleDigest: string;
}

function validateActivePointerInfo(
  info: Stats,
  pointerPath: string,
): void {
  if (
    info.isSymbolicLink() || !info.isFile() ||
    (info.nlink !== null && info.nlink > 1) || info.size > 4096
  ) {
    throw new Error(
      `Builtin active pointer must be a small regular file: ${pointerPath}`,
    );
  }
}

async function readActivePointerHandle(
  file: FileHandle,
  pointerPath: string,
): Promise<string> {
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const buffer = new Uint8Array(Math.min(1024, 4097 - total));
    const { bytesRead } = await file.read(buffer);
    if (bytesRead === 0) break;
    total += bytesRead;
    if (total > 4096) {
      throw new Error(`Builtin active pointer is too large: ${pointerPath}`);
    }
    chunks.push(buffer.subarray(0, bytesRead));
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch (error) {
    throw new Error(`Builtin active pointer is invalid UTF-8: ${pointerPath}`, {
      cause: error,
    });
  }
}

async function readActivePointer(
  root: string,
  optional = false,
): Promise<ActivePointer | undefined> {
  const pointerPath = join(root, "current.json");
  let text: string | undefined;
  for (let attempt = 0; attempt < 8; attempt++) {
    const before = await pathInfo(pointerPath);
    if (!before) {
      if (optional) return undefined;
      throw new Error(`Builtin active pointer is missing: ${pointerPath}`);
    }
    validateActivePointerInfo(before, pointerPath);
    let file: FileHandle;
    try {
      file = await open(pointerPath, "r");
    } catch (error) {
      if ((error as { code?: string }).code === "ENOENT") continue;
      throw error;
    }
    try {
      const opened = await file.stat();
      validateActivePointerInfo(opened, pointerPath);
      const after = await pathInfo(pointerPath);
      if (!after) continue;
      validateActivePointerInfo(after, pointerPath);
      if (
        !sameFileIdentity(opened, before) &&
        !sameFileIdentity(opened, after)
      ) {
        continue;
      }
      text = await readActivePointerHandle(file, pointerPath);
      break;
    } finally {
      file.close();
    }
  }
  if (text === undefined) {
    throw new Error(
      `Builtin active pointer changed too frequently: ${pointerPath}`,
    );
  }
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (error) {
    throw new Error(`Builtin active pointer is invalid: ${pointerPath}`, {
      cause: error,
    });
  }
  if (
    typeof value !== "object" || value === null || Array.isArray(value) ||
    Object.keys(value).sort().join(",") !== "bundleDigest,formatVersion"
  ) {
    throw new Error(
      `Builtin active pointer has an invalid format: ${pointerPath}`,
    );
  }
  const pointer = value as Record<string, unknown>;
  if (
    pointer.formatVersion !== 1 || typeof pointer.bundleDigest !== "string" ||
    !/^[0-9a-f]{64}$/.test(pointer.bundleDigest)
  ) {
    throw new Error(
      `Builtin active pointer has invalid values: ${pointerPath}`,
    );
  }
  return { formatVersion: 1, bundleDigest: pointer.bundleDigest };
}

async function verifyAndProtectVersion(
  version: string,
  platform: InstallerPlatform,
  expectedManifest?: BuiltinSkillManifest,
): Promise<BuiltinSkillManifest> {
  const manifest = await readVersionManifest(version);
  if (
    expectedManifest && manifest.bundleDigest !== expectedManifest.bundleDigest
  ) {
    throw new Error(`Builtin version digest mismatch: ${version}`);
  }
  if (expectedManifest) {
    if (JSON.stringify(manifest) !== JSON.stringify(expectedManifest)) {
      throw new Error(`Builtin version manifest mismatch: ${version}`);
    }
  }
  if (version.split(/[\\/]/).at(-1) !== manifest.bundleDigest) {
    throw new Error(`Builtin version directory digest mismatch: ${version}`);
  }
  await verifyInstalledTree(version, manifest);
  await setTreeReadOnly(version, platform);
  return manifest;
}

export async function resolveBuiltinSkillsDir(
  rootDir = platformPaths.builtinSkillsRootDir,
  options: { platform?: BuiltinInstallerPlatformOverrides } = {},
): Promise<string> {
  const root = resolve(rootDir);
  await requirePlainDirectory(root, "Builtin skills root");
  const pointer = await readActivePointer(root);
  if (!pointer) throw new Error("Builtin active pointer is missing");
  const version = join(root, "versions", pointer.bundleDigest);
  const manifest = await verifyAndProtectVersion(
    version,
    installerPlatform(options.platform),
  );
  if (manifest.bundleDigest !== pointer.bundleDigest) {
    throw new Error(`Builtin active version digest mismatch: ${version}`);
  }
  return version;
}

function sameFileIdentity(left: Stats, right: Stats): boolean {
  if (
    left.dev !== null && left.ino !== null && right.dev !== null &&
    right.ino !== null
  ) {
    return left.dev === right.dev && left.ino === right.ino;
  }
  return left.isFile() && right.isFile() && left.size === right.size &&
    left.mtime?.getTime() === right.mtime?.getTime() &&
    left.birthtime?.getTime() === right.birthtime?.getTime();
}

async function acquireLock(
  root: string,
  platform: InstallerPlatform,
): Promise<InstallerLock> {
  const lockPath = join(root, ".install.lock");
  const before = await pathInfo(lockPath);
  if (before && (before.isSymbolicLink() || !before.isFile())) {
    throw new Error(
      `Builtin installer lock must be a regular file: ${lockPath}`,
    );
  }
  if (before && before.nlink !== null && before.nlink > 1) {
    throw new Error(
      `Builtin installer lock must not be a hard link: ${lockPath}`,
    );
  }
  let file: FileHandle;
  try {
    // On Windows, Node opens `a+` files with append-only semantics and
    // FileHandle.truncate() then fails with EPERM. Open an existing lock for
    // ordinary read/write access, or create it exclusively on first use.
    file = await open(lockPath, before ? "r+" : "wx+", 0o600);
  } catch (error) {
    // The path may have been created after pathInfo(). The identity checks
    // below still reject links, hard links, or a path swapped during open.
    if (!before && (error as { code?: string }).code === "EEXIST") {
      file = await open(lockPath, "r+", 0o600);
    } else {
      throw error;
    }
  }
  try {
    const opened = await file.stat();
    const current = await lstat(lockPath);
    if (
      current.isSymbolicLink() || !current.isFile() ||
      (current.nlink !== null && current.nlink > 1) ||
      !sameFileIdentity(opened, current)
    ) {
      throw new Error(`Builtin installer lock file changed: ${lockPath}`);
    }
    await file.truncate(0);
    await writeAll(
      file,
      new TextEncoder().encode(JSON.stringify({
        formatVersion: 1,
        ownerId: crypto.randomUUID(),
        pid: process.pid,
        acquiredAt: Date.now(),
      })),
    );
    await file.sync();
    if (platform.os !== "windows") {
      await platform.chmod(lockPath, 0o600);
      const openedAfterChmod = await file.stat();
      const pathAfterChmod = await lstat(lockPath);
      if (!sameFileIdentity(openedAfterChmod, pathAfterChmod)) {
        throw new Error(`Builtin installer lock file changed: ${lockPath}`);
      }
    }
    const assertPathIdentity = async () => {
      const openedNow = await file.stat();
      const pathNow = await lstat(lockPath);
      if (
        pathNow.isSymbolicLink() || !pathNow.isFile() ||
        (pathNow.nlink !== null && pathNow.nlink > 1) ||
        !sameFileIdentity(openedNow, pathNow)
      ) {
        throw new Error(`Builtin installer lock file changed: ${lockPath}`);
      }
    };
    let released = false;
    return {
      assertPathIdentity,
      async release() {
        if (released) return;
        released = true;
        await file.close();
      },
    };
  } catch (error) {
    file.close();
    throw error;
  }
}

async function recoverStaging(
  versions: string,
  platform: InstallerPlatform,
): Promise<void> {
  for (const entry of await readdir(versions, { withFileTypes: true })) {
    if (entry.name.startsWith(".staging-")) {
      await removePlainTree(join(versions, entry.name), platform);
    }
  }
}

async function commitActivePointer(
  root: string,
  digest: string,
  lock: InstallerLock,
  platform: InstallerPlatform,
): Promise<void> {
  const pointerPath = join(root, "current.json");
  const temporary = join(root, `.current-${crypto.randomUUID()}.tmp`);
  const file = await open(temporary, "wx", 0o600);
  let renamed = false;
  try {
    await writeAll(
      file,
      new TextEncoder().encode(JSON.stringify({
        formatVersion: 1,
        bundleDigest: digest,
      })),
    );
    await file.sync();
    if (platform.os !== "windows") {
      await platform.chmod(temporary, 0o600);
      const openedAfterChmod = await file.stat();
      const pathAfterChmod = await lstat(temporary);
      if (!sameFileIdentity(openedAfterChmod, pathAfterChmod)) {
        throw new Error(
          `Builtin active pointer temporary changed: ${temporary}`,
        );
      }
    }
    file.close();
    await lock.assertPathIdentity();
    await rename(temporary, pointerPath);
    renamed = true;
  } finally {
    try {
      file.close();
    } catch {
      // Already closed before the atomic rename.
    }
    if (!renamed) await rm(temporary).catch(() => {});
  }
}

export async function ensureBuiltinSkillsInstalled(options: {
  rootDir?: string;
  manifest?: BuiltinSkillManifest;
  gzip?: Uint8Array;
  beforeActivate?: () => void | Promise<void>;
  platform?: BuiltinInstallerPlatformOverrides;
} = {}): Promise<"installed" | "current" | "updated"> {
  const embedded = options.manifest && options.gzip
    ? undefined
    : getEmbeddedBuiltinSkillsBundle();
  const manifest = validateBuiltinSkillManifest(
    options.manifest ?? embedded?.manifest,
  );
  const gzip = options.gzip ?? embedded?.gzip;
  if (!(gzip instanceof Uint8Array)) {
    throw new Error("Builtin bundle gzip is required");
  }
  const root = resolve(options.rootDir ?? platformPaths.builtinSkillsRootDir);
  const platform = installerPlatform(options.platform);
  await ensurePlainDirectory(root);
  if (platform.os !== "windows") await platform.chmod(root, 0o700);
  const versions = join(root, "versions");
  await ensurePlainDirectory(versions);
  if (platform.os !== "windows") await platform.chmod(versions, 0o700);
  const lock = await acquireLock(root, platform);
  try {
    await recoverStaging(versions, platform);
    const pointer = await readActivePointer(root, true);
    if (pointer) {
      const active = join(versions, pointer.bundleDigest);
      const activeManifest = await verifyAndProtectVersion(active, platform);
      if (activeManifest.bundleDigest !== pointer.bundleDigest) {
        throw new Error(`Builtin active version digest mismatch: ${active}`);
      }
      if (pointer.bundleDigest === manifest.bundleDigest) return "current";
    }

    const files = await parsePayload(gzip, manifest);
    const target = join(versions, manifest.bundleDigest);
    const targetInfo = await pathInfo(target);
    if (targetInfo) {
      await verifyAndProtectVersion(target, platform, manifest);
    } else {
      const staging = join(
        versions,
        `.staging-${manifest.bundleDigest}-${crypto.randomUUID()}`,
      );
      let promoted = false;
      try {
        await writeStaging(staging, files, manifest);
        await verifyInstalledTree(staging, manifest);
        await setTreeReadOnly(staging, platform);
        if (platform.os !== "windows") await platform.chmod(staging, 0o700);
        await lock.assertPathIdentity();
        await rename(staging, target);
        promoted = true;
        if (platform.os !== "windows") await platform.chmod(target, 0o555);
      } finally {
        if (!promoted) await removePlainTree(staging, platform).catch(() => {});
      }
    }
    await verifyAndProtectVersion(target, platform, manifest);
    await options.beforeActivate?.();
    await commitActivePointer(root, manifest.bundleDigest, lock, platform);
    return pointer ? "updated" : "installed";
  } finally {
    await lock.release();
  }
}
