import { dirname, win32 } from "node:path";
import { appendFileSync, readdirSync, statSync, mkdirSync, readFileSync } from "node:fs";


export interface StartupLogEnvironment {
  LOCALAPPDATA?: string;
  USERPROFILE?: string;
  TEMP?: string;
}

export interface StartupLogRecord {
  timestamp: string;
  level: "info" | "error";
  phase: string;
  message?: string;
  stack?: string;
}

export interface StartupLogger {
  readonly path: string;
  info(phase: string, message?: string): void;
  error(phase: string, error: unknown): void;
}

export function createStartupLogPath(env: StartupLogEnvironment): string {
  const root = env.LOCALAPPDATA ||
    (env.USERPROFILE
      ? win32.join(env.USERPROFILE, "AppData", "Local")
      : env.TEMP || "C:\\Windows\\Temp");
  return win32.join(root, "PiCoddy", "logs", "startup.log");
}

export function formatStartupLogLine(record: StartupLogRecord): string {
  return `${JSON.stringify(record)}\n`;
}

function errorDetails(error: unknown): { message: string; stack?: string } {
  if (error instanceof Error) {
    return { message: error.message, stack: error.stack };
  }
  return { message: String(error) };
}

export function createStartupLogger(options: {
  env: StartupLogEnvironment;
  path?: string;
  now?: () => Date;
}): StartupLogger {
  const path = options.path || createStartupLogPath(options.env);
  const now = options.now || (() => new Date());

  const append = (record: Omit<StartupLogRecord, "timestamp">): void => {
    try {
      mkdirSync(dirname(path), { recursive: true });
      appendFileSync(
        path,
        formatStartupLogLine({
          timestamp: now().toISOString(),
          ...record,
        }),
        "utf-8",
      );
    } catch {
      // 启动诊断绝不能反过来阻止应用启动。
    }
  };

  return {
    path,
    info(phase, message) {
      append({ level: "info", phase, ...(message ? { message } : {}) });
    },
    error(phase, error) {
      append({ level: "error", phase, ...errorDetails(error) });
    },
  };
}
