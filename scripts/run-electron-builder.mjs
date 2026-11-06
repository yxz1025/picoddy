import { existsSync } from "node:fs";
import { spawn } from "node:child_process";
import { delimiter, join, resolve } from "node:path";
import process from "node:process";
import nativeDependencies from "./verify-native-dependencies.cjs";

const projectRoot = resolve(import.meta.dirname, "..");
const builderCli = resolve(projectRoot, "node_modules", "electron-builder", "cli.js");
nativeDependencies.verifyNativeDependencies(projectRoot);

if (!existsSync(builderCli)) {
  throw new Error(`electron-builder CLI 不存在：${builderCli}`);
}

const env = { ...process.env };
// All distributed artifacts currently follow the explicitly unsigned product policy.
env.CSC_IDENTITY_AUTO_DISCOVERY = "false";
delete env.CSC_LINK;
delete env.WIN_CSC_LINK;
delete env.CSC_NAME;
if (process.platform === "win32") {
  const systemRoot = env.SystemRoot || env.WINDIR || "C:\\Windows";
  const windowsPowerShellDir = join(
    systemRoot,
    "System32",
    "WindowsPowerShell",
    "v1.0",
  );
  const currentPath = env.PATH || env.Path || "";
  const hasPowerShellDir = currentPath
    .split(delimiter)
    .some((entry) => entry.toLocaleLowerCase() === windowsPowerShellDir.toLocaleLowerCase());
  if (existsSync(join(windowsPowerShellDir, "powershell.exe")) && !hasPowerShellDir) {
    // electron-builder 会在收集 npm 依赖时启动 powershell.exe。部分企业镜像
    // 能让交互式 PowerShell 发现它，但不会把目录放入 Node 子进程 PATH。
    env.PATH = `${windowsPowerShellDir}${delimiter}${currentPath}`;
  }

  // Windows 上杀毒软件、索引器或刚关闭的解压流可能短暂占用目录，导致
  // electron-builder 将 `${output}.tmp` 原子提升为最终目录时返回 EPERM/EBUSY。
  // 仅为这种精确的临时目录重命名加载有限重试，不改变其他文件系统操作。
  const renameRetryPreload = resolve(
    projectRoot,
    "scripts",
    "windows-fs-rename-retry.cjs",
  ).replaceAll("\\", "/");
  const renameRetryOption = `--require="${renameRetryPreload}"`;
  env.NODE_OPTIONS = env.NODE_OPTIONS
    ? `${env.NODE_OPTIONS} ${renameRetryOption}`
    : renameRetryOption;
}

const child = spawn(process.execPath, [builderCli, ...process.argv.slice(2)], {
  env,
  stdio: "inherit",
});

child.once("error", (error) => {
  console.error(error);
  process.exitCode = 1;
});
child.once("exit", (code, signal) => {
  process.exitCode = code ?? (signal ? 1 : 0);
});
