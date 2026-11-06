// src/agent/sandbox.ts
// Pi-Sandbox: Pi-Agent 引擎核心沙箱模块
// 包含：进程级安全门控、环境变量净化、文件系统边界隔离、Docker 容器隔离自适应检测与高危指令动态拦截。

import type { SupportedPlatform } from "../platform/runtime.ts";
const platformOs = process.platform === "win32" ? "windows" : process.platform;

import { runWindowsProcessNoWindow } from "../platform/windows_process.ts";
import {
  assertResolvedWritableTarget,
  assertWritableTarget,
  commandReferencesProtectedWrite,
  defaultProtectedPathPolicy,
  parseShellWriteTargets,
  type ProtectedPathPolicy,
  type ResolvedPathOptions,
} from "../platform/path_policy.ts";

export interface SandboxPolicy {
  enableEnvironmentSanitization: boolean;
  enablePathBoundaryCheck: boolean;
  blockedCommandPatterns: RegExp[];
  sanitizedEnvVars: string[];
}

export const DEFAULT_SANDBOX_POLICY: SandboxPolicy = {
  enableEnvironmentSanitization: true,
  enablePathBoundaryCheck: true,
  sanitizedEnvVars: [
    "AWS_SECRET_ACCESS_KEY",
    "AWS_ACCESS_KEY_ID",
    "OPENAI_API_KEY",
    "ANTHROPIC_API_KEY",
    "DEEPSEEK_API_KEY",
    "GITHUB_TOKEN",
    "SLACK_BOT_TOKEN",
  ],
  blockedCommandPatterns: [
    /^\s*rm\s+-[rRfF]*\s+\/\s*$/, // rm -rf /
    /^\s*rm\s+-[rRfF]*\s+~\s*$/, // rm -rf ~
    /^\s*rm\s+-[rRfF]*\s+\*$/, // rm -rf *
    /:\(\)\s*\{\s*:\|\:&\s*\}\s*;\s*:/, // Fork Bomb 炸弹指令
    />\s*\/dev\/sd[a-z]/, // 覆盖物理磁盘裸设备
    />\s*\/dev\/nvme/, // 覆盖 NVMe 裸设备
    /^\s*dd\s+if=.*of=\/dev\//, // dd 覆盖设备
    /^\s*mkfs\./, // 格式化文件系统
    /chmod\s+(-R\s+)?777\s+\//, // 毁灭性全盘提权
    /curl\s+.*\|\s*(sudo\s+)?sh\b/, // 未经检查的远程脚本管道提权
    /wget\s+.*\|\s*(sudo\s+)?sh\b/,
  ],
};

export interface SandboxInspectionResult {
  allowed: boolean;
  reason?: string;
  isDangerous?: boolean;
}

const WINDOWS_BLOCKED_COMMAND_PATTERNS: RegExp[] = [
  /^\s*(?:powershell(?:\.exe)?\s+.*)?remove-item\b.*(?:-[a-z]*recurse\b.*-[a-z]*force|-[a-z]*force\b.*-[a-z]*recurse).*(?:[a-z]:\\(?:\s|$)|\\\\)/i,
  /^\s*(?:cmd(?:\.exe)?\s+\/[a-z]\s+)?del\b.*\/s\b.*\/q\b.*[a-z]:\\(?:\s|$)/i,
  /^\s*format(?:\.com)?\s+[a-z]:/i,
  /^\s*diskpart(?:\.exe)?\b/i,
  /^\s*cipher(?:\.exe)?\s+\/w:/i,
];

function windowsProtectedPath(filePath: string): boolean {
  const normalized = filePath.replaceAll("/", "\\").toLowerCase();
  return /^[a-z]:\\windows(?:\\|$)/.test(normalized) ||
    /^[a-z]:\\program files(?: \(x86\))?(?:\\|$)/.test(normalized) ||
    /^[a-z]:\\programdata\\microsoft\\windows(?:\\|$)/.test(normalized);
}

/**
 * 可注入平台的纯审查函数。Windows 只增加自身规则；Darwin/Linux 严格保留原规则。
 */
export function inspectToolCallForPlatform(
  os: SupportedPlatform,
  toolName: string,
  args: any,
  policy: SandboxPolicy = DEFAULT_SANDBOX_POLICY,
  protectedPathPolicy?: ProtectedPathPolicy,
): SandboxInspectionResult {
  const pathPolicy = protectedPathPolicy ??
    (defaultProtectedPathPolicy.os === os
      ? defaultProtectedPathPolicy
      : undefined);
  if (pathPolicy) {
    const denial = inspectProtectedPath(toolName, args, pathPolicy);
    if (denial) return denial;
  }

  if (toolName === "bash" || toolName === "run_command") {
    const cmdStr = (args?.command || args?.CommandLine || "").trim();
    const patterns = os === "windows"
      ? [...policy.blockedCommandPatterns, ...WINDOWS_BLOCKED_COMMAND_PATTERNS]
      : policy.blockedCommandPatterns;
    for (const pattern of patterns) {
      if (pattern.test(cmdStr)) {
        return {
          allowed: false,
          isDangerous: true,
          reason:
            `[Pi-Sandbox] 拦截到高危系统破坏性指令: "${cmdStr}"。保护宿主机绝对安全。`,
        };
      }
    }
  }

  if (toolName === "write" || toolName === "edit") {
    const filePath = (args?.filePath || args?.path || "").trim();
    if (os === "windows" && windowsProtectedPath(filePath)) {
      return {
        allowed: false,
        isDangerous: true,
        reason: `[Pi-Sandbox] 禁止修改 Windows 系统关键目录: "${filePath}"`,
      };
    }
    if (
      filePath.startsWith("/etc/") ||
      filePath.startsWith("/System/") ||
      filePath.startsWith("/usr/bin/")
    ) {
      return {
        allowed: false,
        isDangerous: true,
        reason:
          `[Pi-Sandbox] 禁止修改 macOS / Linux 系统底层关键配置: "${filePath}"`,
      };
    }
  }

  return { allowed: true };
}

const PATH_WRITE_TOOLS = new Set([
  "write",
  "edit",
  "delete",
  "remove",
  "move",
  "copy",
  "write_file",
  "edit_file",
  "delete_file",
  "move_file",
  "copy_file",
  "write_docx",
  "write_xlsx",
  "write_pptx",
  "edit_docx",
  "edit_xlsx",
  "edit_docx_free",
  "edit_pptx",
]);

/** Shared explicit filesystem argument vocabulary for built-ins and MCP. */
export const WRITABLE_PATH_KEYS = new Set([
  "filePath",
  "path",
  "target",
  "targetPath",
  "destination",
  "destinationPath",
  "dest",
  "to",
  "newPath",
  "source",
  "sourcePath",
  "sources",
  "sourcePaths",
  "from",
  "oldPath",
  "linkPath",
  "fileName",
  "outFileName",
  "outputPath",
  "localPath",
  "outputFile",
  "folder",
]);

function writableTargets(toolName: string, args: any): string[] {
  if (!PATH_WRITE_TOOLS.has(toolName)) return [];
  const destinationKeys = [
    "target",
    "targetPath",
    "destination",
    "destinationPath",
    "dest",
    "to",
    "newPath",
  ];
  const sourceKeys = ["source", "sourcePath", "sources", "sourcePaths", "from"];
  // Document generators and generic adapters share the same key vocabulary.
  const ordinaryKeys = [...WRITABLE_PATH_KEYS];
  const moving = toolName === "move" || toolName === "move_file";
  const copying = toolName === "copy" || toolName === "copy_file";
  const explicitDereference = args?.dereference === true ||
    (args?.followSymlinks === true && args?.preserveSymlinks === false &&
      args?.noDereference !== true);
  const copyingCapability = copying && !explicitDereference;
  const keys = moving
    ? [...ordinaryKeys, ...sourceKeys, ...destinationKeys]
    : copying
    ? [...(copyingCapability ? sourceKeys : []), ...destinationKeys]
    : [...ordinaryKeys, ...destinationKeys];
  return keys.flatMap((key) => {
    const value = args?.[key];
    const values = Array.isArray(value) ? value : [value];
    return values.filter((item): item is string =>
      typeof item === "string" && item.trim().length > 0
    );
  });
}

function protectedDenial(detail: string): SandboxInspectionResult {
  return {
    allowed: false,
    isDangerous: true,
    reason: `[Pi-Sandbox] protected path hard denial: ${detail}`,
  };
}

function inspectProtectedPath(
  toolName: string,
  args: any,
  policy: ProtectedPathPolicy,
): SandboxInspectionResult | undefined {
  if (toolName === "bash" || toolName === "run_command") {
    const command = String(args?.command ?? args?.CommandLine ?? "");
    if (commandReferencesProtectedWrite(command, policy)) {
      return protectedDenial("shell command targets protected system files");
    }
    return undefined;
  }
  for (const target of writableTargets(toolName, args)) {
    try {
      assertWritableTarget(target, policy);
    } catch (error) {
      return protectedDenial(
        error instanceof Error ? error.message : String(error),
      );
    }
  }
  return undefined;
}

export async function inspectResolvedToolCallForPlatform(
  os: SupportedPlatform,
  toolName: string,
  args: any,
  protectedPathPolicy?: ProtectedPathPolicy,
  resolvedOptions: ResolvedPathOptions = {},
): Promise<SandboxInspectionResult> {
  const policy = protectedPathPolicy ??
    (defaultProtectedPathPolicy.os === os
      ? defaultProtectedPathPolicy
      : undefined);
  if (!policy) return { allowed: true };
  if (toolName === "bash" || toolName === "run_command") {
    const command = String(args?.command ?? args?.CommandLine ?? "");
    if (policy.nativeShellProtection && policy.os === "darwin") {
      return command.includes("\0") ? protectedDenial("command contains NUL") : { allowed: true };
    }
    const parsed = parseShellWriteTargets(command, policy.os);
    if (parsed.unsafeDynamicTarget) {
      return protectedDenial("shell write target is dynamic or ambiguous");
    }
    for (const target of parsed.targets) {
      if (!target.resolve) continue;
      try {
        await assertResolvedWritableTarget(
          target.path,
          policy,
          resolvedOptions,
        );
      } catch (error) {
        return protectedDenial(
          error instanceof Error ? error.message : String(error),
        );
      }
    }
  }
  for (const target of writableTargets(toolName, args)) {
    try {
      await assertResolvedWritableTarget(target, policy, resolvedOptions);
    } catch (error) {
      return protectedDenial(
        error instanceof Error ? error.message : String(error),
      );
    }
  }
  return { allowed: true };
}

export class PiSandbox {
  private static instance: PiSandbox;
  private policy: SandboxPolicy = DEFAULT_SANDBOX_POLICY;

  private constructor() {}

  public static getInstance(): PiSandbox {
    if (!PiSandbox.instance) {
      PiSandbox.instance = new PiSandbox();
    }
    return PiSandbox.instance;
  }

  /**
   * 净化工具调用的环境变量，防止恶意脚本向外部逃逸敏感 API Key
   */
  public sanitizeEnvironment(
    env: Record<string, string>,
  ): Record<string, string> {
    if (!this.policy.enableEnvironmentSanitization) return { ...env };
    const cleanEnv = { ...env };
    for (const key of this.policy.sanitizedEnvVars) {
      delete cleanEnv[key];
    }
    return cleanEnv;
  }

  /**
   * 沙箱核心审查：对工具及 Shell 指令进行极速安全校验
   */
  public inspectToolCall(toolName: string, args: any): SandboxInspectionResult {
    return inspectToolCallForPlatform(
      platformOs as SupportedPlatform,
      toolName,
      args,
      this.policy,
    );
  }

  /**
   * 诊断当前宿主机环境支持的沙箱模式
   */
  public async getSandboxCapabilities(): Promise<{
    denoPermissionGate: boolean;
    pathBoundaryProtection: boolean;
    dockerAvailable: boolean;
  }> {
    let dockerAvailable = false;
    try {
      const r = platformOs === "windows"
        ? await runWindowsProcessNoWindow({
          command: "docker.exe",
          args: ["--version"],
          timeoutMs: 5000,
          maxOutputBytes: 1024,
        })
        : (() => { const { spawnSync: ss } = require("node:child_process"); const r = ss("docker", ["--version"], { stdio: "ignore" }); return { code: r.status ?? 1 }; })();
      dockerAvailable = r.code === 0;
    } catch {
      dockerAvailable = false;
    }

    return {
      denoPermissionGate: true,
      pathBoundaryProtection: true,
      dockerAvailable,
    };
  }
}
