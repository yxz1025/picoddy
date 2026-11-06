import { Type } from "typebox";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import { basename } from "node:path";
import { sessionContext } from "../../infra/context.ts";
import {
  SkillDraftError,
  type SkillDraftMetadata,
  type SkillDraftResourceDirectory,
  type SkillDraftStore,
  skillDraftStore,
} from "../../domains/skill-draft/node/store.ts";

type JsonObject = Record<string, unknown>;

interface ResolvedAttachment {
  name: string;
  filePath: string;
}

export interface SkillDraftToolResult {
  content: Array<{ type: "text"; text: string }>;
  details: JsonObject;
}

export interface SkillDraftToolDependencies {
  store?: SkillDraftStore;
  resolveAttachment?: (
    conversationId: string,
    attachmentId: string,
  ) =>
    | ResolvedAttachment
    | undefined
    | Promise<ResolvedAttachment | undefined>;
}

class ToolInputError extends Error {
  constructor(
    readonly code: string,
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

const resourceSchema = Type.Union([
  Type.Literal("scripts"),
  Type.Literal("references"),
  Type.Literal("assets"),
]);

const initSchema = Type.Object({
  name: Type.String({
    description: "技能名称，小写字母、数字和单个连字符，最长 64 个字符",
    pattern: "^[a-z0-9]+(?:-[a-z0-9]+)*$",
    maxLength: 64,
  }),
  description: Type.String({
    description: "技能能力和触发场景的单行描述",
    minLength: 1,
    maxLength: 1024,
  }),
  resources: Type.Optional(Type.Array(resourceSchema, {
    description: "按需使用的资源目录；请求的目录会在初始化时立即创建",
    uniqueItems: true,
  })),
}, { additionalProperties: false });

const listSchema = Type.Object({}, { additionalProperties: false });

const readSchema = Type.Object({
  path: Type.String({
    description: "草稿包内的相对文件路径",
    minLength: 1,
  }),
}, { additionalProperties: false });

const writeSchema = Type.Object({
  path: Type.String({
    description: "草稿包内的相对文件路径",
    minLength: 1,
  }),
  content: Type.String({ description: "要写入的 UTF-8 文本内容" }),
}, { additionalProperties: false });

const importAttachmentSchema = Type.Object({
  attachmentId: Type.String({
    description: "当前会话中已上传附件的 ID",
    minLength: 1,
  }),
  fileName: Type.Optional(Type.String({
    description: "导入 assets/ 后使用的文件名",
    minLength: 1,
  })),
}, { additionalProperties: false });

const deleteSchema = Type.Object({
  path: Type.String({
    description: "要删除的草稿包内相对文件路径",
    minLength: 1,
  }),
}, { additionalProperties: false });

const validateSchema = Type.Object({}, { additionalProperties: false });

function getSkillDraftStore(): SkillDraftStore {
  return skillDraftStore;
}

function result(details: JsonObject): SkillDraftToolResult {
  return {
    content: [{ type: "text", text: JSON.stringify(details) }],
    details,
  };
}

function failure(code: string, status: number, message: string) {
  return result({ ok: false, error: { code, status, message } });
}

function safeError(cause: unknown): SkillDraftToolResult {
  if (cause instanceof ToolInputError || cause instanceof SkillDraftError) {
    return failure(
      cause.code,
      cause.status,
      redactAbsolutePaths(cause.message),
    );
  }
  return failure(
    "INTERNAL_ERROR",
    500,
    "技能草稿操作失败，请稍后重试",
  );
}

function redactAbsolutePaths(message: string): string {
  return message
    .replaceAll(/(?:\/[^/\s:]+){2,}/g, "[私有路径]")
    .replaceAll(/[A-Za-z]:\\[^\s]+/g, "[私有路径]");
}

async function withDraft(
  dependencies: SkillDraftToolDependencies,
  operation: (
    store: SkillDraftStore,
    draft: SkillDraftMetadata,
    conversationId: string,
  ) => Promise<JsonObject>,
): Promise<SkillDraftToolResult> {
  const conversationId = sessionContext.getStore()?.sessionId;
  if (!conversationId) {
    return failure(
      "SESSION_CONTEXT_MISSING",
      400,
      "无法确定当前会话",
    );
  }

  try {
    const store = dependencies.store ?? getSkillDraftStore();
    const draft = await store.getOrCreateForConversation(conversationId);
    return result(await operation(store, draft, conversationId));
  } catch (cause) {
    return safeError(cause);
  }
}

function assertValidInit(name: string, description: string): void {
  if (
    name.length > 64 ||
    !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name)
  ) {
    throw new ToolInputError(
      "INVALID_SKILL_NAME",
      400,
      "技能名称必须使用小写字母、数字和单个连字符，且不超过 64 个字符",
    );
  }
  if (
    !description.trim() ||
    description.length > 1024 ||
    /[\r\n<>]/.test(description)
  ) {
    throw new ToolInputError(
      "INVALID_SKILL_DESCRIPTION",
      400,
      "技能描述必须是非空、不含尖括号且不超过 1024 字符的单行文本",
    );
  }
}

function displayName(name: string): string {
  return name.split("-").map((part) =>
    part.length === 0 ? part : part[0].toUpperCase() + part.slice(1)
  ).join(" ");
}

function initialSkill(name: string, description: string): string {
  return `---
name: ${name}
description: ${JSON.stringify(description)}
---

# ${displayName(name)}

## Overview

${description}

## Instructions

Follow the capability goal in the overview and produce focused, useful results.
`;
}

function cleanFileName(input: string): string {
  if (input.includes("\0")) {
    throw new ToolInputError("INVALID_ASSET_NAME", 400, "附件文件名无效");
  }
  const cleaned = basename(input.replaceAll("\\", "/")).trim();
  if (!cleaned || cleaned === "." || cleaned === "..") {
    throw new ToolInputError("INVALID_ASSET_NAME", 400, "附件文件名无效");
  }
  return cleaned;
}

async function resolveConversationAttachment(
  conversationId: string,
  attachmentId: string,
): Promise<ResolvedAttachment | undefined> {
  const { getConversationAttachment } = await import(
    "../../domains/attachment/node/store.ts"
  );
  return getConversationAttachment(conversationId, attachmentId);
}

export function getSkillDraftTools(
  dependencies: SkillDraftToolDependencies = {},
): AgentTool[] {
  const resolveAttachment = dependencies.resolveAttachment ??
    resolveConversationAttachment;

  const initTool: AgentTool<typeof initSchema, JsonObject> = {
    name: "skill_draft_init",
    label: "初始化技能草稿",
    description:
      "为当前会话初始化标准 SKILL.md，并立即创建请求的资源目录。不会覆盖已经初始化的草稿。",
    parameters: initSchema,
    execute: async (_id, params) =>
      await withDraft(dependencies, async (store, draft) => {
        assertValidInit(params.name, params.description);
        await store.initialize(
          draft.id,
          {
            name: params.name,
            description: params.description,
            resources: (params.resources ??
              []) as SkillDraftResourceDirectory[],
            skillMd: initialSkill(params.name, params.description),
          },
        );
        return {
          ok: true,
          name: params.name,
          resources: params.resources ?? [],
          createdResourceDirectories: params.resources ?? [],
        };
      }),
  };

  const listTool: AgentTool<typeof listSchema, JsonObject> = {
    name: "skill_draft_list",
    label: "列出技能草稿",
    description: "列出当前会话技能草稿中的全部文件及其大小和类型。",
    parameters: listSchema,
    execute: async () =>
      await withDraft(dependencies, async (store, draft) => ({
        ok: true,
        files: await store.listFiles(draft.id),
      })),
  };

  const readTool: AgentTool<typeof readSchema, JsonObject> = {
    name: "skill_draft_read",
    label: "读取技能草稿文件",
    description: "读取当前会话技能草稿中的文本文件或二进制元数据。",
    parameters: readSchema,
    execute: async (_id, params) =>
      await withDraft(dependencies, async (store, draft) => ({
        ok: true,
        path: params.path,
        ...await store.readFile(draft.id, params.path),
      })),
  };

  const writeTool: AgentTool<typeof writeSchema, JsonObject> = {
    name: "skill_draft_write",
    label: "写入技能草稿文件",
    description:
      "在当前会话技能草稿中创建或覆盖一个受支持路径下的 UTF-8 文本文件。",
    parameters: writeSchema,
    execute: async (_id, params) =>
      await withDraft(dependencies, async (store, draft) => {
        await store.writeFile(draft.id, params.path, params.content);
        return { ok: true, path: params.path };
      }),
  };

  const importAttachmentTool: AgentTool<
    typeof importAttachmentSchema,
    JsonObject
  > = {
    name: "skill_draft_import_attachment",
    label: "导入附件到技能草稿",
    description:
      "把当前会话中已上传的附件安全复制到技能草稿 assets/ 目录。附件源路径由服务端解析。",
    parameters: importAttachmentSchema,
    execute: async (_id, params) =>
      await withDraft(
        dependencies,
        async (store, draft, conversationId) => {
          const attachment = await resolveAttachment(
            conversationId,
            params.attachmentId,
          );
          if (!attachment) {
            throw new ToolInputError(
              "ATTACHMENT_NOT_FOUND",
              404,
              "当前会话中未找到该附件",
            );
          }
          const fileName = cleanFileName(params.fileName ?? attachment.name);
          const path = await store.importAsset(
            draft.id,
            attachment.filePath,
            fileName,
          );
          return { ok: true, path };
        },
      ),
  };

  const deleteTool: AgentTool<typeof deleteSchema, JsonObject> = {
    name: "skill_draft_delete",
    label: "删除技能草稿文件",
    description:
      "删除当前会话技能草稿中的一个普通文件，或 scripts/references/assets 下的空目录。",
    parameters: deleteSchema,
    execute: async (_id, params) =>
      await withDraft(dependencies, async (store, draft) => {
        await store.deleteFile(draft.id, params.path);
        return { ok: true, path: params.path };
      }),
  };

  const validateTool: AgentTool<typeof validateSchema, JsonObject> = {
    name: "skill_draft_validate",
    label: "校验技能草稿",
    description: "校验当前会话的完整技能包，并返回结构化错误、警告和校验时间。",
    parameters: validateSchema,
    execute: async () =>
      await withDraft(dependencies, async (store, draft) => ({
        ok: true,
        ...await store.validate(draft.id),
      })),
  };

  return [
    initTool,
    listTool,
    readTool,
    writeTool,
    importAttachmentTool,
    deleteTool,
    validateTool,
  ];
}
