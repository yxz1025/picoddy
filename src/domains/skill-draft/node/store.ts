import {
  basename,
  isAbsolute,
  join,
  normalize,
  relative,
  resolve,
  sep,
} from "node:path";
import { rm, mkdir, stat, lstat, chmod, rename, writeFile, readFile, readdir, open } from "node:fs/promises";
import type { Stats, Dirent } from "node:fs";
const platformOs = process.platform === "win32" ? "windows" : process.platform;

import { AsyncLocalStorage } from "node:async_hooks";
import { parseDocument } from "yaml";
import { platformPaths } from "../../../platform/paths.ts";

export type SkillDraftStatus = "editing" | "valid" | "installed";

export interface SkillDraftValidationItem {
  path?: string;
  code: string;
  message: string;
}

export interface SkillDraftValidation {
  valid: boolean;
  errors: SkillDraftValidationItem[];
  warnings: SkillDraftValidationItem[];
  checkedAt: number;
}

export interface SkillDraftMetadata {
  id: string;
  conversationId: string;
  status: SkillDraftStatus;
  skillName?: string;
  revisionOf?: string;
  revisionBaseDigest?: string;
  revisionCreatedAt?: number;
  createdAt: number;
  updatedAt: number;
  installedAt?: number;
  validation?: SkillDraftValidation;
}

export interface SkillDraftFile {
  path: string;
  size: number;
  binary: boolean;
}

export interface SkillDraftReadResult {
  text?: string;
  size: number;
  binary: boolean;
}

export interface InstalledSkill {
  name: string;
  path: string;
}

export type SkillDraftResourceDirectory =
  | "scripts"
  | "references"
  | "assets";

export interface SkillDraftInitializeOptions {
  name: string;
  description: string;
  resources: SkillDraftResourceDirectory[];
  skillMd: string;
}

export class SkillDraftError extends Error {
  constructor(
    public readonly code: string,
    public readonly status: number,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "SkillDraftError";
  }
}

export interface SkillDraftStore {
  getOrCreateForConversation(
    conversationId: string,
  ): Promise<SkillDraftMetadata>;
  get(id: string): Promise<SkillDraftMetadata>;
  initialize(
    id: string,
    options: SkillDraftInitializeOptions,
  ): Promise<void>;
  listFiles(id: string): Promise<SkillDraftFile[]>;
  readFile(id: string, path: string): Promise<SkillDraftReadResult>;
  writeFile(id: string, path: string, content: string): Promise<void>;
  importAsset(
    id: string,
    sourcePath: string,
    fileName: string,
  ): Promise<string>;
  deleteFile(id: string, path: string): Promise<void>;
  validate(id: string): Promise<SkillDraftValidation>;
  createRevision(id: string): Promise<SkillDraftMetadata>;
  /** 将已安装技能复制为新会话的修订草稿；草稿内容来自技能目录快照。 */
  createRevisionOf(
    name: string,
    conversationId: string,
  ): Promise<SkillDraftMetadata>;
  listInstalledFiles(id: string): Promise<SkillDraftFile[]>;
  readInstalledFile(
    id: string,
    path: string,
  ): Promise<SkillDraftReadResult>;
  install(id: string): Promise<InstalledSkill>;
}

export interface SkillDraftStoreOptions {
  lockTimeoutMs?: number;
  lockLeaseMs?: number;
  lockHeartbeatMs?: number;
  testHooks?: {
    afterLockCandidatePrepared?: (
      lockName: string,
      candidatePath: string,
    ) => void | Promise<void>;
    beforeAtomicCommit?: (targetPath: string) => void | Promise<void>;
    afterSourceValidation?: (id: string) => void | Promise<void>;
    beforeCopyFile?: (
      id: string,
      relativePath: string,
      sourcePath: string,
    ) => void | Promise<void>;
    afterInstallTargetRename?: (id: string) => void | Promise<void>;
    beforePersistInstalled?: (id: string) => void | Promise<void>;
  };
}

const TEXT_FILE_LIMIT = 1024 * 1024;
const BINARY_FILE_LIMIT = 16 * 1024 * 1024;
const PACKAGE_SIZE_LIMIT = 64 * 1024 * 1024;
const LOCK_TIMEOUT_MS = 2_000;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SKILL_NAME_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const SAFE_INSTALLED_SKILL_BASENAME_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
const ALLOWED_TOP_LEVEL_DIRECTORIES = new Set([
  "agents",
  "scripts",
  "references",
  "assets",
]);
const moduleMutexes = new Map<string, Promise<void>>();
interface ActiveLockGuard {
  assertOwned(): Promise<void>;
}
const activeLockGuard = new AsyncLocalStorage<ActiveLockGuard>();
type InstalledSkillNameLockAction<T> = (
  assertOwned: () => Promise<void>,
) => Promise<T>;
type InstalledSkillNameLockExecutor = <T>(
  name: string,
  action: InstalledSkillNameLockAction<T>,
) => Promise<T>;
const installedSkillNameLockExecutors = new Map<
  string,
  InstalledSkillNameLockExecutor
>();

export async function withInstalledSkillNameLock<T>(
  skillsRoot: string,
  name: string,
  action: InstalledSkillNameLockAction<T>,
): Promise<T> {
  if (
    !SAFE_INSTALLED_SKILL_BASENAME_PATTERN.test(name)
  ) {
    throw error("INVALID_SKILL_NAME", 400, "技能名称无效");
  }
  const resolvedSkillsRoot = resolve(skillsRoot);
  const parent = resolve(resolvedSkillsRoot, "..");
  const storageRoot = basename(resolvedSkillsRoot) === "skills"
    ? parent
    : resolve(parent, `.${basename(resolvedSkillsRoot)}-pi-a-state`);
  let executor = installedSkillNameLockExecutors.get(resolvedSkillsRoot);
  if (!executor) {
    createSkillDraftStore(storageRoot);
    executor = installedSkillNameLockExecutors.get(
      resolve(storageRoot, "skills"),
    );
    if (executor) {
      installedSkillNameLockExecutors.set(resolvedSkillsRoot, executor);
    }
  }
  if (!executor) {
    throw error("CONFIGURATION_ERROR", 500, "无法初始化技能名称锁");
  }
  return await executor(name, action);
}

function error(
  code: string,
  status: number,
  message: string,
  cause?: unknown,
): SkillDraftError {
  return new SkillDraftError(
    code,
    status,
    message,
    cause === undefined ? undefined : { cause },
  );
}

function isNotFound(value: unknown): boolean {
  return (value as { code?: string }).code === "ENOENT";
}

function isRenameCollision(value: unknown): boolean {
  if (value instanceof SkillDraftError && value.code === "LOCK_OCCUPIED") {
    return true;
  }
  if ((value as { code?: string }).code === "EEXIST") return true;
  if (!(value instanceof Error)) return false;
  const code = (value as Error & { code?: string }).code;
  return code === "EEXIST" || code === "ENOTEMPTY" ||
    value.name === "AlreadyExists" || value.name === "DirectoryNotEmpty";
}

function sameManifest(
  left: Map<string, string>,
  right: Map<string, string>,
): boolean {
  if (left.size !== right.size) return false;
  for (const [path, digest] of left) {
    if (right.get(path) !== digest) return false;
  }
  return true;
}

async function manifestDigest(manifest: Map<string, string>): Promise<string> {
  const serialized = [...manifest.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([path, digest]) => `${path}\0${digest}`)
    .join("\n");
  return await stableHash(serialized);
}

async function withModuleMutex<T>(
  key: string,
  action: () => Promise<T>,
): Promise<T> {
  const previous = moduleMutexes.get(key) ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>((resolveLock) => {
    release = resolveLock;
  });
  moduleMutexes.set(key, current);
  await previous;
  try {
    return await action();
  } finally {
    release();
    if (moduleMutexes.get(key) === current) moduleMutexes.delete(key);
  }
}

async function stableHash(input: string): Promise<string> {
  return await stableHashBytes(new TextEncoder().encode(input));
}

async function stableHashBytes(input: Uint8Array): Promise<string> {
  const bytes = await crypto.subtle.digest(
    "SHA-256",
    Uint8Array.from(input).buffer,
  );
  return Array.from(
    new Uint8Array(bytes),
    (byte) => byte.toString(16).padStart(2, "0"),
  ).join("");
}

function uuidFromHash(hash: string): string {
  const chars = hash.slice(0, 32).split("");
  chars[12] = "5";
  chars[16] = ["8", "9", "a", "b"][parseInt(chars[16], 16) % 4];
  const compact = chars.join("");
  return `${compact.slice(0, 8)}-${compact.slice(8, 12)}-${
    compact.slice(12, 16)
  }-${compact.slice(16, 20)}-${compact.slice(20)}`;
}

function validateDraftId(id: string): void {
  if (!UUID_PATTERN.test(id)) {
    throw error("INVALID_DRAFT_ID", 400, "非法草稿 ID");
  }
}

function safeRelativePath(input: string): string {
  if (
    !input || input.includes("\0") || input.includes("\\") ||
    isAbsolute(input)
  ) {
    throw error("INVALID_PATH", 400, "非法草稿路径");
  }
  const rawParts = input.split("/");
  if (rawParts.some((part) => part === "." || part === "..")) {
    throw error("INVALID_PATH", 400, "非法草稿路径");
  }
  const normalized = normalize(input);
  if (
    !normalized || normalized === "." || normalized === ".." ||
    normalized.startsWith(`..${sep}`)
  ) {
    throw error("INVALID_PATH", 400, "非法草稿路径");
  }
  const parts = normalized.split(sep);
  if (parts.some((part) => !part || part === "." || part === "..")) {
    throw error("INVALID_PATH", 400, "非法草稿路径");
  }
  if (normalized === "SKILL.md") return normalized;
  if (
    parts.length >= 2 && ALLOWED_TOP_LEVEL_DIRECTORIES.has(parts[0]) &&
    !(parts[0] === "agents" && normalized !== join("agents", "openai.yaml"))
  ) {
    return normalized;
  }
  throw error("PATH_NOT_ALLOWED", 400, "不允许的技能路径");
}

function safeDeleteRelativePath(input: string): string {
  if (["scripts", "references", "assets"].includes(input)) return input;
  return safeRelativePath(input);
}

function assertWithin(base: string, candidate: string): void {
  const offset = relative(resolve(base), resolve(candidate));
  if (offset === ".." || offset.startsWith(`..${sep}`) || isAbsolute(offset)) {
    throw error("INVALID_PATH", 400, "非法草稿路径");
  }
}

async function assertRegularDirectory(
  path: string,
  label: string,
): Promise<void> {
  const stat = await lstat(path);
  if (stat.isSymbolicLink() || !stat.isDirectory()) {
    throw error("UNSAFE_FILESYSTEM_ENTRY", 400, `${label}不是安全目录`);
  }
}

async function assertNoSymlinkAncestors(
  packageDirectory: string,
  relativePath: string,
): Promise<void> {
  let current = packageDirectory;
  const parts = relativePath.split(sep);
  for (const part of parts.slice(0, -1)) {
    current = join(current, part);
    try {
      const stat = await lstat(current);
      if (stat.isSymbolicLink() || !stat.isDirectory()) {
        throw error(
          "UNSAFE_FILESYSTEM_ENTRY",
          400,
          "草稿路径包含符号链接或非目录节点",
        );
      }
    } catch (cause) {
      if (isNotFound(cause)) return;
      throw cause;
    }
  }
}

function decodeBytes(bytes: Uint8Array): { binary: boolean; text?: string } {
  if (bytes.includes(0)) return { binary: true };
  try {
    return {
      binary: false,
      text: new TextDecoder("utf-8", { fatal: true }).decode(bytes),
    };
  } catch {
    return { binary: true };
  }
}

function decodeDraftFile(
  relativePath: string,
  bytes: Uint8Array,
): { binary: boolean; text?: string } {
  const portablePath = relativePath.replaceAll("\\", "/");
  const extension = portablePath.toLowerCase().match(
    /(?:^|\/)[^/]*(\.[^./]+)$/,
  )
    ?.[1];
  const knownTextExtensions = new Set([
    ".md",
    ".txt",
    ".yaml",
    ".yml",
    ".json",
    ".js",
    ".jsx",
    ".ts",
    ".tsx",
    ".py",
    ".sh",
    ".css",
    ".html",
    ".xml",
    ".csv",
    ".toml",
  ]);
  if (
    portablePath.startsWith("assets/") && extension &&
    !knownTextExtensions.has(extension)
  ) {
    return { binary: true };
  }
  return decodeBytes(bytes);
}

function parseScalar(input: string): string | undefined {
  const value = input.trim();
  if (!value) return undefined;
  if (value.startsWith('"')) {
    try {
      const parsed = JSON.parse(value);
      return typeof parsed === "string" ? parsed : undefined;
    } catch {
      return undefined;
    }
  }
  if (value.startsWith("'")) {
    if (!value.endsWith("'") || value.length < 2) return undefined;
    return value.slice(1, -1).replaceAll("''", "'");
  }
  if (
    /^(?:true|false|null|~|[-+]?(?:\d+\.?\d*|\.\d+))$/i.test(value)
  ) {
    return undefined;
  }
  if (/[\[\]{}]|:\s|(?:^|\s)#/.test(value)) return undefined;
  return value;
}

function parseSkillFrontmatter(
  text: string,
): {
  name?: string;
  description?: string;
  errors: SkillDraftValidationItem[];
} {
  const errors: SkillDraftValidationItem[] = [];
  const normalized = text.replaceAll("\r\n", "\n");
  const lines = normalized.split("\n");
  if (lines[0] !== "---") {
    return {
      errors: [{
        path: "SKILL.md",
        code: "FRONTMATTER_MISSING",
        message: "SKILL.md 必须以 YAML frontmatter 开头",
      }],
    };
  }
  const closing = lines.indexOf("---", 1);
  if (closing < 0) {
    return {
      errors: [{
        path: "SKILL.md",
        code: "FRONTMATTER_UNCLOSED",
        message: "SKILL.md frontmatter 缺少结束标记",
      }],
    };
  }

  const fields = new Map<string, string>();
  for (let index = 1; index < closing; index++) {
    const line = lines[index];
    if (!line.trim()) continue;
    const match = /^([A-Za-z_][A-Za-z0-9_-]*):(?:\s*(.*))?$/.exec(line);
    if (!match) {
      errors.push({
        path: "SKILL.md",
        code: "FRONTMATTER_INVALID",
        message: `frontmatter 第 ${index + 1} 行不是受支持的 YAML 字段`,
      });
      continue;
    }
    const key = match[1];
    if (key !== "name" && key !== "description") {
      errors.push({
        path: "SKILL.md",
        code: "FRONTMATTER_UNKNOWN_KEY",
        message: `frontmatter 不允许字段 ${key}`,
      });
      continue;
    }
    if (fields.has(key)) {
      errors.push({
        path: "SKILL.md",
        code: "FRONTMATTER_DUPLICATE_KEY",
        message: `frontmatter 字段 ${key} 重复`,
      });
      continue;
    }
    const scalar = parseScalar(match[2] ?? "");
    if (scalar === undefined) {
      errors.push({
        path: "SKILL.md",
        code: "FRONTMATTER_INVALID_VALUE",
        message: `frontmatter 字段 ${key} 必须是非空单行字符串`,
      });
      continue;
    }
    fields.set(key, scalar);
  }

  if (!fields.has("name")) {
    errors.push({
      path: "SKILL.md",
      code: "NAME_MISSING",
      message: "frontmatter 缺少 name",
    });
  }
  if (!fields.has("description")) {
    errors.push({
      path: "SKILL.md",
      code: "DESCRIPTION_MISSING",
      message: "frontmatter 缺少 description",
    });
  }
  return {
    name: fields.get("name"),
    description: fields.get("description"),
    errors,
  };
}

function validateOpenAiYaml(
  text: string,
  skillName: string | undefined,
): {
  errors: SkillDraftValidationItem[];
  warnings: SkillDraftValidationItem[];
} {
  const path = "agents/openai.yaml";
  const errors: SkillDraftValidationItem[] = [];
  const warnings: SkillDraftValidationItem[] = [];

  let parsed: unknown;
  try {
    const document = parseDocument(text, {
      prettyErrors: false,
      uniqueKeys: true,
    });
    if (document.errors.length > 0) {
      errors.push({
        path,
        code: "OPENAI_YAML_INVALID",
        message: `agents/openai.yaml 语法无效: ${document.errors[0].message}`,
      });
      return { errors, warnings };
    }
    parsed = document.toJS({ maxAliasCount: 0 });
  } catch (cause) {
    errors.push({
      path,
      code: "OPENAI_YAML_INVALID",
      message: `agents/openai.yaml 解析失败: ${
        cause instanceof Error ? cause.message : String(cause)
      }`,
    });
    return { errors, warnings };
  }

  if (!isRecord(parsed)) {
    errors.push({
      path,
      code: "OPENAI_DOCUMENT_INVALID",
      message: "agents/openai.yaml 顶层必须是对象",
    });
    return { errors, warnings };
  }
  if (!Object.hasOwn(parsed, "interface")) {
    errors.push({
      path,
      code: "OPENAI_INTERFACE_MISSING",
      message: "agents/openai.yaml 缺少 interface",
    });
    return { errors, warnings };
  }
  const interfaceValue = parsed.interface;
  if (!isRecord(interfaceValue)) {
    errors.push({
      path,
      code: "OPENAI_INTERFACE_INVALID",
      message: "agents/openai.yaml 的 interface 必须是对象",
    });
    return { errors, warnings };
  }

  const values = new Map<string, string>();
  for (const key of ["display_name", "short_description", "default_prompt"]) {
    if (!Object.hasOwn(interfaceValue, key)) {
      errors.push({
        path,
        code: "OPENAI_FIELD_MISSING",
        message: `interface.${key} 必须存在且为字符串`,
      });
      continue;
    }
    const value = interfaceValue[key];
    if (typeof value !== "string" || !value.trim()) {
      errors.push({
        path,
        code: "OPENAI_FIELD_INVALID",
        message: `interface.${key} 必须是非空字符串`,
      });
      continue;
    }
    values.set(key, value);
  }
  if (
    skillName && values.has("default_prompt") &&
    !values.get("default_prompt")!.includes(`$${skillName}`)
  ) {
    warnings.push({
      path,
      code: "OPENAI_PROMPT_SKILL_REFERENCE",
      message: `default_prompt 建议引用 $${skillName}`,
    });
  }
  return { errors, warnings };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function validMetadata(
  value: unknown,
  expectedId?: string,
): value is SkillDraftMetadata {
  if (!isRecord(value)) return false;
  const metadata = value as Record<string, unknown>;
  const allowed = new Set([
    "id",
    "conversationId",
    "status",
    "skillName",
    "revisionOf",
    "revisionBaseDigest",
    "revisionCreatedAt",
    "createdAt",
    "updatedAt",
    "installedAt",
    "validation",
  ]);
  if (Object.keys(metadata).some((key) => !allowed.has(key))) return false;
  if (
    typeof metadata.id !== "string" || !UUID_PATTERN.test(metadata.id) ||
    (expectedId !== undefined && metadata.id !== expectedId) ||
    typeof metadata.conversationId !== "string" ||
    !metadata.conversationId || metadata.conversationId.includes("\0") ||
    !["editing", "valid", "installed"].includes(String(metadata.status)) ||
    !isSafeTimestamp(metadata.createdAt) ||
    !isSafeTimestamp(metadata.updatedAt) ||
    metadata.createdAt > metadata.updatedAt
  ) {
    return false;
  }
  if (
    metadata.skillName !== undefined &&
    (typeof metadata.skillName !== "string" ||
      metadata.skillName.length > 64 ||
      !SKILL_NAME_PATTERN.test(metadata.skillName))
  ) {
    return false;
  }
  const hasRevision = metadata.revisionOf !== undefined ||
    metadata.revisionBaseDigest !== undefined ||
    metadata.revisionCreatedAt !== undefined;
  if (hasRevision) {
    if (
      typeof metadata.revisionOf !== "string" ||
      !SKILL_NAME_PATTERN.test(metadata.revisionOf) ||
      typeof metadata.revisionBaseDigest !== "string" ||
      !/^[0-9a-f]{64}$/.test(metadata.revisionBaseDigest) ||
      !isSafeTimestamp(metadata.revisionCreatedAt) ||
      metadata.revisionCreatedAt < metadata.createdAt ||
      metadata.revisionCreatedAt > metadata.updatedAt ||
      metadata.status === "installed"
    ) {
      return false;
    }
  }
  if (
    metadata.installedAt !== undefined &&
    !isSafeTimestamp(metadata.installedAt)
  ) {
    return false;
  }
  if (
    metadata.validation !== undefined &&
    !validStoredValidation(metadata.validation)
  ) {
    return false;
  }
  if (metadata.status === "editing") {
    return metadata.skillName === undefined &&
      metadata.installedAt === undefined &&
      (metadata.validation === undefined ||
        metadata.validation.valid === false);
  }
  if (
    typeof metadata.skillName !== "string" ||
    !isRecord(metadata.validation) ||
    metadata.validation.valid !== true
  ) {
    return false;
  }
  if (metadata.status === "valid") {
    return metadata.installedAt === undefined &&
      (!hasRevision || metadata.skillName === metadata.revisionOf);
  }
  return isSafeTimestamp(metadata.installedAt) &&
    metadata.installedAt >= metadata.createdAt;
}

function isSafeTimestamp(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function validStoredValidation(value: unknown): value is SkillDraftValidation {
  if (!isRecord(value)) return false;
  if (
    Object.keys(value).some((key) =>
      !["valid", "errors", "warnings", "checkedAt"].includes(key)
    ) ||
    typeof value.valid !== "boolean" ||
    !Array.isArray(value.errors) ||
    !Array.isArray(value.warnings) ||
    !isSafeTimestamp(value.checkedAt)
  ) {
    return false;
  }
  return [...value.errors, ...value.warnings].every((item) => {
    if (!isRecord(item)) return false;
    if (
      Object.keys(item).some((key) =>
        !["path", "code", "message"].includes(key)
      )
    ) {
      return false;
    }
    return (item.path === undefined || typeof item.path === "string") &&
      typeof item.code === "string" && !!item.code &&
      typeof item.message === "string" && !!item.message;
  });
}

export function createSkillDraftStore(
  root: string,
  options: SkillDraftStoreOptions = {},
): SkillDraftStore {
  const resolvedRoot = resolve(root);
  const draftsDirectory = resolve(resolvedRoot, "skill-drafts");
  const skillsDirectory = resolve(resolvedRoot, "skills");
  const locksDirectory = resolve(draftsDirectory, ".locks");
  installedSkillNameLockExecutors.set(
    skillsDirectory,
    async <T>(
      name: string,
      action: InstalledSkillNameLockAction<T>,
    ): Promise<T> => {
      if (!SAFE_INSTALLED_SKILL_BASENAME_PATTERN.test(name)) {
        throw error("INVALID_SKILL_NAME", 400, "技能名称无效");
      }
      const skillLockHash = await stableHash(name.toLowerCase());
      return await withFilesystemLock(
        `skill-${skillLockHash}`,
        () =>
          action(async () => {
            const guard = activeLockGuard.getStore();
            if (!guard) {
              throw error("DRAFT_LOCK_LOST", 409, "技能名称锁上下文缺失");
            }
            await guard.assertOwned();
          }),
      );
    },
  );

  async function ensurePrivateDirectory(path: string): Promise<void> {
    try {
      await mkdir(path, { mode: 0o700 });
    } catch (cause) {
      if (!((cause as { code?: string }).code === "EEXIST")) throw cause;
    }
    await assertRegularDirectory(path, "私有目录");
    if (platformOs !== "windows") await chmod(path, 0o700);
  }

  async function ensurePrivateFileMode(path: string): Promise<void> {
    if (platformOs !== "windows") await chmod(path, 0o600);
  }

  function sameFileIdentity(
    left: Stats,
    right: Stats,
  ): boolean {
    if (
      left.dev !== null && left.ino !== null && right.dev !== null &&
      right.ino !== null
    ) {
      return left.dev === right.dev && left.ino === right.ino;
    }
    return left.size === right.size &&
      left.mtime?.getTime() === right.mtime?.getTime() &&
      left.birthtime?.getTime() === right.birthtime?.getTime();
  }

  async function readStableRegularFile(
    path: string,
    limit = BINARY_FILE_LIMIT,
  ): Promise<Uint8Array> {
    const before = await lstat(path);
    if (before.isSymbolicLink() || !before.isFile()) {
      throw error("UNSAFE_FILESYSTEM_ENTRY", 400, "文件不是普通文件");
    }
    if (before.size > limit) {
      throw error("FILE_TOO_LARGE", 413, "技能草稿文件过大");
    }
    const file = await open(path, "r");
    try {
      const opened = await file.stat();
      if (!opened.isFile() || !sameFileIdentity(before, opened)) {
        throw error("SOURCE_CHANGED", 409, "技能草稿文件在读取前被替换");
      }
      const bytes = new Uint8Array(opened.size);
      let offset = 0;
      while (offset < bytes.length) {
        const { bytesRead } = await file.read(bytes.subarray(offset));
        if (bytesRead === 0) break;
        offset += bytesRead;
      }
      if (offset !== bytes.length) {
        throw error("SOURCE_CHANGED", 409, "技能草稿文件在读取时发生变化");
      }
      const afterPath = await lstat(path);
      const afterFile = await file.stat();
      if (
        afterPath.isSymbolicLink() || !afterPath.isFile() ||
        !sameFileIdentity(opened, afterPath) ||
        !sameFileIdentity(opened, afterFile) ||
        afterFile.size !== bytes.length
      ) {
        throw error("SOURCE_CHANGED", 409, "技能草稿文件在读取时被替换");
      }
      return bytes;
    } finally {
      file.close();
    }
  }

  async function atomicWritePrivateFile(
    target: string,
    bytes: Uint8Array,
    fenced = true,
  ): Promise<void> {
    const parent = resolve(target, "..");
    assertWithin(resolvedRoot, parent);
    await assertRegularDirectory(parent, "私有文件父目录");
    if (platformOs !== "windows") await chmod(parent, 0o700);
    const beforeParent = await lstat(parent);
    const temporary = join(parent, `.tmp-${crypto.randomUUID()}`);
    assertWithin(parent, temporary);
    const file = await open(temporary, "wx", 0o600);
    let renamed = false;
    try {
      let offset = 0;
      while (offset < bytes.length) {
        const { bytesWritten } = await file.write(bytes.subarray(offset));
        offset += bytesWritten;
      }
      await file.sync();
      const writtenFile = await file.stat();
      file.close();
      if (platformOs !== "windows") await chmod(temporary, 0o600);
      const afterParent = await lstat(parent);
      const temporaryStat = await lstat(temporary);
      if (
        afterParent.isSymbolicLink() || !afterParent.isDirectory() ||
        !sameFileIdentity(beforeParent, afterParent) ||
        temporaryStat.isSymbolicLink() || !temporaryStat.isFile() ||
        !sameFileIdentity(writtenFile, temporaryStat)
      ) {
        throw error("SOURCE_CHANGED", 409, "技能草稿写入路径在写入时被替换");
      }
      if (fenced) {
        await options.testHooks?.beforeAtomicCommit?.(target);
        await activeLockGuard.getStore()?.assertOwned();
      }
      await rename(temporary, target);
      renamed = true;
      if (platformOs !== "windows") await chmod(target, 0o600);
      if (fenced) await activeLockGuard.getStore()?.assertOwned();
    } finally {
      try {
        file.close();
      } catch {
        // Already closed after flushing.
      }
      if (!renamed) {
        try {
          await rm(temporary);
        } catch (cause) {
          if (!isNotFound(cause)) console.warn("清理私有临时文件失败", cause);
        }
      }
    }
  }

  async function withFilesystemLock<T>(
    lockName: string,
    action: () => Promise<T>,
  ): Promise<T> {
    await ensurePrivateDirectory(resolvedRoot);
    await ensurePrivateDirectory(draftsDirectory);
    await ensurePrivateDirectory(locksDirectory);
    const lockPath = join(locksDirectory, `${lockName}.lock`);
    assertWithin(locksDirectory, lockPath);
    return await withModuleMutex(
      `${resolvedRoot}:${lockName}`,
      async () => {
        const leaseMs = Math.max(options.lockLeaseMs ?? 5_000, 60);
        const graceMs = leaseMs;
        const heartbeatMs = Math.min(
          options.lockHeartbeatMs ?? Math.floor(leaseMs / 3),
          Math.floor(leaseMs / 3),
        );
        const deadline = Date.now() +
          (options.lockTimeoutMs ?? LOCK_TIMEOUT_MS);
        const token = crypto.randomUUID();
        const writeOwner = async (
          directory: string,
          createdAt: number,
        ): Promise<void> => {
          await atomicWritePrivateFile(
            join(directory, "owner.json"),
            new TextEncoder().encode(JSON.stringify({
              token,
              pid: process.pid,
              createdAt,
              expiresAt: Date.now() + leaseMs,
            })),
            false,
          );
        };
        let createdAt = 0;
        await cleanupExpiredLockCandidates(lockName, leaseMs + graceMs);
        while (true) {
          const candidate = join(
            locksDirectory,
            `${lockName}.candidate-${crypto.randomUUID()}`,
          );
          assertWithin(locksDirectory, candidate);
          let createdLock = false;
          try {
            await mkdir(candidate, { mode: 0o700 });
            createdLock = true;
            if (platformOs !== "windows") {
              await chmod(candidate, 0o700);
            }
            createdAt = Date.now();
            await writeOwner(candidate, createdAt);
            await options.testHooks?.afterLockCandidatePrepared?.(
              lockName,
              candidate,
            );
            try {
              await lstat(lockPath);
              throw error("LOCK_OCCUPIED", 409, "技能草稿锁已存在");
            } catch (cause) {
              if (!isNotFound(cause)) throw cause;
            }
            await rename(candidate, lockPath);
            createdLock = false;
            break;
          } catch (cause) {
            if (createdLock) {
              try {
                await rm(candidate, { recursive: true });
              } catch (cleanupCause) {
                if (!isNotFound(cleanupCause)) {
                  console.warn("清理未完成的技能草稿锁失败", cleanupCause);
                }
              }
              if (!isRenameCollision(cause)) throw cause;
            }
            const recovered = await tryRecoverExpiredLock(
              lockPath,
              leaseMs,
              graceMs,
            );
            if (recovered) continue;
            if (Date.now() >= deadline) {
              throw error(
                "DRAFT_BUSY",
                409,
                "技能草稿正由另一个操作处理，请稍后重试",
              );
            }
            await new Promise((resolveWait) => setTimeout(resolveWait, 10));
          }
        }
        let lockLost = false;
        const inheritedGuard = activeLockGuard.getStore();
        let ownerIo = Promise.resolve();
        const withOwnerIo = async <R>(
          operation: () => Promise<R>,
        ): Promise<R> => {
          const previous = ownerIo;
          let releaseOwner!: () => void;
          ownerIo = new Promise<void>((resolveOwner) => {
            releaseOwner = resolveOwner;
          });
          await previous;
          try {
            return await operation();
          } finally {
            releaseOwner();
          }
        };
        const guard: ActiveLockGuard = {
          assertOwned: () =>
            withOwnerIo(async () => {
              await inheritedGuard?.assertOwned();
              if (lockLost) {
                throw error(
                  "DRAFT_LOCK_LOST",
                  409,
                  "技能草稿锁已丢失，操作已停止",
                );
              }
              let owner: LockOwner | undefined;
              try {
                owner = await readLockOwner(lockPath);
              } catch {
                lockLost = true;
              }
              if (
                !owner || owner.token !== token ||
                owner.expiresAt <= Date.now()
              ) {
                lockLost = true;
                throw error(
                  "DRAFT_LOCK_LOST",
                  409,
                  "技能草稿锁已丢失，操作已停止",
                );
              }
            }),
        };
        let heartbeat = Promise.resolve();
        const heartbeatTimer = setInterval(() => {
          if (lockLost) return;
          heartbeat = heartbeat.then(async () => {
            await guard.assertOwned();
            await withOwnerIo(() => writeOwner(lockPath, createdAt));
          }).catch((cause) => {
            lockLost = true;
            if (
              !(cause instanceof SkillDraftError &&
                cause.code === "DRAFT_LOCK_LOST")
            ) {
              console.warn("续租技能草稿锁失败", cause);
            }
          });
        }, Math.max(heartbeatMs, 20));
        try {
          return await activeLockGuard.run(guard, async () => {
            await guard.assertOwned();
            const result = await action();
            await guard.assertOwned();
            return result;
          });
        } finally {
          clearInterval(heartbeatTimer);
          await heartbeat;
          try {
            const owner = await readLockOwner(lockPath);
            if (owner?.token === token) {
              await rm(lockPath, { recursive: true });
            }
          } catch (cause) {
            if (!isNotFound(cause)) {
              console.warn("释放技能草稿锁失败", cause);
            }
          }
        }
      },
    );
  }

  interface LockOwner {
    token: string;
    pid: number;
    createdAt: number;
    expiresAt: number;
  }

  async function readLockOwner(
    lockPath: string,
  ): Promise<LockOwner | undefined> {
    try {
      const value: unknown = JSON.parse(
        new TextDecoder().decode(
          await readStableRegularFile(
            join(lockPath, "owner.json"),
            TEXT_FILE_LIMIT,
          ),
        ),
      );
      if (
        !isRecord(value) ||
        Object.keys(value).some((key) =>
          !["token", "pid", "createdAt", "expiresAt"].includes(key)
        ) ||
        typeof value.token !== "string" ||
        !UUID_PATTERN.test(value.token) ||
        !Number.isSafeInteger(value.pid) ||
        !isSafeTimestamp(value.createdAt) ||
        !isSafeTimestamp(value.expiresAt) ||
        value.expiresAt < value.createdAt
      ) {
        return undefined;
      }
      return value as unknown as LockOwner;
    } catch (cause) {
      if (isNotFound(cause) || cause instanceof SyntaxError) return undefined;
      throw cause;
    }
  }

  async function tryRecoverExpiredLock(
    lockPath: string,
    leaseMs: number,
    graceMs: number,
  ): Promise<boolean> {
    let lockStat: Stats;
    try {
      lockStat = await lstat(lockPath);
    } catch (cause) {
      if (isNotFound(cause)) return true;
      throw cause;
    }
    if (lockStat.isSymbolicLink() || !lockStat.isDirectory()) return false;
    let owner: LockOwner | undefined;
    try {
      owner = await readLockOwner(lockPath);
    } catch (cause) {
      if (
        cause instanceof SkillDraftError && cause.code === "SOURCE_CHANGED"
      ) {
        return false;
      }
      throw cause;
    }
    const staleAt = owner
      ? owner.expiresAt + graceMs
      : (lockStat.mtime?.getTime() ?? Date.now()) + leaseMs + graceMs;
    if (staleAt >= Date.now()) return false;
    const quarantine = `${lockPath}.quarantine-${crypto.randomUUID()}`;
    assertWithin(locksDirectory, quarantine);
    try {
      await rename(lockPath, quarantine);
    } catch (cause) {
      if (isNotFound(cause) || isRenameCollision(cause)) return true;
      throw cause;
    }
    const quarantinedStat = await lstat(quarantine);
    if (!sameFileIdentity(lockStat, quarantinedStat)) {
      throw error("DRAFT_LOCK_LOST", 409, "锁目录在恢复时被替换");
    }
    const quarantinedOwner = await readLockOwner(quarantine);
    const quarantineStaleAt = quarantinedOwner
      ? quarantinedOwner.expiresAt + graceMs
      : (quarantinedStat.mtime?.getTime() ?? Date.now()) + leaseMs + graceMs;
    if (quarantineStaleAt < Date.now()) {
      await rm(quarantine, { recursive: true });
      return true;
    }
    try {
      await rename(quarantine, lockPath);
    } catch (cause) {
      if (!isRenameCollision(cause)) throw cause;
    }
    return false;
  }

  async function cleanupExpiredLockCandidates(
    lockName: string,
    staleAfterMs: number,
  ): Promise<void> {
    const prefix = `${lockName}.candidate-`;
    const entries = [];
    for (const entry of await readdir(locksDirectory, { withFileTypes: true })) entries.push(entry);
    for (const entry of entries) {
      if (!entry.name.startsWith(prefix)) continue;
      const suffix = entry.name.slice(prefix.length);
      if (!UUID_PATTERN.test(suffix)) continue;
      const path = join(locksDirectory, entry.name);
      const stat = await lstat(path);
      if (
        stat.isSymbolicLink() || !stat.isDirectory() ||
        (stat.mtime?.getTime() ?? Date.now()) + staleAfterMs >= Date.now()
      ) {
        continue;
      }
      const quarantine = `${path}.quarantine-${crypto.randomUUID()}`;
      try {
        await rename(path, quarantine);
      } catch (cause) {
        if (isNotFound(cause) || isRenameCollision(cause)) continue;
        throw cause;
      }
      const moved = await lstat(quarantine);
      if (sameFileIdentity(stat, moved)) {
        await rm(quarantine, { recursive: true });
      } else {
        try {
          await rename(quarantine, path);
        } catch (cause) {
          if (!isRenameCollision(cause)) throw cause;
        }
      }
    }
  }

  function draftDirectory(id: string): string {
    validateDraftId(id);
    const path = resolve(draftsDirectory, id);
    assertWithin(draftsDirectory, path);
    return path;
  }

  function packageDirectory(id: string): string {
    return join(draftDirectory(id), "package");
  }

  async function persist(metadata: SkillDraftMetadata): Promise<void> {
    const directory = draftDirectory(metadata.id);
    await assertRegularDirectory(directory, "草稿目录");
    const path = join(directory, "draft.json");
    await atomicWritePrivateFile(
      path,
      new TextEncoder().encode(JSON.stringify(metadata, null, 2)),
    );
  }

  async function readInstallIntent(
    metadata: SkillDraftMetadata,
  ): Promise<
    {
      mode: "create" | "replace";
      name: string;
      token: string;
      staging: string;
      backup?: string;
    } | undefined
  > {
    const journalPath = join(
      draftDirectory(metadata.id),
      "install-intent.json",
    );
    let journal: unknown;
    try {
      journal = JSON.parse(
        new TextDecoder().decode(
          await readStableRegularFile(journalPath, TEXT_FILE_LIMIT),
        ),
      );
    } catch (cause) {
      if (isNotFound(cause)) return undefined;
      if (cause instanceof SyntaxError) {
        throw error("DRAFT_CORRUPT", 500, "技能安装恢复记录无效", cause);
      }
      throw cause;
    }
    if (
      !isRecord(journal) ||
      Object.keys(journal).some((key) =>
        !["mode", "name", "token", "staging", "backup"].includes(key)
      ) ||
      (journal.mode !== undefined &&
        journal.mode !== "create" && journal.mode !== "replace") ||
      typeof journal.name !== "string" ||
      !SKILL_NAME_PATTERN.test(journal.name) ||
      typeof journal.token !== "string" ||
      !UUID_PATTERN.test(journal.token) ||
      typeof journal.staging !== "string" ||
      journal.staging !== `.staging-${metadata.id}-${journal.token}` ||
      ((journal.mode === "replace") !== (typeof journal.backup === "string")) ||
      (typeof journal.backup === "string" &&
        journal.backup !== `.backup-${metadata.id}-${journal.token}`)
    ) {
      throw error("DRAFT_CORRUPT", 500, "技能安装恢复记录无效");
    }
    return {
      mode: journal.mode === "replace" ? "replace" : "create",
      name: journal.name,
      token: journal.token,
      staging: journal.staging,
      backup: typeof journal.backup === "string" ? journal.backup : undefined,
    };
  }

  async function removeIfPresent(path: string): Promise<void> {
    try {
      await rm(path);
    } catch (cause) {
      if (!isNotFound(cause)) throw cause;
    }
  }

  async function reconcileUnlocked(
    metadata: SkillDraftMetadata,
  ): Promise<SkillDraftMetadata> {
    const journalPath = join(
      draftDirectory(metadata.id),
      "install-intent.json",
    );
    const journal = await readInstallIntent(metadata);
    await cleanupOrphanStaging(metadata.id, journal?.staging);
    if (metadata.status === "installed") {
      const target = resolve(skillsDirectory, metadata.skillName!);
      assertWithin(skillsDirectory, target);
      try {
        await assertRegularDirectory(target, "已安装技能目录");
      } catch (cause) {
        if (
          isNotFound(cause) ||
          (cause instanceof SkillDraftError &&
            cause.code === "UNSAFE_FILESYSTEM_ENTRY")
        ) {
          throw error(
            "INSTALL_RECOVERY_ERROR",
            500,
            "已安装技能目录缺失，需要恢复",
          );
        }
        throw cause;
      }
      if (journal && journal.name !== metadata.skillName) {
        throw error("DRAFT_CORRUPT", 500, "技能安装恢复记录名称不一致");
      }
      const marker = join(target, ".pi-a-install-origin");
      let markerText: string | undefined;
      try {
        markerText = new TextDecoder().decode(
          await readStableRegularFile(marker, TEXT_FILE_LIMIT),
        );
      } catch (cause) {
        if (!isNotFound(cause)) throw cause;
      }
      if (markerText !== undefined) {
        const expected = journal
          ? `${metadata.id}:${journal.token}`
          : undefined;
        const token = markerText.slice(metadata.id.length + 1);
        if (
          (expected !== undefined && markerText !== expected) ||
          !markerText.startsWith(`${metadata.id}:`) ||
          !UUID_PATTERN.test(token)
        ) {
          throw error("INSTALL_RECOVERY_ERROR", 500, "安装恢复标记不匹配");
        }
        await removeIfPresent(marker);
      }
      if (journal?.mode === "replace" && journal.backup) {
        const backup = resolve(draftDirectory(metadata.id), journal.backup);
        assertWithin(draftDirectory(metadata.id), backup);
        try {
          const stat = await lstat(backup);
          if (stat.isSymbolicLink() || !stat.isDirectory()) {
            throw error(
              "INSTALL_RECOVERY_ERROR",
              500,
              "技能更新备份目录不安全",
            );
          }
          await rm(backup, { recursive: true });
        } catch (cause) {
          if (!isNotFound(cause)) throw cause;
        }
      }
      if (journal) await removeIfPresent(journalPath);
      return metadata;
    }
    if (!journal) return metadata;
    const target = resolve(skillsDirectory, journal.name);
    assertWithin(skillsDirectory, target);
    const marker = join(target, ".pi-a-install-origin");
    if (journal.mode === "replace" && journal.backup) {
      const backup = resolve(draftDirectory(metadata.id), journal.backup);
      const staging = resolve(draftDirectory(metadata.id), journal.staging);
      assertWithin(draftDirectory(metadata.id), backup);
      assertWithin(draftDirectory(metadata.id), staging);
      let targetExists = false;
      let targetHasMarker = false;
      try {
        await assertRegularDirectory(target, "待恢复技能目录");
        targetExists = true;
        try {
          targetHasMarker = new TextDecoder().decode(
            await readStableRegularFile(marker, TEXT_FILE_LIMIT),
          ) === `${metadata.id}:${journal.token}`;
        } catch (cause) {
          if (!isNotFound(cause)) throw cause;
        }
      } catch (cause) {
        if (!isNotFound(cause)) throw cause;
      }
      let backupExists = false;
      try {
        await assertRegularDirectory(backup, "技能更新备份目录");
        backupExists = true;
      } catch (cause) {
        if (!isNotFound(cause)) throw cause;
      }

      if (targetExists && targetHasMarker) {
        const validation = metadata.validation;
        if (
          metadata.status !== "valid" || !metadata.skillName ||
          !validation?.valid || metadata.skillName !== journal.name ||
          metadata.revisionOf !== journal.name
        ) {
          throw error("DRAFT_CORRUPT", 500, "技能更新恢复状态不一致");
        }
        const installedAt = Date.now();
        const installed: SkillDraftMetadata = {
          id: metadata.id,
          conversationId: metadata.conversationId,
          status: "installed",
          skillName: journal.name,
          createdAt: metadata.createdAt,
          updatedAt: installedAt,
          installedAt,
          validation,
        };
        await persist(installed);
        await removeIfPresent(marker);
        if (backupExists) await rm(backup, { recursive: true });
        await removeIfPresent(journalPath);
        return installed;
      }
      if (!targetExists && backupExists) {
        await activeLockGuard.getStore()?.assertOwned();
        await rename(backup, target);
        await cleanupOrphanStaging(metadata.id);
        await removeIfPresent(journalPath);
        return metadata;
      }
      if (targetExists && !targetHasMarker && !backupExists) {
        await cleanupOrphanStaging(metadata.id);
        await removeIfPresent(journalPath);
        return metadata;
      }
      throw error(
        "INSTALL_RECOVERY_ERROR",
        500,
        "技能更新事务状态异常，需要人工恢复",
      );
    }
    try {
      await assertRegularDirectory(target, "待恢复技能目录");
      const markerText = new TextDecoder().decode(
        await readStableRegularFile(marker, TEXT_FILE_LIMIT),
      );
      if (markerText !== `${metadata.id}:${journal.token}`) return metadata;
    } catch (cause) {
      if (isNotFound(cause)) {
        await cleanupOrphanStaging(metadata.id);
        await removeIfPresent(journalPath);
        return metadata;
      }
      throw cause;
    }
    const validation = metadata.validation;
    if (
      metadata.status !== "valid" || !metadata.skillName ||
      !validation?.valid || metadata.skillName !== journal.name
    ) {
      throw error("DRAFT_CORRUPT", 500, "技能安装恢复状态不一致");
    }
    const installedAt = Date.now();
    const installed: SkillDraftMetadata = {
      ...metadata,
      status: "installed",
      installedAt,
      updatedAt: installedAt,
    };
    await persist(installed);
    await removeIfPresent(marker);
    await removeIfPresent(journalPath);
    return installed;
  }

  async function cleanupOrphanStaging(
    id: string,
    preserve?: string,
  ): Promise<void> {
    const directory = draftDirectory(id);
    const prefix = `.staging-${id}-`;
    const entries = [];
    for (const entry of await readdir(directory, { withFileTypes: true })) entries.push(entry);
    for (const entry of entries) {
      if (entry.name === preserve || !entry.name.startsWith(prefix)) continue;
      const suffix = entry.name.slice(prefix.length);
      if (!UUID_PATTERN.test(suffix)) continue;
      const path = join(directory, entry.name);
      assertWithin(directory, path);
      const stat = await lstat(path);
      if (stat.isSymbolicLink() || !stat.isDirectory()) continue;
      await activeLockGuard.getStore()?.assertOwned();
      await rm(path, { recursive: true });
    }
  }

  async function getMetadataUnlocked(id: string): Promise<SkillDraftMetadata> {
    const directory = draftDirectory(id);
    try {
      await assertRegularDirectory(directory, "草稿目录");
      await assertRegularDirectory(join(directory, "package"), "草稿包目录");
      if (platformOs !== "windows") {
        await chmod(directory, 0o700);
        await chmod(join(directory, "package"), 0o700);
      }
      const metadataPath = join(directory, "draft.json");
      const stat = await lstat(metadataPath);
      if (stat.isSymbolicLink() || !stat.isFile()) {
        throw error("DRAFT_CORRUPT", 500, "草稿元数据不是普通文件");
      }
      await ensurePrivateFileMode(metadataPath);
      const value: unknown = JSON.parse(
        new TextDecoder().decode(
          await readStableRegularFile(metadataPath, TEXT_FILE_LIMIT),
        ),
      );
      if (!validMetadata(value, id)) {
        throw error("DRAFT_CORRUPT", 500, "草稿元数据无效");
      }
      return value;
    } catch (cause) {
      if (isNotFound(cause)) {
        throw error("DRAFT_NOT_FOUND", 404, "技能草稿不存在", cause);
      }
      if (cause instanceof SyntaxError) {
        throw error("DRAFT_CORRUPT", 500, "草稿元数据无效", cause);
      }
      throw cause;
    }
  }

  async function getUnlocked(id: string): Promise<SkillDraftMetadata> {
    return await reconcileUnlocked(await getMetadataUnlocked(id));
  }

  async function getWithLock(id: string): Promise<SkillDraftMetadata> {
    validateDraftId(id);
    return await withFilesystemLock(
      `draft-${id}`,
      () => getUnlocked(id),
    );
  }

  async function findOrCreateForConversation(
    conversationId: string,
    deterministicId: string,
  ): Promise<SkillDraftMetadata> {
    if (!conversationId || conversationId.includes("\0")) {
      throw error("INVALID_CONVERSATION_ID", 400, "会话 ID 无效");
    }
    await ensurePrivateDirectory(draftsDirectory);
    try {
      const existing = await getWithLock(deterministicId);
      if (existing.conversationId !== conversationId) {
        throw error("DRAFT_CORRUPT", 500, "确定性草稿归属不一致");
      }
      return existing;
    } catch (cause) {
      if (
        !(cause instanceof SkillDraftError) ||
        cause.code !== "DRAFT_NOT_FOUND"
      ) {
        throw cause;
      }
    }

    const now = Date.now();
    const metadata: SkillDraftMetadata = {
      id: deterministicId,
      conversationId,
      status: "editing",
      createdAt: now,
      updatedAt: now,
    };
    const directory = draftDirectory(metadata.id);
    await ensurePrivateDirectory(directory);
    await ensurePrivateDirectory(join(directory, "package"));
    await persist(metadata);
    return metadata;
  }

  async function getOrCreateForConversation(
    conversationId: string,
  ): Promise<SkillDraftMetadata> {
    if (!conversationId || conversationId.includes("\0")) {
      throw error("INVALID_CONVERSATION_ID", 400, "会话 ID 无效");
    }
    const hash = await stableHash(conversationId);
    return await withFilesystemLock(
      `conversation-${hash}`,
      () => findOrCreateForConversation(conversationId, uuidFromHash(hash)),
    );
  }

  async function packageTarget(
    id: string,
    inputPath: string,
  ): Promise<
    { metadata: SkillDraftMetadata; relativePath: string; path: string }
  > {
    const metadata = await getUnlocked(id);
    const relativePath = safeRelativePath(inputPath);
    const base = packageDirectory(id);
    const path = resolve(base, relativePath);
    assertWithin(base, path);
    await assertNoSymlinkAncestors(base, relativePath);
    return { metadata, relativePath, path };
  }

  async function ensurePackageParent(
    id: string,
    relativePath: string,
  ): Promise<void> {
    let current = packageDirectory(id);
    await assertRegularDirectory(current, "草稿包目录");
    for (const part of relativePath.split(sep).slice(0, -1)) {
      current = join(current, part);
      assertWithin(packageDirectory(id), current);
      await ensurePrivateDirectory(current);
    }
  }

  async function mutationMetadata(
    metadata: SkillDraftMetadata,
  ): Promise<void> {
    if (metadata.status === "installed") {
      throw error("DRAFT_INSTALLED", 409, "已安装的技能草稿不可修改");
    }
    const next: SkillDraftMetadata = {
      id: metadata.id,
      conversationId: metadata.conversationId,
      status: "editing",
      createdAt: metadata.createdAt,
      updatedAt: Date.now(),
    };
    if (
      metadata.revisionOf && metadata.revisionBaseDigest &&
      metadata.revisionCreatedAt !== undefined
    ) {
      next.revisionOf = metadata.revisionOf;
      next.revisionBaseDigest = metadata.revisionBaseDigest;
      next.revisionCreatedAt = metadata.revisionCreatedAt;
    }
    await persist(next);
  }

  async function listFilesAt(
    base: string,
    label: string,
  ): Promise<SkillDraftFile[]> {
    const files: SkillDraftFile[] = [];
    let totalSize = 0;

    async function walk(directory: string, prefix: string): Promise<void> {
      const directoryBefore = await lstat(directory);
      if (directoryBefore.isSymbolicLink() || !directoryBefore.isDirectory()) {
        throw error("UNSAFE_FILESYSTEM_ENTRY", 400, `${label}不是普通目录`);
      }
      const entries = [];
      for (const entry of await readdir(directory, { withFileTypes: true })) entries.push(entry);
      entries.sort((left, right) =>
        left.name < right.name ? -1 : left.name > right.name ? 1 : 0
      );
      for (const entry of entries) {
        const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;
        const fullPath = join(directory, entry.name);
        const stat = await lstat(fullPath);
        if (stat.isSymbolicLink()) {
          throw error(
            "UNSAFE_FILESYSTEM_ENTRY",
            400,
            `${label}包含符号链接: ${relativePath}`,
          );
        }
        if (stat.isDirectory()) {
          if (platformOs !== "windows") await chmod(fullPath, 0o700);
          await walk(fullPath, relativePath);
          continue;
        }
        if (!stat.isFile()) {
          throw error(
            "UNSAFE_FILESYSTEM_ENTRY",
            400,
            `${label}包含非普通文件: ${relativePath}`,
          );
        }
        await ensurePrivateFileMode(fullPath);
        const bytes = await readStableRegularFile(fullPath);
        totalSize += bytes.byteLength;
        if (totalSize > PACKAGE_SIZE_LIMIT) {
          throw error("PACKAGE_TOO_LARGE", 413, `${label}过大`);
        }
        files.push({
          path: relativePath,
          size: bytes.byteLength,
          binary: decodeDraftFile(relativePath, bytes).binary,
        });
      }
      const directoryAfter = await lstat(directory);
      if (
        directoryAfter.isSymbolicLink() || !directoryAfter.isDirectory() ||
        !sameFileIdentity(directoryBefore, directoryAfter)
      ) {
        throw error("SOURCE_CHANGED", 409, `${label}在列出时被替换`);
      }
    }
    await walk(base, "");
    return files.sort((left, right) =>
      left.path < right.path ? -1 : left.path > right.path ? 1 : 0
    );
  }

  async function listFilesUnlocked(id: string): Promise<SkillDraftFile[]> {
    await getUnlocked(id);
    return await listFilesAt(packageDirectory(id), "技能草稿目录");
  }

  async function initializeUnlocked(
    id: string,
    input: SkillDraftInitializeOptions,
  ): Promise<void> {
    const metadata = await getUnlocked(id);
    if (metadata.status === "installed") {
      throw error("DRAFT_INSTALLED", 409, "已安装的技能草稿不可修改");
    }
    if (
      input.name.length > 64 ||
      !SKILL_NAME_PATTERN.test(input.name)
    ) {
      throw error("INVALID_SKILL_NAME", 400, "技能名称格式无效");
    }
    if (
      !input.description.trim() ||
      input.description.length > 1024 ||
      /[\r\n<>]/.test(input.description)
    ) {
      throw error("INVALID_SKILL_DESCRIPTION", 400, "技能描述格式无效");
    }
    const resources = new Set(input.resources);
    if (
      resources.size !== input.resources.length ||
      input.resources.some((resource) =>
        !["scripts", "references", "assets"].includes(resource)
      )
    ) {
      throw error("INVALID_RESOURCE_DIRECTORY", 400, "技能资源目录无效");
    }
    const bytes = new TextEncoder().encode(input.skillMd);
    if (bytes.byteLength > TEXT_FILE_LIMIT) {
      throw error("TEXT_TOO_LARGE", 413, "草稿文本文件过大");
    }
    const frontmatter = parseSkillFrontmatter(input.skillMd);
    if (
      frontmatter.errors.length > 0 ||
      frontmatter.name !== input.name ||
      frontmatter.description !== input.description
    ) {
      throw error(
        "INVALID_SKILL_TEMPLATE",
        400,
        "SKILL.md frontmatter 与初始化参数不一致",
      );
    }

    const base = packageDirectory(id);
    const skillPath = join(base, "SKILL.md");
    try {
      await lstat(skillPath);
      throw error("ALREADY_INITIALIZED", 409, "当前草稿已初始化");
    } catch (cause) {
      if (!isNotFound(cause)) throw cause;
    }

    const createdResources: Array<{ path: string; stat: Stats }> = [];
    let skillWriteStarted = false;
    let createdSkillStat: Stats | undefined;
    let metadataWriteStarted = false;
    try {
      for (const resource of resources) {
        const path = join(base, resource);
        let created = false;
        try {
          await mkdir(path, { mode: 0o700 });
          created = true;
        } catch (cause) {
          if (!((cause as { code?: string }).code === "EEXIST")) throw cause;
        }
        await assertRegularDirectory(path, "技能资源目录");
        if (platformOs !== "windows") await chmod(path, 0o700);
        if (created) {
          createdResources.push({ path, stat: await lstat(path) });
        }
      }
      await assertNoSymlinkAncestors(base, "SKILL.md");
      skillWriteStarted = true;
      await atomicWritePrivateFile(skillPath, bytes);
      const skillStat = await lstat(skillPath);
      if (skillStat.isSymbolicLink() || !skillStat.isFile()) {
        throw error(
          "UNSAFE_FILESYSTEM_ENTRY",
          400,
          "初始化后的 SKILL.md 不是普通文件",
        );
      }
      createdSkillStat = skillStat;
      metadataWriteStarted = true;
      await mutationMetadata(metadata);
    } catch (cause) {
      try {
        const guard = activeLockGuard.getStore();
        await guard?.assertOwned();
        if (skillWriteStarted && createdSkillStat) {
          try {
            await guard?.assertOwned();
            const stat = await lstat(skillPath);
            if (
              !stat.isSymbolicLink() &&
              stat.isFile() &&
              sameFileIdentity(createdSkillStat, stat)
            ) {
              const actual = await readStableRegularFile(
                skillPath,
                TEXT_FILE_LIMIT,
              );
              const isInitializerFile =
                actual.byteLength === bytes.byteLength &&
                actual.every((byte, index) => byte === bytes[index]);
              if (isInitializerFile) {
                await guard?.assertOwned();
                await rm(skillPath);
              }
            }
          } catch (cleanupCause) {
            if (!isNotFound(cleanupCause)) throw cleanupCause;
          }
        }
        for (const created of createdResources.reverse()) {
          await guard?.assertOwned();
          try {
            const stat = await lstat(created.path);
            if (
              !stat.isSymbolicLink() &&
              stat.isDirectory() &&
              sameFileIdentity(created.stat, stat)
            ) {
              await rm(created.path);
            }
          } catch (cleanupCause) {
            if (
              !isNotFound(cleanupCause) &&
              !(cleanupCause instanceof Error &&
                ["DirectoryNotEmpty", "NotEmpty"].includes(
                  cleanupCause.name,
                )) &&
              !(
                cleanupCause instanceof Error &&
                (cleanupCause as Error & { code?: string }).code === "ENOTEMPTY"
              )
            ) {
              throw cleanupCause;
            }
          }
        }
        if (metadataWriteStarted) {
          await guard?.assertOwned();
          await persist(metadata);
        }
      } catch (cleanupCause) {
        console.warn(
          "回滚技能草稿初始化失败",
          cleanupCause instanceof SkillDraftError
            ? cleanupCause.code
            : cleanupCause instanceof Error
            ? cleanupCause.name
            : "Error",
        );
      }
      throw cause;
    }
  }

  async function readFileUnlocked(
    id: string,
    inputPath: string,
  ): Promise<SkillDraftReadResult> {
    const target = await packageTarget(id, inputPath);
    const bytes = await readStableRegularFile(target.path);
    const decoded = decodeDraftFile(target.relativePath, bytes);
    return { ...decoded, size: bytes.byteLength };
  }

  async function installedPackageDirectory(
    metadata: SkillDraftMetadata,
  ): Promise<string> {
    const name = metadata.status === "installed"
      ? metadata.skillName
      : metadata.revisionOf;
    if (!name) {
      throw error(
        "INSTALLED_SKILL_NOT_LINKED",
        409,
        "当前草稿没有关联已安装技能",
      );
    }
    const target = resolve(skillsDirectory, name);
    assertWithin(skillsDirectory, target);
    await assertRegularDirectory(target, "已安装技能目录");
    return target;
  }

  async function listInstalledFilesUnlocked(
    id: string,
  ): Promise<SkillDraftFile[]> {
    const metadata = await getUnlocked(id);
    return await listFilesAt(
      await installedPackageDirectory(metadata),
      "已安装技能目录",
    );
  }

  async function readInstalledFileUnlocked(
    id: string,
    inputPath: string,
  ): Promise<SkillDraftReadResult> {
    const metadata = await getUnlocked(id);
    const base = await installedPackageDirectory(metadata);
    const relativePath = safeRelativePath(inputPath);
    const target = resolve(base, relativePath);
    assertWithin(base, target);
    await assertNoSymlinkAncestors(base, relativePath);
    const bytes = await readStableRegularFile(target);
    const decoded = decodeDraftFile(relativePath, bytes);
    return { ...decoded, size: bytes.byteLength };
  }

  async function writeFileUnlocked(
    id: string,
    inputPath: string,
    content: string,
  ): Promise<void> {
    const bytes = new TextEncoder().encode(content);
    if (bytes.byteLength > TEXT_FILE_LIMIT) {
      throw error("TEXT_TOO_LARGE", 413, "草稿文本文件过大");
    }
    const target = await packageTarget(id, inputPath);
    if (target.metadata.status === "installed") {
      throw error("DRAFT_INSTALLED", 409, "已安装的技能草稿不可修改");
    }
    try {
      const existing = await lstat(target.path);
      if (existing.isSymbolicLink() || !existing.isFile()) {
        throw error("UNSAFE_FILESYSTEM_ENTRY", 400, "目标不是普通文件");
      }
    } catch (cause) {
      if (!isNotFound(cause)) throw cause;
    }
    await ensurePackageParent(id, target.relativePath);
    await assertNoSymlinkAncestors(packageDirectory(id), target.relativePath);
    await atomicWritePrivateFile(target.path, bytes);
    await mutationMetadata(target.metadata);
  }

  async function importAssetUnlocked(
    id: string,
    sourcePath: string,
    fileName: string,
  ): Promise<string> {
    const metadata = await getUnlocked(id);
    if (metadata.status === "installed") {
      throw error("DRAFT_INSTALLED", 409, "已安装的技能草稿不可修改");
    }
    if (!fileName || fileName.includes("\0")) {
      throw error("INVALID_ASSET_NAME", 400, "附件文件名无效");
    }
    const cleanName = basename(fileName.replaceAll("\\", "/")).trim();
    if (!cleanName || cleanName === "." || cleanName === "..") {
      throw error("INVALID_ASSET_NAME", 400, "附件文件名无效");
    }
    const source = await lstat(sourcePath);
    if (source.isSymbolicLink() || !source.isFile()) {
      throw error("UNSAFE_ASSET_SOURCE", 400, "附件源必须是普通文件");
    }
    if (source.size > BINARY_FILE_LIMIT) {
      throw error("FILE_TOO_LARGE", 413, "附件文件过大");
    }
    const target = await packageTarget(id, `assets/${cleanName}`);
    await ensurePackageParent(id, target.relativePath);
    await assertNoSymlinkAncestors(packageDirectory(id), target.relativePath);
    try {
      const existing = await lstat(target.path);
      if (existing.isSymbolicLink() || !existing.isFile()) {
        throw error("UNSAFE_FILESYSTEM_ENTRY", 400, "目标不是普通文件");
      }
    } catch (cause) {
      if (!isNotFound(cause)) throw cause;
    }
    const sourceBytes = await readStableRegularFile(
      sourcePath,
      BINARY_FILE_LIMIT,
    );
    await atomicWritePrivateFile(target.path, sourceBytes);
    await mutationMetadata(metadata);
    return target.relativePath.replaceAll(sep, "/");
  }

  async function deleteFileUnlocked(
    id: string,
    inputPath: string,
  ): Promise<void> {
    const metadata = await getUnlocked(id);
    if (metadata.status === "installed") {
      throw error("DRAFT_INSTALLED", 409, "已安装的技能草稿不可修改");
    }
    const relativePath = safeDeleteRelativePath(inputPath);
    const base = packageDirectory(id);
    const path = resolve(base, relativePath);
    assertWithin(base, path);
    await assertNoSymlinkAncestors(base, relativePath);
    const stat = await lstat(path);
    if (stat.isSymbolicLink() || (!stat.isFile() && !stat.isDirectory())) {
      throw error(
        "UNSAFE_FILESYSTEM_ENTRY",
        400,
        "只能删除普通草稿文件或安全的空目录",
      );
    }
    if (stat.isDirectory()) {
      const top = relativePath.split(sep)[0];
      if (!["scripts", "references", "assets"].includes(top)) {
        throw error("PATH_NOT_ALLOWED", 400, "不允许删除该技能目录");
      }
    }
    await activeLockGuard.getStore()?.assertOwned();
    const beforeRemove = await lstat(path);
    if (
      beforeRemove.isSymbolicLink() ||
      !sameFileIdentity(stat, beforeRemove) ||
      stat.isFile() !== beforeRemove.isFile() ||
      stat.isDirectory() !== beforeRemove.isDirectory()
    ) {
      throw error("SOURCE_CHANGED", 409, "草稿路径在删除前被替换");
    }
    try {
      await rm(path);
    } catch (cause) {
      const code = cause instanceof Error
        ? (cause as Error & { code?: string }).code
        : undefined;
      if (
        code === "ENOTEMPTY" ||
        code === "EEXIST" ||
        (cause instanceof Error &&
          ["DirectoryNotEmpty", "NotEmpty"].includes(cause.name))
      ) {
        throw error("DIRECTORY_NOT_EMPTY", 409, "只能删除空目录", cause);
      }
      throw cause;
    }
    await activeLockGuard.getStore()?.assertOwned();
    await mutationMetadata(metadata);
  }

  async function validatePackageDirectory(
    base: string,
  ): Promise<
    {
      validation: SkillDraftValidation;
      skillName?: string;
      manifest: Map<string, string>;
    }
  > {
    await assertRegularDirectory(base, "待校验技能包目录");
    const errors: SkillDraftValidationItem[] = [];
    const warnings: SkillDraftValidationItem[] = [];
    let totalSize = 0;
    const manifest = new Map<string, string>();
    let skillText: string | undefined;
    let openAiText: string | undefined;

    async function inspect(directory: string, prefix: string): Promise<void> {
      const directoryBefore = await lstat(directory);
      if (directoryBefore.isSymbolicLink() || !directoryBefore.isDirectory()) {
        throw error("UNSAFE_FILESYSTEM_ENTRY", 400, "待校验目录不是普通目录");
      }
      const entries = [];
      for (const entry of await readdir(directory, { withFileTypes: true })) entries.push(entry);
      entries.sort((left, right) => left.name.localeCompare(right.name));
      for (const entry of entries) {
        const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;
        const fullPath = join(directory, entry.name);
        const stat = await lstat(fullPath);
        if (stat.isSymbolicLink()) {
          errors.push({
            path: relativePath,
            code: "SYMLINK_NOT_ALLOWED",
            message: "技能包不允许符号链接",
          });
          continue;
        }
        if (stat.isDirectory()) {
          if (platformOs !== "windows") await chmod(fullPath, 0o700);
          const top = relativePath.split("/")[0];
          if (!ALLOWED_TOP_LEVEL_DIRECTORIES.has(top)) {
            errors.push({
              path: relativePath,
              code: "PATH_NOT_ALLOWED",
              message: "技能包包含不允许的目录",
            });
          }
          await inspect(fullPath, relativePath);
          continue;
        }
        if (!stat.isFile()) {
          errors.push({
            path: relativePath,
            code: "SPECIAL_FILE_NOT_ALLOWED",
            message: "技能包只允许普通文件",
          });
          continue;
        }
        await ensurePrivateFileMode(fullPath);
        totalSize += stat.size;
        if (stat.size > BINARY_FILE_LIMIT || totalSize > PACKAGE_SIZE_LIMIT) {
          errors.push({
            path: relativePath,
            code: stat.size > BINARY_FILE_LIMIT
              ? "FILE_TOO_LARGE"
              : "PACKAGE_TOO_LARGE",
            message: "技能草稿文件或包大小超过限制",
          });
          continue;
        }
        const stableBytes = await readStableRegularFile(fullPath);
        manifest.set(relativePath, await stableHashBytes(stableBytes));
        if (/^(?:README|CHANGELOG)(?:\.|$)/i.test(entry.name)) {
          errors.push({
            path: relativePath,
            code: "EXTRANEOUS_DOCUMENT",
            message: "技能包不允许 README 或 CHANGELOG",
          });
        }
        try {
          safeRelativePath(relativePath);
        } catch (cause) {
          errors.push({
            path: relativePath,
            code: cause instanceof SkillDraftError
              ? cause.code
              : "PATH_NOT_ALLOWED",
            message: "技能包包含不允许的文件路径",
          });
          continue;
        }
        if (relativePath === "SKILL.md") {
          const decoded = decodeBytes(stableBytes);
          if (decoded.binary) {
            errors.push({
              path: relativePath,
              code: "SKILL_FILE_BINARY",
              message: "SKILL.md 必须是 UTF-8 文本",
            });
          } else {
            skillText = decoded.text;
          }
        } else if (relativePath === "agents/openai.yaml") {
          const decoded = decodeBytes(stableBytes);
          if (decoded.binary) {
            errors.push({
              path: relativePath,
              code: "OPENAI_YAML_BINARY",
              message: "agents/openai.yaml 必须是 UTF-8 文本",
            });
          } else {
            openAiText = decoded.text;
          }
        }
      }
      const directoryAfter = await lstat(directory);
      if (
        directoryAfter.isSymbolicLink() || !directoryAfter.isDirectory() ||
        !sameFileIdentity(directoryBefore, directoryAfter)
      ) {
        throw error("SOURCE_CHANGED", 409, "技能包目录在校验时被替换");
      }
    }
    await inspect(base, "");
    if (skillText === undefined) {
      if (!errors.some((item) => item.path === "SKILL.md")) {
        errors.push({
          path: "SKILL.md",
          code: "SKILL_FILE_MISSING",
          message: "技能包缺少 SKILL.md",
        });
      }
    }

    let skillName: string | undefined;
    if (skillText !== undefined) {
      const parsed = parseSkillFrontmatter(skillText);
      errors.push(...parsed.errors);
      skillName = parsed.name;
      if (parsed.name !== undefined) {
        if (
          parsed.name.length > 64 || !SKILL_NAME_PATTERN.test(parsed.name)
        ) {
          errors.push({
            path: "SKILL.md",
            code: "NAME_INVALID",
            message:
              "技能 name 只能包含小写字母、数字和单个连字符，且长度不超过 64",
          });
        }
      }
      if (parsed.description !== undefined) {
        if (
          !parsed.description.trim() ||
          parsed.description.length > 1024 ||
          parsed.description.includes("<") ||
          parsed.description.includes(">")
        ) {
          errors.push({
            path: "SKILL.md",
            code: "DESCRIPTION_INVALID",
            message: "技能 description 必须非空、不含尖括号且不超过 1024 字符",
          });
        }
      }
    }

    if (openAiText !== undefined) {
      const openAiValidation = validateOpenAiYaml(openAiText, skillName);
      errors.push(...openAiValidation.errors);
      warnings.push(...openAiValidation.warnings);
    }
    const validation: SkillDraftValidation = {
      valid: errors.length === 0,
      errors,
      warnings,
      checkedAt: Date.now(),
    };
    return { validation, skillName, manifest };
  }

  async function validateUnlocked(id: string): Promise<SkillDraftValidation> {
    const metadata = await getUnlocked(id);
    if (metadata.status === "installed") {
      throw error("DRAFT_INSTALLED", 409, "已安装的技能草稿不可重复校验");
    }
    const { validation, skillName } = await validatePackageDirectory(
      packageDirectory(id),
    );
    if (
      validation.valid && metadata.revisionOf &&
      skillName !== metadata.revisionOf
    ) {
      validation.valid = false;
      validation.errors.push({
        path: "SKILL.md",
        code: "REVISION_NAME_CHANGED",
        message: `修订版必须保留原技能名称 ${metadata.revisionOf}`,
      });
    }
    const next: SkillDraftMetadata = {
      ...metadata,
      status: validation.valid ? "valid" : "editing",
      updatedAt: Date.now(),
      validation,
    };
    if (validation.valid) next.skillName = skillName;
    else delete next.skillName;
    await persist(next);
    return validation;
  }

  async function copyPackageSnapshot(
    id: string,
    sourceDirectory: string,
    destinationDirectory: string,
    prefix = "",
    copyOptions: { skipExtraneousDocs?: boolean } = {},
  ): Promise<void> {
    const directoryBefore = await lstat(sourceDirectory);
    if (directoryBefore.isSymbolicLink() || !directoryBefore.isDirectory()) {
      throw error("UNSAFE_FILESYSTEM_ENTRY", 400, "复制源不是普通目录");
    }
    const entries = [];
    for (const entry of await readdir(sourceDirectory, { withFileTypes: true })) {
      entries.push(entry);
    }
    entries.sort((left, right) =>
      left.name < right.name ? -1 : left.name > right.name ? 1 : 0
    );
    for (const entry of entries) {
      const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;
      const sourcePath = join(sourceDirectory, entry.name);
      const destinationPath = join(destinationDirectory, entry.name);
      const stat = await lstat(sourcePath);
      if (stat.isSymbolicLink() || (!stat.isFile() && !stat.isDirectory())) {
        throw error(
          "UNSAFE_FILESYSTEM_ENTRY",
          400,
          "安装时发现符号链接或特殊文件",
        );
      }
      if (stat.isDirectory()) {
        const top = relativePath.split("/")[0];
        if (!ALLOWED_TOP_LEVEL_DIRECTORIES.has(top)) {
          throw error(
            "PATH_NOT_ALLOWED",
            400,
            `安装时发现不允许的目录: ${relativePath}`,
          );
        }
        await ensurePrivateDirectory(destinationPath);
        await copyPackageSnapshot(
          id,
          sourcePath,
          destinationPath,
          relativePath,
          copyOptions,
        );
      } else {
        safeRelativePath(relativePath);
        if (/^(?:README|CHANGELOG)(?:\.|$)/i.test(entry.name)) {
          // 修订复制源可能是外部安装的技能（含 README），跳过而非拒绝。
          if (copyOptions.skipExtraneousDocs) continue;
          throw error(
            "EXTRANEOUS_DOCUMENT",
            400,
            `安装时发现不允许的文档: ${relativePath}`,
          );
        }
        await options.testHooks?.beforeCopyFile?.(
          id,
          relativePath,
          sourcePath,
        );
        const bytes = await readStableRegularFile(sourcePath);
        await atomicWritePrivateFile(destinationPath, bytes);
      }
    }
    const directoryAfter = await lstat(sourceDirectory);
    if (
      directoryAfter.isSymbolicLink() || !directoryAfter.isDirectory() ||
      !sameFileIdentity(directoryBefore, directoryAfter)
    ) {
      throw error("SOURCE_CHANGED", 409, "复制源目录在复制时被替换");
    }
  }

  async function createRevisionUnlocked(
    id: string,
  ): Promise<SkillDraftMetadata> {
    const before = await getUnlocked(id);
    if (before.status !== "installed" || !before.skillName) {
      throw error(
        "REVISION_SOURCE_REQUIRED",
        409,
        "只有已安装技能才能创建修订版",
      );
    }
    return await revisionFromInstalledUnlocked(id, before.skillName, {
      conversationId: before.conversationId,
      createdAt: before.createdAt,
    });
  }

  async function revisionFromInstalledUnlocked(
    id: string,
    name: string,
    nextMeta: { conversationId: string; createdAt: number },
  ): Promise<SkillDraftMetadata> {
    return await withInstalledSkillNameLock(skillsDirectory, name, async () => {
      const source = resolve(skillsDirectory, name);
      assertWithin(skillsDirectory, source);
      await assertRegularDirectory(source, "已安装技能目录");

      const sourceResult = await validatePackageDirectory(source);
      const token = crypto.randomUUID();
      const directory = draftDirectory(id);
      const staging = resolve(directory, `.revision-${id}-${token}`);
      const backup = resolve(directory, `.package-backup-${id}-${token}`);
      const currentPackage = packageDirectory(id);
      assertWithin(directory, staging);
      assertWithin(directory, backup);
      let packageMoved = false;
      let revisionPublished = false;
      try {
        await ensurePrivateDirectory(staging);
        await copyPackageSnapshot(id, source, staging, "", {
          skipExtraneousDocs: true,
        });
        const stagingResult = await validatePackageDirectory(staging);
        if (!sameManifest(sourceResult.manifest, stagingResult.manifest)) {
          throw error(
            "SOURCE_CHANGED",
            409,
            "已安装技能在创建修订版时发生变化，请重试",
          );
        }
        const now = Date.now();
        const next: SkillDraftMetadata = {
          id,
          conversationId: nextMeta.conversationId,
          status: "editing",
          revisionOf: name,
          revisionBaseDigest: await manifestDigest(sourceResult.manifest),
          revisionCreatedAt: now,
          createdAt: nextMeta.createdAt,
          updatedAt: now,
        };

        await activeLockGuard.getStore()?.assertOwned();
        await rename(currentPackage, backup);
        packageMoved = true;
        await activeLockGuard.getStore()?.assertOwned();
        await rename(staging, currentPackage);
        revisionPublished = true;
        await activeLockGuard.getStore()?.assertOwned();
        try {
          await persist(next);
        } catch (cause) {
          await activeLockGuard.getStore()?.assertOwned();
          await rename(currentPackage, staging);
          revisionPublished = false;
          await rename(backup, currentPackage);
          packageMoved = false;
          throw cause;
        }
        await rm(backup, { recursive: true });
        packageMoved = false;
        return next;
      } finally {
        if (packageMoved && !revisionPublished) {
          try {
            await rename(backup, currentPackage);
          } catch (cause) {
            if (!isNotFound(cause)) {
              console.warn("恢复技能草稿包失败", cause);
            }
          }
        }
        for (const temporary of [staging, backup]) {
          try {
            const stat = await lstat(temporary);
            if (!stat.isSymbolicLink() && stat.isDirectory()) {
              await rm(temporary, { recursive: true });
            }
          } catch (cause) {
            if (!isNotFound(cause)) {
              console.warn("清理技能修订临时目录失败", cause);
            }
          }
        }
      }
    });
  }

  async function installUnlocked(id: string): Promise<InstalledSkill> {
    const before = await getUnlocked(id);
    if (before.status === "installed") {
      throw error("DRAFT_ALREADY_INSTALLED", 409, "技能草稿已经安装");
    }
    const source = packageDirectory(id);
    const sourceResult = await validatePackageDirectory(source);
    if (
      sourceResult.validation.valid && before.revisionOf &&
      sourceResult.skillName !== before.revisionOf
    ) {
      sourceResult.validation.valid = false;
      sourceResult.validation.errors.push({
        path: "SKILL.md",
        code: "REVISION_NAME_CHANGED",
        message: `修订版必须保留原技能名称 ${before.revisionOf}`,
      });
    }
    if (!sourceResult.validation.valid || !sourceResult.skillName) {
      const next: SkillDraftMetadata = {
        ...before,
        status: "editing",
        updatedAt: Date.now(),
        validation: sourceResult.validation,
      };
      delete next.skillName;
      await persist(next);
      throw error("DRAFT_INVALID", 400, "技能草稿校验失败");
    }
    const metadata: SkillDraftMetadata = {
      ...before,
      status: "valid",
      skillName: sourceResult.skillName,
      updatedAt: Date.now(),
      validation: sourceResult.validation,
    };
    await persist(metadata);
    await options.testHooks?.afterSourceValidation?.(id);

    const name = sourceResult.skillName;
    const replacing = before.revisionOf !== undefined;
    return await withInstalledSkillNameLock(skillsDirectory, name, async () => {
      await ensurePrivateDirectory(skillsDirectory);
      const target = resolve(skillsDirectory, name);
      assertWithin(skillsDirectory, target);
      const assertReplacementBase = async (): Promise<void> => {
        if (!replacing) return;
        await assertRegularDirectory(target, "待更新技能目录");
        const current = await validatePackageDirectory(target);
        if (
          await manifestDigest(current.manifest) !== before.revisionBaseDigest
        ) {
          throw error(
            "INSTALLED_SKILL_CHANGED",
            409,
            "已安装内容在修订期间发生变化，请重新创建修订版后再安装",
          );
        }
      };
      if (replacing) {
        await assertReplacementBase();
      } else {
        try {
          await lstat(target);
          throw error("SKILL_CONFLICT", 409, `技能已存在: ${name}`);
        } catch (cause) {
          if (!isNotFound(cause)) throw cause;
        }
      }

      const token = crypto.randomUUID();
      const stagingName = `.staging-${id}-${token}`;
      const staging = resolve(draftDirectory(id), stagingName);
      const backupName = `.backup-${id}-${token}`;
      const backup = resolve(draftDirectory(id), backupName);
      assertWithin(draftDirectory(id), staging);
      assertWithin(draftDirectory(id), backup);
      const journalPath = join(draftDirectory(id), "install-intent.json");
      const markerName = ".pi-a-install-origin";
      let renamed = false;
      let backupCreated = false;
      const lockLostError = (cause?: unknown) =>
        error(
          "DRAFT_LOCK_LOST",
          409,
          "技能草稿锁已丢失，补偿操作已停止",
          cause,
        );
      const assertCompensationOwned = async (
        requireTargetMarker: boolean,
      ): Promise<void> => {
        await activeLockGuard.getStore()?.assertOwned();
        const intent = await readInstallIntent(metadata);
        if (
          !intent || intent.name !== name || intent.token !== token ||
          intent.staging !== stagingName ||
          intent.mode !== (replacing ? "replace" : "create") ||
          (replacing && intent.backup !== backupName)
        ) {
          throw lockLostError();
        }
        if (requireTargetMarker) {
          let markerText: string;
          try {
            markerText = new TextDecoder().decode(
              await readStableRegularFile(
                join(target, markerName),
                TEXT_FILE_LIMIT,
              ),
            );
          } catch (cause) {
            throw lockLostError(cause);
          }
          if (markerText !== `${id}:${token}`) throw lockLostError();
        }
        await activeLockGuard.getStore()?.assertOwned();
      };
      try {
        await ensurePrivateDirectory(staging);
        await assertRegularDirectory(source, "草稿包目录");
        await copyPackageSnapshot(id, source, staging);
        const stagingResult = await validatePackageDirectory(staging);
        if (
          !stagingResult.validation.valid ||
          stagingResult.skillName !== name ||
          !sameManifest(sourceResult.manifest, stagingResult.manifest)
        ) {
          throw error(
            "STAGING_INVALID",
            409,
            "技能安装快照与已校验草稿不一致",
          );
        }

        if (replacing) {
          await assertReplacementBase();
        } else {
          try {
            await lstat(target);
            throw error("SKILL_CONFLICT", 409, `技能已存在: ${name}`);
          } catch (cause) {
            if (!isNotFound(cause)) throw cause;
          }
        }
        await atomicWritePrivateFile(
          journalPath,
          new TextEncoder().encode(
            JSON.stringify(
              replacing
                ? {
                  mode: "replace",
                  name,
                  token,
                  staging: stagingName,
                  backup: backupName,
                }
                : { mode: "create", name, token, staging: stagingName },
            ),
          ),
        );
        await atomicWritePrivateFile(
          join(staging, markerName),
          new TextEncoder().encode(`${id}:${token}`),
        );
        try {
          await activeLockGuard.getStore()?.assertOwned();
          if (replacing) {
            await rename(target, backup);
            backupCreated = true;
            await activeLockGuard.getStore()?.assertOwned();
          }
          await rename(staging, target);
          renamed = true;
          await activeLockGuard.getStore()?.assertOwned();
          await options.testHooks?.afterInstallTargetRename?.(id);
        } catch (cause) {
          if (backupCreated && !renamed) {
            try {
              await activeLockGuard.getStore()?.assertOwned();
              await rename(backup, target);
              backupCreated = false;
            } catch (rollbackCause) {
              throw error(
                "INSTALL_RECOVERY_REQUIRED",
                500,
                "技能更新中断，将在下次访问时自动恢复",
                new AggregateError([cause, rollbackCause]),
              );
            }
          }
          if (isRenameCollision(cause)) {
            throw error("SKILL_CONFLICT", 409, `技能已存在: ${name}`);
          }
          throw cause;
        }

        const installedAt = Date.now();
        try {
          await options.testHooks?.beforePersistInstalled?.(id);
          await persist({
            ...metadata,
            status: "installed",
            updatedAt: installedAt,
            installedAt,
            revisionOf: undefined,
            revisionBaseDigest: undefined,
            revisionCreatedAt: undefined,
          });
        } catch (persistCause) {
          if (
            persistCause instanceof SkillDraftError &&
            persistCause.code === "DRAFT_LOCK_LOST"
          ) {
            throw persistCause;
          }
          try {
            await assertCompensationOwned(true);
            await rename(target, staging);
            renamed = false;
            if (backupCreated) {
              await rename(backup, target);
              backupCreated = false;
            }
            await activeLockGuard.getStore()?.assertOwned();
            const intent = await readInstallIntent(metadata);
            if (intent?.token !== token || intent.staging !== stagingName) {
              throw lockLostError();
            }
            await removeIfPresent(journalPath);
          } catch (rollbackCause) {
            if (
              rollbackCause instanceof SkillDraftError &&
              rollbackCause.code === "DRAFT_LOCK_LOST"
            ) {
              throw rollbackCause;
            }
            throw error(
              "INSTALL_RECOVERY_REQUIRED",
              500,
              "技能安装状态将在下次访问时自动恢复",
              new AggregateError([persistCause, rollbackCause]),
            );
          }
          throw persistCause;
        }
        await assertCompensationOwned(true);
        await removeIfPresent(join(target, markerName));
        if (backupCreated) {
          await activeLockGuard.getStore()?.assertOwned();
          await rm(backup, { recursive: true });
          backupCreated = false;
        }
        await activeLockGuard.getStore()?.assertOwned();
        const cleanupIntent = await readInstallIntent(metadata);
        if (
          cleanupIntent?.token !== token ||
          cleanupIntent.staging !== stagingName
        ) {
          throw lockLostError();
        }
        await removeIfPresent(journalPath);
        return { name, path: target };
      } catch (cause) {
        throw isRenameCollision(cause)
          ? error("SKILL_CONFLICT", 409, `技能已存在: ${name}`)
          : cause;
      } finally {
        if (!renamed) {
          try {
            await activeLockGuard.getStore()?.assertOwned();
            let cleanupAllowed = true;
            const intent = await readInstallIntent(metadata);
            if (
              intent &&
              (intent.token !== token || intent.staging !== stagingName)
            ) {
              cleanupAllowed = false;
            }
            const stagingStat = await lstat(staging).catch((cause) => {
              if (isNotFound(cause)) return undefined;
              throw cause;
            });
            if (
              cleanupAllowed && stagingStat && !stagingStat.isSymbolicLink() &&
              stagingStat.isDirectory()
            ) {
              await activeLockGuard.getStore()?.assertOwned();
              await rm(staging, { recursive: true });
            }
            if (cleanupAllowed && backupCreated) {
              const targetStat = await lstat(target).catch((cause) => {
                if (isNotFound(cause)) return undefined;
                throw cause;
              });
              if (!targetStat) {
                await activeLockGuard.getStore()?.assertOwned();
                await rename(backup, target);
                backupCreated = false;
              }
            }
            if (cleanupAllowed && intent?.token === token) {
              await activeLockGuard.getStore()?.assertOwned();
              await removeIfPresent(journalPath);
            }
          } catch (cleanupCause) {
            if (
              !isNotFound(cleanupCause) &&
              !(cleanupCause instanceof SkillDraftError &&
                cleanupCause.code === "DRAFT_LOCK_LOST")
            ) {
              console.warn("清理技能安装快照失败", cleanupCause);
            }
          }
        }
      }
    });
  }

  return {
    getOrCreateForConversation,
    get: getWithLock,
    initialize: (id, options) => {
      validateDraftId(id);
      return withFilesystemLock(
        `draft-${id}`,
        () => initializeUnlocked(id, options),
      );
    },
    listFiles: (id) => {
      validateDraftId(id);
      return withFilesystemLock(
        `draft-${id}`,
        () => listFilesUnlocked(id),
      );
    },
    readFile: (id, path) => {
      validateDraftId(id);
      return withFilesystemLock(
        `draft-${id}`,
        () => readFileUnlocked(id, path),
      );
    },
    writeFile: (id, path, content) => {
      validateDraftId(id);
      return withFilesystemLock(
        `draft-${id}`,
        () => writeFileUnlocked(id, path, content),
      );
    },
    importAsset: (id, sourcePath, fileName) => {
      validateDraftId(id);
      return withFilesystemLock(
        `draft-${id}`,
        () => importAssetUnlocked(id, sourcePath, fileName),
      );
    },
    deleteFile: (id, path) => {
      validateDraftId(id);
      return withFilesystemLock(
        `draft-${id}`,
        () => deleteFileUnlocked(id, path),
      );
    },
    validate: (id) => {
      validateDraftId(id);
      return withFilesystemLock(
        `draft-${id}`,
        () => validateUnlocked(id),
      );
    },
    createRevision: (id) => {
      validateDraftId(id);
      return withFilesystemLock(
        `draft-${id}`,
        () => createRevisionUnlocked(id),
      );
    },
    listInstalledFiles: (id) => {
      validateDraftId(id);
      return withFilesystemLock(
        `draft-${id}`,
        () => listInstalledFilesUnlocked(id),
      );
    },
    readInstalledFile: (id, path) => {
      validateDraftId(id);
      return withFilesystemLock(
        `draft-${id}`,
        () => readInstalledFileUnlocked(id, path),
      );
    },
    install: (id) => {
      validateDraftId(id);
      return withFilesystemLock(
        `draft-${id}`,
        () => installUnlocked(id),
      );
    },
    createRevisionOf: async (name, conversationId) => {
      if (!SAFE_INSTALLED_SKILL_BASENAME_PATTERN.test(name)) {
        throw error("INVALID_SKILL_NAME", 400, "技能名称无效");
      }
      const hash = await stableHash(conversationId);
      return await withFilesystemLock(
        `conversation-${hash}`,
        async () => {
          const metadata = await findOrCreateForConversation(
            conversationId,
            uuidFromHash(hash),
          );
          return await revisionFromInstalledUnlocked(
            metadata.id,
            name,
            { conversationId, createdAt: metadata.createdAt },
          );
        },
      );
    },
  };
}

let defaultStore: SkillDraftStore | undefined;

function productionStore(): SkillDraftStore {
  let home: string | undefined;
  try {
    home = process.env["HOME"];
  } catch {
    // A caller without environment permission cannot safely select a
    // production user-data directory.
  }
  if (platformOs !== "windows" && !home) {
    throw error("CONFIGURATION_ERROR", 500, "无法确定用户主目录");
  }
  if (!defaultStore) {
    defaultStore = createSkillDraftStore(platformPaths.appDataDir);
  }
  return defaultStore;
}

// Reading HOME and touching disk are both deferred until a method is called.
export const skillDraftStore: SkillDraftStore = {
  getOrCreateForConversation: (conversationId) =>
    productionStore().getOrCreateForConversation(conversationId),
  get: (id) => productionStore().get(id),
  initialize: (id, options) => productionStore().initialize(id, options),
  listFiles: (id) => productionStore().listFiles(id),
  readFile: (id, path) => productionStore().readFile(id, path),
  writeFile: (id, path, content) =>
    productionStore().writeFile(id, path, content),
  importAsset: (id, sourcePath, fileName) =>
    productionStore().importAsset(id, sourcePath, fileName),
  deleteFile: (id, path) => productionStore().deleteFile(id, path),
  validate: (id) => productionStore().validate(id),
  createRevision: (id) => productionStore().createRevision(id),
  createRevisionOf: (name, conversationId) =>
    productionStore().createRevisionOf(name, conversationId),
  listInstalledFiles: (id) => productionStore().listInstalledFiles(id),
  readInstalledFile: (id, path) =>
    productionStore().readInstalledFile(id, path),
  install: (id) => productionStore().install(id),
};
