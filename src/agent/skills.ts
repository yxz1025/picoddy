import { ResourceCache } from "./resource_cache.ts";
import { join } from "node:path";
import { loadPromptTemplates } from "../vendor/pi_coding_agent.ts";
// 技能系统：扫描受保护内置根和用户根，按需向系统提示暴露元数据。

import { loadSkillsFromDir } from "../vendor/pi_coding_agent_skills.ts";
import { mkdir } from "node:fs/promises";
import { readFileSync } from "node:fs";

import type {
  LoadSkillsResult,
  Skill as LoadedSkill,
} from "../vendor/pi_coding_agent_skills.ts";
import type {
  PromptTemplate,
  Skill,
} from "@earendil-works/pi-coding-agent";
import { platformPaths } from "../platform/paths.ts";
import {
  ensureBuiltinSkillsInstalled,
  resolveBuiltinSkillsDir,
} from "./builtin_skills/installer.ts";

/** 用户技能目录：~/.picoddy/skills/ */
export const SKILLS_DIR = platformPaths.skillsDir;

let activeBuiltinSkillsDir: string | undefined;
const skillResourceCache = new ResourceCache<Skill[]>();

export interface SkillPathRoots {
  builtinDir: string;
  userDir: string;
}

export interface EnsureSkillsOptions {
  userDir?: string;
  builtinRootDir?: string;
}

function foldedSkillName(name: string): string {
  return name.toUpperCase().toLowerCase();
}

function isSkillEnabled(filePath: string): boolean {
  try {
    const text = readFileSync(filePath, "utf-8");
    const frontmatter = text.match(/^---\n([\s\S]*?)\n---\n?/u)?.[1];
    return !frontmatter?.match(/^disabled:\s*true\s*$/mu);
  } catch {
    // The loader already reports malformed/unreadable skills. Do not turn a
    // transient user-skill read failure into loss of the protected index.
    return true;
  }
}

function loadRoot(path: string): LoadSkillsResult {
  return loadSkillsFromDir({ dir: path, source: "path" });
}

/**
 * Discover skills from the two authoritative roots. Builtins are deliberately
 * loaded first, and names are de-duplicated with Windows-compatible case fold.
 */
export function discoverSkillsFromPaths(
  roots: SkillPathRoots,
): LoadSkillsResult {
  const builtin = loadRoot(roots.builtinDir);
  const user = loadRoot(roots.userDir);
  const diagnostics = [...builtin.diagnostics, ...user.diagnostics];
  const skills: LoadedSkill[] = [];
  const winners = new Map<string, LoadedSkill>();

  for (const skill of [...builtin.skills, ...user.skills]) {
    if (!isSkillEnabled(skill.filePath)) continue;
    const key = foldedSkillName(skill.name);
    const winner = winners.get(key);
    if (winner) {
      diagnostics.push({
        type: "collision",
        message: `name "${skill.name}" case-folded collision`,
        path: skill.filePath,
        collision: {
          resourceType: "skill",
          name: skill.name,
          winnerPath: winner.filePath,
          loserPath: skill.filePath,
        },
      });
      continue;
    }
    winners.set(key, skill);
    skills.push(skill);
  }

  return { skills, diagnostics };
}

function reportSkillDiagnostics(result: LoadSkillsResult): void {
  for (const diagnostic of result.diagnostics) {
    if (diagnostic.type === "collision") {
      console.warn(
        `[skills] 忽略冲突技能 ${diagnostic.path}: ${diagnostic.message}`,
      );
    }
  }
}

/** Keep Pi's native metadata; AgentSession reads skill bodies on invocation. */
export function loadSkillResourcesFromPaths(roots: SkillPathRoots): Skill[] {
  const result = discoverSkillsFromPaths(roots);
  reportSkillDiagnostics(result);
  return result.skills;
}

export function loadSkillResources(): Skill[] {
  if (!activeBuiltinSkillsDir) {
    throw new Error("内置技能尚未安装或验证；必须先调用 ensureSkillsDir()。");
  }
  const builtinDir = activeBuiltinSkillsDir;
  return [...skillResourceCache.get([builtinDir, SKILLS_DIR], () =>
    loadSkillResourcesFromPaths({ builtinDir, userDir: SKILLS_DIR }))];
}

/** Use Pi's native project and agent prompt directories and frontmatter parser. */
export function loadPromptTemplateResources(
  cwd = platformPaths.artifactsDir,
  agentDir = join(platformPaths.appDataDir, "pi-agent"),
): PromptTemplate[] {
  return loadPromptTemplates({ cwd, agentDir, promptPaths: [], includeDefaults: true }).templates;
}

/** 创建用户根并安装/验证受保护 bundle。失败会阻止启动进入 skills-loaded。 */
export async function ensureSkillsDir(
  options: EnsureSkillsOptions = {},
): Promise<string> {
  const userDir = options.userDir ?? SKILLS_DIR;
  try {
    await mkdir(userDir, { recursive: true });
  } catch (error) {
    throw new Error(`无法创建技能目录 ${userDir}`, { cause: error });
  }

  const rootDir = options.builtinRootDir ?? platformPaths.builtinSkillsRootDir;
  await ensureBuiltinSkillsInstalled({ rootDir });
  const resolved = await resolveBuiltinSkillsDir(rootDir);
  if (!options.builtinRootDir) activeBuiltinSkillsDir = resolved;
  return resolved;
}
