import { spawn } from "node:child_process";
import { startOperation, logOperationEvent } from "../infra/operation_log.ts";

const DEFAULT_MAX_OUTPUT_BYTES = 16 * 1024 * 1024;

export function quoteWindowsCommandLineArgument(argument: string): string {
  if (argument.length > 0 && !/[\s"]/u.test(argument)) return argument;
  let quoted = '"';
  let backslashes = 0;
  for (const character of argument) {
    if (character === "\\") {
      backslashes++;
      continue;
    }
    if (character === '"') {
      quoted += "\\".repeat(backslashes * 2 + 1);
      quoted += '"';
      backslashes = 0;
      continue;
    }
    quoted += "\\".repeat(backslashes);
    quoted += character;
    backslashes = 0;
  }
  quoted += "\\".repeat(backslashes * 2);
  return `${quoted}"`;
}

export function windowsCommandLine(
  command: string,
  args: string[],
): string {
  return [command, ...args].map(quoteWindowsCommandLineArgument).join(" ");
}

export interface WindowsProcessOptions {
  command: string;
  args?: string[];
  rawArguments?: string;
  cwd?: string;
  env?: Record<string, string>;
  /** False when env is already a complete, sanitized environment. */
  inheritEnv?: boolean;
  stdin?: Uint8Array;
  timeoutMs?: number;
  maxOutputBytes?: number;
  signal?: AbortSignal;
}

export interface WindowsProcessOutput {
  code: number;
  success: boolean;
  stdout: Uint8Array;
  stderr: Uint8Array;
  timedOut: boolean;
}

function windowsEnvironment(options: WindowsProcessOptions): NodeJS.ProcessEnv {
  const entries = new Map<string, [string, string]>();
  for (const [key, value] of Object.entries(options.inheritEnv === false ? {} : process.env)) {
    if (value !== undefined) entries.set(key.toLowerCase(), [key, value]);
  }
  for (const [key, value] of Object.entries(options.env ?? {})) {
    if (key.includes("=") || key.includes("\0") || value.includes("\0")) {
      throw new Error(`Invalid Windows environment variable: ${key}`);
    }
    entries.set(key.toLowerCase(), [key, value]);
  }
  return Object.fromEntries(entries.values());
}

async function runWindowsProcessNoWindowInternal(
  options: WindowsProcessOptions,
): Promise<WindowsProcessOutput> {
  if (process.platform !== "win32") {
    throw new Error("Windows process runner is only available on Windows");
  }
  const maxBytes = options.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES;
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 0) {
    throw new Error("maxOutputBytes must be a non-negative safe integer");
  }
  if (options.timeoutMs !== undefined &&
      (!Number.isFinite(options.timeoutMs) || options.timeoutMs < 0 || options.timeoutMs > 2147483647)) {
    throw new Error("timeoutMs must be between 0 and 2147483647");
  }
  const env = windowsEnvironment(options);
  options.signal?.throwIfAborted();
  return new Promise((resolve, reject) => {
    // rawArguments already contains cmd.exe quoting; do not quote it a second time.
    const child = spawn(options.command,
      options.rawArguments === undefined ? options.args ?? [] : [options.rawArguments], {
        cwd: options.cwd,
        env,
        windowsHide: true,
        windowsVerbatimArguments: options.rawArguments !== undefined,
        shell: false,
        stdio: ["pipe", "pipe", "pipe"],
      });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let timedOut = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let settled = false;
    const terminateTree = () => {
      if (child.pid) {
        // cmd.exe alone does not own the lifetime of npm/node descendants.
        const killer = spawn(`${process.env.SystemRoot || 'C:\\Windows'}\\System32\\taskkill.exe`, ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
        killer.on('error', () => { child.kill(); });
        killer.on('close', code => { if (code !== 0) child.kill(); });
      } else child.kill();
    };
    const abort = () => fail(new Error('Windows process aborted', { cause: options.signal?.reason }));
    const fail = (error: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      options.signal?.removeEventListener('abort', abort);
      terminateTree();
      child.stdin.destroy();
      child.stdout.destroy();
      child.stderr.destroy();
      reject(error);
    };
    child.on("error", fail);
    child.once("spawn", () => {
      logOperationEvent("windows.process.spawned", "event", { childPid: child.pid });
    });
    // Keep draining after the capture limit to avoid blocking a verbose child.
    child.stdout.on("data", (chunk: Buffer) => {
      const keep = Math.min(chunk.length, maxBytes - stdoutBytes);
      if (keep > 0) stdout.push(Buffer.from(chunk.subarray(0, keep)));
      stdoutBytes += keep;
    });
    child.stderr.on("data", (chunk: Buffer) => {
      const keep = Math.min(chunk.length, maxBytes - stderrBytes);
      if (keep > 0) stderr.push(Buffer.from(chunk.subarray(0, keep)));
      stderrBytes += keep;
    });
    child.stdout.on("error", fail);
    child.stderr.on("error", fail);
    child.stdin.on("error", (error: NodeJS.ErrnoException) => {
      // A child may exit or close stdin before consuming the complete input.
      if (error.code !== "EPIPE" && error.code !== "EOF" && error.code !== "ECONNRESET") fail(error);
    });
    child.once("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      options.signal?.removeEventListener('abort', abort);
      // Preserve unsigned Windows status codes (e.g. 0xC0000005).
      const exitCode = timedOut ? 124 : code === null ? -1 : code >>> 0;
      resolve({
        code: exitCode,
        success: exitCode === 0,
        stdout: Buffer.concat(stdout, stdoutBytes),
        stderr: Buffer.concat(stderr, stderrBytes),
        timedOut,
      });
    });
    if (options.timeoutMs !== undefined) {
      timer = setTimeout(() => {
        timedOut = true;
        logOperationEvent("windows.process.timeout", "event", { childPid: child.pid });
        terminateTree();
        // Descendants can inherit the pipes; do not wait indefinitely for their EOF.
        child.stdin.destroy();
        child.stdout.destroy();
        child.stderr.destroy();
      }, options.timeoutMs);
    }
    // Async stdin and simultaneous output draining avoid pipe backpressure deadlocks.
    options.signal?.addEventListener('abort', abort, { once: true });
    if (options.signal?.aborted) { abort(); return; }
    child.stdin.end(options.stdin);
  });
}

export async function runWindowsProcessNoWindow(
  options: WindowsProcessOptions,
): Promise<WindowsProcessOutput> {
  const operation = startOperation("windows.process.create", {
    command: options.command,
    argumentCount: options.args?.length ?? 0,
    hasRawArguments: options.rawArguments !== undefined,
    stdinLength: options.stdin?.length ?? 0,
    timeoutMs: options.timeoutMs,
    runner: "node:child_process.spawn",
  });
  try {
    const result = await runWindowsProcessNoWindowInternal(options);
    const resultMetadata = {
      exitCode: result.code,
      success: result.success,
      timedOut: result.timedOut,
    };
    if (result.success) {
      operation.success(resultMetadata);
    } else {
      operation.error(
        new Error(`Windows child process exited with code ${result.code}`),
        resultMetadata,
      );
    }
    return result;
  } catch (error) {
    operation.error(error);
    throw error;
  }
}
