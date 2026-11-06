import { createHash } from "node:crypto";
import { lstat, readFile, readdir } from "node:fs/promises";
import {
  basename,
  dirname,
  isAbsolute,
  relative,
  resolve,
  sep,
} from "node:path";

import {
  listSkills,
  type SkillMeta,
} from "../domains/skill/node/store.ts";

export const MAX_SELECTED_EXPERT_SKILLS = 8;
export const MAX_SELECTED_SKILL_FILES = 2048;
export const MAX_SELECTED_SKILL_BYTES = 32 * 1024 * 1024;

const MAX_SKILL_NAME_LENGTH = 64;
const MAX_SKILL_ROOT_LENGTH = 4096;
const SAFE_SKILL_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

interface SelectionBudget {
  files: number;
  declaredBytes: number;
  actualBytes: number;
}

interface FileStats {
  size: number;
  isSymbolicLink(): boolean;
  isDirectory(): boolean;
  isFile(): boolean;
}

export interface ResolverDependencies {
  listSkills?: () => Promise<readonly SkillMeta[]>;
  lstat?: (path: string) => Promise<FileStats>;
  readdir?: (path: string) => Promise<readonly string[]>;
  readFile?: (path: string) => Promise<Uint8Array>;
}

export interface ResolvedExpertSkill {
  name: string;
  source: "builtin" | "user";
  root: string;
  revision: string;
}

function foldedName(value: string): string {
  return value.toUpperCase().toLowerCase();
}

function assertSafeSkillName(name: string): void {
  if (
    name.length === 0 ||
    name.length > MAX_SKILL_NAME_LENGTH ||
    name.trim() !== name ||
    !SAFE_SKILL_NAME.test(name) ||
    name === "." ||
    name === ".."
  ) {
    throw new Error("Selected skill name is unsafe or invalid");
  }
}

function assertSafeEntryName(name: string): void {
  if (
    !name ||
    name === "." ||
    name === ".." ||
    name.includes("/") ||
    name.includes("\\") ||
    name.includes("\0")
  ) {
    throw new Error("Selected skill tree contains an unsafe path entry");
  }
}

function isWithin(root: string, target: string): boolean {
  const offset = relative(root, target);
  return offset === "" ||
    (!isAbsolute(offset) && offset !== ".." && !offset.startsWith(`..${sep}`));
}

function toPosixRelativePath(root: string, target: string): string {
  return relative(root, target).split(sep).join("/");
}

function assertOrdinarySize(size: number): void {
  if (!Number.isSafeInteger(size) || size < 0) {
    throw new Error("Selected skill tree contains an invalid ordinary file");
  }
}

async function revisionForSkillRoot(
  root: string,
  dependencies: Required<Pick<ResolverDependencies, "lstat" | "readdir" | "readFile">>,
  budget: SelectionBudget,
): Promise<string> {
  const rootStat = await dependencies.lstat(root);
  if (rootStat.isSymbolicLink()) {
    throw new Error("Selected skill tree contains a symbolic link");
  }
  if (!rootStat.isDirectory()) {
    throw new Error("Selected skill root must be an ordinary directory");
  }

  const files: Array<{ absolutePath: string; relativePath: string }> = [];
  const pending = [root];
  while (pending.length > 0) {
    const directory = pending.pop()!;
    const names = await dependencies.readdir(directory);
    for (const name of names) {
      assertSafeEntryName(name);
      const target = resolve(directory, name);
      if (!isWithin(root, target)) {
        throw new Error("Selected skill tree path escapes its root");
      }
      const stat = await dependencies.lstat(target);
      if (stat.isSymbolicLink()) {
        throw new Error("Selected skill tree contains a symbolic link");
      }
      if (stat.isDirectory()) {
        pending.push(target);
        continue;
      }
      if (!stat.isFile()) {
        throw new Error("Selected skill tree contains a non-ordinary entry");
      }
      assertOrdinarySize(stat.size);
      files.push({
        absolutePath: target,
        relativePath: toPosixRelativePath(root, target),
      });
      budget.files += 1;
      if (budget.files > MAX_SELECTED_SKILL_FILES) {
        throw new Error(
          `Selected skills exceed the ${MAX_SELECTED_SKILL_FILES} files limit`,
        );
      }
      budget.declaredBytes += stat.size;
      if (budget.declaredBytes > MAX_SELECTED_SKILL_BYTES) {
        throw new Error(
          `Selected skills exceed the ${MAX_SELECTED_SKILL_BYTES} bytes limit (32 MiB)`,
        );
      }
    }
  }

  files.sort((left, right) =>
    Buffer.compare(
      Buffer.from(left.relativePath, "utf-8"),
      Buffer.from(right.relativePath, "utf-8"),
    )
  );
  const hash = createHash("sha256");
  for (const file of files) {
    const contents = await dependencies.readFile(file.absolutePath);
    budget.actualBytes += contents.byteLength;
    if (budget.actualBytes > MAX_SELECTED_SKILL_BYTES) {
      throw new Error(
        `Selected skills exceed the ${MAX_SELECTED_SKILL_BYTES} bytes limit (32 MiB)`,
      );
    }
    hash.update(file.relativePath, "utf-8");
    hash.update("\0");
    hash.update(contents);
    hash.update("\0");
  }
  return hash.digest("hex");
}

/** Resolve user selections only against the authoritative installed registry. */
export async function resolveSelectedExpertSkills(
  names: readonly string[],
  dependencies: ResolverDependencies = {},
): Promise<ResolvedExpertSkill[]> {
  const selectedNames: string[] = [];
  const selectedKeys = new Set<string>();
  for (const name of names) {
    assertSafeSkillName(name);
    const key = foldedName(name);
    if (key === foldedName("expert-manager")) {
      throw new Error("expert-manager is reserved and cannot be selected");
    }
    if (selectedKeys.has(key)) continue;
    selectedKeys.add(key);
    selectedNames.push(name);
  }
  if (selectedNames.length > MAX_SELECTED_EXPERT_SKILLS) {
    throw new Error(
      `At most ${MAX_SELECTED_EXPERT_SKILLS} expert skills may be selected`,
    );
  }
  if (selectedNames.length === 0) return [];

  const registered = await (dependencies.listSkills ?? (() => listSkills()))();
  const byName = new Map<string, SkillMeta>();
  for (const skill of registered) {
    const key = foldedName(skill.name);
    if (!byName.has(key)) byName.set(key, skill);
  }
  const filesystem = {
    lstat: dependencies.lstat ?? lstat,
    readdir: dependencies.readdir ?? ((path: string) => readdir(path)),
    readFile: dependencies.readFile ?? ((path: string) => readFile(path)),
  };

  const result: ResolvedExpertSkill[] = [];
  const budget: SelectionBudget = {
    files: 0,
    declaredBytes: 0,
    actualBytes: 0,
  };
  for (const selectedName of selectedNames) {
    const skill = byName.get(foldedName(selectedName));
    if (!skill) {
      throw new Error(`Selected skill "${selectedName}" is not registered`);
    }
    assertSafeSkillName(skill.name);
    if (skill.disabled) {
      throw new Error(`Selected skill "${selectedName}" is disabled`);
    }
    if (foldedName(skill.name) === foldedName("expert-manager")) {
      throw new Error("expert-manager is reserved and cannot be selected");
    }

    const root = resolve(dirname(skill.path));
    const rootName = basename(root);
    if (
      root.length > MAX_SKILL_ROOT_LENGTH ||
      !isAbsolute(root) ||
      rootName.length === 0 ||
      rootName.length > MAX_SKILL_NAME_LENGTH ||
      !SAFE_SKILL_NAME.test(rootName) ||
      rootName === "." ||
      rootName === ".."
    ) {
      throw new Error(`Selected skill "${selectedName}" has an unsafe root`);
    }
    const sourcePath = resolve(skill.path);
    if (
      basename(skill.path) !== "SKILL.md" ||
      !isWithin(root, sourcePath) ||
      relative(root, sourcePath) !== "SKILL.md"
    ) {
      throw new Error(
        `Selected skill "${selectedName}" source must be root-level SKILL.md`,
      );
    }
    let sourceStat: FileStats;
    try {
      sourceStat = await filesystem.lstat(sourcePath);
    } catch (error) {
      throw new Error(
        `Selected skill "${selectedName}" source SKILL.md is unavailable`,
        { cause: error },
      );
    }
    if (sourceStat.isSymbolicLink() || !sourceStat.isFile()) {
      throw new Error(
        `Selected skill "${selectedName}" source SKILL.md must be a non-symlink regular file`,
      );
    }
    const revision = await revisionForSkillRoot(root, filesystem, budget);
    result.push({
      name: skill.name,
      source: skill.builtin ? "builtin" : "user",
      root,
      revision,
    });
  }
  return result;
}
