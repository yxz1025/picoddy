import { dirname, join, resolve } from "node:path";
import { mkdir, lstat, writeFile, readFile, readdir } from "node:fs/promises";
import type { Stats, Dirent } from "node:fs";

import { parseDocument } from "../node_modules/yaml/browser/index.js";

export interface BuiltinSkillManifest {
  formatVersion: 1;
  bundleDigest: string;
  skills: Array<{ name: string; skillFile: string }>;
  files: Array<{ path: string; size: number; sha256: string }>;
}

type ScannedFile = {
  path: string;
  bytes: Uint8Array;
  size: number;
  sha256: string;
};

type SkillEntry = { name: string; skillFile: string };

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function validateInternalPath(path: string): void {
  const segments = path.split("/");
  const windowsDeviceName =
    /^(?:(?:CON|PRN|AUX|NUL|CONIN\$|CONOUT\$)|(?:COM|LPT)[1-9¹²³])(?:\.|$)/i;
  const unsafe = path.startsWith("/") ||
    segments.some((segment) =>
      segment === "" || segment === "." || segment === ".." ||
      /[<>:"\\|?*\u0000-\u001f]/.test(segment) || /[ .]$/.test(segment) ||
      windowsDeviceName.test(segment)
    );
  if (unsafe) {
    throw new Error(`Unsafe internal path: ${JSON.stringify(path)}`);
  }
}

function caseFold(value: string): string {
  return value.toUpperCase().toLowerCase();
}

function registerArchivePath(
  path: string,
  foldedPaths: Map<string, string>,
): void {
  const folded = caseFold(path);
  const existing = foldedPaths.get(folded);
  if (existing !== undefined && existing !== path) {
    throw new Error(`Case-folded archive path collision: ${existing}, ${path}`);
  }
  foldedPaths.set(folded, path);
}

async function digest(bytes: Uint8Array): Promise<string> {
  const value = await crypto.subtle.digest(
    "SHA-256",
    Uint8Array.from(bytes).buffer,
  );
  return Buffer.from(value).toString("hex");
}

async function requireDirectory(path: string, label: string): Promise<void> {
  let stat: Stats;
  try {
    stat = await lstat(path);
  } catch (error) {
    throw new Error(`Cannot inspect ${label}: ${path}`, { cause: error });
  }
  if (stat.isSymbolicLink()) {
    throw new Error(`${label} must not be a symbolic link: ${path}`);
  }
  if (!stat.isDirectory()) {
    throw new Error(`${label} must be a directory: ${path}`);
  }
}

async function sortedEntries(path: string): Promise<Dirent[]> {
  const entries: Dirent[] = [];
  for (const entry of await readdir(path, { withFileTypes: true })) {
    if (
      entry.name === ".DS_Store" || entry.name === "__pycache__" ||
      entry.name.endsWith(".pyc")
    ) continue;
    entries.push(entry);
  }
  return entries.sort((left, right) => compareText(left.name, right.name));
}

async function scanDirectory(
  absoluteDirectory: string,
  relativeDirectory: string,
  files: ScannedFile[],
  foldedPaths: Map<string, string>,
): Promise<void> {
  for (const entry of await sortedEntries(absoluteDirectory)) {
    const relativePath = relativeDirectory
      ? `${relativeDirectory}/${entry.name}`
      : entry.name;
    validateInternalPath(relativePath);
    registerArchivePath(relativePath, foldedPaths);
    const absolutePath = `${absoluteDirectory}/${entry.name}`;
    const stat = await lstat(absolutePath);
    if (stat.isSymbolicLink()) {
      throw new Error(`Source tree contains a symbolic link: ${relativePath}`);
    }
    if (stat.isDirectory()) {
      await scanDirectory(
        absolutePath,
        relativePath,
        files,
        foldedPaths,
      );
      continue;
    }
    if (!stat.isFile()) {
      throw new Error(
        `Source tree contains a non-regular file: ${relativePath}`,
      );
    }
    const bytes = await readFile(absolutePath);
    files.push({
      path: relativePath,
      bytes,
      size: bytes.length,
      sha256: await digest(bytes),
    });
  }
}

function parseSkillFile(directoryName: string, text: string): SkillEntry {
  const frontmatter = text.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  if (!frontmatter) {
    throw new Error(`Invalid SKILL.md frontmatter for ${directoryName}`);
  }
  const document = parseDocument(frontmatter[1], { uniqueKeys: true });
  if (document.errors.length > 0) {
    throw new Error(
      `Invalid SKILL.md YAML for ${directoryName}: ${
        document.errors[0].message
      }`,
    );
  }
  const metadata = document.toJS();
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    throw new Error(
      `Invalid SKILL.md YAML for ${directoryName}: expected a mapping`,
    );
  }
  const values = metadata as Record<string, unknown>;
  const allowedProperties = new Set([
    "name",
    "description",
    "license",
    "allowed-tools",
    "metadata",
  ]);
  const unexpected = Object.keys(values).filter((key) =>
    !allowedProperties.has(key)
  );
  if (unexpected.length > 0) {
    throw new Error(
      `Invalid SKILL.md frontmatter for ${directoryName}: unexpected properties ${
        unexpected.join(", ")
      }`,
    );
  }
  const rawName = values.name;
  const rawDescription = values.description;
  if (
    typeof rawName !== "string" || rawName.trim().length === 0 ||
    typeof rawDescription !== "string" || rawDescription.trim().length === 0
  ) {
    throw new Error(
      `Invalid SKILL.md frontmatter for ${directoryName}: name and description must be non-empty strings`,
    );
  }
  const name = rawName.trim();
  const description = rawDescription.trim();
  if (name.length > 64 || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name)) {
    throw new Error(`Invalid skill name in ${directoryName}/SKILL.md: ${name}`);
  }
  if (description.length > 1024 || /[<>]/.test(description)) {
    throw new Error(`Invalid skill description in ${directoryName}/SKILL.md`);
  }
  if (directoryName !== name) {
    throw new Error(
      `Skill directory name ${directoryName} does not match frontmatter name ${name}`,
    );
  }
  return { name, skillFile: `${directoryName}/SKILL.md` };
}

async function collectSource(sourceRoot: string): Promise<{
  skills: SkillEntry[];
  files: ScannedFile[];
}> {
  await requireDirectory(sourceRoot, "Source directory");
  const rootEntries = await sortedEntries(sourceRoot);
  for (const entry of rootEntries) {
    if (entry.isSymbolicLink()) {
      throw new Error(`Source tree contains a symbolic link: ${entry.name}`);
    }
    if (!entry.isDirectory()) {
      throw new Error(
        `Builtin skill source root may contain only skill directories: ${entry.name}`,
      );
    }
  }

  const foldedNames = new Map<string, string>();
  for (const entry of rootEntries) {
    const folded = caseFold(entry.name);
    const existing = foldedNames.get(folded);
    if (existing !== undefined) {
      throw new Error(
        `Case-folded duplicate skill names: ${existing}, ${entry.name}`,
      );
    }
    foldedNames.set(folded, entry.name);
  }

  const files: ScannedFile[] = [];
  await scanDirectory(sourceRoot, "", files, new Map());
  files.sort((left, right) => compareText(left.path, right.path));

  const fileByPath = new Map(files.map((file) => [file.path, file]));
  const decoder = new TextDecoder("utf-8", { fatal: true });
  const skills: SkillEntry[] = [];
  for (const entry of rootEntries) {
    const skillPath = `${entry.name}/SKILL.md`;
    const skillFile = fileByPath.get(skillPath);
    if (!skillFile) throw new Error(`Missing required SKILL.md: ${skillPath}`);
    let text: string;
    try {
      text = decoder.decode(skillFile.bytes);
    } catch (error) {
      throw new Error(`Invalid SKILL.md UTF-8: ${skillPath}`, { cause: error });
    }
    skills.push(parseSkillFile(entry.name, text));
  }
  skills.sort((left, right) => compareText(left.name, right.name));
  return { skills, files };
}

const TAR_BLOCK_SIZE = 512;

function writeTarText(
  header: Uint8Array,
  offset: number,
  length: number,
  value: string,
): void {
  const bytes = new TextEncoder().encode(value);
  if (bytes.length > length) {
    throw new Error(`Value does not fit deterministic ustar field: ${value}`);
  }
  header.set(bytes, offset);
}

function writeTarOctal(
  header: Uint8Array,
  offset: number,
  length: number,
  value: number,
): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`Invalid deterministic ustar number: ${value}`);
  }
  const octal = value.toString(8);
  if (octal.length > length - 1) {
    throw new Error(`Value does not fit deterministic ustar number: ${value}`);
  }
  writeTarText(header, offset, length, `${octal.padStart(length - 1, "0")}\0`);
}

function splitTarPath(path: string): { name: string; prefix: string } {
  const encoder = new TextEncoder();
  if (encoder.encode(path).length <= 100) return { name: path, prefix: "" };
  const separators: number[] = [];
  for (let index = 0; index < path.length; index++) {
    if (path[index] === "/") separators.push(index);
  }
  for (const index of separators.reverse()) {
    if (index === path.length - 1) continue;
    const prefix = path.slice(0, index);
    const name = path.slice(index + 1);
    if (
      encoder.encode(prefix).length <= 155 &&
      encoder.encode(name).length <= 100
    ) {
      return { name, prefix };
    }
  }
  throw new Error(`Builtin path cannot be represented by ustar: ${path}`);
}

function createTarHeader(
  path: string,
  type: "file" | "directory",
  size: number,
): Uint8Array {
  const archivePath = type === "directory" ? `${path}/` : path;
  const { name, prefix } = splitTarPath(archivePath);
  const header = new Uint8Array(TAR_BLOCK_SIZE);
  writeTarText(header, 0, 100, name);
  writeTarOctal(header, 100, 8, type === "directory" ? 0o755 : 0o644);
  writeTarOctal(header, 108, 8, 0);
  writeTarOctal(header, 116, 8, 0);
  writeTarOctal(header, 124, 12, size);
  writeTarOctal(header, 136, 12, 0);
  header.fill(0x20, 148, 156);
  header[156] = type === "directory" ? 0x35 : 0x30;
  writeTarText(header, 257, 6, "ustar\0");
  writeTarText(header, 263, 2, "00");
  writeTarText(header, 345, 155, prefix);
  const checksum = header.reduce((sum, byte) => sum + byte, 0);
  writeTarText(
    header,
    148,
    8,
    `${checksum.toString(8).padStart(6, "0")}\0 `,
  );
  return header;
}

function createDeterministicTar(files: ScannedFile[]): Uint8Array {
  const directorySet = new Set<string>();
  for (const file of files) {
    const segments = file.path.split("/");
    for (let index = 1; index < segments.length; index++) {
      directorySet.add(segments.slice(0, index).join("/"));
    }
  }
  const directories = [...directorySet].sort(compareText);
  const entries: Array<{
    path: string;
    type: "file" | "directory";
    bytes: Uint8Array;
  }> = [
    ...directories.map((path) => ({
      path,
      type: "directory" as const,
      bytes: new Uint8Array(),
    })),
    ...files.map((file) => ({
      path: file.path,
      type: "file" as const,
      bytes: file.bytes,
    })),
  ].sort((left, right) => compareText(left.path, right.path));
  const chunks: Uint8Array[] = [];
  let total = TAR_BLOCK_SIZE * 2;
  for (const entry of entries) {
    chunks.push(createTarHeader(entry.path, entry.type, entry.bytes.length));
    chunks.push(entry.bytes);
    const padding = (TAR_BLOCK_SIZE - entry.bytes.length % TAR_BLOCK_SIZE) %
      TAR_BLOCK_SIZE;
    if (padding > 0) chunks.push(new Uint8Array(padding));
    total += TAR_BLOCK_SIZE + entry.bytes.length + padding;
  }
  chunks.push(new Uint8Array(TAR_BLOCK_SIZE * 2));
  const tar = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    tar.set(chunk, offset);
    offset += chunk.length;
  }
  return tar;
}

async function gzip(bytes: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([Uint8Array.from(bytes).buffer]).stream().pipeThrough(
    new CompressionStream("gzip"),
  );
  const compressed = new Uint8Array(await new Response(stream).arrayBuffer());
  // RFC 1952 bytes 4..7 are MTIME. CompressionStream currently emits zero,
  // but pin it explicitly so a runtime change cannot make builds time-dependent.
  compressed.fill(0, 4, 8);
  return compressed;
}

async function writeGeneratedFile(
  path: string,
  content: string,
): Promise<void> {
  const output = resolve(path);
  await mkdir(dirname(output), { recursive: true });
  try {
    const stat = await lstat(output);
    if (stat.isSymbolicLink()) {
      throw new Error(`Output must not be a symbolic link: ${output}`);
    }
    if (!stat.isFile()) {
      throw new Error(`Output must be a regular file: ${output}`);
    }
  } catch (error) {
    if (!((error as { code?: string }).code === "ENOENT")) throw error;
  }
  await writeFile(output, content);
}

function quoteTypeScriptString(value: string): string {
  return `'${value.replaceAll("\\", "\\\\").replaceAll("'", "\\'")}'`;
}

export async function buildBuiltinSkills(input: {
  sourceDir: string;
  manifestOutput?: string;
  moduleOutput?: string;
}): Promise<{ manifest: BuiltinSkillManifest; gzip: Uint8Array }> {
  const { skills, files } = await collectSource(resolve(input.sourceDir));
  const tarBytes = createDeterministicTar(files);
  const compressed = await gzip(tarBytes);
  const manifest: BuiltinSkillManifest = {
    formatVersion: 1,
    bundleDigest: await digest(tarBytes),
    skills,
    files: files.map(({ path, size, sha256 }) => ({ path, size, sha256 })),
  };

  if (input.manifestOutput) {
    await writeGeneratedFile(
      input.manifestOutput,
      `${JSON.stringify(manifest, null, 2)}\n`,
    );
  }
  if (input.moduleOutput) {
    const manifestJson = quoteTypeScriptString(JSON.stringify(manifest));
    const generated =
      `// Generated by scripts/build-builtin-skills.ts. Do not edit manually.\n` +
      `export const BUILTIN_SKILLS_MANIFEST = JSON.parse(\n` +
      `  ${manifestJson},\n` +
      `) as {\n` +
      `  readonly formatVersion: 1;\n` +
      `  readonly bundleDigest: string;\n` +
      `  readonly skills: readonly {\n` +
      `    readonly name: string;\n` +
      `    readonly skillFile: string;\n` +
      `  }[];\n` +
      `  readonly files: readonly {\n` +
      `    readonly path: string;\n` +
      `    readonly size: number;\n` +
      `    readonly sha256: string;\n` +
      `  }[];\n` +
      `};\n\n` +
      `export const BUILTIN_SKILLS_GZIP_BASE64 =\n` +
      `  ${JSON.stringify(Buffer.from(compressed).toString("base64"))};\n`;
    await writeGeneratedFile(input.moduleOutput, generated);
  }
  return { manifest, gzip: compressed };
}

import { pathToFileURL } from "node:url";

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const sourceDir = process.argv.slice(2)[0];
  const output = process.argv.slice(2)[1];
  if (!sourceDir || !output || process.argv.slice(2).length > 3) {
    throw new Error(
      "Usage: build-builtin-skills.ts <source-dir> <output-dir> OR " +
        "<source-dir> <manifest-output> <module-output>",
    );
  }
  const manifestOutput = process.argv.slice(2).length === 2
    ? join(output, "builtin-skills.manifest.generated.json")
    : output;
  const moduleOutput = process.argv.slice(2).length === 2
    ? join(output, "builtin-skills.bundle.generated.ts")
    : process.argv.slice(2)[2];
  if (!moduleOutput) throw new Error("Module output is required");
  await buildBuiltinSkills({ sourceDir, manifestOutput, moduleOutput });
}
