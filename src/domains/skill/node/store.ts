// 技能文件 CRUD。内置根只读，用户根可写；内置身份只由扫描来源决定。

import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { rm, mkdir, lstat, chmod, rename, readFile, readdir, open } from "node:fs/promises";
import type { Stats, Dirent } from "node:fs";
const platformOs = process.platform === "win32" ? "windows" : process.platform;

import { parseDocument, stringify } from "yaml";
import { resolveBuiltinSkillsDir } from "../../../agent/builtin_skills/installer.ts";
import { withInstalledSkillNameLock } from "../../skill-draft/node/store.ts";
import { platformPaths } from "../../../platform/paths.ts";

export const SKILLS_DIR = platformPaths.skillsDir;
const SKILL_NAME_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export interface SkillStoreRoots {
  builtinDir: string;
  userDir: string;
}

type SkillStoreLocation = SkillStoreRoots | undefined;

function foldedName(value: string): string {
  return value.toUpperCase().toLowerCase();
}

function isWithin(root: string, target: string): boolean {
  const offset = relative(resolve(root), resolve(target));
  return offset === "" ||
    (!isAbsolute(offset) && offset !== ".." && !offset.startsWith(`..${sep}`));
}

function assertWritableRoots(roots: SkillStoreRoots): void {
  if (
    isWithin(platformPaths.builtinSkillsRootDir, roots.userDir) ||
    (roots.builtinDir &&
      (isWithin(roots.builtinDir, roots.userDir) ||
        isWithin(roots.userDir, roots.builtinDir)))
  ) {
    throw new Error("用户技能目录不得与受保护内置技能目录重叠");
  }
}

async function resolveStoreRoots(
  location: SkillStoreLocation,
): Promise<SkillStoreRoots> {
  if (location) return location;
  return {
    builtinDir: await resolveBuiltinSkillsDir(),
    userDir: SKILLS_DIR,
  };
}

function throwSkillStoreError(message: string, cause: unknown): never {
  const detail = cause instanceof Error ? cause.name : "Error";
  console.error(`${message}: ${detail}`);
  throw new Error(message);
}

function assertSafeLegacySkillBasename(name: string): void {
  if (
    !/^[A-Za-z0-9_-]{1,64}$/.test(name) ||
    name === "." || name === ".." || name.includes("\0")
  ) {
    throw new Error("技能名称或路径无效");
  }
}

function assertNewExternalSkillName(name: string): void {
  if (
    !/^[a-z0-9][a-z0-9-]{0,63}$/.test(name) ||
    name.endsWith("-") || name.includes("--")
  ) {
    throw new Error(
      "技能名只能包含小写字母、数字和单个连字符，且长度不超过 64",
    );
  }
}

function resolveDirectSkillDirectory(
  name: string,
  rootDirectory: string,
): string {
  assertSafeLegacySkillBasename(name);
  const root = resolve(rootDirectory);
  const target = resolve(root, name);
  const offset = relative(root, target);
  if (offset !== name || isAbsolute(offset) || offset.includes(sep)) {
    throw new Error("技能路径无效");
  }
  return target;
}

async function writeSkillFileAtomically(
  skillFile: string,
  content: string,
  assertOwned: () => Promise<void>,
): Promise<void> {
  const directory = resolve(skillFile, "..");
  const temporary = join(directory, `.SKILL.md.tmp-${crypto.randomUUID()}`);
  const file = await open(temporary, "wx", 0o600);
  let renamed = false;
  try {
    const bytes = new TextEncoder().encode(content);
    let offset = 0;
    while (offset < bytes.length) {
      const { bytesWritten } = await file.write(bytes.subarray(offset));
      offset += bytesWritten;
    }
    await file.sync();
    file.close();
    await assertOwned();
    await rename(temporary, skillFile);
    renamed = true;
    if (platformOs !== "windows") await chmod(skillFile, 0o600);
    await assertOwned();
  } finally {
    try {
      file.close();
    } catch {
      // Already closed after the durable write.
    }
    if (!renamed) {
      try {
        await assertOwned();
        await rm(temporary);
      } catch {
        // A lost owner leaves its uniquely named temporary for safe cleanup.
      }
    }
  }
}

export interface SkillMeta {
  name: string;
  displayName?: string;
  description: string;
  body: string;
  disabled: boolean;
  builtin: boolean;
  path: string;
  edited?: boolean;
  version?: string;
}

export function parseSkillFrontmatter(
  text: string,
  options: { allowLegacyName?: boolean } = {},
): {
  name?: string;
  description?: string;
  disabled?: boolean;
  edited?: boolean;
  version?: string;
  legacyName?: boolean;
  body: string;
} {
  const normalized = text.replaceAll("\r\n", "\n").replaceAll("\r", "\n");
  const match = normalized.match(/^---\n([\s\S]*?)\n---(?:\n|$)([\s\S]*)$/);
  if (!match) throw new Error("SKILL.md 必须包含完整 YAML frontmatter");

  const document = parseDocument(match[1], {
    prettyErrors: false,
    uniqueKeys: true,
  });
  if (document.errors.length > 0) {
    throw new Error(
      `SKILL.md frontmatter YAML 无效或字段重复: ${document.errors[0].message}`,
    );
  }
  const metadata = document.toJS({ maxAliasCount: 0 });
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    throw new Error("SKILL.md frontmatter 必须是 YAML 对象");
  }
  const fields = metadata as Record<string, unknown>;
  if (typeof fields.name !== "string" || !fields.name) {
    throw new Error("SKILL.md frontmatter name 必须是非空字符串");
  }
  const legacyName = fields.name.length > 64 ||
    !SKILL_NAME_PATTERN.test(fields.name);
  if (legacyName && !options.allowLegacyName) {
    throw new Error(
      "技能名只能包含小写字母、数字和单个连字符，且长度不超过 64",
    );
  }
  if (
    typeof fields.description !== "string" ||
    !fields.description.trim() || fields.description.length > 1024
  ) {
    throw new Error(
      "SKILL.md frontmatter description 必须是非空字符串且不超过 1024 字符",
    );
  }
  if (fields.disabled !== undefined && typeof fields.disabled !== "boolean") {
    throw new Error("SKILL.md frontmatter disabled 必须是布尔值");
  }
  if (fields.edited !== undefined && typeof fields.edited !== "boolean") {
    throw new Error("SKILL.md frontmatter edited 必须是布尔值");
  }
  return {
    name: fields.name,
    description: fields.description,
    disabled: fields.disabled === true,
    edited: fields.edited === true,
    version: skillFrontmatterVersion(fields.version),
    legacyName,
    body: match[2].replace(/^\n+/, ""),
  };
}

function skillFrontmatterVersion(value: unknown): string | undefined {
  if (typeof value === "string") {
    const version = value.trim();
    return version && version.length <= 128 ? version : undefined;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }
  return undefined;
}

export function serializeSkill(
  displayName: string,
  description: string,
  disabled: boolean,
  body: string,
  edited = true,
  options: { allowLegacyName?: boolean } = {},
): string {
  const yaml = stringify(
    { name: displayName, description, disabled, edited },
    { lineWidth: 0 },
  );
  const content = `---\n${yaml}---\n\n${body}`;
  parseSkillFrontmatter(content, options);
  return content;
}

async function scanRoot(root: string, builtin: boolean): Promise<SkillMeta[]> {
  if (!root) return [];
  if (!builtin) {
    try {
      await mkdir(root, { recursive: true });
    } catch (error) {
      throwSkillStoreError("[skill] 无法初始化技能目录", error);
    }
  }
  let entries: Dirent[] = [];
  try {
    for (const entry of await readdir(root, { withFileTypes: true })) entries.push(entry);
  } catch (error) {
    if ((error as { code?: string }).code === "ENOENT" && !builtin) return [];
    throwSkillStoreError("[skill] 无法读取技能目录", error);
  }

  const result: SkillMeta[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.isSymbolicLink()) continue;
    const skillFile = join(root, entry.name, "SKILL.md");
    try {
      const stat = await lstat(skillFile);
      if (stat.isSymbolicLink() || !stat.isFile()) throw new Error("技能文件不安全");
      const parsed = parseSkillFrontmatter(
        await readFile(skillFile, "utf-8"),
        { allowLegacyName: !builtin },
      );
      if (parsed.legacyName) {
        console.warn(
          `[skill] 加载历史非规范用户技能 ${entry.name}，触发名保持为 ${parsed.name}`,
        );
      }
      result.push({
        name: entry.name,
        displayName: parsed.name || entry.name,
        description: parsed.description || "",
        body: parsed.body,
        disabled: parsed.disabled || false,
        builtin,
        path: skillFile,
        edited: parsed.edited || false,
        version: parsed.version,
      });
    } catch (error) {
      if ((error as { code?: string }).code === "ENOENT") continue;
      if (!builtin) {
        console.warn(
          `[skill] 忽略无效用户技能 ${entry.name}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
        continue;
      }
      throwSkillStoreError(`[skill] 读取技能 ${entry.name} 失败`, error);
    }
  }
  return result;
}

/** 列出内置和用户技能；同名（大小写折叠）始终由内置来源获胜。 */
export async function listSkills(
  location?: SkillStoreLocation,
): Promise<SkillMeta[]> {
  const roots = await resolveStoreRoots(location);
  const builtin = await scanRoot(roots.builtinDir, true);
  const user = await scanRoot(roots.userDir, false);
  const result: SkillMeta[] = [...builtin];
  const builtinIdentifiers = new Set(
    builtin.flatMap((skill) => [
      foldedName(skill.name),
      foldedName(skill.displayName || skill.name),
    ]),
  );
  const canonicalApiIds = new Set(
    builtin.map((skill) => foldedName(skill.name)),
  );

  for (const skill of user) {
    const canonicalId = foldedName(skill.name);
    const triggerName = foldedName(skill.displayName || skill.name);
    if (
      canonicalApiIds.has(canonicalId) ||
      builtinIdentifiers.has(canonicalId) ||
      builtinIdentifiers.has(triggerName)
    ) {
      console.warn(
        `[skill] 忽略与内置技能标识冲突的用户技能: ${skill.path}`,
      );
      continue;
    }
    canonicalApiIds.add(canonicalId);
    result.push(skill);
  }
  return result.sort((a, b) => a.name.localeCompare(b.name));
}

/** 来源判断仅依据扫描根，不依赖名称集合或 marker。 */
export async function isBuiltinSkill(
  name: string,
  location?: SkillStoreLocation,
): Promise<boolean> {
  const roots = await resolveStoreRoots(location);
  if (!roots.builtinDir) return false;
  const target = foldedName(name);
  return (await scanRoot(roots.builtinDir, true)).some((skill) =>
    foldedName(skill.name) === target
  );
}

export async function getSkill(
  name: string,
  location?: SkillStoreLocation,
): Promise<SkillMeta | null> {
  assertSafeLegacySkillBasename(name);
  const target = foldedName(name);
  const skills = await listSkills(location);
  return skills.find((skill) => foldedName(skill.name) === target) ?? null;
}

/** 保存用户技能；活动内置根中的名称不能被覆盖。 */
export async function saveSkill(
  name: string,
  description: string,
  disabled: boolean,
  body: string,
  displayName?: string,
  location?: SkillStoreLocation,
): Promise<SkillMeta> {
  const roots = await resolveStoreRoots(location);
  assertWritableRoots(roots);
  const builtinNames = new Set(
    (await scanRoot(roots.builtinDir, true)).flatMap((skill) => [
      foldedName(skill.name),
      foldedName(skill.displayName || skill.name),
    ]),
  );
  if (builtinNames.has(foldedName(name))) {
    throw new Error("内置技能不可覆盖");
  }
  const skillDir = resolveDirectSkillDirectory(name, roots.userDir);
  try {
    return await withInstalledSkillNameLock(
      roots.userDir,
      name,
      async (assertOwned) => {
        await mkdir(roots.userDir, { recursive: true });
        const rootStat = await lstat(roots.userDir);
        if (rootStat.isSymbolicLink() || !rootStat.isDirectory()) {
          throw new Error("技能目录不安全");
        }
        let existing = false;
        try {
          const directoryStat = await lstat(skillDir);
          if (directoryStat.isSymbolicLink() || !directoryStat.isDirectory()) {
            throw new Error("技能目录不安全");
          }
          existing = true;
        } catch (error) {
          if (!((error as { code?: string }).code === "ENOENT")) throw error;
          assertNewExternalSkillName(name);
        }
        const skillFile = join(skillDir, "SKILL.md");
        let existingFrontmatter:
          | ReturnType<typeof parseSkillFrontmatter>
          | undefined;
        try {
          const fileStat = await lstat(skillFile);
          if (fileStat.isSymbolicLink() || !fileStat.isFile()) {
            throw new Error("技能文件不安全");
          }
          existingFrontmatter = parseSkillFrontmatter(
            await readFile(skillFile, "utf-8"),
            { allowLegacyName: true },
          );
        } catch (error) {
          if (!((error as { code?: string }).code === "ENOENT")) throw error;
        }
        const existingTriggerName = existingFrontmatter?.name;
        const desiredTriggerName = displayName ?? existingTriggerName ?? name;
        const preserveLegacyName = existingFrontmatter?.legacyName === true;
        if (
          preserveLegacyName && desiredTriggerName !== existingTriggerName
        ) {
          throw new Error("历史技能触发名不可修改；请删除后用规范名称重新创建");
        }
        if (!existing && preserveLegacyName) {
          throw new Error("新建技能不能使用历史非规范触发名");
        }
        const content = serializeSkill(
          desiredTriggerName,
          description,
          disabled,
          body,
          true,
          { allowLegacyName: preserveLegacyName },
        );
        const finalFrontmatter = parseSkillFrontmatter(content, {
          allowLegacyName: preserveLegacyName,
        });
        if (builtinNames.has(foldedName(finalFrontmatter.name!))) {
          throw new Error("内置技能不可覆盖");
        }
        if (!existing) {
          await assertOwned();
          await mkdir(skillDir, { mode: 0o700 });
          await assertOwned();
        }
        await writeSkillFileAtomically(skillFile, content, assertOwned);
        return {
          name,
          displayName: finalFrontmatter.name,
          description,
          disabled,
          body,
          builtin: false,
          path: skillFile,
          edited: true,
        };
      },
    );
  } catch (error) {
    if (
      error instanceof Error &&
      (["技能目录不安全", "技能文件不安全"].includes(error.message) ||
        error.message.includes("技能名") ||
        error.message.includes("frontmatter") ||
        error.message.startsWith("历史技能触发名不可修改") ||
        error.message === "内置技能不可覆盖")
    ) {
      throw error;
    }
    console.error(
      "[skill] 保存技能失败:",
      error instanceof Error ? error.name : "Error",
    );
    throw new Error("保存技能失败");
  }
}

/** 删除仅发生在用户根；存在同名内置来源时硬拒绝。 */
export async function deleteSkill(
  name: string,
  location?: SkillStoreLocation,
): Promise<void> {
  const roots = await resolveStoreRoots(location);
  assertWritableRoots(roots);
  if (await isBuiltinSkill(name, roots)) throw new Error("内置技能不可删除");
  const skillDir = resolveDirectSkillDirectory(name, roots.userDir);
  try {
    await withInstalledSkillNameLock(
      roots.userDir,
      name,
      async (assertOwned) => {
        const stat = await lstat(skillDir);
        if (stat.isSymbolicLink() || !stat.isDirectory()) {
          throw new Error("技能目录不安全");
        }
        await assertOwned();
        await rm(skillDir, { recursive: true });
        await assertOwned();
      },
    );
  } catch (error) {
    if (error instanceof Error && ["技能目录不安全"].includes(error.message)) {
      throw error;
    }
    if ((error as { code?: string }).code === "ENOENT") throw new Error("技能不存在");
    console.error(
      "[skill] 删除技能失败:",
      error instanceof Error ? error.name : "Error",
    );
    throw new Error("删除技能失败");
  }
}
