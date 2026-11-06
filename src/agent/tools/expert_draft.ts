import { spawn } from "node:child_process";
import { lstat, mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

import { Type } from "typebox";
import type { AgentTool } from "@earendil-works/pi-agent-core";

import { getConversation } from "../../domains/session/node/store.ts";
import { sessionContext } from "../../infra/context.ts";
import { resolveBuiltinSkillsDir } from "../builtin_skills/installer.ts";
import { publishInstalledExpertEdit } from "../experts.ts";
import { InstalledExpertManagementError } from "../experts/installed_management.ts";
import { createDefaultManagedRuntimeService, type ManagedRuntimeService } from "../../platform/runtime/index.ts";

type JsonObject = Record<string, unknown>;

const MAX_LIST_ENTRIES = 4096;
const MAX_DRAFT_BYTES = 64 * 1024 * 1024;
const MAX_READ_BYTES = 2 * 1024 * 1024;
const MAX_WRITE_BYTES = 2 * 1024 * 1024;
const MAX_PROCESS_OUTPUT = 128 * 1024;

let managedRuntime: ManagedRuntimeService | undefined;

function runtimeService(): ManagedRuntimeService {
  return managedRuntime ??= createDefaultManagedRuntimeService();
}

const emptySchema = Type.Object({}, { additionalProperties: false });
const pathSchema = Type.Object({
  path: Type.String({
    description: "草稿包内的相对路径，不得使用绝对路径或 ..",
    minLength: 1,
    maxLength: 1024,
  }),
}, { additionalProperties: false });
const writeSchema = Type.Object({
  path: Type.String({
    description: "草稿包内的相对文件路径，不得使用绝对路径或 ..",
    minLength: 1,
    maxLength: 1024,
  }),
  content: Type.String({ description: "要写入的 UTF-8 文本内容" }),
}, { additionalProperties: false });

export interface ExpertDraftToolResult {
  content: Array<{ type: "text"; text: string }>;
  details: JsonObject;
}

class ExpertDraftToolError extends Error {
  constructor(
    readonly code: string,
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "ExpertDraftToolError";
  }
}

interface EditMetadata {
  conversationId: string;
  targetId: string;
  targetRevision: string;
  draftRoot: string;
}

function result(details: JsonObject): ExpertDraftToolResult {
  return {
    content: [{ type: "text", text: JSON.stringify(details) }],
    details,
  };
}

function failure(code: string, status: number, message: string): ExpertDraftToolResult {
  return result({ ok: false, error: { code, status, message } });
}

function redact(message: string): string {
  return message
    .replaceAll(/(?:\/[\w .@+-]+){2,}/g, "[私有路径]")
    .replaceAll(/[A-Za-z]:\\[^\s]+/g, "[私有路径]");
}

function safeError(error: unknown): ExpertDraftToolResult {
  if (error instanceof ExpertDraftToolError) {
    return failure(error.code, error.status, redact(error.message));
  }
  if (error instanceof InstalledExpertManagementError) {
    return failure(error.code, error.status, redact(error.message));
  }
  return failure("EXPERT_DRAFT_FAILED", 500, "专家草稿操作失败，请稍后重试");
}

function within(root: string, target: string): boolean {
  const offset = relative(resolve(root), resolve(target));
  return offset === "" || (!isAbsolute(offset) && offset !== ".." && !offset.startsWith(`..${sep}`));
}

async function metadataForSession(): Promise<EditMetadata> {
  const conversationId = sessionContext.getStore()?.sessionId;
  if (!conversationId) {
    throw new ExpertDraftToolError("SESSION_CONTEXT_MISSING", 400, "无法确定当前会话");
  }
  const conversation = getConversation(conversationId);
  if (
    !conversation ||
    conversation.category !== "expert_creator" ||
    conversation.expertOperation !== "edit" ||
    !conversation.expertTargetId ||
    !conversation.expertTargetRevision ||
    !conversation.expertDraftRoot
  ) {
    throw new ExpertDraftToolError("EXPERT_EDIT_CONTEXT_MISSING", 409, "当前会话不是有效的专家编辑会话");
  }
  const draftRoot = resolve(conversation.expertDraftRoot);
  const rootInfo = await lstat(draftRoot).catch(() => undefined);
  if (!rootInfo || !rootInfo.isDirectory() || rootInfo.isSymbolicLink()) {
    throw new ExpertDraftToolError("EXPERT_DRAFT_INVALID", 400, "专家草稿不可用");
  }
  return {
    conversationId,
    targetId: conversation.expertTargetId,
    targetRevision: conversation.expertTargetRevision,
    draftRoot,
  };
}

function relativeDraftPath(input: string): string {
  if (
    !input ||
    input.includes("\0") ||
    isAbsolute(input) ||
    /^[A-Za-z]:[\\/]/.test(input)
  ) {
    throw new ExpertDraftToolError("EXPERT_DRAFT_PATH_INVALID", 400, "草稿路径必须是相对路径");
  }
  const normalized = input.replaceAll("\\", "/");
  const parts = normalized.split("/");
  if (parts.some((part) => part === "..") || parts.some((part) => part === "" || part === ".")) {
    throw new ExpertDraftToolError("EXPERT_DRAFT_PATH_INVALID", 400, "草稿路径包含无效片段");
  }
  return parts.join("/");
}

async function assertPlainAncestors(root: string, target: string): Promise<void> {
  if (!within(root, target)) {
    throw new ExpertDraftToolError("EXPERT_DRAFT_PATH_ESCAPE", 400, "草稿路径超出受控目录");
  }
  let cursor = resolve(target);
  const rootPath = resolve(root);
  while (within(rootPath, cursor)) {
    const info = await lstat(cursor).catch(() => undefined);
    if (info?.isSymbolicLink()) {
      throw new ExpertDraftToolError("EXPERT_DRAFT_SYMLINK", 400, "草稿中不允许符号链接");
    }
    if (cursor === rootPath) break;
    cursor = dirname(cursor);
  }
}

async function resolveDraftPath(metadata: EditMetadata, input: string): Promise<string> {
  const path = relativeDraftPath(input);
  const target = resolve(metadata.draftRoot, path);
  await assertPlainAncestors(metadata.draftRoot, target);
  return target;
}

function isBinary(data: Uint8Array): boolean {
  return data.subarray(0, Math.min(data.byteLength, 8192)).includes(0);
}

async function listDraftFiles(root: string): Promise<Array<{ path: string; size: number; binary: boolean }>> {
  const files: Array<{ path: string; size: number; binary: boolean }> = [];
  let bytes = 0;
  const pending = [root];
  while (pending.length > 0) {
    const directory = pending.pop()!;
    const names = await readdir(directory);
    for (const name of names) {
      if (name === "." || name === ".." || name.includes("\0") || name.includes("/") || name.includes("\\")) {
        throw new ExpertDraftToolError("EXPERT_DRAFT_INVALID", 400, "草稿包含无效文件名");
      }
      const target = join(directory, name);
      const info = await lstat(target);
      if (info.isSymbolicLink() || (!info.isDirectory() && !info.isFile())) {
        throw new ExpertDraftToolError("EXPERT_DRAFT_INVALID", 400, "草稿包含不受支持的文件类型");
      }
      if (info.isDirectory()) {
        pending.push(target);
        continue;
      }
      files.push({
        path: relative(root, target).split(sep).join("/"),
        size: info.size,
        binary: isBinary((await readFile(target)).subarray(0, Math.min(info.size, 8192))),
      });
      bytes += info.size;
      if (files.length > MAX_LIST_ENTRIES || bytes > MAX_DRAFT_BYTES) {
        throw new ExpertDraftToolError("EXPERT_DRAFT_LIMIT", 413, "专家草稿超过大小或文件数量限制");
      }
    }
  }
  files.sort((a, b) => a.path.localeCompare(b.path));
  return files;
}

async function writeDraftFile(metadata: EditMetadata, inputPath: string, content: string): Promise<string> {
  const data = Buffer.from(content, "utf8");
  if (data.byteLength > MAX_WRITE_BYTES) {
    throw new ExpertDraftToolError("EXPERT_DRAFT_LIMIT", 413, "单个草稿文件超过 2 MiB 限制");
  }
  const target = await resolveDraftPath(metadata, inputPath);
  const parent = dirname(target);
  await mkdir(parent, { recursive: true });
  await assertPlainAncestors(metadata.draftRoot, target);
  const existing = await lstat(target).catch(() => undefined);
  if (existing?.isSymbolicLink() || (existing && !existing.isFile())) {
    throw new ExpertDraftToolError("EXPERT_DRAFT_INVALID", 400, "只能写入普通文件");
  }
  const temporary = join(parent, `.${target.split(sep).pop() ?? "draft"}.${process.pid}.${Date.now()}.tmp`);
  try {
    await writeFile(temporary, data, { flag: "wx" });
    await rename(temporary, target);
  } catch (error) {
    await rm(temporary, { force: true }).catch(() => undefined);
    throw new ExpertDraftToolError("EXPERT_DRAFT_IO_FAILED", 500, "写入专家草稿失败");
  }
  return relative(metadata.draftRoot, target).split(sep).join("/");
}

async function runProcess(
  args: string[],
  signal?: AbortSignal,
): Promise<{ code: number; output: string }> {
  const python = await runtimeService().resolvePython();
  return await new Promise((resolvePromise, reject) => {
    const child = spawn(python.executable, args, {
      cwd: dirname(args[0]),
      env: python.env,
      shell: false,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    let truncated = false;
    const append = (chunk: Buffer) => {
      if (output.length >= MAX_PROCESS_OUTPUT) return;
      output += chunk.toString("utf8");
      if (output.length > MAX_PROCESS_OUTPUT) {
        output = output.slice(0, MAX_PROCESS_OUTPUT);
        truncated = true;
      }
    };
    child.stdout?.on("data", append);
    child.stderr?.on("data", append);
    let settled = false;
    const finish = (value: { code: number; output: string }) => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener("abort", onAbort);
      resolvePromise({ ...value, output: truncated ? `${value.output}\n[输出已截断]` : value.output });
    };
    const onAbort = () => {
      child.kill();
      finish({ code: 130, output: "校验已取消" });
    };
    signal?.addEventListener("abort", onAbort, { once: true });
    child.on("error", (error) => {
      if (!settled) reject(error);
    });
    child.on("close", (code) => finish({ code: code ?? 1, output }));
  });
}

async function validateDraft(metadata: EditMetadata, signal?: AbortSignal): Promise<{ ok: boolean; summary: string }> {
  const builtinRoot = await resolveBuiltinSkillsDir();
  const script = join(builtinRoot, "expert-manager", "scripts", "validate_expert.py");
  const run = await runProcess([script, metadata.draftRoot, "--expected-plugins-dir", dirname(metadata.draftRoot)], signal);
  return { ok: run.code === 0, summary: redact(run.output.trim()).slice(0, MAX_PROCESS_OUTPUT) };
}

async function registerDraft(installedExpertRoot: string, signal?: AbortSignal): Promise<void> {
  const builtinRoot = await resolveBuiltinSkillsDir();
  const script = join(builtinRoot, "expert-manager", "scripts", "register_expert.py");
  const run = await runProcess([script, installedExpertRoot], signal);
  if (run.code !== 0) {
    throw new ExpertDraftToolError("EXPERT_DRAFT_REGISTER_FAILED", 422, redact(run.output).slice(0, 240) || "专家注册失败");
  }
}

export function getExpertDraftTools(): AgentTool[] {
  const listTool: AgentTool<typeof emptySchema, JsonObject> = {
    name: "expert_draft_list",
    label: "列出专家草稿",
    description: "列出当前专家编辑草稿中的文件及大小，不暴露本地绝对路径。",
    parameters: emptySchema,
    execute: async () => {
      try {
        const metadata = await metadataForSession();
        return result({ ok: true, files: await listDraftFiles(metadata.draftRoot) });
      } catch (error) { return safeError(error); }
    },
  };

  const readTool: AgentTool<typeof pathSchema, JsonObject> = {
    name: "expert_draft_read",
    label: "读取专家草稿",
    description: "读取当前专家编辑草稿中的普通文本文件。",
    parameters: pathSchema,
    execute: async (_id, params) => {
      try {
        const metadata = await metadataForSession();
        const target = await resolveDraftPath(metadata, params.path);
        const info = await lstat(target);
        if (!info.isFile() || info.isSymbolicLink()) throw new ExpertDraftToolError("EXPERT_DRAFT_INVALID", 400, "只能读取普通文件");
        if (info.size > MAX_READ_BYTES) throw new ExpertDraftToolError("EXPERT_DRAFT_LIMIT", 413, "文件超过读取大小限制");
        const data = await readFile(target);
        if (isBinary(data)) return result({ ok: true, path: params.path, size: data.byteLength, binary: true });
        return result({ ok: true, path: params.path, size: data.byteLength, binary: false, text: data.toString("utf8") });
      } catch (error) { return safeError(error); }
    },
  };

  const writeTool: AgentTool<typeof writeSchema, JsonObject> = {
    name: "expert_draft_write",
    label: "写入专家草稿",
    description: "通过临时文件原子写入当前专家编辑草稿中的 UTF-8 文本文件。",
    parameters: writeSchema,
    execute: async (_id, params) => {
      try {
        const metadata = await metadataForSession();
        return result({ ok: true, path: await writeDraftFile(metadata, params.path, params.content) });
      } catch (error) { return safeError(error); }
    },
  };

  const deleteTool: AgentTool<typeof pathSchema, JsonObject> = {
    name: "expert_draft_delete",
    label: "删除专家草稿文件",
    description: "删除当前专家编辑草稿中的普通文件或空目录。",
    parameters: pathSchema,
    execute: async (_id, params) => {
      try {
        const metadata = await metadataForSession();
        const target = await resolveDraftPath(metadata, params.path);
        const info = await lstat(target);
        if (info.isSymbolicLink() || (!info.isFile() && !info.isDirectory())) throw new ExpertDraftToolError("EXPERT_DRAFT_INVALID", 400, "只能删除普通文件或目录");
        if (info.isDirectory() && (await readdir(target)).length > 0) throw new ExpertDraftToolError("EXPERT_DRAFT_NOT_EMPTY", 409, "只能删除空目录");
        await rm(target, { recursive: false });
        return result({ ok: true, path: params.path });
      } catch (error) { return safeError(error); }
    },
  };

  const validateTool: AgentTool<typeof emptySchema, JsonObject> = {
    name: "expert_draft_validate",
    label: "校验专家草稿",
    description: "调用受保护的 authoritative expert-manager validator 校验完整草稿。",
    parameters: emptySchema,
    execute: async (_id, _params, signal) => {
      try {
        const metadata = await metadataForSession();
        const validation = await validateDraft(metadata, signal);
        return result({ ok: validation.ok, summary: validation.summary });
      } catch (error) { return safeError(error); }
    },
  };

  const publishTool: AgentTool<typeof emptySchema, JsonObject> = {
    name: "expert_draft_publish",
    label: "发布专家草稿",
    description: "在目标版本一致、草稿校验通过并完成用户确认后，原子发布专家编辑草稿。",
    parameters: emptySchema,
    execute: async (_id, _params, signal) => {
      try {
        const metadata = await metadataForSession();
        const published = await publishInstalledExpertEdit(metadata.targetId, {
          conversationId: metadata.conversationId,
          draftRoot: metadata.draftRoot,
          targetRevision: metadata.targetRevision,
          validate: async () => {
            const validation = await validateDraft(metadata, signal);
            if (!validation.ok) throw new ExpertDraftToolError("EXPERT_DRAFT_INVALID", 422, validation.summary || "专家草稿校验失败");
          },
          register: async (installedExpertRoot) => await registerDraft(installedExpertRoot, signal),
        });
        return result({ ok: true, expertId: published.expertId, revision: published.revision });
      } catch (error) { return safeError(error); }
    },
  };

  return [listTool, readTool, writeTool, deleteTool, validateTool, publishTool];
}
