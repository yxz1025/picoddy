import { randomUUID as nodeRandomUUID } from "node:crypto";

import type { AgentTool, AgentToolResult } from "@earendil-works/pi-agent-core";
import { Type } from "typebox";

import { assertLease } from "../../cloud/runs/events.ts";
import type { Run } from "../../cloud/runs/types.ts";
import type { CloudSandbox } from "../../platform/sandbox.ts";

const WORKSPACE_ROOT = "/workspace";
const FILE_RUNNER = "/opt/picoddy/runtime/files.py";
const MAX_PATH_BYTES = 4 * 1024;
const MAX_REQUEST_BYTES = 2 * 1024 * 1024;
const MAX_RESPONSE_BYTES = 900 * 1024;
const MAX_WRITE_BYTES = 1024 * 1024;
const MAX_EDIT_COUNT = 100;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type FileOperation = "read" | "write" | "edit" | "grep" | "find" | "ls";

interface FileToolRequest {
  operation: FileOperation;
  path: string;
  [key: string]: unknown;
}

interface FileToolResponse {
  ok: boolean;
  result?: {
    kind: "text" | "image";
    text: string;
    details?: unknown;
    data?: string;
    mimeType?: string;
  };
  error?: { code?: string; message?: string };
}

export interface FileToolDependencies {
  assertLease(run: Run): Promise<void>;
  randomUUID(): string;
}

function byteLength(value: string): number {
  return Buffer.byteLength(value, "utf8");
}

/** Resolve with POSIX rules only; host Node/Windows path semantics are never consulted. */
export function resolveFileToolPath(input: string): string {
  if (
    typeof input !== "string" ||
    input.length === 0 ||
    byteLength(input) > MAX_PATH_BYTES ||
    input.includes("\\") ||
    /[\0-\x1f\x7f]/.test(input) ||
    /^[A-Za-z]:/.test(input)
  ) {
    throw new Error("Invalid workspace path");
  }

  let relative: string;
  if (input === WORKSPACE_ROOT) relative = "";
  else if (input.startsWith(`${WORKSPACE_ROOT}/`)) relative = input.slice(WORKSPACE_ROOT.length + 1);
  else if (input.startsWith("/")) throw new Error("Invalid workspace path: path must be within /workspace");
  else relative = input;

  const segments: string[] = [];
  for (const segment of relative.split("/")) {
    if (segment === "" || segment === ".") continue;
    if (segment === "..") throw new Error("Invalid workspace path: traversal is not allowed");
    segments.push(segment);
  }
  return segments.length === 0 ? WORKSPACE_ROOT : `${WORKSPACE_ROOT}/${segments.join("/")}`;
}

export function fileToolRequestPath(id: string): string {
  if (!UUID_PATTERN.test(id)) throw new Error("File tool request id must be a UUID");
  return `${WORKSPACE_ROOT}/.file-request-${id}.json`;
}

function integerInRange(value: unknown, name: string, minimum: number, maximum: number): number | undefined {
  if (value === undefined) return undefined;
  if (!Number.isSafeInteger(value) || (value as number) < minimum || (value as number) > maximum) {
    throw new Error(`${name} must be an integer between ${minimum} and ${maximum}`);
  }
  return value as number;
}

function boundedString(value: unknown, name: string, maximumBytes: number, allowEmpty = false): string {
  if (typeof value !== "string" || (!allowEmpty && value.length === 0) || byteLength(value) > maximumBytes) {
    throw new Error(`${name} must be ${allowEmpty ? "a" : "a non-empty"} string no larger than ${maximumBytes} bytes`);
  }
  return value;
}

function parseResponse(stdout: string): FileToolResponse {
  if (byteLength(stdout) > MAX_RESPONSE_BYTES) throw new Error("File tool response exceeded its byte limit");
  let decoded: unknown;
  try {
    decoded = JSON.parse(stdout);
  } catch {
    throw new Error("File tool runner returned invalid JSON");
  }
  if (!decoded || typeof decoded !== "object" || typeof (decoded as FileToolResponse).ok !== "boolean") {
    throw new Error("File tool runner returned an invalid response");
  }
  return decoded as FileToolResponse;
}

function responseError(response: FileToolResponse): Error {
  const code = response.error?.code || "FILE_TOOL_FAILED";
  const message = response.error?.message || "File operation failed";
  const error = new Error(`${code}: ${message}`);
  Object.assign(error, { code });
  return error;
}

function toAgentResult(response: FileToolResponse): AgentToolResult<any> {
  if (!response.ok) throw responseError(response);
  const result = response.result;
  if (!result || typeof result.text !== "string" || (result.kind !== "text" && result.kind !== "image")) {
    throw new Error("File tool runner returned an invalid result");
  }
  if (result.kind === "image") {
    if (typeof result.data !== "string" || typeof result.mimeType !== "string") {
      throw new Error("File tool runner returned invalid image data");
    }
    return {
      content: [
        { type: "text", text: result.text },
        { type: "image", data: result.data, mimeType: result.mimeType },
      ],
      details: result.details,
      structuredContent: { type: "image", data: result.data, mimeType: result.mimeType, note: result.text },
    };
  }
  return {
    content: [{ type: "text", text: result.text }],
    details: result.details,
    structuredContent: result.text,
  };
}

async function invokeFileRunner(
  run: Run,
  sandbox: CloudSandbox,
  request: FileToolRequest,
  signal: AbortSignal | undefined,
  dependencies: FileToolDependencies,
): Promise<AgentToolResult<any>> {
  signal?.throwIfAborted();
  await dependencies.assertLease(run);
  signal?.throwIfAborted();

  const requestPath = fileToolRequestPath(dependencies.randomUUID());
  const encoded = Buffer.from(JSON.stringify(request), "utf8");
  if (encoded.byteLength > MAX_REQUEST_BYTES) throw new Error("File tool request exceeded its byte limit");

  try {
    await sandbox.write(requestPath, encoded);
    signal?.throwIfAborted();
    const execution = await sandbox.exec(`python3 ${FILE_RUNNER} ${requestPath}`, signal);
    if (execution.exitCode !== 0) {
      throw new Error(`File tool runner exited with code ${execution.exitCode}: ${execution.stderr.slice(0, 2_000)}`);
    }
    return toAgentResult(parseResponse(execution.stdout));
  } finally {
    // The runner unlinks requests after opening them. This idempotent cleanup covers
    // upload failure, cancellation before exec, and runner startup failure.
    try {
      await sandbox.exec(`python3 ${FILE_RUNNER} --cleanup ${requestPath}`);
    } catch {
      // The sandbox lifecycle remains the final cleanup boundary.
    }
  }
}

const readSchema = Type.Object({
  path: Type.String({ description: "Path to the file to read (relative or absolute)" }),
  offset: Type.Optional(Type.Number({ description: "Line number to start reading from (1-indexed)" })),
  limit: Type.Optional(Type.Number({ description: "Maximum number of lines to read" })),
});

const writeSchema = Type.Object({
  path: Type.String({ description: "Path to the file to write (relative or absolute)" }),
  content: Type.String({ description: "Content to write to the file" }),
});

const editSchema = Type.Object({
  path: Type.String({ description: "Path to the file to edit (relative or absolute)" }),
  edits: Type.Array(Type.Object({
    oldText: Type.String({
      description: "Exact text for one targeted replacement. It must be unique in the original file and must not overlap with any other edits[].oldText in the same call.",
    }),
    newText: Type.String({ description: "Replacement text for this targeted edit." }),
  }), {
    description: "One or more targeted replacements. Each edit is matched against the original file, not incrementally. Do not include overlapping or nested edits.",
  }),
});

const grepSchema = Type.Object({
  pattern: Type.String({ description: "Search pattern (regex or literal string)" }),
  path: Type.Optional(Type.String({ description: "Directory or file to search (default: current directory)" })),
  glob: Type.Optional(Type.String({ description: "Filter files by glob pattern, e.g. '*.ts' or '**/*.spec.ts'" })),
  ignoreCase: Type.Optional(Type.Boolean({ description: "Case-insensitive search (default: false)" })),
  literal: Type.Optional(Type.Boolean({ description: "Treat pattern as literal string instead of regex (default: false)" })),
  context: Type.Optional(Type.Number({ description: "Number of lines to show before and after each match (default: 0)" })),
  limit: Type.Optional(Type.Number({ description: "Maximum number of matches to return (default: 100)" })),
});

const findSchema = Type.Object({
  pattern: Type.String({ description: "Glob pattern to match files, e.g. '*.ts', '**/*.json', or 'src/**/*.spec.ts'" }),
  path: Type.Optional(Type.String({ description: "Directory to search in (default: current directory)" })),
  limit: Type.Optional(Type.Number({ description: "Maximum number of results (default: 1000)" })),
});

const lsSchema = Type.Object({
  path: Type.Optional(Type.String({ description: "Directory to list (default: current directory)" })),
  limit: Type.Optional(Type.Number({ description: "Maximum number of entries to return (default: 500)" })),
});

export function createFileTools(
  run: Run,
  sandbox: CloudSandbox,
  overrides: Partial<FileToolDependencies> = {},
): AgentTool<any>[] {
  const dependencies: FileToolDependencies = {
    assertLease: overrides.assertLease ?? assertLease,
    randomUUID: overrides.randomUUID ?? nodeRandomUUID,
  };
  const invoke = (request: FileToolRequest, signal?: AbortSignal) =>
    invokeFileRunner(run, sandbox, request, signal, dependencies);

  return [
    {
      name: "read",
      label: "read",
      description: "Read the contents of a sandbox file. Supports UTF-8 text and common images. Text output is limited to 2000 lines or 50KB; use offset/limit to continue large files.",
      parameters: readSchema,
      async execute(_id, input, signal) {
        const args = input as { path: string; offset?: number; limit?: number };
        return invoke({
          operation: "read",
          path: resolveFileToolPath(args.path),
          offset: integerInRange(args.offset, "offset", 1, Number.MAX_SAFE_INTEGER),
          limit: integerInRange(args.limit, "limit", 1, 2_000),
        }, signal);
      },
    },
    {
      name: "write",
      label: "write",
      description: "Write content to a sandbox file. Creates the file and parent directories if needed, and overwrites an existing file.",
      parameters: writeSchema,
      executionMode: "sequential",
      async execute(_id, input, signal) {
        const args = input as { path: string; content: string };
        return invoke({
          operation: "write",
          path: resolveFileToolPath(args.path),
          content: boundedString(args.content, "content", MAX_WRITE_BYTES, true),
        }, signal);
      },
    },
    {
      name: "edit",
      label: "edit",
      description: "Edit one sandbox file using exact, unique, non-overlapping text replacements. All edits match the original file.",
      parameters: editSchema,
      executionMode: "sequential",
      async execute(_id, input, signal) {
        const args = input as { path: string; edits: Array<{ oldText: string; newText: string }> };
        if (!Array.isArray(args.edits) || args.edits.length === 0 || args.edits.length > MAX_EDIT_COUNT) {
          throw new Error(`edits must contain between 1 and ${MAX_EDIT_COUNT} replacements`);
        }
        let totalBytes = 0;
        const edits = args.edits.map((edit, index) => {
          const oldText = boundedString(edit?.oldText, `edits[${index}].oldText`, MAX_WRITE_BYTES);
          const newText = boundedString(edit?.newText, `edits[${index}].newText`, MAX_WRITE_BYTES, true);
          totalBytes += byteLength(oldText) + byteLength(newText);
          return { oldText, newText };
        });
        if (totalBytes > MAX_WRITE_BYTES) throw new Error("Combined edit text exceeded its byte limit");
        return invoke({ operation: "edit", path: resolveFileToolPath(args.path), edits }, signal);
      },
    },
    {
      name: "grep",
      label: "grep",
      description: "Search sandbox file contents for a regex or literal. Returns paths and line numbers, bounded to 100 matches or 50KB by default; regex execution is time-limited.",
      parameters: grepSchema,
      async execute(_id, input, signal) {
        const args = input as { pattern: string; path?: string; glob?: string; ignoreCase?: boolean; literal?: boolean; context?: number; limit?: number };
        return invoke({
          operation: "grep",
          path: resolveFileToolPath(args.path ?? "."),
          pattern: boundedString(args.pattern, "pattern", MAX_PATH_BYTES, true),
          glob: args.glob === undefined ? undefined : boundedString(args.glob, "glob", MAX_PATH_BYTES),
          ignoreCase: args.ignoreCase ?? false,
          literal: args.literal ?? false,
          context: integerInRange(args.context, "context", 0, 20),
          limit: integerInRange(args.limit, "limit", 1, 1_000),
        }, signal);
      },
    },
    {
      name: "find",
      label: "find",
      description: "Find sandbox files by glob pattern. Results are relative to the search directory and bounded to 1000 entries or 50KB by default.",
      parameters: findSchema,
      async execute(_id, input, signal) {
        const args = input as { pattern: string; path?: string; limit?: number };
        return invoke({
          operation: "find",
          path: resolveFileToolPath(args.path ?? "."),
          pattern: boundedString(args.pattern, "pattern", MAX_PATH_BYTES),
          limit: integerInRange(args.limit, "limit", 1, 2_000),
        }, signal);
      },
    },
    {
      name: "ls",
      label: "ls",
      description: "List a sandbox directory alphabetically, including dotfiles and '/' suffixes for directories. Output is bounded to 500 entries or 50KB by default.",
      parameters: lsSchema,
      async execute(_id, input, signal) {
        const args = input as { path?: string; limit?: number };
        return invoke({
          operation: "ls",
          path: resolveFileToolPath(args.path ?? "."),
          limit: integerInRange(args.limit, "limit", 1, 2_000),
        }, signal);
      },
    },
  ];
}
