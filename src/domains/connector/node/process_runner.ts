import { updateGate } from "../../../infra/update-gate.ts";
import { spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";

import { ConnectorError } from "./errors.ts";

export interface RunConnectorProcessOptions {
  readonly executable: string;
  readonly argv: readonly string[];
  readonly cwd?: string;
  readonly env?: NodeJS.ProcessEnv;
  readonly timeoutMs?: number;
  readonly maxOutputBytes?: number;
  readonly maxStderrBytes?: number;
  readonly signal?: AbortSignal;
  // 按行回调：stdout 与 stderr 的行合并触发（授权 URL 可能落在任一流）；残余无换行行在进程退出时补发
  readonly onLine?: (line: string) => void;
}

export interface ConnectorProcessResult {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
  readonly command: { readonly executable: string; readonly argv: readonly string[]; readonly shell: false };
}

const DEFAULT_TIMEOUT_MS = 120_000;
const DEFAULT_MAX_OUTPUT_BYTES = 1024 * 1024;
const DEFAULT_MAX_STDERR_BYTES = 1024 * 1024;
const KILL_GRACE_MS = 2_000;

function minimalEnvironment(): NodeJS.ProcessEnv {
  const result: NodeJS.ProcessEnv = {};
  for (const key of ["PATH", "HOME", "USERPROFILE", "LOCALAPPDATA", "TEMP", "TMP", "TMPDIR", "SystemRoot", "COMSPEC"] as const) {
    const value = process.env[key];
    if (value !== undefined) result[key] = value;
  }
  return result;
}

function terminateProcessTree(child: ChildProcess): void {
  const pid = child.pid;
  if (pid === undefined) return;
  if (process.platform === "win32") {
    spawn("taskkill", ["/pid", String(pid), "/T", "/F"], { stdio: "ignore", windowsHide: true });
    return;
  }
  try {
    process.kill(-pid, "SIGTERM");
  } catch {
    child.kill();
  }
  setTimeout(() => {
    try {
      process.kill(-pid, "SIGKILL");
    } catch {
      // process already exited
    }
  }, KILL_GRACE_MS).unref();
}

export async function runConnectorProcess(
  options: RunConnectorProcessOptions,
): Promise<ConnectorProcessResult> {
  return updateGate.run("connector", () => runWithUpdatePermit(options));
}
async function runWithUpdatePermit(options: RunConnectorProcessOptions): Promise<ConnectorProcessResult> {
  const executable = options.executable;
  const argv = [...options.argv];
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxOutputBytes = options.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES;
  const maxStderrBytes = options.maxStderrBytes ?? DEFAULT_MAX_STDERR_BYTES;
  const signal = options.signal;

  return await new Promise<ConnectorProcessResult>((resolve, reject) => {
    const child = spawn(executable, argv, {
      cwd: options.cwd,
      env: options.env ?? minimalEnvironment(),
      shell: false,
      windowsHide: true,
      detached: true,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let settled = false;
    let failure: ConnectorError | undefined;
    const stdoutPending = { current: "" };
    const stderrPending = { current: "" };
    const feedLines = (pending: { current: string }, text: string): void => {
      if (!options.onLine) return;
      let start = 0;
      while (true) {
        const index = text.indexOf("\n", start);
        if (index === -1) break;
        options.onLine(pending.current + text.slice(start, index));
        pending.current = "";
        start = index + 1;
      }
      pending.current += text.slice(start);
    };
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    let stdoutTotal = 0;
    let stderrTotal = 0;

    const cleanup = (): void => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
    };
    const settle = (error: ConnectorError | undefined, result?: ConnectorProcessResult): void => {
      if (settled) return;
      settled = true;
      cleanup();
      if (error) reject(error);
      else resolve(result!);
    };
    const terminate = (): void => terminateProcessTree(child);

    const timer = setTimeout(() => {
      failure = new ConnectorError("CONNECTOR_TIMEOUT", "Connector process timed out");
      terminate();
    }, timeoutMs);
    timer.unref();

    const onAbort = (): void => {
      failure = new ConnectorError("CONNECTOR_CANCELLED", "Connector process was cancelled");
      terminate();
    };
    if (signal) {
      if (signal.aborted) onAbort();
      else signal.addEventListener("abort", onAbort, { once: true });
    }

    child.on("error", (cause) => {
      settle(new ConnectorError("CLI_NOT_INSTALLED", "Failed to start connector process", { cause }));
    });

    child.stdout.on("data", (chunk: Buffer) => {
      stdoutTotal += chunk.length;
      if (stdoutTotal > maxOutputBytes) {
        failure = new ConnectorError("OUTPUT_TOO_LARGE", "Connector process output exceeded the limit");
        terminate();
        return;
      }
      stdoutChunks.push(chunk);
      feedLines(stdoutPending, chunk.toString("utf8"));
    });

    child.stderr.on("data", (chunk: Buffer) => {
      stderrTotal += chunk.length;
      if (stderrTotal > maxStderrBytes) {
        failure = new ConnectorError("OUTPUT_TOO_LARGE", "Connector process error output exceeded the limit");
        terminate();
        return;
      }
      stderrChunks.push(chunk);
      feedLines(stderrPending, chunk.toString("utf8"));
    });

    child.on("close", (code) => {
      if (failure) {
        settle(failure);
        return;
      }
      if (stdoutPending.current !== "" && options.onLine) options.onLine(stdoutPending.current);
      if (stderrPending.current !== "" && options.onLine) options.onLine(stderrPending.current);
      const stdout = Buffer.concat(stdoutChunks, stdoutTotal).toString("utf8");
      const stderr = Buffer.concat(stderrChunks, stderrTotal).toString("utf8");
      settle(undefined, {
        exitCode: code ?? -1,
        stdout,
        stderr,
        command: { executable, argv, shell: false },
      });
    });
  });
}
