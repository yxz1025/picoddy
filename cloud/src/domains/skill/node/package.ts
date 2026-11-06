import { createHash } from "node:crypto";

import { Unzip, UnzipInflate } from "fflate";
import { parseDocument } from "yaml";

export const SKILL_PACKAGE_LIMITS = Object.freeze({
  maxArchiveBytes: 16 * 1024 * 1024,
  maxFiles: 256,
  maxFileBytes: 8 * 1024 * 1024,
  maxTotalUncompressedBytes: 32 * 1024 * 1024,
  maxCompressionRatio: 200,
  maxPathBytes: 512,
});

export interface ParsedSkillFile {
  path: string;
  contentBase64: string;
}

export interface ParsedSkillPackage {
  name: string;
  description: string;
  version: string;
  files: ParsedSkillFile[];
}

interface ZipEntry {
  rawPath: string;
  path: string;
  directory: boolean;
  compressedSize: number;
  uncompressedSize: number;
}

const ZIP_CENTRAL_SIGNATURE = 0x02014b50;
const ZIP_EOCD_SIGNATURE = 0x06054b50;
const ZIP64_U16 = 0xffff;
const ZIP64_U32 = 0xffffffff;
const UNIX_FILE_TYPE_MASK = 0o170000;
const UNIX_REGULAR_FILE = 0o100000;
const UNIX_DIRECTORY = 0o040000;
const UNIX_SYMLINK = 0o120000;
const MAX_FRONTMATTER_BYTES = 64 * 1024;
const utf8 = new TextDecoder("utf-8", { fatal: true });

function packageError(message: string): Error {
  return new Error(`Invalid skill package: ${message}`);
}

function digest(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function decodeUtf8(bytes: Uint8Array, label: string): string {
  try {
    return utf8.decode(bytes);
  } catch {
    throw packageError(`${label} is not valid UTF-8`);
  }
}

export function validatePackagePath(rawPath: string, directory = false): string {
  const path = directory && rawPath.endsWith("/") ? rawPath.slice(0, -1) : rawPath;
  if (!path || path.includes("\0") || path.includes("\\")) {
    throw packageError(`unsafe path ${JSON.stringify(rawPath)}`);
  }
  if (path.startsWith("/") || /^[A-Za-z]:/.test(path)) {
    throw packageError(`absolute path ${JSON.stringify(rawPath)} is forbidden`);
  }
  if (Buffer.byteLength(path, "utf8") > SKILL_PACKAGE_LIMITS.maxPathBytes) {
    throw packageError(`path exceeds the ${SKILL_PACKAGE_LIMITS.maxPathBytes}-byte limit`);
  }
  if (path.normalize("NFC") !== path) {
    throw packageError(`path ${JSON.stringify(rawPath)} has ambiguous Unicode normalization`);
  }
  const segments = path.split("/");
  if (segments.some((segment) => !segment || segment === "." || segment === "..")) {
    throw packageError(`unsafe path ${JSON.stringify(rawPath)}`);
  }
  if (segments.some((segment) => /[\u0000-\u001f\u007f]/.test(segment))) {
    throw packageError(`path ${JSON.stringify(rawPath)} contains control characters`);
  }
  return path;
}

/** Validate a draft's complete file set without executing or extracting user code. */
export function parseSkillFiles(input: ParsedSkillFile[]): ParsedSkillPackage {
  if (!Array.isArray(input) || input.length > SKILL_PACKAGE_LIMITS.maxFiles) throw packageError('file count limit exceeded');
  const paths = new Set<string>();
  let total = 0;
  const files = input.map(file => {
    const path = validatePackagePath(file.path);
    if (paths.has(path)) throw packageError('duplicate file path');
    for (const other of paths) if (path.startsWith(`${other}/`) || other.startsWith(`${path}/`)) throw packageError('file/directory path collision');
    paths.add(path);
    if (typeof file.contentBase64 !== 'string' || file.contentBase64.length > Math.ceil(SKILL_PACKAGE_LIMITS.maxFileBytes / 3) * 4) throw packageError('file size limit exceeded');
    const bytes = Buffer.from(file.contentBase64, 'base64');
    if (bytes.toString('base64') !== file.contentBase64) throw packageError('invalid base64');
    total += bytes.length;
    if (bytes.length > SKILL_PACKAGE_LIMITS.maxFileBytes || total > SKILL_PACKAGE_LIMITS.maxTotalUncompressedBytes) throw packageError('package size limit exceeded');
    return { path, contentBase64: file.contentBase64 };
  }).sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
  const main = files.find(file => file.path === 'SKILL.md');
  if (!main) throw packageError('SKILL.md is required');
  const metadata = parseFrontmatter(Buffer.from(main.contentBase64, 'base64'));
  return { ...metadata, files, version: digest(Buffer.from(JSON.stringify(files))) };
}

function findEndOfCentralDirectory(bytes: Uint8Array): number {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const lowerBound = Math.max(0, bytes.length - 65_557);
  for (let offset = bytes.length - 22; offset >= lowerBound; offset -= 1) {
    if (view.getUint32(offset, true) !== ZIP_EOCD_SIGNATURE) continue;
    const commentLength = view.getUint16(offset + 20, true);
    if (offset + 22 + commentLength === bytes.length) return offset;
  }
  throw packageError("missing or malformed zip end record");
}

function inspectZip(bytes: Uint8Array): ZipEntry[] {
  if (bytes.length > SKILL_PACKAGE_LIMITS.maxArchiveBytes) {
    throw packageError(`archive exceeds the ${SKILL_PACKAGE_LIMITS.maxArchiveBytes}-byte limit`);
  }
  if (bytes.length < 22) throw packageError("zip is truncated");

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const eocd = findEndOfCentralDirectory(bytes);
  const disk = view.getUint16(eocd + 4, true);
  const centralDisk = view.getUint16(eocd + 6, true);
  const diskEntries = view.getUint16(eocd + 8, true);
  const entryCount = view.getUint16(eocd + 10, true);
  const centralSize = view.getUint32(eocd + 12, true);
  const centralOffset = view.getUint32(eocd + 16, true);

  if (disk !== 0 || centralDisk !== 0 || diskEntries !== entryCount) {
    throw packageError("multi-disk zip archives are unsupported");
  }
  if (
    entryCount === ZIP64_U16 ||
    centralSize === ZIP64_U32 ||
    centralOffset === ZIP64_U32
  ) {
    throw packageError("ZIP64 archives are unsupported");
  }
  if (entryCount === 0) throw packageError("zip contains no files");
  if (entryCount > SKILL_PACKAGE_LIMITS.maxFiles) {
    throw packageError(`zip exceeds the ${SKILL_PACKAGE_LIMITS.maxFiles}-entry limit`);
  }
  if (centralOffset + centralSize > eocd || centralOffset + centralSize > bytes.length) {
    throw packageError("central directory points outside the archive");
  }

  const entries: ZipEntry[] = [];
  const rawPaths = new Set<string>();
  let totalUncompressed = 0;
  let offset = centralOffset;

  for (let index = 0; index < entryCount; index += 1) {
    if (offset + 46 > eocd || view.getUint32(offset, true) !== ZIP_CENTRAL_SIGNATURE) {
      throw packageError("malformed central directory");
    }
    const madeByOs = view.getUint8(offset + 5);
    const flags = view.getUint16(offset + 8, true);
    const compression = view.getUint16(offset + 10, true);
    const compressedSize = view.getUint32(offset + 20, true);
    const uncompressedSize = view.getUint32(offset + 24, true);
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    const externalAttributes = view.getUint32(offset + 38, true);
    const localOffset = view.getUint32(offset + 42, true);
    const next = offset + 46 + nameLength + extraLength + commentLength;
    if (next > eocd || nameLength === 0 || localOffset >= centralOffset) {
      throw packageError("central directory entry is out of bounds");
    }
    if ((flags & 1) !== 0) throw packageError("encrypted zip entries are unsupported");
    if (compression !== 0 && compression !== 8) {
      throw packageError(`zip compression method ${compression} is unsupported`);
    }
    if (compressedSize === ZIP64_U32 || uncompressedSize === ZIP64_U32) {
      throw packageError("ZIP64 entries are unsupported");
    }

    const rawNameBytes = bytes.subarray(offset + 46, offset + 46 + nameLength);
    if ((flags & 0x0800) === 0 && rawNameBytes.some((value) => value > 0x7f)) {
      throw packageError("non-UTF-8 legacy zip paths are unsupported");
    }
    const rawPath = decodeUtf8(rawNameBytes, "zip path");
    const unixMode = madeByOs === 3 ? externalAttributes >>> 16 : 0;
    const unixType = unixMode & UNIX_FILE_TYPE_MASK;
    if (unixType === UNIX_SYMLINK) throw packageError(`symlink ${JSON.stringify(rawPath)} is forbidden`);
    if (unixType !== 0 && unixType !== UNIX_REGULAR_FILE && unixType !== UNIX_DIRECTORY) {
      throw packageError(`special file ${JSON.stringify(rawPath)} is forbidden`);
    }
    const directory = rawPath.endsWith("/") || unixType === UNIX_DIRECTORY;
    const path = validatePackagePath(rawPath, directory);
    if (rawPaths.has(rawPath)) throw packageError(`path collision at ${JSON.stringify(rawPath)}`);
    rawPaths.add(rawPath);

    if (!directory) {
      if (uncompressedSize > SKILL_PACKAGE_LIMITS.maxFileBytes) {
        throw packageError(`file ${JSON.stringify(rawPath)} exceeds the uncompressed file limit`);
      }
      totalUncompressed += uncompressedSize;
      if (totalUncompressed > SKILL_PACKAGE_LIMITS.maxTotalUncompressedBytes) {
        throw packageError("declared uncompressed content exceeds the package limit");
      }
      if (uncompressedSize > 0 && compressedSize === 0) {
        throw packageError(`file ${JSON.stringify(rawPath)} has an invalid compressed size`);
      }
      if (
        compressedSize > 0 &&
        uncompressedSize / compressedSize > SKILL_PACKAGE_LIMITS.maxCompressionRatio
      ) {
        throw packageError(`file ${JSON.stringify(rawPath)} exceeds the compression-ratio limit`);
      }
    }
    entries.push({ rawPath, path, directory, compressedSize, uncompressedSize });
    offset = next;
  }
  if (offset !== centralOffset + centralSize) {
    throw packageError("central directory size does not match its entries");
  }
  return entries;
}

function choosePackageRoot(entries: ZipEntry[], requiredRootMarker: string): string {
  const markerPaths = entries.filter(
    (entry) => !entry.directory && (
      entry.path === requiredRootMarker || entry.path.endsWith(`/${requiredRootMarker}`)
    ),
  );
  if (markerPaths.some((entry) => entry.path === requiredRootMarker)) {
    if (markerPaths.length !== 1) {
      throw packageError(`package contains multiple ${requiredRootMarker} files`);
    }
    return "";
  }
  if (markerPaths.length !== 1) {
    throw packageError(`zip must contain exactly one ${requiredRootMarker}`);
  }
  const candidate = markerPaths[0]!.path.slice(0, -requiredRootMarker.length);
  if (!candidate.endsWith("/") || candidate.slice(0, -1).includes("/")) {
    throw packageError(`${requiredRootMarker} must be at the archive root or inside one package directory`);
  }
  if (entries.some((entry) => entry.path !== candidate.slice(0, -1) && !entry.path.startsWith(candidate))) {
    throw packageError(`all zip entries must share the ${requiredRootMarker} package root`);
  }
  return candidate;
}

function applyPackageRoot(entries: ZipEntry[], root: string): ZipEntry[] {
  const seen = new Map<string, "file" | "directory">();
  const output: ZipEntry[] = [];
  for (const entry of entries) {
    const stripped = root ? entry.path.slice(root.length) : entry.path;
    if (!stripped) {
      // Keep an explicit package-root directory so the streaming unzipper can
      // match its local-header callback. It never becomes a returned file.
      if (!entry.directory) throw packageError("package root entry must be a directory");
      output.push({ ...entry, path: "" });
      continue;
    }
    const path = validatePackagePath(stripped, entry.directory);
    const kind = entry.directory ? "directory" : "file";
    if (seen.has(path)) throw packageError(`path collision at ${JSON.stringify(path)}`);
    for (const [other, otherKind] of seen) {
      if ((path.startsWith(`${other}/`) && otherKind === "file") ||
          (other.startsWith(`${path}/`) && kind === "file")) {
        throw packageError(`file/directory path collision at ${JSON.stringify(path)}`);
      }
    }
    seen.set(path, kind);
    output.push({ ...entry, path });
  }
  return output;
}

function extractZip(bytes: Uint8Array, entries: ZipEntry[]): Map<string, Uint8Array> {
  const byRawPath = new Map(entries.map((entry) => [entry.rawPath, entry]));
  const seen = new Set<string>();
  const extracted = new Map<string, Uint8Array>();
  let actualTotal = 0;
  let extractionError: Error | undefined;
  const unzip = new Unzip((file) => {
    if (extractionError) return;
    const entry = byRawPath.get(file.name);
    if (!entry) {
      extractionError = packageError(`local zip entry ${JSON.stringify(file.name)} is not in the central directory`);
      return;
    }
    if (seen.has(file.name)) {
      extractionError = packageError(`duplicate local zip entry ${JSON.stringify(file.name)}`);
      return;
    }
    seen.add(file.name);
    const chunks: Uint8Array[] = [];
    let length = 0;
    file.ondata = (error, chunk, final) => {
      if (error && !extractionError) extractionError = packageError(`cannot decompress ${JSON.stringify(file.name)}`);
      if (extractionError || entry.directory) return;
      if (chunk) {
        length += chunk.length;
        actualTotal += chunk.length;
        if (
          length > entry.uncompressedSize ||
          length > SKILL_PACKAGE_LIMITS.maxFileBytes ||
          actualTotal > SKILL_PACKAGE_LIMITS.maxTotalUncompressedBytes
        ) {
          extractionError = packageError(`decompressed output for ${JSON.stringify(file.name)} exceeds its limit`);
          file.terminate?.();
          return;
        }
        chunks.push(chunk.slice());
      }
      if (final) {
        if (length !== entry.uncompressedSize) {
          extractionError = packageError(`decompressed size mismatch for ${JSON.stringify(file.name)}`);
          return;
        }
        const content = new Uint8Array(length);
        let cursor = 0;
        for (const part of chunks) {
          content.set(part, cursor);
          cursor += part.length;
        }
        extracted.set(entry.path, content);
      }
    };
    file.start();
  });
  unzip.register(UnzipInflate);

  // Small input chunks keep memory bounded even when a corrupt DEFLATE stream lies
  // about its expanded size. Central-directory limits are checked before this point.
  const chunkSize = 1024;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    const end = Math.min(bytes.length, offset + chunkSize);
    unzip.push(bytes.subarray(offset, end), end === bytes.length);
    if (extractionError) throw extractionError;
  }
  const expectedFiles = entries.filter((entry) => !entry.directory);
  if (expectedFiles.some((entry) => !extracted.has(entry.path))) {
    throw packageError("zip ended before every file was decompressed");
  }
  return extracted;
}

function parseFrontmatter(skillBytes: Uint8Array): { name: string; description: string } {
  const source = decodeUtf8(skillBytes, "SKILL.md").replace(/^\uFEFF/, "");
  const match = /^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/.exec(source);
  if (!match) throw packageError("SKILL.md must start with YAML frontmatter");
  if (Buffer.byteLength(match[1]!, "utf8") > MAX_FRONTMATTER_BYTES) {
    throw packageError(`YAML frontmatter exceeds the ${MAX_FRONTMATTER_BYTES}-byte limit`);
  }

  const document = parseDocument(match[1]!, {
    schema: "core",
    merge: false,
    uniqueKeys: true,
  });
  if (document.errors.length > 0) {
    throw packageError(`invalid YAML frontmatter: ${document.errors[0]!.message}`);
  }
  let value: unknown;
  try {
    value = document.toJS({ maxAliasCount: 0 });
  } catch (error) {
    throw packageError(`invalid YAML frontmatter: ${error instanceof Error ? error.message : "unknown error"}`);
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw packageError("frontmatter must be a mapping");
  }
  const metadata = value as Record<string, unknown>;
  if (typeof metadata.name !== "string") throw packageError("frontmatter name must be a string");
  if (typeof metadata.description !== "string") {
    throw packageError("frontmatter description must be a string");
  }
  const name = metadata.name.trim();
  const description = metadata.description.trim();
  if (!name || name.length > 100 || /[\u0000-\u001f\u007f]/.test(name)) {
    throw packageError("frontmatter name must be 1-100 printable characters");
  }
  if (!description || description.length > 2_000 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(description)) {
    throw packageError("frontmatter description must be 1-2000 printable characters");
  }
  return { name, description };
}

export async function parseSkillPackage(
  filename: string,
  bytes: Uint8Array,
): Promise<ParsedSkillPackage> {
  if (!(bytes instanceof Uint8Array)) throw packageError("content must be binary data");
  if (filename === "SKILL.md") {
    if (bytes.length > SKILL_PACKAGE_LIMITS.maxFileBytes) {
      throw packageError(`SKILL.md exceeds the ${SKILL_PACKAGE_LIMITS.maxFileBytes}-byte limit`);
    }
    return parseSkillFiles([{ path: 'SKILL.md', contentBase64: Buffer.from(bytes).toString('base64') }]);
  }
  if (!filename.toLowerCase().endsWith(".zip")) {
    throw packageError("filename must be SKILL.md or end in .zip");
  }

  return parseSkillFiles(parseZipFiles(bytes, "SKILL.md"));
}

/**
 * Safely inspect and stream-decompress a complete ZIP package under one
 * optional top-level package directory. The required marker selects that
 * package root; every archive entry must share it.
 */
export function parseZipFiles(
  bytes: Uint8Array,
  requiredRootMarker = ".picoddy-plugin/plugin.json",
): ParsedSkillFile[] {
  if (!(bytes instanceof Uint8Array)) throw packageError("content must be binary data");
  const marker = validatePackagePath(requiredRootMarker);
  const inspected = inspectZip(bytes);
  const entries = applyPackageRoot(inspected, choosePackageRoot(inspected, marker));
  const extracted = extractZip(bytes, entries);
  if (!extracted.has(marker)) throw packageError(`zip does not contain ${marker}`);
  return [...extracted.entries()]
    .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
    .map(([path, content]) => ({
      path,
      contentBase64: Buffer.from(content).toString("base64"),
    }));
}
