import { createReadTool } from "@earendil-works/pi-coding-agent";
import type { ImageContent } from "@earendil-works/pi-ai";
import { randomUUID } from "node:crypto";
import { isAbsolute, relative, resolve } from "node:path";

import type { AttachmentContextItem } from "./prompt-runtime/types.ts";
import { platformPaths } from "../platform/paths.ts";
import { currentPlatform } from "../platform/runtime.ts";

const PROMPT_IMAGE_EXTENSIONS = new Set([
  "png",
  "jpg",
  "jpeg",
  "gif",
  "webp",
]);

interface PromptImageModel {
  id?: string;
  provider?: string;
  input?: readonly string[];
}

type ReadPromptImage = (
  path: string,
  signal?: AbortSignal,
) => Promise<ImageContent[]>;

export interface PromptImageDependencies {
  attachmentsRoot?: string;
  readImage?: ReadPromptImage;
}

export interface BuildPromptImagesInput {
  attachments: readonly AttachmentContextItem[];
  cwd: string;
  model?: PromptImageModel;
  signal?: AbortSignal;
}

function comparablePath(path: string): string {
  return currentPlatform === "windows" ? path.toLocaleLowerCase("en-US") : path;
}

function isPromptImage(attachment: AttachmentContextItem): boolean {
  return PROMPT_IMAGE_EXTENSIONS.has(attachment.extension?.toLowerCase() ?? "");
}

function resolveManagedAttachmentPath(
  attachment: AttachmentContextItem,
  rootPath: string,
): string {
  if (!attachment.id || !attachment.name || !attachment.path) {
    throw new Error(`图片附件“${attachment.name || "未命名附件"}”缺少受管文件信息`);
  }

  const root = resolve(rootPath);
  const actual = resolve(attachment.path);
  const expected = resolve(root, attachment.id, attachment.name);
  const relativePath = relative(root, actual);
  const outsideRoot = relativePath === "" ||
    relativePath.startsWith("..") ||
    isAbsolute(relativePath);
  if (
    outsideRoot ||
    comparablePath(actual) !== comparablePath(expected)
  ) {
    throw new Error(`图片附件“${attachment.name}”不在受管附件目录中`);
  }
  return actual;
}

function createPiImageReader(cwd: string): ReadPromptImage {
  const readTool = createReadTool(cwd);
  return async (path, signal) => {
    const result = await readTool.execute(
      `prompt-image:${randomUUID()}`,
      { path },
      signal,
    );
    return result.content.filter((block): block is ImageContent =>
      block.type === "image"
    );
  };
}

function modelLabel(model: PromptImageModel | undefined): string {
  if (!model) return "当前模型";
  const identity = [model.provider, model.id].filter(Boolean).join("/");
  return identity || "当前模型";
}

/**
 * Converts current-turn managed image attachments into Pi native image inputs.
 * The attachment metadata remains in TurnPayload; base64 image data exists only
 * for the in-memory model request.
 */
export async function buildPromptImages(
  input: BuildPromptImagesInput,
  dependencies: PromptImageDependencies = {},
): Promise<ImageContent[]> {
  const imageAttachments = input.attachments.filter(isPromptImage);
  if (imageAttachments.length === 0) return [];

  if (!input.model?.input?.includes("image")) {
    throw new Error(`${modelLabel(input.model)} 不支持图片输入，请切换视觉模型后重试`);
  }

  const root = dependencies.attachmentsRoot ??
    platformPaths.join(platformPaths.appDataDir, "attachments");
  const readImage = dependencies.readImage ?? createPiImageReader(input.cwd);
  const images: ImageContent[] = [];

  for (const attachment of imageAttachments) {
    if (input.signal?.aborted) throw new Error("PROMPT_CANCELLED");
    const path = resolveManagedAttachmentPath(attachment, root);
    let blocks: ImageContent[];
    try {
      blocks = await readImage(path, input.signal);
    } catch (error) {
      throw new Error(`无法读取图片附件“${attachment.name}”`, { cause: error });
    }
    if (blocks.length === 0) {
      throw new Error(`附件“${attachment.name}”不是可处理的图片`);
    }
    images.push(...blocks);
  }

  return images;
}
