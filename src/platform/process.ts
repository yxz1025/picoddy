import { spawnSync } from "node:child_process";
const platformOs = process.platform === "win32" ? "windows" : process.platform;

import { runWindowsProcessNoWindow } from "./windows_process.ts";

export interface ProcessCall {
  command: string;
  args: string[];
  timeoutMs?: number;
  env?: Record<string, string>;
  stdin?: Uint8Array;
}

export interface ProcessResult {
  code: number;
  stdout: string;
  stderr: string;
}

export type ProcessRunner = (call: ProcessCall) => Promise<ProcessResult>;

export const runProcess: ProcessRunner = async (call) => {
  if (platformOs === "windows") {
    const result = await runWindowsProcessNoWindow({
      command: call.command,
      args: call.args,
      env: call.env,
      stdin: call.stdin,
      timeoutMs: call.timeoutMs,
    });
    const decoded: ProcessResult = {
      code: result.code,
      stdout: new TextDecoder().decode(result.stdout),
      stderr: new TextDecoder().decode(result.stderr),
    };
    if (!result.success) {
      throw new Error(
        `${call.command} 执行失败（${result.code}）：${decoded.stderr.trim()}`,
      );
    }
    return decoded;
  }
  const r = spawnSync(call.command, call.args, {
    env: call.env ?? process.env,
    input: call.stdin,
    timeout: call.timeoutMs,
  });
  if (r.error) throw r.error;
  const decoded: ProcessResult = {
    code: r.status ?? 0,
    stdout: r.stdout ? new TextDecoder().decode(r.stdout) : "",
    stderr: r.stderr ? new TextDecoder().decode(r.stderr) : "",
  };
  if (r.status !== 0) {
    throw new Error(
      `${call.command} 执行失败（${r.status}）：${decoded.stderr.trim()}`,
    );
  }
  return decoded;
};
