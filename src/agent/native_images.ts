import { mkdir, writeFile } from "node:fs/promises";
import { dirname, extname, resolve } from "node:path";
import { Type } from "typebox";
import type { ModelRuntime, ToolDefinition } from "@earendil-works/pi-coding-agent";

const parameters = Type.Object({
  prompt: Type.String({ minLength: 1, description: "图片生成要求" }),
  path: Type.String({ minLength: 1, description: "工作目录中的输出文件路径，例如 images/poster.png；不得覆盖已有文件" }),
  provider: Type.Optional(Type.String({ description: "图片模型服务商；未指定时仅在恰好有一个可用图片模型时自动选择" })),
  model: Type.Optional(Type.String({ description: "图片模型 ID" })),
});

/** Pi owns model invocation/auth; the product owns durable artifact placement.
 * The engine checks this tool as a write, including resolved-path protection.
 * Delivery still requires the existing present_files/goal_complete sequence.
 */
export function createImageGenerationTool(runtime: ModelRuntime, cwd: string): ToolDefinition<typeof parameters> {
  return {
    name: "generate_image", label: "生成图片", parameters,
    description: "使用已配置的 Pi 原生图片模型生成图片并保存为交付文件。必须在用户要求生成图片时使用；成功后调用 present_files 展示文件。",
    execute: async (_id, input, signal) => {
      signal?.throwIfAborted();
      const available = await runtime.getAvailableOfType("image", input.provider, { signal });
      const candidates = available.filter(model => !input.model || model.id === input.model);
      if (candidates.length !== 1) {
        throw new Error(candidates.length ? `请指定图片模型 provider/model：${candidates.map(model => `${model.provider}/${model.id}`).join(", ")}` : "未配置可用的原生图片模型，请配置支持图片生成的 Pi provider 或安装对应模型插件。");
      }
      const model = candidates[0];
      const result = await runtime.generateImages(model, { input: [{ type: "text", text: input.prompt }] }, { signal });
      signal?.throwIfAborted();
      if (result.stopReason !== "stop") throw new Error(result.errorMessage || `图片生成${result.stopReason}`);
      const blocks = result.output.filter(block => block.type === "image");
      if (blocks.length !== 1) throw new Error(`图片模型返回 ${blocks.length} 张图片；请要求只生成一张图片。`);
      const block = blocks[0];
      const extensions: Record<string, string[]> = { "image/png": [".png"], "image/jpeg": [".jpg", ".jpeg"], "image/webp": [".webp"], "image/gif": [".gif"] };
      const path = resolve(cwd, input.path);
      if (!extensions[block.mimeType]?.includes(extname(path).toLowerCase())) throw new Error(`输出为 ${block.mimeType}，请使用匹配的文件扩展名。`);
      const data = Buffer.from(block.data, "base64");
      if (!data.length) throw new Error("图片模型返回空文件");
      await mkdir(dirname(path), { recursive: true });
      signal?.throwIfAborted();
      await writeFile(path, data, { flag: "wx", mode: 0o600, signal });
      return {
        content: [{ type: "text", text: `图片已保存：${path}。请使用 present_files 交付。` }, block],
        details: { path, provider: model.provider, model: model.id },
        ...(result.usage ? { usage: result.usage } : {}),
      };
    },
  };
}
