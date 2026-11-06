import { randomUUID } from "node:crypto";
import { AsyncLocalStorage } from "node:async_hooks";

import {
  ConnectionConfig,
  Sandbox,
  SandboxApiException,
  SandboxManager,
  type SandboxInfo,
} from "@alibaba-group/opensandbox";

import type { Config } from "../config.ts";

const WORKSPACE_ROOT = "/workspace";
const MCP_RUNNER = "/opt/picoddy/mcp-runner.mjs";
const MAX_STDOUT_BYTES = 1024 * 1024;
const MAX_STDERR_BYTES = 1024 * 1024;
const MAX_MCP_REQUEST_BYTES = 1024 * 1024;
const WORKLOAD_UID = 10001;
const WORKLOAD_GID = 10001;
const RECONCILE_PAGE_SIZE = 100;
const MAX_RECONCILE_PAGES = 10_000;
const OUTPUT_TRUNCATED = Buffer.from("\n[output truncated]\n", "utf8");
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const sandboxCreateTimeout = new AsyncLocalStorage<number>();

export type SandboxOutputStream = "stdout" | "stderr";
export type SandboxOutputHandler = (
  stream: SandboxOutputStream,
  chunk: string,
) => void | Promise<void>;

export interface SandboxExecResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export interface CloudSandbox {
  id: string;
  exec(
    command: string,
    signal?: AbortSignal,
    onOutput?: SandboxOutputHandler,
  ): Promise<SandboxExecResult>;
  write(path: string, data: Uint8Array): Promise<void>;
  read(path: string, maxBytes?: number, signal?: AbortSignal): Promise<Uint8Array>;
  destroy(): Promise<void>;
}

export type McpConnector =
  | {
      transport: "stdio";
      command: string;
      args?: string[];
      env?: Record<string, string>;
    }
  | {
      transport: "http";
      url: string;
      headers?: Record<string, string>;
    }
  | {
      transport: "sse";
      url: string;
      headers?: Record<string, string>;
    };

export type McpRunnerRequest = {
  connector: McpConnector;
  operation: "list" | "call";
  name?: string;
  arguments?: Record<string, unknown>;
};

class BoundedOutput {
  private readonly chunks: Buffer[] = [];
  private size = 0;
  private truncated = false;

  constructor(private readonly limit: number) {}

  append(text: string): string {
    if (!text) return "";
    const encoded = Buffer.from(text, "utf8");
    const remaining = this.limit - this.size;
    if (remaining <= 0) {
      this.truncated = true;
      return "";
    }
    const accepted = encoded.length > remaining ? encoded.subarray(0, remaining) : encoded;
    if (accepted.length > 0) {
      const stable = Buffer.from(accepted);
      this.chunks.push(stable);
      this.size += stable.length;
    }
    if (accepted.length !== encoded.length) this.truncated = true;
    return accepted.toString("utf8");
  }

  toString(): string {
    const content = Buffer.concat(this.chunks, this.size);
    if (!this.truncated) return content.toString("utf8");
    if (this.limit <= OUTPUT_TRUNCATED.length) {
      return OUTPUT_TRUNCATED.subarray(0, this.limit).toString("utf8");
    }
    return Buffer.concat([
      content.subarray(0, this.limit - OUTPUT_TRUNCATED.length),
      OUTPUT_TRUNCATED,
    ]).toString("utf8");
  }
}

export function sandboxPath(path: string): string {
  if (
    typeof path !== "string" ||
    (path !== WORKSPACE_ROOT && !path.startsWith(`${WORKSPACE_ROOT}/`)) ||
    path.includes("\\") ||
    path.includes("\0") ||
    path.includes("//")
  ) {
    throw new Error("Invalid workspace path");
  }
  if (path === WORKSPACE_ROOT) return path;
  const segments = path.slice(WORKSPACE_ROOT.length + 1).split("/");
  if (segments.some((segment) => segment === "." || segment === ".." || !segment)) {
    throw new Error("Invalid workspace path");
  }
  return path;
}

function connectionOptions(config: Config) {
  return {
    domain: config.sandboxDomain,
    apiKey: config.sandboxApiKey || undefined,
    requestTimeoutSeconds: Math.min(config.sandboxTimeoutSeconds, 60),
    useServerProxy: true,
  } as const;
}

export function mcpRequestPath(id: string): string {
  if (!UUID_PATTERN.test(id)) throw new Error("MCP request id must be a UUID");
  return sandboxPath(`${WORKSPACE_ROOT}/.mcp-request-${id}.json`);
}

function abortReason(signal: AbortSignal): unknown {
  return signal.reason ?? new DOMException("The operation was aborted", "AbortError");
}

/** Limit only Sandbox.create calls made by an async child operation. Once the
 * SDK returns a ready sandbox, the deadline is cleared and does not constrain
 * command execution or cleanup for that child. */
export function withSandboxCreateTimeout<T>(
  timeoutMs: number,
  operation: () => Promise<T>,
): Promise<T> {
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) {
    throw new RangeError("Sandbox creation timeout must be a positive safe integer");
  }
  const inherited = sandboxCreateTimeout.getStore();
  return sandboxCreateTimeout.run(
    inherited === undefined ? timeoutMs : Math.min(inherited, timeoutMs),
    operation,
  );
}

function boundedCreateSignal(signal: AbortSignal | undefined): {
  signal: AbortSignal | undefined;
  clear(): void;
} {
  const timeoutMs = sandboxCreateTimeout.getStore();
  if (timeoutMs === undefined) return { signal, clear() {} };

  const controller = new AbortController();
  const onAbort = () => controller.abort(signal ? abortReason(signal) : undefined);
  signal?.addEventListener("abort", onAbort, { once: true });
  if (signal?.aborted) onAbort();
  const timer = setTimeout(() => {
    controller.abort(new Error(`Sandbox creation exceeded ${timeoutMs}ms`));
  }, timeoutMs);

  return {
    signal: controller.signal,
    clear() {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
    },
  };
}

function validatedReadLimit(maxBytes: number): number {
  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0 || maxBytes >= Number.MAX_SAFE_INTEGER) {
    throw new RangeError("Sandbox read limit must be a positive safe integer");
  }
  return maxBytes;
}

async function nextStreamChunk(
  iterator: AsyncIterator<Uint8Array>,
  signal?: AbortSignal,
): Promise<IteratorResult<Uint8Array>> {
  if (!signal) return iterator.next();
  signal.throwIfAborted();
  let onAbort: (() => void) | undefined;
  const aborted = new Promise<never>((_resolve, reject) => {
    onAbort = () => reject(abortReason(signal));
    signal.addEventListener("abort", onAbort, { once: true });
    if (signal.aborted) onAbort();
  });
  try {
    return await Promise.race([iterator.next(), aborted]);
  } finally {
    if (onAbort) signal.removeEventListener("abort", onAbort);
  }
}

async function readBoundedBytes(
  stream: AsyncIterable<Uint8Array>,
  maxBytes: number,
  signal?: AbortSignal,
): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  const iterator = stream[Symbol.asyncIterator]();
  let total = 0;
  let completed = false;
  try {
    while (true) {
      const item = await nextStreamChunk(iterator, signal);
      signal?.throwIfAborted();
      if (item.done) {
        completed = true;
        break;
      }
      const chunk = item.value;
      if (!(chunk instanceof Uint8Array)) {
        throw new TypeError("Sandbox file stream returned non-binary data");
      }
      if (chunk.byteLength > maxBytes - total) {
        throw new Error(`Sandbox file exceeds the ${maxBytes}-byte read limit`);
      }
      if (chunk.byteLength > 0) {
        chunks.push(chunk.slice());
        total += chunk.byteLength;
      }
    }
  } finally {
    if (!completed && iterator.return) {
      // OpenSandbox's iterator return path cancels the response body. Do not
      // await it after an abort because an in-flight reader may settle later.
      void Promise.resolve(iterator.return()).catch(() => undefined);
    }
  }

  const output = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return output;
}

function formatExecutionError(error: {
  name: string;
  value: string;
  traceback: string[];
}): string {
  const trace = error.traceback.length > 0 ? `\n${error.traceback.join("\n")}` : "";
  return `${error.name}: ${error.value}${trace}`;
}

export async function createSandbox(
  config: Config,
  runId: string,
  signal?: AbortSignal,
): Promise<CloudSandbox> {
  if (!config.sandboxDomain) throw new Error("sandboxDomain is required");
  if (!config.sandboxImage) throw new Error("sandboxImage is required");
  if (!Number.isInteger(config.sandboxTimeoutSeconds) || config.sandboxTimeoutSeconds <= 0) {
    throw new Error("sandboxTimeoutSeconds must be a positive integer");
  }
  signal?.throwIfAborted();

  const connectionConfig = new ConnectionConfig(connectionOptions(config));
  const create = boundedCreateSignal(signal);
  let sdk: Sandbox;
  try {
    sdk = await Sandbox.create({
      connectionConfig,
      image: config.sandboxImage,
      timeoutSeconds: config.sandboxTimeoutSeconds,
      readyTimeoutSeconds: Math.min(config.sandboxTimeoutSeconds, 120),
      // CPU and memory are explicit because Chromium/LibreOffice exceed the SDK
      // defaults. This contract does not yet expose hard disk or PID limits.
      resource: { cpu: "2", memory: "2Gi" },
      metadata: { runId },
      signal: create.signal,
    });
  } finally {
    create.clear();
  }
  let files: ReturnType<typeof sdk.filesWithIdentity>;
  try {
    files = sdk.filesWithIdentity(WORKLOAD_UID, WORKLOAD_GID);
  } catch (error) {
    try {
      await sdk.kill();
    } finally {
      await sdk.close();
    }
    throw error;
  }
  let destroyPromise: Promise<void> | undefined;

  return {
    id: sdk.id,

    async exec(command, signal, onOutput) {
      if (typeof command !== "string" || !command.trim()) {
        throw new Error("Sandbox command must be a non-empty string");
      }
      signal?.throwIfAborted();
      const stdout = new BoundedOutput(MAX_STDOUT_BYTES);
      const stderr = new BoundedOutput(MAX_STDERR_BYTES);
      let executionId: string | undefined;
      let interruptPromise: Promise<void> | undefined;
      const interrupt = () => {
        if (!executionId || interruptPromise) return;
        interruptPromise = sdk.commands.interrupt(executionId).catch(() => undefined);
      };
      const onAbort = () => interrupt();
      signal?.addEventListener("abort", onAbort, { once: true });

      try {
        const execution = await sdk.commands.run(
          command,
          {
            workingDirectory: WORKSPACE_ROOT,
            uid: WORKLOAD_UID,
            gid: WORKLOAD_GID,
          },
          {
            skipAccumulation: true,
            async onInit(init) {
              executionId = init.id;
              if (signal?.aborted) interrupt();
            },
            async onStdout(message) {
              const accepted = stdout.append(message.text);
              if (accepted) await onOutput?.("stdout", accepted);
            },
            async onStderr(message) {
              const accepted = stderr.append(message.text);
              if (accepted) await onOutput?.("stderr", accepted);
            },
            async onError(error) {
              const accepted = stderr.append(formatExecutionError(error));
              if (accepted) await onOutput?.("stderr", accepted);
            },
          },
          signal,
        );
        if (signal?.aborted) throw abortReason(signal);
        const exitCode = execution.exitCode;
        if (typeof exitCode !== "number" || !Number.isInteger(exitCode)) {
          const detail = execution.error ? `: ${formatExecutionError(execution.error)}` : "";
          throw new Error(`Sandbox command completed without an exit code${detail}`);
        }
        return {
          stdout: stdout.toString(),
          stderr: stderr.toString(),
          exitCode,
        };
      } finally {
        signal?.removeEventListener("abort", onAbort);
        if (signal?.aborted) interrupt();
        await interruptPromise;
      }
    },

    async write(path, data) {
      if (!(data instanceof Uint8Array)) throw new TypeError("Sandbox file data must be Uint8Array");
      const target = sandboxPath(path);
      const parent = target.slice(0, target.lastIndexOf("/")) || WORKSPACE_ROOT;
      if (parent !== WORKSPACE_ROOT) {
        // Execd accepts octal digits as a JSON number, not a JS octal literal:
        // 0o600 serializes to 384 and fails its base-8 parser.
        await files.createDirectories([{ path: parent, mode: 700 }]);
      }
      await files.writeFiles([{ path: target, data, mode: 600 }]);
    },

    async read(path, maxBytes = config.maxUploadBytes, signal) {
      const limit = validatedReadLimit(maxBytes);
      signal?.throwIfAborted();
      const target = sandboxPath(path);
      // Execd's offset/limit download mode processes text and can strip trailing
      // newlines. Use raw download for exact bytes; enforce bounds while streaming.
      const stream = files.readBytesStream(target);
      return readBoundedBytes(stream, limit, signal);
    },

    async destroy() {
      if (!destroyPromise) {
        destroyPromise = (async () => {
          let killError: unknown;
          try {
            await sdk.kill();
          } catch (error) {
            killError = error;
          }
          try {
            await sdk.close();
          } catch (closeError) {
            if (killError) throw new AggregateError([killError, closeError], "Sandbox kill and close failed");
            throw closeError;
          }
          if (killError) throw killError;
        })();
      }
      await destroyPromise;
    },
  };
}

export async function destroySandbox(config: Config, sandboxId: string): Promise<void> {
  if (!config.sandboxDomain) throw new Error("sandboxDomain is required");
  if (!Number.isInteger(config.sandboxTimeoutSeconds) || config.sandboxTimeoutSeconds <= 0) {
    throw new Error("sandboxTimeoutSeconds must be a positive integer");
  }
  if (typeof sandboxId !== "string" || !sandboxId.trim()) {
    throw new Error("sandboxId is required");
  }

  const manager = SandboxManager.create({ connectionConfig: connectionOptions(config) });
  let killError: unknown;
  try {
    await manager.killSandbox(sandboxId);
  } catch (error) {
    if (!(error instanceof SandboxApiException && error.statusCode === 404)) {
      killError = error;
    }
  }
  try {
    await manager.close();
  } catch (closeError) {
    if (killError) {
      throw new AggregateError([killError, closeError], "Sandbox cleanup and SDK close failed");
    }
    throw closeError;
  }
  if (killError) throw killError;
}

async function listRunSandboxInfos(
  manager: SandboxManager,
  runId: string,
): Promise<SandboxInfo[]> {
  const found: SandboxInfo[] = [];
  const ids = new Set<string>();
  let expectedTotalItems: number | undefined;
  let expectedTotalPages: number | undefined;
  for (let page = 1; page <= MAX_RECONCILE_PAGES; page += 1) {
    const response = await manager.listSandboxInfos({
      metadata: { runId },
      page,
      pageSize: RECONCILE_PAGE_SIZE,
    });
    if (!Array.isArray(response.items)) {
      throw new Error("Sandbox reconciliation received an invalid item list");
    }
    const pagination = response.pagination;
    if (
      !pagination ||
      !Number.isInteger(pagination.page) ||
      pagination.page !== page ||
      !Number.isInteger(pagination.pageSize) ||
      pagination.pageSize <= 0 ||
      !Number.isInteger(pagination.totalItems) ||
      pagination.totalItems < 0 ||
      !Number.isInteger(pagination.totalPages) ||
      pagination.totalPages < 0 ||
      typeof pagination.hasNextPage !== "boolean"
    ) {
      throw new Error("Sandbox reconciliation cannot confirm list pagination");
    }
    if (response.items.length > pagination.pageSize) {
      throw new Error("Sandbox reconciliation received an oversized page");
    }
    expectedTotalItems ??= pagination.totalItems;
    expectedTotalPages ??= pagination.totalPages;
    if (
      pagination.totalItems !== expectedTotalItems ||
      pagination.totalPages !== expectedTotalPages
    ) {
      throw new Error("Sandbox reconciliation listing changed during pagination");
    }

    for (const info of response.items) {
      if (info.metadata?.runId !== runId) {
        throw new Error("Sandbox reconciliation received an unverified metadata match");
      }
      if (typeof info.id !== "string" || !info.id) {
        throw new Error("Sandbox reconciliation received an invalid sandbox id");
      }
      if (ids.has(info.id)) {
        throw new Error(`Sandbox reconciliation received duplicate sandbox ${info.id}`);
      }
      ids.add(info.id);
      found.push(info);
    }

    if (!pagination.hasNextPage) {
      if (pagination.totalPages > page) {
        throw new Error("Sandbox reconciliation received inconsistent pagination");
      }
      if (found.length !== pagination.totalItems) {
        throw new Error("Sandbox reconciliation did not receive every listed sandbox");
      }
      return found;
    }
    if (pagination.totalPages <= page) {
      throw new Error("Sandbox reconciliation received inconsistent pagination");
    }
  }
  throw new Error(`Sandbox reconciliation exceeds ${MAX_RECONCILE_PAGES} pages`);
}

/**
 * Discover and remove every sandbox tagged for a run, including sandboxes whose
 * create response was lost. Resolution means a second complete listing proves
 * that every retained record is in the Deleted state.
 */
export async function reconcileRunSandboxes(config: Config, runId: string): Promise<void> {
  if (!config.sandboxDomain) throw new Error("sandboxDomain is required");
  if (!Number.isInteger(config.sandboxTimeoutSeconds) || config.sandboxTimeoutSeconds <= 0) {
    throw new Error("sandboxTimeoutSeconds must be a positive integer");
  }
  if (typeof runId !== "string" || !runId.trim()) throw new Error("runId is required");

  const manager = SandboxManager.create({ connectionConfig: connectionOptions(config) });
  let operationError: unknown;
  let operationFailed = false;
  try {
    const initial = await listRunSandboxInfos(manager, runId);
    const killErrors: unknown[] = [];
    for (const info of initial) {
      if (info.status?.state === "Deleted") continue;
      try {
        await manager.killSandbox(info.id);
      } catch (error) {
        if (!(error instanceof SandboxApiException && error.statusCode === 404)) {
          killErrors.push(error);
        }
      }
    }
    if (killErrors.length === 1) throw killErrors[0];
    if (killErrors.length > 1) {
      throw new AggregateError(killErrors, "Multiple run sandboxes could not be killed");
    }

    const confirmed = await listRunSandboxInfos(manager, runId);
    const active = confirmed.filter((info) => info.status?.state !== "Deleted");
    if (active.length > 0) {
      throw new Error(
        `Run sandbox reconciliation still active: ${active.map((info) => info.id).join(", ")}`,
      );
    }
  } catch (error) {
    operationFailed = true;
    operationError = error;
  }

  try {
    await manager.close();
  } catch (closeError) {
    if (operationFailed) {
      throw new AggregateError([operationError, closeError], "Sandbox reconciliation and SDK close failed");
    }
    throw closeError;
  }
  if (operationFailed) throw operationError;
}

export async function runSandboxMcp(
  sandbox: CloudSandbox,
  request: McpRunnerRequest,
  signal?: AbortSignal,
  uuid: () => string = randomUUID,
): Promise<unknown> {
  const serialized = Buffer.from(JSON.stringify(request), "utf8");
  if (serialized.length > MAX_MCP_REQUEST_BYTES) {
    throw new Error(`MCP request exceeds the ${MAX_MCP_REQUEST_BYTES}-byte limit`);
  }
  const requestPath = mcpRequestPath(uuid());
  await sandbox.write(requestPath, serialized);
  let result: SandboxExecResult;
  try {
    result = await sandbox.exec(`node ${MCP_RUNNER} ${requestPath}`, signal);
  } catch (error) {
    // If execution failed before the runner could unlink its request, erase the
    // connector secret payload. The run-level destroy remains the final cleanup.
    await sandbox.write(requestPath, new Uint8Array()).catch(() => undefined);
    if (signal?.aborted) throw signal.reason;
    throw new Error('Sandbox MCP execution interrupted');
  }
  if (result.exitCode !== 0) {
    // Provider stderr can contain environment credentials. Never put it into model errors.
    throw new Error(`Sandbox MCP runner failed (exit code ${result.exitCode})`);
  }
  try {
    return JSON.parse(result.stdout) as unknown;
  } catch {
    throw new Error("Sandbox MCP runner did not return valid JSON");
  }
}
