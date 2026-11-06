import { resolve } from "node:path";

import type { AgentTool } from "@earendil-works/pi-agent-core";

import {
  type DelegatedAttachmentContext,
  sessionContext,
} from "../../infra/context.ts";
import { isWindows } from "../../platform/runtime.ts";

function comparablePath(value: string, cwd: string): string {
  const absolute = resolve(cwd, value);
  return isWindows ? absolute.toLocaleLowerCase("en-US") : absolute;
}

function localExtractionResult(
  extraction: NonNullable<DelegatedAttachmentContext["localExtraction"]>,
) {
  return {
    content: [{
      type: "text" as const,
      text: [
        "[附件本地解析结果]",
        "已跳过整份大 JSON 的读取：当前问题所需字段已由程序在本地确定性解析。",
        JSON.stringify(extraction),
        "请直接根据以上结果回答。只有需要未提取字段时，才使用结构化查询读取对应字段；不要再次读取整份附件。",
      ].join("\n"),
    }],
    details: {
      localExtraction: true,
      fieldCount: extraction.fields.length,
    },
  };
}

/**
 * Prevent a model from undoing bounded local JSON extraction by reading the
 * entire managed attachment back into its context.
 */
export function guardAttachmentReadTool<T extends AgentTool<any, any>>(
  tool: T,
  cwd: string,
): T {
  if (tool.name !== "read") return tool;
  const originalExecute = tool.execute;
  const wrapped = Object.create(Object.getPrototypeOf(tool));
  const descriptors = Object.getOwnPropertyDescriptors(tool);
  Reflect.deleteProperty(descriptors, "execute");
  Object.defineProperties(wrapped, descriptors);
  Object.defineProperty(wrapped, "execute", {
    configurable: true,
    // Runtime profiles clone tools with object spread. Keep execute enumerable
    // so the cloned tool remains executable.
    enumerable: true,
    writable: true,
    value: async (
      id: string,
      input: unknown,
      signal?: AbortSignal,
      onUpdate?: unknown,
    ) => {
      const requestedPath = typeof (input as { path?: unknown })?.path === "string"
        ? (input as { path: string }).path
        : undefined;
      if (requestedPath) {
        const requested = comparablePath(requestedPath, cwd);
        const attachment = sessionContext.getStore()?.attachments?.find((item) =>
          item.path &&
          comparablePath(item.path, cwd) === requested &&
          item.localExtraction?.fields.length
        );
        if (attachment?.localExtraction) {
          return localExtractionResult(attachment.localExtraction);
        }
      }
      return await originalExecute.call(
        tool,
        id,
        input as any,
        signal,
        onUpdate as any,
      );
    },
  });
  return wrapped as T;
}
