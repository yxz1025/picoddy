import { Type } from "typebox";
import { dependencyInstallEnvironment } from './dependency_install.ts';
import type { AgentTool } from "@earendil-works/pi-agent-core";
import { runWindowsProcessNoWindow } from "../../platform/windows_process.ts";
import { createDefaultManagedRuntimeService, type ManagedRuntimeService } from "../../platform/runtime/index.ts";

const MAX_OUTPUT = 1024 * 1024;

const schema = Type.Object({
  command: Type.String({ description: "要执行的 Windows 命令" }),
  timeout: Type.Optional(Type.Number({ description: "超时秒数" })),
});

function windowsDirectory(
  env: { get(key: string): string | undefined } = { get: (key) => process.env[key] },
): string {
  return env.get("SystemRoot") || env.get("WINDIR") || "C:\\Windows";
}

export function resolveWindowsCommandInterpreter(
  env: { get(key: string): string | undefined } = { get: (key) => process.env[key] },
): string {
  return `${windowsDirectory(env)}\\System32\\cmd.exe`;
}

export function windowsCommandSpec(
  command: string,
  env: { get(key: string): string | undefined } = { get: (key) => process.env[key] },
): { command: string; rawArguments: string } {
  const systemDirectory = `${windowsDirectory(env)}\\System32`;
  const interpreter = `${systemDirectory}\\cmd.exe`;
  const utf8Command = `"${systemDirectory}\\chcp.com" 65001 >nul & ${command}`;
  return {
    command: interpreter,
    rawArguments: `/d /s /c "${utf8Command}"`,
  };
}

export function createWindowsShellTool(
  cwd: string,
  runtime?: ManagedRuntimeService,
): AgentTool<
  typeof schema,
  { exitCode: number }
> {
  return {
    name: "bash",
    label: "终端命令",
    description:
      "通过隐藏窗口的 Windows 子进程执行 cmd.exe 命令。",
    parameters: schema,
    execute: async (_id, input, signal) => {
      const spec = windowsCommandSpec(input.command);
      const env = await (runtime ?? createDefaultManagedRuntimeService()).buildShellEnv();
      const result = await runWindowsProcessNoWindow({
        ...spec,
        inheritEnv: false,
        cwd,
        env: { ...dependencyInstallEnvironment(), ...Object.fromEntries(Object.entries(env).filter((entry): entry is [string, string] => entry[1] !== undefined)) },
        timeoutMs: input.timeout ? input.timeout * 1000 : undefined,
        maxOutputBytes: MAX_OUTPUT,
        signal,
      });
      const stdout = new TextDecoder().decode(result.stdout);
      const stderr = new TextDecoder().decode(result.stderr);
      const output = (stdout + stderr).trim();
      const truncated = result.stdout.length >= MAX_OUTPUT ||
        result.stderr.length >= MAX_OUTPUT;
      const suffix = truncated ? "\n[输出已截断为 1 MiB]" : "";
      const error = result.timedOut
        ? `命令执行超时：${input.timeout} 秒`
        : undefined;
      const text = error || output || "(命令无输出)";
      return {
        content: [{ type: "text", text: text + suffix }],
        details: { exitCode: result.code },
        isError: result.code !== 0,
      };
    },
  };
}
