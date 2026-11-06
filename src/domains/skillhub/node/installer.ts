import { randomUUID } from "node:crypto";
import { access, mkdir, rename, rm } from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";

import { platformPaths } from "../../../platform/paths.ts";
import {
  createCliPluginRegistry,
  runBundledCli,
  type CliRunner,
} from "../../../platform/cli/runtime.ts";
import { BUILTIN_CLI_PLUGINS } from "../../../platform/cli/plugins.ts";
import { resolveSkillHubBaseUrl } from "./config.ts";

const CLI_PLUGINS = createCliPluginRegistry(BUILTIN_CLI_PLUGINS);

export interface SkillHubCliInstallInput {
  namespace: string;
  slug: string;
  version: string;
}

export type SkillHubCliRunner = CliRunner;

export interface SkillHubCliInstallOptions {
  baseUrl?: string;
  skillsDir?: string;
  workDir?: string;
  token?: string;
  cliEntry?: string;
  runner?: SkillHubCliRunner;
}

export function findInstalledSkillBySlug<
  T extends { builtin: boolean; path: string },
>(
  skills: readonly T[],
  skillsDir: string,
  slug: string,
  namespace?: string,
): T | null {
  const expectedSkillFiles = [
    resolve(skillsDir, slug, "SKILL.md"),
    ...(namespace ? [resolve(skillsDir, `${namespace}--${slug}`, "SKILL.md")] : []),
  ];
  return skills.find((skill) =>
    !skill.builtin && expectedSkillFiles.includes(resolve(skill.path))
  ) ?? null;
}

export async function installedSkillPackageExists(
  skillsDir: string,
  namespace: string,
  slug: string,
): Promise<boolean> {
  const candidates = [
    resolve(skillsDir, slug, "SKILL.md"),
    resolve(skillsDir, `${namespace}--${slug}`, "SKILL.md"),
  ];
  for (const candidate of candidates) {
    try {
      await access(candidate);
      return true;
    } catch { /* try the next supported layout */ }
  }
  return false;
}

function coordinatePart(value: string, label: string): string {
  const normalized = value.trim();
  if (
    !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(normalized) ||
    normalized.endsWith(".") ||
    normalized.endsWith("-")
  ) {
    throw new Error(`SkillHub ${label}无效`);
  }
  return normalized;
}

function installVersion(value: string): string {
  const normalized = value.trim();
  if (!normalized || normalized.length > 128 || normalized.startsWith("-") || /\s/u.test(normalized)) {
    throw new Error("SkillHub version无效");
  }
  return normalized;
}

async function normalizeInstallDirectory(
  skillsDir: string,
  namespace: string,
  slug: string,
): Promise<void> {
  if (namespace === "global") return;
  const namespacedDir = resolve(skillsDir, `${namespace}--${slug}`);
  const slugDir = resolve(skillsDir, slug);
  const backupDir = resolve(
    skillsDir,
    `.${slug}.skillhub-backup-${randomUUID()}`,
  );
  await access(namespacedDir);
  let backedUp = false;
  try {
    await rename(slugDir, backupDir);
    backedUp = true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  try {
    await rename(namespacedDir, slugDir);
  } catch (error) {
    if (backedUp) {
      try {
        await rename(backupDir, slugDir);
      } catch (rollbackError) {
        throw new Error("SkillHub 技能目录替换失败且无法恢复原目录", {
          cause: rollbackError,
        });
      }
    }
    throw error;
  }
  if (backedUp) await rm(backupDir, { recursive: true, force: true });
}

function registryUrl(value: string): string {
  try {
    const url = new URL(value.trim());
    if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error();
    return url.toString().replace(/\/+$/, "");
  } catch {
    throw new Error("SkillHub registry地址无效");
  }
}

function safeCliError(error: unknown): Error {
  const record = error && typeof error === "object"
    ? error as Record<string, unknown>
    : {};
  const exitCode = typeof record.code === "number" ? record.code : null;
  const diagnostic = typeof record.stderr === "string" ? record.stderr : "";
  const processCode = typeof record.code === "string" ? record.code : "";
  const combined = `${processCode}\n${diagnostic}`;
  if (exitCode === 2) {
    return new Error("SkillHub CLI 鉴权失败");
  }
  if (exitCode === 3) return new Error("SkillHub CLI 网络请求失败");
  if (exitCode === 4) return new Error("SkillHub CLI 无法写入技能目录");
  if (exitCode === 5) return new Error("SkillHub CLI 安装参数无效");
  if (record.killed === true || record.code === "ETIMEDOUT") {
    return new Error("SkillHub CLI 安装超时");
  }
  if (/\b(?:EACCES|EPERM|EROFS)\b|permission denied|read-only file system/iu.test(combined)) {
    return new Error("SkillHub CLI 无法写入本地目录");
  }
  if (/\b(?:ENOTEMPTY|EEXIST)\b/iu.test(combined)) {
    return new Error("SkillHub CLI 无法替换已有技能");
  }
  if (/\b(?:401|403)\b|unauthori[sz]ed|forbidden|invalid token|not logged in/iu.test(combined)) {
    return new Error("SkillHub CLI 鉴权失败");
  }
  if (/\bHTTP\s+5\d\d\b|["']code["']\s*:\s*5\d\d|unexpected error/iu.test(combined)) {
    return new Error("SkillHub 服务安装接口异常");
  }
  return new Error("SkillHub CLI 安装失败");
}

export async function installSkillHubSkillWithCli(
  input: SkillHubCliInstallInput,
  options: SkillHubCliInstallOptions = {},
): Promise<void> {
  const namespace = coordinatePart(input.namespace, "namespace");
  const slug = coordinatePart(input.slug, "slug");
  installVersion(input.version);
  const skillsDir = options.skillsDir ?? platformPaths.skillsDir;
  const workDir = options.workDir ?? join(
    platformPaths.appDataDir,
    "skillhub-runtime",
  );
  const configPath = join(workDir, `clawhub-config-${randomUUID()}.json`);
  if (!isAbsolute(skillsDir)) throw new Error("SkillHub 技能目录无效");
  if (!isAbsolute(workDir)) throw new Error("SkillHub CLI 工作目录无效");
  const baseUrl = registryUrl(
    options.baseUrl ?? resolveSkillHubBaseUrl(),
  );
  const token = options.token?.trim();
  if (!token) throw new Error("SkillHub 缺少用户 Token，请先进入技能市场登录");
  try {
    const plugin = CLI_PLUGINS.get("skillhub");
    if (!plugin) throw new Error("SkillHub CLI 插件未注册");
    await mkdir(workDir, { recursive: true, mode: 0o700 });
    await runBundledCli(
      plugin,
      [
        "--registry", baseUrl,
        "--workdir", workDir,
        "--no-input",
        "login",
        "--token",
        token,
      ],
      {
        resolveEntry: options.cliEntry ? () => options.cliEntry! : undefined,
        runner: options.runner,
        managedEnv: {
          CLAWHUB_REGISTRY: baseUrl,
          CLAWHUB_CONFIG_PATH: configPath,
        },
      },
    );
    await runBundledCli(
      plugin,
      [
        "--registry", baseUrl,
        "--workdir", workDir,
        "--dir", skillsDir,
        "install",
        namespace === "global" ? slug : `${namespace}--${slug}`,
        "--force",
      ],
      {
        resolveEntry: options.cliEntry ? () => options.cliEntry! : undefined,
        runner: options.runner,
        managedEnv: {
          CLAWHUB_REGISTRY: baseUrl,
          CLAWHUB_CONFIG_PATH: configPath,
        },
      },
    );
    await normalizeInstallDirectory(skillsDir, namespace, slug);
  } catch (error) {
    if (error instanceof Error && error.message === "SkillHub CLI 安装失败") {
      throw error;
    }
    throw safeCliError(error);
  } finally {
    await rm(configPath, { force: true }).catch(() => {});
  }
}
