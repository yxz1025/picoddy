import {
  appendFileSync,
  existsSync,
  mkdirSync,
  renameSync,
  statSync,
  unlinkSync,
} from "node:fs";
import { basename, dirname, join } from "node:path";
import { randomUUID } from "node:crypto";

export type OperationLogPhase = "begin" | "success" | "error" | "event";

export interface OperationLogEvent {
  timestamp: string;
  phase: OperationLogPhase;
  operation: string;
  operationId: string;
  pid: number;
  platform: NodeJS.Platform;
  arch: string;
  durationMs?: number;
  metadata?: Record<string, unknown>;
  error?: string;
  stack?: string;
}

export interface OperationHandle {
  success(metadata?: Record<string, unknown>): void;
  error(error: unknown, metadata?: Record<string, unknown>): void;
}

export interface OperationLogger {
  start(operation: string, metadata?: Record<string, unknown>): OperationHandle;
  event(
    operation: string,
    phase: OperationLogPhase,
    metadata?: Record<string, unknown>,
  ): void;
}

export interface OperationLoggerOptions {
  logPath?: string;
  maxBytes?: number;
  maxFiles?: number;
}

const SENSITIVE_FIELD = /(?:api[-_]?key|key|token|password|secret|authorization|cookie|credential|body|stdin|args|headers)/iu;
const SENSITIVE_ASSIGNMENT = /((?:api[-_]?key|token|password|secret|authorization|cookie)\s*[=:]\s*)[^\s,;]+/giu;
const BEARER_VALUE = /\bBearer\s+[^\s,;]+/giu;
const OPENAI_KEY = /\bsk-[A-Za-z0-9_-]+/gu;

function redactString(value: string): string {
  return value
    .replace(BEARER_VALUE, "Bearer [REDACTED]")
    .replace(OPENAI_KEY, "[REDACTED]")
    .replace(SENSITIVE_ASSIGNMENT, "$1[REDACTED]");
}

function commandName(value: string): string {
  return basename(value.replaceAll("\\", "/"));
}

function sanitizeValue(value: unknown, fieldName = ""): unknown {
  if (SENSITIVE_FIELD.test(fieldName)) return undefined;
  if (typeof value === "string") {
    return fieldName.toLowerCase() === "command"
      ? commandName(value)
      : redactString(value);
  }
  if (typeof value === "number" || typeof value === "boolean" || value === null) {
    return value;
  }
  if (value instanceof Error) return redactString(value.message);
  if (Array.isArray(value)) {
    return value
      .map((item) => sanitizeValue(item))
      .filter((item) => item !== undefined);
  }
  if (typeof value === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      const sanitized = sanitizeValue(item, key);
      if (sanitized !== undefined) result[key] = sanitized;
    }
    return result;
  }
  return undefined;
}

function sanitizeMetadata(
  metadata: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  if (!metadata) return undefined;
  const value = sanitizeValue(metadata);
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function sanitizeError(error: unknown): { message: string; stack?: string } {
  if (error instanceof Error) {
    return {
      message: redactString(error.message),
      stack: error.stack ? redactString(error.stack) : undefined,
    };
  }
  return { message: redactString(String(error)) };
}

function defaultLogPath(): string {
  return process.platform === "win32"
    ? join(process.env.LOCALAPPDATA ?? ".", "Pi-a", "logs", "operations.jsonl")
    : join(process.env.HOME ?? ".", ".pi-a", "logs", "operations.jsonl");
}

export function createOperationLogger(
  options: OperationLoggerOptions = {},
): OperationLogger {
  const logPath = options.logPath ?? defaultLogPath();
  const maxBytes = Math.max(1, options.maxBytes ?? 10 * 1024 * 1024);
  const maxFiles = Math.max(1, Math.floor(options.maxFiles ?? 3));
  let warned = false;

  function rotateIfNeeded(): void {
    if (!existsSync(logPath) || statSync(logPath).size < maxBytes) return;
    for (let index = maxFiles; index >= 1; index--) {
      const source = index === 1 ? logPath : `${logPath}.${index - 1}`;
      const target = `${logPath}.${index}`;
      if (!existsSync(source)) continue;
      if (existsSync(target)) unlinkSync(target);
      renameSync(source, target);
    }
  }

  function write(event: OperationLogEvent): void {
    try {
      mkdirSync(dirname(logPath), { recursive: true });
      rotateIfNeeded();
      appendFileSync(logPath, `${JSON.stringify(event)}\n`, "utf8");
    } catch (error) {
      if (!warned) {
        warned = true;
        console.warn(
          "[operation-log] unable to write operation log:",
          error instanceof Error ? error.message : String(error),
        );
      }
    }
  }

  function event(
    operation: string,
    phase: OperationLogPhase,
    metadata?: Record<string, unknown>,
    extra: Partial<OperationLogEvent> = {},
  ): void {
    write({
      timestamp: new Date().toISOString(),
      phase,
      operation,
      operationId: extra.operationId ?? randomUUID(),
      pid: process.pid,
      platform: process.platform,
      arch: process.arch,
      ...(extra.durationMs === undefined ? {} : { durationMs: extra.durationMs }),
      ...(sanitizeMetadata(metadata)
        ? { metadata: sanitizeMetadata(metadata) }
        : {}),
      ...(extra.error === undefined ? {} : { error: redactString(extra.error) }),
      ...(extra.stack === undefined ? {} : { stack: redactString(extra.stack) }),
    });
  }

  return {
    start(operation, metadata) {
      const operationId = randomUUID();
      const startedAt = Date.now();
      event(operation, "begin", metadata, { operationId });
      return {
        success(result) {
          event(operation, "success", result, {
            operationId,
            durationMs: Date.now() - startedAt,
          });
        },
        error(error, result) {
          const sanitized = sanitizeError(error);
          event(operation, "error", result, {
            operationId,
            durationMs: Date.now() - startedAt,
            error: sanitized.message,
            stack: sanitized.stack,
          });
        },
      };
    },
    event,
  };
}

export const operationLogger = createOperationLogger();

export function startOperation(
  operation: string,
  metadata?: Record<string, unknown>,
): OperationHandle {
  return operationLogger.start(operation, metadata);
}

export function logOperationEvent(
  operation: string,
  phase: OperationLogPhase,
  metadata?: Record<string, unknown>,
): void {
  operationLogger.event(operation, phase, metadata);
}
