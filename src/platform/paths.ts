import { posix, win32 } from "node:path";
import type { PlatformEnvironment } from "./runtime.ts";
import { currentPlatform } from "./runtime.ts";

export interface PlatformPaths {
  homeDir: string;
  tempDir: string;
  installationDir: string;
  appDataDir: string;
  connectorsDir: string;
  systemDir: string;
  builtinSkillsRootDir: string;
  builtinSkillsDir: string;
  artifactsDir: string;
  skillsDir: string;
  join(...parts: string[]): string;
  dirname(path: string): string;
  basename(path: string): string;
  isAbsolute(path: string): boolean;
  expandHome(path: string): string;
}

function withoutTrailingSeparator(path: string, separator: string): string {
  if (path.length <= 1) return path;
  if (/^[A-Za-z]:[\\/]$/.test(path)) return path;
  return path.endsWith(separator) ? path.slice(0, -1) : path;
}

export function createPlatformPaths(input: PlatformEnvironment): PlatformPaths {
  const windows = input.os === "windows";
  const pathApi = windows ? win32 : posix;
  const env = input.env;
  const installationDir = pathApi.dirname(input.execPath || process.execPath);
  const homeDir = windows
    ? env.USERPROFILE || env.HOME || "C:\\Users\\Default"
    : env.HOME || "/tmp";
  const tempDir = withoutTrailingSeparator(
    windows
      ? env.TEMP || env.TMP || pathApi.join(homeDir, "AppData", "Local", "Temp")
      : env.TMPDIR || env.TMP || "/tmp",
    pathApi.sep,
  );
  const appDataDir = windows
    ? pathApi.join(
      env.LOCALAPPDATA || pathApi.join(homeDir, "AppData", "Local"),
      "PiCoddy",
    )
    : pathApi.join(homeDir, ".picoddy");
  const systemDir = pathApi.join(appDataDir, "system");
  const builtinSkillsRootDir = pathApi.join(systemDir, "builtin-skills");

  return {
    homeDir,
    tempDir,
    installationDir,
    appDataDir,
    connectorsDir: pathApi.join(appDataDir, "connectors"),
    systemDir,
    builtinSkillsRootDir,
    // This is the immutable versions container. Resolve the active digest via
    // resolveBuiltinSkillsDir(); callers must not scan this container directly.
    builtinSkillsDir: pathApi.join(builtinSkillsRootDir, "versions"),
    artifactsDir: pathApi.join(appDataDir, "artifacts"),
    skillsDir: pathApi.join(appDataDir, "skills"),
    join: (...parts) => pathApi.join(...parts),
    dirname: (path) => pathApi.dirname(path),
    basename: (path) => pathApi.basename(path),
    isAbsolute: (path) => pathApi.isAbsolute(path),
    expandHome: (path) => {
      if (path === "~") return homeDir;
      if (path.startsWith("~/") || path.startsWith("~\\")) {
        return pathApi.join(
          homeDir,
          path.slice(2).replaceAll(/[\\/]+/g, pathApi.sep),
        );
      }
      return path;
    },
  };
}

export const platformPaths = createPlatformPaths({
  os: currentPlatform,
  execPath: process.execPath,
  env: {
    HOME: process.env.HOME,
    USERPROFILE: process.env.USERPROFILE,
    LOCALAPPDATA: process.env.LOCALAPPDATA,
    TEMP: process.env.TEMP,
    TMP: process.env.TMP,
    TMPDIR: process.env.TMPDIR,
  },
});
