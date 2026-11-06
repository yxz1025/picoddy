import { createHash } from "node:crypto";
import { lstat, readFile, readdir, realpath } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { parseDocument } from "yaml";

import type { InstalledExpertSkill } from "./types.ts";

export const MAX_SKILL_FILES = 2048;
export const MAX_SKILL_TREE_BYTES = 32 * 1024 * 1024;
export const MAX_SKILL_MD_BYTES = 128 * 1024;
export const MAX_SKILL_BODIES_BYTES = 128 * 1024;

const SAFE_SKILL_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const SKILL_DECLARATION = /^\.\/skills\/([a-z0-9]+(?:-[a-z0-9]+)*)$/;
const RESERVED_SKILL_NAME = "expert-manager";
const MAX_SKILL_NAME_LENGTH = 64;

interface SkillBudget {
  files: number;
  treeBytes: number;
  bodyBytes: number;
}

interface PlainFile {
  absolutePath: string;
  relativePath: string;
}

function inside(root: string, target: string): boolean {
  const offset = relative(root, target);
  return offset === "" ||
    (!isAbsolute(offset) && offset !== ".." && !offset.startsWith(`..${sep}`));
}

function safeEntryName(name: string): boolean {
  return Boolean(name) && name !== "." && name !== ".." &&
    !name.includes("/") && !name.includes("\\") && !name.includes("\0");
}

function frontmatterAndBody(content: string): { frontmatter: string; body: string } {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)([\s\S]*)$/);
  if (!match) throw new Error("SKILL.md must contain complete YAML frontmatter");
  return { frontmatter: match[1], body: match[2].replace(/^[\r\n]+/, "") };
}

function parseSkillBody(
  content: string,
  name: string,
): { body: string; description: string } {
  const { frontmatter, body } = frontmatterAndBody(content);
  const document = parseDocument(frontmatter, {
    prettyErrors: false,
    uniqueKeys: true,
  });
  if (document.errors.length > 0) {
    throw new Error(`SKILL.md frontmatter is invalid: ${document.errors[0]?.message}`);
  }
  const metadata = document.toJS({ maxAliasCount: 0 });
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    throw new Error("SKILL.md frontmatter must be a mapping");
  }
  const fields = metadata as Record<string, unknown>;
  if (fields.name !== name) {
    throw new Error(`SKILL.md frontmatter name must equal skill directory "${name}"`);
  }
  if (fields.disabled === true) throw new Error("disabled skills cannot be packaged");
  if (fields.disabled !== undefined && typeof fields.disabled !== "boolean") {
    throw new Error("SKILL.md frontmatter disabled must be a boolean");
  }
  if (fields.description !== undefined && typeof fields.description !== "string") {
    throw new Error("SKILL.md frontmatter description must be a string");
  }
  return { body, description: fields.description ?? "" };
}

async function collectTree(
  skillRoot: string,
  budget: SkillBudget,
): Promise<PlainFile[]> {
  const rootInfo = await lstat(skillRoot);
  if (rootInfo.isSymbolicLink() || !rootInfo.isDirectory()) {
    throw new Error("skill root must be a non-symlink directory");
  }

  const files: PlainFile[] = [];
  const pending = [skillRoot];
  while (pending.length > 0) {
    const directory = pending.pop()!;
    for (const name of await readdir(directory)) {
      if (!safeEntryName(name)) throw new Error("skill tree contains an unsafe path entry");
      const target = resolve(directory, name);
      if (!inside(skillRoot, target)) throw new Error("skill tree path escapes its root");
      const info = await lstat(target);
      if (info.isSymbolicLink()) throw new Error("skill tree contains a symbolic link");
      if (info.isDirectory()) {
        pending.push(target);
        continue;
      }
      if (!info.isFile()) throw new Error("skill tree contains a non-ordinary entry");
      if (!Number.isSafeInteger(info.size) || info.size < 0) {
        throw new Error("skill tree contains an invalid ordinary file");
      }
      budget.files += 1;
      if (budget.files > MAX_SKILL_FILES) {
        throw new Error(`declared skills exceed the ${MAX_SKILL_FILES} files limit`);
      }
      budget.treeBytes += info.size;
      if (budget.treeBytes > MAX_SKILL_TREE_BYTES) {
        throw new Error(`declared skills exceed the ${MAX_SKILL_TREE_BYTES} bytes tree limit`);
      }
      files.push({
        absolutePath: target,
        relativePath: relative(skillRoot, target).split(sep).join("/"),
      });
    }
  }
  files.sort((left, right) =>
    Buffer.compare(
      Buffer.from(left.relativePath, "utf8"),
      Buffer.from(right.relativePath, "utf8"),
    )
  );
  return files;
}

async function loadSkill(
  expertRoot: string,
  skillsRoot: string,
  name: string,
  budget: SkillBudget,
): Promise<InstalledExpertSkill> {
  const skillRoot = resolve(skillsRoot, name);
  if (!inside(skillsRoot, skillRoot)) throw new Error("skill path escapes skills directory");
  const files = await collectTree(skillRoot, budget);
  const realSkillRoot = await realpath(skillRoot);
  if (!inside(expertRoot, realSkillRoot)) throw new Error("skill path escapes expert package");
  const skillFile = resolve(skillRoot, "SKILL.md");
  const skillFileInfo = await lstat(skillFile);
  if (skillFileInfo.isSymbolicLink() || !skillFileInfo.isFile()) {
    throw new Error("skill must contain a root-level non-symlink SKILL.md file");
  }
  if (skillFileInfo.size > MAX_SKILL_MD_BYTES) {
    throw new Error(`SKILL.md exceeds the ${MAX_SKILL_MD_BYTES} bytes limit`);
  }
  const { body, description } = parseSkillBody(
    await readFile(skillFile, "utf8"),
    name,
  );
  budget.bodyBytes += Buffer.byteLength(body, "utf8");
  if (budget.bodyBytes > MAX_SKILL_BODIES_BYTES) {
    throw new Error(`declared Skill bodies exceed the ${MAX_SKILL_BODIES_BYTES} bytes limit`);
  }

  const hash = createHash("sha256");
  for (const file of files) {
    hash.update(file.relativePath, "utf8");
    hash.update("\0");
    hash.update(await readFile(file.absolutePath));
    hash.update("\0");
  }
  return { name, root: realSkillRoot, body, description, revision: hash.digest("hex") };
}

/** Read declared package-local Skills without following symbolic links. */
export async function loadInstalledExpertSkills(
  expertDir: string,
  declarations: readonly unknown[] | undefined,
): Promise<InstalledExpertSkill[]> {
  if (declarations === undefined) return [];
  if (!Array.isArray(declarations)) throw new Error("plugin skills must be an array");

  const lexicalExpertRoot = resolve(expertDir);
  const expertInfo = await lstat(lexicalExpertRoot);
  if (expertInfo.isSymbolicLink() || !expertInfo.isDirectory()) {
    throw new Error("expert package must be a non-symlink directory");
  }
  const expertRoot = await realpath(lexicalExpertRoot);
  const skillsRoot = resolve(lexicalExpertRoot, "skills");
  const names = new Set<string>();
  const parsed: string[] = [];
  for (const declaration of declarations) {
    if (typeof declaration !== "string") throw new Error("each skill path must be a string");
    const match = SKILL_DECLARATION.exec(declaration);
    if (!match || (match[1]?.length ?? 0) > MAX_SKILL_NAME_LENGTH ||
      !SAFE_SKILL_NAME.test(match[1] ?? "")) {
      throw new Error("skill path must be exactly './skills/<safe-kebab-name>'");
    }
    const name = match[1]!;
    if (name === RESERVED_SKILL_NAME) {
      throw new Error("expert-manager is reserved and cannot be packaged as a Skill");
    }
    if (names.has(name)) throw new Error(`duplicate skill declaration "${name}"`);
    names.add(name);
    parsed.push(name);
  }
  if (parsed.length === 0) return [];

  const skillsInfo = await lstat(skillsRoot);
  if (skillsInfo.isSymbolicLink() || !skillsInfo.isDirectory()) {
    throw new Error("skills directory must be a non-symlink directory");
  }
  const realSkillsRoot = await realpath(skillsRoot);
  if (!inside(expertRoot, realSkillsRoot)) throw new Error("skills directory escapes expert package");

  const budget: SkillBudget = { files: 0, treeBytes: 0, bodyBytes: 0 };
  const skills: InstalledExpertSkill[] = [];
  for (const name of parsed) {
    skills.push(await loadSkill(expertRoot, skillsRoot, name, budget));
  }
  return skills;
}
